/**
 * S-071 Model Health Check store (F-032 · US-033 · SCREENS-SPEC S-071 · API-SPEC §7 `health.*`).
 *
 * Owns:
 *   * `health.run` `{model_id}` → the full report (findings, per-category rollup, counts,
 *     run history). A failing Model is a *report*, never an error state — the error state is
 *     reserved for a genuine transport/session failure.
 *   * `health.waive` `{finding_id, reason}` → `{waived}`, then a re-run so the counts, the
 *     category rollup and the export gate all come from the engine rather than local edits.
 *   * The 5 canonical screen states: loading (run in flight — indeterminate, never a fake
 *     percentage), empty (never run yet), error (transport/session), success (all green),
 *     populated (findings to work through).
 *
 * Deliberate frictions, carried from US-033 / D-010 and not softened here:
 *   * A waiver ALWAYS requires a non-blank reason. `waive()` refuses locally before the call
 *     so the UI cannot even attempt an empty waiver; `HEALTH_WAIVER_REASON_REQUIRED` from the
 *     engine remains the authority and is surfaced verbatim when it arrives.
 *   * Waived findings stay in the list with their reason and author — nothing is hidden.
 *   * No finding is ever mutated, auto-fixed or filtered away client-side. The store holds
 *     exactly what the engine returned.
 */

import { create } from "zustand";
import { call, toBridgeError, type BridgeError } from "@/api/bridge";
import type { ScreenState } from "@/components/ui/StatePanel";
import type {
  HealthCategory,
  HealthCategoryResult,
  HealthFindingRecord,
  HealthRunData,
  HealthRunSummary,
} from "@/api/schema";

/** Parsed `entity_ref`. Only the `cell` form can be navigated to (S-071 "→ cell"). */
export type HealthEntityTarget =
  | { kind: "cell"; lineId: string; scenarioId: string; periodId: string }
  | { kind: "line" | "driver" | "assumption" | "period" | "batch"; id: string }
  | null;

/**
 * `cell:{line}:{scenario}:{period}` is the only navigable form; every other prefix is a
 * label-only pointer. An unknown or malformed ref returns `null` so the UI withholds the
 * jump target rather than guessing at one.
 */
export function parseEntityRef(entityRef: string | null): HealthEntityTarget {
  if (!entityRef) return null;
  const [kind, ...rest] = entityRef.split(":");
  if (kind === "cell") {
    if (rest.length !== 3 || rest.some((part) => part === "")) return null;
    return { kind: "cell", lineId: rest[0], scenarioId: rest[1], periodId: rest[2] };
  }
  if (
    kind === "line" ||
    kind === "driver" ||
    kind === "assumption" ||
    kind === "period" ||
    kind === "batch"
  ) {
    const id = rest.join(":");
    return id === "" ? null : { kind, id };
  }
  return null;
}

export interface HealthStoreState {
  status: ScreenState;
  error: BridgeError | null;
  /** Non-fatal error from the last waive attempt, shown next to the waiver form. */
  waiveError: BridgeError | null;

  modelId: string | null;
  checkId: string | null;
  runAt: string | null;
  runStatus: "running" | "passed" | "failed" | null;
  findings: HealthFindingRecord[];
  categories: HealthCategoryResult[];
  blockingCount: number;
  warningCount: number;
  waivedCount: number;
  history: HealthRunSummary[];
  /** Which finding's waiver form is open (S-071: never inline on the row itself). */
  waivingFindingId: string | null;
  waiveInFlight: boolean;

  setModelId: (modelId: string | null) => void;
  run: (modelId?: string) => Promise<boolean>;
  retry: () => Promise<boolean>;
  openWaiver: (findingId: string | null) => void;
  waive: (findingId: string, reason: string) => Promise<boolean>;
  reset: () => void;

  /** Export gate (F-032 item 5): true while unwaived HARD findings remain. */
  isExportBlocked: () => boolean;
  findingsFor: (category: HealthCategory) => HealthFindingRecord[];
}

const EMPTY = {
  checkId: null,
  runAt: null,
  runStatus: null,
  findings: [] as HealthFindingRecord[],
  categories: [] as HealthCategoryResult[],
  blockingCount: 0,
  warningCount: 0,
  waivedCount: 0,
  history: [] as HealthRunSummary[],
};

export const useHealthStore = create<HealthStoreState>((set, get) => ({
  status: "empty",
  error: null,
  waiveError: null,
  modelId: null,
  waivingFindingId: null,
  waiveInFlight: false,
  ...EMPTY,

  setModelId: (modelId) => set({ modelId }),

  async run(modelId) {
    const targetModel = modelId ?? get().modelId;
    if (!targetModel) {
      set({ status: "empty", error: null, ...EMPTY });
      return false;
    }

    set({ status: "loading", error: null, waiveError: null, modelId: targetModel });
    try {
      const report = (await call("health.run", { model_id: targetModel })) as HealthRunData;
      set({
        // A clean Model is the "success" state; findings make it "populated". Neither is an
        // error — a failing Health Check is the report working as designed (US-033).
        status: report.findings.length > 0 ? "populated" : "success",
        error: null,
        checkId: report.check_id,
        modelId: report.model_id,
        runAt: report.run_at,
        runStatus: report.status,
        findings: report.findings,
        categories: report.categories,
        blockingCount: report.blocking_count,
        warningCount: report.warning_count,
        waivedCount: report.waived_count,
        history: report.history,
        waivingFindingId: null,
      });
      return true;
    } catch (e) {
      // Stale findings are cleared: a verdict that no longer corresponds to a completed run
      // must never stay on screen next to an error.
      set({ status: "error", error: toBridgeError(e), ...EMPTY });
      return false;
    }
  },

  async retry() {
    return get().run();
  },

  openWaiver: (findingId) => set({ waivingFindingId: findingId, waiveError: null }),

  async waive(findingId, reason) {
    if (reason.trim().length === 0) {
      // D-010 friction, enforced before the wire: the catalog text, verbatim.
      set({
        waiveError: {
          code: "HEALTH_WAIVER_REASON_REQUIRED",
          userMessage: "A waiver reason is required.",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: { finding_id: findingId },
        },
      });
      return false;
    }

    set({ waiveInFlight: true, waiveError: null });
    try {
      await call("health.waive", { finding_id: findingId, reason: reason.trim() });
    } catch (e) {
      set({ waiveInFlight: false, waiveError: toBridgeError(e) });
      return false;
    }
    set({ waiveInFlight: false, waivingFindingId: null });
    // Re-run so every count and the export gate come from the engine, not from local edits.
    return get().run();
  },

  reset: () =>
    set({
      status: "empty",
      error: null,
      waiveError: null,
      modelId: null,
      waivingFindingId: null,
      waiveInFlight: false,
      ...EMPTY,
    }),

  isExportBlocked: () => get().blockingCount > 0,
  findingsFor: (category) => get().findings.filter((f) => f.category === category),
}));
