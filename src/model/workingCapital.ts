/**
 * Working capital drivers (DSO / DPO / DIO / CCC) + auto revolver sweep (AUDIT-16 · M6-1/M3-7 —
 * cash flow / liquidity).
 *
 * **Purpose.** AUDIT-16's fix names, beyond Direct/Indirect cash flow (see `cashFlow.ts`):
 * "working capital drivers (DSO/DPO/DIO); auto-revolver sweep". This module is the exact
 * pure-TS reference for both, and the reference a native engine must match.
 *
 * **Working capital drivers.** Classic FP&A ratios in exact decimal (decimal.js), committed to
 * 2 places HALF_UP:
 * - DSO = Accounts Receivable ÷ Revenue × period days
 * - DIO = Inventory ÷ COGS × period days
 * - DPO = Accounts Payable ÷ COGS × period days
 * - CCC = DSO + DIO − DPO
 * A ratio whose denominator is zero or negative is **not fabricated**: it comes back `null`
 * with the reason (honest refusal, no `-Infinity`, no silent 0).
 *
 * **Auto revolver sweep (closed form).** A revolver facility keeps cash above a minimum by
 * drawing, and sweeps excess cash back by repaying. With period interest `r` (bps) on the
 * draw, the minimum-cash draw solves `cash + d − round(d·r) ≥ minCash` exactly in integer
 * minor units (start from the real-valued fixed point `d* = (minCash − cash) / (1 − r)`,
 * HALF_UP, then walk forward one minor unit at a time until the *rounded* interest actually
 * holds the minimum — at most a couple of steps, deterministic). Draws respect the facility
 * floor and limit; when the limit caps the draw below what the minimum needs, the result
 * says so explicitly (`minimumCashMet = false`) instead of pretending.
 *
 * This is the closed-form counterpart of the grid-formula cycle documented in `cycleSolver.ts`
 * ("average debt ↔ interest expense ↔ net income ↔ cash ↔ revolver draw"): with iterative
 * calculation enabled (AUDIT-04) the engine relaxes that loop; this function is the oracle the
 * relaxed grid must match.
 *
 * **Exactness discipline (B3/B18-2).** Money in exact integer minor units; ratios as exact
 * decimal strings at committed display precision. No float money, `money:ast`-clean. Invalid
 * inputs throw the locked `VALUE_INVALID` code.
 */
import Decimal from "decimal.js";

/** Display precision for ratio outputs (days), committed HALF_UP. */
export const DRIVER_DISPLAY_DECIMALS = 2;

/** Bps basis for a 100% rate. */
export const BPS_PER_HUNDRED_PERCENT = 10_000;

function assertMinor(label: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`VALUE_INVALID: ${label} must be an integer minor-unit value (got ${value})`);
  }
}

function assertNonNegative(label: string, value: number): void {
  assertMinor(label, value);
  if (value < 0) {
    throw new Error(`VALUE_INVALID: ${label} must be ≥ 0 (got ${value})`);
  }
}

function assertPositiveInt(label: string, value: number): void {
  assertMinor(label, value);
  if (value <= 0) {
    throw new Error(`VALUE_INVALID: ${label} must be > 0 (got ${value})`);
  }
}

/** One ratio's result: the committed-precision value, or `null` + why it is not computable. */
export interface DriverValue {
  /**
   * Exact decimal string committed to {@link DRIVER_DISPLAY_DECIMALS} places HALF_UP, minimal
   * representation (e.g. `"22.5"`, not `"22.50"` — house pattern, cf. `capital.ts`), or `null`.
   */
  days: string | null;
  reason: "ok" | "zero_denominator" | "negative_denominator";
}

export interface WorkingCapitalDriverInput {
  /** Days in the period the ratios describe (integer > 0). */
  periodDays: number;
  /** Ending accounts receivable (integer minor units, ≥ 0). */
  accountsReceivableMinor: number;
  /** Revenue over the period (integer minor units; must be > 0 for DSO). */
  revenueMinor: number;
  /** Ending inventory (integer minor units, ≥ 0). */
  inventoryMinor: number;
  /** Cost of goods sold over the period (integer minor units; must be > 0 for DIO/DPO). */
  costOfGoodsSoldMinor: number;
  /** Ending accounts payable (integer minor units, ≥ 0). */
  accountsPayableMinor: number;
}

/** DSO / DPO / DIO (+ Cash Conversion Cycle), each independently honest about divisibility. */
export interface WorkingCapitalDrivers {
  dso: DriverValue;
  dio: DriverValue;
  dpo: DriverValue;
  /** DSO + DIO − DPO at committed precision; `null` unless all three are computable. */
  cashConversionCycle: DriverValue;
}

/**
 * Ratio = balance ÷ flow × periodDays, computed in exact decimal and committed to
 * {@link DRIVER_DISPLAY_DECIMALS} places HALF_UP. A zero or negative flow is reported, not
 * divided.
 */
function ratioDays(balanceMinor: number, flowMinor: number, periodDays: number): DriverValue {
  if (flowMinor === 0) {
    return { days: null, reason: "zero_denominator" };
  }
  if (flowMinor < 0) {
    return { days: null, reason: "negative_denominator" };
  }
  const days = new Decimal(balanceMinor)
    .div(flowMinor)
    .mul(periodDays)
    .toDecimalPlaces(DRIVER_DISPLAY_DECIMALS, Decimal.ROUND_HALF_UP);
  return { days: days.toString(), reason: "ok" };
}

/** Compute the working capital drivers from ending balances and period flows (exact). */
export function computeWorkingCapitalDrivers(
  input: WorkingCapitalDriverInput,
): WorkingCapitalDrivers {
  assertPositiveInt("periodDays", input.periodDays);
  assertNonNegative("accountsReceivableMinor", input.accountsReceivableMinor);
  assertMinor("revenueMinor", input.revenueMinor);
  assertNonNegative("inventoryMinor", input.inventoryMinor);
  assertMinor("costOfGoodsSoldMinor", input.costOfGoodsSoldMinor);
  assertNonNegative("accountsPayableMinor", input.accountsPayableMinor);

  const dso = ratioDays(input.accountsReceivableMinor, input.revenueMinor, input.periodDays);
  const dio = ratioDays(input.inventoryMinor, input.costOfGoodsSoldMinor, input.periodDays);
  const dpo = ratioDays(input.accountsPayableMinor, input.costOfGoodsSoldMinor, input.periodDays);

  let cashConversionCycle: DriverValue;
  if (dso.days !== null && dio.days !== null && dpo.days !== null) {
    const ccc = new Decimal(dso.days)
      .add(dio.days)
      .sub(dpo.days)
      .toDecimalPlaces(DRIVER_DISPLAY_DECIMALS, Decimal.ROUND_HALF_UP);
    cashConversionCycle = {
      days: ccc.toString(),
      reason: "ok",
    };
  } else {
    const failed = [dso, dio, dpo].find((entry) => entry.days === null);
    cashConversionCycle = { days: null, reason: failed ? failed.reason : "ok" };
  }

  return { dso, dio, dpo, cashConversionCycle };
}

export interface RevolverSweepInput {
  /** Cash on hand before any draw/repay (integer minor units, ≥ 0). */
  cashBeforeDrawMinor: number;
  /** Minimum cash the facility keeps on hand (integer minor units, ≥ 0). */
  requiredMinimumCashMinor: number;
  /** Facility limit (integer minor units, ≥ 0). */
  facilityLimitMinor: number;
  /** Floor applied to any draw (integer minor units, ≥ 0, ≤ facilityLimitMinor). */
  floorMinor: number;
  /** Period interest on the draw, in basis points (integer, ≥ 0, < 10000 = 100%). */
  interestRateBps: number;
  /** Current revolver balance before the sweep (integer minor units, ≥ 0). */
  currentBalanceMinor: number;
  /**
   * Target cash for the excess sweep: cash above this is repaid to the facility
   * (integer minor units, ≥ 0, ≥ requiredMinimumCashMinor). Omit to disable repayment.
   */
  targetCashMinor?: number;
}

export type RevolverSweepRule = "min_cash_draw" | "excess_cash_sweep" | "none";

export interface RevolverSweepResult {
  rule: RevolverSweepRule;
  /** New draw added to the balance (≥ 0). */
  drawMinor: number;
  /** Repayment taken off the balance (≥ 0). */
  repayMinor: number;
  /** Period interest charged on the new draw (≥ 0). */
  interestMinor: number;
  endingCashMinor: number;
  endingBalanceMinor: number;
  /**
   * True when the ending cash is ≥ the required minimum. Can be false when the facility
   * limit caps the draw short of what the minimum needs — the sweep then reports the truth
   * instead of assuming the minimum held.
   */
  minimumCashMet: boolean;
}

/** Interest on `drawMinor` at `bps`, committed HALF_UP to whole minor units (exact decimal). */
function interestOnDraw(drawMinor: number, bps: number): number {
  if (drawMinor === 0 || bps === 0) return 0;
  return new Decimal(drawMinor)
    .mul(bps)
    .div(BPS_PER_HUNDRED_PERCENT)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/**
 * Apply the facility's automatic rules to the period: draw if cash is below the minimum
 * (closed form with exact rounded interest, floor + limit respected), otherwise repay the
 * excess above the target cash (capped by the outstanding balance).
 */
export function computeRevolverSweep(input: RevolverSweepInput): RevolverSweepResult {
  assertNonNegative("cashBeforeDrawMinor", input.cashBeforeDrawMinor);
  assertNonNegative("requiredMinimumCashMinor", input.requiredMinimumCashMinor);
  assertNonNegative("facilityLimitMinor", input.facilityLimitMinor);
  assertNonNegative("floorMinor", input.floorMinor);
  assertNonNegative("currentBalanceMinor", input.currentBalanceMinor);
  assertMinor("interestRateBps", input.interestRateBps);
  if (input.interestRateBps < 0 || input.interestRateBps >= BPS_PER_HUNDRED_PERCENT) {
    throw new Error(
      `VALUE_INVALID: interestRateBps must be in [0, ${BPS_PER_HUNDRED_PERCENT}) (got ${input.interestRateBps})`,
    );
  }
  if (input.floorMinor > input.facilityLimitMinor) {
    throw new Error(
      `VALUE_INVALID: floorMinor must be ≤ facilityLimitMinor (got ${input.floorMinor} > ${input.facilityLimitMinor})`,
    );
  }
  if (input.targetCashMinor !== undefined) {
    assertNonNegative("targetCashMinor", input.targetCashMinor);
    if (input.targetCashMinor < input.requiredMinimumCashMinor) {
      throw new Error(
        `VALUE_INVALID: targetCashMinor must be ≥ requiredMinimumCashMinor (got ${input.targetCashMinor} < ${input.requiredMinimumCashMinor})`,
      );
    }
  }

  const cash = input.cashBeforeDrawMinor;

  if (cash < input.requiredMinimumCashMinor) {
    // Minimum-cash draw: solve cash + d − round(d·r) ≥ minCash in integer minor units.
    const shortfall = input.requiredMinimumCashMinor - cash;
    const oneMinusRate = new Decimal(1).sub(
      new Decimal(input.interestRateBps).div(BPS_PER_HUNDRED_PERCENT),
    );
    let draw = new Decimal(shortfall).div(oneMinusRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    // The HALF_UP start may land one minor unit short once the rounded interest is charged;
    // walk forward (bounded: each step raises ending cash by > 0 while below the minimum).
    for (
      let guard = 0;
      guard < 4 &&
      cash + draw.toNumber() - interestOnDraw(draw.toNumber(), input.interestRateBps) <
        input.requiredMinimumCashMinor;
      guard += 1
    ) {
      draw = draw.plus(1);
    }
    let clamped = draw.toNumber();
    if (clamped < input.floorMinor) clamped = input.floorMinor;
    if (clamped > input.facilityLimitMinor) clamped = input.facilityLimitMinor;
    const interest = interestOnDraw(clamped, input.interestRateBps);
    const endingCash = cash + clamped - interest;
    return {
      rule: "min_cash_draw",
      drawMinor: clamped,
      repayMinor: 0,
      interestMinor: interest,
      endingCashMinor: endingCash,
      endingBalanceMinor: input.currentBalanceMinor + clamped,
      minimumCashMet: endingCash >= input.requiredMinimumCashMinor,
    };
  }

  if (input.targetCashMinor !== undefined && cash > input.targetCashMinor) {
    // Excess-cash sweep: repay the amount above the target, capped by the outstanding balance.
    const repay = Math.min(input.currentBalanceMinor, cash - input.targetCashMinor);
    return {
      rule: "excess_cash_sweep",
      drawMinor: 0,
      repayMinor: repay,
      interestMinor: 0,
      endingCashMinor: cash - repay,
      endingBalanceMinor: input.currentBalanceMinor - repay,
      minimumCashMet: cash - repay >= input.requiredMinimumCashMinor,
    };
  }

  return {
    rule: "none",
    drawMinor: 0,
    repayMinor: 0,
    interestMinor: 0,
    endingCashMinor: cash,
    endingBalanceMinor: input.currentBalanceMinor,
    minimumCashMet: true,
  };
}
