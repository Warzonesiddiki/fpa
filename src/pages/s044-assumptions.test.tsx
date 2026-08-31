import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { axe } from "vitest-axe";
import type { BridgeError } from "@/api/bridge";
import { AssumptionsPage } from "./s044-assumptions";

type TestAssumption = {
  id: string;
  name: string;
  unit: string | null;
  owner: string;
  source: string | null;
  bounds_low: string | null;
  bounds_high: string | null;
  effective_from: string | null;
  effective_to: string | null;
  values: Record<string, string>;
};

type TestUsage = { line_id: string; period_id: string; formula: string };
type TestStoreState = {
  status: string;
  error: BridgeError | null;
  usageError: BridgeError | null;
  assumptions: TestAssumption[];
  usages: Record<string, TestUsage[]>;
  history: Record<string, unknown[]>;
  load: Mock<() => Promise<void>>;
  upsert: Mock<(assumption: unknown) => Promise<boolean>>;
  findUsages: Mock<(id: string) => Promise<TestUsage[]>>;
};

const { current, setStoreState, loadMock, upsertMock, findUsagesMock } = vi.hoisted(() => {
  const current: TestStoreState = {
    status: "populated",
    error: null,
    usageError: null,
    assumptions: [
      {
        id: "as-wage_inflation",
        name: "wage_inflation",
        unit: "%",
        owner: "HR",
        source: "HR plan",
        bounds_low: "0",
        bounds_high: "10",
        effective_from: "fp-2026-p01",
        effective_to: null,
        values: { "fp-2026-p01": "4.0", "fp-2026-p02": "4.0" },
      },
    ],
    usages: {},
    history: {},
    load: vi.fn(async () => undefined),
    upsert: vi.fn(async () => true),
    findUsages: vi.fn(async (id: string) => {
      current.usages[id] = [
        {
          line_id: "line-salary",
          period_id: "fp-2026-p01",
          formula: "=base_salary*(1+@wage_inflation)",
        },
      ];
      return current.usages[id];
    }),
  };
  return {
    current,
    setStoreState: (patch: Partial<typeof current>) => Object.assign(current, patch),
    loadMock: current.load,
    upsertMock: current.upsert,
    findUsagesMock: current.findUsages,
  };
});

vi.mock("@/stores/assumptions", () => ({
  useAssumptionStore: (selector: (state: unknown) => unknown) => selector(current),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/model/assumptions"]}>
      <Routes>
        <Route path="/app/model/assumptions" element={<AssumptionsPage />} />
        <Route path="/app/model/grid" element={<div>Model grid</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function setPopulatedState() {
  setStoreState({
    status: "populated",
    error: null,
    usageError: null,
    assumptions: [
      {
        id: "as-wage_inflation",
        name: "wage_inflation",
        unit: "%",
        owner: "HR",
        source: "HR plan",
        bounds_low: "0",
        bounds_high: "10",
        effective_from: "fp-2026-p01",
        effective_to: null,
        values: { "fp-2026-p01": "4.0", "fp-2026-p02": "4.0" },
      },
    ],
    usages: {},
    history: {},
  });
  loadMock.mockClear();
  upsertMock.mockClear();
  findUsagesMock.mockClear();
}

describe("S-044 Assumption Register (F-014)", () => {
  beforeEach(() => {
    setPopulatedState();
  });

  it("renders the loading state", () => {
    setStoreState({ status: "loading", assumptions: [] });
    renderPage();
    expect(screen.getByRole("heading", { name: "Assumption Register" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /Loading/ })).toBeInTheDocument();
  });

  it("renders the empty state with an Add assumption action", async () => {
    setStoreState({ status: "empty", assumptions: [] });
    renderPage();
    expect(
      await screen.findByText("Add assumptions (e.g., wage_inflation 4%)."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add assumption" })).toBeInTheDocument();
  });

  it("renders the typed error state and retries", async () => {
    setStoreState({
      status: "error",
      error: {
        code: "ASSUMPTION_IN_USE_LOCKED",
        userMessage: "Assumption is used by a Locked Baseline. Create a new Version to change.",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
    });
    renderPage();
    expect(await screen.findByText(/Locked Baseline/)).toBeInTheDocument();
    expect(screen.getByText("ASSUMPTION_IN_USE_LOCKED")).toBeInTheDocument();
    loadMock.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it("renders metadata, exact values, bounds, effective period and actions", () => {
    renderPage();
    expect(screen.getByRole("row", { name: /wage_inflation/ })).toBeInTheDocument();
    expect(screen.getByText("fp-2026-p01: 4.0 · fp-2026-p02: 4.0")).toBeInTheDocument();
    expect(screen.getByText("0 – 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit wage_inflation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find usages" })).toBeInTheDocument();
  });

  it("validates required metadata and exact period-value lines before upsert", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Add assumption" }));
    expect(screen.getByRole("heading", { name: "New assumption" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save assumption" }));
    expect(screen.getByText("Enter a lowercase snake_case assumption name.")).toBeInTheDocument();
    expect(upsertMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Name"), "inflation_rate");
    await userEvent.type(screen.getByLabelText("Owner"), "Finance");
    await userEvent.type(screen.getByRole("textbox", { name: /Period values/ }), "not-a-period");
    await userEvent.click(screen.getByRole("button", { name: "Save assumption" }));
    expect(
      screen.getByText("Use one fiscal period and exact decimal per line (period=value)."),
    ).toBeInTheDocument();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("creates an assumption with metadata and exact decimal strings", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Add assumption" }));
    await userEvent.type(screen.getByLabelText("Name"), "inflation_rate");
    await userEvent.type(screen.getByLabelText("Owner"), "Finance");
    await userEvent.type(screen.getByLabelText("Unit"), "%");
    await userEvent.type(screen.getByLabelText("Source"), "Treasury");
    await userEvent.type(screen.getByLabelText("Lower bound"), "0");
    await userEvent.type(screen.getByLabelText("Upper bound"), "12.5");
    await userEvent.type(screen.getByLabelText("Effective from"), "fp-2026-p01");
    await userEvent.type(
      screen.getByRole("textbox", { name: /Period values/ }),
      "fp-2026-p01=4.25",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save assumption" }));

    expect(upsertMock).toHaveBeenCalledWith({
      name: "inflation_rate",
      unit: "%",
      owner: "Finance",
      source: "Treasury",
      bounds_low: "0",
      bounds_high: "12.5",
      effective_from: "fp-2026-p01",
      effective_to: null,
      values: { "fp-2026-p01": "4.25" },
    });
  });

  it("edits an assumption and sends its id plus full replacement values", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Edit wage_inflation" }));
    expect(screen.getByRole("heading", { name: "Edit assumption" })).toBeInTheDocument();
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "wage_inflation");
    const values = screen.getByRole("textbox", { name: /Period values/ });
    await userEvent.clear(values);
    await userEvent.type(values, "fp-2026-p01=5.0");
    await userEvent.click(screen.getByRole("button", { name: "Save assumption" }));
    expect(upsertMock).toHaveBeenCalledWith({
      id: "as-wage_inflation",
      name: "wage_inflation",
      unit: "%",
      owner: "HR",
      source: "HR plan",
      bounds_low: "0",
      bounds_high: "10",
      effective_from: "fp-2026-p01",
      effective_to: null,
      values: { "fp-2026-p01": "5.0" },
    });
  });

  it("loads the read-only usage list for an assumption", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Find usages" }));
    expect(findUsagesMock).toHaveBeenCalledWith("as-wage_inflation");
    expect(await screen.findByText(/line-salary · fp-2026-p01/)).toBeInTheDocument();
    expect(screen.getByText("=base_salary*(1+@wage_inflation)")).toBeInTheDocument();
  });

  it("keeps the populated register axe-clean", async () => {
    renderPage();
    expect(await screen.findByText("wage_inflation")).toBeInTheDocument();
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
