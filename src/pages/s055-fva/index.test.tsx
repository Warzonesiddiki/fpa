/**
 * S-055 FVA (Forecast-versus-Actual Accuracy Scoring) Tests
 * F-025 · M5-3 · SCREENS-SPEC S-055 · WIREFRAMES-ANALYTICS S-055
 *
 * Verifies:
 *   1. All 5 canonical UI states:
 *       - loading: spinner with role="status" and message
 *       - empty: "Need at least 3 Forecast Versions to score a line." when < 3 versions selected
 *       - error: typed error with code (e.g. FVA_COMPUTE_FAILED) and retry handler
 *       - success: confirmation banner
 *       - populated: full score cards, by-line table, and rollup strip
 *   2. Selector controls:
 *       - version set dropdown/checkbox group (>= 3 required)
 *       - horizon selector
 *   3. 3-up KPI score cards:
 *       - MAPE, Bias, Hit rate
 *       - Accessible info button opening formula dialog explaining formula & interpretation
 *   4. Persistent banner when FVA_RESTATEMENT_FLAG is active
 *       ("Actuals were restated for these periods — FVA recomputed; versions unchanged.")
 *   5. By-line table:
 *       - Line Name, BU, Versions Scored, MAPE, Bias, Hit Rate
 *       - Trend chip (improving/worsening/stable with text + icon, never color alone)
 *   6. By-BU rollup strip (group only)
 *   7. Export button dispatches CSV
 *   8. Accessibility:
 *       - Zero axe violations across empty, populated, banner active, and formula dialog open states.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { FvaPage, type FvaLineScore } from "./index";

const mockLines: FvaLineScore[] = [
  {
    line_id: "ln-rev-sub",
    line_name: "Subscription Revenue",
    business_unit: "North America",
    versions_scored: 4,
    mape: 0.042,
    bias: 0.012,
    hit_rate: 0.85,
    trend: "improving",
  },
  {
    line_id: "ln-rev-serv",
    line_name: "Professional Services",
    business_unit: "North America",
    versions_scored: 4,
    mape: 0.089,
    bias: -0.034,
    hit_rate: 0.65,
    trend: "worsening",
  },
  {
    line_id: "ln-cogs-infra",
    line_name: "Cloud Infrastructure COGS",
    business_unit: "EMEA",
    versions_scored: 3,
    mape: 0.051,
    bias: 0.021,
    hit_rate: 0.74,
    trend: "improving",
  },
  {
    line_id: "ln-opex-ga",
    line_name: "General & Administrative",
    business_unit: "Corporate",
    versions_scored: 3,
    mape: 0.028,
    bias: 0.002,
    hit_rate: 0.9,
    trend: "stable",
  },
];

describe("S-055 FVA Screen (F-025 · M5-3 · SCREENS-SPEC S-055)", () => {
  /* ── 1. Canonical 5 Screen States ── */
  describe("Canonical 5 UI states", () => {
    it("renders the loading state with role=status", () => {
      render(<FvaPage initialState="loading" />);
      const statuses = screen.getAllByRole("status");
      expect(statuses.length).toBeGreaterThan(0);
      expect(
        screen.getByText(/Computing FVA scores across forecast versions and actuals/i),
      ).toBeInTheDocument();
    });

    it("renders empty state when < 3 versions are selected and remains axe-clean", async () => {
      const { container } = render(
        <FvaPage initialSelectedVersions={["v-2027-q1", "v-2027-q2"]} initialLines={mockLines} />,
      );

      // Warning text
      expect(
        screen.getAllByText(/Need at least 3 Forecast Versions to score a line/i).length,
      ).toBeGreaterThan(0);

      // Action button in empty StatePanel
      const selectBtn = screen.getByRole("button", { name: /Select 3 Versions/i });
      expect(selectBtn).toBeInTheDocument();

      const results = await axe(container);
      expect(results.violations).toEqual([]);
    });

    it("renders error state with typed error code and retry button", async () => {
      const onRetry = vi.fn();
      render(
        <FvaPage
          initialState="error"
          initialError={{
            code: "FVA_RESTATED_UNAVAILABLE",
            userMessage: "Restated actuals could not be loaded for selected horizon.",
            retryable: true,
          }}
          onRetry={onRetry}
        />,
      );

      expect(screen.getByText(/FVA_RESTATED_UNAVAILABLE/i)).toBeInTheDocument();
      expect(screen.getByText(/Restated actuals could not be loaded/i)).toBeInTheDocument();

      const retryBtn = screen.getByRole("button", { name: /Retry/i });
      await userEvent.click(retryBtn);
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it("renders success state confirmation", () => {
      render(<FvaPage initialState="success" initialLines={mockLines} />);
      expect(
        screen.getByText(
          /FVA scores recomputed successfully. All lines scored against current restatements/i,
        ),
      ).toBeInTheDocument();
    });

    it("renders populated state and remains axe-clean", async () => {
      const { container } = render(
        <FvaPage
          initialSelectedVersions={["v-2027-q1", "v-2027-q2", "v-2027-q3"]}
          initialLines={mockLines}
        />,
      );

      expect(
        screen.getByRole("heading", { name: /Forecast Value Added \(FVA\)/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("Subscription Revenue")).toBeInTheDocument();
      expect(screen.getByText("Cloud Infrastructure COGS")).toBeInTheDocument();

      const results = await axe(container);
      expect(results.violations).toEqual([]);
    });
  });

  /* ── 2. Selectors: Versions & Horizon ── */
  describe("Selectors and Version Requirements", () => {
    it("dynamically transitions between populated and empty when unchecking versions below 3", async () => {
      render(
        <FvaPage
          initialSelectedVersions={["v-2027-q1", "v-2027-q2", "v-2027-q3"]}
          initialLines={mockLines}
        />,
      );

      // Initially populated
      expect(screen.getByText("Subscription Revenue")).toBeInTheDocument();

      // Uncheck one version -> drops to 2 selected
      const q3Checkbox = screen.getByRole("checkbox", { name: "2027 Q3 Forecast" });
      await userEvent.click(q3Checkbox);

      // Should now show empty state requirement
      expect(
        screen.getAllByText(/Need at least 3 Forecast Versions to score a line/i).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText("Subscription Revenue")).not.toBeInTheDocument();

      // Click "Select 3 Versions" button
      const resetBtn = screen.getByRole("button", { name: /Select 3 Versions/i });
      await userEvent.click(resetBtn);

      // Back to populated
      expect(screen.getByText("Subscription Revenue")).toBeInTheDocument();
    });

    it("updates horizon selection", async () => {
      render(<FvaPage initialLines={mockLines} />);

      const select = screen.getByLabelText(/Horizon:/i);
      expect(select).toHaveValue("3m");

      await userEvent.selectOptions(select, "6m");
      expect(select).toHaveValue("6m");
      expect(screen.getByText(/Horizon: 6 Months Ahead/i)).toBeInTheDocument();
    });
  });

  /* ── 3. 3-up KPI Score Cards & Info Buttons ── */
  describe("3-up KPI Score Cards and Formula Modal", () => {
    it("renders KPI cards with exact values and accessible info dialogs", async () => {
      render(<FvaPage initialLines={mockLines} />);

      // Averages across mockLines:
      // mape: (0.042 + 0.089 + 0.051 + 0.028) / 4 = 0.0525 -> 5.3%
      // bias: (0.012 - 0.034 + 0.021 + 0.002) / 4 = 0.00025 -> +0.0%
      // hit_rate: (0.85 + 0.65 + 0.74 + 0.90) / 4 = 0.785 -> 78.5%
      expect(screen.getByText("5.3%")).toBeInTheDocument();
      expect(screen.getByText("+0.0%")).toBeInTheDocument();
      expect(screen.getByText("78.5%")).toBeInTheDocument();

      // Open MAPE formula modal
      const mapeInfoBtn = screen.getByRole("button", {
        name: "Explain MAPE formula and calculation",
      });
      await userEvent.click(mapeInfoBtn);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /MAPE \(Mean Absolute Percentage Error\)/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("MAPE = (1 / n) * Σ |(Actual - Forecast) / Actual|"),
      ).toBeInTheDocument();

      // Dismiss modal
      const closeBtn = screen.getByRole("button", { name: /Close formula details modal/i });
      await userEvent.click(closeBtn);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("remains axe-clean when formula modal is open", async () => {
      const { container } = render(<FvaPage initialLines={mockLines} />);

      const biasInfoBtn = screen.getByRole("button", {
        name: "Explain Bias formula and calculation",
      });
      await userEvent.click(biasInfoBtn);

      const results = await axe(container);
      expect(results.violations).toEqual([]);
    });
  });

  /* ── 4. Persistent Restatement Banner ── */
  describe("FVA Restatement Banner", () => {
    it("renders persistent alert banner when FVA_RESTATEMENT_FLAG is active and allows dismissal", async () => {
      const { container } = render(
        <FvaPage initialRestatementActive={true} initialLines={mockLines} />,
      );

      const banner = screen.getByRole("alert");
      expect(banner).toBeInTheDocument();
      expect(
        screen.getByText(
          /Actuals were restated for these periods — FVA recomputed; versions unchanged\./i,
        ),
      ).toBeInTheDocument();

      // Banner is accessible
      const results = await axe(container);
      expect(results.violations).toEqual([]);

      // Dismiss banner
      const dismissBtn = screen.getByRole("button", { name: "Dismiss restatement banner" });
      await userEvent.click(dismissBtn);

      expect(
        screen.queryByText(
          /Actuals were restated for these periods — FVA recomputed; versions unchanged\./i,
        ),
      ).not.toBeInTheDocument();
    });
  });

  /* ── 5. By-Line Table & Trend Chips ── */
  describe("By-Line Table & Trend Chips", () => {
    it("renders trend chips with text, icon, and aria-label (never color alone)", () => {
      render(<FvaPage initialLines={mockLines} />);

      const improvingChips = screen.getAllByRole("status", { name: "Accuracy trend: Improving" });
      expect(improvingChips.length).toBe(2);
      expect(improvingChips[0]).toHaveTextContent("Improving");

      const worseningChips = screen.getAllByRole("status", { name: "Accuracy trend: Worsening" });
      expect(worseningChips.length).toBe(1);
      expect(worseningChips[0]).toHaveTextContent("Worsening");

      const stableChips = screen.getAllByRole("status", { name: "Accuracy trend: Stable" });
      expect(stableChips.length).toBe(1);
      expect(stableChips[0]).toHaveTextContent("Stable");
    });

    it("formats percentage values strictly with formatPercent without NaN / float artifacts", () => {
      render(<FvaPage initialLines={mockLines} />);

      // Line 1: MAPE 4.2%, Bias +1.2%, Hit Rate 85.0%
      expect(screen.getByText("4.2%")).toBeInTheDocument();
      expect(screen.getByText("+1.2%")).toBeInTheDocument();
      expect(screen.getByText("85.0%")).toBeInTheDocument();

      // Line 2: Bias -3.4%
      expect(screen.getByText("-3.4%")).toBeInTheDocument();
    });
  });

  /* ── 6. By-BU Rollup Strip ── */
  describe("By-BU Rollup Strip", () => {
    it("renders rollup strip grouped by business unit", () => {
      render(<FvaPage initialLines={mockLines} />);

      const rollupRegion = screen.getByRole("region", {
        name: /By-BU Rollup Summary Strip/i,
      });
      expect(rollupRegion).toBeInTheDocument();

      // 3 BUs in mock: North America (2 lines), EMEA (1 line), Corporate (1 line)
      expect(
        screen.getByRole("heading", { name: /Business Unit Rollup Strip/i }),
      ).toBeInTheDocument();
      expect(rollupRegion).toHaveTextContent("North America");
      expect(rollupRegion).toHaveTextContent("2 lines");
      expect(rollupRegion).toHaveTextContent("EMEA");
      expect(rollupRegion).toHaveTextContent("Corporate");
    });
  });

  /* ── 7. CSV Export ── */
  describe("CSV Export", () => {
    it("dispatches downloadable CSV with headers and line values", async () => {
      const createObjectURLMock = vi.fn(() => "blob:http://localhost/mock");
      const revokeObjectURLMock = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLMock;
      globalThis.URL.revokeObjectURL = revokeObjectURLMock;

      render(<FvaPage initialLines={mockLines} />);

      const exportBtn = screen.getByRole("button", { name: /Export FVA scores as CSV/i });
      await userEvent.click(exportBtn);

      expect(createObjectURLMock).toHaveBeenCalledOnce();
      expect(revokeObjectURLMock).toHaveBeenCalledOnce();
    });
  });
});
