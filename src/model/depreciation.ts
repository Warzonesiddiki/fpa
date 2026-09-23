/**
 * Depreciation schedules + FCCR covenant (AUDIT-12 · M3-7 / M6-1 — Relational Treasury).
 *
 * **Purpose.** The existing `capital.ts` preview only computes the FIRST-year charge and, for DDB,
 * never applies the declining balance nor the Straight-Line switch (the AUDIT's "DDB only computes
 * Year 1 and never switches to Straight-Line (violates ASC 360/IAS 16)"), has no MACRS, and no
 * Fixed Charge Coverage Ratio. This module is the exact-decimal reference for all three, and the
 * reference the native `rust_decimal` schedule engine must match.
 *
 * **Methods** (all exact `decimal.js`, `money:ast`-clean — no float, no locale):
 * - `SL`  Straight-Line: (cost − salvage) / life each year.
 * - `DDB` Double Declining Balance with the **optimal Straight-Line switch**: each year take the
 *   LARGER of the declining-balance charge (`beginningBook × 2/life`) and the straight-line charge
 *   on the remaining book over the remaining life (`(beginningBook − salvage)/remainingYears`),
 *   floored so the book never drops below salvage. Front-loads DDB, transitions to SL once SL ≥ DDB
 *   (the transition is monotonic — one-way).
 * - `MACRS` Half-Year GDS: apply the published IRS Publication 946 Table A-1 percentages to cost.
 *
 * **Exactness discipline (B3/B18-2).** Money enters/leaves as exact integer minor units. Per-year
 * charges are computed in `decimal.js`, rounded HALF_UP to integer minor units, and accumulated in
 * those integers; the final year is a residual plug over the ROUNDED prior years. The consequence
 * is a hard, testable tie-out on EVERY schedule: `Σ years.depreciation_minor ===
 * total_depreciated_minor === cost − salvage` (SL/DDB) or `=== cost` (MACRS, which ignores salvage),
 * integer equality, and `ending_book_minor === salvage` (or 0). Divisors (`life`, `remainingYears`)
 * are guarded — no divide-by-zero. Rates are fixed published constants.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 28, toExpNeg: -20, toExpPos: 20 });

/** Depreciation method for a schedule. */
export type DepreciationMethod = "SL" | "DDB" | "MACRS";
/** The charge applied in a given year (DDB schedules report which sub-method governed each year). */
export type YearMethod = "SL" | "DDB";

/** A single year of a depreciation schedule (exact integer minor units). */
export interface DepreciationYear {
  year: number; // 1-based
  beginning_book_minor: number;
  depreciation_minor: number;
  ending_book_minor: number;
  accumulated_minor: number;
  /** Which charge governed this year (DDB schedules switch DDB → SL; SL/MACRS are constant). */
  method: "SL" | "DDB" | "MACRS";
}

/** A full, exactly-tied-out depreciation schedule. */
export interface DepreciationSchedule {
  method: DepreciationMethod;
  cost_minor: number;
  salvage_minor: number;
  /** MACRS property class life (3/5/7/10/15/20); the book life for SL/DDB. */
  life_years: number;
  years: DepreciationYear[];
  /** Sum of the yearly charges — equals `cost_minor − salvage_minor` (SL/DDB) or `cost_minor` (MACRS). */
  total_depreciated_minor: number;
  /** Ending book value after the final year (= salvage for SL/DDB; 0 for MACRS). */
  ending_book_minor: number;
  /** DDB only: the first 1-based year the Straight-Line charge governed (undefined if never). */
  switch_year?: number;
}

/** MACRS GDS property classes supported (half-year convention). */
export type MacrsClass = 3 | 5 | 7 | 10 | 15 | 20;

/**
 * Published MACRS GDS half-year convention percentages (IRS Publication 946, Table A-1), as exact
 * fractions of cost. Each column sums to exactly 1.0000 (asserted in tests). The 20-year column uses
 * the 3-decimal rates from the official table.
 */
export const MACRS_HALF_YEAR_RATES: Record<MacrsClass, string[]> = {
  3: ["0.3333", "0.4445", "0.1481", "0.0741"],
  5: ["0.20", "0.32", "0.192", "0.1152", "0.1152", "0.0576"],
  7: ["0.1429", "0.2449", "0.1749", "0.1249", "0.0893", "0.0892", "0.0893", "0.0446"],
  10: [
    "0.10",
    "0.18",
    "0.144",
    "0.1152",
    "0.0922",
    "0.0737",
    "0.0655",
    "0.0655",
    "0.0656",
    "0.0655",
    "0.0328",
  ],
  15: [
    "0.05",
    "0.095",
    "0.0855",
    "0.077",
    "0.0693",
    "0.0623",
    "0.059",
    "0.059",
    "0.0591",
    "0.059",
    "0.0591",
    "0.059",
    "0.0591",
    "0.059",
    "0.0591",
    "0.0295",
  ],
  20: [
    "0.0375",
    "0.07219",
    "0.06677",
    "0.06177",
    "0.05713",
    "0.05285",
    "0.04888",
    "0.04522",
    "0.04462",
    "0.04461",
    "0.04462",
    "0.04461",
    "0.04462",
    "0.04461",
    "0.04462",
    "0.04461",
    "0.04462",
    "0.04461",
    "0.04462",
    "0.04461",
    "0.02231",
  ],
};

/** Round a Decimal to integer minor units, HALF_UP (away from zero) — the house money convention. */
function toMinor(d: Decimal): number {
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Validate a depreciation input, throwing the locked `VALUE_INVALID`-class error on bad values. */
function assertValid(costMinor: number, salvageMinor: number, lifeYears: number): void {
  if (!Number.isInteger(costMinor) || costMinor < 0) {
    throw new Error(`VALUE_INVALID: cost_minor must be a non-negative integer (got ${costMinor})`);
  }
  if (!Number.isInteger(salvageMinor) || salvageMinor < 0) {
    throw new Error(
      `VALUE_INVALID: salvage_minor must be a non-negative integer (got ${salvageMinor})`,
    );
  }
  if (salvageMinor > costMinor) {
    throw new Error(
      `VALUE_INVALID: salvage_minor (${salvageMinor}) exceeds cost_minor (${costMinor})`,
    );
  }
  if (!Number.isInteger(lifeYears) || lifeYears < 1) {
    throw new Error(`VALUE_INVALID: life_years must be a positive integer (got ${lifeYears})`);
  }
}

/** Straight-Line schedule: `(cost − salvage) / life` each year, final year plugs the residual. */
export function straightLineSchedule(
  costMinor: number,
  lifeYears: number,
  salvageMinor = 0,
): DepreciationSchedule {
  assertValid(costMinor, salvageMinor, lifeYears);
  const depreciableBase = costMinor - salvageMinor;
  const annualMinor = toMinor(new Decimal(depreciableBase).dividedBy(lifeYears));
  const years: DepreciationYear[] = [];
  let book = costMinor;
  let accumulated = 0;
  for (let y = 1; y <= lifeYears; y += 1) {
    // Final year = residual plug over the ROUNDED prior years → Σ depreciation_minor === base exactly.
    const amount = y === lifeYears ? depreciableBase - accumulated : annualMinor;
    const ending = book - amount;
    years.push({
      year: y,
      beginning_book_minor: book,
      depreciation_minor: amount,
      ending_book_minor: ending,
      accumulated_minor: accumulated + amount,
      method: "SL",
    });
    book = ending;
    accumulated += amount;
  }
  return {
    method: "SL",
    cost_minor: costMinor,
    salvage_minor: salvageMinor,
    life_years: lifeYears,
    years,
    total_depreciated_minor: accumulated,
    ending_book_minor: book,
  };
}

/**
 * Double Declining Balance with the optimal Straight-Line switch. Each year takes the larger of the
 * DB charge (`beginningBook × 2/life`) and the SL charge on the remaining book (`(beginningBook −
 * salvage)/remaining`), floored at the salvage line; the final year plugs the residual over the
 * ROUNDED prior years so the per-year charges sum exactly to `cost − salvage`.
 */
export function doubleDecliningSchedule(
  costMinor: number,
  lifeYears: number,
  salvageMinor = 0,
): DepreciationSchedule {
  assertValid(costMinor, salvageMinor, lifeYears);
  const depreciableBase = costMinor - salvageMinor;
  const rate = new Decimal(2).dividedBy(lifeYears); // 200% DB
  const years: DepreciationYear[] = [];
  let book = costMinor;
  let accumulated = 0;
  let switchYear: number | undefined;
  for (let y = 1; y <= lifeYears; y += 1) {
    const remaining = lifeYears - (y - 1);
    const dbCharge = new Decimal(book).times(rate);
    const slCharge = new Decimal(book - salvageMinor).dividedBy(remaining);
    const useSl = slCharge.greaterThanOrEqualTo(dbCharge);
    if (useSl && switchYear === undefined) switchYear = y;
    let natural = useSl ? slCharge : dbCharge;
    // Never drop below salvage.
    const floor = new Decimal(book - salvageMinor);
    if (natural.greaterThan(floor)) natural = floor;
    // Final year = residual plug over the ROUNDED prior years → exact per-year tie-out.
    const amount = y === lifeYears ? depreciableBase - accumulated : toMinor(natural);
    const ending = book - amount;
    years.push({
      year: y,
      beginning_book_minor: book,
      depreciation_minor: amount,
      ending_book_minor: ending,
      accumulated_minor: accumulated + amount,
      method: useSl ? "SL" : "DDB",
    });
    book = ending;
    accumulated += amount;
  }
  return {
    method: "DDB",
    cost_minor: costMinor,
    salvage_minor: salvageMinor,
    life_years: lifeYears,
    years,
    total_depreciated_minor: accumulated,
    ending_book_minor: book,
    switch_year: switchYear,
  };
}

/**
 * MACRS GDS half-year schedule: apply the published IRS Pub 946 Table A-1 percentages to cost.
 * MACRS ignores salvage (depreciates fully to 0). The final year plugs the residual over the ROUNDED
 * prior years so the per-year charges sum exactly to `cost_minor`.
 */
export function macrsSchedule(costMinor: number, propertyClass: MacrsClass): DepreciationSchedule {
  if (!Number.isInteger(costMinor) || costMinor < 0) {
    throw new Error(`VALUE_INVALID: cost_minor must be a non-negative integer (got ${costMinor})`);
  }
  const rates = MACRS_HALF_YEAR_RATES[propertyClass];
  if (!rates) {
    throw new Error(
      `VALUE_INVALID: unsupported MACRS property class (got ${String(propertyClass)})`,
    );
  }
  const years: DepreciationYear[] = [];
  let book = costMinor;
  let accumulated = 0;
  for (let y = 1; y <= rates.length; y += 1) {
    // Final year = residual plug over the ROUNDED prior years → Σ depreciation_minor === cost exactly.
    const amount =
      y === rates.length
        ? costMinor - accumulated
        : toMinor(new Decimal(costMinor).times(new Decimal(rates[y - 1])));
    const ending = book - amount;
    years.push({
      year: y,
      beginning_book_minor: book,
      depreciation_minor: amount,
      ending_book_minor: ending,
      accumulated_minor: accumulated + amount,
      method: "MACRS",
    });
    book = ending;
    accumulated += amount;
  }
  return {
    method: "MACRS",
    cost_minor: costMinor,
    salvage_minor: 0,
    life_years: propertyClass,
    years,
    total_depreciated_minor: accumulated,
    ending_book_minor: book,
  };
}

/** Fixed Charge Coverage Ratio (FCCR) inputs (exact integer minor units). */
export interface FccrInput {
  ebitda_minor: number;
  interest_expense_minor: number;
  /** Mandatory principal / debt-service payments in the period (default 0). */
  mandatory_debt_service_minor?: number;
  /** Mandatory lease (finance/operating) payments in the period (default 0). */
  mandatory_lease_payment_minor?: number;
}

/** FCCR result. */
export interface FccrResult {
  fixed_charges_minor: number;
  ebitda_minor: number;
  /** Exact FCCR (EBITDA / fixed charges) as a decimal string, or null when fixed charges are 0. */
  fccr_exact: string | null;
  /** Display FCCR rounded HALF_UP to 2 decimals (matches the existing covenant-gauge style). */
  fccr_display: string;
  target: number;
  breached: boolean;
  /** True when there are no fixed charges and EBITDA is positive (comfortably covered). */
  comfortably_covered: boolean;
}

/**
 * Fixed Charge Coverage Ratio — the institutional covenant the AUDIT calls out as missing.
 * `FCCR = EBITDA / fixedCharges`, where `fixedCharges = interest + mandatory debt service +
 * mandatory lease payments`. A covenant is breached when `FCCR < target` (default 1.0). All money in
 * exact integer minor units; the ratio is exact `decimal.js`.
 */
export function computeFCCR(input: FccrInput, target = 1.0): FccrResult {
  if ((!Number.isInteger(target) && !Number.isFinite(target)) || target <= 0) {
    throw new Error(`VALUE_INVALID: target must be a positive number (got ${target})`);
  }
  const ebitda = new Decimal(input.ebitda_minor);
  const fixedCharges = new Decimal(input.interest_expense_minor)
    .plus(new Decimal(input.mandatory_debt_service_minor ?? 0))
    .plus(new Decimal(input.mandatory_lease_payment_minor ?? 0));
  const fixedChargesMinor = toMinor(fixedCharges);

  if (fixedCharges.greaterThan(0)) {
    const exact = ebitda.dividedBy(fixedCharges);
    const display = exact.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
    return {
      fixed_charges_minor: fixedChargesMinor,
      ebitda_minor: toMinor(ebitda),
      fccr_exact: exact.toString(),
      fccr_display: display,
      target,
      breached: exact.lessThan(new Decimal(target)),
      comfortably_covered: false,
    };
  }

  // No fixed charges: EBITDA > 0 → comfortably covered; EBITDA ≤ 0 → cannot cover (breach).
  const comfortablyCovered = ebitda.greaterThan(0);
  return {
    fixed_charges_minor: 0,
    ebitda_minor: toMinor(ebitda),
    fccr_exact: null,
    fccr_display: comfortablyCovered ? "Infinity" : "0.00",
    target,
    breached: !comfortablyCovered,
    comfortably_covered: comfortablyCovered,
  };
}
