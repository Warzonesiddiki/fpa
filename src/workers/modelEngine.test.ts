import { describe, expect, it } from "vitest";
import { ModelEngine, MAX_FORMULA_LEN } from "./modelEngine";
import type { ModelGridLine, ModelGridPeriod } from "./modelEngine";

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
});
