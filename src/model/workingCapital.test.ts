import { describe, expect, it } from "vitest";
import { computeRevolverSweep, computeWorkingCapitalDrivers } from "./workingCapital";

/**
 * Exhaustive AUDIT-16 tests for the working capital drivers (DSO/DPO/DIO/CCC) and the
 * auto revolver sweep.
 *
 * **Hand-verified reference** (the canonical consistent set, USD minor units):
 * - Drivers (90-day period): AR 500,000.00 / revenue 3,000,000.00 → DSO 15;
 *   inventory 2,500,000.00 / COGS 10,000,000.00 → DIO 22.5; AP 3,500,000.00 / COGS
 *   10,000,000.00 → DPO 31.5; CCC = 15 + 22.5 − 31.5 = 6.
 * - Revolver (cash 5,000.00, minimum 10,000.00, limit 20,000.00, floor 0, no balance):
 *   - 0 bps: draw 5,000.00 → ending cash exactly 10,000.00, minimum met.
 *   - 50 bps (0.5%): draw 5,025.13, interest 25.13 → ending cash exactly 10,000.00, met.
 *   - limit 4,000.00: draw capped at 4,000.00, interest 20.00 → ending 8,980.00,
 *     minimumCashMet FALSE (the sweep reports the truth).
 *   - floor 6,000.00: draw 6,000.00, interest 30.00 → ending 10,970.00.
 *   - Sweep (cash 20,000.00, target 10,000.00, balance 7,500.00): repay 7,500.00 in
 *     full → ending cash 12,500.00, balance 0.
 *   - Sweep capped by balance (balance 20,000.00): repay only the 10,000.00 excess.
 */

describe("computeWorkingCapitalDrivers", () => {
  it("computes DSO / DIO / DPO / CCC from ending balances and period flows (90-day set)", () => {
    const drivers = computeWorkingCapitalDrivers({
      periodDays: 90,
      accountsReceivableMinor: 50_000_000, // 500,000.00
      revenueMinor: 300_000_000, // 3,000,000.00
      inventoryMinor: 250_000_000, // 2,500,000.00
      costOfGoodsSoldMinor: 1_000_000_000, // 10,000,000.00
      accountsPayableMinor: 350_000_000, // 3,500,000.00
    });
    expect(drivers.dso).toEqual({ days: "15", reason: "ok" });
    expect(drivers.dio).toEqual({ days: "22.5", reason: "ok" });
    expect(drivers.dpo).toEqual({ days: "31.5", reason: "ok" });
    expect(drivers.cashConversionCycle).toEqual({ days: "6", reason: "ok" });
  });

  it("refuses a zero denominator instead of fabricating a ratio", () => {
    const drivers = computeWorkingCapitalDrivers({
      periodDays: 90,
      accountsReceivableMinor: 50_000_000,
      revenueMinor: 0,
      inventoryMinor: 0,
      costOfGoodsSoldMinor: 1_000_000_000,
      accountsPayableMinor: 0,
    });
    expect(drivers.dso).toEqual({ days: null, reason: "zero_denominator" });
    // CCC needs all three — it reports why it is unavailable, not a partial sum.
    expect(drivers.cashConversionCycle.days).toBeNull();
    expect(drivers.cashConversionCycle.reason).toBe("zero_denominator");
  });

  it("refuses a negative flow denominator", () => {
    const drivers = computeWorkingCapitalDrivers({
      periodDays: 90,
      accountsReceivableMinor: 0,
      revenueMinor: -1,
      inventoryMinor: 0,
      costOfGoodsSoldMinor: 0,
      accountsPayableMinor: 0,
    });
    expect(drivers.dso).toEqual({ days: null, reason: "negative_denominator" });
  });

  it("commits ratios to 2 places HALF_UP (no float drift)", () => {
    // 1/3 × 10 days = 3.333… → 3.33 ; 2/3 × 10 days = 6.666… → 6.67
    const third = computeWorkingCapitalDrivers({
      periodDays: 10,
      accountsReceivableMinor: 1,
      revenueMinor: 3,
      inventoryMinor: 0,
      costOfGoodsSoldMinor: 0,
      accountsPayableMinor: 0,
    });
    expect(third.dso.days).toBe("3.33");
    const twoThirds = computeWorkingCapitalDrivers({
      periodDays: 10,
      accountsReceivableMinor: 2,
      revenueMinor: 3,
      inventoryMinor: 0,
      costOfGoodsSoldMinor: 0,
      accountsPayableMinor: 0,
    });
    expect(twoThirds.dso.days).toBe("6.67");
  });

  it("rejects non-integer or invalid inputs with VALUE_INVALID", () => {
    const base = {
      periodDays: 90,
      accountsReceivableMinor: 0,
      revenueMinor: 1,
      inventoryMinor: 0,
      costOfGoodsSoldMinor: 1,
      accountsPayableMinor: 0,
    };
    expect(() => computeWorkingCapitalDrivers({ ...base, periodDays: 1.5 })).toThrow(
      /VALUE_INVALID: periodDays/,
    );
    expect(() => computeWorkingCapitalDrivers({ ...base, accountsReceivableMinor: -1 })).toThrow(
      /VALUE_INVALID: accountsReceivableMinor/,
    );
    expect(() => computeWorkingCapitalDrivers({ ...base, periodDays: 0 })).toThrow(
      /VALUE_INVALID: periodDays/,
    );
  });
});

describe("computeRevolverSweep", () => {
  const BASE = {
    cashBeforeDrawMinor: 500_000, // 5,000.00
    requiredMinimumCashMinor: 1_000_000, // 10,000.00
    facilityLimitMinor: 2_000_000, // 20,000.00
    floorMinor: 0,
    interestRateBps: 0,
    currentBalanceMinor: 0,
  };

  it("draws the exact shortfall when interest is zero (minimum met exactly)", () => {
    const result = computeRevolverSweep({ ...BASE, interestRateBps: 0 });
    expect(result).toEqual({
      rule: "min_cash_draw",
      drawMinor: 500_000,
      repayMinor: 0,
      interestMinor: 0,
      endingCashMinor: 1_000_000,
      endingBalanceMinor: 500_000,
      minimumCashMet: true,
    });
  });

  it("solves the interest-adjusted draw in exact minor units (50 bps)", () => {
    // cash 5,000.00 + d − round(d·0.005) ≥ 10,000.00 → d = 5,025.13 (interest 25.13)
    // lands the ending cash exactly on the minimum.
    const result = computeRevolverSweep({ ...BASE, interestRateBps: 50 });
    expect(result.rule).toBe("min_cash_draw");
    expect(result.drawMinor).toBe(502_513);
    expect(result.interestMinor).toBe(2_513);
    expect(result.endingCashMinor).toBe(1_000_000);
    expect(result.endingBalanceMinor).toBe(502_513);
    expect(result.minimumCashMet).toBe(true);
  });

  it("reports the truth when the facility limit caps the draw short of the minimum", () => {
    const result = computeRevolverSweep({
      ...BASE,
      interestRateBps: 50,
      facilityLimitMinor: 400_000,
      currentBalanceMinor: 100_000,
    });
    expect(result.drawMinor).toBe(400_000);
    expect(result.interestMinor).toBe(2_000);
    expect(result.endingCashMinor).toBe(898_000); // 5,000 + 4,000 − 20
    expect(result.endingBalanceMinor).toBe(500_000); // prior 1,000 + draw 4,000
    expect(result.minimumCashMet).toBe(false);
  });

  it("applies the draw floor above the computed requirement", () => {
    const result = computeRevolverSweep({ ...BASE, interestRateBps: 50, floorMinor: 600_000 });
    expect(result.drawMinor).toBe(600_000);
    expect(result.interestMinor).toBe(3_000);
    expect(result.endingCashMinor).toBe(1_097_000); // 5,000 + 6,000 − 30
    expect(result.minimumCashMet).toBe(true);
  });

  it("sweeps excess cash back to the facility, repaying the full balance when it fits", () => {
    const result = computeRevolverSweep({
      ...BASE,
      cashBeforeDrawMinor: 2_000_000, // 20,000.00
      interestRateBps: 0,
      currentBalanceMinor: 750_000, // 7,500.00
      targetCashMinor: 1_000_000,
    });
    expect(result).toEqual({
      rule: "excess_cash_sweep",
      drawMinor: 0,
      repayMinor: 750_000,
      interestMinor: 0,
      endingCashMinor: 1_250_000,
      endingBalanceMinor: 0,
      minimumCashMet: true,
    });
  });

  it("caps the excess sweep at the outstanding balance (repays only the excess)", () => {
    const result = computeRevolverSweep({
      ...BASE,
      cashBeforeDrawMinor: 2_000_000,
      interestRateBps: 0,
      currentBalanceMinor: 2_000_000,
      targetCashMinor: 1_000_000,
    });
    expect(result.rule).toBe("excess_cash_sweep");
    expect(result.repayMinor).toBe(1_000_000);
    expect(result.endingCashMinor).toBe(1_000_000);
    expect(result.endingBalanceMinor).toBe(1_000_000);
  });

  it("does nothing when cash is between the minimum and the target (or no target is set)", () => {
    const result = computeRevolverSweep({
      ...BASE,
      cashBeforeDrawMinor: 1_500_000,
      interestRateBps: 0,
      currentBalanceMinor: 123_000,
    });
    expect(result).toEqual({
      rule: "none",
      drawMinor: 0,
      repayMinor: 0,
      interestMinor: 0,
      endingCashMinor: 1_500_000,
      endingBalanceMinor: 123_000,
      minimumCashMet: true,
    });
    // Exactly at the target is not an excess (strict >).
    const atTarget = computeRevolverSweep({
      ...BASE,
      cashBeforeDrawMinor: 1_500_000,
      interestRateBps: 0,
      currentBalanceMinor: 123_000,
      targetCashMinor: 1_500_000,
    });
    expect(atTarget.rule).toBe("none");
  });

  it("rejects out-of-range parameters with VALUE_INVALID", () => {
    expect(() => computeRevolverSweep({ ...BASE, interestRateBps: 10_000 })).toThrow(
      /VALUE_INVALID: interestRateBps/,
    );
    expect(() => computeRevolverSweep({ ...BASE, interestRateBps: -1 })).toThrow(
      /VALUE_INVALID: interestRateBps/,
    );
    expect(() => computeRevolverSweep({ ...BASE, floorMinor: 3_000_000 })).toThrow(
      /VALUE_INVALID: floorMinor/,
    );
    expect(() =>
      computeRevolverSweep({
        ...BASE,
        cashBeforeDrawMinor: 2_000_000,
        targetCashMinor: 500_000, // below the required minimum
      }),
    ).toThrow(/VALUE_INVALID: targetCashMinor/);
    expect(() => computeRevolverSweep({ ...BASE, interestRateBps: 0.5 })).toThrow(
      /VALUE_INVALID: interestRateBps/,
    );
  });
});
