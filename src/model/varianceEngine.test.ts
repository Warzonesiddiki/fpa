/**
 * 5-factor PVM engine tests (AUDIT-17 · M5-1/M5-2 · src/model/varianceEngine.ts).
 *
 * The six core tests carry the names fixed in docs/CODE-TO-AUDIT-MAPPING.md
 * (AUDIT-17 row): pure_volume, pure_price, complex_mixed, invariant_never_breaks,
 * zero_quantity, degraded_no_quantity. Additional cases pin the documented
 * degradation semantics, the 6-decimal HALF_EVEN precision boundary, and the
 * degenerate-rate guard.
 *
 * Money discipline: every assertion is on exact integer minor units; the
 * sum-of-parts invariant is asserted as exact integer equality (never a
 * tolerance band).
 */
import { describe, expect, it } from "vitest";
import { computePvmFactors, verifyPvmInvariant, type PvmInputs } from "./varianceEngine";

/** Shorthand for a full PvmInputs record (exact decimal strings only). */
function inputs(overrides: Partial<PvmInputs> = {}): PvmInputs {
  return {
    actualValueMinor: 0,
    planValueMinor: 0,
    actualQuantity: null,
    planQuantity: null,
    actualMixIndex: null,
    planMixIndex: null,
    actualFxRate: null,
    planFxRate: null,
    ...overrides,
  };
}

describe("PVM 5-factor decomposition (AUDIT-17)", () => {
  it("pure_volume: quantity change at plan price → only ΔV, no residual", () => {
    // Actual: 1,200 units × $10.00 = $12,000.00 (12,000,000 minor)
    // Plan:   1,000 units × $10.00 = $10,000.00 (10,000,000 minor)
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 12_000_000,
        planValueMinor: 10_000_000,
        actualQuantity: 1200,
        planQuantity: 1000,
        actualMixIndex: "1",
        planMixIndex: "1",
      }),
    );
    expect(factors.volumeMinor).toBe(2_000_000);
    expect(factors.priceMinor).toBe(0);
    expect(factors.mixMinor).toBe(0);
    expect(factors.fxMinor).toBe(0);
    expect(factors.efficiencyMinor).toBe(0);
    expect(factors.totalVarianceMinor).toBe(2_000_000);
    // FX absence is an exact zero (single-currency), NOT degradation.
    expect(factors.isResidualDerived).toBe(false);
    expect(verifyPvmInvariant(factors)).toBeNull();
  });

  it("pure_price: price change at plan quantity → only ΔP, no residual", () => {
    // Actual: 1,000 units × $12.00; Plan: 1,000 units × $10.00
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 12_000_000,
        planValueMinor: 10_000_000,
        actualQuantity: 1000,
        planQuantity: 1000,
        actualMixIndex: "1",
        planMixIndex: "1",
      }),
    );
    expect(factors.volumeMinor).toBe(0);
    expect(factors.priceMinor).toBe(2_000_000);
    expect(factors.mixMinor).toBe(0);
    expect(factors.fxMinor).toBe(0);
    expect(factors.efficiencyMinor).toBe(0);
    expect(verifyPvmInvariant(factors)).toBeNull();
  });

  it("complex_mixed: volume down, price up, mix up, FX up → all factors non-zero, exact total", () => {
    // Actual: 900 units × $14,300 minor × mix 1.10 = $12,870.00
    // Plan:   1,000 units × $12,000 minor × mix 1.00 = $12,000.00 (FX 1.00 → 1.05)
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 12_870_000,
        planValueMinor: 12_000_000,
        actualQuantity: 900,
        planQuantity: 1000,
        actualMixIndex: "1.10",
        planMixIndex: "1.00",
        actualFxRate: "1.05",
        planFxRate: "1.00",
      }),
    );
    expect(factors.volumeMinor).toBeLessThan(0); // fewer units → negative volume impact
    expect(factors.priceMinor).toBeGreaterThan(0); // higher price → positive price impact
    expect(factors.mixMinor).toBeGreaterThan(0); // mix shift to higher-value products
    expect(factors.fxMinor).toBeGreaterThan(0); // +5% FX on an actual-rate basis
    expect(factors.totalVarianceMinor).toBe(870_000);
    // The invariant holds exactly (never approximate).
    expect(verifyPvmInvariant(factors)).toBeNull();
  });

  it("invariant_never_breaks: sum-of-parts holds for every documented scenario", () => {
    const scenarios: PvmInputs[] = [
      // No mix, no FX (neutral mix assumed; residual absorbs mix absence).
      inputs({
        actualValueMinor: 15_000_000,
        planValueMinor: 12_000_000,
        actualQuantity: 1500,
        planQuantity: 1200,
      }),
      // Downward variance with a sub-plan mix and no FX.
      inputs({
        actualValueMinor: 8_000_000,
        planValueMinor: 10_000_000,
        actualQuantity: 800,
        planQuantity: 1000,
        actualMixIndex: "0.95",
        planMixIndex: "1",
      }),
      // All six inputs present, including a depreciating actual rate.
      inputs({
        actualValueMinor: 100_000_000,
        planValueMinor: 95_000_000,
        actualQuantity: 5000,
        planQuantity: 4800,
        actualMixIndex: "1.02",
        planMixIndex: "1",
        actualFxRate: "0.98",
        planFxRate: "1",
      }),
      // Zero actual value / zero actual quantity against a plan (no divide-by-zero).
      inputs({
        actualValueMinor: 0,
        planValueMinor: 50_000_000,
        actualQuantity: 0,
        planQuantity: 5000,
        actualMixIndex: "1",
        planMixIndex: "1",
      }),
      // Plan fully unspent: zero plan value, zero plan quantity.
      inputs({
        actualValueMinor: 50_000_000,
        planValueMinor: 0,
        actualQuantity: 5000,
        planQuantity: 0,
        actualMixIndex: "1",
        planMixIndex: "1",
      }),
    ];
    for (const scenario of scenarios) {
      const factors = computePvmFactors(scenario);
      expect(
        verifyPvmInvariant(factors),
        `scenario a=${scenario.actualValueMinor} p=${scenario.planValueMinor} ` +
          `aQty=${scenario.actualQuantity} pQty=${scenario.planQuantity}`,
      ).toBeNull();
      // Belt and braces: assert the equality directly as well.
      const sum =
        factors.volumeMinor +
        factors.priceMinor +
        factors.mixMinor +
        factors.fxMinor +
        factors.efficiencyMinor;
      expect(sum).toBe(factors.totalVarianceMinor);
    }
  });

  it("zero_quantity: never divides by zero; residual carries the full variance", () => {
    // Actual $50,000.00 on zero actual quantity vs a zero-plan-quantity baseline.
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 5_000_000,
        planValueMinor: 0,
        actualQuantity: 0,
        planQuantity: 0,
        actualMixIndex: "1",
        planMixIndex: "1",
      }),
    );
    expect(factors.volumeMinor).toBe(0);
    expect(factors.priceMinor).toBe(0);
    expect(factors.mixMinor).toBe(0);
    expect(factors.fxMinor).toBe(0);
    expect(factors.efficiencyMinor).toBe(5_000_000);
    expect(factors.totalVarianceMinor).toBe(5_000_000);
    expect(verifyPvmInvariant(factors)).toBeNull();
  });

  it("degraded_no_quantity: all factors zero, residual = total variance, flagged", () => {
    // Only monetary values available — no quantity, no mix, no FX.
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 50_000_000,
        planValueMinor: 45_000_000,
      }),
    );
    expect(factors.isResidualDerived).toBe(true);
    expect(factors.volumeMinor).toBe(0);
    expect(factors.priceMinor).toBe(0);
    expect(factors.mixMinor).toBe(0);
    expect(factors.fxMinor).toBe(0);
    expect(factors.efficiencyMinor).toBe(5_000_000);
    expect(factors.totalVarianceMinor).toBe(5_000_000);
    expect(verifyPvmInvariant(factors)).toBeNull();
  });

  it("mix degradation: missing mix → ΔM exactly 0, neutral 1.0 assumed, flagged", () => {
    // Quantity present, mix absent: volume/price use the neutral 1.0 mix,
    // the mix factor is exactly 0, and the result is residual-derived.
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 12_000_000,
        planValueMinor: 10_000_000,
        actualQuantity: 1200,
        planQuantity: 1000,
      }),
    );
    expect(factors.volumeMinor).toBe(2_000_000);
    expect(factors.priceMinor).toBe(0);
    expect(factors.mixMinor).toBe(0);
    expect(factors.fxMinor).toBe(0);
    expect(factors.efficiencyMinor).toBe(0);
    expect(factors.isResidualDerived).toBe(true);
    expect(verifyPvmInvariant(factors)).toBeNull();
  });

  it("negative variance with FX: exact values, residual closes the identity", () => {
    // Actual 800 × $10.00 = $8,000 vs Plan 1,000 × $10.00 = $10,000; mix 0.95,
    // rates 1.00 (actual) vs 0.98 (plan) → FX factor 1 − 0.98/1.00 = 0.02.
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 8_000_000,
        planValueMinor: 10_000_000,
        actualQuantity: 800,
        planQuantity: 1000,
        actualMixIndex: "0.95",
        planMixIndex: "1",
        actualFxRate: "1.00",
        planFxRate: "0.98",
      }),
    );
    expect(factors.volumeMinor).toBe(-2_000_000);
    expect(factors.priceMinor).toBe(0);
    expect(factors.mixMinor).toBe(-400_000);
    expect(factors.fxMinor).toBe(152_000); // 800 × 10,000 × 0.95 × 0.02
    expect(factors.totalVarianceMinor).toBe(-2_000_000);
    expect(factors.efficiencyMinor).toBe(248_000);
    expect(factors.isResidualDerived).toBe(false);
    expect(verifyPvmInvariant(factors)).toBeNull();
  });

  it("six-decimal precision boundary: 95,000,000 / 4,800 rounds HALF_EVEN at 6dp", () => {
    // Plan price = 90,000,000 / 4,500 = 20,000 exact;
    // actual price = 95,000,000 / 4,800 = 19,791.666666… → 19,791.666667 (6dp HALF_EVEN).
    // ΔP = 4,800 × (19,791.666667 − 20,000) = −999,999.9984 → −1,000,000 (HALF_UP).
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 95_000_000,
        planValueMinor: 90_000_000,
        actualQuantity: 4800,
        planQuantity: 4500,
        actualMixIndex: "1",
        planMixIndex: "1",
      }),
    );
    expect(factors.volumeMinor).toBe(6_000_000); // (4800−4500) × 20,000 × 1
    expect(factors.priceMinor).toBe(-1_000_000);
    expect(factors.mixMinor).toBe(0);
    expect(factors.fxMinor).toBe(0);
    expect(factors.efficiencyMinor).toBe(0);
    expect(factors.totalVarianceMinor).toBe(5_000_000);
    expect(verifyPvmInvariant(factors)).toBeNull();
  });

  it("degenerate zero actual FX rate → exact 0 FX factor (never fabricated)", () => {
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 10_000_000,
        planValueMinor: 10_000_000,
        actualQuantity: 1000,
        planQuantity: 1000,
        actualMixIndex: "1",
        planMixIndex: "1",
        actualFxRate: "0",
        planFxRate: "1.00",
      }),
    );
    expect(factors.fxMinor).toBe(0);
    expect(factors.totalVarianceMinor).toBe(0);
    expect(factors.efficiencyMinor).toBe(0);
    expect(verifyPvmInvariant(factors)).toBeNull();
  });

  it("verifyPvmInvariant: flags a corrupted factor set with a readable message", () => {
    const corrupted = computePvmFactors(
      inputs({
        actualValueMinor: 12_000_000,
        planValueMinor: 10_000_000,
        actualQuantity: 1200,
        planQuantity: 1000,
        actualMixIndex: "1",
        planMixIndex: "1",
      }),
    );
    // Simulate upstream corruption: volume shifted off its exact value.
    const broken = { ...corrupted, volumeMinor: corrupted.volumeMinor + 1 };
    const message = verifyPvmInvariant(broken);
    expect(message).not.toBeNull();
    expect(message).toContain("sum-of-parts");
    expect(message).toContain(String(corrupted.totalVarianceMinor));
  });

  it("large values stay exact within i64/2^53 bounds", () => {
    // $9,000,000,000.00 actual vs $1,000,000,000.00 plan; 900,000 vs 100,000 units
    // at a constant $10,000 minor per unit → pure volume of 8,000,000,000,000 minor.
    const factors = computePvmFactors(
      inputs({
        actualValueMinor: 9_000_000_000_000,
        planValueMinor: 1_000_000_000_000,
        actualQuantity: 900_000,
        planQuantity: 100_000,
        actualMixIndex: "1",
        planMixIndex: "1",
      }),
    );
    expect(factors.volumeMinor).toBe(8_000_000_000_000);
    expect(factors.priceMinor).toBe(0);
    expect(factors.efficiencyMinor).toBe(0);
    expect(factors.totalVarianceMinor).toBe(8_000_000_000_000);
    expect(verifyPvmInvariant(factors)).toBeNull();
  });
});
