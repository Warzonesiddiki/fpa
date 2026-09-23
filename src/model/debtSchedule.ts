/**
 * Debt interest & amortization schedules (AUDIT-12 / AUDIT-20 · M3-7 — institutional debt).
 *
 * **Purpose.** `capital.ts::calculateDebtFacility` accrues interest as `closing × (bps/10000)` and
 * splits it `/ 12` — the naive monthly split that understates interest by `365/360 − 1 = 1.39%`
 * (the figure AUDIT-20 names). This module is the exact-decimal reference for correct debt math:
 *
 * - `allInRateBps(benchmark, spread)` — a floating (e.g. **SOFR**) all-in rate = benchmark + credit
 *   spread, in basis points.
 * - `periodInterest(...)` — exact interest for ONE accrual period, composed on the **AUDIT-20
 *   day-count engine** (`dayCount.ts`): `balance × (allIn/10000) × days / denominator`. This is the
 *   reference for the AUDIT-20 acceptance "debt test: Actual/360 interest exact" and "convention
 *   test: 3 methods produce different results".
 * - `levelPaymentAmortization(...)` — a level-payment (annuity) amortization schedule, `n` equal
 *   1/n-year periods; final period plugs the residual so the balance hits exactly 0 and
 *   `Σ principal === principal`.
 * - `pikAccrualSchedule(...)` — Payment-in-Kind (PIK): each period's interest is added to principal
 *   (it compounds), never paid in cash.
 *
 * **Exactness discipline (B3/B18-2).** Money in exact integer minor units; charges computed in
 * `decimal.js` and rounded HALF_UP to minor units, accumulated in those integers. Tie-outs are hard
 * and testable: amortization `Σ principal_minor === principal_minor` and `ending_balance === 0`;
 * PIK `ending_balance === principal + total_accrued`. Rates are integer basis points; day counts
 * come from the AUDIT-20 engine (exact integers). Errors use the locked `VALUE_INVALID` code.
 */
import Decimal from "decimal.js";
import { yearFraction, type DayCountConvention } from "./dayCount";

Decimal.set({ precision: 28, toExpNeg: -20, toExpPos: 20 });

/** Round a Decimal to integer minor units, HALF_UP (away from zero) — the house money convention. */
function toMinor(d: Decimal): number {
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** All-in annual rate in basis points = benchmark (e.g. SOFR) + credit spread. Both ≥ 0 integers. */
export function allInRateBps(benchmarkBps: number, spreadBps = 0): number {
  if (!Number.isInteger(benchmarkBps) || benchmarkBps < 0) {
    throw new Error(
      `VALUE_INVALID: benchmarkBps must be a non-negative integer (got ${benchmarkBps})`,
    );
  }
  if (!Number.isInteger(spreadBps) || spreadBps < 0) {
    throw new Error(`VALUE_INVALID: spreadBps must be a non-negative integer (got ${spreadBps})`);
  }
  return benchmarkBps + spreadBps;
}

/** Exact one-period interest result (unrounded exact string + rounded minor units). */
export interface PeriodInterestResult {
  balanceMinor: number;
  allInAnnualRateBps: number;
  /** Exact convention day count for the period (signed). */
  days: number;
  denominator: number;
  /** Exact year fraction `days / denominator` as a decimal string. */
  yearFraction: string;
  /** Exact interest (unrounded) as a decimal string. */
  interestExact: string;
  /** Interest rounded HALF_UP to minor units. */
  interestMinor: number;
}

/**
 * Exact interest for one accrual period on `balanceMinor` at the all-in annual rate under a day-count
 * convention: `balance × (allIn/10000) × days / denominator`, composed on the AUDIT-20 day-count
 * engine. Invalid dates/amounts throw the locked `VALUE_INVALID` code.
 */
export function periodInterest(
  balanceMinor: number,
  allInAnnualRateBps: number,
  startDate: string,
  endDate: string,
  convention: DayCountConvention,
): PeriodInterestResult {
  if (!Number.isInteger(balanceMinor) || balanceMinor < 0) {
    throw new Error(
      `VALUE_INVALID: balanceMinor must be a non-negative integer (got ${balanceMinor})`,
    );
  }
  if (!Number.isInteger(allInAnnualRateBps) || allInAnnualRateBps < 0) {
    throw new Error(
      `VALUE_INVALID: allInAnnualRateBps must be a non-negative integer (got ${allInAnnualRateBps})`,
    );
  }
  const yf = yearFraction(startDate, endDate, convention); // throws VALUE_INVALID on bad dates
  const rateFraction = new Decimal(allInAnnualRateBps).dividedBy(10000);
  const interestExact = new Decimal(balanceMinor)
    .times(rateFraction)
    .times(new Decimal(yf.yearFraction));
  return {
    balanceMinor,
    allInAnnualRateBps,
    days: yf.days,
    denominator: yf.denominator,
    yearFraction: yf.yearFraction,
    interestExact: interestExact.toString(),
    interestMinor: toMinor(interestExact),
  };
}

/** One row of a level-payment amortization schedule. */
export interface AmortizationRow {
  period: number;
  paymentMinor: number;
  interestMinor: number;
  principalMinor: number;
  /** Ending balance after the payment (integer minor units). */
  balanceMinor: number;
}

/** A level-payment amortization schedule that ties out to zero. */
export interface AmortizationSchedule {
  principalMinor: number;
  allInAnnualRateBps: number;
  periods: number;
  /** The level annuity payment (rounded HALF_UP to minor units). */
  levelPaymentMinor: number;
  rows: AmortizationRow[];
  totalPaymentMinor: number;
  totalInterestMinor: number;
  /** Sum of the principal portions — always exactly `principalMinor`. */
  totalPrincipalMinor: number;
  /** Always exactly 0 after the final residual plug. */
  endingBalanceMinor: number;
}

/**
 * Level-payment (annuity) amortization over `n` equal 1/n-year periods. Per-period rate is
 * `allIn / (10000 × n)`; the annuity payment `A = P × r × (1+r)^n / ((1+r)^n − 1)` (or `P / n` when
 * the rate is 0). The final period plugs the residual balance so `ending_balance === 0` and
 * `Σ principal_minor === principal_minor`.
 */
export function levelPaymentAmortization(
  principalMinor: number,
  allInAnnualRateBps: number,
  periods: number,
): AmortizationSchedule {
  if (!Number.isInteger(principalMinor) || principalMinor < 0) {
    throw new Error(
      `VALUE_INVALID: principalMinor must be a non-negative integer (got ${principalMinor})`,
    );
  }
  if (!Number.isInteger(allInAnnualRateBps) || allInAnnualRateBps < 0) {
    throw new Error(
      `VALUE_INVALID: allInAnnualRateBps must be a non-negative integer (got ${allInAnnualRateBps})`,
    );
  }
  if (!Number.isInteger(periods) || periods < 1) {
    throw new Error(`VALUE_INVALID: periods must be a positive integer (got ${periods})`);
  }
  const r = new Decimal(allInAnnualRateBps).dividedBy(10000).dividedBy(periods); // per-period rate
  const levelPayment = r.isZero()
    ? new Decimal(principalMinor).dividedBy(periods)
    : (() => {
        const growth = new Decimal(1).plus(r).pow(periods);
        return new Decimal(principalMinor).times(r).times(growth).dividedBy(growth.minus(1));
      })();
  const levelPaymentMinor = toMinor(levelPayment);

  const rows: AmortizationRow[] = [];
  let balance = principalMinor;
  let totalInterest = 0;
  let totalPayment = 0;
  for (let p = 1; p <= periods; p += 1) {
    const isFinal = p === periods;
    const interestMinor = toMinor(new Decimal(balance).times(r));
    // Final period takes the whole remaining balance → balance hits 0 and Σ principal === principal.
    const principalMinor = isFinal ? balance : levelPaymentMinor - interestMinor;
    const paymentMinor = interestMinor + principalMinor;
    balance -= principalMinor;
    totalInterest += interestMinor;
    totalPayment += paymentMinor;
    rows.push({ period: p, paymentMinor, interestMinor, principalMinor, balanceMinor: balance });
  }
  return {
    principalMinor,
    allInAnnualRateBps,
    periods,
    levelPaymentMinor,
    rows,
    totalPaymentMinor: totalPayment,
    totalInterestMinor: totalInterest,
    totalPrincipalMinor: totalPayment - totalInterest,
    endingBalanceMinor: balance,
  };
}

/** One row of a Payment-in-Kind (PIK) accrual schedule. */
export interface PikRow {
  period: number;
  interestMinor: number;
  /** Balance after the interest accretes (compounds). */
  balanceMinor: number;
}

/** A PIK accrual schedule (interest compounds into principal). */
export interface PikSchedule {
  principalMinor: number;
  annualRateBps: number;
  periods: number;
  rows: PikRow[];
  totalAccruedMinor: number;
  /** Always exactly `principalMinor + totalAccruedMinor`. */
  endingBalanceMinor: number;
}

/**
 * Payment-in-Kind accrual: each period's interest `balance × (rate/10000/perPeriod)` is added to the
 * principal (it compounds, never paid in cash). Exact decimal; `ending_balance === principal +
 * total_accrued`.
 */
export function pikAccrualSchedule(
  principalMinor: number,
  annualRateBps: number,
  periods: number,
): PikSchedule {
  if (!Number.isInteger(principalMinor) || principalMinor < 0) {
    throw new Error(
      `VALUE_INVALID: principalMinor must be a non-negative integer (got ${principalMinor})`,
    );
  }
  if (!Number.isInteger(annualRateBps) || annualRateBps < 0) {
    throw new Error(
      `VALUE_INVALID: annualRateBps must be a non-negative integer (got ${annualRateBps})`,
    );
  }
  if (!Number.isInteger(periods) || periods < 1) {
    throw new Error(`VALUE_INVALID: periods must be a positive integer (got ${periods})`);
  }
  const r = new Decimal(annualRateBps).dividedBy(10000).dividedBy(periods);
  const rows: PikRow[] = [];
  let balance = new Decimal(principalMinor);
  let totalAccrued = 0;
  for (let p = 1; p <= periods; p += 1) {
    const interestMinor = toMinor(balance.times(r));
    balance = balance.plus(interestMinor);
    totalAccrued += interestMinor;
    rows.push({ period: p, interestMinor, balanceMinor: toMinor(balance) });
  }
  return {
    principalMinor,
    annualRateBps,
    periods,
    rows,
    totalAccruedMinor: totalAccrued,
    endingBalanceMinor: toMinor(balance),
  };
}
