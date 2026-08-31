import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { FormulaInspectorPage } from "./index";

/**
 * S-042 drives `useModelGridStore` selectors directly (lines/periods/status/load/inspectCell),
 * so the test controls the store's 5 states via a mutable fixture instead of spinning up the
 * real HyperFormula graph. The S-041 test covers the store↔engine integration; here we verify
 * the page's state machine and rendering only.
 */
const { current, setStoreState, loadMock, inspectCellMock } = vi.hoisted(() => {
  const current = {
    status: "success",
    lines: [{ id: "L1", label: "4000 · Revenue", method: "manual" }],
    periods: [
      { id: "fp-2026-p01", code: "P01" },
      { id: "fp-2026-p02", code: "P02" },
    ],
    load: vi.fn(async () => undefined),
    inspectCell: vi.fn(),
  };
  return {
    current,
    setStoreState: (patch: Partial<typeof current>) => Object.assign(current, patch),
    loadMock: current.load,
    inspectCellMock: current.inspectCell,
  };
});

vi.mock("@/stores/model", () => ({
  useModelGridStore: (selector: (s: unknown) => unknown) => selector(current),
}));

const BASE_RESULT = {
  line_id: "L1",
  period_id: "fp-2026-p01",
  formula: "=B2+5",
  computed_text: "10.00",
  error_code: null,
  precedents: [{ line_id: "L2", period_id: "fp-2026-p01" }],
  dependents: [{ line_id: "L3", period_id: "fp-2026-p02" }],
  cycle: null,
  is_cycle: false,
};

function renderPage() {
  return render(
    // `<main>` mirrors the app shell's content landmark so the axe `region` rule passes.
    <main>
      <MemoryRouter initialEntries={["/app/model/inspect"]}>
        <Routes>
          <Route path="/app/model/inspect" element={<FormulaInspectorPage />} />
          <Route path="/app/model/grid" element={<div>grid screen</div>} />
        </Routes>
      </MemoryRouter>
    </main>,
  );
}

async function selectCell() {
  await userEvent.selectOptions(screen.getByLabelText("Line"), "L1");
  await userEvent.selectOptions(screen.getByLabelText("Period"), "fp-2026-p01");
}

describe("S-042 Formula Inspector (F-012)", () => {
  beforeEach(() => {
    setStoreState({
      status: "success",
      lines: [{ id: "L1", label: "4000 · Revenue", method: "manual" }],
      periods: [
        { id: "fp-2026-p01", code: "P01" },
        { id: "fp-2026-p02", code: "P02" },
      ],
    });
    loadMock.mockClear();
    inspectCellMock.mockClear();
  });

  it("renders the loading state while the grid is in flight", () => {
    setStoreState({ status: "loading", lines: [], periods: [] });
    renderPage();
    expect(screen.getByRole("heading", { name: "Formula Inspector" })).toBeInTheDocument();
    // The StatePanel loading role is announced.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the error state with a working Retry that reloads the grid", async () => {
    setStoreState({ status: "error" });
    renderPage();
    expect(await screen.findByText("The model grid could not be loaded.")).toBeInTheDocument();
    // The mount effect already retried once; the Retry button must trigger another load.
    const callsBefore = loadMock.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(loadMock).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it("shows the idle empty state until a line and period are selected", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Formula Inspector" })).toBeInTheDocument();
    // Line + period selects render from the store fixture.
    expect(screen.getByText("4000 · Revenue")).toBeInTheDocument();
    expect(screen.getByText("P01")).toBeInTheDocument();
    // Empty guidance before inspection.
    expect(
      await screen.findByText(/Select a line and a period, then Inspect cell/),
    ).toBeInTheDocument();
    // Inspect is disabled without a selection.
    expect(screen.getByRole("button", { name: /Inspect cell/ })).toBeDisabled();
  });

  it("renders the populated inspection with formula, computed value, precedents and dependents", async () => {
    inspectCellMock.mockResolvedValue({ ...BASE_RESULT });
    renderPage();
    await selectCell();
    expect(screen.getByRole("button", { name: /Inspect cell/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /Inspect cell/ }));

    expect(inspectCellMock).toHaveBeenCalledWith("L1", "fp-2026-p01");
    expect(await screen.findByText("Inspection result")).toBeInTheDocument();
    expect(screen.getByText("=B2+5")).toBeInTheDocument();
    expect(screen.getByText("10.00")).toBeInTheDocument();
    // Precedents + dependents are listed with their line/period refs.
    expect(screen.getByText(/L2/)).toBeInTheDocument();
    expect(screen.getByText(/L3/)).toBeInTheDocument();
    // No cycle banner when the cell is cycle-free.
    expect(screen.queryByText("Cycle path")).not.toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("renders the cycle path and circular flag when the inspected cell is in a cycle", async () => {
    inspectCellMock.mockResolvedValue({
      ...BASE_RESULT,
      error_code: "FORMULA_CYCLE",
      is_cycle: true,
      cycle: [
        { line_id: "L1", period_id: "fp-2026-p01" },
        { line_id: "L2", period_id: "fp-2026-p02" },
        { line_id: "L1", period_id: "fp-2026-p01" },
      ],
    });
    renderPage();
    await selectCell();
    await userEvent.click(screen.getByRole("button", { name: /Inspect cell/ }));

    expect(await screen.findByText("Cycle path")).toBeInTheDocument();
    expect(screen.getByText(/FORMULA_CYCLE/)).toBeInTheDocument();
    // Circular flag shows "Yes".
    expect(screen.getByText("⚠️ Yes")).toBeInTheDocument();
    expect(screen.getAllByText(/L1/).length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces a locked user-facing message (never raw error.message) on inspection failure", async () => {
    inspectCellMock.mockRejectedValue({
      code: "FORMULA_CYCLE",
      userMessage: "This cell is part of a circular reference chain.",
    });
    renderPage();
    await selectCell();
    await userEvent.click(screen.getByRole("button", { name: /Inspect cell/ }));

    expect(
      await screen.findByText("This cell is part of a circular reference chain."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/FORMULA_CYCLE/)).not.toBeInTheDocument();
  });

  it("falls back to the generic message when the error carries no userMessage", async () => {
    inspectCellMock.mockRejectedValue(new Error("secret internal detail"));
    renderPage();
    await selectCell();
    await userEvent.click(screen.getByRole("button", { name: /Inspect cell/ }));

    expect(await screen.findByText(/Inspection failed/)).toBeInTheDocument();
    expect(screen.queryByText(/secret internal detail/)).not.toBeInTheDocument();
  });

  it("keeps the populated inspector axe-clean", async () => {
    inspectCellMock.mockResolvedValue({ ...BASE_RESULT });
    renderPage();
    await selectCell();
    await userEvent.click(screen.getByRole("button", { name: /Inspect cell/ }));
    await screen.findByText("Inspection result");
    const results = await axe(document.body);
    // a11y gate (ACCESSIBILITY.md §3): zero violations of WCAG 2.2 AA rules.
    expect(results.violations).toEqual([]);
  });
});
