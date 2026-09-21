/**
 * Dual-cadence calendar engine (AUDIT-20 · M1-7 — weekly ↔ monthly fractional-day mapping).
 *
 * **Purpose.** A 13/52-week treasury cadence cannot be bolted onto a 12-month P&L by naive `/ 12`:
 * weeks and calendar months do not align (a week spans two months; a month spans 4.3 weeks). This
 * is the last sandbox-verifiable slice of AUDIT-20 ("Calendar test: weekly + monthly
 * synchronized") and the "fractional-day mapping" that links `weekly_periods` to `monthly_periods`.
 *
 * The engine builds, over a calendar year:
 * - the 12 calendar **months** (exact day spans),
 * - the 7-day **weeks** from the fiscal-year start (covering the year; the last week may spill into
 *   January), and
 * - the **overlap matrix** `overlapDays[week][month]` = the exact integer number of days the week
 *   shares with the month (via the AUDIT-20 Julian-day engine — exact, no `Date`, no DST).
 *
 * **Invariants (the "synchronized" proof, all exact integer equality):**
 * - every month's days are covered exactly once → `Σ_week overlap[week][month] === days(month)`;
 * - the whole matrix sums to the year's days → `ΣΣ overlapDays === 365|366`;
 * - a week fully inside the year overlaps `7` days; a boundary week overlaps its in-year days.
 *
 * `allocateWeekAcrossMonths` then distributes a week's value across the months it spans,
 * proportional to the overlap days, via the **M6-1 largest-remainder oracle** so the pieces sum
 * exactly to the week's total (no drift). All money in exact integer minor units, `money:ast`-clean.
 */
import Decimal from "decimal.js";
import { addDaysToIso, actualDaysBetween, parseIsoDate } from "./dayCount";
import { largestRemainderAllocate } from "./largestRemainder";

/** One period of a cadence: an inclusive `startDate`, exclusive `endDate` day-span. */
export interface CadencePeriod {
  index: number; // 1-based
  label: string;
  startDate: string; // ISO, inclusive
  endDate: string; // ISO, exclusive
  days: number; // actualDaysBetween(startDate, endDate)
}

/** A dual-cadence calendar over one calendar year. */
export interface DualCadenceCalendar {
  year: number;
  fiscalYearStart: string;
  weeks: CadencePeriod[];
  months: CadencePeriod[];
  /** `overlapDays[weekIndex][monthIndex]` = exact integer days the week overlaps the month. */
  overlapDays: number[][];
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function monthOfYear(year: number, month: number): CadencePeriod {
  const startDate = `${year}-${pad2(month)}-01`;
  const endDate = month < 12 ? `${year}-${pad2(month + 1)}-01` : `${year + 1}-01-01`;
  return {
    index: month,
    label: `M${pad2(month)}`,
    startDate,
    endDate,
    days: actualDaysBetween(startDate, endDate),
  };
}

/**
 * Exact integer number of days two `[start, end)` day-spans share (0 when they do not overlap).
 * Uses the AUDIT-20 Julian-day `actualDaysBetween`; ISO dates compare correctly lexicographically.
 */
export function spanOverlapDays(
  weekStart: string,
  weekEnd: string,
  monthStart: string,
  monthEnd: string,
): number {
  const start = weekStart > monthStart ? weekStart : monthStart;
  const end = weekEnd < monthEnd ? weekEnd : monthEnd;
  if (end <= start) return 0;
  return actualDaysBetween(start, end);
}

/**
 * Build the dual-cadence calendar for a calendar year: 12 months + 7-day weeks from `fiscalYearStart`
 * (which must be on or before `YYYY-01-01` — the standard "week containing Jan 1") + the exact
 * week × month overlap matrix. Throws `VALUE_INVALID` on a bad year/date/anchor.
 */
export function buildDualCadenceCalendar(
  year: number,
  fiscalYearStart: string,
): DualCadenceCalendar {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error(`VALUE_INVALID: year must be an integer 1..9999 (got ${year})`);
  }
  if (parseIsoDate(fiscalYearStart) === null) {
    throw new Error(`VALUE_INVALID: fiscalYearStart '${fiscalYearStart}' is not a valid ISO date`);
  }
  const yearStart = `${year}-01-01`;
  if (fiscalYearStart > yearStart) {
    throw new Error(
      `VALUE_INVALID: fiscalYearStart must be on or before ${yearStart} (the week containing Jan 1)`,
    );
  }
  // Sanity floor: the anchor must not be more than ~a year before the start (prevents a pathological
  // week count for untyped IPC input).
  const floor = addDaysToIso(yearStart, -370);
  if (fiscalYearStart < floor) {
    throw new Error(`VALUE_INVALID: fiscalYearStart must be on or after ${floor}`);
  }

  const months: CadencePeriod[] = [];
  for (let m = 1; m <= 12; m += 1) months.push(monthOfYear(year, m));

  const weeks: CadencePeriod[] = [];
  let weekStart = fiscalYearStart;
  let i = 1;
  for (;;) {
    const weekEnd = addDaysToIso(weekStart, 7);
    weeks.push({
      index: i,
      label: `W${pad2(i)}`,
      startDate: weekStart,
      endDate: weekEnd,
      days: actualDaysBetween(weekStart, weekEnd),
    });
    if (weekEnd >= `${year + 1}-01-01`) break; // the last week spilling into January is included
    weekStart = weekEnd;
    i += 1;
  }

  const overlapDays = weeks.map((w) =>
    months.map((m) => spanOverlapDays(w.startDate, w.endDate, m.startDate, m.endDate)),
  );

  return { year, fiscalYearStart, weeks, months, overlapDays };
}

/** A week's value distributed across the 12 months it spans. */
export interface WeekMonthAllocation {
  weekIndex: number;
  /** 12 entries (month 1..12), exact integer minor units. */
  monthAllocations: number[];
  /** Always exactly `weekValueMinor` (largest-remainder tie-out). */
  totalAllocatedMinor: number;
}

/**
 * Distribute a week's total (minor units) across the months it overlaps, proportional to the overlap
 * days, via the M6-1 largest-remainder oracle so `Σ monthAllocations === weekValueMinor` exactly.
 * `weekIndex` is 1-based.
 */
export function allocateWeekAcrossMonths(
  weekValueMinor: number,
  calendar: DualCadenceCalendar,
  weekIndex: number,
): WeekMonthAllocation {
  if (!Number.isInteger(weekValueMinor) || weekValueMinor < 0) {
    throw new Error(
      `VALUE_INVALID: weekValueMinor must be a non-negative integer (got ${weekValueMinor})`,
    );
  }
  if (!Number.isInteger(weekIndex) || weekIndex < 1 || weekIndex > calendar.weeks.length) {
    throw new Error(
      `VALUE_INVALID: weekIndex out of range 1..${calendar.weeks.length} (got ${weekIndex})`,
    );
  }
  const overlapRow = calendar.overlapDays[weekIndex - 1];
  const totalDays = overlapRow.reduce((a, b) => a + b, 0);
  if (totalDays === 0) {
    throw new Error(`VALUE_INVALID: week ${weekIndex} does not overlap year ${calendar.year}`);
  }
  const exactLines = overlapRow.map((d) =>
    new Decimal(weekValueMinor).times(d).dividedBy(new Decimal(totalDays)).toString(),
  );
  const { displayed } = largestRemainderAllocate(
    exactLines,
    "1",
    new Decimal(weekValueMinor).toString(),
  );
  const monthAllocations = displayed.map((v) => new Decimal(v).toNumber());
  return {
    weekIndex,
    monthAllocations,
    totalAllocatedMinor: monthAllocations.reduce((a, b) => a + b, 0),
  };
}
