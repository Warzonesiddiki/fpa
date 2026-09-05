/**
 * S-060 Statement store tests (F-027 · M6-1).
 *
 * Covers the full contract of `src/stores/statements.ts`:
 *  - defaults + setters (company, type, period scope, preset, rounding, BU scope, currency)
 *  - loadStatement: no-company short-circuit, loading → populated/success transitions,
 *    exact `statement.get.v1` args (the audited read contract), tie-out fail surfaces
 *  - typed error mapping (STATEMENT_TIE_OUT_FAILED 422 non-retryable) + retry
 *  - reset + selectors
 * The bridge `call` is mocked — the mock envelope contract is asserted in
 * `src/api/statements.test.ts`, never here (one owner per concern).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStatementStore } from "./statements";

const callMock = vi.fn();
vi.mock("@/api/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/bridge")>();
  return {
    ...actual,
    call: (...args: unknown[]) => callMock(...args),
  };
});

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const PERIOD = "3f9f2c9e-9f8b-4e2d-9a1c-200000000001";

const PL_DATA = {
  rows: [
    {
      section: "Revenue",
      lines: [{ account_id: "a-rev", label: "Sales Revenue", values: { [PERIOD]: 1000000 } }],
    },
  ],
  totals: {
    revenue: 1000000,
    gross_profit: 400000,
    operating_income: 200000,
    net_income: 200000,
    total_assets: null,
    total_liabilities: null,
    total_equity: null,
    net_cash_change: null,
    ending_cash: null,
  },
  tieout_status: "pass",
  rounding_status: "exact",
  findings: [],
  currency: "USD",
};

describe("S-060 Statement store (useStatementStore)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStatementStore.getState().reset();
  });

  it("starts in the empty state with the P&L defaults", () => {
    const s = useStatementStore.getState();
    expect(s.status).toBe("empty");
    expect(s.error).toBeNull();
    expect(s.companyId).toBeNull();
    expect(s.type).toBe("pl");
    expect(s.periodScope).toEqual([]);
    expect(s.preset).toBe("us_gaap");
    expect(s.rounding).toEqual({ mode: "thousands", largest_remainder: true });
    expect(s.buScope).toEqual({ kind: "all", bu_id: null });
    expect(s.currency).toBeNull();
    expect(s.rows).toEqual([]);
    expect(s.totals).toBeNull();
    expect(s.tieoutStatus).toBeNull();
    expect(s.roundingStatus).toBeNull();
    expect(s.findings).toEqual([]);
  });

  it("updates scope, config and currency through the setters", () => {
    const st = useStatementStore.getState();
    st.setCompanyId(COMPANY_ID);
    st.setType("bs");
    st.setPeriodScope([PERIOD]);
    st.setPreset("ifrs");
    st.setRounding({ mode: "two_decimals", largest_remainder: false });
    st.setBuScope({ kind: "single", bu_id: "bu-1" });
    st.setCurrency("EUR");

    const s = useStatementStore.getState();
    expect(s.companyId).toBe(COMPANY_ID);
    expect(s.type).toBe("bs");
    expect(s.periodScope).toEqual([PERIOD]);
    expect(s.preset).toBe("ifrs");
    expect(s.rounding).toEqual({ mode: "two_decimals", largest_remainder: false });
    expect(s.buScope).toEqual({ kind: "single", bu_id: "bu-1" });
    expect(s.currency).toBe("EUR");
  });

  it("loadStatement without a Company goes to the empty state without calling the bridge", async () => {
    const ok = await useStatementStore.getState().loadStatement();
    expect(ok).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
    const s = useStatementStore.getState();
    expect(s.status).toBe("empty");
    expect(s.rows).toEqual([]);
    expect(s.currency).toBeNull();
  });

  it("passes the full API-SPEC §6 args to statement.get.v1 and lands populated", async () => {
    callMock.mockResolvedValueOnce(PL_DATA);

    const ok = await useStatementStore
      .getState()
      .loadStatement({ companyId: COMPANY_ID, periodScope: [PERIOD] });
    expect(ok).toBe(true);

    expect(callMock).toHaveBeenCalledWith("statement.get.v1", {
      company_id: COMPANY_ID,
      type: "pl",
      period_scope: [PERIOD],
      preset: "us_gaap",
      rounding: { mode: "thousands", largest_remainder: true },
      bu_scope: { kind: "all", bu_id: null },
    });

    const s = useStatementStore.getState();
    expect(s.status).toBe("populated");
    expect(s.rows).toEqual(PL_DATA.rows);
    expect(s.totals?.revenue).toBe(1000000);
    expect(s.tieoutStatus).toBe("pass");
    expect(s.roundingStatus).toBe("exact");
    expect(s.currency).toBe("USD");
    expect(s.error).toBeNull();
  });

  it("transitions through loading while the command is in flight", async () => {
    let resolveLoad: (v: unknown) => void = () => {};
    callMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const pending = useStatementStore.getState().loadStatement({ companyId: COMPANY_ID });
    expect(useStatementStore.getState().status).toBe("loading");

    resolveLoad({ ...PL_DATA, rows: [] });
    await pending;
    // Empty rows stay on the success state (the screen renders the empty affordance).
    expect(useStatementStore.getState().status).toBe("success");
  });

  it("surfaces a failing tie-out as findings + fail status on populated rows", async () => {
    callMock.mockResolvedValueOnce({
      ...PL_DATA,
      tieout_status: "fail",
      findings: [
        {
          code: "STATEMENT_TIE_OUT_FAILED",
          message: "statement does not tie",
          detail: "assets 1 + liabilities 2 + equity 4 != 0",
        },
      ],
    });

    await useStatementStore.getState().loadStatement({ companyId: COMPANY_ID, type: "bs" });
    const s = useStatementStore.getState();
    expect(s.status).toBe("populated");
    expect(s.tieoutStatus).toBe("fail");
    expect(s.findings).toHaveLength(1);
    expect(s.findings[0].detail).toContain("!= 0");
  });

  it("keeps an empty failing statement on the success state (the screen shows findings)", async () => {
    callMock.mockResolvedValueOnce({
      rows: [],
      totals: {
        revenue: null,
        gross_profit: null,
        operating_income: null,
        net_income: null,
        total_assets: null,
        total_liabilities: null,
        total_equity: null,
        net_cash_change: null,
        ending_cash: null,
      },
      tieout_status: "fail",
      rounding_status: "exact",
      findings: [{ code: "STATEMENT_TIE_OUT_FAILED", message: "no committed GL", detail: "" }],
      currency: "USD",
    });

    const ok = await useStatementStore.getState().loadStatement({ companyId: COMPANY_ID });
    expect(ok).toBe(true);
    const s = useStatementStore.getState();
    expect(s.status).toBe("success");
    expect(s.tieoutStatus).toBe("fail");
    expect(s.findings).toHaveLength(1);
  });

  it("nulls the store currency when the response omits it (never a guess)", async () => {
    const noCurrency: Record<string, unknown> = { ...PL_DATA };
    delete noCurrency.currency;
    callMock.mockResolvedValueOnce(noCurrency);

    await useStatementStore.getState().loadStatement({ companyId: COMPANY_ID });
    expect(useStatementStore.getState().currency).toBeNull();
  });

  it("maps bridge rejections to the typed error state and clears stale rows", async () => {
    useStatementStore.setState({ rows: PL_DATA.rows, totals: PL_DATA.totals });
    callMock.mockRejectedValueOnce({
      code: "STATEMENT_TIE_OUT_FAILED",
      userMessage:
        "Statement does not tie (Assets ≠ Liabilities + Equity). Export blocked — fix findings first.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: { section: "Balance Sheet" },
    });

    const ok = await useStatementStore.getState().loadStatement({ companyId: COMPANY_ID });
    expect(ok).toBe(false);

    const s = useStatementStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("STATEMENT_TIE_OUT_FAILED");
    expect(s.error?.httpStatus).toBe(422);
    expect(s.error?.retryable).toBe(false);
    expect(s.error?.details.section).toBe("Balance Sheet");
    // A failed read never keeps stale numbers on screen.
    expect(s.rows).toEqual([]);
    expect(s.totals).toBeNull();
    expect(s.tieoutStatus).toBeNull();
    expect(s.roundingStatus).toBeNull();
  });

  it("retry re-issues the last load with the persisted scope and config", async () => {
    callMock.mockRejectedValueOnce({ code: "INTERNAL", httpStatus: 500, retryable: true });
    await useStatementStore
      .getState()
      .loadStatement({ companyId: COMPANY_ID, type: "bs", preset: "ifrs" });
    expect(useStatementStore.getState().status).toBe("error");

    callMock.mockResolvedValueOnce({ ...PL_DATA, rows: [] });
    const ok = await useStatementStore.getState().retry();
    expect(ok).toBe(true);

    const lastCall = callMock.mock.calls[callMock.mock.calls.length - 1];
    expect(lastCall[0]).toBe("statement.get.v1");
    expect(lastCall[1]).toMatchObject({ company_id: COMPANY_ID, type: "bs", preset: "ifrs" });
  });

  it("clearError drops the error without touching the rows", async () => {
    callMock.mockRejectedValueOnce(new Error("boom"));
    await useStatementStore.getState().loadStatement({ companyId: COMPANY_ID });
    expect(useStatementStore.getState().status).toBe("error");

    useStatementStore.getState().clearError();
    expect(useStatementStore.getState().error).toBeNull();
  });

  it("reset returns every field to the initial state", async () => {
    callMock.mockResolvedValueOnce(PL_DATA);
    await useStatementStore.getState().loadStatement({ companyId: COMPANY_ID });
    expect(useStatementStore.getState().status).toBe("populated");

    useStatementStore.getState().reset();
    const s = useStatementStore.getState();
    expect(s.status).toBe("empty");
    expect(s.companyId).toBeNull();
    expect(s.rows).toEqual([]);
    expect(s.totals).toBeNull();
    expect(s.findings).toEqual([]);
    expect(s.currency).toBeNull();
  });

  it("selectors expose the raw engine response", async () => {
    callMock.mockResolvedValueOnce(PL_DATA);
    await useStatementStore.getState().loadStatement({ companyId: COMPANY_ID });

    const st = useStatementStore.getState();
    expect(st.getRows()).toEqual(PL_DATA.rows);
    expect(st.getTotals()).toEqual(PL_DATA.totals);
    expect(st.getTieoutStatus()).toBe("pass");
    expect(st.getRoundingStatus()).toBe("exact");
  });
});
