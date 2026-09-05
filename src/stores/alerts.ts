/**
 * S-056 Alerts store (F-026 · M5-4 · SCREENS-SPEC S-056 · API-SPEC §7 alerts.*).
 *
 * Owns the Alert Center read state and the audited rule-creation flow:
 *   * `alerts.list` `{filter}` → `{alerts[]}` — session scope (no company arg; the locked
 *     catalog table row says so). Filters: severity + include dismissed (90-day log view).
 *   * `alerts.create_rule` `{rule}` → `{rule_id, audit_id}` — Company-write mutation;
 *     HMAC-audited natively (commands/alerts.rs). Validation failures surface as typed
 *     ALERT_RULE_INVALID inline in the rule form (the list is never blanked by a form error).
 *   * 5 canonical states: error/loading/empty("All clear" per SCREENS-SPEC)/success(populated
 *     rule-creation flow states)/populated(list with alerts).
 *   * Dismiss / mute rule have NO catalog command — the UI ships them disabled (see docs),
 *     so this store intentionally has no local-only dismiss (B18: no fabricated behavior).
 *   * Money rule: thresholds and trigger-chain values are exact decimal strings end-to-end
 *     (schema DecimalString); nothing here parses floats (B3).
 */

import { create } from "zustand";
import { call, toBridgeError, type BridgeError } from "@/api/bridge";
import type { ScreenState } from "@/components/ui/StatePanel";
import type {
  AlertRecord,
  AlertRuleInput,
  AlertSeverity,
  AlertsCreateRuleData,
  AlertsListData,
} from "@/api/schema";

export interface AlertFilterState {
  severity: AlertSeverity | null;
  includeDismissed: boolean;
}

export interface AlertsStoreState {
  /* ── 5 screen states & errors ──────────────────────────────────── */
  status: ScreenState;
  error: BridgeError | null;
  /** Inline error for the rule form; never replaces the list view. */
  createError: BridgeError | null;

  /* ── Data ──────────────────────────────────────────────────────── */
  alerts: AlertRecord[];
  filter: AlertFilterState;
  creating: boolean;
  /** rule_id of the most recent successful create (echo chip; no rules-list command exists). */
  lastCreatedRuleId: string | null;

  /* ── Actions ───────────────────────────────────────────────────── */
  setSeverityFilter: (severity: AlertSeverity | null) => Promise<void>;
  setIncludeDismissed: (include: boolean) => Promise<void>;
  loadAlerts: () => Promise<boolean>;
  createRule: (rule: AlertRuleInput) => Promise<boolean>;
  retry: () => Promise<boolean>;
  reset: () => void;
}

const IDLE: Pick<
  AlertsStoreState,
  "status" | "error" | "createError" | "alerts" | "filter" | "creating" | "lastCreatedRuleId"
> = {
  status: "success",
  error: null,
  createError: null,
  alerts: [],
  filter: { severity: null, includeDismissed: false },
  creating: false,
  lastCreatedRuleId: null,
};

export const useAlertsStore = create<AlertsStoreState>((set, get) => ({
  ...IDLE,

  async loadAlerts() {
    set({ status: "loading", error: null });
    try {
      const { severity, includeDismissed } = get().filter;
      const response = (await call("alerts.list", {
        filter: {
          ...(severity !== null ? { severity } : {}),
          include_dismissed: includeDismissed,
        },
      })) as AlertsListData;
      const alerts = response.alerts;
      set({
        alerts,
        status: alerts.length > 0 ? "populated" : "empty",
        error: null,
      });
      return true;
    } catch (e) {
      const error = toBridgeError(e);
      // Keep any previously loaded list out of the state on failure — the error view owns it.
      set({ status: "error", error, alerts: [] });
      return false;
    }
  },

  async setSeverityFilter(severity) {
    if (get().filter.severity === severity) return;
    set({ filter: { ...get().filter, severity } });
    await get().loadAlerts();
  },

  async setIncludeDismissed(includeDismissed) {
    if (get().filter.includeDismissed === includeDismissed) return;
    set({ filter: { ...get().filter, includeDismissed } });
    await get().loadAlerts();
  },

  async createRule(rule) {
    set({ creating: true, createError: null });
    try {
      const response = (await call("alerts.create_rule", {
        rule: {
          name: rule.name,
          kpi_id: rule.kpi_id ?? null,
          line_ref: rule.line_ref ?? null,
          threshold_operator: rule.threshold_operator,
          threshold_value: rule.threshold_value,
          severity: rule.severity,
          active: rule.active,
        },
      })) as AlertsCreateRuleData;
      set({
        creating: false,
        createError: null,
        lastCreatedRuleId: response.rule_id,
      });
      return true;
    } catch (e) {
      set({ creating: false, createError: toBridgeError(e) });
      return false;
    }
  },

  async retry() {
    // Retry contract (STATE-MANAGEMENT §error): re-run the failed READ. A failed create is
    // retried by the form itself (createError inline), never by silently re-mutating here.
    return get().loadAlerts();
  },

  reset() {
    set({ ...IDLE });
  },
}));

/** Selector helpers (kept beside the store so pages never re-implement filtering). */
export const selectOpenAlerts = (s: AlertsStoreState): AlertRecord[] =>
  s.alerts.filter((a) => a.dismissed_at === null);

export const selectAlertCountBySeverity = (s: AlertsStoreState): Record<AlertSeverity, number> => {
  const counts: Record<AlertSeverity, number> = { info: 0, warning: 0, critical: 0 };
  for (const a of s.alerts) counts[a.severity] += 1;
  return counts;
};
