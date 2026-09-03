/**
 * Period Spreading — exact algorithm (M3-5 · F-015 · MODELING-METHODS-SPEC §3, US-016).
 *
 * Distributes one total `T` across a horizon of Fiscal Periods so that `Σ v_i == T` EXACTLY at
 * Currency Scale. Pure, dependency-light (decimal.js only), no IPC and no React, so the spec's
 * invariants are verifiable in-process (FORMULA-ENGINE-SPEC §5 — the engine owns the computation,
 * the store commits every period value through the audited `model.cell.set.v1` path).
 *
 * Zero-compromise invariants (B3 / MONEY-ROUNDING-SPEC):
 *  * No float on the money path: every input/output is an exact decimal string; arithmetic is
 *    decimal.js at 28 digits, rounding only at the Currency-Scale boundary (§3).
 *  * Rounding residuals are settled by Largest-Remainder Allocation (§4) — the TS mirror of
 *    `src-tauri/src/core/money.rs::largest_remainder_allocate` (the Rust core stays the owner for
 *    statements/reports; this mirror exists because the spread happens in the engine, before IPC).
 *    Both share the spec vectors (see `spreading.test.ts`).
 *  * Weights are validated to 1.00 ± 0.000001 (MONEY-ROUNDING-SPEC §6); a mismatch is the HARD,
 *    locked `SPREAD_WEIGHTS_INVALID` — normalisation happens ONLY when the caller passes the
 *    explicit `normalize: true` choice (US-016: "never silently normalizes without choice").
 *  * No invented error codes (B20): only `SPREAD_WEIGHTS_INVALID` and `VALUE_INVALID`.
 */

import DecimalBase from "decimal.js";

/**
 * Module-local decimal.js configuration: 28 significant digits (the Rust core's `rust_decimal`
 * width — MONEY-ROUNDING-SPEC §1) and no exponent notation inside the money range. A clone keeps
 * this independent of whichever global config other modules set; every value this module creates
 * uses it, and foreign `Decimal` inputs are re-wrapped on entry.
 */
const Decimal = DecimalBase.clone({ precision: 28, toExpNeg: -30, toExpPos: 40 });
type Decimal = DecimalBase;

/** MODELING-METHODS-SPEC §3 — the four spread methods. */
export type SpreadMethod = "equal" | "seasonal" | "custom" | "lump";

/** Decimal-string regex shared with the paste/fill helpers (exact decimals only, never floats). */
const DECIMAL_RE = /^-?\d+(?:\.\d+)?$/;
/** Weight tolerance: `sum(weights) ≠ 1.00 ± 1e-6 → SPREAD_WEIGHTS_INVALID` (§3, MONEY §6). */
export const WEIGHT_TOLERANCE = new Decimal("0.000001");

export interface SpreadRequest {
  /** The total to distribute — exact decimal string (Money Value at any precision). */
  total: string;
  /** Horizon in period order (P01…Pn). */
  periodIds: readonly string[];
  method: SpreadMethod;
  /**
   * `seasonal`: one fractional weight per period in `periodIds` order (e.g. `"0.083333"`).
   * Percent inputs must be converted by the caller (UI) — the engine speaks fractions only.
   */
  weights?: readonly string[];
  /** `custom`: one exact amount per period in `periodIds` order. */
  amounts?: readonly string[];
  /** `lump`: period_id → amount; periods not listed receive `0`. */
  lumps?: Readonly<Record<string, string>>;
  /**
   * §3.5 — periods excluded from the plan (W53 / P13). They receive no value; the remaining
   * weights/equal shares are re-normalised across the periods actually planned and the result
   * flags the exclusion (`excluded`), so a report can never hide it.
   */
  excludePeriodIds?: readonly string[];
  /**
   * Explicit user choice to normalise weights (seasonal) or amounts (custom) whose sum is off.
   * Never defaulted to true anywhere — it is the audited "normalize" answer to the HARD error.
   */
  normalize?: boolean;
  /** Currency Scale (2 = USD/INR/EUR, 0 = JPY, 3 = KWD). */
  scale: number;
}

export interface SpreadValue {
  period_id: string;
  /** Exact decimal string at Currency Scale. */
  amount_text: string;
}

export interface SpreadResult {
  method: SpreadMethod;
  values: SpreadValue[];
  /** Periods excluded from the plan (§3.5) — empty when none. */
  excluded: string[];
  /** True when the caller's explicit `normalize` choice changed the inputs (audit provenance). */
  normalized: boolean;
  /** Exact sum of `values` — always equals `total` (asserted before returning). */
  sum_text: string;
}

/**
 * Structured spread failure. `code` is a locked ERROR-HANDLING code; `userMessage` is the exact
 * documented text for `SPREAD_WEIGHTS_INVALID` ("Seasonality weights total {sum}% — normalize to
 * 100% or fix."); `details.canNormalize` tells the UI whether the "normalize" answer is available
 * (seasonal/custom yes; lump never — §3.4 "Σ must equal T").
 */
export class SpreadError extends Error {
  readonly code: "SPREAD_WEIGHTS_INVALID" | "VALUE_INVALID";
  readonly userMessage: string;
  readonly details: Record<string, unknown>;
  constructor(
    code: "SPREAD_WEIGHTS_INVALID" | "VALUE_INVALID",
    message: string,
    userMessage: string,
    details: Record<string, unknown> = {},
  ) {
    super(`${code}: ${message}`);
    this.name = "SpreadError";
    this.code = code;
    this.userMessage = userMessage;
    this.details = details;
  }
}

function weightsInvalid(sumFraction: Decimal, extra: Record<string, unknown>): SpreadError {
  // The documented placeholder is a percentage — render exactly, no float, no trailing noise.
  const sumPercent = sumFraction.mul(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
  return new SpreadError(
    "SPREAD_WEIGHTS_INVALID",
    `weights total ${sumPercent}% (expected 100% ± 0.0001%)`,
    `Seasonality weights total ${sumPercent}% — normalize to 100% or fix.`,
    { sum: sumPercent, ...extra },
  );
}

/**
 * Render a Decimal at exactly `scale` fractional digits as an exact string ("1000.00", "0", "-0.5"
 * → "-0.50"). Pure string/integer work — no float, no locale — the same shape the Rust core emits
 * for `amount_text` (MONEY-ROUNDING-SPEC §1). Magnitudes beyond 1e21 minor units are rejected
 * explicitly rather than rendered in exponent form.
 */
export function toScaleText(value: Decimal, scale: number): string {
  const rounded = value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  const minor = rounded.abs().mul(new Decimal(10).pow(scale)).toString();
  if (!/^\d+$/.test(minor)) {
    throw new SpreadError(
      "VALUE_INVALID",
      `amount ${value.toString()} is outside the representable money range`,
      "Value is not valid for this cell (magnitude).",
      { value: value.toString() },
    );
  }
  const padded = minor.padStart(scale + 1, "0");
  const intPart = padded.slice(0, padded.length - scale);
  const fracPart = padded.slice(padded.length - scale);
  const body = scale === 0 ? intPart : `${intPart}.${fracPart}`;
  return rounded.isZero() || !rounded.isNegative() ? body : `-${body}`;
}

function parseDecimal(text: string, what: string): Decimal {
  if (!DECIMAL_RE.test(text.trim())) {
    throw new SpreadError(
      "VALUE_INVALID",
      `${what} '${text}' is not an exact decimal`,
      `Value is not valid for this cell (${what}).`,
      { field: what, value: text },
    );
  }
  return new Decimal(text.trim());
}

/**
 * Largest-Remainder Allocation (MONEY-ROUNDING-SPEC §4) — mirror of the Rust money core.
 *
 * 1. floor every exact value to `unit`; 2. residual = target − Σfloored, where `target` is the
 * exact total the result must reach (the spread total T; when omitted, Σexact settled to the unit
 * grid with HALF_EVEN, exactly like `core/money.rs` rounds `residual / unit`); 3. hand out the
 * residual one `unit` at a time to the values with the LARGEST fractional remainder first
 * (§4 step 4b — descending). Ties are deterministic: `tieBreak = "first"` prefers the lowest
 * index (Rust parity); `"last"` prefers the highest index, which is how MODELING-METHODS-SPEC
 * §3.1 settles an equal spread ("residual to the LAST period"). A negative residual (§4 step 4d)
 * takes a unit back from the SMALLEST remainders first. The result sums to `target` exactly —
 * asserted, never assumed.
 */
export function largestRemainderAllocate(
  exactInput: readonly Decimal[],
  unitInput: Decimal,
  tieBreak: "first" | "last" = "first",
  targetInput?: Decimal,
): Decimal[] {
  if (exactInput.length === 0) return [];
  const unit = new Decimal(unitInput);
  if (unit.lte(0)) {
    throw new SpreadError(
      "VALUE_INVALID",
      "unit must be positive",
      "Value is not valid for this cell (unit).",
    );
  }
  const exact = exactInput.map((v) => new Decimal(v));
  const floored = exact.map((v) => v.div(unit).floor().mul(unit));
  const flooredTotal = floored.reduce((acc, v) => acc.plus(v), new Decimal(0));
  const exactTotal = exact.reduce((acc, v) => acc.plus(v), new Decimal(0));
  const target =
    targetInput === undefined
      ? flooredTotal.plus(
          exactTotal
            .minus(flooredTotal)
            .div(unit)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
            .mul(unit),
        )
      : new Decimal(targetInput);
  const unitsExact = target.minus(flooredTotal).div(unit);
  if (!unitsExact.isInteger()) {
    throw new SpreadError(
      "VALUE_INVALID",
      `target ${target.toString()} is not on the ${unit.toString()} grid`,
      "Value is not valid for this cell (rounding).",
      { target: target.toString(), unit: unit.toString() },
    );
  }

  const remainders = exact.map((v, i) => v.minus(floored[i]));
  const order = exact.map((_, i) => i);
  const byIndex = (i: number, j: number) => (tieBreak === "first" ? i - j : j - i);
  const result = [...floored];
  let units = unitsExact;
  if (units.gt(0)) {
    order.sort((i, j) => remainders[j].comparedTo(remainders[i]) || byIndex(i, j));
    for (let idx = 0; units.gt(0); idx = (idx + 1) % order.length) {
      result[order[idx]] = result[order[idx]].plus(unit);
      units = units.minus(1);
    }
  } else if (units.lt(0)) {
    order.sort((i, j) => remainders[i].comparedTo(remainders[j]) || byIndex(i, j));
    for (let idx = 0; units.lt(0); idx = (idx + 1) % order.length) {
      result[order[idx]] = result[order[idx]].minus(unit);
      units = units.plus(1);
    }
  }
  const sum = result.reduce((acc, v) => acc.plus(v), new Decimal(0));
  if (!sum.eq(target)) {
    throw new SpreadError(
      "VALUE_INVALID",
      `allocation drift: Σ ${sum.toString()} ≠ ${target.toString()}`,
      "Value is not valid for this cell (rounding).",
      { sum: sum.toString(), target: target.toString() },
    );
  }
  return result;
}

/**
 * Validate seasonal weights (fractions). Returns the weights to use; throws the HARD
 * `SPREAD_WEIGHTS_INVALID` unless the caller made the explicit `normalize` choice.
 */
export function validateWeights(
  weights: readonly string[],
  expectedCount: number,
  normalize = false,
): { weights: Decimal[]; normalized: boolean } {
  if (weights.length !== expectedCount) {
    throw new SpreadError(
      "VALUE_INVALID",
      `expected ${expectedCount} weights, got ${weights.length}`,
      `Value is not valid for this cell (weights: ${weights.length} of ${expectedCount}).`,
      { expected: expectedCount, received: weights.length },
    );
  }
  const parsed = weights.map((w, i) => parseDecimal(w, `weight ${i + 1}`));
  for (const [i, w] of parsed.entries()) {
    if (w.lt(0)) {
      throw new SpreadError(
        "VALUE_INVALID",
        `weight ${i + 1} is negative`,
        `Value is not valid for this cell (weight ${i + 1}).`,
        { index: i },
      );
    }
  }
  const sum = parsed.reduce((acc, w) => acc.plus(w), new Decimal(0));
  if (sum.minus(1).abs().lte(WEIGHT_TOLERANCE)) return { weights: parsed, normalized: false };
  if (!normalize) throw weightsInvalid(sum, { canNormalize: !sum.isZero() });
  if (sum.isZero()) throw weightsInvalid(sum, { canNormalize: false });
  return { weights: parsed.map((w) => w.div(sum)), normalized: true };
}

/**
 * Spread `total` across `periodIds` with `method` (MODELING-METHODS-SPEC §3). Every returned
 * amount is an exact decimal string at Currency Scale and `Σ values == total` exactly.
 */
export function spreadTotal(req: SpreadRequest): SpreadResult {
  if (!Number.isInteger(req.scale) || req.scale < 0 || req.scale > 4) {
    throw new SpreadError(
      "VALUE_INVALID",
      `scale ${req.scale} out of range 0..4`,
      "Value is not valid for this cell (scale).",
    );
  }
  const unit = new Decimal(10).pow(-req.scale);
  const total = parseDecimal(req.total, "total");
  if (!total.div(unit).isInteger()) {
    throw new SpreadError(
      "VALUE_INVALID",
      `total ${req.total} has more decimals than the currency scale (${req.scale})`,
      `Value is not valid for this cell (total: scale ${req.scale}).`,
      { total: req.total, scale: req.scale },
    );
  }
  if (req.periodIds.length === 0) {
    throw new SpreadError(
      "VALUE_INVALID",
      "no periods in the horizon",
      "Value is not valid for this cell (horizon).",
    );
  }
  if (new Set(req.periodIds).size !== req.periodIds.length) {
    throw new SpreadError(
      "VALUE_INVALID",
      "duplicate period ids in the horizon",
      "Value is not valid for this cell (horizon).",
    );
  }
  const excluded = (req.excludePeriodIds ?? []).filter((id) => req.periodIds.includes(id));
  const planned = req.periodIds.filter((id) => !excluded.includes(id));
  if (planned.length === 0) {
    throw new SpreadError(
      "VALUE_INVALID",
      "every period is excluded",
      "Value is not valid for this cell (horizon).",
    );
  }

  let exact: Decimal[];
  let normalized = false;

  switch (req.method) {
    case "equal": {
      // §3.1: v_i = T / n; residual settled by Largest-Remainder toward the LAST period.
      exact = planned.map(() => total.div(planned.length));
      break;
    }
    case "seasonal": {
      // §3.2: v_i = T × w_i. Weights are given for the FULL horizon; when W53/P13 is excluded
      // the remaining weights are re-normalised across the periods actually planned (§3.5).
      const all = validateWeights(req.weights ?? [], req.periodIds.length, req.normalize);
      normalized = all.normalized;
      let weights = req.periodIds
        .map((id, i) => ({ id, w: all.weights[i] }))
        .filter((x) => !excluded.includes(x.id))
        .map((x) => x.w);
      if (excluded.length > 0) {
        const kept = weights.reduce((acc, w) => acc.plus(w), new Decimal(0));
        if (kept.isZero()) throw weightsInvalid(kept, { canNormalize: false, excluded });
        weights = weights.map((w) => w.div(kept));
      }
      exact = weights.map((w) => total.mul(w));
      break;
    }
    case "custom": {
      // §3.3: user supplies per-period values; Σ must equal T or the user explicitly normalises.
      const amounts = req.amounts ?? [];
      if (amounts.length !== req.periodIds.length) {
        throw new SpreadError(
          "VALUE_INVALID",
          `expected ${req.periodIds.length} amounts, got ${amounts.length}`,
          `Value is not valid for this cell (amounts: ${amounts.length} of ${req.periodIds.length}).`,
          { expected: req.periodIds.length, received: amounts.length },
        );
      }
      const parsed = req.periodIds
        .map((id, i) => ({ id, v: parseDecimal(amounts[i], `amount ${i + 1}`) }))
        .filter((x) => !excluded.includes(x.id))
        .map((x) => x.v);
      const sum = parsed.reduce((acc, v) => acc.plus(v), new Decimal(0));
      if (sum.eq(total)) {
        exact = parsed;
      } else {
        // The implied weights (amount / T) do not total 100%: HARD unless the user chose to
        // normalise, in which case each amount is scaled by T / Σ (then LRA closes the residual).
        const implied = total.isZero() ? new Decimal(0) : sum.div(total);
        const canNormalize = !sum.isZero() && !total.isZero();
        if (!req.normalize || !canNormalize) {
          throw weightsInvalid(implied, {
            canNormalize,
            mode: "custom",
            sumAmount: sum.toString(),
            total: total.toString(),
            residual: total.minus(sum).toString(),
          });
        }
        exact = parsed.map((v) => v.mul(total).div(sum));
        normalized = true;
      }
      break;
    }
    case "lump": {
      // §3.4: period → amount map; Σ must equal T — no normalisation offer.
      const lumps = req.lumps ?? {};
      for (const id of Object.keys(lumps)) {
        if (!req.periodIds.includes(id)) {
          throw new SpreadError(
            "VALUE_INVALID",
            `lump period '${id}' is not in the horizon`,
            `Value is not valid for this cell (period ${id}).`,
            { period_id: id },
          );
        }
        if (excluded.includes(id)) {
          throw new SpreadError(
            "VALUE_INVALID",
            `lump period '${id}' is excluded from the plan`,
            `Value is not valid for this cell (period ${id} excluded).`,
            { period_id: id },
          );
        }
      }
      exact = planned.map((id) =>
        id in lumps ? parseDecimal(lumps[id], `lump ${id}`) : new Decimal(0),
      );
      const sum = exact.reduce((acc, v) => acc.plus(v), new Decimal(0));
      if (!sum.eq(total)) {
        const implied = total.isZero() ? new Decimal(0) : sum.div(total);
        throw weightsInvalid(implied, {
          canNormalize: false,
          mode: "lump",
          sumAmount: sum.toString(),
          total: total.toString(),
          residual: total.minus(sum).toString(),
        });
      }
      break;
    }
    default: {
      const never: never = req.method;
      throw new SpreadError(
        "VALUE_INVALID",
        `unknown spread method ${String(never)}`,
        "Value is not valid for this cell (method).",
      );
    }
  }

  const allocated = largestRemainderAllocate(exact, unit, "last", total);
  const values: SpreadValue[] = planned.map((period_id, i) => ({
    period_id,
    amount_text: toScaleText(allocated[i], req.scale),
  }));
  const sum = allocated.reduce((acc, v) => acc.plus(v), new Decimal(0));
  if (!sum.eq(total)) {
    throw new SpreadError(
      "VALUE_INVALID",
      `spread drift: Σ ${sum.toString()} ≠ ${total.toString()}`,
      "Value is not valid for this cell (rounding).",
      { sum: sum.toString(), total: total.toString() },
    );
  }
  return {
    method: req.method,
    values,
    excluded,
    normalized,
    sum_text: toScaleText(sum, req.scale),
  };
}
