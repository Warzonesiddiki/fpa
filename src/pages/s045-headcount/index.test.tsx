import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { BridgeError } from "@/api/bridge";
import { HeadcountPage } from "./index";

const { current, loadMock, saveMock, removeMock, importMock, retryMock, setStoreState } =
  vi.hoisted(() => {
    const current = {
      status: "populated",
      error: null as BridgeError | null,
      rows: [
        {
          id: "hc-row-1",
          role: "Analyst",
          cost_center: "Finance",
          start_date: "2026-04-16",
          termination_date: null,
          base_comp_decimal: "1200",
          bonus_pct: "0",
          benefits_pct: "20",
          employer_load_pct: "0",
          ramp_months: 0,
        },
      ],
      periods: [
        {
          id: "fp-2026-p01",
          code: "P01",
          start_date: "2026-04-01",
          end_date: "2026-04-30",
        },
      ],
      rollups: [
        {
          period_id: "fp-2026-p01",
          code: "P01",
          active_headcount: 1,
          total_cost_decimal: "240",
          members: [
            {
              row_id: "hc-row-1",
              role: "Analyst",
              active_days: 15,
              period_days: 30,
              proration: "0.5",
              ramp_factor: "1",
              cost_decimal: "240",
            },
          ],
        },
      ],
      importedBatchId: null,
      load: vi.fn(async () => undefined),
      saveRow: vi.fn(async () => true),
      removeRow: vi.fn(async () => true),
      importDriverData: vi.fn(async () => true),
      retry: vi.fn(async () => undefined),
    };
    return {
      current,
      loadMock: current.load,
      saveMock: current.saveRow,
      removeMock: current.removeRow,
      importMock: current.importDriverData,
      retryMock: current.retry,
      setStoreState: (patch: Partial<typeof current>) => Object.assign(current, patch),
    };
  });

vi.mock("@/stores/headcount", () => ({
  useHeadcountStore: (selector: (state: typeof current) => unknown) => selector(current),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/model/headcount"]}>
      <HeadcountPage />
    </MemoryRouter>,
  );
}

describe("S-045 Headcount Plan (F-016)", () => {
  beforeEach(() => {
    setStoreState({
      status: "populated",
      error: null,
      rows: [
        {
          id: "hc-row-1",
          role: "Analyst",
          cost_center: "Finance",
          start_date: "2026-04-16",
          termination_date: null,
          base_comp_decimal: "1200",
          bonus_pct: "0",
          benefits_pct: "20",
          employer_load_pct: "0",
          ramp_months: 0,
        },
      ],
      rollups: [
        {
          period_id: "fp-2026-p01",
          code: "P01",
          active_headcount: 1,
          total_cost_decimal: "240",
          members: [
            {
              row_id: "hc-row-1",
              role: "Analyst",
              active_days: 15,
              period_days: 30,
              proration: "0.5",
              ramp_factor: "1",
              cost_decimal: "240",
            },
          ],
        },
      ],
      importedBatchId: null,
    });
    loadMock.mockClear();
    saveMock.mockClear();
    removeMock.mockClear();
    importMock.mockClear();
    retryMock.mockClear();
  });

  it("renders the loading state and uses the store loader", () => {
    setStoreState({ status: "loading", rows: [], rollups: [] });
    renderPage();
    expect(screen.getByRole("heading", { name: "Headcount Plan" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state with add and import affordances", () => {
    setStoreState({ status: "empty", rows: [], rollups: [] });
    renderPage();
    expect(screen.getByText("Add roles or import headcount.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add role" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Import from Driver Data" })).toBeInTheDocument();
  });

  it("renders typed errors with retry semantics and keeps the schedule context", async () => {
    setStoreState({
      status: "error",
      error: {
        code: "INTERNAL",
        userMessage: "The headcount plan could not be loaded.",
        httpStatus: 500,
        retryable: true,
        retryAfterMs: null,
        details: {},
      },
    });
    const firstView = renderPage();
    expect(screen.getByText("The headcount plan could not be loaded.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryMock).toHaveBeenCalledTimes(1);
    firstView.unmount();

    setStoreState({
      status: "error",
      error: {
        code: "HC_OVERLAP",
        userMessage: "Two rows for the same role and cost center overlap in a fiscal period.",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: { period_id: "fp-2026-p01" },
      },
    });
    const view = renderPage();
    expect(screen.getByText("HC_OVERLAP")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("table", { name: "Headcount hire and termination schedule" }),
      ).getByText("Analyst"),
    ).toBeInTheDocument();
    view.unmount();
  });

  it("renders schedule, org tree, exact proration, and rollup totals", () => {
    renderPage();
    const schedule = screen.getByRole("table", { name: "Headcount hire and termination schedule" });
    expect(within(schedule).getByText("Analyst")).toBeInTheDocument();
    expect(within(schedule).getByText("Finance")).toBeInTheDocument();
    expect(within(schedule).getByText(/15\/30/)).toBeInTheDocument();
    const rollup = within(screen.getByRole("region", { name: "Headcount cost rollup" })).getByRole(
      "table",
      { name: "Headcount cost by fiscal period" },
    );
    expect(within(rollup).getByText("240")).toBeInTheDocument();
    expect(within(rollup).getByText("P01")).toBeInTheDocument();
    expect(screen.getByText("Total cost")).toBeInTheDocument();
  });

  it("renders the successful save state without hiding the schedule", () => {
    setStoreState({ status: "success" });
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Headcount plan saved.");
    expect(
      screen.getByRole("table", { name: "Headcount hire and termination schedule" }),
    ).toBeInTheDocument();
  });

  it("adds a role through the audited schedule store", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Add role" }));
    await user.type(screen.getByLabelText("Role"), "Controller");
    await user.type(screen.getByLabelText("Cost center"), "Finance");
    await user.type(screen.getByLabelText("Start date"), "2026-04-01");
    await user.type(screen.getByLabelText("Annual base compensation"), "1800");
    const form = screen.getByRole("form", { name: "Headcount role form" });
    await user.click(within(form).getByRole("button", { name: "Add role" }));
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "Controller",
        cost_center: "Finance",
        base_comp_decimal: "1800",
      }),
    );
  });

  it("hands a driver-data file and mapping to the import pipeline", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Driver-data file path"), "/tmp/headcount.csv");
    await user.click(screen.getByRole("button", { name: "Import headcount" }));
    expect(importMock).toHaveBeenCalledWith("/tmp/headcount.csv", "canonical");
  });

  it("keeps the populated plan axe-clean", async () => {
    renderPage();
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
