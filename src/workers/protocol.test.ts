import { describe, expect, it } from "vitest";
import { ModelEngine } from "./modelEngine";
import { handleEngineMessage, parseEngineError } from "./protocol";
import type { DriverDef, ModelGridLine, ModelGridPeriod } from "./modelEngine";

const LINES: ModelGridLine[] = [
  { id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000010", label: "4000 · Revenue", method: "manual" },
];
const PERIODS: ModelGridPeriod[] = [
  { id: "fp-2026-p01", code: "P01" },
  { id: "fp-2026-p02", code: "P02" },
];

const DRIVERS: DriverDef[] = [
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
];

describe("worker protocol (FORMULA-ENGINE-SPEC §5 envelope)", () => {
  it("dispatches loadGrid → setCell → getGrid → getDerived", () => {
    const engine = new ModelEngine();
    const load = handleEngineMessage(engine, {
      id: 1,
      op: "loadGrid",
      args: { lines: LINES, periods: PERIODS },
    });
    expect(load).toEqual({ id: 1, ok: true, data: null });

    const set = handleEngineMessage(engine, {
      id: 2,
      op: "setCell",
      args: { line_id: LINES[0].id, period_id: PERIODS[0].id, value: "5.00" },
    });
    expect(set.ok).toBe(true);
    if (set.ok) {
      expect((set.data as { cell: { amount_text: string | null } }).cell.amount_text).toBe("5.00");
    }

    const grid = handleEngineMessage(engine, { id: 3, op: "getGrid" });
    expect(grid.ok).toBe(true);
    if (grid.ok) expect(Array.isArray(grid.data)).toBe(true);

    const derived = handleEngineMessage(engine, {
      id: 4,
      op: "getDerived",
      args: { lineId: LINES[0].id },
    });
    expect(derived).toEqual({ id: 4, ok: true, data: { ytd: "5", fy: "5" } });
  });

  it("maps engine errors to the locked code + message envelope", () => {
    const engine = new ModelEngine();
    engine.loadGrid({ lines: LINES, periods: PERIODS });
    const bad = handleEngineMessage(engine, {
      id: 5,
      op: "setCell",
      args: { line_id: "unknown", period_id: PERIODS[0].id, value: "1.00" },
    });
    expect(bad).toMatchObject({
      id: 5,
      ok: false,
      error: { code: "REFERENCE_BROKEN" },
    });
  });

  it("returns INTERNAL for an unknown op without throwing", () => {
    const engine = new ModelEngine();
    const res = handleEngineMessage(engine, { id: 9, op: "nope" as never });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INTERNAL");
  });

  it("parseEngineError splits CODE: message and defaults to INTERNAL", () => {
    expect(parseEngineError(new Error("VALUE_INVALID: no value"))).toEqual({
      code: "VALUE_INVALID",
      message: "no value",
    });
    expect(parseEngineError("FORMULA_CYCLE")).toEqual({ code: "FORMULA_CYCLE", message: "" });
    expect(parseEngineError(new Error("boom"))).toEqual({ code: "boom", message: "" });
    // A bare/empty code is never surfaced — it collapses to INTERNAL (B20: locked codes only).
    expect(parseEngineError(new Error(": detail"))).toEqual({
      code: "INTERNAL",
      message: "detail",
    });
  });

  it("recalc returns the flat engine report", () => {
    const engine = new ModelEngine();
    engine.loadGrid({ lines: LINES, periods: PERIODS });
    engine.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "1.00" });
    const res = handleEngineMessage(engine, { id: 6, op: "recalc" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const r = res.data as { dirty_cells: number; changed_cells: string[]; issues: unknown[] };
      expect(r.dirty_cells).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(r.changed_cells)).toBe(true);
      expect(Array.isArray(r.issues)).toBe(true);
      // The setCell above already consumed its own dirty report; a bare recalc after an
      // unchanged graph reports an empty (deterministic) change set — not an error.
      expect(r.changed_cells).toEqual([]);
    }
  });

  it("dispatches inspectCell through the protocol", () => {
    const engine = new ModelEngine();
    engine.loadGrid({ lines: LINES, periods: PERIODS });
    engine.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "10.00" });
    // LINES[0] is row 2 (index 0), PERIODS[0] is col 1 (B).
    engine.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, formula: "=B2+5" });
    const res = handleEngineMessage(engine, {
      id: 7,
      op: "inspectCell",
      args: { line_id: LINES[0].id, period_id: PERIODS[1].id },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const r = res.data as { formula: string | null; precedents: unknown[] };
      expect(r.formula).toBe("=B2+5");
      // =B2+5 references B2 (col 1, row 2 = LINES[0]:PERIODS[0]) — resolved as single cell.
      expect(r.precedents.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("dispatches loadDrivers → setDriverValue → getDriverGrid → getDriverImpact", () => {
    const engine = new ModelEngine();
    engine.loadGrid({ lines: LINES, periods: PERIODS });
    const load = handleEngineMessage(engine, {
      id: 10,
      op: "loadDrivers",
      args: { drivers: DRIVERS, periods: PERIODS },
    });
    expect(load).toEqual({ id: 10, ok: true, data: null });

    const set = handleEngineMessage(engine, {
      id: 11,
      op: "setDriverValue",
      args: { driver_id: "dr-units", period_id: PERIODS[0].id, value_decimal: "12000" },
    });
    expect(set.ok).toBe(true);
    if (set.ok) {
      expect((set.data as { ok: boolean; recalc: { dirty_cells: number } }).ok).toBe(true);
    }

    const grid = handleEngineMessage(engine, { id: 12, op: "getDriverGrid" });
    expect(grid.ok).toBe(true);
    if (grid.ok) {
      const rows = grid.data as { driver_id: string; amount_text: string | null }[];
      expect(rows[0]?.amount_text).toBe("12000");
    }

    const impact = handleEngineMessage(engine, {
      id: 13,
      op: "getDriverImpact",
      args: { driver_id: "dr-units" },
    });
    expect(impact.ok).toBe(true);
    if (impact.ok) expect(Array.isArray(impact.data)).toBe(true);
  });

  it("maps a DRIVER_OUT_OF_BOUNDS engine error to the locked code", () => {
    const engine = new ModelEngine();
    engine.loadGrid({ lines: LINES, periods: PERIODS });
    engine.loadDrivers(DRIVERS, PERIODS);
    const res = handleEngineMessage(engine, {
      id: 14,
      op: "setDriverValue",
      args: { driver_id: "dr-units", period_id: PERIODS[0].id, value_decimal: "200000" },
    });
    expect(res).toMatchObject({ id: 14, ok: false, error: { code: "DRIVER_OUT_OF_BOUNDS" } });
  });

  it("dispatches scanHardcoded and convertHardcoded", () => {
    const engine = new ModelEngine();
    engine.loadGrid({ lines: LINES, periods: PERIODS });
    engine.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, formula: "=base*1.04" });

    const scan = handleEngineMessage(engine, { id: 15, op: "scanHardcoded" });
    expect(scan.ok).toBe(true);
    if (scan.ok) {
      const findings = scan.data as { formula: string; literals: { literal: string }[] }[];
      expect(findings).toHaveLength(1);
      expect(findings[0]?.literals[0]?.literal).toBe("1.04");
    }

    const convert = handleEngineMessage(engine, {
      id: 16,
      op: "convertHardcoded",
      args: {
        line_id: LINES[0].id,
        period_id: PERIODS[0].id,
        literal: { literal: "1.04", start: 6, end: 10 },
        assumption_name: "wage_inflation",
      },
    });
    expect(convert.ok).toBe(true);
    if (convert.ok) {
      expect((convert.data as { cell: { formula: string | null } }).cell.formula).toBe(
        "=base*wage_inflation",
      );
    }
  });
});

describe("M3-10: named range protocol ops", () => {
  function loadedEngine(): ModelEngine {
    const e = new ModelEngine();
    e.loadGrid({ lines: LINES, periods: PERIODS });
    return e;
  }

  it("addNamedRange stores a named expression and listNamedRanges returns it", () => {
    const engine = loadedEngine();
    const add = handleEngineMessage(engine, {
      id: 20,
      op: "addNamedRange",
      args: { name: "wage_inflation", value: "0.05" },
    });
    expect(add.ok).toBe(true);

    const list = handleEngineMessage(engine, { id: 21, op: "listNamedRanges" });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data).toEqual(["wage_inflation"]);

    const get = handleEngineMessage(engine, {
      id: 22,
      op: "getNamedRangeValue",
      args: { name: "wage_inflation" },
    });
    expect(get.ok).toBe(true);
    if (get.ok) expect(get.data).toBe("0.05");
  });

  it("removeNamedRange removes the named expression", () => {
    const engine = loadedEngine();
    handleEngineMessage(engine, {
      id: 23,
      op: "addNamedRange",
      args: { name: "alpha", value: "1" },
    });
    const rm = handleEngineMessage(engine, {
      id: 24,
      op: "removeNamedRange",
      args: { name: "alpha" },
    });
    expect(rm.ok).toBe(true);

    const list = handleEngineMessage(engine, { id: 25, op: "listNamedRanges" });
    if (list.ok) expect(list.data).toEqual([]);
  });

  it("getNamedRangeValue returns null for unknown names", () => {
    const engine = loadedEngine();
    const get = handleEngineMessage(engine, {
      id: 26,
      op: "getNamedRangeValue",
      args: { name: "nonexistent" },
    });
    expect(get.ok).toBe(true);
    if (get.ok) expect(get.data).toBeNull();
  });
});

describe("M3-5: spreadTotal op (MODELING-METHODS-SPEC §3)", () => {
  // spreadTotal is a pure computation — no grid needs to be loaded.
  const loadedEngine = () => new ModelEngine();
  it("returns exact period values whose sum equals the total", () => {
    const engine = loadedEngine();
    const res = handleEngineMessage(engine, {
      id: 30,
      op: "spreadTotal",
      args: {
        total: "100.00",
        periodIds: ["fp-2026-p01", "fp-2026-p02", "fp-2026-p03"],
        method: "equal",
        scale: 2,
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { values: { amount_text: string }[]; sum_text: string };
      expect(data.values.map((v) => v.amount_text)).toEqual(["33.33", "33.33", "33.34"]);
      expect(data.sum_text).toBe("100.00");
    }
  });

  it("surfaces SPREAD_WEIGHTS_INVALID with the documented user text and the normalise offer", () => {
    const engine = loadedEngine();
    const res = handleEngineMessage(engine, {
      id: 31,
      op: "spreadTotal",
      args: {
        total: "100.00",
        periodIds: ["fp-2026-p01", "fp-2026-p02"],
        method: "seasonal",
        weights: ["0.6", "0.6"],
        scale: 2,
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("SPREAD_WEIGHTS_INVALID");
      const payload = JSON.parse(res.error.message) as {
        userMessage: string;
        details: { sum: string; canNormalize: boolean };
      };
      expect(payload.userMessage).toBe(
        "Seasonality weights total 120% — normalize to 100% or fix.",
      );
      expect(payload.details).toMatchObject({ sum: "120", canNormalize: true });
    }
  });
});
