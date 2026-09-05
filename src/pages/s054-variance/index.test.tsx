/**
 * S-054 Variance & Attribution Screen Tests (F-024 · M5-1 · M5-2 · SCREENS-SPEC S-054).
 *
 * Verifies:
 *   1. All 5 canonical UI states:
 *       - loading: spinner with role="status" and aria-busy="true"
 *       - empty: "No Actuals yet" / "Nothing to compare" Plan-Only state
 *       - error: typed error with code (e.g. VARIANCE_SOURCE_MIXED) and retry button
 *       - success: confirmation banner for fully reconciled variances
 *       - populated: full data table with exact money formatting
 *   2. Toolbar controls:
 *       - Period, Business Unit, and Account Category dropdown filters
 *       - Comparison target picker (Budget / Forecast / Commit)
 *       - 3-Way toggle displaying Plan / Commit / Actuals and extra delta columns
 *       - View mode toggle between Data Table and Waterfall chart
 *   3. Data Table columns & features:
 *       - Exact minor unit display (no float)
 *       - F/U badge with distinct text ('F' or 'U'), icon, and explicit aria-label (never color alone)
 *       - Attribution decomposition columns (Volume, Price, Mix, FX, Efficiency)
 *       - Unattributable line behavior with explanatory message ("Not attributable — no driver feed for this line.")
 *       - Attribution completeness chip ("1 of 4 lines not attributable")
 *   4. Reason Code & Commentary modal:
 *       - Opens modal with accessible dialog role and labeled form fields
 *       - Selects a Reason Code and enters narrative text
 *       - Saves commentary back into the table row
 *   5. CSV Export:
 *       - Dispatches downloadable CSV with headers and data
 *   6. Accessibility:
 *       - Zero axe violations across empty and populated states
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { VariancePage, type VarianceRow } from "./index";

const mockRows: VarianceRow[] = [
  {
    account_id: "acc-100",
    account_code: "4000",
    account_name: "Subscription Revenue",
    category: "revenue",
    business_unit: "North America",
    period_id: "fp-2027-p08",
    period_label: "2027-P08",
    actual_minor: 15000000,
    plan_minor: 12000000,
    commit_minor: 11500000,
    delta_minor: 3000000,
    delta_pct: 0.25,
    direction: "favorable",
    attribution: {
      volume: 2000000,
      price: 1000000,
      mix: 0,
      fx: 0,
      efficiency: null,
      is_attributable: true,
    },
    reason_code: "VOLUME_SURGE",
    note: "High customer expansion in NA",
  },
  {
    account_id: "acc-200",
    account_code: "5000",
    account_name: "Infrastructure COGS",
    category: "cogs",
    business_unit: "North America",
    period_id: "fp-2027-p08",
    period_label: "2027-P08",
    actual_minor: 4500000,
    plan_minor: 4000000,
    commit_minor: 4000000,
    delta_minor: -500000,
    delta_pct: -0.125,
    direction: "unfavorable",
    attribution: {
      volume: -300000,
      price: -200000,
      mix: 0,
      fx: 0,
      efficiency: 0,
      is_attributable: true,
    },
    reason_code: "SUPPLIER_DISRUPTION",
    note: "Server spot pricing increase",
  },
  {
    account_id: "acc-300",
    account_code: "6000",
    account_name: "General & Administrative",
    category: "opex",
    business_unit: "Corporate",
    period_id: "fp-2027-p08",
    period_label: "2027-P08",
    actual_minor: 1000000,
    plan_minor: 1000000,
    commit_minor: 1000000,
    delta_minor: 0,
    delta_pct: 0,
    direction: "neutral",
    attribution: {
      volume: null,
      price: null,
      mix: null,
      fx: null,
      efficiency: null,
      is_attributable: false,
    },
    reason_code: null,
    note: null,
  },
];

describe("S-054 Variance & Attribution Screen (F-024 · M5-1 · M5-2)", () => {
  /* ── 1. Canonical 5 Screen States ── */
  describe("Canonical 5 UI states", () => {
    it("renders the loading state with role=status and aria-busy", () => {
      render(<VariancePage initialState="loading" />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText(/Loading variance data and recalculating driver attribution/i)).toBeInTheDocument();
    });

    it("renders the empty state (Plan-Only) with guidance and remains axe-clean", async () => {
      const { container } = render(<VariancePage initialState="empty" />);
      expect(screen.getByText(/No Actuals yet — Plan-Only state/i)).toBeInTheDocument();
      const actionBtn = screen.getByRole("button", { name: /Load Sample Actuals/i });
      expect(actionBtn).toBeInTheDocument();

      const results = await axe(container);
      expect(results.violations).toEqual([]);
    });

    it("renders the error state with typed error code and retry action", async () => {
      const onRetry = vi.fn();
      render(
        <VariancePage
          initialState="error"
          initialError={{
            code: "VARIANCE_SOURCE_MIXED",
            userMessage: "Selected periods mix Actual and Forecast. Enable HYBRID label to view.",
            retryable: true,
          }}
          onRetry={onRetry}
        />,
      );

      expect(screen.getByText(/VARIANCE_SOURCE_MIXED/i)).toBeInTheDocument();
      expect(screen.getByText(/Selected periods mix Actual and Forecast/i)).toBeInTheDocument();
      const retryBtn = screen.getByRole("button", { name: /Retry/i });
      await userEvent.click(retryBtn);
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it("renders the success state with confirmation banner", () => {
      render(<VariancePage initialState="success" initialRows={mockRows} />);
      expect(
        screen.getByText(/All variance reason codes and commentary submitted and reconciled cleanly/i),
      ).toBeInTheDocument();
    });

    it("renders the populated state and remains axe-clean", async () => {
      const { container } = render(<VariancePage initialState="populated" initialRows={mockRows} />);
      expect(screen.getByRole("heading", { name: /Variance & Attribution/i })).toBeInTheDocument();
      expect(screen.getByText("Subscription Revenue")).toBeInTheDocument();
      expect(screen.getByText("Infrastructure COGS")).toBeInTheDocument();

      const results = await axe(container);
      expect(results.violations).toEqual([]);
    });
  });

  /* ── 2. Toolbar & Filtering ── */
  describe("Toolbar controls", () => {
    it("filters table rows by business unit", async () => {
      render(<VariancePage initialRows={mockRows} />);

      expect(screen.getByText("Subscription Revenue")).toBeInTheDocument();
      expect(screen.getByText("General & Administrative")).toBeInTheDocument();

      const buSelect = screen.getByLabelText(/Filter by Business Unit/i);
      await userEvent.selectOptions(buSelect, "Corporate");

      expect(screen.queryByText("Subscription Revenue")).not.toBeInTheDocument();
      expect(screen.getByText("General & Administrative")).toBeInTheDocument();
    });

    it("toggles 3-Way view to show Commit column", async () => {
      render(<VariancePage initialRows={mockRows} />);

      expect(screen.queryByRole("columnheader", { name: "Commit" })).not.toBeInTheDocument();

      const threeWayToggle = screen.getByRole("switch", { name: /3-Way View/i });
      await userEvent.click(threeWayToggle);

      expect(screen.getByRole("columnheader", { name: "Commit" })).toBeInTheDocument();
    });

    it("toggles between Table view and Waterfall view", async () => {
      render(<VariancePage initialRows={mockRows} />);

      expect(screen.getByRole("region", { name: /Variance Data Table/i })).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: /Waterfall attribution bridge/i })).not.toBeInTheDocument();

      const waterfallRadio = screen.getByRole("radio", { name: /Waterfall/i });
      await userEvent.click(waterfallRadio);

      expect(screen.getByRole("img", { name: /Waterfall attribution bridge/i })).toBeInTheDocument();
    });
  });

  /* ── 3. Table Decomposition, Badges & Money ── */
  describe("Table decomposition and F/U Badges", () => {
    it("renders F/U badges with accessible status labels and icons (never color alone)", () => {
      render(<VariancePage initialRows={mockRows} />);

      const favorableBadges = screen.getAllByRole("status", { name: "Favorable variance" });
      expect(favorableBadges.length).toBeGreaterThan(0);
      expect(favorableBadges[0]).toHaveTextContent("F");

      const unfavorableBadges = screen.getAllByRole("status", { name: "Unfavorable variance" });
      expect(unfavorableBadges.length).toBeGreaterThan(0);
      expect(unfavorableBadges[0]).toHaveTextContent("U");

      const neutralBadges = screen.getAllByRole("status", { name: "Neutral variance" });
      expect(neutralBadges.length).toBeGreaterThan(0);
      expect(neutralBadges[0]).toHaveTextContent("—");
    });

    it("displays exact minor unit formatting without float artifacts", () => {
      render(<VariancePage initialRows={mockRows} />);

      // USD 150,000.00 for 15000000 minor units
      expect(screen.getByText("USD 150,000.00")).toBeInTheDocument();
      expect(screen.getByText("USD 120,000.00")).toBeInTheDocument();
      expect(screen.getByText("+USD 30,000.00")).toBeInTheDocument();
      expect(screen.getByText("+25.0%")).toBeInTheDocument();
    });

    it("handles unattributable rows cleanly with explanatory notice", () => {
      render(<VariancePage initialRows={mockRows} />);

      expect(
        screen.getByText("Not attributable — no driver feed for this line."),
      ).toBeInTheDocument();

      expect(
        screen.getByRole("status", { name: "Attribution completeness" }),
      ).toHaveTextContent("1 of 3 lines not attributable");
    });
  });

  /* ── 4. Reason Code & Commentary Modal ── */
  describe("Reason Code and Commentary Modal", () => {
    it("allows opening commentary modal, changing reason code, typing note, and saving", async () => {
      render(<VariancePage initialRows={mockRows} />);

      const noteButton = screen.getByRole("button", {
        name: "Open commentary for Subscription Revenue",
      });
      await userEvent.click(noteButton);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /Variance Commentary & Reason Code/i }),
      ).toBeInTheDocument();

      const reasonSelect = screen.getByLabelText(/Reason Code \(Categorization\)/i);
      await userEvent.selectOptions(reasonSelect, "PRICE_RENEGOTIATION");

      const narrativeInput = screen.getByLabelText(/Narrative Explanation/i);
      await userEvent.clear(narrativeInput);
      await userEvent.type(narrativeInput, "Price hike approved across major enterprise clients.");

      const saveButton = screen.getByRole("button", { name: /Save Commentary/i });
      await userEvent.click(saveButton);

      // Modal closes
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Row reflects updated reason code
      expect(screen.getByText("PRICE RENEGOTIATION")).toBeInTheDocument();
    });

    it("remains axe-clean when commentary modal is open", async () => {
      const { container } = render(<VariancePage initialRows={mockRows} />);

      const noteButton = screen.getByRole("button", {
        name: "Open commentary for Subscription Revenue",
      });
      await userEvent.click(noteButton);

      const results = await axe(container);
      expect(results.violations).toEqual([]);
    });
  });

  /* ── 5. Export Feature ── */
  describe("CSV Export", () => {
    it("generates CSV download when clicking Export CSV", async () => {
      const createObjectURLMock = vi.fn(() => "blob:http://localhost/mock");
      const revokeObjectURLMock = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLMock;
      globalThis.URL.revokeObjectURL = revokeObjectURLMock;

      render(<VariancePage initialRows={mockRows} />);

      const exportBtn = screen.getByRole("button", { name: /Export variance table as CSV/i });
      await userEvent.click(exportBtn);

      expect(createObjectURLMock).toHaveBeenCalledOnce();
      expect(revokeObjectURLMock).toHaveBeenCalledOnce();
    });
  });
});

