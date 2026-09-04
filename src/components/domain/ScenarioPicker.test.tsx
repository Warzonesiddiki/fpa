import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ScenarioPicker } from "./ScenarioPicker";

/**
 * ScenarioPicker is a controlled toolbar widget: the scenario list comes from the S-050 store,
 * the active id + switch come from the model grid store. Verify dropdown contents, state badge,
 * retry affordance, the "manage" link, and a11y — the worker rebuild on switch is covered by the
 * model-store tests (`setScenario`).
 */
const { SC_BASE, seedScenarios, scenarioState, gridState, setScenarioState, setGridState } =
  vi.hoisted(() => {
    const SC_BASE = "3f9f2c9e-9f8b-4e2d-9a1c-400000000003";
    const SC_PLAN = "5c4f1a2b-9d3e-4c7a-8b2f-000000000001";
    const seedScenarios = () => [
      {
        id: SC_BASE,
        name: "Base",
        kind: "budget",
        state: "draft",
        baseline: false,
      },
      {
        id: SC_PLAN,
        name: "FY26 Plan",
        kind: "forecast",
        state: "locked",
        baseline: true,
      },
    ];
    const scenarioState = {
      status: "populated",
      scenarios: seedScenarios(),
      load: vi.fn(async () => undefined),
    };
    const gridState = {
      scenarioId: SC_BASE,
      setScenario: vi.fn(async () => undefined),
    };
    return {
      SC_BASE,
      seedScenarios,
      scenarioState,
      gridState,
      setScenarioState: (patch: Partial<typeof scenarioState>) =>
        Object.assign(scenarioState, patch),
      setGridState: (patch: Partial<typeof gridState>) => Object.assign(gridState, patch),
    };
  });

vi.mock("@/stores/scenarios", () => ({
  useScenarioStore: (selector: (s: unknown) => unknown) => selector(scenarioState),
}));
vi.mock("@/stores/model", () => ({
  useModelGridStore: (selector: (s: unknown) => unknown) => selector(gridState),
}));

function renderPicker() {
  return render(
    <main>
      <MemoryRouter initialEntries={["/app/model/grid"]}>
        <ScenarioPicker />
      </MemoryRouter>
    </main>,
  );
}

describe("ScenarioPicker (S-041 toolbar · S-040 switcher)", () => {
  beforeEach(() => {
    setScenarioState({ status: "populated", scenarios: seedScenarios() });
    setGridState({ scenarioId: SC_BASE });
    (scenarioState.load as ReturnType<typeof vi.fn>).mockClear();
    (gridState.setScenario as ReturnType<typeof vi.fn>).mockClear();
  });

  it("shows the active Scenario with its state badge and lists every Scenario", () => {
    renderPicker();
    const select = screen.getByRole("combobox", { name: "Scenario" });
    expect(select).toHaveValue(scenarioState.scenarios[0].id);
    expect(screen.getByRole("option", { name: "Base" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "FY26 Plan" })).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows a Locked badge when the active Scenario is locked", () => {
    setGridState({ scenarioId: scenarioState.scenarios[1].id });
    renderPicker();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    // Colour is never the only signal (B11): the badge is a labelled text chip.
    expect(screen.getByText("Locked")).toHaveTextContent("Locked");
  });

  it("switches the grid store's active Scenario on change", async () => {
    renderPicker();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Scenario" }), [
      scenarioState.scenarios[1].id,
    ]);
    expect(gridState.setScenario).toHaveBeenCalledWith(scenarioState.scenarios[1].id);
  });

  it("does not reload the grid when the same Scenario is re-selected", async () => {
    renderPicker();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Scenario" }), [
      scenarioState.scenarios[0].id,
    ]);
    expect(gridState.setScenario).not.toHaveBeenCalled();
  });

  it("loads the list on first mount only when it has not been loaded yet", () => {
    setScenarioState({ status: "loading" });
    renderPicker();
    expect(scenarioState.load).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when the scenario list failed to load", async () => {
    setScenarioState({ status: "error", scenarios: [] });
    renderPicker();
    expect(screen.getByRole("combobox", { name: "Scenario" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(scenarioState.load).toHaveBeenCalledTimes(1);
  });

  it("links to the S-050 Scenario Manager", () => {
    renderPicker();
    expect(screen.getByRole("link", { name: "Manage scenarios" })).toHaveAttribute(
      "href",
      "/app/plan/scenarios",
    );
  });

  it("keeps the picker axe-clean", async () => {
    renderPicker();
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
