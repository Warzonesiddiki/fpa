/**
 * 5-factor Price-Volume-Mix (PVM) decomposition engine (AUDIT-17 · M5-1/M5-2).
 *
 * Rules (MONEY-ROUNDING-SPEC discipline — exact-decimal client-side math owner):
 * - ZERO floating point on money: values enter and leave as exact integer minor
 *   units only (`number` is safe here — results are integers far below 2^53).
 *   Ratio inputs (mix indices, FX rates) cross the boundary as exact decimal
 *   STRINGS, never floats.
 * - All ratio arithmetic uses decimal.js: 6-decimal HALF_EVEN intermediates; the
 *   final minor-unit conversion is HALF_UP (away from zero). Divisors are
 *   guarded — no Infinity/NaN can reach an output.
 * - Sum-of-parts invariant (MANDATORY — never approximate):
 *       volume + price + mix + fx + efficiency === totalVariance  (exact integer)
 *   Efficiency is the explicit residual: total − (ΔV + ΔP + ΔM + ΔFX).
 * - Graceful degradation (never silent approximation): a factor whose inputs are
 *   unavailable is exactly 0 and the residual absorbs it. A missing FX rate is an
 *   EXACT zero (single-currency scenario) and is NOT degradation; missing
 *   quantity or mix data IS (`isResidualDerived` reports it).
 *
 * Factor definitions (standard enterprise PVM):
 * - ΔV  = (A_qty − P_qty) × P_price × P_mix          (quantity at plan price/mix)
 * - ΔP  = A_qty × (A_price − P_price) × A_mix        (price at actual quantity/mix)
 * - ΔM  = A_qty × P_price × (A_mix − P_mix)          (mix at actual qty, plan price)
 * - ΔFX = A_qty × A_price × A_mix × (1 − P_rate/A_rate)  (exact 0 when single-currency)
 * - ΔE  = total − (ΔV + ΔP + ΔM + ΔFX)               (residual — exact sum-of-parts)
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 28, toExpNeg: -20, toExpPos: 20 });

/** 5-factor PVM result — every field an exact integer in minor units. */
export interface PvmFactors {
  volumeMinor: number;
  priceMinor: number;
  mixMinor: number;
  fxMinor: number;
  efficiencyMinor: number;
  /** Exact total variance (actual − plan) — must equal the sum of the five factors. */
  totalVarianceMinor: number;
  /** True when quantity or mix inputs were unavailable and the residual absorbed them. */
  isResidualDerived: boolean;
}

/** Inputs for a single line/account PVM decomposition. */
export interface PvmInputs {
  /** Actual total, exact integer minor units. */
  actualValueMinor: number;
  /** Plan total, exact integer minor units. */
  planValueMinor: number;
  /** Actual quantity (units). `null`/absent = unavailable. */
  actualQuantity?: number | null;
  /** Plan quantity (units). `null`/absent = unavailable. */
  planQuantity?: number | null;
  /** Mix index, exact decimal string (normalized; "1" = base mix). Absent = unavailable. */
  actualMixIndex?: string | null;
  /** Plan mix index, exact decimal string. Absent = unavailable (neutral "1" assumed). */
  planMixIndex?: string | null;
  /** Actual FX rate, exact decimal string. Absent = single-currency (exact 0 FX). */
  actualFxRate?: string | null;
  /** Plan FX rate, exact decimal string. */
  planFxRate?: string | null;
}

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/** 6-decimal HALF_EVEN intermediate ratio (documented precision boundary). */
function ratio(a: Decimal, b: Decimal): Decimal {
  if (b.isZero()) return ZERO;
  return a.div(b).toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN);
}

/** Final exact minor-unit conversion: integer, HALF_UP (away from zero). */
function toMinor(d: Decimal): number {
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Compute the 5-factor PVM decomposition for one line/account.
 *
 * The residual (efficiency) is ALWAYS `total − (ΔV + ΔP + ΔM + ΔFX)`, so the
 * sum-of-parts invariant holds by construction — `verifyPvmInvariant` is a
 * defensive assertion against upstream corruption, not a rounding fix.
 */
export function computePvmFactors(inputs: PvmInputs): PvmFactors {
  const totalVarianceMinor = inputs.actualValueMinor - inputs.planValueMinor;

  const hasQuantity = inputs.actualQuantity != null && inputs.planQuantity != null;

  if (!hasQuantity) {
    // No quantity data on both sides → volume/price/mix/fx are uncomputable;
    // the residual absorbs the entire variance (never a silent approximation).
    return {
      volumeMinor: 0,
      priceMinor: 0,
      mixMinor: 0,
      fxMinor: 0,
      efficiencyMinor: totalVarianceMinor,
      totalVarianceMinor,
      isResidualDerived: true,
    };
  }

  const aVal = new Decimal(inputs.actualValueMinor);
  const pVal = new Decimal(inputs.planValueMinor);
  const aQty = new Decimal(inputs.actualQuantity as number);
  const pQty = new Decimal(inputs.planQuantity as number);

  const aPrice = ratio(aVal, aQty); // per-unit actual (guarded: qty 0 → 0)
  const pPrice = ratio(pVal, pQty);

  const hasMix = inputs.actualMixIndex != null && inputs.planMixIndex != null;
  const aMix = inputs.actualMixIndex != null ? new Decimal(inputs.actualMixIndex) : ONE;
  const pMix = inputs.planMixIndex != null ? new Decimal(inputs.planMixIndex) : ONE;

  // ΔV: quantity change at plan price and plan mix.
  const volume = aQty.minus(pQty).times(pPrice).times(pMix);
  // ΔP: price change at actual quantity and actual mix.
  const price = aQty.times(aPrice.minus(pPrice)).times(aMix);
  // ΔM: mix change at actual quantity and plan price; exact 0 when mix data absent.
  const mix = hasMix ? aQty.times(pPrice).times(aMix.minus(pMix)) : ZERO;

  // ΔFX: currency impact; exact 0 when single-currency OR the actual rate is a
  // degenerate zero (guarded — garbage rates must not fabricate an FX factor).
  let fx = ZERO;
  if (inputs.actualFxRate != null && inputs.planFxRate != null) {
    const aRate = new Decimal(inputs.actualFxRate);
    const pRate = new Decimal(inputs.planFxRate);
    if (!aRate.isZero()) {
      const factor = ONE.minus(ratio(pRate, aRate));
      fx = aQty.times(aPrice).times(aMix).times(factor);
    }
  }

  const volumeMinor = toMinor(volume);
  const priceMinor = toMinor(price);
  const mixMinor = toMinor(mix);
  const fxMinor = toMinor(fx);
  const efficiencyMinor = totalVarianceMinor - (volumeMinor + priceMinor + mixMinor + fxMinor);

  return {
    volumeMinor,
    priceMinor,
    mixMinor,
    fxMinor,
    efficiencyMinor,
    totalVarianceMinor,
    isResidualDerived: !hasMix,
  };
}

/**
 * Defensive sum-of-parts check: ΔV + ΔP + ΔM + ΔFX + ΔE === total (exact).
 * Returns `null` when the invariant holds, otherwise a human-readable
 * violation message. A non-null result indicates a bug in this engine or
 * corrupted upstream attribution data — it is never "fixed" by re-rounding.
 */
export function verifyPvmInvariant(factors: PvmFactors): string | null {
  const sum =
    factors.volumeMinor +
    factors.priceMinor +
    factors.mixMinor +
    factors.fxMinor +
    factors.efficiencyMinor;
  if (sum === factors.totalVarianceMinor) return null;
  return (
    `PVM sum-of-parts violated: factors sum ${sum} != total variance ` +
    `${factors.totalVarianceMinor} (volume=${factors.volumeMinor}, ` +
    `price=${factors.priceMinor}, mix=${factors.mixMinor}, fx=${factors.fxMinor}, ` +
    `efficiency=${factors.efficiencyMinor})`
  );
}
