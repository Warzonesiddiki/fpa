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

function mockFvaScore(overrides: Partial<FvaScoreItem> = {}): FvaScoreItem {
  return {
    line_id: "ln-rev",
    line_name: "Product Revenue",
    business_unit_id: "bu-na",
    business_unit_name: "North America",
    version_count: 4,
    mape_pct: 6.4,
    bias_pct: 1.8,
    hit_rate_pct: 71.0,
    trend: "improving",
    sparkline: [8.2, 7.5, 6.9, 6.4],
    ...overrides,
  };
}

describe("S-055 FVA Store (useFvaStore)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFvaStore.getState().reset();
  });

  /* ── 1. Initial State & Configuration ─────────────────────────── */
  it("initializes with empty state and default selectors", () => {
    const s = useFvaStore.getState();
    expect(s.status).toBe("empty");
    expect(s.error).toBeNull();
    expect(s.scores).toEqual([]);
    expect(s.companyId).toBeNull();
    expect(s.selectedHorizon).toBe("6m");
    expect(s.selectedVersionSet).toBe("latest_3");
    expect(s.selectedLineIds).toEqual([]);
    expect(s.hasRestatementBanner).toBe(false);
    expect(s.restatementMessage).toBeNull();
    expect(MIN_VERSIONS_REQUIRED).toBe(3);
  });

  it("updates horizon, version set, company ID, and line filter", () => {
    const store = useFvaStore.getState();
    store.setCompanyId(COMPANY_ID);
    store.setHorizon("1y");
    store.setVersionSet("h1_budget_vs_forecasts");
    store.setSelectedLineIds(["ln-rev", "ln-cogs"]);

    const s = useFvaStore.getState();
    expect(s.companyId).toBe(COMPANY_ID);
    expect(s.selectedHorizon).toBe("1y");
    expect(s.selectedVersionSet).toBe("h1_budget_vs_forecasts");
    expect(s.selectedLineIds).toEqual(["ln-rev", "ln-cogs"]);
  });

  /* ── 2. Five Canonical States ─────────────────────────────────── */

  // State 1: loading
  it("transitions to loading state while fetching FVA data", async () => {
    let pendingResolve: (val: unknown) => void;
    callMock.mockReturnValueOnce(
      new Promise((resolve) => {
        pendingResolve = resolve;
      }),
    );

    const loadPromise = useFvaStore.getState().loadFva({ companyId: COMPANY_ID });
    expect(useFvaStore.getState().status).toBe("loading");
    expect(useFvaStore.getState().error).toBeNull();

    pendingResolve!({ scores: [mockFvaScore()] });
    await loadPromise;

    expect(useFvaStore.getState().status).toBe("populated");
  });

  // State 2: empty (when line has < 3 versions)
  it("transitions to empty state when all returned lines have < 3 versions", async () => {
    const unqualifyingRows: FvaScoreItem[] = [
      mockFvaScore({
        line_id: "ln-1",
        version_count: 2,
        mape_pct: null,
        bias_pct: null,
        hit_rate_pct: null,
      }),
      mockFvaScore({
        line_id: "ln-2",
        version_count: 1,
        mape_pct: null,
        bias_pct: null,
        hit_rate_pct: null,
      }),
    ];
    callMock.mockResolvedValueOnce({
      scores: unqualifyingRows,
      restated: false,
    });

    const ok = await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });
    expect(ok).toBe(true);

    const s = useFvaStore.getState();
    expect(s.status).toBe("empty");
    expect(s.scores).toHaveLength(2);
    expect(s.error).toBeNull();
  });

  it("remains in empty state when loadFva is called without companyId", async () => {
    const ok = await useFvaStore.getState().loadFva({ companyId: undefined });
    expect(ok).toBe(false);
    expect(useFvaStore.getState().status).toBe("empty");
    expect(callMock).not.toHaveBeenCalled();
  });

  // State 3: success (when query executes cleanly with empty result set)
  it("transitions to success state when query returns empty scores array", async () => {
    callMock.mockResolvedValueOnce({
      scores: [],
      restated: false,
    });

    const ok = await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });
    expect(ok).toBe(true);

    const s = useFvaStore.getState();
    expect(s.status).toBe("success");
    expect(s.scores).toEqual([]);
    expect(s.error).toBeNull();
  });

  // State 4: populated (when line has >= 3 versions)
  it("transitions to populated state when qualifying lines (>= 3 versions) exist", async () => {
    const scores: FvaScoreItem[] = [
      mockFvaScore({ line_id: "ln-1", version_count: 3 }),
      mockFvaScore({ line_id: "ln-2", version_count: 2, mape_pct: null }),
    ];
    callMock.mockResolvedValueOnce({
      scores,
      restated: false,
    });

    const ok = await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });
    expect(ok).toBe(true);

    const s = useFvaStore.getState();
    expect(s.status).toBe("populated");
    expect(s.scores).toHaveLength(2);
    expect(s.error).toBeNull();
  });

  // State 5: error (typed error mapped via toBridgeError)
  it("transitions to error state and maps error via toBridgeError", async () => {
    callMock.mockRejectedValueOnce({
      code: "VALUE_INVALID",
      userMessage: "Invalid company ID for FVA query.",
      httpStatus: 422,
      retryable: false,
    });

    const ok = await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });
    expect(ok).toBe(false);

    const s = useFvaStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toEqual({
      code: "VALUE_INVALID",
      userMessage: "Invalid company ID for FVA query.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    expect(s.scores).toEqual([]);
  });

  /* ── 3. Persistent Banner for FVA_RESTATEMENT_FLAG ─────────────── */
  it("sets persistent banner state when FVA_RESTATEMENT_FLAG error occurs", async () => {
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
    expect(s.error?.code).toBe("FVA_RESTATEMENT_FLAG");
    expect(s.hasRestatementBanner).toBe(true);
    expect(s.restatementMessage).toBe(
      "Actuals were restated for these periods — FVA recomputed; versions unchanged.",
    );
  });

  it("sets persistent banner state when response payload includes restated: true", async () => {
    callMock.mockResolvedValueOnce({
      scores: [mockFvaScore({ version_count: 5 })],
      restated: true,
    });

    const ok = await useFvaStore.getState().loadFva({ companyId: COMPANY_ID });
    expect(ok).toBe(true);

    const s = useFvaStore.getState();
    expect(s.status).toBe("populated");
    expect(s.hasRestatementBanner).toBe(true);
    expect(s.restatementMessage).toContain("Actuals were restated");
  });

  /* ── 4. Retry & Reset ─────────────────────────────────────────── */
  it("retries previous loadFva query correctly", async () => {
    callMock.mockRejectedValueOnce({
      code: "INTERNAL",
      userMessage: "Database busy",
      httpStatus: 500,
      retryable: true,
    });

    await useFvaStore.getState().loadFva({ companyId: COMPANY_ID, lineIds: ["ln-rev"] });
    expect(useFvaStore.getState().status).toBe("error");

    callMock.mockResolvedValueOnce({
      scores: [mockFvaScore({ version_count: 4 })],
      restated: false,
    });

    const retryOk = await useFvaStore.getState().retry();
    expect(retryOk).toBe(true);

    const s = useFvaStore.getState();
    expect(s.status).toBe("populated");
    expect(s.scores).toHaveLength(1);
    expect(s.error).toBeNull();
  });

  it("clearError clears error without resetting other state", () => {
    useFvaStore.setState({
      error: {
        code: "ERR",
        userMessage: "test",
        httpStatus: 500,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
    });
    useFvaStore.getState().clearError();
    expect(useFvaStore.getState().error).toBeNull();
  });

  it("reset resets all state to default", () => {
    useFvaStore.setState({
      status: "populated",
      hasRestatementBanner: true,
      restatementMessage: "Restated",
      companyId: COMPANY_ID,
      selectedHorizon: "1y",
      selectedVersionSet: "v1_v2",
      selectedLineIds: ["ln-1"],
      scores: [mockFvaScore()],
    });

    useFvaStore.getState().reset();
    const s = useFvaStore.getState();
    expect(s.status).toBe("empty");
    expect(s.hasRestatementBanner).toBe(false);
    expect(s.restatementMessage).toBeNull();
    expect(s.companyId).toBeNull();
    expect(s.scores).toEqual([]);
  });

  /* ── 5. Selectors: By-Line, KPI Aggregate, BU Rollup Strip ─────── */
  describe("Selectors", () => {
    const sampleScores: FvaScoreItem[] = [
      mockFvaScore({
        line_id: "ln-rev-prod",
        line_name: "Product Revenue",
        business_unit_id: "bu-na",
        business_unit_name: "North America",
        version_count: 4,
        mape_pct: 6.4,
        bias_pct: 1.8,
        hit_rate_pct: 71.0,
      }),
      mockFvaScore({
        line_id: "ln-rev-serv",
        line_name: "Services Revenue",
        business_unit_id: "bu-na",
        business_unit_name: "North America",
        version_count: 5,
        mape_pct: 4.2,
        bias_pct: -0.6,
        hit_rate_pct: 85.0,
      }),
      mockFvaScore({
        line_id: "ln-cogs-eu",
        line_name: "Direct Labor EU",
        business_unit_id: "bu-eu",
        business_unit_name: "Europe",
        version_count: 3,
        mape_pct: 10.0,
        bias_pct: 3.0,
        hit_rate_pct: 60.0,
      }),
      mockFvaScore({
        line_id: "ln-new-line",
        line_name: "New Product Line",
        business_unit_id: "bu-eu",
        business_unit_name: "Europe",
        version_count: 2, // < 3 versions: unscored
        mape_pct: null,
        bias_pct: null,
        hit_rate_pct: null,
      }),
    ];

    beforeEach(() => {
      useFvaStore.setState({
        status: "populated",
        scores: sampleScores,
        selectedLineIds: [],
      });
    });

    it("getByLineData returns all lines when selectedLineIds is empty", () => {
      const data = useFvaStore.getState().getByLineData();
      expect(data).toHaveLength(4);
    });

    it("getByLineData filters rows when selectedLineIds is non-empty", () => {
      useFvaStore.getState().setSelectedLineIds(["ln-rev-prod", "ln-cogs-eu"]);
      const data = useFvaStore.getState().getByLineData();
      expect(data).toHaveLength(2);
      expect(data.map((d) => d.line_id)).toEqual(["ln-rev-prod", "ln-cogs-eu"]);
    });

    it("getKpiAggregate computes overall MAPE, Bias, and Hit Rate only across scored lines (>=3 versions)", () => {
      const kpis = useFvaStore.getState().getKpiAggregate();
      expect(kpis.scoredLineCount).toBe(3);
      expect(kpis.unscoredLineCount).toBe(1);

      // MAPE: (6.4 + 4.2 + 10.0) / 3 = 20.6 / 3 = 6.87
      expect(kpis.overallMapePct).toBe(6.87);

      // Bias: (1.8 - 0.6 + 3.0) / 3 = 4.2 / 3 = 1.4
      expect(kpis.overallBiasPct).toBe(1.4);

      // Hit Rate: (71 + 85 + 60) / 3 = 216 / 3 = 72
      expect(kpis.overallHitRatePct).toBe(72);
    });

    it("getKpiAggregate returns nulls when no qualifying lines exist", () => {
      useFvaStore.setState({
        scores: [
          mockFvaScore({
            line_id: "ln-1",
            version_count: 2,
            mape_pct: null,
            bias_pct: null,
            hit_rate_pct: null,
          }),
        ],
      });

      const kpis = useFvaStore.getState().getKpiAggregate();
      expect(kpis.overallMapePct).toBeNull();
      expect(kpis.overallBiasPct).toBeNull();
      expect(kpis.overallHitRatePct).toBeNull();
      expect(kpis.scoredLineCount).toBe(0);
      expect(kpis.unscoredLineCount).toBe(1);
    });

    it("getBuRollupStrip calculates BU group rollups accurately", () => {
      const rollups = useFvaStore.getState().getBuRollupStrip();
      expect(rollups).toHaveLength(2);

      // Sorted alphabetically by BU name: Europe first, then North America
      const [eu, na] = rollups;

      expect(eu.businessUnitId).toBe("bu-eu");
      expect(eu.businessUnitName).toBe("Europe");
      expect(eu.lineCount).toBe(2);
      expect(eu.overallMapePct).toBe(10.0);
      expect(eu.overallBiasPct).toBe(3.0);
      expect(eu.overallHitRatePct).toBe(60.0);

      expect(na.businessUnitId).toBe("bu-na");
      expect(na.businessUnitName).toBe("North America");
      expect(na.lineCount).toBe(2);
      // NA MAPE: (6.4 + 4.2) / 2 = 5.3
      expect(na.overallMapePct).toBe(5.3);
      // NA Bias: (1.8 - 0.6) / 2 = 0.6
      expect(na.overallBiasPct).toBe(0.6);
      // NA Hit Rate: (71 + 85) / 2 = 78
      expect(na.overallHitRatePct).toBe(78);
    });
  });
});
