/**
 * Headcount schedule calculations (F-016 · S-045 · MODELING-METHODS-SPEC §6).
 *
 * This is the deterministic TS mirror used by the browser preview and by the S-045 store while the
 * native `model.schedule.upsert` handler is pending. It deliberately keeps compensation as
 * Decimal strings: dates and headcount counts may use ordinary integers, but money and percentages
 * never use JavaScript floating-point arithmetic (B3/B14).
 *
 * The Rust core remains the authoritative calculator in a production Company file. Do not promote
 * this preview mirror to DONE until the native schedule handler, SQLite persistence, and cargo
 * gates are available (B18-3).
 */
import Decimal from "decimal.js";

export const HEADCOUNT_ERROR_CODES = ["HC_DATE_INVALID", "HC_OVERLAP"] as const;
export type HeadcountErrorCode = (typeof HEADCOUNT_ERROR_CODES)[number];

/** One persisted headcount schedule row (the `rows[]` body of model.schedule.upsert). */
export interface HeadcountScheduleRow {
  /** Native rows receive a stable `hc-…` id; new rows omit it until the store allocates one. */
  id?: string;
  role: string;
  cost_center: string;
  start_date: string;
  /** Inclusive termination date. Null means active through the loaded horizon. */
  termination_date: string | null;
  /** Annual base compensation as an exact decimal string in the Company's currency. */
  base_comp_decimal: string;
  bonus_pct: string;
  benefits_pct: string;
  employer_load_pct: string;
  /** Linear ramp: 0 = full cost immediately; 2 = 50% in first active period, then full. */
  ramp_months: number;
}

/** Fiscal period dates needed for exact day-count proration. */
export interface HeadcountPeriod {
  id: string;
  code: string;
  start_date: string;
  end_date: string;
}

export interface HeadcountValidationIssue {
  code: HeadcountErrorCode | "VALUE_INVALID";
  userMessage: string;
  details: Record<string, unknown>;
}

export interface HeadcountMemberCost {
  row_id: string;
  role: string;
  active_days: number;
  period_days: number;
  proration: string;
  ramp_factor: string;
  cost_decimal: string;
}

export interface HeadcountPeriodRollup {
  period_id: string;
  code: string;
  active_headcount: number;
  total_cost_decimal: string;
  members: HeadcountMemberCost[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZERO = new Decimal(0);
const ONE_HUNDRED = new Decimal(100);
const MONEY_SCALE = 2;

function parseDate(value: string): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function dateOrdinal(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

function inclusiveDays(start: Date, end: Date): number {
  return dateOrdinal(end) - dateOrdinal(start) + 1;
}

function decimal(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function asDisplayDecimal(value: Decimal): string {
  // `toDecimalPlaces` is the explicit Currency Scale boundary for the preview. Do not use
  // `toFixed` here: money:ast reserves that formatter for the locale-aware money component.
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toString();
}

function rowId(row: HeadcountScheduleRow, index: number): string {
  return row.id ?? `hc-row-${index + 1}`;
}

function invalidDate(
  row: HeadcountScheduleRow,
  index: number,
  reason: string,
): HeadcountValidationIssue {
  return {
    code: "HC_DATE_INVALID",
    userMessage: "A hire or termination date is outside the active fiscal calendar.",
    details: { row_id: rowId(row, index), row_index: index, reason },
  };
}

function invalidRow(
  row: HeadcountScheduleRow,
  index: number,
  reason: string,
): HeadcountValidationIssue {
  return {
    code: "VALUE_INVALID",
    userMessage: "Value is not valid for this cell (headcount schedule row).",
    details: { row_id: rowId(row, index), row_index: index, reason },
  };
}

/**
 * Validate dates and same-role period overlap before an audited schedule write. The date rules are
 * intentionally strict: a hire must land inside the loaded fiscal horizon, a termination may be
 * after the horizon, and an employee cannot terminate before their hire date.
 *
 * When `periods` is omitted (the mock IPC unit path), overlap is still checked by date interval so
 * the typed `HC_OVERLAP` branch remains reachable without inventing a second calendar.
 */
export function validateHeadcountRows(
  rows: HeadcountScheduleRow[],
  periods: HeadcountPeriod[] = [],
): HeadcountValidationIssue | null {
  if (rows.length === 0) return null;

  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];
  const firstDate = firstPeriod ? parseDate(firstPeriod.start_date) : null;
  const lastDate = lastPeriod ? parseDate(lastPeriod.end_date) : null;

  for (const [index, row] of rows.entries()) {
    const start = parseDate(row.start_date);
    const end = row.termination_date === null ? null : parseDate(row.termination_date);
    if (!start || (row.termination_date !== null && !end)) {
      return invalidDate(row, index, "not_an_iso_calendar_date");
    }
    if (end && dateOrdinal(end) < dateOrdinal(start)) {
      return invalidDate(row, index, "termination_before_start");
    }
    if (firstDate && dateOrdinal(start) < dateOrdinal(firstDate)) {
      return invalidDate(row, index, "start_before_first_period");
    }
    if (lastDate && dateOrdinal(start) > dateOrdinal(lastDate)) {
      return invalidDate(row, index, "start_after_last_period");
    }
    if (
      !row.role.trim() ||
      !row.cost_center.trim() ||
      decimal(row.base_comp_decimal) === null ||
      decimal(row.bonus_pct) === null ||
      decimal(row.benefits_pct) === null ||
      decimal(row.employer_load_pct) === null ||
      !Number.isInteger(row.ramp_months) ||
      row.ramp_months < 0
    ) {
      return invalidRow(row, index, "invalid_schedule_row");
    }
  }

  const sameRole = new Map<string, { row: HeadcountScheduleRow; index: number }[]>();
  for (const [index, row] of rows.entries()) {
    const key = `${row.role.trim().toLowerCase()}\u0000${row.cost_center.trim().toLowerCase()}`;
    const group = sameRole.get(key) ?? [];
    group.push({ row, index });
    sameRole.set(key, group);
  }
  for (const group of sameRole.values()) {
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      const left = group[leftIndex];
      const leftStart = parseDate(left.row.start_date);
      const leftEnd = left.row.termination_date
        ? parseDate(left.row.termination_date)
        : (lastDate ?? new Date("9999-12-31T00:00:00Z"));
      if (!leftStart || !leftEnd) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        const right = group[rightIndex];
        const rightStart = parseDate(right.row.start_date);
        const rightEnd = right.row.termination_date
          ? parseDate(right.row.termination_date)
          : (lastDate ?? new Date("9999-12-31T00:00:00Z"));
        if (!rightStart || !rightEnd) continue;
        const overlap =
          dateOrdinal(leftStart) <= dateOrdinal(rightEnd) &&
          dateOrdinal(rightStart) <= dateOrdinal(leftEnd);
        if (!overlap) continue;

        const periodId =
          periods.find((period) => {
            const periodStart = parseDate(period.start_date);
            const periodEnd = parseDate(period.end_date);
            if (!periodStart || !periodEnd) return false;
            return (
              dateOrdinal(leftStart) <= dateOrdinal(periodEnd) &&
              dateOrdinal(rightStart) <= dateOrdinal(periodEnd) &&
              dateOrdinal(leftEnd) >= dateOrdinal(periodStart) &&
              dateOrdinal(rightEnd) >= dateOrdinal(periodStart)
            );
          })?.id ?? null;
        return {
          code: "HC_OVERLAP",
          userMessage: "Two rows for the same role and cost center overlap in a fiscal period.",
          details: {
            role: left.row.role.trim(),
            cost_center: left.row.cost_center.trim(),
            period_id: periodId,
            row_ids: [rowId(left.row, left.index), rowId(right.row, right.index)],
          },
        };
      }
    }
  }
  return null;
}

function activeWindow(
  row: HeadcountScheduleRow,
  period: HeadcountPeriod,
): { start: Date; end: Date; activeDays: number; periodDays: number } | null {
  const hire = parseDate(row.start_date);
  const termination = row.termination_date ? parseDate(row.termination_date) : null;
  const periodStart = parseDate(period.start_date);
  const periodEnd = parseDate(period.end_date);
  if (!hire || !periodStart || !periodEnd || (row.termination_date && !termination)) return null;

  const start = dateOrdinal(hire) > dateOrdinal(periodStart) ? hire : periodStart;
  const endCandidate = termination ?? periodEnd;
  const end = dateOrdinal(endCandidate) < dateOrdinal(periodEnd) ? endCandidate : periodEnd;
  if (dateOrdinal(start) > dateOrdinal(end)) return null;
  return {
    start,
    end,
    activeDays: inclusiveDays(start, end),
    periodDays: inclusiveDays(periodStart, periodEnd),
  };
}

function rampFactor(
  row: HeadcountScheduleRow,
  periodIndex: number,
  periods: HeadcountPeriod[],
): Decimal {
  if (row.ramp_months === 0) return new Decimal(1);
  const hire = parseDate(row.start_date);
  if (!hire) return ZERO;
  const firstActiveIndex = periods.findIndex((period) => {
    const end = parseDate(period.end_date);
    return end !== null && dateOrdinal(end) >= dateOrdinal(hire);
  });
  if (firstActiveIndex < 0 || periodIndex < firstActiveIndex) return ZERO;
  const monthsInRamp = Math.min(periodIndex - firstActiveIndex + 1, row.ramp_months);
  return new Decimal(monthsInRamp).div(row.ramp_months);
}

/**
 * Calculate exact period costs for a validated schedule. The annual base is spread evenly across
 * the loaded fiscal periods, then multiplied by day-count proration and the optional linear ramp.
 * Percent components are additive on base compensation (base + bonus + benefits + employer load).
 */
export function calculateHeadcountRollup(
  rows: HeadcountScheduleRow[],
  periods: HeadcountPeriod[],
): HeadcountPeriodRollup[] {
  const validation = validateHeadcountRows(rows, periods);
  if (validation) return [];
  const periodCount = new Decimal(Math.max(periods.length, 1));

  return periods.map((period, periodIndex) => {
    const members: HeadcountMemberCost[] = [];
    let total = new Decimal(0);
    for (const [rowIndex, row] of rows.entries()) {
      const window = activeWindow(row, period);
      if (!window) continue;
      const base = decimal(row.base_comp_decimal) ?? ZERO;
      const bonus = decimal(row.bonus_pct) ?? ZERO;
      const benefits = decimal(row.benefits_pct) ?? ZERO;
      const load = decimal(row.employer_load_pct) ?? ZERO;
      const loadMultiplier = new Decimal(1).plus(bonus.plus(benefits).plus(load).div(ONE_HUNDRED));
      const proration = new Decimal(window.activeDays).div(window.periodDays);
      const ramp = rampFactor(row, periodIndex, periods);
      const cost = base.div(periodCount).mul(loadMultiplier).mul(proration).mul(ramp);
      total = total.plus(cost);
      members.push({
        row_id: rowId(row, rowIndex),
        role: row.role.trim(),
        active_days: window.activeDays,
        period_days: window.periodDays,
        proration: proration.toString(),
        ramp_factor: ramp.toString(),
        cost_decimal: asDisplayDecimal(cost),
      });
    }
    return {
      period_id: period.id,
      code: period.code,
      active_headcount: members.length,
      total_cost_decimal: asDisplayDecimal(total),
      members,
    };
  });
}

/** A stable row id for a new local schedule entry. */
export function newHeadcountRowId(existing: HeadcountScheduleRow[]): string {
  const used = new Set(existing.map((row) => row.id));
  let index = 1;
  while (used.has(`hc-row-${index}`)) index += 1;
  return `hc-row-${index}`;
}

/** Render an exact date range for the proration disclosure without hiding day counts. */
export function prorationLabel(member: HeadcountMemberCost): string {
  return `${member.active_days}/${member.period_days} (${member.proration})`;
}

/** Keep unused date helper out of the calculation API while retaining one canonical ISO check. */
export function isValidIsoDate(value: string): boolean {
  return parseDate(value) !== null;
}
