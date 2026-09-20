/**
 * Day-count convention engine (AUDIT-20 · M4-5/M1-7 — institutional debt amortization).
 *
 * **Purpose (MODELING-METHODS-SPEC §2).** Term-loan and revolver interest accruals must use
 * exact ISDA day-count conventions, not a naive `annual / 12`. Naive `/12` assumes 12×30 = 360-day
 * years, so it accrues a 365-day calendar year as if it were 360 days and understates interest by
 * `365/360 − 1 = 1.388…%` — the ~1.39% figure named in AUDIT-20. Correct accrual is
 * `principal × rate × yearFraction`, where `yearFraction` is the exact fraction of a year the
 * accrual period spans under the governing convention.
 *
 * **Conventions** (exact-decimal, `money:ast`-clean — no float, no locale):
 * - `ACT_360`        (Actual/360, US corporate debt):     actualDays / 360
 * - `ACT_365`        (Actual/365, UK/Commonwealth debt):  actualDays / 365
 * - `THIRTY_360_US`  (30/360 Bond Basis / US-NASD):       adjustedDays / 360   (default 30/360)
 * - `THIRTY_360_ISDA` (30/360 Eurobond / ISDA):           adjustedDays / 360
 *
 * **Exactness discipline (B3/B18-2).** Dates are ISO calendar dates `YYYY-MM-DD` (UTC,
 * timezone-independent) validated as real Gregorian dates — Feb 30, month 13, day 0/32, and
 * malformed strings are rejected with the locked `VALUE_INVALID` code. The calendar day count is an
 * **exact integer** computed by the Julian-day count formula — no `Date` arithmetic, no float, no DST
 * — so it is exact for the whole supported range. Year fractions and interest are computed in `decimal.js`
 * and returned as exact decimal strings. Divisors (360/365) are fixed constants — no divide-by-zero.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 28, toExpNeg: -20, toExpPos: 20 });

/** Supported day-count conventions (exact ISDA set used by MODELING-METHODS-SPEC §2). */
export type DayCountConvention = "ACT_360" | "ACT_365" | "THIRTY_360_US" | "THIRTY_360_ISDA";

/** The complete, ordered set of conventions (for validation + iteration). */
export const DAY_COUNT_CONVENTIONS: readonly DayCountConvention[] = [
  "ACT_360",
  "ACT_365",
  "THIRTY_360_US",
  "THIRTY_360_ISDA",
] as const;

/** Result of a year-fraction computation. */
export interface YearFractionResult {
  /** Exact year fraction as an exact decimal string (e.g. a 30-day month under 30/360 → 1/12). */
  yearFraction: string;
  /** The exact integer day count the convention applied (signed; 30/360 is the adjusted count). */
  days: number;
  /** The denominator the convention divides by (360 or 365). */
  denominator: number;
}

/** A parsed, validated Gregorian calendar date as integer parts. */
interface DateParts {
  year: number;
  month: number;
  day: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH_COMMON = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Gregorian leap year: divisible by 4, except centuries unless divisible by 400. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in a month of a year (accounts for the leap-year February). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return DAYS_IN_MONTH_COMMON[month - 1];
}

/**
 * Parse + validate an ISO `YYYY-MM-DD` calendar date into integer parts, or return null when it is
 * not a real Gregorian date. Rejects malformed shapes and impossible dates (Feb 30, month 13,
 * day 0/32) — the round-trip-free integer check is exact and has no timezone dependence.
 */
export function parseIsoDate(value: string): DateParts | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;
  // Exact small-integer conversion (digit strings only) — no float, no numeric-coercion builtin.
  const year = new Decimal(match[1]).toNumber();
  const month = new Decimal(match[2]).toNumber();
  const day = new Decimal(match[3]).toNumber();
  if (year < 1) return null; // proleptic Gregorian is defined for year ≥ 1
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Exact integer division for the (non-negative) Julian-Day intermediates; `b` is a positive int. */
function floorDiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/**
 * Julian Day Number of a Gregorian calendar date (exact integer). Verified against the J2000.0
 * epoch: 2000-01-01 → 2451545. The day count between two dates is the difference of their JDNs,
 * exact and DST/timezone-independent.
 */
function julianDayNumber({ year, month, day }: DateParts): number {
  const a = floorDiv(14 - month, 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    floorDiv(153 * m + 2, 5) +
    365 * y +
    floorDiv(y, 4) -
    floorDiv(y, 100) +
    floorDiv(y, 400) -
    32045
  );
}

/**
 * Exact integer number of calendar days from `start` to `end` (signed: `end` before `start` is
 * negative). This is the "actual days" numerator for the Actual/360 and Actual/365 conventions.
 */
export function actualDaysBetween(startDate: string, endDate: string): number {
  return julianDayNumber(parseRequired(endDate)) - julianDayNumber(parseRequired(startDate));
}

/** The 30/360 adjusted day count for a (US Bond Basis or ISDA Eurobond) convention. */
function thirty360Days(start: DateParts, end: DateParts, variant: "US" | "ISDA"): number {
  const { year: y1, month: m1 } = start;
  const { year: y2, month: m2 } = end;
  const originalD1 = start.day;
  let d1 = start.day;
  let d2 = end.day;
  if (d1 === 31) d1 = 30; // both variants: a 31st start-day counts as 30
  if (variant === "US") {
    // Bond Basis: a 31st end-day is 30 only when the (original) start-day was 30 or 31.
    if (d2 === 31 && (originalD1 === 30 || originalD1 === 31)) d2 = 30;
  } else {
    // Eurobond / ISDA: a 31st end-day is always 30.
    if (d2 === 31) d2 = 30;
  }
  return 360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1);
}

/** Fixed day-count denominator for a convention (360 or 365). */
export function denominatorFor(convention: DayCountConvention): number {
  return convention === "ACT_365" ? 365 : 360;
}

/**
 * The exact integer day count a convention applies to a period (signed). For Actual/360 and
 * Actual/365 this is the true calendar-day difference; for 30/360 it is the adjusted 30/360 count.
 * This is the core, hand-verifiable quantity of the engine.
 */
export function accrualDays(
  startDate: string,
  endDate: string,
  convention: DayCountConvention,
): number {
  const start = parseRequired(startDate);
  const end = parseRequired(endDate);
  assertConvention(convention);
  switch (convention) {
    case "ACT_360":
    case "ACT_365":
      return julianDayNumber(end) - julianDayNumber(start);
    case "THIRTY_360_US":
      return thirty360Days(start, end, "US");
    case "THIRTY_360_ISDA":
      return thirty360Days(start, end, "ISDA");
  }
}

/**
 * Exact year fraction for a period under a convention: `days / denominator`, computed in
 * `decimal.js` (exact to the configured 28-digit precision) and returned as a decimal string.
 */
export function yearFraction(
  startDate: string,
  endDate: string,
  convention: DayCountConvention,
): YearFractionResult {
  const days = accrualDays(startDate, endDate, convention);
  const denominator = denominatorFor(convention);
  const value = new Decimal(days).dividedBy(new Decimal(denominator));
  return { yearFraction: value.toString(), days, denominator };
}

/**
 * Exact interest accrual for a period under a convention: `principal × rate × (days / denominator)`,
 * in `decimal.js` (exact). `rate` is the annual rate as an exact decimal fraction (e.g. `"0.055"`
 * for 5.5%). Returns the exact product as a decimal string — display rounding to minor units is a
 * separate concern (MONEY-ROUNDING-SPEC) and is deliberately NOT applied here.
 */
export function accrueInterest(
  principal: string,
  rate: string,
  startDate: string,
  endDate: string,
  convention: DayCountConvention,
): string {
  const days = accrualDays(startDate, endDate, convention);
  const denominator = denominatorFor(convention);
  const amount = new Decimal(parseExactMoney(principal, "principal"))
    .times(parseExactMoney(rate, "rate"))
    .times(new Decimal(days))
    .dividedBy(new Decimal(denominator));
  return amount.toString();
}

/** Parse + validate a date argument, throwing the locked `VALUE_INVALID` code on failure. */
function parseRequired(value: string): DateParts {
  const parts = parseIsoDate(value);
  if (parts === null) {
    throw new Error(`VALUE_INVALID: '${value}' is not a valid ISO calendar date (YYYY-MM-DD)`);
  }
  return parts;
}

/** Parse + validate a convention argument, throwing on an unknown convention. */
function assertConvention(convention: DayCountConvention): void {
  if (!DAY_COUNT_CONVENTIONS.includes(convention)) {
    throw new Error(`VALUE_INVALID: unknown day-count convention '${String(convention)}'`);
  }
}

/** Parse an exact decimal money/rate argument, throwing `VALUE_INVALID` on non-decimal input. */
function parseExactMoney(raw: string, label: string): Decimal {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`VALUE_INVALID: ${label} '${raw}' is not an exact decimal`);
  }
  const d = new Decimal(trimmed);
  if (!d.isFinite()) {
    throw new Error(`VALUE_INVALID: ${label} '${raw}' is not a finite decimal`);
  }
  return d;
}
