import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Calendar fixture integrity (TEST-FIXTURES-SPEC §1 calendar/; matrix F-003).
 * Sandbox-runnable checks of the fixture FILES themselves (parse + internal
 * consistency). Engine parity (fixture ↔ build_week_based) is asserted by the
 * cargo tests `fixture_nrf_454_2024_2028_matches_engine` /
 * `fixture_nrf_{544,3334}_satisfies_invariants` (CI — no cargo in sandbox).
 */
const DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/calendar",
);

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(DIR, name), "utf8")) as Record<string, unknown>;
}

const DAY = 86_400_000;

describe("tests/fixtures/calendar", () => {
  it("nrf-454-2024-2028: five years, consecutive starts, [52,52,52,52,53]", () => {
    const f = load("nrf-454-2024-2028.json");
    const years = f.years as {
      fy_label: string;
      start_date: string;
      end_date: string;
      week_count: number;
      period_count: number;
    }[];
    expect(years.map((y) => y.week_count)).toEqual([52, 52, 52, 52, 53]);
    expect(years.map((y) => y.period_count)).toEqual([12, 12, 12, 12, 12]);
    // Consecutive years: next start = prev end + 1 day.
    for (let i = 1; i < years.length; i++) {
      const prevEnd = Date.parse(years[i - 1].end_date);
      const nextStart = Date.parse(years[i].start_date);
      expect(nextStart - prevEnd).toBe(DAY);
    }
    // Each year spans week_count*7 days.
    for (const y of years) {
      const days = Date.parse(y.end_date) - Date.parse(y.start_date) + DAY;
      expect(days).toBe(y.week_count * 7 * DAY);
    }
    // FY2028 carries the 53rd-week absorption note on P12.
    const y28 = years[4] as (typeof years)[number] & {
      fifty_third_period: { period_no: number; code: string } | null;
    };
    expect(y28.fifty_third_period).toMatchObject({ period_no: 12, code: "P12" });
    // W53 variant dates are a full week.
    const w53 = (f.full_week_variant_2028 as { w53: { start_date: string; end_date: string } }).w53;
    expect(Date.parse(w53.end_date) - Date.parse(w53.start_date)).toBe(6 * DAY);
  });

  it("nrf-544-expected: structural invariants are self-consistent", () => {
    const f = load("nrf-544-expected.json") as {
      preset: string;
      invariants: {
        quarter_week_pattern: number[];
        periods_52_week_year: number;
        period_codes_52: string[];
        fifty_third_week: { behavior: string; w53_code: string };
      };
    };
    expect(f.preset).toBe("544");
    expect(f.invariants.quarter_week_pattern).toEqual([5, 4, 4]);
    expect(f.invariants.periods_52_week_year).toBe(12);
    expect(f.invariants.period_codes_52).toHaveLength(12);
    expect(f.invariants.period_codes_52[11]).toBe("P12");
    // 53w years append an explicit W53 (4-day absorption is 4-5-4 exclusive).
    expect(f.invariants.fifty_third_week.w53_code).toBe("W53");
    expect(f.invariants.fifty_third_week.behavior).toContain("W53");
  });

  it("nrf-3334-expected: 13-period structural invariants are self-consistent", () => {
    const f = load("nrf-3334-expected.json") as {
      preset: string;
      invariants: {
        periods_per_quarter: number[];
        periods_total: number;
        weeks_per_period_52_week_year: number;
        period_codes: string[];
      };
    };
    expect(f.preset).toBe("3334");
    expect(f.invariants.periods_per_quarter).toEqual([3, 3, 3, 4]);
    expect(f.invariants.periods_per_quarter.reduce((a, b) => a + b, 0)).toBe(
      f.invariants.periods_total,
    );
    expect(f.invariants.periods_total).toBe(13);
    expect(f.invariants.weeks_per_period_52_week_year).toBe(4); // 13 x 4 = 52
    expect(f.invariants.period_codes).toHaveLength(13);
    expect(f.invariants.period_codes[12]).toBe("P13");
  });
});
