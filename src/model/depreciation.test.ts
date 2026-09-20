/**
 * Exhaustive AUDIT-12 tests for the exact-decimal depreciation engine + FCCR.
 *
 * **Hand-verified references** (computed by hand / from IRS Pub 946 Table A-1 — the independent
 * oracle, mirroring the AUDIT's "compare to hand-built" mandate):
 *
 * 1. SL 1200 / 4-yr, no salvage: 300 each year, total 1200.
 * 2. SL 100 / 3-yr: 33, 33, 34 (final-year residual plug absorbs the 1/3 rounding), total 100.
 * 3. SL 1000 / 5-yr, salvage 100: depreciable 900 → 180 each year, total 900, ending 100.
 * 4. DDB 10000 / 5-yr, no salvage (rate 40%):
 *      Y1: DB 4000 vs SL 2000 → DDB 4000 (book 6000)
 *      Y2: DB 2400 vs SL 1500 → DDB 2400 (book 3600)
 *      Y3: DB 1440 vs SL 1200 → DDB 1440 (book 2160)
 *      Y4: DB  864 vs SL 1080 → SL 1080  (book 1080)   ← optimal switch at year 4
 *      Y5: DB  432 vs SL 1080 → SL 1080  (book 0)
 *      total 10000, switchYear 4, front-loaded (4000 > 2400 > 1440).
 * 5. DDB 10000 / 4-yr, salvage 2000 (rate 50%): 5000, 2500, then the salvage floor caps Y3 at 500,
 *      Y4 residual 0 → total 8000, ending 2000.
 * 6. MACRS 5-yr, cost 100000 (rates 20/32/19.2/11.52/11.52/5.76): 20000, 32000, 19200, 11520,
 *      11520, 5760, total 100000.
 * 7. FCCR (display is normalized 2dp, house style): EBITDA 10000 / interest 2000 = "5" (no breach at
 *      target 1.0); EBITDA 5000 / (2000+1000) = "1.67"; EBITDA 1000 / 2000 = "0.5" (breach); no fixed
 *      charges + EBITDA > 0 = comfortably covered.
 *
 * **Invariants** (property checks across many inputs): every schedule ties out exactly to its
 * depreciable base; book value is non-increasing and never below salvage; DDB is front-loaded and
 * the DDB→SL transition is one-way; each MACRS rate column sums to exactly 1.0000.
 */
import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";
import {
  straightLineSchedule,
  doubleDecliningSchedule,
  macrsSchedule,
  computeFCCR,
  MACRS_HALF_YEAR_RATES,
  type MacrsClass,
} from "./depreciation";

describe("MACRS rate tables (IRS Pub 946 Table A-1)", () => {
  const expectedLength: Record<MacrsClass, number> = { 3: 4, 5: 6, 7: 8, 10: 11, 15: 16, 20: 21 };
  it.each([3, 5, 7, 10, 15, 20] as MacrsClass[])(
    "class %i: rates sum to exactly 1.0000 and have the right length",
    (c) => {
      const rates = MACRS_HALF_YEAR_RATES[c];
      expect(rates.length).toBe(expectedLength[c]);
      const sum = rates.reduce((acc, r) => acc.plus(new Decimal(r)), new Decimal(0));
      expect(sum.equals(1)).toBe(true);
    },
  );
  it("is front-loaded under the half-year convention (peak in year 1 or 2; smallest charge in the final year)", () => {
    for (const c of [3, 5, 7, 10, 15, 20] as MacrsClass[]) {
      const rates = MACRS_HALF_YEAR_RATES[c].map((r) => new Decimal(r));
      const max = rates.reduce((m, r) => (r.greaterThan(m) ? r : m));
      const maxIdx = rates.findIndex((r) => r.equals(max));
      expect(maxIdx <= 1).toBe(true); // the half-year convention peaks in year 2 (year 1 is a half year)
      const min = rates.reduce((m, r) => (r.lessThan(m) ? r : m));
      const minIdx = rates.findIndex((r) => r.equals(min));
      expect(minIdx).toBe(rates.length - 1); // the final (tail) year is the smallest
    }
  });
});

describe("straightLineSchedule", () => {
  it("splits an even cost evenly", () => {
    const s = straightLineSchedule(1200, 4);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([300, 300, 300, 300]);
    expect(s.total_depreciated_minor).toBe(1200);
    expect(s.ending_book_minor).toBe(0);
  });
  it("uses the final-year residual plug to absorb non-even division (100/3 → 33,33,34)", () => {
    const s = straightLineSchedule(100, 3);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([33, 33, 34]);
    expect(s.total_depreciated_minor).toBe(100);
    expect(s.ending_book_minor).toBe(0);
  });
  it("depreciates only the depreciable base when salvage is set", () => {
    const s = straightLineSchedule(1000, 5, 100);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([180, 180, 180, 180, 180]);
    expect(s.total_depreciated_minor).toBe(900);
    expect(s.ending_book_minor).toBe(100);
  });
  it("single-year life depreciates the full cost", () => {
    const s = straightLineSchedule(500, 1);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([500]);
    expect(s.ending_book_minor).toBe(0);
  });
  it("tracks beginning/ending book and accumulated correctly", () => {
    const s = straightLineSchedule(1200, 4);
    const y1 = s.years[0];
    expect(y1.beginning_book_minor).toBe(1200);
    expect(y1.ending_book_minor).toBe(900);
    expect(s.years[3].accumulated_minor).toBe(1200);
  });
});

describe("doubleDecliningSchedule (DDB with optimal SL switch — the AUDIT-12 gap)", () => {
  it("front-loads DDB, switches to SL at year 4, and ties out (10000/5-yr)", () => {
    const s = doubleDecliningSchedule(10000, 5);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([4000, 2400, 1440, 1080, 1080]);
    expect(s.years.map((y) => y.method)).toEqual(["DDB", "DDB", "DDB", "SL", "SL"]);
    expect(s.switch_year).toBe(4);
    expect(s.total_depreciated_minor).toBe(10000);
    expect(s.ending_book_minor).toBe(0);
  });
  it("front-loads: year 1 ≥ year 2 ≥ year 3", () => {
    const s = doubleDecliningSchedule(10000, 5);
    expect(s.years[0].depreciation_minor).toBeGreaterThan(s.years[1].depreciation_minor);
    expect(s.years[1].depreciation_minor).toBeGreaterThan(s.years[2].depreciation_minor);
  });
  it("never drops below the salvage line (floor caps the DB charge; 10000/4-yr, salvage 2000)", () => {
    const s = doubleDecliningSchedule(10000, 4, 2000);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([5000, 2500, 500, 0]);
    expect(s.total_depreciated_minor).toBe(8000);
    expect(s.ending_book_minor).toBe(2000);
    // No year's ending book is below salvage.
    for (const y of s.years) expect(y.ending_book_minor).toBeGreaterThanOrEqual(2000);
  });
  it("single-year life fully depreciates (DB would overshoot; floor + plug keep it exact)", () => {
    const s = doubleDecliningSchedule(100, 1);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([100]);
    expect(s.ending_book_minor).toBe(0);
  });
  it("ties out to cost − salvage across a grid of inputs", () => {
    const costs = [1, 100, 1001, 99999, 1_000_000];
    const lives = [1, 2, 3, 4, 5, 7, 10];
    const salvages = [0, 100, 1500];
    for (const cost of costs) {
      for (const life of lives) {
        for (const salvage of salvages.filter((sv) => sv <= cost)) {
          const s = doubleDecliningSchedule(cost, life, salvage);
          expect(s.total_depreciated_minor).toBe(cost - salvage);
          expect(s.ending_book_minor).toBe(salvage);
          // Book value is non-increasing and never below salvage.
          for (const y of s.years) {
            expect(y.ending_book_minor).toBeLessThanOrEqual(y.beginning_book_minor);
            expect(y.ending_book_minor).toBeGreaterThanOrEqual(salvage);
            expect(y.accumulated_minor).toBeGreaterThanOrEqual(0);
          }
          // The DDB→SL transition is one-way: once SL governs, it keeps governing.
          const methods = s.years.map((y) => y.method);
          const firstSl = methods.indexOf("SL");
          if (firstSl !== -1) {
            for (let i = firstSl; i < methods.length; i += 1) expect(methods[i]).toBe("SL");
          }
        }
      }
    }
  });
});

describe("macrsSchedule (half-year GDS, IRS Pub 946 Table A-1)", () => {
  it("5-year, cost 100000: 20000, 32000, 19200, 11520, 11520, 5760 (total 100000)", () => {
    const s = macrsSchedule(100000, 5);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([
      20000, 32000, 19200, 11520, 11520, 5760,
    ]);
    expect(s.total_depreciated_minor).toBe(100000);
    expect(s.ending_book_minor).toBe(0);
    expect(s.life_years).toBe(5);
    expect(s.years.every((y) => y.method === "MACRS")).toBe(true);
  });
  it("3-year, cost 12000: 4000, 5334, 1777, residual 889 (total 12000)", () => {
    const s = macrsSchedule(12000, 3);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([4000, 5334, 1777, 889]);
    expect(s.total_depreciated_minor).toBe(12000);
  });
  it("absorbs rounding via the final-year residual plug (99999 / 5-yr)", () => {
    const s = macrsSchedule(99999, 5);
    expect(s.years.map((y) => y.depreciation_minor)).toEqual([
      20000, 32000, 19200, 11520, 11520, 5759,
    ]);
    expect(s.total_depreciated_minor).toBe(99999);
    expect(s.ending_book_minor).toBe(0);
  });
  it("depreciates the full cost to zero for every class (tie-out, no salvage)", () => {
    for (const c of [3, 5, 7, 10, 15, 20] as MacrsClass[]) {
      const s = macrsSchedule(1_234_567, c);
      expect(s.years.length).toBe(MACRS_HALF_YEAR_RATES[c].length);
      expect(s.total_depreciated_minor).toBe(1_234_567);
      expect(s.ending_book_minor).toBe(0);
      for (const y of s.years) expect(y.ending_book_minor).toBeGreaterThanOrEqual(0);
    }
  });
  it("20-year has 21 rows (half-year convention extends the schedule by one year)", () => {
    expect(macrsSchedule(1000, 20).years.length).toBe(21);
  });
});

describe("computeFCCR (Fixed Charge Coverage Ratio — the AUDIT-12 gap)", () => {
  it("computes EBITDA / fixed charges (10000 / 2000 = 5.00, no breach at target 1.0)", () => {
    const r = computeFCCR({ ebitda_minor: 10000, interest_expense_minor: 2000 });
    expect(r.fixed_charges_minor).toBe(2000);
    expect(r.fccr_exact).toBe("5");
    // House ratio style (capital.ts): toDecimalPlaces(2, HALF_UP).toString() — normalized, no trailing zeros.
    expect(r.fccr_display).toBe("5");
    expect(r.breached).toBe(false);
    expect(r.comfortably_covered).toBe(false);
  });
  it("includes mandatory debt service and lease in fixed charges (5000 / (2000+1000) = 1.67)", () => {
    const r = computeFCCR({
      ebitda_minor: 5000,
      interest_expense_minor: 2000,
      mandatory_debt_service_minor: 1000,
    });
    expect(r.fixed_charges_minor).toBe(3000);
    expect(r.fccr_display).toBe("1.67");
    expect(r.breached).toBe(false);
  });
  it("breaches when FCCR < target (1000 / 2000 = 0.50)", () => {
    const r = computeFCCR({ ebitda_minor: 1000, interest_expense_minor: 2000 });
    expect(r.fccr_display).toBe("0.5");
    expect(r.breached).toBe(true);
  });
  it("honours a custom target (EBITDA 1100 / 1000 = 1.1 breaches target 1.25)", () => {
    const r = computeFCCR({ ebitda_minor: 1100, interest_expense_minor: 1000 }, 1.25);
    expect(r.fccr_display).toBe("1.1");
    expect(r.target).toBe(1.25);
    expect(r.breached).toBe(true);
  });
  it("treats EBITDA with no fixed charges as comfortably covered", () => {
    const r = computeFCCR({ ebitda_minor: 10000, interest_expense_minor: 0 });
    expect(r.comfortably_covered).toBe(true);
    expect(r.breached).toBe(false);
    expect(r.fccr_exact).toBeNull();
    expect(r.fccr_display).toBe("Infinity");
  });
  it("treats zero EBITDA with no fixed charges as a breach (cannot demonstrate coverage)", () => {
    const r = computeFCCR({ ebitda_minor: 0, interest_expense_minor: 0 });
    expect(r.comfortably_covered).toBe(false);
    expect(r.breached).toBe(true);
    expect(r.fccr_display).toBe("0.00");
  });
  it("negative EBITDA breaches", () => {
    const r = computeFCCR({ ebitda_minor: -1000, interest_expense_minor: 2000 });
    expect(r.fccr_display).toBe("-0.5");
    expect(r.breached).toBe(true);
  });
  it("includes mandatory lease payments in fixed charges", () => {
    const r = computeFCCR({
      ebitda_minor: 8000,
      interest_expense_minor: 1000,
      mandatory_lease_payment_minor: 1000,
    });
    expect(r.fixed_charges_minor).toBe(2000);
    expect(r.fccr_display).toBe("4");
  });
});

describe("input validation (locked error codes)", () => {
  it("rejects negative or non-integer cost (SL)", () => {
    expect(() => straightLineSchedule(-1, 4)).toThrow(/VALUE_INVALID/);
    expect(() => straightLineSchedule(100.5, 4)).toThrow(/VALUE_INVALID/);
  });
  it("rejects life < 1 (SL and DDB)", () => {
    expect(() => straightLineSchedule(100, 0)).toThrow(/VALUE_INVALID/);
    expect(() => doubleDecliningSchedule(100, 0)).toThrow(/VALUE_INVALID/);
  });
  it("rejects salvage exceeding cost", () => {
    expect(() => straightLineSchedule(100, 4, 200)).toThrow(/VALUE_INVALID/);
    expect(() => doubleDecliningSchedule(100, 4, 200)).toThrow(/VALUE_INVALID/);
  });
  it("rejects negative cost (MACRS)", () => {
    expect(() => macrsSchedule(-1, 5)).toThrow(/VALUE_INVALID/);
  });
  it("rejects an unsupported MACRS class at runtime", () => {
    expect(() => macrsSchedule(100, 6 as unknown as MacrsClass)).toThrow(/VALUE_INVALID/);
  });
  it("rejects a non-positive or non-numeric FCCR target", () => {
    expect(() => computeFCCR({ ebitda_minor: 1, interest_expense_minor: 1 }, 0)).toThrow(
      /VALUE_INVALID/,
    );
    expect(() => computeFCCR({ ebitda_minor: 1, interest_expense_minor: 1 }, -1)).toThrow(
      /VALUE_INVALID/,
    );
  });
});
