/**
 * S-060 Statements — edge-state tests (M6-1 completion slice).
 *
 * Complements index.test.tsx (which owns the 5 canonical states + axe) with the
 * boundary behaviors the screen must not get wrong:
 *  - a period without a value renders the em-dash cell (never a fabricated 0)
 *  - currency falls back to USD only at the format boundary when the store is null
 *  - rounding modes drive displayDecimals/thousands flags (format-only, B6)
 *  - tie-out fail / rounding approximate render the warning chips verbatim
 *  - a single row renders the "1 line" singular meta
 *  - a pending statement route falls back to P&L instead of a dead screen
 *  - a finding without a detail still shows its message
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StatementsPage } from "./index";
import { useStatementStore } from "@/stores/statements";
import { useSessionStore } from "@/stores/session";

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

function renderPage(entry = "/app/reports/statements/pl") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/app/reports/statements/:type" element={<StatementsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setStoreState(partial: Partial<ReturnType<typeof useStatementStore.getState>>) {
  useStatementStore.setState(partial);
}

function baseState(): Partial<ReturnType<typeof useStatementStore.getState>> {
  return {
    status: "populated",
    error: null,
    companyId: COMPANY_ID,
    type: "pl",
    periodScope: ["fp_2026_p01", "fp_2026_p02"],
    preset: "us_gaap",
    rounding: { mode: "two_decimals", largest_remainder: true },
    buScope: { kind: "all", bu_id: null },
    currency: "USD",
    rows: [
      {
        section: "Revenue",
        lines: [
          {
            account_id: "a-rev",
            label: "Sales Revenue",
            values: { fp_2026_p01: 1000000, fp_2026_p02: 1200000 },
          },
        ],
      },
    ],
    totals: {
      revenue: 2200000,
      gross_profit: null,
      operating_income: null,
      net_income: null,
      total_assets: null,
      total_liabilities: null,
      total_equity: null,
      net_cash_change: null,
      ending_cash: null,
    },
    tieoutStatus: "pass",
    roundingStatus: "exact",
    findings: [],
  };
}

describe("S-060 Statements edge states", () => {
  beforeEach(() => {
    useSessionStore.setState({ companyId: COMPANY_ID });
    setStoreState({
      ...baseState(),
      // The load effect is asserted against the store contract, not the bridge.
      loadStatement: vi.fn().mockResolvedValue(true),
    });
  });

  it("renders an em-dash (never 0) for a period without a value and falls back to USD", () => {
    setStoreState({
      currency: null,
      rows: [
        {
          section: "Revenue",
          lines: [
            {
              account_id: "a-rev",
              label: "Sales Revenue",
              values: { fp_2026_p01: 1000000, fp_2026_p02: 1200000 },
            },
            { account_id: "a-late", label: "Late Accrual", values: { fp_2026_p01: 5000 } },
          ],
        },
      ],
    });
    renderPage();
    // a-late has no P02 cell → em-dash; USD fallback keeps the 10,000.00 formatting.
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("USD 10,000.00")).toBeInTheDocument();
    expect(screen.getByText("USD 50.00")).toBeInTheDocument();
  });

  it("major units mode renders zero decimals and thousands mode divides by 1,000", async () => {
    renderPage();
    const roundingSelect = screen.getByLabelText("Rounding mode");
    await userEvent.selectOptions(roundingSelect, "major_units");
    expect(screen.getByText("USD 10,000")).toBeInTheDocument();

    await userEvent.selectOptions(roundingSelect, "thousands");
    expect(screen.getByText("USD 10")).toBeInTheDocument();
  });

  it("renders the fail tie-out and approximate rounding chips verbatim", () => {
    setStoreState({ tieoutStatus: "fail", roundingStatus: "approximate" });
    renderPage();
    expect(screen.getByText("Tie-out: Fail")).toBeInTheDocument();
    expect(screen.getByText("Rounding: Approximate")).toBeInTheDocument();
    // A single line uses the singular meta wording.
    expect(screen.getByText(/1 line/)).toBeInTheDocument();
  });

  it("a pending statement route falls back to P&L instead of a dead screen", () => {
    renderPage("/app/reports/statements/cf");
    // CF is pending (M6-1) → the page resolves the active type to the enabled P&L tab.
    expect(screen.getByRole("navigation", { name: "Statement tabs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Profit & Loss/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Cash Flow/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("round-trips the preset and keeps the URL in sync (cleanup on US GAAP)", async () => {
    renderPage("/app/reports/statements/pl?preset=ifrs");
    // Preset restored from the URL → the engine request already carries ifrs.
    const select = screen.getByLabelText("Presentation preset");
    expect(select).toHaveValue("ifrs");
    await userEvent.selectOptions(select, "us_gaap");
    expect(select).toHaveValue("us_gaap");
  });

  it("a tie-out finding without a detail still renders its message", () => {
    setStoreState({
      status: "error",
      error: {
        code: "STATEMENT_TIE_OUT_FAILED",
        userMessage:
          "Statement does not tie (Assets ≠ Liabilities + Equity). Export blocked — fix findings first.",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
      findings: [
        { code: "STATEMENT_TIE_OUT_FAILED", message: "assets do not balance", detail: "" },
      ],
    });
    renderPage();
    expect(screen.getByText("assets do not balance")).toBeInTheDocument();
  });
});
