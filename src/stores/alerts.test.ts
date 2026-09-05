/**
 * S-056 Alerts store tests (F-026 · M5-4).
 *
 * The bridge `call` is mocked (toBridgeError stays real). Covers the exact contract the
 * page depends on: state transitions, filter-driven reload, the inline (non-list-blanking)
 * create-error contract, retry semantics, reset, and the selectors.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectAlertCountBySeverity, selectOpenAlerts, useAlertsStore } from "./alerts";
import type { AlertRecord } from "@/api/schema";

const callMock = vi.fn();
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return {
    ...actual,
    call: (...args: unknown[]) => callMock(...args),
  };
});

function alert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: "b0b00000-0000-4000-8000-000000000001",
    rule_id: "a1e00000-0000-4000-8000-000000000001",
    rule_name: "Cash floor (13-week)",
    severity: "warning",
    fired_at: "2026-09-05T06:30:00Z",
    trigger_chain: {
      rule: "Cash floor (13-week)",
      line: "line-cash",
      period_id: "fp-2026-p06",
      value: "2400000000",
      threshold: "2500000000",
    },
    dismissed_at: null,
    ...overrides,
  };
}

describe("alerts store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAlertsStore.getState().reset();
  });

  describe("load lifecycle", () => {
    it("goes loading → populated when alerts arrive, and back to empty on zero rows", async () => {
      callMock.mockResolvedValueOnce({ alerts: [alert()] });
      const loading = useAlertsStore.getState().loadAlerts();
      expect(useAlertsStore.getState().status).toBe("loading");
      expect(await loading).toBe(true);
      expect(useAlertsStore.getState().status).toBe("populated");
      expect(useAlertsStore.getState().alerts).toHaveLength(1);

      callMock.mockResolvedValueOnce({ alerts: [] });
      expect(await useAlertsStore.getState().loadAlerts()).toBe(true);
      expect(useAlertsStore.getState().status).toBe("empty");
    });

    it("maps a typed bridge failure to error state and clears stale rows", async () => {
      callMock.mockResolvedValueOnce({ alerts: [alert()] });
      await useAlertsStore.getState().loadAlerts();
      callMock.mockRejectedValueOnce({
        code: "ALERT_RULE_INVALID",
        userMessage: "Alert rule invalid: filter.severity must be one of info, warning, critical",
        httpStatus: 422,
        retryable: false,
        details: {},
      });
      const ok = await useAlertsStore.getState().loadAlerts();
      expect(ok).toBe(false);
      const s = useAlertsStore.getState();
      expect(s.status).toBe("error");
      expect(s.error?.code).toBe("ALERT_RULE_INVALID");
      expect(s.alerts).toEqual([]); // stale rows never survive an error (STATE-MANAGEMENT)
    });

    it("sends the persisted filter on every load and reloads on filter change", async () => {
      callMock.mockResolvedValue({ alerts: [] });
      await useAlertsStore.getState().loadAlerts();
      expect(callMock).toHaveBeenLastCalledWith("alerts.list", {
        filter: { include_dismissed: false },
      });

      await useAlertsStore.getState().setSeverityFilter("critical");
      expect(callMock).toHaveBeenLastCalledWith("alerts.list", {
        filter: { severity: "critical", include_dismissed: false },
      });

      await useAlertsStore.getState().setIncludeDismissed(true);
      expect(callMock).toHaveBeenLastCalledWith("alerts.list", {
        filter: { severity: "critical", include_dismissed: true },
      });
    });

    it("a same-value filter change is a no-op (no redundant load)", async () => {
      callMock.mockResolvedValue({ alerts: [] });
      await useAlertsStore.getState().setSeverityFilter(null);
      expect(callMock).not.toHaveBeenCalled();
    });
  });

  describe("createRule", () => {
    const rule = {
      name: "Min gross margin",
      kpi_id: null,
      line_ref: "line-gm",
      threshold_operator: "lt" as const,
      threshold_value: "-0.25",
      severity: "warning" as const,
      active: true,
    };

    it("forwards the rule object under the `rule` arg and records the audit response", async () => {
      callMock.mockResolvedValueOnce({
        rule_id: "c1c1c1c1-1111-4111-8111-111111111111",
        audit_id: 901,
      });
      const ok = await useAlertsStore.getState().createRule(rule);
      expect(ok).toBe(true);
      expect(callMock).toHaveBeenCalledWith("alerts.create_rule", { rule });
      const s = useAlertsStore.getState();
      expect(s.lastCreatedRuleId).toBe("c1c1c1c1-1111-4111-8111-111111111111");
      expect(s.createError).toBeNull();
      expect(s.creating).toBe(false);
    });

    it("keeps the loaded list intact and answers inline on ALERT_RULE_INVALID", async () => {
      callMock.mockResolvedValueOnce({ alerts: [alert()] });
      await useAlertsStore.getState().loadAlerts();
      callMock.mockRejectedValueOnce({
        code: "ALERT_RULE_INVALID",
        userMessage: "Alert rule invalid: threshold_value must be an exact decimal string",
        httpStatus: 422,
        retryable: false,
        details: {},
      });
      const ok = await useAlertsStore.getState().createRule({ ...rule, threshold_value: "1.5e3" });
      expect(ok).toBe(false);
      const s = useAlertsStore.getState();
      expect(s.createError?.code).toBe("ALERT_RULE_INVALID");
      expect(s.status).toBe("populated"); // the LIST is never blanked by a form error
      expect(s.alerts).toHaveLength(1);
      expect(s.creating).toBe(false);
    });
  });

  describe("retry / reset / selectors", () => {
    it("retry re-runs the READ and never replays the mutation", async () => {
      callMock.mockRejectedValueOnce({ code: "INTERNAL", httpStatus: 500, retryable: true });
      await useAlertsStore.getState().loadAlerts();
      callMock.mockResolvedValueOnce({ alerts: [alert()] });
      expect(await useAlertsStore.getState().retry()).toBe(true);
      const commands = callMock.mock.calls.map((c) => c[0]);
      expect(commands).toHaveLength(2); // initial failed read + retry — both reads
      expect(new Set(commands)).toEqual(new Set(["alerts.list"])); // no mutation replay (B4)
    });

    it("reset returns the whole store to idle", async () => {
      callMock.mockResolvedValueOnce({ alerts: [alert()] });
      await useAlertsStore.getState().loadAlerts();
      useAlertsStore.getState().reset();
      const s = useAlertsStore.getState();
      expect(s).toMatchObject({ status: "success", alerts: [], creating: false });
      expect(s.filter).toEqual({ severity: null, includeDismissed: false });
      expect(s.error).toBeNull();
      expect(s.lastCreatedRuleId).toBeNull();
    });

    it("selectors: open-only list and severity histogram", async () => {
      callMock.mockResolvedValueOnce({
        alerts: [
          alert(),
          alert({
            id: "b0b00000-0000-4000-8000-000000000009",
            dismissed_at: "2026-09-04T10:00:00Z",
          }),
          alert({ id: "b0b00000-0000-4000-8000-000000000010", severity: "critical" }),
        ],
      });
      await useAlertsStore.getState().loadAlerts();
      const s = useAlertsStore.getState();
      expect(selectOpenAlerts(s).map((a) => a.id)).toEqual([
        "b0b00000-0000-4000-8000-000000000001",
        "b0b00000-0000-4000-8000-000000000010",
      ]);
      expect(selectAlertCountBySeverity(s)).toEqual({ info: 0, warning: 2, critical: 1 }); // histogram counts the LOG (dismissed included)
    });
  });
});
