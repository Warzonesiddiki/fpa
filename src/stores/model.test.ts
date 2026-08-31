import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModelGridStore, WORKING_SCENARIO_ID, WORKING_MODEL_ID } from "./model";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock } = vi.hoisted(() => ({ companyIdMock: vi.fn() }));
vi.mock("@/stores/session", () => ({
  useSessionStore: { getState: () => ({ companyId: companyIdMock() }) },
}));

// The engine client falls back to the in-process transport where `Worker` is unavailable
// (jsdom) — so the real HyperFormula graph runs through the store in tests (FORMULA-ENGINE-SPEC §5).

const CO = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const LINE = "3f9f2c9e-9f8b-4e2d-9a1c-400000000010";
const PERIOD = "fp-2026-p01";

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

describe("model grid store (S-041)", () => {
  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
    useModelGridStore.getState().reset();
    // reset() nulls the client; the next load re-creates it via the mocked factory.
  });

  it("loads lines and periods from real commands and renders populated cells", async () => {
    mockLoad();
    await useModelGridStore.getState().load();
    const s = useModelGridStore.getState();
    expect(s.status).toBe("success");
    expect(s.lines).toHaveLength(2);
    expect(s.periods.map((p) => p.id)).toEqual(["fp-2026-p01", "fp-2026-p02"]);
    expect(s.cells[`${LINE}:${PERIOD}`]).toBeDefined();
    expect(callMock).toHaveBeenCalledWith("coa.list", { company_id: CO });
  });

  it("shows empty when a company has no accounts", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "coa.list") return Promise.resolve([]);
      if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
      return Promise.resolve({});
    });
    await useModelGridStore.getState().load();
    expect(useModelGridStore.getState().status).toBe("empty");
  });

  it("shows empty when no company is open", async () => {
    companyIdMock.mockReturnValue(null);
    await useModelGridStore.getState().load();
    expect(useModelGridStore.getState().status).toBe("empty");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("surfaces load errors with the locked code and supports retry", async () => {
    callMock.mockRejectedValue({ code: "FILE_CORRUPT", userMessage: "bad file", httpStatus: 500 });
    await useModelGridStore.getState().load();
    expect(useModelGridStore.getState().status).toBe("error");
    expect(useModelGridStore.getState().error?.code).toBe("FILE_CORRUPT");

    // Retry succeeds once the core is healthy again.
    mockLoad();
    await useModelGridStore.getState().retry();
    expect(useModelGridStore.getState().status).toBe("success");
  });

  it("writes an edit through model.cell.set.v1 (audit) and the engine, capturing audit_id", async () => {
    mockLoad();
    await useModelGridStore.getState().load();
    callMock.mockResolvedValue({
      recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
      audit_id: 777,
    });
    const ok = await useModelGridStore.getState().setCell({
      line_id: LINE,
      period_id: PERIOD,
      value: "182500.00",
    });
    expect(ok).toBe(true);
    expect(callMock).toHaveBeenCalledWith("model.cell.set.v1", {
      line_id: LINE,
      scenario_id: WORKING_SCENARIO_ID,
      period_id: PERIOD,
      value: "182500.00",
      formula: null,
      manual_override: false,
    });
    const s = useModelGridStore.getState();
    expect(s.status).toBe("populated");
    expect(s.auditId).toBe(777);
    expect(s.cells[`${LINE}:${PERIOD}`].amount_text).toBe("182500.00");
  });

  it("propagates model.cell.set.v1 errors (e.g. MODEL_CELL_LOCKED) into the error state", async () => {
    mockLoad();
    await useModelGridStore.getState().load();
    callMock.mockRejectedValue({
      code: "MODEL_CELL_LOCKED",
      userMessage: "This scenario is locked. Create a Version to edit it.",
      httpStatus: 422,
    });
    const ok = await useModelGridStore.getState().setCell({
      line_id: LINE,
      period_id: PERIOD,
      value: "1.00",
    });
    expect(ok).toBe(false);
    expect(useModelGridStore.getState().status).toBe("error");
    expect(useModelGridStore.getState().error?.code).toBe("MODEL_CELL_LOCKED");
  });

  it("recalcAll calls model.recalc and updates derived totals", async () => {
    mockLoad();
    await useModelGridStore.getState().load();
    callMock.mockResolvedValue({
      dirty_cells: 0,
      cycles: [],
      changed_cells: [LINE],
      issues: [],
      duration_ms: 0,
    });
    await useModelGridStore.getState().setCell({ line_id: LINE, period_id: PERIOD, value: "5.00" });
    await useModelGridStore.getState().recalcAll();
    expect(callMock).toHaveBeenCalledWith("model.recalc", {
      model_id: WORKING_MODEL_ID,
      scenario_id: WORKING_SCENARIO_ID,
    });
    const s = useModelGridStore.getState();
    expect(s.status).toBe("populated");
    expect(s.derived[LINE].ytd).toBe("5");
  });

  it("inspects a cell formula through the engine and returns the precedence/dependency trace", async () => {
    mockLoad();
    await useModelGridStore.getState().load();
    // Engine layout: row 1 = LINE (first line) → cell "B2", row 2 = SRC (second line) → "B3";
    // period P01 = col 1 (column B). So `=B3+5` on LINE references SRC at P01.
    const SRC = "3f9f2c9e-9f8b-4e2d-9a1c-400000000011";
    await useModelGridStore.getState().setCell({ line_id: SRC, period_id: PERIOD, value: "10.00" });
    await useModelGridStore.getState().setCell({
      line_id: LINE,
      period_id: PERIOD,
      formula: "=B3+5",
    });

    const r = await useModelGridStore.getState().inspectCell(LINE, PERIOD);
    expect(r.line_id).toBe(LINE);
    expect(r.period_id).toBe(PERIOD);
    expect(r.formula).toBe("=B3+5");
    expect(r.error_code).toBeNull();
    expect(r.is_cycle).toBe(false);
    // The direct precedent (B3 = second line, first period) resolves to the src line/period.
    expect(r.precedents).toContainEqual(
      expect.objectContaining({ line_id: SRC, period_id: PERIOD }),
    );
    // Read-only — no persistence command is fired for inspection.
    expect(callMock).not.toHaveBeenCalledWith("model.inspect", expect.anything());
  });
});
