/**
 * Exhaustive AUDIT-20 tests for the dual-cadence calendar engine (weekly ↔ monthly fractional-day
 * mapping) — the "Calendar test: weekly + monthly synchronized" acceptance criterion.
 *
 * **Hand-verified reference** (year 2023, common year, fiscalYearStart 2023-01-01):
 * - 12 months with the exact 2023 day spans (Jan 31 … Dec 31); 53 seven-day weeks.
 * - W1 = [2023-01-01, 2023-01-08) → 7 days, all in January (overlap[0][0] = 7).
 * - W5 = [2023-01-29, 2023-02-05) → spans two months: January 3 days + February 4 days.
 * - W53 = [2023-12-31, 2024-01-07) → spillover: only Dec 31 in 2023 (row sum 1).
 * - Invariants: every month's column sum === its day count; the whole matrix sums to 365; weeks
 *   1..52 row-sum to 7, week 53 to 1.
 * - Allocation: 1000 on W5 (3/7 Jan, 4/7 Feb) → Jan 429 / Feb 571 (largest-remainder tie-out).
 */
import { describe, expect, it } from "vitest";
import {
  buildDualCadenceCalendar,
  spanOverlapDays,
  allocateWeekAcrossMonths,
} from "./calendarEngine";

const CAL = buildDualCadenceCalendar(2023, "2023-01-01");
const rowSum = (row: number[]): number => row.reduce((a, b) => a + b, 0);
const colSum = (cal: typeof CAL, m: number): number =>
  cal.weeks.reduce((a, _, w) => a + cal.overlapDays[w][m], 0);

describe("buildDualCadenceCalendar — structure (year 2023)", () => {
  it("builds the 12 calendar months with the exact 2023 day spans", () => {
    const days = CAL.months.map((m) => m.days);
    expect(days).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(CAL.months[0].startDate).toBe("2023-01-01");
    expect(CAL.months[0].endDate).toBe("2023-02-01");
    expect(CAL.months[11].endDate).toBe("2024-01-01");
  });
  it("builds 53 seven-day weeks covering the year (last spills into January)", () => {
    expect(CAL.weeks.length).toBe(53);
    for (const w of CAL.weeks) expect(w.days).toBe(7);
    expect(CAL.weeks[0].startDate).toBe("2023-01-01");
    expect(CAL.weeks[0].endDate).toBe("2023-01-08");
    expect(CAL.weeks[52].startDate).toBe("2023-12-31");
    expect(CAL.weeks[52].endDate).toBe("2024-01-07"); // spills into 2024
  });
  it("the overlap matrix is 53 weeks × 12 months", () => {
    expect(CAL.overlapDays.length).toBe(53);
    for (const row of CAL.overlapDays) expect(row.length).toBe(12);
  });
});

describe("overlap matrix — pinned hand-verified values", () => {
  it("W1 is fully inside January (overlap 7)", () => {
    expect(CAL.overlapDays[0][0]).toBe(7);
    expect(CAL.overlapDays[0].slice(1).every((d) => d === 0)).toBe(true);
  });
  it("W5 = [Jan 29, Feb 5) spans two months: January 3, February 4", () => {
    expect(CAL.overlapDays[4][0]).toBe(3);
    expect(CAL.overlapDays[4][1]).toBe(4);
    expect(CAL.overlapDays[4].slice(2).every((d) => d === 0)).toBe(true);
    expect(rowSum(CAL.overlapDays[4])).toBe(7);
  });
  it("the spillover week W53 has only Dec 31 inside 2023 (row sum 1)", () => {
    expect(CAL.overlapDays[52][11]).toBe(1); // December
    expect(rowSum(CAL.overlapDays[52])).toBe(1);
  });
});

describe("the 'weekly + monthly synchronized' invariants", () => {
  it("every month's column sum equals its exact day count (no day uncovered or double-counted)", () => {
    for (let m = 0; m < 12; m += 1) {
      expect(colSum(CAL, m)).toBe(CAL.months[m].days);
    }
  });
  it("the whole matrix sums to the year's total days (365)", () => {
    const total = CAL.overlapDays.reduce((a, row) => a + rowSum(row), 0);
    expect(total).toBe(365);
  });
  it("interior weeks row-sum to 7; the spillover week row-sums to 1", () => {
    for (let w = 0; w < 52; w += 1) expect(rowSum(CAL.overlapDays[w])).toBe(7);
    expect(rowSum(CAL.overlapDays[52])).toBe(1);
  });
});

describe("leap year (2024)", () => {
  const CAL24 = buildDualCadenceCalendar(2024, "2024-01-01");
  it("February is 29 days and the matrix sums to 366", () => {
    expect(CAL24.months[1].days).toBe(29);
    const total = CAL24.overlapDays.reduce((a, row) => a + rowSum(row), 0);
    expect(total).toBe(366);
    for (let m = 0; m < 12; m += 1) expect(colSum(CAL24, m)).toBe(CAL24.months[m].days);
  });
});

describe("spanOverlapDays (direct)", () => {
  it("returns the exact shared days, and 0 for disjoint spans", () => {
    expect(spanOverlapDays("2023-01-29", "2023-02-05", "2023-01-01", "2023-02-01")).toBe(3);
    expect(spanOverlapDays("2023-01-29", "2023-02-05", "2023-02-01", "2023-03-01")).toBe(4);
    expect(spanOverlapDays("2023-01-01", "2023-01-08", "2023-03-01", "2023-04-01")).toBe(0);
    expect(spanOverlapDays("2023-01-01", "2023-02-01", "2023-01-01", "2023-02-01")).toBe(31); // identical spans
  });
});

describe("allocateWeekAcrossMonths (largest-remainder tie-out)", () => {
  it("1000 on W5 (3/7 Jan, 4/7 Feb) → Jan 429 / Feb 571, summing exactly to 1000", () => {
    const a = allocateWeekAcrossMonths(1000, CAL, 5);
    expect(a.monthAllocations[0]).toBe(429); // January
    expect(a.monthAllocations[1]).toBe(571); // February
    expect(a.monthAllocations.slice(2).every((v) => v === 0)).toBe(true);
    expect(a.totalAllocatedMinor).toBe(1000);
  });
  it("999 on W5 → Jan 428 / Feb 571 (remainder to the largest fractional month), summing to 999", () => {
    const a = allocateWeekAcrossMonths(999, CAL, 5);
    expect(a.monthAllocations[0]).toBe(428);
    expect(a.monthAllocations[1]).toBe(571);
    expect(a.totalAllocatedMinor).toBe(999);
  });
  it("a single-month week (W1, all January) allocates the whole value to January", () => {
    const a = allocateWeekAcrossMonths(5000, CAL, 1);
    expect(a.monthAllocations[0]).toBe(5000);
    expect(a.monthAllocations.slice(1).every((v) => v === 0)).toBe(true);
    expect(a.totalAllocatedMinor).toBe(5000);
  });
  it("ties out for every week: Σ allocation === the week's value (proportional to in-year days)", () => {
    for (let w = 1; w <= CAL.weeks.length; w += 1) {
      const a = allocateWeekAcrossMonths(123457, CAL, w);
      expect(a.totalAllocatedMinor).toBe(123457);
      // Only months the week actually overlaps receive a non-zero share.
      const row = CAL.overlapDays[w - 1];
      for (let m = 0; m < 12; m += 1) {
        if (row[m] === 0) expect(a.monthAllocations[m]).toBe(0);
      }
    }
  });
});

describe("input validation (locked error codes)", () => {
  it("rejects a bad year or date, and a fiscalYearStart after Jan 1", () => {
    expect(() => buildDualCadenceCalendar(0, "2023-01-01")).toThrow(/VALUE_INVALID/);
    expect(() => buildDualCadenceCalendar(2023, "2023-02-30")).toThrow(/VALUE_INVALID/);
    expect(() => buildDualCadenceCalendar(2023, "2023-01-15")).toThrow(/VALUE_INVALID/);
  });
  it("rejects an out-of-range weekIndex and a negative week value", () => {
    expect(() => allocateWeekAcrossMonths(100, CAL, 0)).toThrow(/VALUE_INVALID/);
    expect(() => allocateWeekAcrossMonths(100, CAL, 54)).toThrow(/VALUE_INVALID/);
    expect(() => allocateWeekAcrossMonths(-1, CAL, 1)).toThrow(/VALUE_INVALID/);
  });
});
