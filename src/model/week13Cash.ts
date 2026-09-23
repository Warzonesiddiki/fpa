/**
 * 13-Week Cash-Flow engine (AUDIT-12 · M3-7 — institutional treasury).
 *
 * **Purpose.** `capital.ts::generate13WeekCashFlow` is a naive roll-forward (opening + receipts −
 * disbursements + financing) with no target-cash floor, no breach detection, and no funding
 * requirement. This module is the exact-decimal institutional 13-week model: it rolls forward cash
 * for exactly 13 weeks, maintains a **target (minimum) cash balance**, computes the **additional
 * borrowing** required in any week where cash would otherwise dip below target, flags the breach
 * weeks, and reports the worst week — with a hard tie-out:
 *
 * ```
 * ending_cash = opening + Σreceipts − Σdisbursements + Σfinancing_in − Σfinancing_out + Σadditional_borrowing
 * ```
 * (integer equality). This is the reference the native `cash_flow_13week` schedule engine must
 * match. Money in exact integer minor units, `money:ast`-clean.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 28, toExpNeg: -20, toExpPos: 20 });

/** One week of cash flow (exact integer minor units; financing split into in (+) and out (−)). */
export interface Week13Week {
  receiptsMinor: number; // cash in: collections, other
  disbursementsMinor: number; // cash out: purchases, payroll, opex, tax, capex
  financingInMinor: number; // loan draws / equity in
  financingOutMinor: number; // loan repayments out
}

export interface Week13Input {
  openingCashMinor: number;
  weeks: Week13Week[]; // exactly 13
  /** Minimum cash balance the facility must maintain (target cash). */
  targetCashMinor: number;
}

/** One week of the 13-week schedule. */
export interface Week13Row {
  weekNum: number; // 1..13
  weekLabel: string; // "W01".."W13"
  openingCashMinor: number;
  receiptsMinor: number;
  disbursementsMinor: number;
  operatingNetMinor: number; // receipts − disbursements
  financingInMinor: number;
  financingOutMinor: number;
  financingNetMinor: number; // in − out
  /** Cash before maintaining the target floor. */
  subtotalCashMinor: number;
  /** Additional borrowing to restore the target (0 when cash already ≥ target). */
  additionalBorrowingMinor: number;
  closingCashMinor: number;
  /** Positive when the week's pre-borrowing cash fell below target. */
  shortfallMinor: number;
  isBelowTarget: boolean;
}

/** The full 13-week schedule + summary. */
export interface Week13Schedule {
  openingCashMinor: number;
  targetCashMinor: number;
  weeks: Week13Row[];
  endingCashMinor: number;
  totalReceiptsMinor: number;
  totalDisbursementsMinor: number;
  totalFinancingInMinor: number;
  totalFinancingOutMinor: number;
  totalOperatingNetMinor: number;
  totalAdditionalBorrowingMinor: number;
  /** Lowest pre-borrowing cash and its week (the true funding pressure point). */
  minimumSubtotalCashMinor: number;
  minimumSubtotalWeek: number;
  /** Lowest closing cash and its week. */
  minimumClosingCashMinor: number;
  minimumClosingWeek: number;
  /** True when any week's pre-borrowing cash fell below the target. */
  isBreach: boolean;
}

function assertAmount(label: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`VALUE_INVALID: ${label} must be a non-negative integer (got ${value})`);
  }
}

/**
 * Build the exact-decimal 13-week cash-flow schedule with a target-cash floor. Any week whose
 * pre-borrowing cash would fall below `targetCashMinor` borrows the shortfall to restore the target.
 * Throws `VALUE_INVALID` when there are not exactly 13 weeks or any amount is invalid.
 */
export function generateWeek13CashFlow(input: Week13Input): Week13Schedule {
  assertAmount("openingCashMinor", input.openingCashMinor);
  assertAmount("targetCashMinor", input.targetCashMinor);
  if (!Array.isArray(input.weeks) || input.weeks.length !== 13) {
    throw new Error(
      `VALUE_INVALID: weeks must contain exactly 13 entries (got ${input.weeks?.length ?? 0})`,
    );
  }
  for (const w of input.weeks) {
    assertAmount("receiptsMinor", w.receiptsMinor);
    assertAmount("disbursementsMinor", w.disbursementsMinor);
    assertAmount("financingInMinor", w.financingInMinor);
    assertAmount("financingOutMinor", w.financingOutMinor);
  }

  const target = new Decimal(input.targetCashMinor);
  const weeks: Week13Row[] = [];
  let opening = new Decimal(input.openingCashMinor);

  let totalReceipts = 0;
  let totalDisbursements = 0;
  let totalFinancingIn = 0;
  let totalFinancingOut = 0;
  let totalOperatingNet = 0;
  let totalAdditionalBorrowing = 0;
  let minSubtotal = null as number | null;
  let minSubtotalWeek = 0;
  let minClosing = null as number | null;
  let minClosingWeek = 0;
  let isBreach = false;

  for (let i = 0; i < 13; i += 1) {
    const w = input.weeks[i];
    const weekNum = i + 1;
    const operatingNet = w.receiptsMinor - w.disbursementsMinor;
    const financingNet = w.financingInMinor - w.financingOutMinor;
    const subtotal = opening.plus(operatingNet).plus(financingNet);
    const belowTarget = subtotal.lessThan(target);
    const additionalBorrowing = belowTarget ? target.minus(subtotal) : new Decimal(0);
    const closing = subtotal.plus(additionalBorrowing);

    const subtotalMinor = subtotal.toNumber();
    const closingMinor = closing.toNumber();
    totalReceipts += w.receiptsMinor;
    totalDisbursements += w.disbursementsMinor;
    totalFinancingIn += w.financingInMinor;
    totalFinancingOut += w.financingOutMinor;
    totalOperatingNet += operatingNet;
    totalAdditionalBorrowing += additionalBorrowing.toNumber();
    if (minSubtotal === null || subtotalMinor < minSubtotal) {
      minSubtotal = subtotalMinor;
      minSubtotalWeek = weekNum;
    }
    if (minClosing === null || closingMinor < minClosing) {
      minClosing = closingMinor;
      minClosingWeek = weekNum;
    }
    if (belowTarget) isBreach = true;

    weeks.push({
      weekNum,
      weekLabel: `W${String(weekNum).padStart(2, "0")}`,
      openingCashMinor: opening.toNumber(),
      receiptsMinor: w.receiptsMinor,
      disbursementsMinor: w.disbursementsMinor,
      operatingNetMinor: operatingNet,
      financingInMinor: w.financingInMinor,
      financingOutMinor: w.financingOutMinor,
      financingNetMinor: financingNet,
      subtotalCashMinor: subtotalMinor,
      additionalBorrowingMinor: additionalBorrowing.toNumber(),
      closingCashMinor: closingMinor,
      shortfallMinor: additionalBorrowing.toNumber(),
      isBelowTarget: belowTarget,
    });

    opening = closing;
  }

  return {
    openingCashMinor: input.openingCashMinor,
    targetCashMinor: input.targetCashMinor,
    weeks,
    endingCashMinor: opening.toNumber(),
    totalReceiptsMinor: totalReceipts,
    totalDisbursementsMinor: totalDisbursements,
    totalFinancingInMinor: totalFinancingIn,
    totalFinancingOutMinor: totalFinancingOut,
    totalOperatingNetMinor: totalOperatingNet,
    totalAdditionalBorrowingMinor: totalAdditionalBorrowing,
    minimumSubtotalCashMinor: minSubtotal as number,
    minimumSubtotalWeek: minSubtotalWeek,
    minimumClosingCashMinor: minClosing as number,
    minimumClosingWeek: minClosingWeek,
    isBreach,
  };
}
