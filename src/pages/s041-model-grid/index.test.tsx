import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ModelGridPage } from "./index";
import { useModelGridStore } from "@/stores/model";
import { createDefaultSettings, useSettingsStore } from "@/stores/settings";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock } = vi.hoisted(() => ({ companyIdMock: vi.fn() }));
vi.mock("@/stores/session", () => {
  const getState = () => ({ companyId: companyIdMock(), companyName: "Meridian" });
  const useSessionStore = ((selector: (s: unknown) => unknown) =>
    selector(getState())) as unknown as (typeof import("@/stores/session"))["useSessionStore"];
  Object.assign(useSessionStore, { getState });
  return { useSessionStore };
});

/**
 * The toolbar ScenarioPicker reads `useScenarioStore` (scenarios of the active Model). Keep the
 * grid tests deterministic by supplying a fixed list instead of letting the real store round-trip
 * through the mocked bridge (its `model.list` answers are not scenario-shaped).
 */
const { scenarioStoreState } = vi.hoisted(() => ({
  scenarioStoreState: {
    status: "populated",
    error: null,
    scenarios: [
      {
        id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
        model_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000001",
        name: "Base",
        kind: "budget",
        state: "draft",
        parent_scenario_id: null,
        baseline: false,
        versions: [],
      },
      {
        id: "5c4f1a2b-9d3e-4c7a-8b2f-000000000001",
        model_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000001",
        name: "FY26 Plan",
        kind: "forecast",
        state: "locked",
        parent_scenario_id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
        baseline: true,
        versions: [
          {
            id: "5c4f1a2b-9d3e-4c7a-8b2f-100000000001",
            version_no: 1,
            label: "v1",
            reason: null,
            created_at: "",
          },
        ],
      },
    ],
    load: async () => undefined,
    retry: async () => undefined,
  },
}));
vi.mock("@/stores/scenarios", () => ({
  useScenarioStore: (selector: (s: unknown) => unknown) => selector(scenarioStoreState),
}));

const CO = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const LINE = "3f9f2c9e-9f8b-4e2d-9a1c-400000000010";

const ACCOUNTS = [
  { id: LINE, code: "4000", name: "Revenue" },
  { id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000011", code: "4100", name: "Software Licenses" },
];

const CALENDAR = {
  fiscal_years: [
    {
      fy_label: "FY2026",
      periods: [
        { period_no: 1, code: "P01" },
        { period_no: 2, code: "P02" },
        { period_no: 3, code: "P03" },
        { period_no: 4, code: "P04" },
        { period_no: 5, code: "P05" },
        { period_no: 6, code: "P06" },
        { period_no: 7, code: "P07" },
        { period_no: 8, code: "P08" },
        { period_no: 9, code: "P09" },
        { period_no: 10, code: "P10" },
        { period_no: 11, code: "P11" },
        { period_no: 12, code: "P12" },
      ],
    },
  ],
};

function mockLoad() {
  callMock.mockImplementation((cmd: string) => {
    if (cmd === "coa.list") return Promise.resolve(ACCOUNTS);
    if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
    return Promise.resolve({});
  });
}

function renderPage() {
  return render(
    // `<main>` mirrors the app shell's content landmark so the axe `region` rule passes.
    <main>
      <MemoryRouter initialEntries={["/app/model/grid"]}>
        <Routes>
          <Route path="/app/model/grid" element={<ModelGridPage />} />
          <Route path="/app/model/packs" element={<div>packs screen</div>} />
        </Routes>
      </MemoryRouter>
    </main>,
  );
}

/**
 * AG Grid + the in-process HyperFormula graph render asynchronously (~1.5s), so the default
 * 1000ms query timeout is too tight. Wait on the first data cell (`col-id="p-{period_id}"`,
 * row 0 = first line) with a generous budget instead of relying on `findByText`.
 */
async function waitForGridCell(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(
    () => {
      expect(container.querySelector('[col-id="p-fp-2026-p01"]')).not.toBeNull();
    },
    { timeout: 8000 },
  );
  return container.querySelector('[col-id="p-fp-2026-p01"]') as HTMLElement;
}

describe("S-041 Model Grid (F-012)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
    useModelGridStore.getState().reset();
    useSettingsStore.setState({
      preferences: {
        ...createDefaultSettings("en-US"),
        displayThousands: false,
        displayDecimals: "2",
      },
    });
  });

  it("renders the loading state while data is in flight", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "coa.list") return new Promise(() => undefined);
      return Promise.resolve({});
    });
    renderPage();
    expect(screen.getByRole("heading", { name: "Model Grid" })).toBeInTheDocument();
    // The StatePanel loading role is announced.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the empty state with a Pack Studio action when there are no lines", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "coa.list") return Promise.resolve([]);
      if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
      return Promise.resolve({});
    });
    renderPage();
    expect(await screen.findByText(/No lines/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Browse Pack Studio/ }));
    expect(await screen.findByText("packs screen")).toBeInTheDocument();
  });

  it("renders the error state with the locked code and a working Retry", async () => {
    callMock.mockRejectedValue({
      code: "FILE_CORRUPT",
      userMessage: "This Company file could not be read.",
      httpStatus: 500,
      retryable: true,
    });
    const { container } = renderPage();
    expect(
      await screen.findByText("This Company file could not be read.", {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("FILE_CORRUPT")).toBeInTheDocument();

    // Retry succeeds on the second attempt.
    mockLoad();
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    const cell = await waitForGridCell(container);
    expect(screen.getByText("4000 · Revenue")).toBeInTheDocument();
    expect(cell).not.toBeNull();
  }, 20000);

  it("renders the populated grid with money cells at the persisted density", async () => {
    useSettingsStore.setState((state) => ({
      preferences: { ...state.preferences, density: "compact" },
    }));
    mockLoad();
    const { container } = renderPage();
    await waitForGridCell(container);
    expect(screen.getByTestId("model-grid")).toHaveAttribute("data-density", "compact");
    expect(container.querySelector(".ag-row")).toHaveStyle({ height: "28px" });
    // S-040/S-041 scenario switcher sits in the toolbar with the current Scenario selected.
    expect(screen.getByRole("combobox", { name: "Scenario" })).toHaveValue(
      "3f9f2c9e-9f8b-4e2d-9a1c-400000000003",
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
    // Line rows from coa.list render in the AG Grid.
    expect(screen.getByText("4000 · Revenue")).toBeInTheDocument();
    expect(screen.getByText("4100 · Software Licenses")).toBeInTheDocument();
    // Period headers.
    expect(screen.getByText("P01")).toBeInTheDocument();
    expect(screen.getByText("P02")).toBeInTheDocument();
    // Empty cells render as dash (MoneyCell empty state), never a float.
    await waitFor(() => {
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
  }, 20000);

  it("edits a cell through the formula bar, shows the exact amount, and emits the audit", async () => {
    mockLoad();
    const { container } = renderPage();
    // Select the first line's first-period cell via its AG Grid `col-id` (each data cell is a
    // `role=gridcell` div carrying `col-id="p-{period_id}"`; row 0 = first line).
    const cell = await waitForGridCell(container);
    expect(screen.getByText("4000 · Revenue")).toBeInTheDocument();
    await userEvent.click(cell);

    const formulaBar = screen.getByLabelText("Formula bar");
    await userEvent.type(formulaBar, "182500.00");
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 9001,
    });
    await userEvent.click(screen.getByRole("button", { name: /Apply/ }));

    // model.cell.set.v1 is called (audited write) and the exact amount renders.
    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith("model.cell.set.v1", {
        line_id: LINE,
        scenario_id: expect.any(String),
        period_id: "fp-2026-p01",
        value: "182500.00",
        formula: null,
        manual_override: false,
      });
    });
    expect(await screen.findByText(/audit #9001/)).toBeInTheDocument();
    // MoneyCell formats the exact decimal string — it appears in the edited period cell AND the
    // derived YTD/FY columns (the line's only value feeds both), hence findAll.
    expect(await screen.findAllByText("USD 182,500.00", {}, { timeout: 8000 })).not.toHaveLength(0);
  }, 20000);

  it("edits a formula via the formula bar and the engine computes the result", async () => {
    mockLoad();
    const { container } = renderPage();
    const cell = await waitForGridCell(container);
    expect(screen.getByText("4000 · Revenue")).toBeInTheDocument();
    await userEvent.click(cell);

    const formulaBar = screen.getByLabelText("Formula bar");
    await userEvent.type(formulaBar, "=1+1");
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 9002,
    });
    await userEvent.click(screen.getByRole("button", { name: /Apply/ }));
    // The real HyperFormula graph (in-process transport in jsdom) computes =1+1 → 2. It appears
    // in the edited period cell and the derived YTD/FY columns, so findAll is required.
    expect(await screen.findAllByText("USD 2.00", {}, { timeout: 8000 })).not.toHaveLength(0);
  }, 20000);

  it("keeps the grid axe-clean", async () => {
    mockLoad();
    renderPage();
    await screen.findByText("4000 · Revenue");
    await waitFor(() => {
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
    const results = await axe(document.body);
    // a11y gate (ACCESSIBILITY.md §3): zero violations of WCAG 2.2 AA rules.
    expect(results.violations).toEqual([]);
  });
});

describe("S-041 Model Grid — M3-9 Excel-parity toolbar (F-012)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
    useModelGridStore.getState().reset();
    useSettingsStore.setState({
      preferences: {
        ...createDefaultSettings("en-US"),
        displayThousands: false,
        displayDecimals: "2",
      },
    });
  });

  it("undo/redo via the toolbar reverts and re-applies the last edit", async () => {
    mockLoad();
    const { container } = renderPage();
    const cell = await waitForGridCell(container);
    await userEvent.click(cell);
    const formulaBar = screen.getByLabelText("Formula bar");
    await userEvent.type(formulaBar, "182500.00");
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 9001,
    });
    await userEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:fp-2026-p01`].amount_text).toBe(
        "182500.00",
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:fp-2026-p01`].amount_text).toBeNull(),
    );

    await userEvent.click(screen.getByRole("button", { name: /Redo/ }));
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:fp-2026-p01`].amount_text).toBe(
        "182500.00",
      ),
    );
  }, 20000);

  it("pastes a TSV block through the paste dialog", async () => {
    mockLoad();
    const { container } = renderPage();
    await waitForGridCell(container);
    const cell = container.querySelector('[col-id="p-fp-2026-p01"]') as HTMLElement;
    await userEvent.click(cell);
    await userEvent.click(screen.getByRole("button", { name: /Paste/ }));
    const textarea = await screen.findByLabelText(/Paste TSV/);
    await userEvent.type(textarea, "1.00\t2.00\n3.00\t4.00");
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 9003,
    });
    await userEvent.click(screen.getByRole("button", { name: /Insert/ }));
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:fp-2026-p01`].amount_text).toBe("1.00"),
    );
    expect(useModelGridStore.getState().cells[`${LINE}:fp-2026-p02`].amount_text).toBe("2.00");
    expect(useModelGridStore.getState().cells[`${ACCOUNTS[1].id}:fp-2026-p01`].amount_text).toBe(
      "3.00",
    );
  }, 20000);

  it("shows VALUE_INVALID from a bad paste and keeps the dialog open", async () => {
    mockLoad();
    const { container } = renderPage();
    await waitForGridCell(container);
    const cell = container.querySelector('[col-id="p-fp-2026-p01"]') as HTMLElement;
    await userEvent.click(cell);
    await userEvent.click(screen.getByRole("button", { name: /Paste/ }));
    const textarea = await screen.findByLabelText(/Paste TSV/);
    await userEvent.type(textarea, "USD 100");
    await userEvent.click(screen.getByRole("button", { name: /Insert/ }));
    await waitFor(() => expect(useModelGridStore.getState().status).toBe("error"));
    expect(useModelGridStore.getState().error?.code).toBe("VALUE_INVALID");
    // Dialog remains open so the user can correct the input.
    expect(screen.queryByLabelText(/Paste TSV/)).not.toBeNull();
  }, 20000);

  it("copy serializes the selection to the clipboard", async () => {
    mockLoad();
    const { container } = renderPage();
    await waitForGridCell(container);
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 9005,
    });
    await useModelGridStore
      .getState()
      .setCell({ line_id: LINE, period_id: "fp-2026-p01", value: "7.00" });
    useModelGridStore.getState().setActiveCell(LINE, "fp-2026-p01");
    useModelGridStore.getState().extendSelection(LINE, "fp-2026-p02");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      writable: true,
      configurable: true,
      value: { writeText },
    });
    await userEvent.click(screen.getByRole("button", { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const tsv = writeText.mock.calls[0][0] as string;
    expect(tsv.split("\n")[0].split("\t")).toEqual(["7.00", ""]);
  }, 20000);

  it("fill down copies the source value through the toolbar", async () => {
    mockLoad();
    const { container } = renderPage();
    await waitForGridCell(container);
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 9006,
    });
    await useModelGridStore
      .getState()
      .setCell({ line_id: LINE, period_id: "fp-2026-p01", value: "55.00" });
    useModelGridStore.getState().setActiveCell(LINE, "fp-2026-p01");
    useModelGridStore.getState().extendSelection(ACCOUNTS[1].id, "fp-2026-p01");
    await userEvent.click(screen.getByRole("button", { name: /Fill down/ }));
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${ACCOUNTS[1].id}:fp-2026-p01`].amount_text).toBe(
        "55.00",
      ),
    );
  }, 20000);
});
