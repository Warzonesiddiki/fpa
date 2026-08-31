import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { DriverTablesPage } from "./index";

/**
 * S-043 drives `useDriverStore` selectors directly (status/drivers/values/periods/impact/load/etc.)
 * so the test controls the store's 5 states via a mutable fixture instead of spinning up the real
 * HyperFormula graph (covered in the store + engine tests). Here we verify the state machine + the
 * add/edit/import affordances and a11y only.
 */
const { current, setStoreState, loadMock, upsertMock, setValueMock, importMock } = vi.hoisted(
  () => {
    const current = {
      status: "populated",
      drivers: [
        {
          id: "dr-units",
          name: "units",
          driver_type: "volume_x_rate",
          unit: "units",
          source: "global",
          is_core: true,
          bounds_low: "0",
          bounds_high: "100000",
        },
      ],
      values: { "dr-units:fp-2026-p01": "12000" },
      periods: [
        { id: "fp-2026-p01", code: "P01" },
        { id: "fp-2026-p02", code: "P02" },
      ],
      impact: {
        "dr-units": [{ line_id: "L1", period_id: "fp-2026-p01", formula: "=Drivers!B2*2" }],
      },
      coreDriverCount: 1,
      load: vi.fn(async () => undefined),
      upsertDriver: vi.fn(async () => true),
      setValue: vi.fn(async () => true),
      importDrivers: vi.fn(async () => true),
    };
    return {
      current,
      setStoreState: (patch: Partial<typeof current>) => Object.assign(current, patch),
      loadMock: current.load,
      upsertMock: current.upsertDriver,
      setValueMock: current.setValue,
      importMock: current.importDrivers,
    };
  },
);

vi.mock("@/stores/drivers", () => ({
  useDriverStore: (selector: (s: unknown) => unknown) => selector(current),
  CORE_DRIVER_ADVISORY_MAX: 7,
}));

function renderPage() {
  return render(
    <main>
      <MemoryRouter initialEntries={["/app/model/drivers"]}>
        <Routes>
          <Route path="/app/model/drivers" element={<DriverTablesPage />} />
          <Route path="/app/model/grid" element={<div>grid screen</div>} />
        </Routes>
      </MemoryRouter>
    </main>,
  );
}

async function openAddForm() {
  const btn = await screen.findByRole("button", { name: /Add Driver/ });
  await userEvent.click(btn);
}

describe("S-043 Driver Tables (F-013)", () => {
  beforeEach(() => {
    setStoreState({
      status: "populated",
      drivers: [
        {
          id: "dr-units",
          name: "units",
          driver_type: "volume_x_rate",
          unit: "units",
          source: "global",
          is_core: true,
          bounds_low: "0",
          bounds_high: "100000",
        },
      ],
      values: { "dr-units:fp-2026-p01": "12000" },
      periods: [
        { id: "fp-2026-p01", code: "P01" },
        { id: "fp-2026-p02", code: "P02" },
      ],
      impact: {
        "dr-units": [{ line_id: "L1", period_id: "fp-2026-p01", formula: "=Drivers!B2*2" }],
      },
      coreDriverCount: 1,
    });
    loadMock.mockClear();
    upsertMock.mockClear();
    setValueMock.mockClear();
    importMock.mockClear();
  });

  it("renders the loading state while the driver table is in flight", () => {
    setStoreState({ status: "loading", drivers: [], periods: [] });
    renderPage();
    expect(screen.getByRole("heading", { name: "Driver Tables" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the empty state with the create-first affordance", async () => {
    setStoreState({ status: "empty", drivers: [], periods: [], coreDriverCount: 0 });
    renderPage();
    expect(
      await screen.findByText(/Create your first Driver \u2014 e.g., Units, Price/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Driver/ })).toBeInTheDocument();
  });

  it("renders the error state with a working Retry that reloads", async () => {
    setStoreState({ status: "error" });
    renderPage();
    expect(await screen.findByText("Driver tables could not be loaded.")).toBeInTheDocument();
    const callsBefore = loadMock.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(loadMock).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it("renders the populated table with period values, impact list and core badge", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "units" })).toBeInTheDocument();
    // Period columns render from the store.
    expect(screen.getByText("P01")).toBeInTheDocument();
    expect(screen.getByText("P02")).toBeInTheDocument();
    // The stored value cell shows the exact decimal.
    expect(screen.getByDisplayValue("12000")).toBeInTheDocument();
    // Core-driver advisory badge.
    expect(screen.getByText("1")).toBeInTheDocument();
    // Selecting the driver shows its impact list (the referencing line).
    await userEvent.click(screen.getByRole("button", { name: "units" }));
    expect(await screen.findByText(/L1 · fp-2026-p01/)).toBeInTheDocument();
  });

  it("creates a driver through the Add form", async () => {
    renderPage();
    await openAddForm();
    await userEvent.type(screen.getByLabelText("Name"), "headcount");
    // Change type to Headcount.
    await userEvent.selectOptions(screen.getByLabelText("Type"), "headcount");
    await userEvent.click(screen.getByRole("button", { name: /Create/ }));
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "headcount", driver_type: "headcount" }),
    );
  });

  it("edits the driver name via the table row and saves", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "units" }));
    const nameInput = await screen.findByLabelText("Name");
    expect(nameInput).toHaveValue("units");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "units_edited");
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dr-units", name: "units_edited" }),
    );
  });

  it("commits a driver period value on blur", async () => {
    renderPage();
    const cell = await screen.findByDisplayValue("12000");
    await userEvent.clear(cell);
    await userEvent.type(cell, "14000");
    await userEvent.tab();
    expect(setValueMock).toHaveBeenCalledWith("dr-units", "fp-2026-p01", "14000");
  });

  it("keeps the populated driver table axe-clean", async () => {
    renderPage();
    await screen.findByRole("button", { name: "units" });
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
