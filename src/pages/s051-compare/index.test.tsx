import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ComparePage } from "./index";
import { useCompareStore } from "@/stores/compare";
import { useScenarioStore } from "@/stores/scenarios";
import type { ScenarioRow, ModelDiffRow } from "@/api/schema";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const SC_A = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const SC_B = "3f9f2c9e-9f8b-4e2d-9a1c-000000000002";

function makeScenario(overrides: Partial<ScenarioRow> = {}): ScenarioRow {
  return {
    id: SC_A,
    model_id: "mod-1",
    name: "Base",
    kind: "budget",
    state: "draft",
    parent_scenario_id: null,
    baseline: false,
    versions: [],
    ...overrides,
  };
}

function makeDiffRow(overrides: Partial<ModelDiffRow> = {}): ModelDiffRow {
  return {
    line_id: "ln-rev",
    sheet_id: "sh-rev",
    sheet_name: "Revenue",
    line_name: "Subscription Revenue",
    account_id: null,
    driver_id: null,
    driver_name: null,
    period_id: "fp-2027-p01",
    period_label: "2027-P01",
    value_a: "100.00",
    value_a_minor: 10000,
    formula_a: null,
    value_b: "120.00",
    value_b_minor: 12000,
    formula_b: null,
    delta_minor: 2000,
    delta_text: "2000",
    delta_pct: 0.2,
    is_changed: true,
    ...overrides,
  };
}

describe("S-051 Model Compare page (F-022 · M4-3 · SCREENS-SPEC S-051)", () => {
  beforeEach(() => {
    useCompareStore.getState().reset();
    useScenarioStore.setState({
      status: "populated",
      scenarios: [
        makeScenario({ id: SC_A, name: "Base Scenario" }),
        makeScenario({ id: SC_B, name: "Upside Scenario" }),
      ],
      error: null,
    });
    callMock.mockReset();
  });

  it("renders the empty initial state and remains axe-clean", async () => {
    render(<ComparePage />);
    expect(screen.getByRole("heading", { name: /Model Compare/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Select two Scenarios to compare their cell values/i),
    ).toBeInTheDocument();
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });

  it("renders the loading state with role=status", () => {
    useCompareStore.setState({ status: "loading" });
    render(<ComparePage />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the error state with code and retry action", async () => {
    useCompareStore.setState({
      status: "error",
      error: {
        code: "COMPARE_INCOMPATIBLE",
        userMessage: "Cannot compare: Models/COAs differ. Select two Scenarios of the same Model.",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
      scenarioA: SC_A,
      scenarioB: SC_B,
    });
    render(<ComparePage />);

    expect(screen.getByText(/Cannot compare: Models\/COAs differ/i)).toBeInTheDocument();
    expect(screen.getByText(/COMPARE_INCOMPATIBLE/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    expect(retryBtn).toBeInTheDocument();

    callMock.mockResolvedValueOnce({ diff_rows: [makeDiffRow()] });
    await userEvent.click(retryBtn);

    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith("model.diff", expect.any(Object));
    });
  });

  it("allows selecting scenarios and comparing them", async () => {
    callMock.mockResolvedValueOnce({
      diff_rows: [
        makeDiffRow(),
        makeDiffRow({
          line_id: "ln-cogs",
          line_name: "Server Hosting",
          period_id: "fp-2027-p02",
          period_label: "2027-P02",
          is_changed: false,
          delta_minor: 0,
          delta_pct: 0,
        }),
      ],
    });

    render(<ComparePage />);

    const selectA = screen.getByRole("combobox", { name: /Scenario A/i });
    const selectB = screen.getByRole("combobox", { name: /Scenario B/i });

    await userEvent.selectOptions(selectA, SC_A);
    await userEvent.selectOptions(selectB, SC_B);

    const compareBtn = screen.getAllByRole("button", { name: /^Compare$/i })[0];
    await userEvent.click(compareBtn);

    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith("model.diff", {
        scenario_a: SC_A,
        version_a: null,
        scenario_b: SC_B,
        version_b: null,
      });
    });

    expect(screen.getByText("Subscription Revenue")).toBeInTheDocument();
    expect(screen.getByText("+20.0%")).toBeInTheDocument();
  });

  it("toggles only-changed filter", async () => {
    useCompareStore.setState({
      status: "populated",
      scenarioA: SC_A,
      scenarioB: SC_B,
      filterOnlyChanged: true,
      diffRows: [
        makeDiffRow({ line_name: "Changed Row", is_changed: true }),
        makeDiffRow({
          line_name: "Unchanged Row",
          is_changed: false,
          delta_minor: 0,
          delta_pct: 0,
        }),
      ],
    });

    render(<ComparePage />);

    // Initially only changed row is visible
    expect(screen.getByText("Changed Row")).toBeInTheDocument();
    expect(screen.queryByText("Unchanged Row")).not.toBeInTheDocument();

    // Toggle filter
    const toggleBtn = screen.getByRole("button", { name: /Only changed/i });
    await userEvent.click(toggleBtn);

    expect(screen.getByText("Unchanged Row")).toBeInTheDocument();
  });

  it("renders success state when scenarios are identical", () => {
    useCompareStore.setState({
      status: "success",
      scenarioA: SC_A,
      scenarioB: SC_B,
      diffRows: [],
    });

    render(<ComparePage />);
    expect(
      screen.getByText(/The selected Scenarios are identical — no differences found/i),
    ).toBeInTheDocument();
  });

  it("renders populated diff table and keeps it axe-clean", async () => {
    useCompareStore.setState({
      status: "populated",
      scenarioA: SC_A,
      scenarioB: SC_B,
      diffRows: [
        makeDiffRow(),
        makeDiffRow({
          line_id: "ln-cogs",
          line_name: "Hosting",
          delta_minor: -500,
          delta_pct: -0.05,
        }),
      ],
    });

    render(<ComparePage />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
