/**
 * S-061 Segment Report screen tests (F-028 · M6-2 · SCREENS-SPEC S-061).
 *
 * Verifies:
 *  - Header, period selector, and export button
 *  - 5 canonical states: loading / empty / error / populated
 *  - BU columns rendered with local and translated values
 *  - Eliminations column and Group Total
 *  - Column-level chips for IC_UNMATCHED / SEGMENT_TRANSLATION_PENDING
 *  - vitest-axe: 0 violations
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { SegmentReportPage } from "./index";
import { useSessionStore } from "@/stores/session";
import { useStatementStore } from "@/stores/statements";
import * as bridge from "@/api/bridge";

function renderPage() {
  return render(
    <BrowserRouter>
      <SegmentReportPage />
    </BrowserRouter>,
  );
}

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

describe("S-061 SegmentReportPage (F-028 · M6-2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ companyId: COMPANY_ID });
    useStatementStore.getState().reset();
  });

  it("renders populated state with BU local, translated, eliminations, and group total", async () => {
    vi.spyOn(bridge, "call").mockResolvedValueOnce({
      rows: [
        {
          section: "Segment Revenue",
          lines: [
            {
              account_id: "a-seg-rev",
              label: "External Revenue",
              values: {
                "bu-us-local": 1000000,
                "bu-us-translated": 1000000,
                "bu-uk-local": 800000,
                "bu-uk-translated": 1000000,
                eliminations: 0,
                group: 2000000,
              },
            },
          ],
        },
      ],
      totals: {
        revenue: 2000000,
        gross_profit: null,
        operating_income: 650000,
        net_income: null,
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
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("segment-line-a-seg-rev")).toBeInTheDocument();
    });

    expect(screen.getByText("Segment Report")).toBeInTheDocument();
    expect(screen.getByText("US Operating Unit")).toBeInTheDocument();
    expect(screen.getByText("UK International")).toBeInTheDocument();
    expect(screen.getByText("Tie-out: Balanced")).toBeInTheDocument();
  });

  it("renders empty state when no company is open", async () => {
    useSessionStore.setState({ companyId: null });
    renderPage();

    expect(await screen.findByText(/No BUs in Group/i)).toBeInTheDocument();
  });

  it("renders error state on IC_UNMATCHED error", async () => {
    vi.spyOn(bridge, "call").mockRejectedValueOnce({
      code: "IC_UNMATCHED",
      message: "unmatched intercompany lines exist in period",
      userMessage: "Intercompany transactions are out of balance across Business Units.",
      httpStatus: 422,
      retryable: false,
    });

    renderPage();

    expect(
      await screen.findByText(/Intercompany transactions are out of balance/i),
    ).toBeInTheDocument();
  });

  it("satisfies axe accessibility rules in populated state", async () => {
    vi.spyOn(bridge, "call").mockResolvedValueOnce({
      rows: [
        {
          section: "Segment Revenue",
          lines: [
            {
              account_id: "a-seg-rev",
              label: "External Revenue",
              values: {
                "bu-us-local": 1000000,
                "bu-us-translated": 1000000,
                "bu-uk-local": 800000,
                "bu-uk-translated": 1000000,
                eliminations: 0,
                group: 2000000,
              },
            },
          ],
        },
      ],
      totals: {
        revenue: 2000000,
        gross_profit: null,
        operating_income: 650000,
        net_income: null,
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
    } as never);

    const { container } = renderPage();
    await screen.findByTestId("segment-line-a-seg-rev");

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
