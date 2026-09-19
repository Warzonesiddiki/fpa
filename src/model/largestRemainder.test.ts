/**
 * largestRemainder — M6-1 statement tie-out oracle tests (MONEY-ROUNDING-SPEC §4, F-027).
 *
 * These pin the exact-decimal reference the native `statement.rs` engine must match, and assert
 * the mandated invariant: **sum(displayed children) === displayed parent** for every hierarchy,
 * with no rounding drift (Δ = 0, integer equality).
 *
 * Money discipline: every expectation is an exact decimal string; sums are compared with
 * `decimal.js` (no float) — consistent with B3/B18-2 and the `money:ast` gate.
 */
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { largestRemainderAllocate, roundToUnit } from "./largestRemainder";

/** Sum a list of exact decimal strings to a Decimal (exact — never float). */
function sumDec(values: readonly string[]): Decimal {
  return values.reduce((acc, v) => acc.plus(new Decimal(v)), new Decimal(0));
}

/** The mandated tie-out invariant: displayed children sum exactly to the displayed total. */
function expectTies(result: { displayed: string[]; displayedTotal: string }): void {
  expect(sumDec(result.displayed).toString()).toBe(result.displayedTotal);
}

describe("roundToUnit (MONEY-ROUNDING-SPEC §3 boundary rounding, HALF_UP)", () => {
  it("rounds to the nearest display unit, ties away from zero", () => {
    const u = new Decimal(1000);
    expect(roundToUnit(new Decimal(22400), u).toString()).toBe("22000");
    expect(roundToUnit(new Decimal(22500), u).toString()).toBe("23000"); // .5 → away from zero
    expect(roundToUnit(new Decimal(21999), u).toString()).toBe("22000");
    expect(roundToUnit(new Decimal(-22500), u).toString()).toBe("-23000"); // negative tie
  });
});

describe("largestRemainderAllocate — pinned oracle fixtures", () => {
  it("3-line 000s example: displayed children tie to the parent to the unit (SPEC §4/§7)", () => {
    // Exact P&L in dollars, displayed in 000s. Naive HALF_UP per line gives 11 + 3 + 7 = 21,
    // but the parent 22.2k rounds to 22 — the classic drift. Largest-remainder removes it.
    const r = largestRemainderAllocate(["11400", "3400", "7400"], "1000");
    expect(r.displayed).toEqual(["12000", "3000", "7000"]);
    expect(r.displayedTotal).toBe("22000");
    expectTies(r);
  });

  it("distributes to the LARGEST remainder, not the first line (determinism)", () => {
    // Remainders 300 / 700 / 200 → the middle line (largest) absorbs the unit.
    const r = largestRemainderAllocate(["11300", "3700", "7200"], "1000");
    expect(r.displayed).toEqual(["11000", "4000", "7000"]);
    expect(r.displayedTotal).toBe("22000");
    expectTies(r);
  });

  it("ties equal remainders to the earliest index (stable, deterministic)", () => {
    // All remainders 400 → the unit goes to index 0, never an arbitrary choice.
    const r = largestRemainderAllocate(["11400", "3400", "7400"], "1000");
    expect(r.displayed[0]).toBe("12000");
    expectTies(r);
  });

  it("rounds the total HALF_UP and absorbs the residual (whole units)", () => {
    // 1.5 + 2.5 + 3.5 = 7.5 → parent rounds to 8; two lines carry the residual.
    const r = largestRemainderAllocate(["1.5", "2.5", "3.5"], "1");
    expect(r.displayed).toEqual(["2", "3", "3"]);
    expect(r.displayedTotal).toBe("8");
    expectTies(r);
  });

  it("handles negative lines (cost sections) with floor toward −∞", () => {
    // Costs in 000s: floors go to the next-lower (more negative) multiple, remainders stay ≥ 0.
    const r = largestRemainderAllocate(["-11400", "-3400", "-7400"], "1000");
    expect(r.displayed).toEqual(["-11000", "-3000", "-8000"]);
    expect(r.displayedTotal).toBe("-22000");
    expectTies(r);
  });

  it("subtracts from the smallest-remainder lines when the residual is negative (SPEC §4 step 4d)", () => {
    // An independently computed parent below Σ floors → one unit is taken from a line.
    const r = largestRemainderAllocate(["1600", "1600", "1600"], "1000", "2000");
    expect(r.displayed).toEqual(["0", "1000", "1000"]);
    expect(r.displayedTotal).toBe("2000");
    expectTies(r);
  });

  it("ties displayed lines to an explicitly provided parent total", () => {
    // Lines sum to 4200, but the rolled-up parent is 4000 — the children are made to tie to 4000.
    const r = largestRemainderAllocate(["1400", "1400", "1400"], "1000", "4000");
    expect(r.displayed).toEqual(["2000", "1000", "1000"]);
    expect(r.displayedTotal).toBe("4000");
    expectTies(r);
  });

  it("keeps a single line and a zero block exact", () => {
    const single = largestRemainderAllocate(["22200"], "1000");
    expect(single).toEqual({ displayed: ["22000"], displayedTotal: "22000" });
    const zeros = largestRemainderAllocate(["0", "0", "0"], "1000");
    expect(zeros).toEqual({ displayed: ["0", "0", "0"], displayedTotal: "0" });
    expectTies(zeros);
  });

  it("uses no residual when every line is already a multiple of the unit", () => {
    const r = largestRemainderAllocate(["1000", "3000", "7000"], "1000");
    expect(r.displayed).toEqual(["1000", "3000", "7000"]);
    expect(r.displayedTotal).toBe("11000");
    expectTies(r);
  });

  it("supports sub-unit display (2 dp) with exact string results", () => {
    // 3-dp exact lines displayed at 2 dp: one unit (0.01) of residual goes to the line with
    // the largest fractional remainder (0.334 → 0.004), never a float artifact.
    const r = largestRemainderAllocate(["0.333", "0.333", "0.334"], "0.01");
    expect(r.displayed).toEqual(["0.33", "0.33", "0.34"]);
    // Value equality — the oracle returns exact values in minimal form; display-scale
    // trailing zeros ("1.00") are the formatting layer's job, not the oracle's.
    expect(new Decimal(r.displayedTotal).equals("1.00")).toBe(true);
    expectTies(r);
    // Each displayed value is a clean multiple of 0.01.
    for (const v of r.displayed) expect(new Decimal(v).dividedBy("0.01").isInteger()).toBe(true);
  });
});

describe("largestRemainderAllocate — tie-out invariant (property)", () => {
  // Deterministic pseudo-random exact line totals across a range of display units.
  function* cases(): Generator<{ lines: string[]; unit: string }> {
    const units = ["1000", "100", "10", "1", "0.1", "0.01"];
    // A spread of magnitudes + a seeded generator for breadth (deterministic, reproducible).
    const magnitudes = [0, 1, 5, 17, 99, 1234, 100000, 999999];
    let seed = 20260920;
    const rand = () => {
      // LCG — deterministic, reproducible across runs/OS.
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (const unit of units) {
      for (const mag of magnitudes) {
        yield { lines: [String(mag), String(mag + 1), String(mag * 3 + 2)], unit };
      }
      for (let i = 0; i < 40; i += 1) {
        const count = 1 + Math.floor(rand() * 8);
        const lines: string[] = [];
        for (let j = 0; j < count; j += 1) {
          const sign = rand() < 0.5 ? -1 : 1;
          const major = Math.floor(rand() * 1_000_000);
          // Two-decimal exact value (no float): built from integer parts.
          const frac = Math.floor(rand() * 100);
          const value = `${sign * major}.${String(frac).padStart(2, "0")}`;
          lines.push(value);
        }
        yield { lines, unit };
      }
    }
  }

  it("sum(displayed children) === displayed total, and every line stays within one unit (240 cases)", () => {
    let checked = 0;
    for (const { lines, unit } of cases()) {
      const r = largestRemainderAllocate(lines, unit);
      // THE invariant (SPEC §4 step 5 / F-027): children tie exactly to the parent.
      expectTies(r);
      // Each displayed value is a multiple of the unit.
      const u = new Decimal(unit);
      for (const v of r.displayed) {
        expect(new Decimal(v).dividedBy(u).isInteger()).toBe(true);
      }
      // Each displayed line is within one display unit of its exact source.
      for (let i = 0; i < lines.length; i += 1) {
        const delta = new Decimal(r.displayed[i]).minus(new Decimal(lines[i])).abs();
        expect(delta.lessThanOrEqualTo(u)).toBe(true);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(200);
  });
});

describe("largestRemainderAllocate — input validation (locked-code class)", () => {
  it("rejects a non-decimal line with VALUE_INVALID", () => {
    expect(() => largestRemainderAllocate(["1000", "1e3", "1000"], "1000")).toThrow(
      /VALUE_INVALID/,
    );
    expect(() => largestRemainderAllocate(["1000", "USD 5", "1000"], "1000")).toThrow(
      /VALUE_INVALID/,
    );
  });

  it("rejects a non-positive display unit with VALUE_INVALID", () => {
    expect(() => largestRemainderAllocate(["1000"], "0")).toThrow(/VALUE_INVALID/);
    expect(() => largestRemainderAllocate(["1000"], "-1000")).toThrow(/VALUE_INVALID/);
  });

  it("rejects a non-decimal explicit total with VALUE_INVALID", () => {
    expect(() => largestRemainderAllocate(["1000", "1000"], "1000", "1,000")).toThrow(
      /VALUE_INVALID/,
    );
  });
});
