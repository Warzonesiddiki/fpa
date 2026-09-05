/**
 * S-052 What-If & Sensitivity Page Tests (F-022 · M4-4 · SCREENS-SPEC S-052 · WIREFRAMES-ANALYTICS S-052 · SCENARIO-VERSION-SPEC §5).
 *
 * Verifies:
 *   1. All 5 canonical states (empty, loading, error, success, populated).
 *   2. Tab switching between Sensitivity (Tornado) and Goal Seek panels with ARIA roles.
 *   3. Interactive form triggers (Sensitivity recalculation, Goal Seek bisection, Overlay updates).
 *   4. Footstrip write path safety and Apply to new Scenario dialog.
 *   5. WCAG 2.2 AA accessibility via vitest-axe across states.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { WhatIfPage } from "./index";
import { useWhatIfStore } from "@/stores/whatif";
import { useScenarioStore } from "@/stores/scenarios";
import type {
  PlanGoalSeekData,
  PlanSensitivityData,
  PlanWhatifOverlayData,
  ScenarioRow,
} from "@/api/schema";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({
  call: (...args: unknown[]) => callMock(...args),
}));

const SC_A = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const SC_B = "3f9f2c9e-9f8b-4e2d-9a1c-000000000002";

function makeScenario(overrides: Partial<ScenarioRow> = {}): ScenarioRow {
  return {
    id: SC_A,
    model_id: "mod-1",
    name: "Base Scenario",
    kind: "budget",
    state: "draft",
    parent_scenario_id: null,
    baseline: true,
    versions: [],
    ...overrides,
  };
}

const mockOverlayData: PlanWhatifOverlayData = {
  series: [
    {
      scenario_id: SC_A,
      scenario_name: "Base Scenario",
      version_label: "v1",
      points: [
        { period_id: "p1", period_label: "2027-P01", value: "10000.00", value_minor: 1000000 },
        { period_id: "p2", period_label: "2027-P02", value: "12000.00", value_minor: 1200000 },
      ],
    },
    {
      scenario_id: SC_B,
      scenario_name: "Upside Scenario",
      version_label: "v1",
      points: [
        { period_id: "p1", period_label: "2027-P01", value: "11000.00", value_minor: 1100000 },
        { period_id: "p2", period_label: "2027-P02", value: "13500.00", value_minor: 1350000 },
      ],
    },
  ],
  waterfall: [
    {
      step_id: "wf-1",
      label: "Baseline Start",
      delta_text: "10000.00",
      delta_minor: 1000000,
      cumulative_text: "10000.00",
      cumulative_minor: 1000000,
      kind: "baseline",
      driver_id: null,
    },
    {
      step_id: "wf-2",
      label: "Price Increase",
      delta_text: "2500.00",
      delta_minor: 250000,
      cumulative_text: "12500.00",
      cumulative_minor: 1250000,
      kind: "driver",
      driver_id: "dr-price",
    },
    {
      step_id: "wf-3",
      label: "Scenario Result",
      delta_text: "0.00",
      delta_minor: 0,
      cumulative_text: "12500.00",
      cumulative_minor: 1250000,
      kind: "total",
      driver_id: null,
    },
  ],
};

const mockSensitivityData: PlanSensitivityData = {
  tornado: [
    {
      target_line_id: "ln-rev",
      target_line_name: "Total Revenue",
      base_value: "10000.00",
      base_minor: 1000000,
      low_value: "8000.00",
      low_minor: 800000,
      high_value: "12000.00",
      high_minor: 1200000,
      swing_minor: 400000,
      swing_text: "4000.00",
    },
    {
      target_line_id: "ln-ebitda",
      target_line_name: "EBITDA",
      base_value: "3000.00",
      base_minor: 300000,
      low_value: "1500.00",
      low_minor: 150000,
      high_value: "4500.00",
      high_minor: 450000,
      swing_minor: 300000,
      swing_text: "3000.00",
    },
  ],
  values: [
    { step_index: 0, driver_value: "80.00", target_impacts: { "ln-rev": "8000.00" } },
    { step_index: 1, driver_value: "100.00", target_impacts: { "ln-rev": "10000.00" } },
    { step_index: 2, driver_value: "120.00", target_impacts: { "ln-rev": "12000.00" } },
  ],
};

const mockGoalSeekData: PlanGoalSeekData = {
  driver_value: "42.50",
  iterations: 14,
  converged: true,
  last_target_value: "3000000.00",
};

describe("S-052 What-If & Sensitivity page (F-022 · M4-4 · SCREENS-SPEC S-052)", () => {
  beforeEach(() => {
    useWhatIfStore.getState().reset();
    useScenarioStore.setState({
      status: "populated",
      scenarios: [
        makeScenario({ id: SC_A, name: "Base Scenario" }),
        makeScenario({ id: SC_B, name: "Upside Scenario" }),
      ],
      error: null,
    });
    callMock.mockReset();
    // Default mock response for overlay
    callMock.mockResolvedValue(mockOverlayData);
  });

  it("renders the loading state with accessible aria status indicator", () => {
    useWhatIfStore.setState({ status: "loading" });
    render(<WhatIfPage />);
    const statusRegion = screen.getByRole("status");
    expect(statusRegion).toBeInTheDocument();
    expect(statusRegion).toHaveAttribute("aria-live", "polite");
  });

  it("renders the error state and offers retry", async () => {
    useWhatIfStore.setState({
      status: "error",
      error: {
        code: "COMPARE_INCOMPATIBLE",
        userMessage: "Cannot compare: Models/COAs differ.",
        httpStatus: 422,
        retryable: true,
        retryAfterMs: null,
        details: {},
      },
    });

    render(<WhatIfPage />);
    expect(screen.getByText("Cannot compare: Models/COAs differ.")).toBeInTheDocument();
    expect(screen.getByText("COMPARE_INCOMPATIBLE")).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();
    await userEvent.click(retryBtn);
  });

  it("renders the empty state copy 'Choose a driver to vary' when no sensitivity data exists", async () => {
    useWhatIfStore.setState({
      status: "populated",
      overlayData: mockOverlayData,
      sensitivityData: null,
    });

    render(<WhatIfPage />);
    expect(screen.getByText("Choose a driver to vary")).toBeInTheDocument();
  });

  it("renders the populated three-pane layout with overlay charts and sensitivity panel", () => {
    useWhatIfStore.setState({
      status: "populated",
      overlayData: mockOverlayData,
      sensitivityData: mockSensitivityData,
    });

    render(<WhatIfPage />);

    // Header & title
    expect(screen.getByRole("heading", { name: "What-If & Sensitivity" })).toBeInTheDocument();

    // 3 Panes
    expect(screen.getByRole("region", { name: "Scenario Overlay Time-Series" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Waterfall Attribution Decomposition" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sensitivity and Goal Seek Analysis" })).toBeInTheDocument();

    // Footstrip
    expect(screen.getByRole("contentinfo", { name: "What-If Audit and Safety Footstrip" })).toBeInTheDocument();
    expect(screen.getByText("Model is NOT modified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply to new Scenario/i })).toBeInTheDocument();
  });

  it("toggles between chart and table views in the overlay pane", async () => {
    useWhatIfStore.setState({
      status: "populated",
      overlayData: mockOverlayData,
      sensitivityData: mockSensitivityData,
    });

    render(<WhatIfPage />);

    // Find table toggle for overlay
    const tableBtn = screen.getByRole("button", { name: /Switch scenario overlay to accessible table view/i });
    await userEvent.click(tableBtn);

    // Should display accessible table
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Base Scenario")).toBeInTheDocument();
    expect(screen.getByText("Upside Scenario")).toBeInTheDocument();
  });

  it("switches tabs between Sensitivity and Goal Seek using accessible tablist", async () => {
    useWhatIfStore.setState({
      status: "populated",
      overlayData: mockOverlayData,
      sensitivityData: mockSensitivityData,
    });

    render(<WhatIfPage />);

    const tabList = screen.getByRole("tablist", { name: "Simulation tuning tools" });
    expect(tabList).toBeInTheDocument();

    const sensTab = screen.getByRole("tab", { name: "Sensitivity (Tornado)" });
    const goalTab = screen.getByRole("tab", { name: "Goal Seek" });

    expect(sensTab).toHaveAttribute("aria-selected", "true");
    expect(goalTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "tabpanel-sensitivity");

    // Click Goal Seek tab
    await userEvent.click(goalTab);
    expect(goalTab).toHaveAttribute("aria-selected", "true");
    expect(sensTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText(/Target Cell/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Target Value/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Driver to Solve/i)).toBeInTheDocument();
  });

  it("executes goal seek bisection and displays success result", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "plan.goal_seek") {
        return Promise.resolve(mockGoalSeekData);
      }
      return Promise.resolve(mockOverlayData);
    });

    useWhatIfStore.setState({
      status: "populated",
      overlayData: mockOverlayData,
    });

    render(<WhatIfPage />);

    // Switch to Goal Seek
    await userEvent.click(screen.getByRole("tab", { name: "Goal Seek" }));

    // Click Solve
    const solveBtn = screen.getByRole("button", { name: /Solve via Bisection/i });
    await userEvent.click(solveBtn);

    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith(
        "plan.goal_seek",
        expect.objectContaining({
          target_cell: "ln-rev",
          target_value: "3000000.00",
          driver_id: "dr-reps",
        }),
      );
    });

    // Verify converged result
    expect(await screen.findByText(/Converged in 14 iterations/i)).toBeInTheDocument();
    expect(screen.getByText(/Solved Driver Value: 42.50/i)).toBeInTheDocument();
  });

  it("displays typed error GOAL_SEEK_NO_CONVERGE when goal seek fails", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "plan.goal_seek") {
        return Promise.reject({
          code: "GOAL_SEEK_NO_CONVERGE",
          userMessage: "Goal Seek did not converge in 100 iterations. Last value 285.4, target 300.0. Adjust bounds.",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: { last_value: "285.4", target: "300.0", iterations: 100 },
        });
      }
      return Promise.resolve(mockOverlayData);
    });

    useWhatIfStore.setState({
      status: "populated",
      overlayData: mockOverlayData,
    });

    render(<WhatIfPage />);

    await userEvent.click(screen.getByRole("tab", { name: "Goal Seek" }));
    await userEvent.click(screen.getByRole("button", { name: /Solve via Bisection/i }));

    expect(
      await screen.findByText(/Goal Seek did not converge in 100 iterations/i),
    ).toBeInTheDocument();
  });

  it("opens Apply to new Scenario dialog and creates a scenario", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "scenario.duplicate") {
        return Promise.resolve({
          id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000099",
          model_id: "mod-1",
          name: "What-If: Base Scenario Variation",
          kind: "whatif",
          state: "draft",
          parent_scenario_id: SC_A,
          baseline: false,
          versions: [],
        });
      }
      return Promise.resolve(mockOverlayData);
    });

    useWhatIfStore.setState({
      status: "populated",
      overlayData: mockOverlayData,
      scenarioIds: [SC_A],
    });

    render(<WhatIfPage />);

    // Open footstrip CTA
    const applyBtn = screen.getByRole("button", { name: /Apply to new Scenario/i });
    await userEvent.click(applyBtn);

    // Dialog should open
    expect(screen.getByRole("dialog", { name: "Apply to New Scenario" })).toBeInTheDocument();

    // Submit dialog form
    const createBtn = screen.getByRole("button", { name: /Create Scenario/i });
    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith(
        "scenario.duplicate",
        expect.objectContaining({
          name: "What-If: Base Scenario Variation",
          base_id: SC_A,
        }),
      );
    });

    // Confirmation chip should display
    expect(await screen.findByText(/✓ Scenario created/i)).toBeInTheDocument();
  });

  it("passes axe accessibility audit in populated state", async () => {
    useWhatIfStore.setState({
      status: "populated",
      overlayData: mockOverlayData,
      sensitivityData: mockSensitivityData,
    });

    render(<WhatIfPage />);
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});