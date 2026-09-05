/**
 * S-060 Statements screen tests (F-027 · M6-1 · SCREENS-SPEC S-060).
 *
 * Verifies:
 *  - header + statement tabs (P&L / Balance Sheet enabled; CF / SoCE / Segment pending)
 *  - tab activation navigates to /app/reports/statements/:type
 *  - all 5 canonical states: loading / empty (no Company) / empty (no data) / error /
 *    populated
 *  - preset select + rounding mode select + largest-remainder switch drive the store
 *  - populated rows/totals render the engine's exact values via MoneyCell only (the UI
 *    never computes a money total — B6)
 *  - tie-out + rounding-integrity chips render engine status verbatim
 *  - axe: 0 violations (empty, populated, error states)
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { StatementsPage } from "./index";
import { useStatementStore } from "@/stores/statements";
import { useSessionStore } from "@/stores/session";

function renderPage() {
  return render(
    <BrowserRouter>
      <StatementsPage />
    </BrowserRouter>,
  );
}

function storeState() {
  return useStatementStore.getState();
}

function setStoreState(partial: Partial<ReturnType<typeof useStatementStore>>) {
  useStatementStore.setState(partial);
}

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

const PL_ROWS = [
  {
    section: "Revenue",
    lines: [
      { account_id: "a-rev", label: "Sales Revenue", values: { fp_2026_p01: 1000000, fp_2026_p02: 1200000 } },
    ],
  },
  {
    section: "Cost of Goods Sold",
    lines: [
      { account_id: "a-cogs", label: "Direct Materials", values: { fp_2026_p01: -600000, fp_2026_p02: -700000 } },
    ],
  },
];

const PL_TOTALS = {
  revenue: 2200000,
  gross_profit: 900000,
  operating_income: 500000,
  net_income: 500000,
  total_assets: null,
  total_liabilities: null,
  total_equity: null,
  net_cash_change: null,
  ending_cash: null,
};

describe("S-060 Statements", () => {
  beforeEach(() => {
    useSessionStore.setState({ companyId: COMPANY_ID });
    setStoreState({
      status: "empty",
      error: null,
      companyId: COMPANY_ID,
      type: "pl",
      periodScope: ["fp_2026_p01", "fp_2026_p02"],
      preset: "us_gaap",
      rounding: { mode: "two_decimals", largest_remainder: true },
      buScope: { kind: "all", bu_id: null },
      currency: "USD",
      rows: [],
      totals: null,
      tieoutStatus: null,
      roundingStatus: null,
      findings: [],
    });
    storeState().loadStatement = vi.fn().mockResolvedValue(true);
  });

  it("renders the header, tabs and pending explanations", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Statements" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Statement tabs" });
    expect(within(nav).getByRole("button", { name: /Profit & Loss/ })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Balance Sheet/ })).toBeInTheDocument();
    const cf = within(nav).getByRole("button", { name: /Cash Flow/ });
    const soce = within(nav).getByRole("button", { name: /Statement of Changes in Equity/ });
    const segment = within(nav).getByRole("button", { name: /Segment Report/ });
    expect(cf).toBeDisabled();
    expect(soce).toBeDisabled();
    expect(segment).toBeDisabled();
    expect(cf).toHaveTextContent(/pending/i);
    expect(soce).toHaveTextContent(/pending/i);
    expect(segment).toHaveTextContent(/pending/i);
  });

  it("navigates to the Balance Sheet route when its tab is activated", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /Balance Sheet/ }));
    expect(window.location.pathname).toBe("/app/reports/statements/bs");
  });

  it("shows the loading state with role=status while the store loads", () => {
    setStoreState({ status: "loading" });
    renderPage();
    expect(screen.getByRole("status", { name: "Loading statement" })).toBeInTheDocument();
  });

  it("shows the no-Company state when no Company is open", () => {
    useSessionStore.setState({ companyId: null });
    setStoreState({ status: "empty", companyId: null });
    renderPage();
    expect(screen.getByRole("heading", { name: /No Company open/ })).toBeInTheDocument();
  });

  it("shows the empty state when there is no data for the period", () => {
    setStoreState({ status: "success", rows: [], totals: null });
    renderPage();
    expect(screen.getByRole("heading", { name: "No data for period" })).toBeInTheDocument();
  });

  it("renders the error state with the canonical code and a retry button", async () => {
    setStoreState({
      status: "error",
      error: {
        code: "STATEMENT_TIE_OUT_FAILED",
        message: "statement does not tie",
        userMessage:
          "Statement does not tie (Assets ≠ Liabilities + Equity). Export blocked — fix findings first.",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
      findings: [
        { code: "STATEMENT_TIE_OUT_FAILED", message: "x", detail: "assets 1 ≠ liabilities 2" },
      ],
    });
    storeState().retry = vi.fn();
    renderPage();
    expect(screen.getByText(/Statement does not tie/)).toBeInTheDocument();
    expect(screen.getByText("STATEMENT_TIE_OUT_FAILED")).toBeInTheDocument();
    expect(screen.getByText("assets 1 ≠ liabilities 2")).toBeInTheDocument();
  });

  it("offers Retry for retryable errors", async () => {
    setStoreState({
      status: "error",
      error: {
        code: "INTERNAL",
        message: "db",
        userMessage: "An unexpected error occurred. Please try again.",
        httpStatus: 500,
        retryable: true,
        retryAfterMs: null,
        details: {},
      },
    });
    const retry = vi.fn();
    storeState().retry = retry;
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders populated P&L rows and engine totals without computing money in the UI", () => {
    setStoreState({
      status: "populated",
      rows: PL_ROWS,
      totals: PL_TOTALS,
      tieoutStatus: "pass",
      roundingStatus: "exact",
      findings: [],
    });
    renderPage();

    // Rows show the engine's exact values through MoneyCell (format-only).
    expect(screen.getByText("Sales Revenue")).toBeInTheDocument();
    expect(screen.getByText("Direct Materials")).toBeInTheDocument();
    // MoneyCell formats minor units: USD 1,000,000.00 and (USD 600,000.00) (paren default).
    expect(screen.getByText("USD 1,000,000.00")).toBeInTheDocument();
    expect(screen.getByText("USD 1,200,000.00")).toBeInTheDocument();
    expect(screen.getByText("(USD 600,000.00)")).toBeInTheDocument();
    // Engine totals render the same way.
    expect(screen.getByText("USD 2,200,000.00")).toBeInTheDocument();
    // Integrity chips mirror the engine status.
    expect(screen.getByText("Tie-out: Pass")).toBeInTheDocument();
    expect(screen.getByText("Rounding: Exact")).toBeInTheDocument();
  });

  it("renders signed Balance Sheet totals per MONEY-ROUNDING-SPEC §5", () => {
    setStoreState({
      status: "populated",
      type: "bs",
      rows: [
        {
          section: "Current Assets",
          lines: [{ account_id: "a-asset", label: "Cash", values: { fp_2026_p01: 500000, fp_2026_p02: 760000 } }],
        },
        {
          section: "Current Liabilities",
          lines: [{ account_id: "a-liab", label: "Accounts Payable", values: { fp_2026_p01: -200000, fp_2026_p02: -300000 } }],
        },
        {
          section: "Equity",
          lines: [{ account_id: "a-equity", label: "Retained Earnings", values: { fp_2026_p01: -300000, fp_2026_p02: -460000 } }],
        },
      ],
      totals: {
        revenue: null,
        gross_profit: null,
        operating_income: null,
        net_income: null,
        total_assets: 1260000,
        total_liabilities: -500000,
        total_equity: -760000,
        net_cash_change: null,
        ending_cash: null,
      },
      tieoutStatus: "pass",
      roundingStatus: "exact",
      findings: [],
    });
    renderPage();
    expect(screen.getByText("Current Assets")).toBeInTheDocument();
    expect(screen.getByText("Total Assets")).toBeInTheDocument();
    expect(screen.getByText("USD 1,260,000.00")).toBeInTheDocument();
    // Signed per §5: liabilities/equity display in parentheses.
    expect(screen.getByText("(USD 500,000.00)")).toBeInTheDocument();
    expect(screen.getByText("(USD 760,000.00)")).toBeInTheDocument();
  });

  it("switches the presentation preset through the select", async () => {
    const setPresetSpy = vi.spyOn(storeState(), "setPreset");
    renderPage();
    await userEvent.selectOptions(
      screen.getByLabelText("Presentation preset"),
      "ifrs",
    );
    expect(setPresetSpy).toHaveBeenCalledWith("ifrs");
  });

  it("toggles largest-remainder and changes the rounding mode", async () => {
    const setRoundingSpy = vi.spyOn(storeState(), "setRounding");
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText("Rounding mode"), "thousands");
    expect(setRoundingSpy).toHaveBeenLastCalledWith({
      mode: "thousands",
      largest_remainder: true,
    });
    await userEvent.click(screen.getByRole("switch", { name: "Largest remainder allocation" }));
    expect(setRoundingSpy).toHaveBeenLastCalledWith({
      mode: "thousands",
      largest_remainder: false,
    });
  });
});

describe("S-060 Statements axe", () => {
  beforeEach(() => {
    useSessionStore.setState({ companyId: COMPANY_ID });
    setStoreState({
      status: "populated",
      error: null,
      companyId: COMPANY_ID,
      type: "pl",
      periodScope: ["fp_2026_p01", "fp_2026_p02"],
      preset: "us_gaap",
      rounding: { mode: "two_decimals", largest_remainder: true },
      buScope: { kind: "all", bu_id: null },
      currency: "USD",
      rows: PL_ROWS,
      totals: PL_TOTALS,
      tieoutStatus: "pass",
      roundingStatus: "exact",
      findings: [],
    });
    storeState().loadStatement = vi.fn().mockResolvedValue(true);
  });

  it("has no axe violations in the populated state", async () => {
    const { container } = renderPage();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("has no axe violations in the empty state", async () => {
    setStoreState({ status: "empty", rows: [], totals: null });
    const { container } = renderPage();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("has no axe violations in the error state", async () => {
    setStoreState({
      status: "error",
      rows: [],
      totals: null,
      error: {
        code: "STATEMENT_SOURCE_MIXED",
        message: "mixed",
        userMessage:
          "Period/currency mix in scope is not comparable. Align scope or use Group translation.",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
    });
    const { container } = renderPage();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
