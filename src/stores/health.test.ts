/**
 * S-071 Model Health Check store tests (F-032 · US-033).
 *
 * The bridge `call` is mocked (toBridgeError stays real). Covers the contract the page
 * depends on: run lifecycle and the "findings are a report, not an error" rule, the D-010
 * blank-reason gate, the re-run after a waiver, the export gate, `entity_ref` parsing (the
 * only thing that decides whether "→ cell" is offered) and reset.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEntityRef, useHealthStore } from "./health";
import type { HealthFindingRecord, HealthRunData } from "@/api/schema";

const callMock = vi.fn();
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return {
    ...actual,
    call: (...args: unknown[]) => callMock(...args),
  };
});

const MODEL_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000010";
const FINDING_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000011";

function finding(overrides: Partial<HealthFindingRecord> = {}): HealthFindingRecord {
  return {
    id: FINDING_ID,
    category: "tie_out",
    severity: "hard",
    message: "Committed GL does not tie for period fp-2026-p02.",
    entity_ref: "period:fp-2026-p02",
    waiver: null,
    ...overrides,
  };
}

function report(overrides: Partial<HealthRunData> = {}): HealthRunData {
  const findings = overrides.findings ?? [finding()];
  const blocking = findings.filter((f) => f.severity === "hard" && f.waiver === null).length;
  return {
    check_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000012",
    model_id: MODEL_ID,
    run_at: "2026-09-05T10:00:00Z",
    status: blocking > 0 ? "failed" : "passed",
    findings,
    categories: [
      {
        category: "tie_out",
        status: blocking > 0 ? "failed" : "passed",
        finding_count: findings.length,
        blocking_count: blocking,
        warning_count: 0,
      },
      {
        category: "reference",
        status: "passed",
        finding_count: 0,
        blocking_count: 0,
        warning_count: 0,
      },
      {
        category: "rounding",
        status: "passed",
        finding_count: 0,
        blocking_count: 0,
        warning_count: 0,
      },
      {
        category: "driver_feed",
        status: "passed",
        finding_count: 0,
        blocking_count: 0,
        warning_count: 0,
      },
      {
        category: "anomaly",
        status: "passed",
        finding_count: 0,
        blocking_count: 0,
        warning_count: 0,
      },
    ],
    blocking_count: blocking,
    warning_count: 0,
    waived_count: findings.filter((f) => f.waiver !== null).length,
    history: [],
    ...overrides,
  };
}

describe("health store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHealthStore.getState().reset();
  });

  describe("run lifecycle", () => {
    it("stays empty and calls nothing without a Model", async () => {
      const ok = await useHealthStore.getState().run();
      expect(ok).toBe(false);
      expect(callMock).not.toHaveBeenCalled();
      expect(useHealthStore.getState().status).toBe("empty");
    });

    it("sends exactly the documented args", async () => {
      callMock.mockResolvedValueOnce(report());
      await useHealthStore.getState().run(MODEL_ID);
      expect(callMock).toHaveBeenCalledWith("health.run", { model_id: MODEL_ID });
    });

    it("a Model with findings is populated, NOT an error", async () => {
      callMock.mockResolvedValueOnce(report());
      await useHealthStore.getState().run(MODEL_ID);
      const s = useHealthStore.getState();
      expect(s.status).toBe("populated");
      expect(s.error).toBeNull();
      expect(s.runStatus).toBe("failed");
      expect(s.blockingCount).toBe(1);
    });

    it("a clean Model is the success state", async () => {
      callMock.mockResolvedValueOnce(report({ findings: [] }));
      await useHealthStore.getState().run(MODEL_ID);
      const s = useHealthStore.getState();
      expect(s.status).toBe("success");
      expect(s.blockingCount).toBe(0);
      expect(s.isExportBlocked()).toBe(false);
    });

    it("a transport failure clears stale findings so no orphan verdict remains", async () => {
      callMock.mockResolvedValueOnce(report());
      await useHealthStore.getState().run(MODEL_ID);
      expect(useHealthStore.getState().findings).toHaveLength(1);

      callMock.mockRejectedValueOnce({
        code: "SESSION_LOCKED",
        userMessage: "Session locked. Unlock to continue.",
        httpStatus: 401,
        retryable: false,
      });
      const ok = await useHealthStore.getState().run(MODEL_ID);
      const s = useHealthStore.getState();
      expect(ok).toBe(false);
      expect(s.status).toBe("error");
      expect(s.error?.code).toBe("SESSION_LOCKED");
      expect(s.findings).toEqual([]);
      expect(s.categories).toEqual([]);
      expect(s.blockingCount).toBe(0);
    });

    it("retry re-runs the remembered Model", async () => {
      callMock.mockResolvedValue(report());
      await useHealthStore.getState().run(MODEL_ID);
      callMock.mockClear();
      await useHealthStore.getState().retry();
      expect(callMock).toHaveBeenCalledWith("health.run", { model_id: MODEL_ID });
    });
  });

  describe("waiver (D-010)", () => {
    it("refuses a blank reason locally with the catalog code and never calls the bridge", async () => {
      callMock.mockResolvedValueOnce(report());
      await useHealthStore.getState().run(MODEL_ID);
      callMock.mockClear();

      const ok = await useHealthStore.getState().waive(FINDING_ID, "   ");
      expect(ok).toBe(false);
      expect(callMock).not.toHaveBeenCalled();
      const err = useHealthStore.getState().waiveError;
      expect(err?.code).toBe("HEALTH_WAIVER_REASON_REQUIRED");
      expect(err?.userMessage).toBe("A waiver reason is required.");
      expect(err?.httpStatus).toBe(422);
    });

    it("sends the trimmed reason and re-runs so counts come from the engine", async () => {
      callMock.mockResolvedValueOnce(report());
      await useHealthStore.getState().run(MODEL_ID);
      callMock.mockClear();

      const waived = finding({
        waiver: { reason: "Known feed defect", actor: "owner", created_at: "2026-09-05T11:00:00Z" },
      });
      callMock
        .mockResolvedValueOnce({ waived: true, finding_id: FINDING_ID, audit_id: 951 })
        .mockResolvedValueOnce(report({ findings: [waived] }));

      const ok = await useHealthStore.getState().waive(FINDING_ID, "  Known feed defect  ");
      expect(ok).toBe(true);
      expect(callMock).toHaveBeenNthCalledWith(1, "health.waive", {
        finding_id: FINDING_ID,
        reason: "Known feed defect",
      });
      expect(callMock).toHaveBeenNthCalledWith(2, "health.run", { model_id: MODEL_ID });

      const s = useHealthStore.getState();
      expect(s.blockingCount).toBe(0);
      expect(s.isExportBlocked()).toBe(false);
      // The finding is still on screen — a waiver explains, it never hides.
      expect(s.findings).toHaveLength(1);
      expect(s.findings[0].waiver?.reason).toBe("Known feed defect");
    });

    it("surfaces the engine's reason error without re-running", async () => {
      callMock.mockResolvedValueOnce(report());
      await useHealthStore.getState().run(MODEL_ID);
      callMock.mockClear();
      callMock.mockRejectedValueOnce({
        code: "HEALTH_WAIVER_REASON_REQUIRED",
        userMessage: "A waiver reason is required.",
        httpStatus: 422,
        retryable: false,
      });

      const ok = await useHealthStore.getState().waive(FINDING_ID, "x");
      expect(ok).toBe(false);
      expect(callMock).toHaveBeenCalledTimes(1);
      expect(useHealthStore.getState().waiveError?.code).toBe("HEALTH_WAIVER_REASON_REQUIRED");
      expect(useHealthStore.getState().waiveInFlight).toBe(false);
    });

    it("openWaiver tracks one finding at a time and clears the previous error", async () => {
      useHealthStore.getState().openWaiver(FINDING_ID);
      expect(useHealthStore.getState().waivingFindingId).toBe(FINDING_ID);
      useHealthStore.getState().openWaiver(null);
      expect(useHealthStore.getState().waivingFindingId).toBeNull();
      expect(useHealthStore.getState().waiveError).toBeNull();
    });
  });

  describe("selectors", () => {
    it("findingsFor filters by category without mutating the list", async () => {
      const refFinding = finding({
        id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000013",
        category: "reference",
        severity: "warn",
        entity_ref: "line:ln-1",
      });
      callMock.mockResolvedValueOnce(report({ findings: [finding(), refFinding] }));
      await useHealthStore.getState().run(MODEL_ID);
      expect(useHealthStore.getState().findingsFor("reference")).toEqual([refFinding]);
      expect(useHealthStore.getState().findings).toHaveLength(2);
    });

    it("reset clears every field", async () => {
      callMock.mockResolvedValueOnce(report());
      await useHealthStore.getState().run(MODEL_ID);
      useHealthStore.getState().reset();
      const s = useHealthStore.getState();
      expect(s).toMatchObject({
        status: "empty",
        modelId: null,
        checkId: null,
        findings: [],
        categories: [],
        blockingCount: 0,
      });
    });
  });
});

describe("parseEntityRef", () => {
  it("parses the navigable cell form", () => {
    expect(parseEntityRef("cell:ln-1:sc-1:p-01")).toEqual({
      kind: "cell",
      lineId: "ln-1",
      scenarioId: "sc-1",
      periodId: "p-01",
    });
  });

  it("parses the label-only forms the engine mints", () => {
    expect(parseEntityRef("line:ln-1")).toEqual({ kind: "line", id: "ln-1" });
    expect(parseEntityRef("driver:drv-1")).toEqual({ kind: "driver", id: "drv-1" });
    expect(parseEntityRef("assumption:as-1")).toEqual({ kind: "assumption", id: "as-1" });
    expect(parseEntityRef("period:p-01")).toEqual({ kind: "period", id: "p-01" });
    expect(parseEntityRef("batch:b-1")).toEqual({ kind: "batch", id: "b-1" });
  });

  it("returns null rather than guessing at a malformed or unknown ref", () => {
    expect(parseEntityRef(null)).toBeNull();
    expect(parseEntityRef("cell:ln-1:sc-1")).toBeNull();
    expect(parseEntityRef("cell:ln-1::p-01")).toBeNull();
    expect(parseEntityRef("line:")).toBeNull();
    expect(parseEntityRef("sheet:sh-1")).toBeNull();
    expect(parseEntityRef("")).toBeNull();
  });
});
