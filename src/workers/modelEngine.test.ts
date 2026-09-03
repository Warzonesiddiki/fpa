import { describe, expect, it } from "vitest";
import {
  computeAnalysisFunction,
  convertHardcodedFormula,
  findHardcodedLiterals,
  ModelEngine,
  MAX_FORMULA_LEN,
} from "./modelEngine";
import type { DriverDef, ModelGridLine, ModelGridPeriod } from "./modelEngine";
import Decimal from "decimal.js";

/** Convert a cell's computed_text to a number (uses Decimal, avoids money-ast B3 banned ops). */
function cellNum(text: string | null): number {
  return new Decimal(text ?? "0").toNumber();
}

const LINES: ModelGridLine[] = [
  { id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000010", label: "4000 · Revenue", method: "manual" },
  {
    id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000011",
    label: "4100 · Software Licenses",
    method: "manual",
  },
  { id: "3f9f2c9e-9f8b-4e2d-9a1c-400000000020", label: "6000 · COGS", method: "manual" },
];

const PERIODS: ModelGridPeriod[] = [
  { id: "fp-2026-p01", code: "P01" },
  { id: "fp-2026-p02", code: "P02" },
  { id: "fp-2026-p03", code: "P03" },
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
  {
    id: "dr-price",
    name: "price",
    driver_type: "volume_x_rate",
    unit: null,
    source: "global",
    is_core: true,
    bounds_low: null,
    bounds_high: null,
  },
];

function engineWithLayout(ytdThrough?: number): ModelEngine {
  const e = new ModelEngine();
  e.loadGrid({ lines: LINES, periods: PERIODS, ytdThrough });
  return e;
}

describe("ModelEngine (HyperFormula graph, FORMULA-ENGINE-SPEC §5)", () => {
  it("loads the grid and reports the period count", () => {
    const e = engineWithLayout();
    expect(e.periodCount).toBe(3);
    expect(e.getGrid()).toHaveLength(3 * 3);
    // Every empty cell renders as null amounts, not a float.
    for (const c of e.getGrid()) {
      expect(c.amount_text).toBeNull();
      expect(c.computed_text).toBeNull();
      expect(c.error_code).toBeNull();
      expect(c.manual_override).toBe(false);
    }
  });

  it("stores a manual value as the exact decimal string (no float drift)", () => {
    const e = engineWithLayout();
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: PERIODS[0].id,
      value: "182500.00",
    });
    expect(cell.amount_text).toBe("182500.00");
    expect(cell.computed_text).toBe("182500.00");
    expect(cell.formula).toBeNull();
    expect(cell.manual_override).toBe(false);
    // Read back through getCell — still the exact string.
    expect(e.getCell(LINES[0].id, PERIODS[0].id).amount_text).toBe("182500.00");
  });

  it("keeps sub-decimal values exact (0.1-style manual amounts never become 0.1000000001)", () => {
    const e = engineWithLayout();
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "0.1" });
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, value: "0.2" });
    expect(e.getCell(LINES[0].id, PERIODS[0].id).amount_text).toBe("0.1");
    expect(e.getCell(LINES[0].id, PERIODS[1].id).amount_text).toBe("0.2");
  });

  it("computes a whitelisted formula and commit-rounds to Currency Scale", () => {
    const e = engineWithLayout();
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "10.00" });
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, value: "20.00" });
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: PERIODS[2].id,
      formula: "=SUM(B2:C2)",
    });
    expect(cell.formula).toBe("=SUM(B2:C2)");
    expect(cell.amount_text).toBeNull(); // formula cell — the amount is computed, not manual
    expect(cell.computed_text).toBe("30"); // 10 + 20 = 30
  });

  it("derives YTD and FY totals from the real period cells", () => {
    const e = engineWithLayout(2); // YTD through period 2
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "100.00" });
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, value: "50.00" });
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[2].id, value: "25.00" });
    const d = e.getDerived(LINES[0].id);
    expect(d.ytd).toBe("150"); // 100 + 50 (YTD through P02)
    expect(d.fy).toBe("175"); // 100 + 50 + 25
  });

  it("returns null derived values for an unloaded/empty grid", () => {
    const e = new ModelEngine();
    expect(e.getDerived(LINES[0].id)).toEqual({ ytd: null, fy: null });
  });

  it("detects a cycle and reports FORMULA_CYCLE, never a numeric fallback", () => {
    const e = engineWithLayout();
    // 3 periods: col 1=P01(B), col 2=P02(C), col 3=P03(D), col 4=YTD(E). A cell that
    // points at YTD while YTD sums it (and a sibling) is a cycle.
    const first = e.setCell({
      line_id: LINES[0].id,
      period_id: PERIODS[0].id,
      formula: "=E2",
    });
    const second = e.setCell({
      line_id: LINES[0].id,
      period_id: PERIODS[1].id,
      formula: "=B2",
    });
    // The cycle shows as #CYCLE! on the cyclic cells — never a number.
    expect(first.cell.error_code).toBe("FORMULA_CYCLE");
    expect(first.cell.computed_text).toBe("#CYCLE!");
    const cyclic = e.getCell(LINES[0].id, PERIODS[0].id);
    const cyclic2 = e.getCell(LINES[0].id, PERIODS[1].id);
    const hasCycleCell = [cyclic, cyclic2].some((c) => c.error_code === "FORMULA_CYCLE");
    expect(hasCycleCell).toBe(true);
    void second;
    // The recalc envelope surfaces the issue.
    const report = e.recalc();
    expect(report.issues.some((i) => i.code === "FORMULA_CYCLE")).toBe(true);
  });

  it("rejects an unsupported function (whitelist mirror) before touching the graph", () => {
    const e = engineWithLayout();
    expect(() =>
      e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, formula: "=LAMBDA(x, x)" }),
    ).toThrow(/FORMULA_UNSUPPORTED_FUNCTION/);
  });

  it("rejects formulas without '=' or beyond the max length", () => {
    const e = engineWithLayout();
    expect(() =>
      e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, formula: "SUM(B2:C2)" }),
    ).toThrow(/VALUE_INVALID/);
    const long = "=".concat("SUM(B2:C2) + ".repeat(300));
    expect(long.length).toBeGreaterThan(MAX_FORMULA_LEN);
    expect(() =>
      e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, formula: long }),
    ).toThrow(/VALUE_INVALID/);
  });

  it("rejects edits on an unloaded grid and unknown line/period", () => {
    const e = new ModelEngine();
    expect(() =>
      e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "1.00" }),
    ).toThrow(/INTERNAL/);
    const loaded = engineWithLayout();
    expect(() =>
      loaded.setCell({ line_id: "nope", period_id: PERIODS[0].id, value: "1.00" }),
    ).toThrow(/REFERENCE_BROKEN/);
    expect(() =>
      loaded.setCell({ line_id: LINES[0].id, period_id: "nope", value: "1.00" }),
    ).toThrow(/REFERENCE_BROKEN/);
  });

  it("requires a value or a formula", () => {
    const e = engineWithLayout();
    expect(() => e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id })).toThrow(
      /VALUE_INVALID/,
    );
  });

  it("marks manual-override cells and clears it on later edits", () => {
    const e = engineWithLayout();
    e.setCell({
      line_id: LINES[0].id,
      period_id: PERIODS[0].id,
      value: "10.00",
      manual_override: true,
    });
    expect(e.getCell(LINES[0].id, PERIODS[0].id).manual_override).toBe(true);
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "11.00" });
    expect(e.getCell(LINES[0].id, PERIODS[0].id).manual_override).toBe(false);
  });

  it("returns a deterministic recalc envelope in the API-SPEC §3 shape", () => {
    const e = engineWithLayout();
    const result = e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "5.00" });
    const recalc = result.recalc;
    expect(recalc).toMatchObject({
      dirty_cells: 1,
      cycles: [],
      changed_cells: [LINES[0].id],
      issues: [],
    });
    expect(recalc.duration_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(recalc.dirty_cells)).toBe(true);
  });

  it("rebuilds a fresh grid on loadGrid (reload resets old cells)", () => {
    const e = engineWithLayout();
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "9.00" });
    e.loadGrid({ lines: LINES, periods: PERIODS });
    expect(e.getCell(LINES[0].id, PERIODS[0].id).amount_text).toBeNull();
  });

  // ── inspectCell (M3-2 · FORMULA-ENGINE-SPEC §6) ────────────────────────────────

  it("inspectCell returns formula, error, and empty deps for a manual cell", () => {
    const e = engineWithLayout();
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "100.00" });
    const r = e.inspectCell(LINES[0].id, PERIODS[0].id);
    expect(r.formula).toBeNull();
    expect(r.computed_text).toBe("100.00");
    expect(r.error_code).toBeNull();
    expect(r.precedents).toEqual([]);
    expect(r.dependents).toEqual([]);
    expect(r.cycle).toBeNull();
    expect(r.is_cycle).toBe(false);
  });

  it("inspectCell traces precedents and dependents of a formula cell", () => {
    const e = engineWithLayout();
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "10.00" });
    e.setCell({ line_id: LINES[1].id, period_id: PERIODS[0].id, formula: "=B2+5" });
    // B2 = row 2, col 1 (P01) = line 0 / period 0. Setting LINES[1] (row 3, col B)
    // formula: =B2+5 → precedents of LINES[1] should include line 0 / period 0.
    const r = e.inspectCell(LINES[1].id, PERIODS[0].id);
    expect(r.formula).toBe("=B2+5");
    expect(r.error_code).toBeNull();
    expect(r.precedents.length).toBeGreaterThanOrEqual(1);
    // At least one precedent should point back to LINES[0] (the value cell).
    const hasSource = r.precedents.some(
      (p) => p.line_id === LINES[0].id && p.period_id === PERIODS[0].id,
    );
    expect(hasSource).toBe(true);
    // The value cell should list this formula cell as a dependent.
    const dep = e.inspectCell(LINES[0].id, PERIODS[0].id);
    const hasDep = dep.dependents.some(
      (d) => d.line_id === LINES[1].id && d.period_id === PERIODS[0].id,
    );
    expect(hasDep).toBe(true);
  });

  it("inspectCell returns REFERENCE_BROKEN for an unknown cell", () => {
    const e = engineWithLayout();
    const r = e.inspectCell("bogus-line", PERIODS[0].id);
    expect(r.error_code).toBe("REFERENCE_BROKEN");
    expect(r.formula).toBeNull();
    expect(r.computed_text).toBeNull();
  });

  it("inspectCell returns empty fields on an unloaded engine", () => {
    const e = new ModelEngine();
    const r = e.inspectCell(LINES[0].id, PERIODS[0].id);
    expect(r.error_code).toBeNull();
    expect(r.precedents).toEqual([]);
    expect(r.dependents).toEqual([]);
    expect(r.cycle).toBeNull();
  });

  // ── Driver Tables (M3-3 · F-013 · MODELING-METHODS-SPEC §2) ──────────────────────────

  it("loadDrivers builds the Drivers sheet and snapshots empty/loaded values", () => {
    const e = engineWithLayout();
    expect(e.getDriverGrid()).toEqual([]);
    e.loadDrivers(DRIVERS, PERIODS);
    expect(e.getDrivers()).toHaveLength(2);
    expect(e.getDriverGrid()).toHaveLength(2 * PERIODS.length);
    for (const v of e.getDriverGrid()) expect(v.amount_text).toBeNull();
  });

  it("stores a driver value as the exact decimal string and feeds a Model formula", () => {
    const e = engineWithLayout();
    e.loadDrivers(DRIVERS, PERIODS);
    e.setDriverValue("dr-units", PERIODS[0].id, "12000");
    expect(e.getDriverValue("dr-units", PERIODS[0].id)).toBe("12000");
    // First driver (row 1 in the Drivers sheet) × first period (col 1) = Drivers!B2.
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: PERIODS[1].id,
      formula: "=Drivers!B2*2",
    });
    expect(cell.computed_text).toBe("24000");
  });

  it("recalculates a dependent Model formula when the driver value changes", () => {
    const e = engineWithLayout();
    e.loadDrivers(DRIVERS, PERIODS);
    e.setDriverValue("dr-units", PERIODS[0].id, "12000");
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, formula: "=Drivers!B2*2" });
    expect(e.getCell(LINES[0].id, PERIODS[1].id).computed_text).toBe("24000");
    e.setDriverValue("dr-units", PERIODS[0].id, "3000");
    expect(e.getCell(LINES[0].id, PERIODS[1].id).computed_text).toBe("6000");
  });

  it("enforces bounds → DRIVER_OUT_OF_BOUNDS (never a silent clamp)", () => {
    const e = engineWithLayout();
    e.loadDrivers(DRIVERS, PERIODS);
    expect(() => e.setDriverValue("dr-units", PERIODS[0].id, "200000")).toThrow(
      /DRIVER_OUT_OF_BOUNDS/,
    );
    expect(() => e.setDriverValue("dr-units", PERIODS[0].id, "-1")).toThrow(/DRIVER_OUT_OF_BOUNDS/);
    // An unbounded driver accepts any value.
    expect(e.setDriverValue("dr-price", PERIODS[0].id, "999999999").ok).toBe(true);
  });

  it("setDriverValue on an unknown/unloaded driver → DRIVER_FEED_MISSING", () => {
    const e = engineWithLayout();
    e.loadDrivers(DRIVERS, PERIODS);
    expect(() => e.setDriverValue("dr-nope", PERIODS[0].id, "1")).toThrow(/DRIVER_FEED_MISSING/);
  });

  it("loadDrivers with no drivers yields an empty driver grid", () => {
    const e = engineWithLayout();
    e.loadDrivers([], PERIODS);
    expect(e.getDriverGrid()).toEqual([]);
    expect(e.getDrivers()).toEqual([]);
    expect(() => e.setDriverValue("dr-x", PERIODS[0].id, "1")).toThrow(/DRIVER_FEED_MISSING/);
  });

  it("getDriverImpact reports the Model cells that reference a driver (S-043)", () => {
    const e = engineWithLayout();
    e.loadDrivers(DRIVERS, PERIODS);
    e.setDriverValue("dr-units", PERIODS[0].id, "12000");
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, formula: "=Drivers!B2*2" });
    const impact = e.getDriverImpact("dr-units");
    expect(impact.some((r) => r.line_id === LINES[0].id && r.period_id === PERIODS[1].id)).toBe(
      true,
    );
    expect(impact[0]?.formula).toBe("=Drivers!B2*2");
    expect(e.getDriverImpact("dr-price")).toEqual([]);
  });

  it("setDriverValue recalc marks the dependent lines as changed", () => {
    const e = engineWithLayout();
    e.loadDrivers(DRIVERS, PERIODS);
    e.setDriverValue("dr-units", PERIODS[0].id, "12000");
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, formula: "=Drivers!B2*2" });
    const { recalc } = e.setDriverValue("dr-units", PERIODS[0].id, "5000");
    expect(recalc.changed_cells).toContain(LINES[0].id);
    expect(recalc.dirty_cells).toBeGreaterThanOrEqual(0);
  });
});

describe("ModelEngine.clearCell (M3-9 undo-to-empty)", () => {
  it("clears a cell back to empty and recomputes derived totals", () => {
    const e = engineWithLayout();
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, value: "100.00" });
    expect(e.getCell(LINES[0].id, PERIODS[0].id).amount_text).toBe("100.00");
    const cleared = e.clearCell(LINES[0].id, PERIODS[0].id);
    expect(cleared.amount_text).toBeNull();
    expect(cleared.formula).toBeNull();
    expect(cleared.computed_text).toBeNull();
    expect(e.getCell(LINES[0].id, PERIODS[0].id).amount_text).toBeNull();
  });

  it("throws REFERENCE_BROKEN for an unknown line or period", () => {
    const e = engineWithLayout();
    expect(() => e.clearCell("nope", PERIODS[0].id)).toThrow(/REFERENCE_BROKEN/);
    expect(() => e.clearCell(LINES[0].id, "nope")).toThrow(/REFERENCE_BROKEN/);
  });
});

describe("analysis functions", () => {
  it("computes exact CAGR", () => {
    expect(computeAnalysisFunction("CAGR", ["100", "121"], "2")[0]).toBe("0.1");
  });
  it("computes partial-window moving averages", () => {
    expect(computeAnalysisFunction("MOVINGAVG", ["2", "4", "8"], "2")).toEqual(["2", "3", "6"]);
  });
  it("projects a least-squares trend", () => {
    expect(computeAnalysisFunction("TREND", ["2", "4", "6"], "2")).toEqual(["8", "10"]);
  });
  it("returns seasonality shares", () => {
    expect(computeAnalysisFunction("SEASONALITY", ["1", "3"])).toEqual(["0.25", "0.75"]);
  });
});

// ── M3-10: Analysis Functions as HyperFormula custom functions ────────────────────

const TWELVE_PERIODS: ModelGridPeriod[] = Array.from({ length: 12 }, (_, i) => ({
  id: `fp-2026-p${String(i + 1).padStart(2, "0")}`,
  code: `P${String(i + 1).padStart(2, "0")}`,
}));

const PRIOR_YEAR_PERIODS: ModelGridPeriod[] = Array.from({ length: 12 }, (_, i) => ({
  id: `fp-2025-p${String(i + 1).padStart(2, "0")}`,
  code: `P${String(i + 1).padStart(2, "0")}`,
}));

function engineWithTwelvePeriods(): ModelEngine {
  const e = new ModelEngine();
  e.loadGrid({ lines: LINES, periods: TWELVE_PERIODS });
  return e;
}

describe("M3-10: Analysis Functions as HyperFormula custom functions", () => {
  it("CAGR(start, end, periods) evaluates in the grid", () => {
    const e = new ModelEngine(4); // scale=4 to preserve rate precision
    e.loadGrid({ lines: LINES, periods: TWELVE_PERIODS });
    // Put start=100 in P01, end=200 in P02, compute CAGR in P03.
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "100" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[1].id, value: "200" });
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[2].id,
      formula: "=CAGR(B2,C2,2)",
    });
    expect(cell.error_code).toBeNull();
    // CAGR(100, 200, 2) = (200/100)^(1/2) - 1 ≈ 0.4142
    const result = cellNum(cell.computed_text);
    expect(Math.abs(result - 0.4142)).toBeLessThan(0.001);
  });

  it("CAGR returns #VALUE! when start is zero", () => {
    const e = engineWithTwelvePeriods();
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "0" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[1].id, value: "100" });
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[2].id,
      formula: "=CAGR(B2,C2,2)",
    });
    expect(cell.computed_text).toBe("#VALUE!");
  });

  it("RATIO(a, b) evaluates and returns #DIV/0! on zero denominator", () => {
    const e = new ModelEngine(4); // scale=4 for ratio precision
    e.loadGrid({ lines: LINES, periods: TWELVE_PERIODS });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "10" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[1].id, value: "3" });
    const ratio = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[2].id,
      formula: "=RATIO(B2,C2)",
    });
    expect(cellNum(ratio.cell.computed_text)).toBeCloseTo(10 / 3, 3);

    // Division by zero.
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[1].id, value: "0" });
    const zero = e.getCell(LINES[0].id, TWELVE_PERIODS[2].id);
    expect(zero.computed_text).toBe("#DIV/0!");
  });

  it("MOVINGAVG(range, window) returns the last moving average value", () => {
    const e = engineWithTwelvePeriods();
    // Fill P01-P04 with 10, 20, 30, 40. MOVINGAVG(P01:P04, 2) should return avg(30,40)=35.
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "10" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[1].id, value: "20" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[2].id, value: "30" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[3].id, value: "40" });
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[4].id,
      formula: "=MOVINGAVG(B2:E2,2)",
    });
    expect(cellNum(cell.computed_text)).toBeCloseTo(35, 1);
  });

  it("TREND(range, points) returns the first projected value", () => {
    const e = engineWithTwelvePeriods();
    // Linear sequence 2, 4, 6 → next value should be 8.
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "2" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[1].id, value: "4" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[2].id, value: "6" });
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[3].id,
      formula: "=TREND(B2:D2,1)",
    });
    expect(cellNum(cell.computed_text)).toBeCloseTo(8, 1);
  });

  it("SEASONALITY(range) returns the last period's share", () => {
    const e = engineWithTwelvePeriods();
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "25" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[1].id, value: "75" });
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[2].id,
      formula: "=SEASONALITY(B2:C2)",
    });
    // Last seasonal index = 75/100 = 0.75.
    expect(cellNum(cell.computed_text)).toBeCloseTo(0.75, 2);
  });

  it("SEASONALITY returns 0 when total is zero", () => {
    const e = engineWithTwelvePeriods();
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "0" });
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[1].id, value: "0" });
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[2].id,
      formula: "=SEASONALITY(B2:C2)",
    });
    expect(cellNum(cell.computed_text)).toBe(0);
  });
});

// ── M3-10: Named Ranges (Assumptions as Named Expressions) ────────────────────────

describe("M3-10: Named Ranges (FORMULA-ENGINE-SPEC §1)", () => {
  it("adds, lists, reads, and removes named ranges", () => {
    const e = engineWithTwelvePeriods();
    expect(e.listNamedRanges()).toEqual([]);
    e.addNamedRange("wage_inflation", "0.05");
    expect(e.listNamedRanges()).toEqual(["wage_inflation"]);
    expect(e.getNamedRangeValue("wage_inflation")).toBe("0.05");

    // Update the named range.
    e.addNamedRange("wage_inflation", "0.08");
    expect(e.getNamedRangeValue("wage_inflation")).toBe("0.08");

    e.removeNamedRange("wage_inflation");
    expect(e.listNamedRanges()).toEqual([]);
    expect(e.getNamedRangeValue("wage_inflation")).toBeNull();
  });

  it("removeNamedRange is a no-op for unknown names", () => {
    const e = engineWithTwelvePeriods();
    e.removeNamedRange("nonexistent"); // Should not throw.
    expect(e.listNamedRanges()).toEqual([]);
  });

  it("rejects invalid names (must be snake_case)", () => {
    const e = engineWithTwelvePeriods();
    expect(() => e.addNamedRange("Bad Name", "1")).toThrow(/VALUE_INVALID/);
    expect(() => e.addNamedRange("123start", "1")).toThrow(/VALUE_INVALID/);
    expect(() => e.addNamedRange("UPPER", "1")).toThrow(/VALUE_INVALID/);
  });

  it("named ranges resolve in formulas (assumption-driven computation)", () => {
    const e = engineWithTwelvePeriods();
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "1000" });
    // wage_inflation = 0.05. Formula: B2 * wage_inflation → 1000 * 0.05 = 50.
    e.addNamedRange("wage_inflation", "0.05");
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[1].id,
      formula: "=B2*wage_inflation",
    });
    expect(cell.error_code).toBeNull();
    expect(cellNum(cell.computed_text)).toBeCloseTo(50, 1);
  });

  it("updating a named range recomputes dependent formulas", () => {
    const e = engineWithTwelvePeriods();
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "1000" });
    e.addNamedRange("growth_rate", "0.10");
    e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[1].id,
      formula: "=B2*growth_rate",
    });
    expect(cellNum(e.getCell(LINES[0].id, TWELVE_PERIODS[1].id).computed_text)).toBeCloseTo(100, 1);
    // Change the named range value and recalc.
    e.addNamedRange("growth_rate", "0.20");
    e.recalc();
    expect(cellNum(e.getCell(LINES[0].id, TWELVE_PERIODS[1].id).computed_text)).toBeCloseTo(200, 1);
  });

  it("multiple named ranges coexist", () => {
    const e = engineWithTwelvePeriods();
    e.addNamedRange("alpha", "2");
    e.addNamedRange("beta", "3");
    e.addNamedRange("gamma", "4");
    expect(e.listNamedRanges().sort()).toEqual(["alpha", "beta", "gamma"]);
    expect(e.getNamedRangeValue("alpha")).toBe("2");
    expect(e.getNamedRangeValue("beta")).toBe("3");
    expect(e.getNamedRangeValue("gamma")).toBe("4");
  });

  it("converted hardcoded assumptions resolve via named ranges", () => {
    const e = engineWithTwelvePeriods();
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "1000" });
    // First convert a hardcoded literal to a named-range reference.
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[1].id,
      formula: "=B2*1.05",
    });
    const literals = cell.formula ? findHardcodedLiterals(cell.formula) : [];
    expect(literals.length).toBe(1);
    e.convertHardcoded(LINES[0].id, TWELVE_PERIODS[1].id, literals[0], "inflation_rate");
    // Now define the named range so the reference resolves.
    e.addNamedRange("inflation_rate", "1.05");
    // B2 * inflation_rate = 1000 * 1.05 = 1050.
    expect(cellNum(e.getCell(LINES[0].id, TWELVE_PERIODS[1].id).computed_text)).toBeCloseTo(
      1050,
      1,
    );
  });
});

// ── M3-10: Calendar-Aware Functions (YOY/PRIORPERIOD/PRIORYEAR) ───────────────────

describe("M3-10: Calendar-Aware Functions (YOY/PRIORPERIOD/PRIORYEAR)", () => {
  it("detects 12-period calendar from loaded periods", () => {
    const e = engineWithTwelvePeriods();
    expect(e.periodsPerYear).toBe(12);
  });

  it("detects 13-period calendar (4-5-4)", () => {
    const periods13: ModelGridPeriod[] = Array.from({ length: 13 }, (_, i) => ({
      id: `fp-2026-p${String(i + 1).padStart(2, "0")}`,
      code: `P${String(i + 1).padStart(2, "0")}`,
    }));
    const e = new ModelEngine();
    e.loadGrid({ lines: LINES, periods: periods13 });
    expect(e.periodsPerYear).toBe(13);
  });

  it("getPeriodIdForColumn resolves and returns null for unknown columns", () => {
    const e = engineWithTwelvePeriods();
    expect(e.getPeriodIdForColumn(1)).toBe("fp-2026-p01");
    expect(e.getPeriodIdForColumn(12)).toBe("fp-2026-p12");
    expect(e.getPeriodIdForColumn(99)).toBeNull();
  });

  it("getCellNumberAtPeriod reads values and returns CellError(REF) for missing periods", () => {
    const e = engineWithTwelvePeriods();
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "42" });
    expect(e.getCellNumberAtPeriod(1, "fp-2026-p01")).toBe(42);
    const missing = e.getCellNumberAtPeriod(1, "fp-2025-p01");
    expect(typeof missing).toBe("object");
    expect((missing as { type: string }).type).toBe("REF");
  });

  it("YOY resolves to the same period in the prior fiscal year (two-year grid)", () => {
    // Build a 24-period grid (FY2025 + FY2026).
    // Col layout: A=labels, B=fp-2025-p01, ..., M=fp-2025-p12, N=fp-2026-p01, ..., Y=fp-2026-p12.
    const allPeriods = [...PRIOR_YEAR_PERIODS, ...TWELVE_PERIODS];
    const e = new ModelEngine();
    e.loadGrid({ lines: LINES, periods: allPeriods });
    // Put 100 in FY2025-P01 (col 1 = B2).
    e.setCell({ line_id: LINES[0].id, period_id: PRIOR_YEAR_PERIODS[0].id, value: "100" });
    // Put 120 in FY2026-P01 (col 13 = N2).
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "120" });
    // YOY in FY2026-P02 (col 14 = O2) references N2 (fp-2026-p01) → resolves to B2 (fp-2025-p01).
    // We use O2 (not N2) to avoid a self-reference cycle.
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[1].id,
      formula: "=YOY(N2)",
    });
    expect(cell.error_code).toBeNull();
    expect(cell.computed_text).toBe("100");
  });

  it("PRIORPERIOD wraps from P01 to previous year's P12", () => {
    const allPeriods = [...PRIOR_YEAR_PERIODS, ...TWELVE_PERIODS];
    const e = new ModelEngine();
    e.loadGrid({ lines: LINES, periods: allPeriods });
    // FY2025-P12 (col 12 = M2) has value 500.
    e.setCell({ line_id: LINES[0].id, period_id: PRIOR_YEAR_PERIODS[11].id, value: "500" });
    // PRIORPERIOD in FY2026-P02 (col 14 = O2) references N2 (fp-2026-p01).
    // N2 → fp-2026-p01 → prior period = fp-2025-p12 → col 12 → M2 = 500.
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[1].id,
      formula: "=PRIORPERIOD(N2)",
    });
    expect(cell.error_code).toBeNull();
    expect(cell.computed_text).toBe("500");
  });

  it("PRIORPERIOD steps back one period within the same year", () => {
    const allPeriods = [...PRIOR_YEAR_PERIODS, ...TWELVE_PERIODS];
    const e = new ModelEngine();
    e.loadGrid({ lines: LINES, periods: allPeriods });
    // FY2026-P01 (col 13 = N2) has value 100.
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "100" });
    // PRIORPERIOD in FY2026-P03 (col 15 = P2) references O2 (fp-2026-p02).
    // O2 → fp-2026-p02 → prior period = fp-2026-p01 → col 13 → N2 = 100.
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[2].id,
      formula: "=PRIORPERIOD(O2)",
    });
    expect(cell.error_code).toBeNull();
    expect(cell.computed_text).toBe("100");
  });

  it("PRIORYEAR is equivalent to YOY (same period, prior year)", () => {
    const allPeriods = [...PRIOR_YEAR_PERIODS, ...TWELVE_PERIODS];
    const e = new ModelEngine();
    e.loadGrid({ lines: LINES, periods: allPeriods });
    // FY2025-P06 (col 6 = G2) has value 750.
    e.setCell({ line_id: LINES[0].id, period_id: PRIOR_YEAR_PERIODS[5].id, value: "750" });
    // PRIORYEAR in FY2026-P08 (col 20 = T2) references S2 (fp-2026-p06 = col 18).
    // S2 → fp-2026-p06 → prior year = fp-2025-p06 → col 6 → G2 = 750.
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[7].id,
      formula: "=PRIORYEAR(S2)",
    });
    expect(cell.error_code).toBeNull();
    expect(cell.computed_text).toBe("750");
  });

  it("YOY returns #REF! when prior-year period is not loaded", () => {
    // Single-year grid — no FY2025 data.
    const e = engineWithTwelvePeriods();
    e.setCell({ line_id: LINES[0].id, period_id: TWELVE_PERIODS[0].id, value: "100" });
    // YOY in P03 (col 3 = D2) references C2 (fp-2026-p02).
    // C2 → fp-2026-p02 → prior year = fp-2025-p02 → NOT LOADED → #REF!
    const { cell } = e.setCell({
      line_id: LINES[0].id,
      period_id: TWELVE_PERIODS[2].id,
      formula: "=YOY(C2)",
    });
    expect(cell.computed_text).toBe("#REF!");
  });
});

describe("hardcoded-assumption detection (M3-4)", () => {
  it("finds plain, decimal and percent literals with exact spans", () => {
    expect(findHardcodedLiterals("=base*2")).toEqual([{ literal: "2", start: 6, end: 7 }]);
    expect(findHardcodedLiterals("=base*(1+0.04)")).toEqual([
      { literal: "1", start: 7, end: 8 },
      { literal: "0.04", start: 9, end: 13 },
    ]);
    expect(findHardcodedLiterals("=base*4%")).toEqual([{ literal: "4%", start: 6, end: 8 }]);
  });

  it("ignores cell references, sheet-qualified refs, strings and identifiers", () => {
    expect(findHardcodedLiterals("=SUM(B2:B10)")).toEqual([]);
    expect(findHardcodedLiterals("='Opex Detail'!C10*2")).toEqual([
      { literal: "2", start: 19, end: 20 },
    ]);
    expect(findHardcodedLiterals('=IF(B2>0,"5",B3)')).toEqual([{ literal: "0", start: 7, end: 8 }]);
    expect(findHardcodedLiterals("=wage_inflation*2")).toEqual([
      { literal: "2", start: 16, end: 17 },
    ]);
    expect(findHardcodedLiterals("=wage_inflation2*2")).toEqual([
      { literal: "2", start: 17, end: 18 },
    ]);
  });

  it("flags hardcoded step/ramp values in a conditional formula", () => {
    expect(findHardcodedLiterals("=IF(period>=6,0,ramp)")).toEqual([
      { literal: "6", start: 12, end: 13 },
      { literal: "0", start: 14, end: 15 },
    ]);
  });

  it("scans the loaded grid deterministically", () => {
    const e = engineWithLayout();
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, formula: "=base*1.04" });
    e.setCell({ line_id: LINES[0].id, period_id: PERIODS[1].id, formula: "=SUM(B2:C2)" });
    const findings = e.scanHardcoded();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      line_id: LINES[0].id,
      period_id: PERIODS[0].id,
      formula: "=base*1.04",
      literals: [{ literal: "1.04", start: 6, end: 10 }],
    });
  });

  it("returns no findings before loadGrid", () => {
    expect(new ModelEngine().scanHardcoded()).toEqual([]);
  });

  it("converts a hardcoded literal into a bare register reference and recomputes", () => {
    const e = engineWithLayout();
    const set = e.setCell({
      line_id: LINES[0].id,
      period_id: PERIODS[0].id,
      formula: "=base_salary*1.04",
    });
    const literal = set.cell.formula ? findHardcodedLiterals(set.cell.formula)[0] : null;
    expect(literal).toEqual({ literal: "1.04", start: 13, end: 17 });
    const result = e.convertHardcoded(
      LINES[0].id,
      PERIODS[0].id,
      literal as NonNullable<typeof literal>,
      "wage_inflation",
    );
    expect(result.cell.formula).toBe("=base_salary*wage_inflation");
  });

  it("rejects an invalid assumption name or a stale literal span", () => {
    expect(() =>
      convertHardcodedFormula("=base*1.04", { literal: "1.04", start: 6, end: 10 }, "Bad Name"),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      convertHardcodedFormula("=base*1.04", { literal: "9", start: 6, end: 10 }, "wage_inflation"),
    ).toThrow(/VALUE_INVALID/);
    expect(
      convertHardcodedFormula(
        "=base*1.04",
        { literal: "1.04", start: 6, end: 10 },
        "wage_inflation",
      ),
    ).toBe("=base*wage_inflation");
  });
});
