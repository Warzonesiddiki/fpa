import { describe, expect, it } from "vitest";
import { ModelEngine } from "./modelEngine";
import { handleEngineMessage, parseEngineError } from "./protocol";
import type { ModelGridLine, ModelGridPeriod } from "./modelEngine";

const LINES: ModelGridLine[] = [
  { id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000010", label: "4000 · Revenue", method: "manual" },
];
const PERIODS: ModelGridPeriod[] = [
  { id: "fp-2026-p01", code: "P01" },
  { id: "fp-2026-p02", code: "P02" },
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
});
