/**
 * AUDIT-04 — Iterative Calculation Mode in the model engine (FORMULA-ENGINE-SPEC §5).
 *
 * Covers the engine wiring around `src/model/cycleSolver.ts`: the additive opt-in load option
 * (default OFF — `#CYCLE!` exactly as before), dual-probe-validated fixed points surfaced
 * through the grid, dependents resolving via HyperFormula propagation, pointer rewiring /
 * restoration, driver & named-range inputs to SCCs, and the honest-refusal cases that must
 * keep `FORMULA_CYCLE`. Every expected value is hand-computed first (exact rational fixed
 * points, commit-rounded to the scale-2 display).
 */
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { ModelEngine } from "./modelEngine";
import type { DriverDef, ModelGridLine, ModelGridPeriod } from "./modelEngine";

const LINES: ModelGridLine[] = [
  { id: "line-a", label: "4000 · Revenue", method: "manual" },
  { id: "line-b", label: "4100 · Interest", method: "manual" },
  { id: "line-c", label: "4200 · Average Debt", method: "manual" },
  { id: "line-d", label: "4300 · Dependent", method: "manual" },
];

const PERIODS: ModelGridPeriod[] = [
  { id: "fp-01", code: "P01" },
  { id: "fp-02", code: "P02" },
  { id: "fp-03", code: "P03" },
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

/** Grid cells (1-based A1): L1/P01 = B2, L2/P01 = B3, L3/P01 = B4, L4/P01 = B5. */
function setFormula(e: ModelEngine, line: number, period: number, formula: string): void {
  e.setCell({ line_id: LINES[line].id, period_id: PERIODS[period].id, formula });
}
function setValue(e: ModelEngine, line: number, period: number, value: string): void {
  e.setCell({ line_id: LINES[line].id, period_id: PERIODS[period].id, value });
}
function text(e: ModelEngine, line: number, period: number): string | null {
  return e.getCell(LINES[line].id, PERIODS[period].id).computed_text;
}
function error(e: ModelEngine, line: number, period: number): string | null {
  return e.getCell(LINES[line].id, PERIODS[period].id).error_code;
}

function cycleEngine(): ModelEngine {
  const e = new ModelEngine();
  e.loadGrid({ lines: LINES, periods: PERIODS }, { iterativeCalculation: true });
  return e;
}
function plainEngine(): ModelEngine {
  const e = new ModelEngine();
  e.loadGrid({ lines: LINES, periods: PERIODS });
  return e;
}

describe("Iterative Calculation Mode — default OFF (unchanged #CYCLE! behavior)", () => {
  it("a divergent self-loop `=B2*2` stays FORMULA_CYCLE with no opt-in", () => {
    const e = plainEngine();
    const res = e.setCell({ line_id: LINES[0].id, period_id: PERIODS[0].id, formula: "=B2*2" });
    expect(res.cell.error_code).toBe("FORMULA_CYCLE");
    expect(res.cell.computed_text).toBe("#CYCLE!");
    const report = e.recalc();
    expect(report.issues.some((i) => i.code === "FORMULA_CYCLE")).toBe(true);
    // OFF mode never populates the cycle paths — historical shape.
    expect(report.cycles).toEqual([]);
  });

  it("a resolvable loop also stays #CYCLE! without the opt-in (the spec's default)", () => {
    const e = plainEngine();
    setFormula(e, 0, 0, "=B2*0.5+10");
    expect(error(e, 0, 0)).toBe("FORMULA_CYCLE");
    expect(text(e, 0, 0)).toBe("#CYCLE!");
  });
});

describe("Iterative Calculation Mode — solved cycles (opt-in load option)", () => {
  it("resolves the trivial loop x = 0.5x + 10 to 20 (and re-solves on the next edit)", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B2*0.5+10");
    expect(error(e, 0, 0)).toBeNull();
    expect(text(e, 0, 0)).toBe("20");
    const report = e.recalc();
    expect(report.issues).toEqual([]);
    expect(report.cycles).toEqual([]);
    // Re-solving on the next mutation is idempotent.
    setFormula(e, 0, 0, "=B2*0.5+20");
    expect(text(e, 0, 0)).toBe("40");
    expect(error(e, 0, 0)).toBeNull();
  });

  it("resolves a 3-node debt loop to the hand-computed fixed point", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B3*0.2+100"); // a = 0.2b + 100
    setFormula(e, 1, 0, "=B4*0.2+50"); // b = 0.2c + 50
    setFormula(e, 2, 0, "=B2*0.2"); // c = 0.2a
    // 0.992a = 110 → a = 110.88709677419354, b = 54.43548387096774, c = 22.17741935483871
    expect(text(e, 0, 0)).toBe("110.89");
    expect(text(e, 1, 0)).toBe("54.44");
    expect(text(e, 2, 0)).toBe("22.18");
    expect(error(e, 0, 0)).toBeNull();
    const report = e.recalc();
    expect(report.issues).toEqual([]);
    expect(report.cycles).toEqual([]);
  });

  it("lets dependents of a solved member resolve through HyperFormula propagation", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B3*0.2+100");
    setFormula(e, 1, 0, "=B4*0.2+50");
    setFormula(e, 2, 0, "=B2*0.2");
    setFormula(e, 3, 0, "=B2*2"); // L4/P01 = 2a = 221.7741935483871
    expect(text(e, 3, 0)).toBe("221.77");
    expect(error(e, 3, 0)).toBeNull();
    // The YTD/FY derived columns sum the solved value (they reference the pointer cell).
    const d = e.getDerived(LINES[0].id);
    expect(d.ytd).toBe("110.89");
    expect(d.fy).toBe("110.89");
  });

  it("keeps `=B2*2` divergent: FORMULA_CYCLE, an issue, and a cycle path in the report", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B2*2");
    expect(error(e, 0, 0)).toBe("FORMULA_CYCLE");
    expect(text(e, 0, 0)).toBe("#CYCLE!");
    const report = e.recalc();
    expect(report.issues.some((i) => i.code === "FORMULA_CYCLE")).toBe(true);
    expect(report.cycles).toHaveLength(1);
    expect(report.cycles[0].path).toContain("B2");
  });

  it("surfaces the user's formula (not the pointer) with is_cycle true and no error", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B2*0.5+10");
    const cell = e.getCell(LINES[0].id, PERIODS[0].id);
    expect(cell.formula).toBe("=B2*0.5+10");
    const inspect = e.inspectCell(LINES[0].id, PERIODS[0].id);
    expect(inspect.formula).toBe("=B2*0.5+10");
    expect(inspect.computed_text).toBe("20");
    expect(inspect.error_code).toBeNull();
    expect(inspect.is_cycle).toBe(true);
    expect(inspect.cycle).not.toBeNull();
    // The self-reference is visible as a precedent from the original formula's text.
    expect(inspect.precedents.some((p) => p.row === 1 && p.col === 1)).toBe(true);
  });

  it("restores original formulas when an edit breaks the cycle", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B3*0.2+100");
    setFormula(e, 1, 0, "=B4*0.2+50");
    setFormula(e, 2, 0, "=B2*0.2");
    expect(text(e, 0, 0)).toBe("110.89");
    // Overwrite the middle member with a constant — the SCC dissolves.
    setValue(e, 1, 0, "1000");
    expect(text(e, 0, 0)).toBe("300"); // 0.2·1000 + 100, computed from the restored formula
    expect(e.getCell(LINES[0].id, PERIODS[0].id).formula).toBe("=B3*0.2+100");
    expect(text(e, 1, 0)).toBe("1000");
    expect(e.getCell(LINES[1].id, PERIODS[0].id).formula).toBeNull();
    expect(text(e, 2, 0)).toBe("60"); // 0.2·300
    expect(e.getCell(LINES[2].id, PERIODS[0].id).formula).toBe("=B2*0.2");
    const report = e.recalc();
    expect(report.issues).toEqual([]);
    expect(report.cycles).toEqual([]);
  });

  it("tracks a driver value as a constant input: the fixed point moves with it", () => {
    const e = cycleEngine();
    e.loadDrivers(DRIVERS, PERIODS);
    setFormula(e, 0, 0, "=B3*0.5+10"); // a = 0.5b + 10
    setFormula(e, 1, 0, "=B2*0.2+Drivers!B2"); // b = 0.2a + d
    // d = 100 → 0.9a = 60 → a = 66.66…, b = 113.33…
    e.setDriverValue("dr-units", "fp-01", "100");
    expect(text(e, 0, 0)).toBe("66.67");
    expect(text(e, 1, 0)).toBe("113.33");
    expect(error(e, 0, 0)).toBeNull();
    // d = 200 → 0.9a = 110 → a = 122.22…, b = 224.44…
    e.setDriverValue("dr-units", "fp-01", "200");
    expect(text(e, 0, 0)).toBe("122.22");
    expect(text(e, 1, 0)).toBe("224.44");
    // The driver-impact table still sees the cyclic cell's original Drivers reference.
    const impact = e.getDriverImpact("dr-units");
    expect(impact.some((r) => r.line_id === "line-b")).toBe(true);
    // Inspection of the rewired cell surfaces the original formula's precedents — including
    // the qualified Drivers reference (the live formula's pointer would hide it). The driver
    // ref sits at the same row/col as Model B2; the sheet field is what distinguishes them.
    const modelSheet = e.inspectCell(LINES[0].id, PERIODS[0].id).precedents[0].sheet;
    const inspectB3 = e.inspectCell(LINES[1].id, PERIODS[0].id);
    expect(
      inspectB3.precedents.some((p) => p.row === 1 && p.col === 1 && p.sheet !== modelSheet),
    ).toBe(true);
  });

  it("resolves two coupled SCCs in dependency order (cross-SCC reference)", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B3*0.5+10"); // SCC1: a = 0.5b + 10
    setFormula(e, 1, 0, "=B2*0.2+C2"); // b = 0.2a + C2 (cross-SCC edge to SCC2)
    setFormula(e, 0, 1, "=D2*0.5"); // SCC2: c = 0.5d (D2 = L1/P03)
    setFormula(e, 0, 2, "=C2*0.5+1"); // d = 0.5c + 1 → c = 2/3
    // SCC2: c = 0.6666666666666666, d = 1.3333333333333333
    expect(text(e, 0, 1)).toBe("0.67");
    expect(text(e, 0, 2)).toBe("1.33");
    // SCC1: 0.9a = 0.5·(2/3) + 10 → a = 31/2.7 = 11.481481481481481, b = 2.962962962962963
    expect(text(e, 0, 0)).toBe("11.48");
    expect(text(e, 1, 0)).toBe("2.96");
    const report = e.recalc();
    expect(report.issues).toEqual([]);
    expect(report.cycles).toEqual([]);
  });

  it("rewrites a same-column range of contiguous members into the scratch sheet", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=SUM(B3:B4)*0.1+1"); // a = 0.1(b+c) + 1
    setFormula(e, 1, 0, "=B4*0.5+10"); // b = 0.5c + 10
    setFormula(e, 2, 0, "=B2*0.2"); // c = 0.2a
    // a = 0.1(0.5c+10)+0.1c+1, c = 0.2a → 0.97a = 2
    // a = 2.0618556701030927, b = 0.1a+10 = 10.206185567010309, c = 0.41237113402061853
    expect(text(e, 0, 0)).toBe("2.06");
    expect(text(e, 1, 0)).toBe("10.21");
    expect(text(e, 2, 0)).toBe("0.41");
    expect(e.recalc().issues).toEqual([]);
  });

  it("refuses a dependent SCC whose single reference targets a refused SCC", () => {
    const e = cycleEngine();
    // SCC2 {C2,D2} is refused (multi-column member range) — SCC1 {B2,B3} references C2
    // directly and must be refused too (never read a value from an unsettled SCC).
    setFormula(e, 0, 0, "=B3*0.5+10");
    setFormula(e, 1, 0, "=B2*0.2+C2");
    setFormula(e, 0, 1, "=D2*0.5");
    setFormula(e, 0, 2, "=SUM(C2:D2)*0.5+1"); // multi-column member range — SCC2 refuses
    expect(error(e, 0, 0)).toBe("FORMULA_CYCLE");
    expect(error(e, 1, 0)).toBe("FORMULA_CYCLE");
    expect(error(e, 0, 1)).toBe("FORMULA_CYCLE");
    expect(error(e, 0, 2)).toBe("FORMULA_CYCLE");
    expect(e.recalc().cycles).toHaveLength(2);
  });

  it("re-solves after clearCell breaks a cycle (restoring the cleared member to empty)", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B3*0.2+100");
    setFormula(e, 1, 0, "=B4*0.2+50");
    setFormula(e, 2, 0, "=B2*0.2");
    expect(text(e, 0, 0)).toBe("110.89");
    e.clearCell(LINES[1].id, PERIODS[0].id); // B3 → empty (0)
    expect(text(e, 0, 0)).toBe("100"); // 0.2·0 + 100 from the restored formula
    expect(text(e, 1, 0)).toBeNull(); // cleared — no amount, no formula
    expect(text(e, 2, 0)).toBe("20"); // 0.2·100
    const report = e.recalc();
    expect(report.issues).toEqual([]);
    expect(report.cycles).toEqual([]);
  });

  it("refuses a mixed range (member + constant) and keeps FORMULA_CYCLE", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=SUM(B2:B4)*0.1+1"); // range spans members B2,B3 + constant B4
    setFormula(e, 1, 0, "=B2*0.2+5");
    setValue(e, 2, 0, "100");
    expect(error(e, 0, 0)).toBe("FORMULA_CYCLE");
    expect(error(e, 1, 0)).toBe("FORMULA_CYCLE");
    const report = e.recalc();
    expect(report.cycles).toHaveLength(1);
  });

  it("refuses a multi-column range of members and keeps FORMULA_CYCLE", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=SUM(B2:C2)*0.5+1"); // multi-column member range — not rewritable
    setFormula(e, 0, 1, "=B2*0.3");
    expect(error(e, 0, 0)).toBe("FORMULA_CYCLE");
    expect(error(e, 0, 1)).toBe("FORMULA_CYCLE");
    expect(e.recalc().cycles).toHaveLength(1);
  });

  it("refuses an interleaved range (non-contiguous scratch rows) and keeps FORMULA_CYCLE", () => {
    const e = cycleEngine();
    // One 5-node SCC: B2 → B3,B4,B5; B3 → B2; B4 → C3,B2; C3 → B4; B5 → B2.
    // Sorted members put C3 (row 3, col 2) between B3 and B4 in scratch-row order, so the
    // B3:B5 range maps to non-contiguous scratch rows — an honest refusal.
    setFormula(e, 0, 0, "=SUM(B3:B5)*0.1+1");
    setFormula(e, 1, 0, "=B2*0.2+1");
    setFormula(e, 1, 1, "=B4*0.5");
    setFormula(e, 2, 0, "=C3*0.5+B2*0.1");
    setFormula(e, 3, 0, "=B2*0.2+2");
    expect(error(e, 0, 0)).toBe("FORMULA_CYCLE");
    expect(error(e, 2, 0)).toBe("FORMULA_CYCLE");
    expect(e.recalc().cycles).toHaveLength(1);
  });

  it("keeps FORMULA_CYCLE when a formula error sits inside the SCC", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B3*0.5+10");
    setFormula(e, 1, 0, "=B2*0.2+1/0"); // #DIV/0! — no numeric solution
    expect(error(e, 0, 0)).toBe("FORMULA_CYCLE");
    expect(error(e, 1, 0)).toBe("FORMULA_CYCLE");
    expect(e.recalc().cycles).toHaveLength(1);
  });

  it("re-solves when a named range feeding the cycle changes", () => {
    const e = cycleEngine();
    e.addNamedRange("wage_inflation", "100");
    setFormula(e, 0, 0, "=B3*0.5+10"); // a = 0.5b + 10
    setFormula(e, 1, 0, "=B2*0.2+wage_inflation"); // b = 0.2a + name
    // name = 100 → 0.9a = 60 → a = 66.66…, b = 113.33…
    expect(text(e, 0, 0)).toBe("66.67");
    expect(text(e, 1, 0)).toBe("113.33");
    // name = 50 → 0.9a = 35 → a = 38.88…, b = 57.77…
    e.addNamedRange("wage_inflation", "50");
    expect(text(e, 0, 0)).toBe("38.89");
    expect(text(e, 1, 0)).toBe("57.78");
    // Removing the name leaves the formulas unsolvable — back to FORMULA_CYCLE + a path.
    e.removeNamedRange("wage_inflation");
    expect(error(e, 0, 0)).toBe("FORMULA_CYCLE");
    expect(e.recalc().cycles).toHaveLength(1);
  });

  it("commits solved values at the currency scale (scale-0 engine → whole units)", () => {
    const e = new ModelEngine(0);
    e.loadGrid({ lines: LINES, periods: PERIODS }, { iterativeCalculation: true });
    setFormula(e, 0, 0, "=B2*0.5+10");
    // x = 20 exactly — at scale 0 the display is the committed integer.
    expect(text(e, 0, 0)).toBe("20");
    expect(error(e, 0, 0)).toBeNull();
  });

  it("never shows a raw float: solved values render through the commit-rounding path", () => {
    const e = cycleEngine();
    setFormula(e, 0, 0, "=B2*0.5+10");
    const raw = new Decimal(text(e, 0, 0) as string);
    expect(raw.decimalPlaces()).toBeLessThanOrEqual(2);
  });
});
