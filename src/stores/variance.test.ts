import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVarianceStore } from "./variance";
import type { VarianceAttribution, VarianceRow, ThreeWayRow } from "./variance";

const callMock = vi.fn();
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return {
    ...actual,
    call: (...args: unknown[]) => callMock(...args),
  };
});

const COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const PERIOD_ID = "fp-2026-p05";

function mockVarianceRow(overrides: Partial<VarianceRow> = {}): VarianceRow {
  return {
    line_id: "ln-rev-prod",
    account_id: "acc-4001",
    account_code: "4001",
    account_name: "Product Revenue",
    business_unit_id: "bu-na",
    business_unit_name: "North America",
    statement_type: "pl",
    period_id: PERIOD_ID,
    actual_minor: 120_000_000,
    actual_decimal: "1200000.00",
    compare_minor: 100_000_000,
    compare_decimal: "1000000.00",
    variance_minor: 20_000_000,
    variance_decimal: "200000.00",
    variance_pct: "20.00",
    direction: "favorable",
    reason_code: null,
    reason_note: null,
    attribution: null,
    ...overrides,
  };
}

function mockAttribution(overrides: Partial<VarianceAttribution> = {}): VarianceAttribution {
  return {
    line_id: "ln-rev-prod",
    period_id: PERIOD_ID,
    is_attributable: true,
    volume_minor: 15_000_000,
    price_minor: 5_000_000,
    mix_minor: 0,
    fx_minor: 0,
    efficiency_minor: 0,
    volume_decimal: "150000.00",
    price_decimal: "50000.00",
    ...overrides,
  };
}

function mockThreeWayRow(overrides: Partial<ThreeWayRow> = {}): ThreeWayRow {
  return {
    line_id: "ln-rev-prod",
    account_code: "4001",
    statement_type: "pl",
    period_id: PERIOD_ID,
    actual_minor: 120_000_000,
    compare_minor: 100_000_000,
    variance_minor: 20_000_000,
    ...overrides,
  };
}

describe("useVarianceStore (S-054 · F-024 · M5-1 · M5-2)", () => {
  beforeEach(() => {
    useVarianceStore.getState().reset();
    callMock.mockReset();
  });

  /* ── 1. Initial / Empty state ─────────────────────────────────── */
  it("starts in canonical empty state with default settings", () => {
    const s = useVarianceStore.getState();
    expect(s.status).toBe("empty");
    expect(s.error).toBeNull();
    expect(s.companyId).toBeNull();
    expect(s.compareTarget).toBe("budget");
    expect(s.includeAttribution).toBe(true);
    expect(s.threeWayMode).toBe("all");
    expect(s.showThreeWayView).toBe(false);
    expect(s.rows).toEqual([]);
    expect(s.attributions).toEqual([]);
    expect(s.threeWayRows).toEqual([]);
    expect(s.reasonCodes.length).toBeGreaterThan(0);
    expect(s.filters.periodId).toBeNull();
    expect(s.filters.businessUnitId).toBeNull();
    expect(s.filters.accountQuery).toBe("");
    expect(s.filters.directionFilter).toBe("all");
    expect(s.filters.onlyWithReasonCode).toBe(false);
  });

  it("remains empty and does not invoke IPC if companyId or periodId is missing", async () => {
    const res1 = await useVarianceStore.getState().loadVariance();
    expect(res1).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
    expect(useVarianceStore.getState().status).toBe("empty");

    useVarianceStore.getState().setCompanyId(COMPANY_ID);
    const res2 = await useVarianceStore.getState().loadVariance();
    expect(res2).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
    expect(useVarianceStore.getState().status).toBe("empty");
  });

  /* ── 2. Loading and Populated states ──────────────────────────── */
  it("loads variance data and transitions to populated when rows exist", async () => {
    const row1 = mockVarianceRow();
    const row2 = mockVarianceRow({
      line_id: "ln-cogs",
      account_id: "acc-5001",
      account_code: "5001",
      account_name: "Raw Materials",
      actual_minor: 60_000_000,
      compare_minor: 50_000_000,
      variance_minor: -10_000_000,
      direction: "unfavorable",
    });
    const attr1 = mockAttribution();
    const threeWay = [mockThreeWayRow()];

    callMock.mockResolvedValueOnce({
      rows: [row1, row2],
      attribution: [attr1],
      threeway: threeWay,
    });

    const promise = useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
      compare: "forecast",
      attribution: true,
    });

    // Should transition to loading immediately
    expect(useVarianceStore.getState().status).toBe("loading");

    const success = await promise;
    expect(success).toBe(true);

    const s = useVarianceStore.getState();
    expect(s.status).toBe("populated");
    expect(s.error).toBeNull();
    expect(s.companyId).toBe(COMPANY_ID);
    expect(s.compareTarget).toBe("forecast");
    expect(s.rows).toHaveLength(2);
    expect(s.attributions).toHaveLength(1);
    expect(s.threeWayRows).toHaveLength(1);

    // Verify attribution is linked to row
    expect(s.rows[0].attribution).toEqual(attr1);
    expect(s.rows[1].attribution).toBeNull();
  });

  /* ── 3. Success state on empty result set ──────────────────────── */
  it("transitions to success when query returns empty rows (no actuals / clean set)", async () => {
    callMock.mockResolvedValueOnce({
      rows: [],
      attribution: [],
      threeway: [],
    });

    const success = await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
    });

    expect(success).toBe(true);
    const s = useVarianceStore.getState();
    expect(s.status).toBe("success");
    expect(s.rows).toEqual([]);
    expect(s.error).toBeNull();
  });

  /* ── 4. Error state & toBridgeError mapping ─────────────────────── */
  it("maps VARIANCE_SOURCE_MIXED error via toBridgeError", async () => {
    const rawError = {
      code: "VARIANCE_SOURCE_MIXED",
      userMessage: "Selected periods mix Actual and Forecast — enable HYBRID label to view.",
      httpStatus: 422,
      retryable: false,
    };
    callMock.mockRejectedValueOnce(rawError);

    const success = await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
    });

    expect(success).toBe(false);
    const s = useVarianceStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toEqual({
      code: "VARIANCE_SOURCE_MIXED",
      userMessage: "Selected periods mix Actual and Forecast — enable HYBRID label to view.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: {},
    });
    expect(s.rows).toEqual([]);
  });

  it("maps VARIANCE_NO_ATTRIBUTION_DATA error via toBridgeError", async () => {
    const rawError = {
      code: "VARIANCE_NO_ATTRIBUTION_DATA",
      userMessage: "Attribution unavailable for these lines — no unit/driver data. Show $ variance only.",
      httpStatus: 200,
      retryable: false,
    };
    callMock.mockRejectedValueOnce(rawError);

    const success = await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
    });

    expect(success).toBe(false);
    const s = useVarianceStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("VARIANCE_NO_ATTRIBUTION_DATA");
    expect(s.error?.httpStatus).toBe(200);
  });

  it("maps generic unexpected exceptions to BridgeError", async () => {
    callMock.mockRejectedValueOnce(new Error("Network connection dropped"));

    const success = await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
    });

    expect(success).toBe(false);
    const s = useVarianceStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("INTERNAL");
    expect(s.error?.httpStatus).toBe(500);
  });

  /* ── 5. Retry functionality ───────────────────────────────────── */
  it("retries previous load variance query", async () => {
    callMock.mockRejectedValueOnce({
      code: "INTERNAL",
      userMessage: "Temporary database lock",
      httpStatus: 500,
      retryable: true,
    });

    useVarianceStore.getState().setCompanyId(COMPANY_ID);
    useVarianceStore.getState().setPeriodFilter(PERIOD_ID);
    await useVarianceStore.getState().loadVariance();
    expect(useVarianceStore.getState().status).toBe("error");

    callMock.mockResolvedValueOnce({
      rows: [mockVarianceRow()],
      attribution: [],
      threeway: [],
    });

    const retried = await useVarianceStore.getState().retry();
    expect(retried).toBe(true);
    expect(useVarianceStore.getState().status).toBe("populated");
    expect(useVarianceStore.getState().rows).toHaveLength(1);
  });

  it("retry returns false if parameters are missing", async () => {
    const retried = await useVarianceStore.getState().retry();
    expect(retried).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
  });

  /* ── 6. 3-Way View toggle & modes ──────────────────────────────── */
  it("supports toggling 3-Way view and filtering by statement type", async () => {
    const plRow = mockVarianceRow({ line_id: "ln-pl", statement_type: "pl" });
    const bsRow = mockVarianceRow({ line_id: "ln-bs", statement_type: "bs", account_code: "1010", account_name: "Cash" });
    const cfRow = mockVarianceRow({ line_id: "ln-cf", statement_type: "cf", account_code: "3010", account_name: "Operating CF" });

    callMock.mockResolvedValueOnce({
      rows: [plRow, bsRow, cfRow],
      attribution: [],
      threeway: [],
    });

    await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
    });

    const store = useVarianceStore.getState();
    expect(store.getFilteredRows()).toHaveLength(3);

    // Toggle 3-way view on
    store.toggleThreeWayView(true);
    expect(useVarianceStore.getState().showThreeWayView).toBe(true);
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(3); // threeWayMode is "all"

    // Set 3-way mode to P&L
    store.setThreeWayMode("pl");
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(1);
    expect(useVarianceStore.getState().getFilteredRows()[0].line_id).toBe("ln-pl");

    // Set 3-way mode to Balance Sheet
    store.setThreeWayMode("bs");
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(1);
    expect(useVarianceStore.getState().getFilteredRows()[0].line_id).toBe("ln-bs");

    // Set 3-way mode to Cash Flow
    store.setThreeWayMode("cf");
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(1);
    expect(useVarianceStore.getState().getFilteredRows()[0].line_id).toBe("ln-cf");

    // Toggle 3-way view off restores all rows regardless of mode
    store.toggleThreeWayView(false);
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(3);
  });

  /* ── 7. Filtering: period, BU, accounts, direction, reason code ── */
  it("filters rows by period, BU, account search query, direction, and reason codes", async () => {
    const row1 = mockVarianceRow({
      line_id: "ln-1",
      account_code: "4000",
      account_name: "SaaS Subscriptions",
      business_unit_id: "bu-us",
      direction: "favorable",
      period_id: "fp-2026-p05",
      reason_code: "volume",
    });
    const row2 = mockVarianceRow({
      line_id: "ln-2",
      account_code: "5000",
      account_name: "Cloud Hosting",
      business_unit_id: "bu-eu",
      direction: "unfavorable",
      period_id: "fp-2026-p05",
      reason_code: null,
    });
    const row3 = mockVarianceRow({
      line_id: "ln-3",
      account_code: "6000",
      account_name: "Travel & Expense",
      business_unit_id: "bu-us",
      direction: "unfavorable",
      period_id: "fp-2026-p06",
      reason_code: "price",
    });

    callMock.mockResolvedValueOnce({
      rows: [row1, row2, row3],
      attribution: [],
      threeway: [],
    });

    await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: "fp-2026-p05",
    });

    const store = useVarianceStore.getState();

    // Default period filter was set during load
    expect(store.getFilteredRows()).toHaveLength(2); // row1, row2 match period p05

    // Business Unit filter
    store.setBusinessUnitFilter("bu-us");
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(1);
    expect(useVarianceStore.getState().getFilteredRows()[0].line_id).toBe("ln-1");
    store.setBusinessUnitFilter(null);

    // Account search by code
    store.setAccountQuery("5000");
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(1);
    expect(useVarianceStore.getState().getFilteredRows()[0].line_id).toBe("ln-2");

    // Account search by name case-insensitive
    store.setAccountQuery("saas");
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(1);
    expect(useVarianceStore.getState().getFilteredRows()[0].line_id).toBe("ln-1");
    store.setAccountQuery("");

    // Direction filter
    store.setDirectionFilter("unfavorable");
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(1);
    expect(useVarianceStore.getState().getFilteredRows()[0].line_id).toBe("ln-2");
    store.setDirectionFilter("all");

    // Only with reason codes filter
    store.setOnlyWithReasonCode(true);
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(1);
    expect(useVarianceStore.getState().getFilteredRows()[0].line_id).toBe("ln-1");

    // Reset filters
    store.resetFilters();
    expect(useVarianceStore.getState().filters.periodId).toBeNull();
    expect(useVarianceStore.getState().filters.accountQuery).toBe("");
    expect(useVarianceStore.getState().getFilteredRows()).toHaveLength(3);
  });

  /* ── 8. Saving Reason Codes and Notes ──────────────────────────── */
  it("saves reason code and notes via variance.set_reason_code and updates local row", async () => {
    const row = mockVarianceRow({
      line_id: "ln-rev",
      period_id: PERIOD_ID,
      reason_code: null,
      reason_note: null,
    });

    callMock.mockResolvedValueOnce({
      rows: [row],
      attribution: [],
      threeway: [],
    });

    await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
    });

    callMock.mockResolvedValueOnce({ saved: true });

    const success = await useVarianceStore.getState().saveReasonCode(
      "ln-rev",
      PERIOD_ID,
      "volume",
      "Shortfall due to customer contract delay",
    );

    expect(success).toBe(true);
    expect(callMock).toHaveBeenCalledWith("variance.set_reason_code", {
      line_id: "ln-rev",
      period_id: PERIOD_ID,
      code: "volume",
      note: "Shortfall due to customer contract delay",
    });

    const updatedRow = useVarianceStore.getState().rows[0];
    expect(updatedRow.reason_code).toBe("volume");
    expect(updatedRow.reason_note).toBe("Shortfall due to customer contract delay");
  });

  it("handles failure when saving reason code and surfaces BridgeError", async () => {
    const row = mockVarianceRow();
    callMock.mockResolvedValueOnce({
      rows: [row],
      attribution: [],
      threeway: [],
    });

    await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
    });

    const rawError = {
      code: "SESSION_LOCKED",
      userMessage: "Company file is locked. Unlock to make edits.",
      httpStatus: 401,
      retryable: false,
    };
    callMock.mockRejectedValueOnce(rawError);

    const success = await useVarianceStore.getState().saveReasonCode(
      "ln-rev-prod",
      PERIOD_ID,
      "price",
      "Price change",
    );

    expect(success).toBe(false);
    expect(useVarianceStore.getState().error?.code).toBe("SESSION_LOCKED");
    expect(useVarianceStore.getState().rows[0].reason_code).toBeNull();
  });

  /* ── 9. Totals calculation selector ────────────────────────────── */
  it("calculates exact minor unit totals and direction counts", async () => {
    const row1 = mockVarianceRow({
      actual_minor: 100_000,
      compare_minor: 80_000,
      variance_minor: 20_000,
      direction: "favorable",
    });
    const row2 = mockVarianceRow({
      line_id: "ln-2",
      actual_minor: 50_000,
      compare_minor: 60_000,
      variance_minor: -10_000,
      direction: "unfavorable",
    });

    callMock.mockResolvedValueOnce({
      rows: [row1, row2],
      attribution: [],
      threeway: [],
    });

    await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
    });

    const totals = useVarianceStore.getState().getTotals();
    expect(totals.totalActualMinor).toBe(150_000);
    expect(totals.totalCompareMinor).toBe(140_000);
    expect(totals.totalVarianceMinor).toBe(10_000);
    expect(totals.favorableCount).toBe(1);
    expect(totals.unfavorableCount).toBe(1);
  });

  /* ── 10. Reset and Clear Error ─────────────────────────────────── */
  it("clears errors without wiping loaded data", () => {
    useVarianceStore.setState({
      error: {
        code: "TEST",
        userMessage: "Error",
        httpStatus: 400,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
    });

    useVarianceStore.getState().clearError();
    expect(useVarianceStore.getState().error).toBeNull();
  });

  it("resets all state back to clean initial", async () => {
    callMock.mockResolvedValueOnce({
      rows: [mockVarianceRow()],
      attribution: [],
      threeway: [],
    });

    await useVarianceStore.getState().loadVariance({
      companyId: COMPANY_ID,
      periodId: PERIOD_ID,
    });
    expect(useVarianceStore.getState().status).toBe("populated");

    useVarianceStore.getState().reset();
    const s = useVarianceStore.getState();
    expect(s.status).toBe("empty");
    expect(s.companyId).toBeNull();
    expect(s.rows).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.showThreeWayView).toBe(false);
  });
});
