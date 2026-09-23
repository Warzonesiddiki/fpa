/**
 * Exhaustive AUDIT-12 / AUDIT-20 tests for the exact-decimal debt-interest & amortization engine.
 *
 * **Hand-verified references** (independent oracle):
 * 1. allInRateBps(SOFR 530, spread 200) = 730 bps.
 * 2. periodInterest 1,000,000 @ 550 bps (5.5%), 2024-01-01 → 2025-01-01 (366 days, leap 2024):
 *      ACT_360:      366 days → 55,000 × 366/360 = 55,916.67 → 55,917
 *      ACT_365:      366 days → 55,000 × 366/365 = 55,150.68 → 55,151
 *      THIRTY_360_US: 360 days → 55,000 × 360/360 = 55,000      → 55,000  (3 different results)
 * 3. levelPaymentAmortization(120000, 1200 bps, 4): r = 3%/period, level payment 32283;
 *      P1 3600 int / 28683 prin / 91317 bal · P2 2740 / 29543 / 61774 · P3 1853 / 30430 / 31344 ·
 *      P4 (plug) 940 / 31344 / 0. Totals: interest 9133, principal 120000, payment 129133, bal 0.
 * 4. pikAccrualSchedule(100000, 1200 bps, 4): 3000/3090/3183/3278 → ending 112551 = 100000 + 12551.
 *
 * **Invariants:** amortization ends at 0 and Σ principal === principal; PIK ending === principal +
 * accrued; the AUDIT-20 "debt test" — the same balance/rate/dates give DIFFERENT interest under
 * different conventions.
 */
import { describe, it, expect } from "vitest";
import {
  allInRateBps,
  periodInterest,
  levelPaymentAmortization,
  pikAccrualSchedule,
} from "./debtSchedule";
import type { DayCountConvention } from "./dayCount";

describe("allInRateBps (SOFR + credit spread)", () => {
  it("adds a floating benchmark (SOFR) to the credit spread", () => {
    expect(allInRateBps(530, 200)).toBe(730);
    expect(allInRateBps(400)).toBe(400); // no spread → benchmark only
  });
  it("rejects negative or non-integer basis points", () => {
    expect(() => allInRateBps(-1)).toThrow(/VALUE_INVALID/);
    expect(() => allInRateBps(100, -5)).toThrow(/VALUE_INVALID/);
    expect(() => allInRateBps(100.5)).toThrow(/VALUE_INVALID/);
  });
});

describe("periodInterest (AUDIT-20 'debt test: Actual/360 interest exact')", () => {
  // 1,000,000 @ 5.5% (550 bps) for a full calendar year 2024 (a leap year, 366 actual days).
  const balance = 1_000_000;
  const rate = 550;
  const start = "2024-01-01";
  const end = "2025-01-01";

  it("ACT_360 accrues the true 366 days over a 360 basis (55,917)", () => {
    const r = periodInterest(balance, rate, start, end, "ACT_360");
    expect(r.days).toBe(366);
    expect(r.denominator).toBe(360);
    expect(r.interestMinor).toBe(55917);
  });
  it("ACT_365 accrues 366 days over a 365 basis (55,151)", () => {
    const r = periodInterest(balance, rate, start, end, "ACT_365");
    expect(r.days).toBe(366);
    expect(r.denominator).toBe(365);
    expect(r.interestMinor).toBe(55151);
  });
  it("THIRTY_360_US treats the full year as 360/360 = 1.0 (55,000, exact)", () => {
    const r = periodInterest(balance, rate, start, end, "THIRTY_360_US");
    expect(r.days).toBe(360);
    expect(r.yearFraction).toBe("1");
    expect(r.interestExact).toBe("55000");
    expect(r.interestMinor).toBe(55000);
  });
  it("AUDIT-20 acceptance: the 3 conventions produce DIFFERENT results", () => {
    const convs: DayCountConvention[] = ["ACT_360", "ACT_365", "THIRTY_360_US"];
    const results = convs.map((c) => periodInterest(balance, rate, start, end, c).interestMinor);
    // All three distinct, and ordered: ACT/360 (steepest) > ACT/365 > 30/360.
    expect(new Set(results).size).toBe(3);
    expect(results[0]).toBeGreaterThan(results[1]);
    expect(results[1]).toBeGreaterThan(results[2]);
  });
  it("composes with a SOFR all-in rate (530 SOFR + 200 spread = 730 bps)", () => {
    const allIn = allInRateBps(530, 200); // 730
    const r = periodInterest(1_000_000, allIn, "2024-01-01", "2024-01-31", "ACT_360"); // 30 days
    // 1,000,000 × 0.073 × 30/360 = 6,083.33… → 6,083
    expect(r.days).toBe(30);
    expect(r.interestMinor).toBe(6083);
  });
  it("rejects negative balance/rate and invalid dates", () => {
    expect(() => periodInterest(-1, 550, start, end, "ACT_360")).toThrow(/VALUE_INVALID/);
    expect(() => periodInterest(100, -1, start, end, "ACT_360")).toThrow(/VALUE_INVALID/);
    expect(() => periodInterest(100, 550, "2024-02-30", end, "ACT_360")).toThrow(/VALUE_INVALID/);
  });
});

describe("levelPaymentAmortization (exact annuity, ties out to 0)", () => {
  it("120000 @ 12% quarterly (r=3%/period): level payment 32283, P1 interest 3600", () => {
    const s = levelPaymentAmortization(120000, 1200, 4);
    expect(s.levelPaymentMinor).toBe(32283);
    expect(s.rows.map((r) => r.interestMinor)).toEqual([3600, 2740, 1853, 940]);
    expect(s.rows.map((r) => r.principalMinor)).toEqual([28683, 29543, 30430, 31344]);
    expect(s.rows.map((r) => r.balanceMinor)).toEqual([91317, 61774, 31344, 0]);
    expect(s.totalInterestMinor).toBe(9133);
    expect(s.totalPrincipalMinor).toBe(120000);
    expect(s.totalPaymentMinor).toBe(129133);
    expect(s.endingBalanceMinor).toBe(0);
  });
  it("front-loads interest: P1 > P2 > P3 > P4", () => {
    const s = levelPaymentAmortization(120000, 1200, 4);
    const i = s.rows.map((r) => r.interestMinor);
    expect(i[0]).toBeGreaterThan(i[1]);
    expect(i[1]).toBeGreaterThan(i[2]);
    expect(i[2]).toBeGreaterThan(i[3]);
  });
  it("the non-final payments are the constant level payment; the final is the plug", () => {
    const s = levelPaymentAmortization(120000, 1200, 4);
    expect(s.rows[0].paymentMinor).toBe(s.levelPaymentMinor);
    expect(s.rows[1].paymentMinor).toBe(s.levelPaymentMinor);
    expect(s.rows[2].paymentMinor).toBe(s.levelPaymentMinor);
    // Final payment = interest + residual principal (absorbs the rounding plug).
    expect(s.rows[3].paymentMinor).toBe(s.rows[3].interestMinor + s.rows[3].principalMinor);
  });
  it("zero rate amortizes the principal evenly (120000 / 4 = 30000, no interest)", () => {
    const s = levelPaymentAmortization(120000, 0, 4);
    expect(s.levelPaymentMinor).toBe(30000);
    expect(s.rows.map((r) => r.interestMinor)).toEqual([0, 0, 0, 0]);
    expect(s.rows.map((r) => r.balanceMinor)).toEqual([90000, 60000, 30000, 0]);
    expect(s.totalInterestMinor).toBe(0);
    expect(s.endingBalanceMinor).toBe(0);
  });
  it("ties out across a grid: ending balance 0 and Σ principal === principal", () => {
    const principals = [1, 100, 10000, 99999, 1_000_000];
    const rates = [0, 50, 300, 1200, 2400];
    const periods = [1, 2, 4, 12];
    for (const P of principals) {
      for (const rate of rates) {
        for (const n of periods) {
          const s = levelPaymentAmortization(P, rate, n);
          expect(s.endingBalanceMinor).toBe(0);
          expect(s.totalPrincipalMinor).toBe(P);
          expect(s.totalPaymentMinor).toBe(P + s.totalInterestMinor);
          // Balance never negative and non-increasing.
          for (let k = 0; k < s.rows.length; k += 1) {
            expect(s.rows[k].balanceMinor).toBeGreaterThanOrEqual(0);
            if (k > 0)
              expect(s.rows[k].balanceMinor).toBeLessThanOrEqual(s.rows[k - 1].balanceMinor);
          }
        }
      }
    }
  });
});

describe("pikAccrualSchedule (PIK compounds into principal)", () => {
  it("100000 @ 12% quarterly: 3000/3090/3183/3278 → ending 112551 = 100000 + 12551", () => {
    const s = pikAccrualSchedule(100000, 1200, 4);
    expect(s.rows.map((r) => r.interestMinor)).toEqual([3000, 3090, 3183, 3278]);
    expect(s.rows.map((r) => r.balanceMinor)).toEqual([103000, 106090, 109273, 112551]);
    expect(s.totalAccruedMinor).toBe(12551);
    expect(s.endingBalanceMinor).toBe(112551);
  });
  it("ending balance always equals principal + total accrued (tie-out)", () => {
    for (const P of [1, 10000, 99999, 1_000_000]) {
      for (const rate of [0, 100, 1200, 3000]) {
        for (const n of [1, 4, 12]) {
          const s = pikAccrualSchedule(P, rate, n);
          expect(s.endingBalanceMinor).toBe(P + s.totalAccruedMinor);
          // Balance never decreases (interest only adds).
          for (let k = 1; k < s.rows.length; k += 1) {
            expect(s.rows[k].balanceMinor).toBeGreaterThanOrEqual(s.rows[k - 1].balanceMinor);
          }
        }
      }
    }
  });
  it("zero rate accrues nothing", () => {
    const s = pikAccrualSchedule(100000, 0, 4);
    expect(s.totalAccruedMinor).toBe(0);
    expect(s.endingBalanceMinor).toBe(100000);
  });
});

describe("input validation (locked error codes)", () => {
  it("rejects negative principal/rate and periods < 1 (amortization + PIK)", () => {
    expect(() => levelPaymentAmortization(-1, 1200, 4)).toThrow(/VALUE_INVALID/);
    expect(() => levelPaymentAmortization(100, -1, 4)).toThrow(/VALUE_INVALID/);
    expect(() => levelPaymentAmortization(100, 1200, 0)).toThrow(/VALUE_INVALID/);
    expect(() => pikAccrualSchedule(-1, 1200, 4)).toThrow(/VALUE_INVALID/);
    expect(() => pikAccrualSchedule(100, 1200, 0)).toThrow(/VALUE_INVALID/);
  });
});
