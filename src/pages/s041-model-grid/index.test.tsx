import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, RouterProvider, createBrowserRouter } from "react-router-dom";
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
    { timeout: 15000 },
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
    expect(screen.getAllByText("P01").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("P02").length).toBeGreaterThanOrEqual(1);
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
    const { container } = renderPage();
    await waitForGridCell(container);
    await waitFor(() => {
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
    const results = await axe(container);
    // a11y gate (ACCESSIBILITY.md §3): zero violations of WCAG 2.2 AA rules.
    expect(results.violations).toEqual([]);
  }, 20000);
});

describe("S-041 Model Grid - S-071 health drill deep link", () => {
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

  function renderWithSearchParams(query: string) {
    return render(
      <main>
        <MemoryRouter initialEntries={[`/app/model/grid?${query}`]}>
          <Routes>
            <Route path="/app/model/grid" element={<ModelGridPage />} />
          </Routes>
        </MemoryRouter>
      </main>,
    );
  }

  /**
   * Consumption (URL strip) is only observable against a REAL browser history —
   * MemoryRouter never touches window.location, and consumeDrillParams is a
   * history.replaceState by design (no router-state cascade). This harness mirrors
   * production: createBrowserRouter over the jsdom URL.
   */
  function renderWithBrowserRouter(query: string) {
    window.history.pushState({}, "", `/app/model/grid?${query}`);
    const router = createBrowserRouter([{ path: "/app/model/grid", element: <ModelGridPage /> }]);
    return render(<RouterProvider router={router} />);
  }

  it("focuses the named cell and consumes the params once the grid has data", async () => {
    mockLoad();
    const { container } = renderWithSearchParams(
      `line=${LINE}&scenario=3f9f2c9e-9f8b-4e2d-9a1c-400000000003&period=fp-2026-p02`,
    );
    await waitForGridCell(container);
    // AG Grid + the in-process HyperFormula graph settle asynchronously (~1.5s in
    // jsdom) — same budget as the rest of this suite.
    await waitFor(
      () => {
        // The active cell (drives the formula bar) is the finding's line × period.
        expect(useModelGridStore.getState().active).toEqual({
          lineId: LINE,
          periodId: "fp-2026-p02",
        });
      },
      { timeout: 8000 },
    );
    // The drill disarms once its target takes focus (AG Grid focus event) — the
    // whole lifecycle is observable in the store, independent of the router.
    await waitFor(() => {
      expect(useModelGridStore.getState().drillTarget).toBeNull();
    });
  }, 20000);

  it("strips the drill params from the real URL after landing (browser history)", async () => {
    mockLoad();
    const { container } = renderWithBrowserRouter(
      `line=${LINE}&scenario=3f9f2c9e-9f8b-4e2d-9a1c-400000000003&period=fp-2026-p02`,
    );
    await waitForGridCell(container);
    await waitFor(
      () => {
        expect(useModelGridStore.getState().active).toEqual({
          lineId: LINE,
          periodId: "fp-2026-p02",
        });
      },
      { timeout: 8000 },
    );
    // Non-vacuous here: createBrowserRouter drives the real jsdom history, so the
    // replaceState consumeDrillParams performs is observable in the URL.
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    // Reset jsdom history for the tests that follow.
    window.history.pushState({}, "", "/");
  }, 20000);

  it("drops a stale link whose line no longer exists instead of landing on fabricated data", async () => {
    mockLoad();
    renderWithSearchParams(`line=deleted-line&period=fp-2026-p02`);
    await waitFor(() => {
      // Stale link → drill dropped without landing (store disarms).
      expect(useModelGridStore.getState().drillTarget).toBeNull();
    });
    // The stale target never becomes the active cell (AG Grid keeps its own default focus).
    const active = useModelGridStore.getState().active;
    expect(active?.lineId ?? "").not.toBe("deleted-line");
  }, 20000);
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

  it("pastes Excel-style financial numbers normalized (AUDIT-02)", async () => {
    mockLoad();
    const { container } = renderPage();
    await waitForGridCell(container);
    const cell = container.querySelector('[col-id="p-fp-2026-p01"]') as HTMLElement;
    await userEvent.click(cell);
    await userEvent.click(screen.getByRole("button", { name: /Paste/ }));
    const textarea = await screen.findByLabelText(/Paste TSV/);
    // (500) = accounting negative, 1,250,000.00 = strict grouping — both normalize on paste.
    await userEvent.type(textarea, "(500)\t1,250,000.00");
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 9103,
    });
    await userEvent.click(screen.getByRole("button", { name: /Insert/ }));
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:fp-2026-p01`].amount_text).toBe("-500"),
    );
    expect(useModelGridStore.getState().cells[`${LINE}:fp-2026-p02`].amount_text).toBe(
      "1250000.00",
    );
    // The audit carries the normalized exact decimal strings, never the raw text.
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "model.cell.set.v1",
        expect.objectContaining({ line_id: LINE, period_id: "fp-2026-p01", value: "-500" }),
      ),
    );
    expect(callMock).toHaveBeenCalledWith(
      "model.cell.set.v1",
      expect.objectContaining({ line_id: LINE, period_id: "fp-2026-p02", value: "1250000.00" }),
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

  it("renders the PeriodStateBadge in the toolbar and updates when actuals are classified", async () => {
    mockLoad();
    const { container } = renderPage();
    await waitForGridCell(container);

    // Initial state without actuals is PLAN_ONLY
    const badge = screen.getByTestId("period-state-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-period-status", "PLAN_ONLY");
    expect(badge).toHaveTextContent("PLAN_ONLY");

    // Setting actuals updates the badge to HYBRID with canonical range
    useModelGridStore.getState().setActualPeriods(["fp-2026-p01"]);
    await waitFor(() => {
      expect(screen.getByTestId("period-state-badge")).toHaveAttribute(
        "data-period-status",
        "HYBRID",
      );
      expect(screen.getByTestId("period-state-badge")).toHaveTextContent(
        "HYBRID (Actual P01, Forecast P02–P12)",
      );
    });
  }, 20000);
});

describe("S-041 Model Grid — AUDIT-02 keyboard parity (Excel key map, F-012)", () => {
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

  /** Dispatch a native keydown (bubbles) at a grid cell — the page's capture-phase handler runs. */
  function keyAt(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  }

  async function gridReady(): Promise<HTMLElement> {
    mockLoad();
    const { container } = renderPage();
    const cell = await waitForGridCell(container);
    await userEvent.click(cell); // sets the active cell (LINE / fp-2026-p01)
    return cell;
  }

  async function editValue(value: string, auditId = 9100): Promise<void> {
    const formulaBar = screen.getByLabelText("Formula bar");
    await userEvent.type(formulaBar, value);
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: auditId,
    });
    await userEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:fp-2026-p01`].amount_text).toBe(value),
    );
  }

  const P1 = "fp-2026-p01";
  const P2 = "fp-2026-p02";

  // ── App-owned keys: the capture handler intercepts (preventDefault + stopPropagation) ──

  it("Ctrl+Z on the grid undoes the last edit (Excel parity)", async () => {
    const cell = await gridReady();
    await editValue("182500.00");
    expect(useModelGridStore.getState().canUndo).toBe(true);
    const ev = keyAt(cell, "z", { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true); // the app pre-empts AG Grid
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:${P1}`].amount_text).toBeNull(),
    );
    expect(useModelGridStore.getState().canUndo).toBe(false);
    expect(useModelGridStore.getState().canRedo).toBe(true);
  }, 20000);

  it("Ctrl+Shift+Z on the grid redoes the undone edit and re-issues the audit", async () => {
    const cell = await gridReady();
    await editValue("182500.00");
    keyAt(cell, "z", { ctrlKey: true });
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:${P1}`].amount_text).toBeNull(),
    );
    const ev = keyAt(cell, "z", { ctrlKey: true, shiftKey: true });
    expect(ev.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:${P1}`].amount_text).toBe("182500.00"),
    );
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "model.cell.set.v1",
        expect.objectContaining({ line_id: LINE, period_id: P1, value: "182500.00" }),
      ),
    );
  }, 20000);

  it("Ctrl+Y on the grid redoes (Windows alias)", async () => {
    const cell = await gridReady();
    await editValue("182500.00");
    keyAt(cell, "z", { ctrlKey: true });
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:${P1}`].amount_text).toBeNull(),
    );
    const ev = keyAt(cell, "y", { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:${P1}`].amount_text).toBe("182500.00"),
    );
  }, 20000);

  it("F2 on the grid focuses the formula bar", async () => {
    const cell = await gridReady();
    const ev = keyAt(cell, "F2");
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Formula bar")).toHaveFocus();
  }, 20000);

  it("Shift+ArrowDown extends the selection one row down", async () => {
    const cell = await gridReady();
    const ev = keyAt(cell, "ArrowDown", { shiftKey: true });
    expect(ev.defaultPrevented).toBe(true);
    const s = useModelGridStore.getState();
    expect(s.active).toEqual({ lineId: ACCOUNTS[1].id, periodId: P1 });
    expect(s.selection).toEqual({
      anchor: { lineId: LINE, periodId: P1 },
      focus: { lineId: ACCOUNTS[1].id, periodId: P1 },
    });
  }, 20000);

  it("Shift+ArrowRight extends the selection one period right from the focus", async () => {
    const cell = await gridReady();
    keyAt(cell, "ArrowDown", { shiftKey: true });
    keyAt(cell, "ArrowRight", { shiftKey: true });
    const s = useModelGridStore.getState();
    expect(s.selection?.focus).toEqual({ lineId: ACCOUNTS[1].id, periodId: P2 });
    expect(s.selection?.anchor).toEqual({ lineId: LINE, periodId: P1 }); // anchor pinned
  }, 20000);

  it("Shift+ArrowUp retracts the selection focus upward", async () => {
    const cell = await gridReady();
    keyAt(cell, "ArrowDown", { shiftKey: true });
    keyAt(cell, "ArrowUp", { shiftKey: true });
    const s = useModelGridStore.getState();
    expect(s.selection?.focus).toEqual({ lineId: LINE, periodId: P1 });
    expect(s.active).toEqual({ lineId: LINE, periodId: P1 });
  }, 20000);

  it("Shift+ArrowLeft retracts the selection focus leftward", async () => {
    const cell = await gridReady();
    keyAt(cell, "ArrowDown", { shiftKey: true });
    keyAt(cell, "ArrowRight", { shiftKey: true });
    keyAt(cell, "ArrowLeft", { shiftKey: true });
    expect(useModelGridStore.getState().selection?.focus).toEqual({
      lineId: ACCOUNTS[1].id,
      periodId: P1,
    });
  }, 20000);

  it("formula-bar Enter applies, normalizing an accounting negative (AUDIT-02)", async () => {
    await gridReady();
    const formulaBar = screen.getByLabelText("Formula bar");
    await userEvent.type(formulaBar, "(500)");
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 9101,
    });
    await userEvent.type(formulaBar, "{Enter}");
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "model.cell.set.v1",
        expect.objectContaining({ line_id: LINE, period_id: P1, value: "-500", formula: null }),
      ),
    );
    await waitFor(() =>
      expect(useModelGridStore.getState().cells[`${LINE}:${P1}`].amount_text).toBe("-500"),
    );
  }, 20000);

  it("formula-bar Enter normalizes thousands + currency (AUDIT-02)", async () => {
    await gridReady();
    const formulaBar = screen.getByLabelText("Formula bar");
    await userEvent.type(formulaBar, "$1,250,000.00");
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 9102,
    });
    await userEvent.type(formulaBar, "{Enter}");
    await waitFor(() =>
      expect(callMock).toHaveBeenCalledWith(
        "model.cell.set.v1",
        expect.objectContaining({
          line_id: LINE,
          period_id: P1,
          value: "1250000.00",
          formula: null,
        }),
      ),
    );
  }, 20000);

  it("formula-bar Escape cancels the pending entry (no audited write)", async () => {
    await gridReady();
    const formulaBar = screen.getByLabelText("Formula bar");
    await userEvent.type(formulaBar, "$1,250");
    await userEvent.type(formulaBar, "{Escape}");
    expect(formulaBar).toHaveValue("");
    expect(callMock).not.toHaveBeenCalledWith("model.cell.set.v1", expect.anything());
  }, 20000);

  it("Ctrl+Z inside the formula-bar input is left to the browser (text edit, not grid undo)", async () => {
    await gridReady();
    await editValue("182500.00");
    const formulaBar = screen.getByLabelText("Formula bar");
    await userEvent.click(formulaBar);
    await userEvent.clear(formulaBar); // the bar re-shows the cell value after a successful apply
    await userEvent.type(formulaBar, "abc");
    const ev = keyAt(formulaBar, "z", { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(false); // capture handler must not pre-empt typing
    const s = useModelGridStore.getState();
    expect(s.cells[`${LINE}:${P1}`].amount_text).toBe("182500.00"); // grid state untouched
    expect(s.canUndo).toBe(true); // history untouched
    expect(formulaBar).toHaveValue("abc");
  }, 20000);

  it("F2 inside the formula-bar input is left to the browser (no pre-emption)", async () => {
    await gridReady();
    const formulaBar = screen.getByLabelText("Formula bar");
    await userEvent.click(formulaBar);
    const ev = keyAt(formulaBar, "F2");
    expect(ev.defaultPrevented).toBe(false);
    expect(formulaBar).toHaveFocus();
  }, 20000);

  // ── AG-Grid-owned keys: the app must NOT own them (no history movement, no audited write) ──

  /**
   * Keys AG Grid handles natively (arrows, Tab): AG Grid's own handler legitimately
   * preventDefaults them in the browser, so the app-level contract is that the capture
   * handler neither touches the model nor the audit trail — navigation stays inside the grid.
   */
  for (const [label, key] of [
    ["ArrowDown", "ArrowDown"],
    ["ArrowUp", "ArrowUp"],
    ["ArrowLeft", "ArrowLeft"],
    ["ArrowRight", "ArrowRight"],
    ["Tab", "Tab"],
  ] as const) {
    it(`plain ${label} on the grid is left to AG Grid navigation (no model/audit mutation)`, async () => {
      const cell = await gridReady();
      const before = useModelGridStore.getState();
      const callsBefore = callMock.mock.calls.length;
      keyAt(cell, key);
      const s = useModelGridStore.getState();
      expect(s.canUndo).toBe(before.canUndo);
      expect(s.canRedo).toBe(before.canRedo);
      expect(callMock.mock.calls.length).toBe(callsBefore);
    }, 20000);
  }

  /** Keys nobody intercepts: neither the app capture handler nor AG Grid pre-empts them. */
  for (const [label, key] of [
    ["Enter", "Enter"],
    ["z without modifier", "z"],
    ["y without modifier", "y"],
  ] as const) {
    it(`plain ${label} on the grid is not pre-empted and mutates nothing`, async () => {
      const cell = await gridReady();
      const before = useModelGridStore.getState();
      const callsBefore = callMock.mock.calls.length;
      const ev = keyAt(cell, key);
      expect(ev.defaultPrevented).toBe(false);
      const s = useModelGridStore.getState();
      expect(s.canUndo).toBe(before.canUndo);
      expect(s.canRedo).toBe(before.canRedo);
      expect(callMock.mock.calls.length).toBe(callsBefore);
    }, 20000);
  }
});
