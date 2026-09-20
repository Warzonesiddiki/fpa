/**
 * dayCount — AUDIT-20 day-count convention engine tests (MODELING-METHODS-SPEC §2).
 *
 * Every calendar day count is an independently hand-verified exact integer (the core oracle).
 * Year fractions and interest are exact `decimal.js` derivations of those days, asserted against
 * the same exact computation. Money discipline: no float, no locale, `money:ast`-clean.
 */
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  actualDaysBetween,
  accrualDays,
  accrueInterest,
  daysInMonth,
  denominatorFor,
  isLeapYear,
  parseIsoDate,
  yearFraction,
  DAY_COUNT_CONVENTIONS,
  type DayCountConvention,
} from "./dayCount";

/** Expected year-fraction string (exact, same Decimal precision the engine sets on import). */
const frac = (days: number, denom: number) =>
  new Decimal(days).dividedBy(new Decimal(denom)).toString();
/** Expected exact interest = principal × rate × days / denom. */
const interest = (p: string, r: string, days: number, denom: number) =>
  new Decimal(p)
    .times(new Decimal(r))
    .times(new Decimal(days))
    .dividedBy(new Decimal(denom))
    .toString();

describe("parseIsoDate — valid dates", () => {
  it("parses zero-padded ISO dates into integer parts", () => {
    expect(parseIsoDate("2026-01-15")).toEqual({ year: 2026, month: 1, day: 15 });
    expect(parseIsoDate("2000-02-29")).toEqual({ year: 2000, month: 2, day: 29 }); // leap
    expect(parseIsoDate("1900-12-31")).toEqual({ year: 1900, month: 12, day: 31 });
  });

  it("accepts Feb 29 only on leap years", () => {
    expect(parseIsoDate("2024-02-29")).not.toBeNull(); // 2024 leap
    expect(parseIsoDate("2000-02-29")).not.toBeNull(); // century leap (div 400)
    expect(parseIsoDate("2026-02-29")).toBeNull(); // not a leap year
    expect(parseIsoDate("1900-02-29")).toBeNull(); // century non-leap (div 100, not 400)
  });
});

describe("parseIsoDate — invalid / malformed dates (all → null)", () => {
  const invalid = [
    "2026-02-30", // no Feb 30
    "2026-04-31", // April has 30
    "2026-06-31", // June has 30
    "2026-09-31", // September has 30
    "2026-11-31", // November has 30
    "2026-13-01", // month 13
    "2026-00-10", // month 0
    "2026-01-00", // day 0
    "2026-01-32", // day 32
    "2026-01-1", // not zero-padded
    "26-01-01", // 2-digit year
    "2026/01/01", // wrong separator
    "2026-01-01T00:00:00", // datetime, not a date
    "2026-01-01 ", // trailing space
    " 2026-01-01", // leading space
    "01/15/2026", // US order
    "2026-1-1", // unpadded
    "", // empty
    "not-a-date", // junk
    "0000-01-01", // year 0 (Gregorian defined for year ≥ 1)
    "2026-01-001", // too many day digits
  ];
  it.each(invalid)("%j", (value) => {
    expect(parseIsoDate(value)).toBeNull();
  });
});

describe("isLeapYear — Gregorian rule (div 4, not 100 unless 400)", () => {
  const leap = [2024, 2000, 2400, 1904, 2044, 1600, 4, 8];
  const common = [2023, 2026, 1900, 2100, 2022, 1999, 2019];
  it.each(leap.map((y) => [y]))("year %i is a leap year", (y) => {
    expect(isLeapYear(y)).toBe(true);
  });
  it.each(common.map((y) => [y]))("year %i is a common year", (y) => {
    expect(isLeapYear(y)).toBe(false);
  });
});

describe("daysInMonth", () => {
  it("gives the common-year calendar", () => {
    const common = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m += 1) expect(daysInMonth(2026, m)).toBe(common[m - 1]);
  });
  it("gives 29 only for February of a leap year", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29); // century leap
    expect(daysInMonth(1900, 2)).toBe(28); // century non-leap
  });
});

describe("actualDaysBetween — exact calendar days (hand-verified)", () => {
  it("single-day and same-day", () => {
    expect(actualDaysBetween("2026-01-01", "2026-01-02")).toBe(1);
    expect(actualDaysBetween("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("month spans (common year)", () => {
    expect(actualDaysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(actualDaysBetween("2026-01-01", "2026-02-01")).toBe(31);
    expect(actualDaysBetween("2026-01-31", "2026-02-28")).toBe(28);
    expect(actualDaysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(actualDaysBetween("2026-03-01", "2026-03-31")).toBe(30);
  });

  it("February length tracks the leap year", () => {
    expect(actualDaysBetween("2024-02-01", "2024-03-01")).toBe(29); // leap
    expect(actualDaysBetween("2023-02-01", "2023-03-01")).toBe(28); // common
    expect(actualDaysBetween("2000-02-28", "2000-03-01")).toBe(2); // century leap
    expect(actualDaysBetween("1900-02-28", "1900-03-01")).toBe(1); // century non-leap
  });

  it("full years", () => {
    expect(actualDaysBetween("2023-01-01", "2024-01-01")).toBe(365); // common
    expect(actualDaysBetween("2024-01-01", "2025-01-01")).toBe(366); // leap
    expect(actualDaysBetween("2020-01-01", "2023-01-01")).toBe(1096); // 366 + 365 + 365
  });

  it("multi-decade span (1970 → 2026 = 56 years, 14 leap days)", () => {
    expect(actualDaysBetween("1970-01-01", "2026-01-01")).toBe(56 * 365 + 14); // 20454
  });

  it("is signed (end before start is negative)", () => {
    expect(actualDaysBetween("2026-01-31", "2026-01-01")).toBe(-30);
    expect(actualDaysBetween("2024-01-01", "2023-01-01")).toBe(-365);
  });
});

describe("accrualDays — ACT/360 and ACT/365 use true calendar days", () => {
  it("ACT_360", () => {
    expect(accrualDays("2026-01-01", "2026-02-01", "ACT_360")).toBe(31);
    expect(accrualDays("2023-01-01", "2024-01-01", "ACT_360")).toBe(365);
    expect(accrualDays("2024-01-01", "2025-01-01", "ACT_360")).toBe(366);
  });
  it("ACT_365", () => {
    expect(accrualDays("2026-01-01", "2026-02-01", "ACT_365")).toBe(31);
    expect(accrualDays("2023-01-01", "2024-01-01", "ACT_365")).toBe(365);
  });
});

describe("accrualDays — 30/360 US (Bond Basis): the 31st-day rules", () => {
  it("normal 30/360 months are 30", () => {
    expect(accrualDays("2026-01-15", "2026-02-15", "THIRTY_360_US")).toBe(30);
    expect(accrualDays("2026-01-01", "2026-02-01", "THIRTY_360_US")).toBe(30);
  });
  it("a 31st start-day counts as 30", () => {
    expect(accrualDays("2026-01-31", "2026-02-28", "THIRTY_360_US")).toBe(28); // d1 31→30, d2 28
  });
  it("a 31st end-day is 30 only when the start-day was 30 or 31", () => {
    expect(accrualDays("2026-01-31", "2026-03-31", "THIRTY_360_US")).toBe(60); // both clamped
    expect(accrualDays("2026-05-31", "2026-08-31", "THIRTY_360_US")).toBe(90); // 3 months
  });
  it("a 31st end-day is kept when the start-day is below 30", () => {
    expect(accrualDays("2026-01-15", "2026-03-31", "THIRTY_360_US")).toBe(76); // d2 stays 31
    expect(accrualDays("2026-02-28", "2026-05-31", "THIRTY_360_US")).toBe(93); // 90 + (31-28)
  });
  it("a full 30/360 year is exactly 360", () => {
    expect(accrualDays("2026-01-31", "2027-01-31", "THIRTY_360_US")).toBe(360);
    expect(accrualDays("2026-01-15", "2027-01-15", "THIRTY_360_US")).toBe(360);
    expect(accrualDays("2020-01-31", "2022-01-31", "THIRTY_360_US")).toBe(720); // 2 years
  });
});

describe("accrualDays — 30/360 ISDA (Eurobond): a 31st end-day is always 30", () => {
  it("clamps a 31st end-day unconditionally (differs from US Bond Basis)", () => {
    // Start-day 15 (< 30): US keeps d2=31 (76), ISDA clamps d2=30 (75).
    expect(accrualDays("2026-01-15", "2026-03-31", "THIRTY_360_ISDA")).toBe(75);
    expect(accrualDays("2026-01-15", "2026-03-31", "THIRTY_360_US")).toBe(76);
  });
  it("agrees with US when the start-day is 30/31", () => {
    expect(accrualDays("2026-01-31", "2026-03-31", "THIRTY_360_ISDA")).toBe(60);
    expect(accrualDays("2026-05-31", "2026-08-31", "THIRTY_360_ISDA")).toBe(90);
  });
});

describe("yearFraction — exact values", () => {
  it("reports the exact integer days and the convention denominator", () => {
    const r = yearFraction("2026-01-01", "2026-02-01", "ACT_360");
    expect(r.days).toBe(31);
    expect(r.denominator).toBe(360);
    expect(r.yearFraction).toBe(frac(31, 360));
  });

  it("ACT_365 over a 365-day year is exactly 1", () => {
    expect(yearFraction("2023-01-01", "2024-01-01", "ACT_365").yearFraction).toBe("1");
  });

  it("ACT_360 over a 365-day year is exactly 365/360 (the ~1.39% understatement source)", () => {
    const r = yearFraction("2023-01-01", "2024-01-01", "ACT_360");
    expect(r.days).toBe(365);
    expect(r.yearFraction).toBe(frac(365, 360));
    // Naive annual/12 accrues 360 days (1.0); ACT/360 accrues 365/360 — an excess of 5/360.
    expect(new Decimal(r.yearFraction).gt("1")).toBe(true);
  });

  it("30/360 over a full 30/360 year is exactly 1", () => {
    expect(yearFraction("2026-01-31", "2027-01-31", "THIRTY_360_US").yearFraction).toBe("1");
  });

  it("a 30-day month under 30/360 is exactly 1/12", () => {
    expect(yearFraction("2026-01-01", "2026-02-01", "THIRTY_360_US").yearFraction).toBe(
      frac(30, 360),
    );
  });
});

describe("accrueInterest — exact decimal (principal × rate × days / denom)", () => {
  it("ACT_360 on a 31-day month", () => {
    const got = accrueInterest("1000000", "0.055", "2026-01-01", "2026-02-01", "ACT_360");
    expect(got).toBe(interest("1000000", "0.055", 31, 360)); // 55000 × 31/360
  });

  it("30/360 accrues 30 days, not 31, for the same calendar period", () => {
    const a360 = accrueInterest("1000000", "0.055", "2026-01-01", "2026-02-01", "ACT_360");
    const t360 = accrueInterest("1000000", "0.055", "2026-01-01", "2026-02-01", "THIRTY_360_US");
    // The convention changes the accrued amount for the identical calendar span.
    expect(new Decimal(a360).gt(t360)).toBe(true);
    expect(t360).toBe(interest("1000000", "0.055", 30, 360)); // 55000/12
  });

  it("zero duration accrues exactly zero", () => {
    expect(accrueInterest("1000000", "0.055", "2026-01-01", "2026-01-01", "ACT_360")).toBe("0");
  });

  it("zero rate accrues exactly zero", () => {
    expect(accrueInterest("1000000", "0", "2026-01-01", "2026-12-31", "ACT_360")).toBe("0");
  });
});

describe("the AUDIT-20 ~1.39% understatement — exact mechanism", () => {
  it("naive annual/12 accrues 360 days; ACT/360 accrues the true 365 (a 365-day year)", () => {
    const act = yearFraction("2023-01-01", "2024-01-01", "ACT_360");
    // The naive assumption is 12 × 30 = 360 days → yearFraction 1.0. ACT/360 uses 365.
    expect(act.days).toBe(365);
    // Excess of ACT/360 over the naive 360-day assumption is exactly 5/360 (≈ 1.388…%).
    const excessOverNaive = new Decimal(365).minus(360).dividedBy(new Decimal(360)); // 5/360
    expect(excessOverNaive.toDecimalPlaces(4).toString()).toBe("0.0139");
  });
});

describe("validation — locked VALUE_INVALID", () => {
  it.each([
    ["2026-02-30", "2026-03-01"],
    ["2026-01-01", "bad"],
    ["not-a-date", "2026-01-01"],
    ["2026-13-01", "2026-12-31"],
  ])("rejects an invalid date %j", (a, b) => {
    expect(() => actualDaysBetween(a, b)).toThrow(/VALUE_INVALID/);
    expect(() => accrualDays(a, b, "ACT_360")).toThrow(/VALUE_INVALID/);
    expect(() => yearFraction(a, b, "ACT_360")).toThrow(/VALUE_INVALID/);
  });

  it("rejects a non-decimal principal/rate", () => {
    expect(() => accrueInterest("1e6", "0.055", "2026-01-01", "2026-02-01", "ACT_360")).toThrow(
      /VALUE_INVALID/,
    );
    expect(() => accrueInterest("1000000", "USD 5", "2026-01-01", "2026-02-01", "ACT_360")).toThrow(
      /VALUE_INVALID/,
    );
  });

  it("rejects an unknown convention (runtime guard for untyped IPC input)", () => {
    expect(() =>
      accrualDays("2026-01-01", "2026-01-02", "ACT/360" as unknown as DayCountConvention),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      yearFraction("2026-01-01", "2026-01-02", "" as unknown as DayCountConvention),
    ).toThrow(/VALUE_INVALID/);
    expect(() =>
      accrueInterest(
        "1000000",
        "0.055",
        "2026-01-01",
        "2026-01-02",
        "bogus" as unknown as DayCountConvention,
      ),
    ).toThrow(/VALUE_INVALID/);
  });

  it("exposes the complete, stable set of conventions", () => {
    expect(DAY_COUNT_CONVENTIONS).toEqual([
      "ACT_360",
      "ACT_365",
      "THIRTY_360_US",
      "THIRTY_360_ISDA",
    ]);
    for (const c of DAY_COUNT_CONVENTIONS)
      expect(denominatorFor(c as DayCountConvention)).toBeGreaterThanOrEqual(360);
  });
});

describe("invariants (property)", () => {
  const spans: Array<[string, string]> = [
    ["2026-01-01", "2026-12-31"],
    ["2024-02-29", "2025-02-28"],
    ["1900-03-01", "2000-03-01"],
    ["2026-01-31", "2026-02-28"],
    ["2026-05-31", "2026-08-31"],
  ];
  const conventions: DayCountConvention[] = [
    "ACT_360",
    "ACT_365",
    "THIRTY_360_US",
    "THIRTY_360_ISDA",
  ];

  it("actualDaysBetween is antisymmetric (a→b = −(b→a))", () => {
    for (const [a, b] of spans) {
      expect(actualDaysBetween(a, b)).toBe(-actualDaysBetween(b, a));
    }
  });

  it("actualDaysBetween is additive (a→b + b→c = a→c)", () => {
    for (const [a, b] of spans) {
      for (const c of ["2027-06-30", "1999-01-15", "2026-06-15"]) {
        expect(actualDaysBetween(a, b) + actualDaysBetween(b, c)).toBe(actualDaysBetween(a, c));
      }
    }
  });

  it("yearFraction sign matches the day-count sign, for every convention", () => {
    for (const [a, b] of spans) {
      for (const conv of conventions) {
        const r = yearFraction(a, b, conv);
        const expectedSign = Math.sign(r.days);
        const d = new Decimal(r.yearFraction);
        const gotSign = d.isNegative() ? -1 : d.isZero() ? 0 : 1;
        expect(gotSign).toBe(expectedSign);
      }
    }
  });

  it("a same-date period is exactly 0 under every convention", () => {
    for (const conv of conventions) {
      expect(accrualDays("2026-07-15", "2026-07-15", conv)).toBe(0);
      expect(yearFraction("2026-07-15", "2026-07-15", conv).yearFraction).toBe("0");
    }
  });

  it("Actual/360 ≥ Actual/365 for any non-negative span (365 > 360 denominator)", () => {
    for (const [a, b] of spans) {
      if (actualDaysBetween(a, b) >= 0) {
        expect(
          new Decimal(yearFraction(a, b, "ACT_360").yearFraction).gte(
            yearFraction(a, b, "ACT_365").yearFraction,
          ),
        ).toBe(true);
      }
    }
  });
});
