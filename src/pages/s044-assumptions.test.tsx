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
type TestLiteral = { literal: string; start: number; end: number };
type TestFinding = {
  line_id: string;
  period_id: string;
  formula: string;
  literals: TestLiteral[];
};
type TestStoreState = {
  status: string;
  error: BridgeError | null;
  usageError: BridgeError | null;
  assumptions: TestAssumption[];
  usages: Record<string, TestUsage[]>;
  history: Record<string, unknown[]>;
  hardcodeStatus: string;
  hardcodeError: BridgeError | null;
  findings: TestFinding[];
  waived: Record<string, { reason: string; waived_at: string }>;
  load: Mock<() => Promise<void>>;
  upsert: Mock<(assumption: unknown) => Promise<boolean>>;
  findUsages: Mock<(id: string) => Promise<TestUsage[]>>;
  scanHardcoded: Mock<() => Promise<TestFinding[]>>;
  convertHardcoded: Mock<
    (finding: TestFinding, literal: TestLiteral, name: string) => Promise<boolean>
  >;
  waiveHardcoded: Mock<(finding: TestFinding, literal: TestLiteral, reason: string) => boolean>;
  unwaiveHardcoded: Mock<(key: string) => void>;
};

const {
  current,
  setStoreState,
  loadMock,
  upsertMock,
  findUsagesMock,
  scanHardcodedMock,
  convertHardcodedMock,
  waiveHardcodedMock,
} = vi.hoisted(() => {
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
    hardcodeStatus: "empty",
    hardcodeError: null,
    findings: [],
    waived: {},
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
    scanHardcoded: vi.fn(async () => current.findings),
    convertHardcoded: vi.fn(async () => true),
    waiveHardcoded: vi.fn(() => true),
    unwaiveHardcoded: vi.fn(),
  };
  return {
    current,
    setStoreState: (patch: Partial<typeof current>) => Object.assign(current, patch),
    loadMock: current.load,
    upsertMock: current.upsert,
    findUsagesMock: current.findUsages,
    scanHardcodedMock: current.scanHardcoded,
    convertHardcodedMock: current.convertHardcoded,
    waiveHardcodedMock: current.waiveHardcoded,
  };
});

vi.mock("@/stores/assumptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/assumptions")>();
  return {
    ...actual,
    useAssumptionStore: (selector: (state: unknown) => unknown) => selector(current),
  };
});

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
    hardcodeStatus: "empty",
    hardcodeError: null,
    findings: [],
    waived: {},
  });
  loadMock.mockClear();
  upsertMock.mockClear();
  findUsagesMock.mockClear();
  scanHardcodedMock.mockClear();
  convertHardcodedMock.mockClear();
  waiveHardcodedMock.mockClear();
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

  it("shows the change diff before applying an assumption edit", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Edit wage_inflation" }));
    const values = screen.getByRole("textbox", { name: /Period values/ });
    await userEvent.clear(values);
    await userEvent.type(values, "fp-2026-p01=5.0");
    expect(await screen.findByText("fp-2026-p01: 4.0 → 5.0")).toBeInTheDocument();
  });

  it("scans for hardcoded values and renders findings with convert + waive", async () => {
    setStoreState({
      hardcodeStatus: "populated",
      findings: [
        {
          line_id: "line-salary",
          period_id: "fp-2026-p01",
          formula: "=base_salary*1.04",
          literals: [{ literal: "1.04", start: 13, end: 17 }],
        },
      ],
    });
    renderPage();
    expect(await screen.findByText("line-salary · fp-2026-p01")).toBeInTheDocument();
    expect(screen.getByText("=base_salary*1.04")).toBeInTheDocument();
    expect(screen.getByText("1.04")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Convert" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waive" })).toBeInTheDocument();
  });

  it("converts a hardcoded literal to a chosen register reference", async () => {
    setStoreState({
      hardcodeStatus: "populated",
      findings: [
        {
          line_id: "line-salary",
          period_id: "fp-2026-p01",
          formula: "=base_salary*1.04",
          literals: [{ literal: "1.04", start: 13, end: 17 }],
        },
      ],
    });
    renderPage();
    await userEvent.selectOptions(
      await screen.findByLabelText("Assumption for hardcoded value 1.04"),
      "wage_inflation",
    );
    await userEvent.click(screen.getByRole("button", { name: "Convert" }));
    expect(convertHardcodedMock).toHaveBeenCalledWith(
      expect.objectContaining({ formula: "=base_salary*1.04" }),
      { literal: "1.04", start: 13, end: 17 },
      "wage_inflation",
    );
  });

  it("requires a reason before waiving a hardcoded value", async () => {
    setStoreState({
      hardcodeStatus: "populated",
      findings: [
        {
          line_id: "line-salary",
          period_id: "fp-2026-p01",
          formula: "=base_salary*1.04",
          literals: [{ literal: "1.04", start: 13, end: 17 }],
        },
      ],
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Waive" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm waiver" }));
    expect(await screen.findByText("Enter a waiver reason.")).toBeInTheDocument();
    expect(waiveHardcodedMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Waiver reason"), "fixed cost baseline");
    await userEvent.click(screen.getByRole("button", { name: "Confirm waiver" }));
    expect(waiveHardcodedMock).toHaveBeenCalledWith(
      expect.objectContaining({ formula: "=base_salary*1.04" }),
      { literal: "1.04", start: 13, end: 17 },
      "fixed cost baseline",
    );
  });

  it("renders a waiver and allows undoing it", async () => {
    setStoreState({
      hardcodeStatus: "populated",
      findings: [
        {
          line_id: "line-salary",
          period_id: "fp-2026-p01",
          formula: "=base_salary*1.04",
          literals: [{ literal: "1.04", start: 13, end: 17 }],
        },
      ],
      waived: {
        "line-salary:fp-2026-p01:13:17": {
          reason: "fixed cost baseline",
          waived_at: "2026-09-03T00:00:00.000Z",
        },
      },
    });
    renderPage();
    expect(await screen.findByText(/Waived: fixed cost baseline/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(current.unwaiveHardcoded).toHaveBeenCalledWith("line-salary:fp-2026-p01:13:17");
  });
});
