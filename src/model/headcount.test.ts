import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  calculateHeadcountRollup,
  newHeadcountRowId,
  prorationLabel,
  validateHeadcountRows,
  type HeadcountPeriod,
  type HeadcountScheduleRow,
} from "./headcount";

const periods: HeadcountPeriod[] = [
  { id: "fp-2026-p01", code: "P01", start_date: "2026-04-01", end_date: "2026-04-30" },
  { id: "fp-2026-p02", code: "P02", start_date: "2026-05-01", end_date: "2026-05-31" },
  { id: "fp-2026-p03", code: "P03", start_date: "2026-06-01", end_date: "2026-06-30" },
];

function row(overrides: Partial<HeadcountScheduleRow> = {}): HeadcountScheduleRow {
  return {
    id: "hc-row-1",
    role: "Analyst",
    cost_center: "Finance",
    start_date: "2026-04-01",
    termination_date: null,
    base_comp_decimal: "1200.00",
    bonus_pct: "0",
    benefits_pct: "20",
    employer_load_pct: "0",
    ramp_months: 0,
    ...overrides,
  };
}

describe("Headcount schedule validation", () => {
  it("accepts an in-horizon schedule and rejects a hire before the first period", () => {
    expect(validateHeadcountRows([row()], periods)).toBeNull();
    const issue = validateHeadcountRows([row({ start_date: "2026-03-31" })], periods);
    expect(issue).toMatchObject({ code: "HC_DATE_INVALID" });
    expect(issue?.details).toMatchObject({ reason: "start_before_first_period" });
  });

  it("rejects malformed dates and termination before hire with typed date details", () => {
    expect(validateHeadcountRows([row({ start_date: "not-a-date" })], periods)).toMatchObject({
      code: "HC_DATE_INVALID",
      details: { reason: "not_an_iso_calendar_date" },
    });
    expect(
      validateHeadcountRows(
        [row({ start_date: "2026-05-01", termination_date: "2026-04-30" })],
        periods,
      ),
    ).toMatchObject({ code: "HC_DATE_INVALID", details: { reason: "termination_before_start" } });
    expect(
      validateHeadcountRows([row({ base_comp_decimal: "not-a-decimal" })], periods),
    ).toMatchObject({ code: "VALUE_INVALID", details: { reason: "invalid_schedule_row" } });
  });

  it("rejects same-role overlap in a fiscal period but permits sequential attrition", () => {
    const overlap = validateHeadcountRows(
      [
        row({ id: "hc-row-1", start_date: "2026-04-01" }),
        row({ id: "hc-row-2", start_date: "2026-04-15" }),
      ],
      periods,
    );
    expect(overlap).toMatchObject({
      code: "HC_OVERLAP",
      details: { period_id: "fp-2026-p01", row_ids: ["hc-row-1", "hc-row-2"] },
    });

    expect(
      validateHeadcountRows(
        [
          row({ id: "hc-row-1", termination_date: "2026-04-14" }),
          row({ id: "hc-row-2", start_date: "2026-04-15" }),
        ],
        periods,
      ),
    ).toBeNull();
  });
});

describe("Headcount period rollup", () => {
  it("prorates an exact decimal salary by active day count and benefits", () => {
    const result = calculateHeadcountRollup([row({ start_date: "2026-04-16" })], periods);
    expect(result[0]).toMatchObject({
      period_id: "fp-2026-p01",
      active_headcount: 1,
      total_cost_decimal: "240",
    });
    expect(result[0].members[0]).toMatchObject({
      active_days: 15,
      period_days: 30,
      proration: "0.5",
      cost_decimal: "240",
    });
    expect(prorationLabel(result[0].members[0])).toBe("15/30 (0.5)");
  });

  it("applies a linear ramp without using floating-point money math", () => {
    const result = calculateHeadcountRollup(
      [row({ base_comp_decimal: "1200", benefits_pct: "0", ramp_months: 2 })],
      periods,
    );
    expect(result.map((period) => period.total_cost_decimal)).toEqual(["200", "400", "400"]);
    expect(result[0].members[0].ramp_factor).toBe("0.5");
    expect(
      new Decimal(result.reduce((sum, p) => sum.plus(p.total_cost_decimal), new Decimal(0))).eq(
        "1000",
      ),
    ).toBe(true);
  });

  it("supports a 4-5-4 style period and exposes day-count denominators", () => {
    const retailPeriods: HeadcountPeriod[] = [
      { id: "fp-2027-p01", code: "P01", start_date: "2027-02-01", end_date: "2027-02-28" },
      { id: "fp-2027-p02", code: "P02", start_date: "2027-03-01", end_date: "2027-04-04" },
    ];
    const result = calculateHeadcountRollup(
      [row({ start_date: "2027-02-15", base_comp_decimal: "1300" })],
      retailPeriods,
    );
    expect(result[0].members[0]).toMatchObject({ active_days: 14, period_days: 28 });
    expect(result[1].members[0]).toMatchObject({ active_days: 35, period_days: 35 });
  });

  it("allocates a deterministic new row id around existing ids", () => {
    expect(newHeadcountRowId([])).toBe("hc-row-1");
    expect(newHeadcountRowId([{ ...row(), id: "hc-row-1" }])).toBe("hc-row-2");
    expect(
      newHeadcountRowId([
        { ...row(), id: "hc-row-1" },
        { ...row({ id: "hc-row-3" }), id: "hc-row-3" },
      ]),
    ).toBe("hc-row-2");
  });
});
