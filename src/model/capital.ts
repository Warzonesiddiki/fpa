/**
 * Capital, Debt, Working Capital & 13-Week Cash calculations (F-017 · S-046 · SCREENS-SPEC S-046).
 *
 * Rules:
 * - ZERO floating point: All money values must be exact integer minor units or Decimal strings.
 * - Exact day/month depreciation math (SL, DDB, Units).
 * - Exact debt facilities (Term, Revolver) with drawdowns, repayments, interest, overdrawn checks.
 * - Working capital driver impacts (DSO, DPO, DIO) on AR, AP, Inventory cash flows.
 * - 13-Week Cash sheet (opening, operating receipts/disbursements, financing draws/repayments, closing cash).
 * - Covenant Gauges (Net Debt / EBITDA target <= 3.5x, Interest Cover target >= 2.5x).
 * - Error codes: CAPEX_IN_SERVICE_INVALID, DEBT_SCHEDULE_OVERDRAWN, COVENANT_BREACH.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 28, toExpNeg: -20, toExpPos: 20 });

export const CAPITAL_ERROR_CODES = [
  "CAPEX_IN_SERVICE_INVALID",
  "DEBT_SCHEDULE_OVERDRAWN",
  "COVENANT_BREACH",
] as const;

export type CapitalErrorCode = (typeof CAPITAL_ERROR_CODES)[number];

export type DepreciationMethod = "SL" | "DDB" | "UNITS";
export type DebtFacilityType = "Term" | "Revolver";

export interface CapitalProject {
  id: string;
  name: string;
  asset_class: string;
  in_service_date: string; // ISO date YYYY-MM-DD
  depreciation_start_date: string; // ISO date YYYY-MM-DD. Must not precede in_service_date!
  life_years: number; // e.g. 10
  method: DepreciationMethod;
  capex_minor: number; // Minor units (e.g. 40_000_000_00 for ₹40M with scale 2)
  total_units?: number; // For UNITS method
  monthly_units?: number; // For UNITS method
}

export interface DebtFacility {
  id: string;
  name: string;
  facility_type: DebtFacilityType;
  interest_rate_bps: number; // e.g. 650 for 6.5%
  opening_balance_minor: number;
  drawdowns_minor: number;
  repayments_minor: number;
  credit_limit_minor?: number; // Optional limit for Revolver
}

export interface WorkingCapitalDrivers {
  dso_days: number; // Days Sales Outstanding
  dpo_days: number; // Days Payable Outstanding
  dio_days: number; // Days Inventory Outstanding
  annual_revenue_minor: number;
  annual_cogs_minor: number;
}

export interface CashWeekSchedule {
  week_num: number; // 1 to 13
  week_label: string; // "W01" ... "W13"
  opening_cash_minor: number;
  receipts_minor: number;
  disbursements_minor: number;
  financing_minor: number; // Net loan draws (+) or repayments (-)
  closing_cash_minor: number;
}

export interface CovenantMetrics {
  total_debt_minor: number;
  cash_balance_minor: number;
  net_debt_minor: number;
  ebitda_minor: number;
  interest_expense_minor: number;
  net_debt_to_ebitda: string; // Decimal string formatted to 2 decimals, e.g. "2.85"
  interest_cover: string; // Decimal string formatted to 2 decimals, e.g. "4.12"
  net_debt_breached: boolean; // net_debt_to_ebitda > 3.5
  interest_cover_breached: boolean; // interest_cover < 2.5
  is_breached: boolean;
}

export interface MonthlyDepreciationPreview {
  monthly_depreciation_minor: number;
  accumulated_first_year_minor: number;
  monthly_depreciation_decimal: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validate capital project dates:
 * Depreciation cannot start before the capital project's in-service date.
 */
export function validateCapitalProject(
  project: CapitalProject,
): { code: CapitalErrorCode; message: string } | null {
  if (
    !isValidIsoDate(project.in_service_date) ||
    !isValidIsoDate(project.depreciation_start_date)
  ) {
    return {
      code: "CAPEX_IN_SERVICE_INVALID",
      message: "Depreciation cannot start before the capital project's in-service date.",
    };
  }
  if (project.depreciation_start_date < project.in_service_date) {
    return {
      code: "CAPEX_IN_SERVICE_INVALID",
      message: "Depreciation cannot start before the capital project's in-service date.",
    };
  }
  return null;
}

/**
 * Calculate preview monthly depreciation for a capital project.
 * Uses exact integer minor units & Decimal rounding.
 */
export function calculateDepreciationPreview(project: CapitalProject): MonthlyDepreciationPreview {
  const capex = new Decimal(project.capex_minor);
  if (capex.isZero() || project.life_years <= 0) {
    return {
      monthly_depreciation_minor: 0,
      accumulated_first_year_minor: 0,
      monthly_depreciation_decimal: "0.00",
    };
  }

  const totalMonths = new Decimal(project.life_years).times(12);

  if (project.method === "SL") {
    // Straight Line: capex / total_months
    const monthlyDec = capex.dividedBy(totalMonths);
    const monthlyMinor = monthlyDec.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    const firstYearMinor = monthlyDec
      .times(12)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
    return {
      monthly_depreciation_minor: monthlyMinor,
      accumulated_first_year_minor: firstYearMinor,
      monthly_depreciation_decimal: monthlyDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
    };
  }

  if (project.method === "DDB") {
    // Double Declining Balance: Rate = 2 / life_years. First year = capex * (2 / life_years).
    const annualRate = new Decimal(2).dividedBy(project.life_years);
    const firstYearDec = capex.times(annualRate);
    const monthlyDec = firstYearDec.dividedBy(12);
    const monthlyMinor = monthlyDec.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    const firstYearMinor = firstYearDec.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    return {
      monthly_depreciation_minor: monthlyMinor,
      accumulated_first_year_minor: firstYearMinor,
      monthly_depreciation_decimal: monthlyDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
    };
  }

  // UNITS: capex * (monthly_units / total_units)
  const totalUnits = new Decimal(project.total_units || 1);
  const monthlyUnits = new Decimal(project.monthly_units || 0);
  const monthlyDec = totalUnits.isZero()
    ? new Decimal(0)
    : capex.times(monthlyUnits).dividedBy(totalUnits);
  const monthlyMinor = monthlyDec.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const firstYearMinor = monthlyDec.times(12).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  return {
    monthly_depreciation_minor: monthlyMinor,
    accumulated_first_year_minor: firstYearMinor,
    monthly_depreciation_decimal: monthlyDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
  };
}

export interface DebtFacilityCalculated extends DebtFacility {
  closing_balance_minor: number;
  monthly_interest_minor: number;
  annual_interest_minor: number;
  is_overdrawn: boolean;
}

/**
 * Calculate debt facility balances and interest.
 * Checks for DEBT_SCHEDULE_OVERDRAWN:
 * 1. Repayments exceed available balance (opening + drawdowns) -> balance < 0
 * 2. Balance exceeds credit limit for Revolver facility
 */
export function calculateDebtFacility(facility: DebtFacility): DebtFacilityCalculated {
  const opening = new Decimal(facility.opening_balance_minor);
  const draws = new Decimal(facility.drawdowns_minor);
  const repayments = new Decimal(facility.repayments_minor);

  // Closing = Opening + Draws - Repayments
  const closing = opening.plus(draws).minus(repayments);
  const closingMinor = closing.toNumber();

  // Annual interest = average or closing balance * bps / 10000
  // Standard FP&A schedule: closing balance * (bps / 10,000)
  const rateFraction = new Decimal(facility.interest_rate_bps).dividedBy(10000);
  const annualInterest = closing.greaterThan(0) ? closing.times(rateFraction) : new Decimal(0);
  const monthlyInterest = annualInterest.dividedBy(12);

  let is_overdrawn = false;
  // Overdrawn if balance < 0 (repaid more than borrowed)
  if (closingMinor < 0) {
    is_overdrawn = true;
  }
  // Or if facility is Revolver and balance exceeds limit
  if (
    facility.facility_type === "Revolver" &&
    facility.credit_limit_minor !== undefined &&
    closingMinor > facility.credit_limit_minor
  ) {
    is_overdrawn = true;
  }

  return {
    ...facility,
    closing_balance_minor: closingMinor,
    monthly_interest_minor: monthlyInterest.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    annual_interest_minor: annualInterest.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    is_overdrawn,
  };
}

export interface WorkingCapitalImpact {
  ar_balance_minor: number;
  ap_balance_minor: number;
  inventory_balance_minor: number;
  net_working_capital_minor: number;
  operating_cash_flow_impact_minor: number;
}

/**
 * Calculate Working Capital drivers impact:
 * AR = (Revenue * DSO) / 365
 * AP = (COGS * DPO) / 365
 * Inventory = (COGS * DIO) / 365
 * Net WC = AR + Inventory - AP
 */
export function calculateWorkingCapitalImpact(
  drivers: WorkingCapitalDrivers,
): WorkingCapitalImpact {
  const rev = new Decimal(drivers.annual_revenue_minor);
  const cogs = new Decimal(drivers.annual_cogs_minor);
  const daysInYear = new Decimal(365);

  const ar = rev.times(drivers.dso_days).dividedBy(daysInYear);
  const ap = cogs.times(drivers.dpo_days).dividedBy(daysInYear);
  const inv = cogs.times(drivers.dio_days).dividedBy(daysInYear);

  const arMinor = ar.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const apMinor = ap.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const invMinor = inv.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  const netWc = ar.plus(inv).minus(ap).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  // Cash flow impact compared to neutral baseline:
  // Operating cash flow = Receipts (from AR) - Payments (to AP and Inventory)
  const ocfImpact = rev
    .minus(cogs)
    .minus(netWc)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  return {
    ar_balance_minor: arMinor,
    ap_balance_minor: apMinor,
    inventory_balance_minor: invMinor,
    net_working_capital_minor: netWc,
    operating_cash_flow_impact_minor: ocfImpact,
  };
}

/**
 * Generate 13-Week Cash Flow Schedule from opening cash and weekly projections.
 */
export function generate13WeekCashFlow(
  openingCashMinor: number,
  weeklyReceipts: number[],
  weeklyDisbursements: number[],
  weeklyFinancing: number[],
): CashWeekSchedule[] {
  const schedule: CashWeekSchedule[] = [];
  let currentOpening = new Decimal(openingCashMinor);

  for (let i = 0; i < 13; i++) {
    const weekNum = i + 1;
    const weekLabel = `W${String(weekNum).padStart(2, "0")}`;
    const receipts = new Decimal(weeklyReceipts[i] ?? 0);
    const disbursements = new Decimal(weeklyDisbursements[i] ?? 0);
    const financing = new Decimal(weeklyFinancing[i] ?? 0);

    const closing = currentOpening.plus(receipts).minus(disbursements).plus(financing);

    schedule.push({
      week_num: weekNum,
      week_label: weekLabel,
      opening_cash_minor: currentOpening.toNumber(),
      receipts_minor: receipts.toNumber(),
      disbursements_minor: disbursements.toNumber(),
      financing_minor: financing.toNumber(),
      closing_cash_minor: closing.toNumber(),
    });

    currentOpening = closing;
  }

  return schedule;
}

/**
 * Calculate Covenant Gauges:
 * Net Debt = Total Debt - Cash
 * Net Debt / EBITDA <= 3.5x
 * Interest Cover = EBITDA / Interest Expense >= 2.5x
 */
export function calculateCovenants(
  totalDebtMinor: number,
  cashBalanceMinor: number,
  ebitdaMinor: number,
  interestExpenseMinor: number,
): CovenantMetrics {
  const debt = new Decimal(totalDebtMinor);
  const cash = new Decimal(cashBalanceMinor);
  const netDebt = debt.minus(cash);
  const ebitda = new Decimal(ebitdaMinor);
  const interest = new Decimal(interestExpenseMinor);

  // Net Debt / EBITDA
  let netDebtToEbitdaStr = "0.00";
  let netDebtBreached = false;

  if (ebitda.greaterThan(0)) {
    const ratio = netDebt.dividedBy(ebitda);
    netDebtToEbitdaStr = ratio.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
    if (ratio.greaterThan(3.5)) {
      netDebtBreached = true;
    }
  } else if (netDebt.greaterThan(0)) {
    netDebtToEbitdaStr = "> 99.00";
    netDebtBreached = true;
  }

  // Interest Cover: EBITDA / Interest
  let interestCoverStr = "0.00";
  let interestCoverBreached = false;

  if (interest.greaterThan(0)) {
    const cover = ebitda.dividedBy(interest);
    interestCoverStr = cover.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
    if (cover.lessThan(2.5)) {
      interestCoverBreached = true;
    }
  } else if (ebitda.greaterThan(0)) {
    interestCoverStr = "99.00"; // Infinite / comfortably covered
  } else {
    interestCoverStr = "0.00";
    interestCoverBreached = true;
  }

  return {
    total_debt_minor: debt.toNumber(),
    cash_balance_minor: cash.toNumber(),
    net_debt_minor: netDebt.toNumber(),
    ebitda_minor: ebitda.toNumber(),
    interest_expense_minor: interest.toNumber(),
    net_debt_to_ebitda: netDebtToEbitdaStr,
    interest_cover: interestCoverStr,
    net_debt_breached: netDebtBreached,
    interest_cover_breached: interestCoverBreached,
    is_breached: netDebtBreached || interestCoverBreached,
  };
}
