/**
 * S-055 FVA store — edge-state tests (M5-3 completion slice).
 *
 * Complements fva.test.ts (which owns the load lifecycle and the happy-path KPI math)
 * with the exact behaviors the page relies on at the boundaries:
 *  - no-company short-circuit and retry refusal
 *  - persisted line filter drives subsequent loads (selectedLineIds fallback)
 *  - the FVA_RESTATEMENT_FLAG degraded path: error + persistent banner + documented copy
 *  - non-restatement errors never raise the banner
 *  - KPI/BU aggregation honesty: null metrics are skipped, not zero-filled;
 *    rows without BU identity roll up under "Group / Unassigned"; sub-threshold rows
 *    stay unscored
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFvaStore, MIN_VERSIONS_REQUIRED } from "./fva";
import type { FvaScoreItem } from "@/api/schema";

const callMock = vi.fn();
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return {
    ...actual,
    call: (...args: unknown[]) => callMock(...args),
  };
});

const COMPANY_ID = "11111111-2222-4333-8444-555555555555";

function score(overrides: Partial<FvaScoreItem> = {}): FvaScoreItem {
  return {
    line_id: "ln-rev",
    line_name: "Product Revenue",
    version_count: 3,
    mape_pct: 10,
    bias_pct: 2,
    hit_rate_pct: 60,
    trend: "neutral",
    sparkline: [12, 11, 10],
    ...overrides,
  };
}

describe("S-055 FVA store edges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFvaStore.getState().reset();
  });

  it("short-circuits to the empty state when no Company is open", async () => {
    const ok = await useFvaStore.getState().loadFva();
    expect(ok).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
    expect(useFvaStore.getState().status).toBe("empty");
  });

  it("inherits the persisted line filter when a load omits params", async () => {
    useFvaStore.getState().setCompanyId(COMPANY_ID);
    useFvaStore.getState().setSelectedLineIds(["ln-rev"]);
    callMock.mockResolvedValueOnce({ scores: [score()] });

    await useFvaStore.getState().loadFva();
    expect(callMock).toHaveBeenCalledWith("fva.get", {
      company_id: COMPANY_ID,
      line_ids: ["ln-rev"],
    });
  });

  it("retry without a Company answers false without touching the bridge", async () => {
    expect(await useFvaStore.getState().retry()).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("retry reuses the persisted Company and filter", async () => {
    useFvaStore.getState().setCompanyId(COMPANY_ID);
    callMock.mockRejectedValueOnce({ code: "INTERNAL", httpStatus: 500, retryable: true });
    await useFvaStore.getState().loadFva({ lineIds: ["ln-a", "ln-b"] });
    expect(useFvaStore.getState().status).toBe("error");

    callMock.mockResolvedValueOnce({ scores: [] });
    const ok = await useFvaStore.getState().retry();
    expect(ok).toBe(true);
    expect(callMock).toHaveBeenLastCalledWith("fva.get", {
      company_id: COMPANY_ID,
      line_ids: ["ln-a", "ln-b"],
    });
  });

  it("FVA_RESTATEMENT_FLAG keeps the error and raises the persistent banner copy", async () => {
    callMock.mockRejectedValueOnce({
      code: "FVA_RESTATEMENT_FLAG",
      userMessage: "Actuals were restated for these periods — FVA recomputed; versions unchanged.",
      httpStatus: 200,
      retryable: true,
    });

    const ok = await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });
    expect(ok).toBe(false);

    const s = useFvaStore.getState();
    expect(s.status).toBe("error");
    expect(s.hasRestatementBanner).toBe(true);
    expect(s.restatementMessage).toBe(
      "Actuals were restated for these periods — FVA recomputed; versions unchanged.",
    );
    expect(s.scores).toEqual([]);
  });

  it("a restated success answer (flag without failure) still raises the banner", async () => {
    callMock.mockResolvedValueOnce({ scores: [score()], restated: true });
    await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });

    const s = useFvaStore.getState();
    expect(s.status).toBe("populated");
    expect(s.hasRestatementBanner).toBe(true);
    expect(s.restatementMessage).toBe(
      "Actuals were restated for these periods — FVA recomputed; versions unchanged.",
    );
  });

  it("non-restatement errors never raise the banner", async () => {
    callMock.mockRejectedValueOnce({
      code: "INTERNAL",
      userMessage: "An unexpected error occurred. Please try again.",
      httpStatus: 500,
      retryable: true,
    });
    await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });

    const s = useFvaStore.getState();
    expect(s.status).toBe("error");
    expect(s.hasRestatementBanner).toBe(false);
    expect(s.restatementMessage).toBeNull();
  });

  it("all-below-threshold answers land on the empty state, not populated", async () => {
    callMock.mockResolvedValueOnce({
      scores: [score({ version_count: MIN_VERSIONS_REQUIRED - 1 })],
    });
    await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });
    expect(useFvaStore.getState().status).toBe("empty");
  });

  it("an empty scores answer is a clean success state", async () => {
    callMock.mockResolvedValueOnce({ scores: [] });
    await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });
    const s = useFvaStore.getState();
    expect(s.status).toBe("success");
    expect(s.scores).toEqual([]);
    expect(s.error).toBeNull();
  });

  it("getByLineData filters the rows by the persisted line selection", () => {
    useFvaStore.setState({
      scores: [score({ line_id: "ln-a" }), score({ line_id: "ln-b" })],
      selectedLineIds: ["ln-b"],
    });
    const rows = useFvaStore.getState().getByLineData();
    expect(rows).toHaveLength(1);
    expect(rows[0].line_id).toBe("ln-b");
  });

  it("KPI aggregation skips null metrics instead of zero-filling", () => {
    useFvaStore.setState({
      scores: [score({ mape_pct: null, bias_pct: null, hit_rate_pct: null })],
      selectedLineIds: [],
    });
    const kpis = useFvaStore.getState().getKpiAggregate();
    expect(kpis.overallMapePct).toBeNull();
    expect(kpis.overallBiasPct).toBeNull();
    expect(kpis.overallHitRatePct).toBeNull();
    expect(kpis.scoredLineCount).toBe(1);
    expect(kpis.unscoredLineCount).toBe(0);
  });

  it("rows without BU identity roll up under Group / Unassigned", () => {
    useFvaStore.setState({
      scores: [score({ business_unit_id: undefined, business_unit_name: undefined })],
      selectedLineIds: [],
    });
    const rollups = useFvaStore.getState().getBuRollupStrip();
    expect(rollups).toHaveLength(1);
    expect(rollups[0].businessUnitId).toBe("group");
    expect(rollups[0].businessUnitName).toBe("Group / Unassigned");
    expect(rollups[0].overallMapePct).toBe(10);
  });

  it("a BU bucket whose rows are all below threshold reports null metrics", () => {
    useFvaStore.setState({
      scores: [
        score({
          line_id: "ln-low",
          version_count: 2,
          business_unit_id: "bu-eu",
          business_unit_name: "Europe",
        }),
      ],
      selectedLineIds: [],
    });
    const rollups = useFvaStore.getState().getBuRollupStrip();
    expect(rollups).toHaveLength(1);
    expect(rollups[0].lineCount).toBe(1);
    expect(rollups[0].overallMapePct).toBeNull();
    expect(rollups[0].overallBiasPct).toBeNull();
    expect(rollups[0].overallHitRatePct).toBeNull();
  });
});
