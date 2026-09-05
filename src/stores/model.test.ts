import { beforeEach, describe, expect, it, vi } from "vitest";
import Decimal from "decimal.js";
import { useModelGridStore, WORKING_SCENARIO_ID, WORKING_MODEL_ID } from "./model";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const { companyIdMock, modelIdMock } = vi.hoisted(() => ({
  companyIdMock: vi.fn(),
  modelIdMock: vi.fn(),
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: { getState: () => ({ companyId: companyIdMock(), modelId: modelIdMock() }) },
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
    // No native model id known → the store falls back to the documented example id.
    modelIdMock.mockReturnValue(null);
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

  it("recalcAll addresses the session's native Model id when the core reported one", async () => {
    const nativeModelId = "3f9f2c9e-9f8b-4e2d-9a1c-100000000001";
    modelIdMock.mockReturnValue(nativeModelId);
    mockLoad();
    await useModelGridStore.getState().load();
    callMock.mockResolvedValue({ duration_ms: 0, changed_cells: [], issues: [] });
    await useModelGridStore.getState().recalcAll();
    expect(callMock).toHaveBeenCalledWith("model.recalc", {
      model_id: nativeModelId,
      scenario_id: WORKING_SCENARIO_ID,
    });
    expect(useModelGridStore.getState().status).toBe("populated");
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

describe("model grid store — M3-9 Excel-parity (S-041)", () => {
  const SRC = ACCOUNTS[1].id;
  const P2 = "fp-2026-p02";

  function mockEdit(auditId = 1) {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "coa.list") return Promise.resolve(ACCOUNTS);
      if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
      if (cmd === "model.cell.set.v1")
        return Promise.resolve({
          recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
          audit_id: auditId,
        });
      if (cmd === "model.recalc")
        return Promise.resolve({
          dirty_cells: 0,
          cycles: [],
          changed_cells: [LINE],
          issues: [],
          duration_ms: 0,
        });
      return Promise.resolve({});
    });
  }

  it("undo restores the previous value and redo re-applies it (history round-trip)", async () => {
    mockEdit();
    await useModelGridStore.getState().load();
    await useModelGridStore
      .getState()
      .setCell({ line_id: LINE, period_id: PERIOD, value: "100.00" });
    let s = useModelGridStore.getState();
    expect(s.cells[`${LINE}:${PERIOD}`].amount_text).toBe("100.00");
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);

    await useModelGridStore.getState().undo();
    s = useModelGridStore.getState();
    expect(s.cells[`${LINE}:${PERIOD}`].amount_text).toBeNull();
    expect(s.canRedo).toBe(true);

    await useModelGridStore.getState().redo();
    s = useModelGridStore.getState();
    expect(s.cells[`${LINE}:${PERIOD}`].amount_text).toBe("100.00");
    expect(s.canUndo).toBe(true);
  });

  it("fills down, copying values and shifting relative formula refs", async () => {
    mockEdit();
    await useModelGridStore.getState().load();
    await useModelGridStore.getState().setCell({ line_id: SRC, period_id: PERIOD, value: "10.00" });
    await useModelGridStore
      .getState()
      .setCell({ line_id: LINE, period_id: PERIOD, formula: "=B2+5" });
    useModelGridStore.getState().setActiveCell(LINE, PERIOD);
    useModelGridStore.getState().extendSelection(LINE, PERIOD); // single-cell selection
    await useModelGridStore.getState().fillSelection("down");
    const s = useModelGridStore.getState();
    expect(s.cells[`${SRC}:${PERIOD}`].formula).toBe("=B3+5"); // dRow=1 → B2→B3
  });

  it("paste rejects invalid input with VALUE_INVALID and leaves cells untouched", async () => {
    mockEdit();
    await useModelGridStore.getState().load();
    useModelGridStore.getState().setActiveCell(LINE, PERIOD);
    const ok = await useModelGridStore.getState().pasteBlock("USD 100");
    const s = useModelGridStore.getState();
    expect(ok).toBe(false);
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("VALUE_INVALID");
    expect(s.cells[`${LINE}:${PERIOD}`].amount_text).toBeNull();
  });

  it("paste applies a valid TSV block anchored at the active cell", async () => {
    mockEdit();
    await useModelGridStore.getState().load();
    useModelGridStore.getState().setActiveCell(LINE, PERIOD);
    const ok = await useModelGridStore.getState().pasteBlock("1.00\t2.00\n3.00\t4.00");
    const s = useModelGridStore.getState();
    expect(ok).toBe(true);
    expect(s.cells[`${LINE}:${PERIOD}`].amount_text).toBe("1.00");
    expect(s.cells[`${LINE}:${P2}`].amount_text).toBe("2.00");
    expect(s.cells[`${SRC}:${PERIOD}`].amount_text).toBe("3.00");
    expect(s.cells[`${SRC}:${P2}`].amount_text).toBe("4.00");
    expect(s.canUndo).toBe(true);
  });

  it("copySelection serializes the current selection as TSV", async () => {
    mockEdit();
    await useModelGridStore.getState().load();
    useModelGridStore.getState().setActiveCell(LINE, PERIOD);
    await useModelGridStore.getState().pasteBlock("1.00\t2.00\n3.00\t4.00");
    useModelGridStore.getState().setActiveCell(LINE, PERIOD);
    useModelGridStore.getState().extendSelection(SRC, P2);
    const tsv = useModelGridStore.getState().copySelection();
    expect(tsv).toBe("1.00\t2.00\n3.00\t4.00");
  });

  it("moveActive navigates and clamps within the grid", async () => {
    mockEdit();
    await useModelGridStore.getState().load();
    useModelGridStore.getState().setActiveCell(LINE, PERIOD);
    useModelGridStore.getState().moveActive(1, 0);
    expect(useModelGridStore.getState().active).toEqual({ lineId: SRC, periodId: PERIOD });
    useModelGridStore.getState().moveActive(0, 1);
    expect(useModelGridStore.getState().active).toEqual({ lineId: SRC, periodId: P2 });
    useModelGridStore.getState().moveActive(-5, -5);
    expect(useModelGridStore.getState().active).toEqual({ lineId: LINE, periodId: PERIOD });
  });

  it("selectTo extends the selection rectangle (shift+arrow)", async () => {
    mockEdit();
    await useModelGridStore.getState().load();
    useModelGridStore.getState().setActiveCell(LINE, PERIOD);
    useModelGridStore.getState().selectTo(1, 1);
    const sel = useModelGridStore.getState().selection;
    expect(sel).toEqual({
      anchor: { lineId: LINE, periodId: PERIOD },
      focus: { lineId: SRC, periodId: P2 },
    });
  });

  describe("M3-5 Period Spreading (F-015 · MODELING-METHODS-SPEC §3 · US-016)", () => {
    it("spreads a total across the horizon, committing every period through model.cell.set.v1", async () => {
      mockEdit(42);
      await useModelGridStore.getState().load();
      callMock.mockClear();
      const result = await useModelGridStore.getState().spreadLine({
        lineId: LINE,
        total: "100.00",
        method: "equal",
      });
      expect(result).not.toBeNull();
      expect(result?.values.map((v) => v.amount_text)).toEqual(["50.00", "50.00"]);
      expect(result?.sum_text).toBe("100.00");
      const audited = callMock.mock.calls.filter((c) => c[0] === "model.cell.set.v1");
      expect(audited).toHaveLength(2);
      expect(audited[0][1]).toEqual({
        line_id: LINE,
        scenario_id: WORKING_SCENARIO_ID,
        period_id: "fp-2026-p01",
        value: "50.00",
        formula: null,
        manual_override: false,
      });
      const s = useModelGridStore.getState();
      expect(s.cells[`${LINE}:fp-2026-p01`].amount_text).toBe("50.00");
      expect(s.cells[`${LINE}:fp-2026-p02`].amount_text).toBe("50.00");
      // Derived FY is the engine's commit-rounded formula result (SUM) — exact 100 either way.
      expect(new Decimal(s.derived[LINE].fy ?? "0").eq("100.00")).toBe(true);
      expect(s.auditId).toBe(42);
      expect(s.spreadError).toBeNull();
      expect(s.status).toBe("populated");
    });

    it("is one undo entry for the whole spread (M3-9 history contract)", async () => {
      mockEdit();
      await useModelGridStore.getState().load();
      await useModelGridStore
        .getState()
        .setCell({ line_id: LINE, period_id: PERIOD, value: "7.00" });
      await useModelGridStore.getState().spreadLine({
        lineId: LINE,
        total: "1000.00",
        method: "seasonal",
        weights: ["0.25", "0.75"],
      });
      let s = useModelGridStore.getState();
      expect(s.cells[`${LINE}:fp-2026-p01`].amount_text).toBe("250.00");
      expect(s.cells[`${LINE}:fp-2026-p02`].amount_text).toBe("750.00");
      expect(s.history.depth).toBe(2);
      await useModelGridStore.getState().undo();
      s = useModelGridStore.getState();
      expect(s.cells[`${LINE}:fp-2026-p01`].amount_text).toBe("7.00");
      expect(s.cells[`${LINE}:fp-2026-p02`].amount_text).toBeNull();
      await useModelGridStore.getState().redo();
      s = useModelGridStore.getState();
      expect(s.cells[`${LINE}:fp-2026-p02`].amount_text).toBe("750.00");
    });

    it("SPREAD_WEIGHTS_INVALID is HARD, inline (not the page error), with the normalise offer; the explicit choice then succeeds", async () => {
      mockEdit();
      await useModelGridStore.getState().load();
      callMock.mockClear();
      const rejected = await useModelGridStore.getState().spreadLine({
        lineId: LINE,
        total: "1000.00",
        method: "seasonal",
        weights: ["0.5", "0.6"],
      });
      expect(rejected).toBeNull();
      let s = useModelGridStore.getState();
      expect(s.status).toBe("success"); // grid untouched, still usable
      expect(s.error).toBeNull();
      expect(s.spreadError?.code).toBe("SPREAD_WEIGHTS_INVALID");
      expect(s.spreadError?.userMessage).toBe(
        "Seasonality weights total 110% — normalize to 100% or fix.",
      );
      expect(s.spreadError?.details).toMatchObject({ sum: "110", canNormalize: true });
      expect(callMock.mock.calls.filter((c) => c[0] === "model.cell.set.v1")).toHaveLength(0);

      const accepted = await useModelGridStore.getState().spreadLine({
        lineId: LINE,
        total: "1000.00",
        method: "seasonal",
        weights: ["0.5", "0.6"],
        normalize: true,
      });
      expect(accepted?.normalized).toBe(true);
      expect(accepted?.values.map((v) => v.amount_text)).toEqual(["454.55", "545.45"]);
      s = useModelGridStore.getState();
      expect(s.spreadError).toBeNull();
      useModelGridStore.getState().clearSpreadError();
      expect(useModelGridStore.getState().spreadError).toBeNull();
    });

    it("rejects an unknown line (REFERENCE_BROKEN) and surfaces a core rejection mid-spread as the page error", async () => {
      mockEdit();
      await useModelGridStore.getState().load();
      const unknown = await useModelGridStore
        .getState()
        .spreadLine({ lineId: "nope", total: "1.00", method: "equal" });
      expect(unknown).toBeNull();
      expect(useModelGridStore.getState().spreadError?.code).toBe("REFERENCE_BROKEN");

      callMock.mockImplementation((cmd: string) => {
        if (cmd === "model.cell.set.v1")
          return Promise.reject({
            code: "MODEL_CELL_LOCKED",
            userMessage: "This cell belongs to a Locked Scenario version.",
            httpStatus: 422,
            retryable: false,
            retryAfterMs: null,
            details: {},
          });
        return Promise.resolve({});
      });
      const locked = await useModelGridStore
        .getState()
        .spreadLine({ lineId: LINE, total: "10.00", method: "equal" });
      expect(locked).toBeNull();
      expect(useModelGridStore.getState().status).toBe("error");
      expect(useModelGridStore.getState().error?.code).toBe("MODEL_CELL_LOCKED");
    });
  });
});

describe("model grid store — scenario switching (S-050 · STATE-MANAGEMENT §2)", () => {
  const SC2 = "5c4f1a2b-9d3e-4c7a-8b2f-000000000001";

  // Local helpers — the first describe's mockLoad/mockEdit are scoped to that describe block.
  function localLoad() {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "coa.list") return Promise.resolve(ACCOUNTS);
      if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
      return Promise.resolve({});
    });
  }

  function localEdit() {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "coa.list") return Promise.resolve(ACCOUNTS);
      if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
      if (cmd === "model.cell.set.v1")
        return Promise.resolve({
          recalc: { dirty_cells: 1, cycles: [], changed_cells: [LINE], issues: [], duration_ms: 0 },
          audit_id: 1,
        });
      return Promise.resolve({});
    });
  }

  beforeEach(() => {
    callMock.mockReset();
    companyIdMock.mockReturnValue(CO);
    modelIdMock.mockReturnValue(null);
    useModelGridStore.getState().reset();
    // reset() keeps the previous scenario id — pin the documented default back.
    useModelGridStore.setState({ scenarioId: WORKING_SCENARIO_ID });
  });

  it("setScenario switches the active scenario, rebuilds the worker, and reloads the grid", async () => {
    localEdit();
    await useModelGridStore.getState().load();
    const firstClient = useModelGridStore.getState().client;
    expect(firstClient).not.toBeNull();
    await useModelGridStore
      .getState()
      .setCell({ line_id: LINE, period_id: PERIOD, value: "10.00" });
    expect(useModelGridStore.getState().canUndo).toBe(true);

    await useModelGridStore.getState().setScenario(SC2);

    const s = useModelGridStore.getState();
    expect(s.scenarioId).toBe(SC2);
    expect(s.client).not.toBeNull();
    expect(s.client).not.toBe(firstClient); // STATE-MANAGEMENT §2: worker rebuilt on scenario switch
    expect(s.cells[`${LINE}:${PERIOD}`]?.amount_text).toBeNull(); // cell cache invalidated
    expect(s.canUndo).toBe(false); // history does not carry across scenarios
    expect(s.status).toBe("success");
    // grid reload requested the working reads again
    expect(callMock).toHaveBeenCalledWith("coa.list", { company_id: CO });

    // edits now flow to the new scenario id
    await s.setCell({ line_id: LINE, period_id: PERIOD, value: "20.00" });
    expect(callMock).toHaveBeenCalledWith(
      "model.cell.set.v1",
      expect.objectContaining({ scenario_id: SC2, line_id: LINE, period_id: PERIOD }),
    );
  });

  it("setScenario is a no-op for the already-active scenario", async () => {
    localLoad();
    await useModelGridStore.getState().load();
    const callsBefore = callMock.mock.calls.filter(([c]) => c === "coa.list").length;
    await useModelGridStore.getState().setScenario(WORKING_SCENARIO_ID);
    const callsAfter = callMock.mock.calls.filter(([c]) => c === "coa.list").length;
    expect(callsAfter).toBe(callsBefore);
    expect(useModelGridStore.getState().scenarioId).toBe(WORKING_SCENARIO_ID);
  });

  it("applyEdit surfaces MODEL_CELL_LOCKED when the scenario is locked", async () => {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "coa.list") return Promise.resolve(ACCOUNTS);
      if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
      if (cmd === "model.cell.set.v1")
        return Promise.reject({
          code: "MODEL_CELL_LOCKED",
          userMessage: "This scenario is locked. Create a Version to edit it.",
          httpStatus: 422,
          retryable: false,
          retryAfterMs: null,
          details: {},
        });
      return Promise.resolve({});
    });
    await useModelGridStore.getState().load();
    const ok = await useModelGridStore
      .getState()
      .setCell({ line_id: LINE, period_id: PERIOD, value: "5.00" });
    expect(ok).toBe(false);
    const s = useModelGridStore.getState();
    expect(s.status).toBe("error");
    expect(s.error?.code).toBe("MODEL_CELL_LOCKED");
  });
});

describe("model grid store — period classification and hybrid labeling (M4-1 · F-021 · MODELING-METHODS-SPEC §5)", () => {
  function localLoad() {
    callMock.mockImplementation((cmd: string) => {
      if (cmd === "coa.list") return Promise.resolve(ACCOUNTS);
      if (cmd === "calendar.preview") return Promise.resolve(CALENDAR);
      return Promise.resolve({});
    });
  }

  it("initializes with PLAN_ONLY state, empty period arrays, and null hybridLabel", () => {
    const s = useModelGridStore.getState();
    expect(s.periodState).toBe("PLAN_ONLY");
    expect(s.actualPeriods).toEqual([]);
    expect(s.forecastPeriods).toEqual([]);
    expect(s.hybridLabel).toBeNull();
  });

  it("classifies mixed periods as HYBRID with canonical hybridLabel when actuals are set", async () => {
    localLoad();
    await useModelGridStore.getState().load();
    // CALENDAR fixture has 2 periods: fp-2026-p01 (P01) and fp-2026-p02 (P02)
    useModelGridStore.getState().setActualPeriods(["fp-2026-p01"]);
    const s = useModelGridStore.getState();
    expect(s.actualPeriods).toEqual(["fp-2026-p01"]);
    expect(s.forecastPeriods).toEqual(["fp-2026-p02"]);
    expect(s.periodState).toBe("HYBRID");
    expect(s.hybridLabel).toBe("HYBRID (Actual P01, Forecast P02)");
  });

  it("classifies as ACTUAL when all loaded periods are marked as actual", async () => {
    localLoad();
    await useModelGridStore.getState().load();
    useModelGridStore.getState().setActualPeriods(["fp-2026-p01", "fp-2026-p02"]);
    const s = useModelGridStore.getState();
    expect(s.actualPeriods).toEqual(["fp-2026-p01", "fp-2026-p02"]);
    expect(s.forecastPeriods).toEqual([]);
    expect(s.periodState).toBe("ACTUAL");
    expect(s.hybridLabel).toBeNull();
  });

  it("classifies as FORECAST when actual periods are empty on loaded grid", async () => {
    localLoad();
    await useModelGridStore.getState().load();
    useModelGridStore.getState().setActualPeriods([]);
    const s = useModelGridStore.getState();
    expect(s.actualPeriods).toEqual([]);
    expect(s.forecastPeriods).toEqual(["fp-2026-p01", "fp-2026-p02"]);
    expect(s.periodState).toBe("FORECAST");
    expect(s.hybridLabel).toBeNull();
  });

  it("supports explicit actual and forecast specification via updatePeriodClassification", () => {
    useModelGridStore.getState().updatePeriodClassification([], []);
    let s = useModelGridStore.getState();
    expect(s.periodState).toBe("PLAN_ONLY");
    expect(s.hybridLabel).toBeNull();

    useModelGridStore
      .getState()
      .updatePeriodClassification(
        ["P01", "P02", "P03", "P04"],
        ["P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12"],
      );
    s = useModelGridStore.getState();
    expect(s.periodState).toBe("HYBRID");
    expect(s.hybridLabel).toBe("HYBRID (Actual P01–P04, Forecast P05–P12)");
  });

  it("resets period classification back to initial PLAN_ONLY on reset()", async () => {
    localLoad();
    await useModelGridStore.getState().load();
    useModelGridStore.getState().setActualPeriods(["fp-2026-p01"]);
    expect(useModelGridStore.getState().periodState).toBe("HYBRID");

    useModelGridStore.getState().reset();
    const s = useModelGridStore.getState();
    expect(s.periodState).toBe("PLAN_ONLY");
    expect(s.actualPeriods).toEqual([]);
    expect(s.forecastPeriods).toEqual([]);
    expect(s.hybridLabel).toBeNull();
  });
});
