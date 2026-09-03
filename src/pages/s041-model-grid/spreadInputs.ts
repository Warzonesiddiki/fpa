/**
 * Pure input helpers for the S-041 Spread dialog (M3-5). Kept out of the component file so the
 * component module only exports components (react-refresh) and the helpers are unit-testable.
 * No float on the money path: decimal.js string arithmetic only (B3).
 */
import Decimal from "decimal.js";

/** Percent text → fraction string, exactly (no float): "8.5" → "0.085". Empty → "0". */
export function percentToFraction(text: string): string {
  const t = text.trim();
  if (t === "") return "0";
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return t; // let the engine reject it as VALUE_INVALID
  return new Decimal(t).div(100).toString();
}

/**
 * Equal-percent default curve at 4 dp that sums to exactly 100 (the LAST period takes the
 * residual — the same rule as MODELING-METHODS-SPEC §3.1). Pure decimal arithmetic.
 */
export function equalPercentCurve(n: number): string[] {
  if (n <= 0) return [];
  const each = new Decimal(100).div(n).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  const last = new Decimal(100).minus(each.mul(n - 1));
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? last : each).toString());
}
