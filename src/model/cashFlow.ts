/**
 * Cash Flow statement (Direct + Indirect) + Non-GAAP EBITDA bridge (AUDIT-05 · M6-2 — statements).
 *
 * **Purpose.** AUDIT-05's statement acceptance criteria call for: a Cash Flow where "Direct derives
 * from collections/disbursements; Indirect ties to Net Income + non-cash adjustments", and a
 * "Non-GAAP reconciliation bridge (EBITDA, SBC add-backs)". This module is the exact-decimal TS
 * reference for both, and the reference the native `statement.rs` engine must match.
 *
 * **Cash Flow (two methods, one tie-out).** The Direct method builds Operating from
 * collections − disbursements; the Indirect method builds it from Net Income + D&A + non-cash −
 * Δ working capital. Both feed the same Investing + Financing. `reconcileCashFlow` enforces the
 * exact statement tie-out: **Direct operating === Indirect operating**, **Direct net change ===
 * Indirect net change**, and (when opening/closing cash is given) **net change === Δ cash** — all
 * integer equality. This is the statement-tie-out discipline of the AUDIT (no method may drift).
 *
 * **Non-GAAP bridge.** `buildEbitdaBridge` chains Net Income → EBIT (+ interest, + taxes) → EBITDA
 * (+ D&A) → Adjusted EBITDA (+ SBC, + one-time), each subtotal exactly the sum of its components.
 *
 * **Exactness discipline (B3/B18-2).** Money in exact integer minor units (flows may be negative).
 * All sums are integer arithmetic; no float, no locale, `money:ast`-clean. Invalid inputs throw the
 * locked `VALUE_INVALID` code.
 */

/** One section / total of a cash-flow statement (exact integer minor units). */
export interface CashFlowStatement {
  operatingMinor: number;
  investingMinor: number;
  financingMinor: number;
  /** operating + investing + financing. */
  netCashChangeMinor: number;
}

/** Direct-method inputs (operating built from actual collections / disbursements). */
export interface DirectCashFlowInput {
  operatingCollectionsMinor: number;
  operatingDisbursementsMinor: number;
  /** Net investing (e.g. capex, typically negative). */
  investingMinor: number;
  /** Net financing (e.g. loan draws positive, repayments negative). */
  financingMinor: number;
}

/** Indirect-method inputs (operating built from net income + non-cash ± Δ working capital). */
export interface IndirectCashFlowInput {
  netIncomeMinor: number;
  depreciationMinor: number;
  amortizationMinor: number;
  /** Other non-cash add-backs (e.g. stock-based compensation). */
  nonCashAddBacksMinor: number;
  /** Working-capital change: a POSITIVE value means WC increased (a cash outflow). */
  deltaWorkingCapitalMinor: number;
  investingMinor: number;
  financingMinor: number;
}

function assertMinor(label: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`VALUE_INVALID: ${label} must be an integer minor-unit value (got ${value})`);
  }
}

/**
 * Direct-method cash flow: Operating = collections − disbursements; net = operating + investing +
 * financing.
 */
export function computeDirectCashFlow(input: DirectCashFlowInput): CashFlowStatement {
  assertMinor("operatingCollectionsMinor", input.operatingCollectionsMinor);
  assertMinor("operatingDisbursementsMinor", input.operatingDisbursementsMinor);
  assertMinor("investingMinor", input.investingMinor);
  assertMinor("financingMinor", input.financingMinor);
  const operatingMinor = input.operatingCollectionsMinor - input.operatingDisbursementsMinor;
  return {
    operatingMinor,
    investingMinor: input.investingMinor,
    financingMinor: input.financingMinor,
    netCashChangeMinor: operatingMinor + input.investingMinor + input.financingMinor,
  };
}

/**
 * Indirect-method cash flow: Operating = Net Income + D&A + non-cash − Δ working capital;
 * net = operating + investing + financing.
 */
export function computeIndirectCashFlow(input: IndirectCashFlowInput): CashFlowStatement {
  assertMinor("netIncomeMinor", input.netIncomeMinor);
  assertMinor("depreciationMinor", input.depreciationMinor);
  assertMinor("amortizationMinor", input.amortizationMinor);
  assertMinor("nonCashAddBacksMinor", input.nonCashAddBacksMinor);
  assertMinor("deltaWorkingCapitalMinor", input.deltaWorkingCapitalMinor);
  assertMinor("investingMinor", input.investingMinor);
  assertMinor("financingMinor", input.financingMinor);
  const operatingMinor =
    input.netIncomeMinor +
    input.depreciationMinor +
    input.amortizationMinor +
    input.nonCashAddBacksMinor -
    input.deltaWorkingCapitalMinor;
  return {
    operatingMinor,
    investingMinor: input.investingMinor,
    financingMinor: input.financingMinor,
    netCashChangeMinor: operatingMinor + input.investingMinor + input.financingMinor,
  };
}

/** The exact statement tie-out between the two cash-flow methods (and Δ cash, if given). */
export interface CashFlowReconciliation {
  directOperatingMinor: number;
  indirectOperatingMinor: number;
  operatingTiesOut: boolean;
  directNetMinor: number;
  indirectNetMinor: number;
  netTiesOut: boolean;
  /** closing − opening, when opening/closing cash is supplied; otherwise null. */
  deltaCashMinor: number | null;
  /** Whether net change === Δ cash (null when cash balances were not supplied). */
  cashChangeTiesOut: boolean | null;
  /** operatingTiesOut && netTiesOut (&& cashChangeTiesOut when cash was supplied). */
  isBalanced: boolean;
}

/**
 * Enforce the cash-flow statement tie-out: Direct operating === Indirect operating, Direct net
 * change === Indirect net change, and (with opening/closing cash) net change === Δ cash. Pure
 * integer equality — no tolerance.
 */
export function reconcileCashFlow(
  direct: CashFlowStatement,
  indirect: CashFlowStatement,
  cash?: { openingCashMinor: number; closingCashMinor: number },
): CashFlowReconciliation {
  const operatingTiesOut = direct.operatingMinor === indirect.operatingMinor;
  const netTiesOut = direct.netCashChangeMinor === indirect.netCashChangeMinor;

  let deltaCashMinor: number | null = null;
  let cashChangeTiesOut: boolean | null = null;
  if (cash !== undefined) {
    assertMinor("openingCashMinor", cash.openingCashMinor);
    assertMinor("closingCashMinor", cash.closingCashMinor);
    deltaCashMinor = cash.closingCashMinor - cash.openingCashMinor;
    cashChangeTiesOut = direct.netCashChangeMinor === deltaCashMinor;
  }

  const isBalanced =
    operatingTiesOut && netTiesOut && (cashChangeTiesOut === null || cashChangeTiesOut);

  return {
    directOperatingMinor: direct.operatingMinor,
    indirectOperatingMinor: indirect.operatingMinor,
    operatingTiesOut,
    directNetMinor: direct.netCashChangeMinor,
    indirectNetMinor: indirect.netCashChangeMinor,
    netTiesOut,
    deltaCashMinor,
    cashChangeTiesOut,
    isBalanced,
  };
}

/** Non-GAAP EBITDA bridge inputs (exact integer minor units). */
export interface EbitdaBridgeInput {
  netIncomeMinor: number;
  interestExpenseMinor: number;
  taxExpenseMinor: number;
  depreciationMinor: number;
  amortizationMinor: number;
  /** Stock-based compensation add-back. */
  sbcMinor: number;
  oneTimeAdjustmentsMinor: number;
}

/** The chained Non-GAAP bridge, each subtotal exactly the sum of its components. */
export interface EbitdaBridge {
  netIncomeMinor: number;
  interestExpenseMinor: number;
  taxExpenseMinor: number;
  /** = Net Income + interest + taxes. */
  ebitMinor: number;
  depreciationMinor: number;
  amortizationMinor: number;
  /** = EBIT + depreciation + amortization. */
  ebitdaMinor: number;
  sbcMinor: number;
  oneTimeAdjustmentsMinor: number;
  /** = EBITDA + SBC + one-time adjustments. */
  adjustedEbitdaMinor: number;
  /** True when all three subtotals tie out to their components. */
  isBalanced: boolean;
}

/**
 * Build the Non-GAAP reconciliation bridge: Net Income → EBIT (+ interest, + taxes) → EBITDA
 * (+ D&A) → Adjusted EBITDA (+ SBC, + one-time). Integer arithmetic; every subtotal is exactly the
 * sum of its components.
 */
export function buildEbitdaBridge(input: EbitdaBridgeInput): EbitdaBridge {
  assertMinor("netIncomeMinor", input.netIncomeMinor);
  assertMinor("interestExpenseMinor", input.interestExpenseMinor);
  assertMinor("taxExpenseMinor", input.taxExpenseMinor);
  assertMinor("depreciationMinor", input.depreciationMinor);
  assertMinor("amortizationMinor", input.amortizationMinor);
  assertMinor("sbcMinor", input.sbcMinor);
  assertMinor("oneTimeAdjustmentsMinor", input.oneTimeAdjustmentsMinor);

  const ebitMinor = input.netIncomeMinor + input.interestExpenseMinor + input.taxExpenseMinor;
  const ebitdaMinor = ebitMinor + input.depreciationMinor + input.amortizationMinor;
  const adjustedEbitdaMinor = ebitdaMinor + input.sbcMinor + input.oneTimeAdjustmentsMinor;

  return {
    netIncomeMinor: input.netIncomeMinor,
    interestExpenseMinor: input.interestExpenseMinor,
    taxExpenseMinor: input.taxExpenseMinor,
    ebitMinor,
    depreciationMinor: input.depreciationMinor,
    amortizationMinor: input.amortizationMinor,
    ebitdaMinor,
    sbcMinor: input.sbcMinor,
    oneTimeAdjustmentsMinor: input.oneTimeAdjustmentsMinor,
    adjustedEbitdaMinor,
    isBalanced:
      ebitMinor === input.netIncomeMinor + input.interestExpenseMinor + input.taxExpenseMinor &&
      ebitdaMinor === ebitMinor + input.depreciationMinor + input.amortizationMinor &&
      adjustedEbitdaMinor === ebitdaMinor + input.sbcMinor + input.oneTimeAdjustmentsMinor,
  };
}
