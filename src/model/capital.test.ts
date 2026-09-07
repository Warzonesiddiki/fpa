import { describe, expect, it } from "vitest";
import {
  calculateCovenants,
  calculateDebtFacility,
  calculateDepreciationPreview,
  calculateWorkingCapitalImpact,
  generate13WeekCashFlow,
  isValidIsoDate,
  validateCapitalProject,
  type CapitalProject,
  type DebtFacility,
} from "./capital";

/** Baseline valid project (SL, exact division). */
const PROJECT: CapitalProject = {
  id: "cp-1",
  name: "Line extension",
  asset_class: "Machinery",
  in_service_date: "2026-04-01",
  depreciation_start_date: "2026-04-01",
  life_years: 10,
  method: "SL",
  capex_minor: 1_200_000,
};

describe("model/capital — exact money, no floats (F-017 · S-046)", () => {
  describe("isValidIsoDate", () => {
    it("accepts real calendar dates and rejects malformed or impossible dates", () => {
      expect(isValidIsoDate("2026-04-01")).toBe(true);
      expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
      expect(isValidIsoDate("2026-2-1")).toBe(false); // not zero-padded
      expect(isValidIsoDate("2026-04-32")).toBe(false); // impossible day
      expect(isValidIsoDate("2026-02-30")).toBe(false); // impossible day (rolls over)
      expect(isValidIsoDate("04/01/2026")).toBe(false); // wrong format
      expect(isValidIsoDate("")).toBe(false);
    });
  });

  describe("validateCapitalProject", () => {
    it("accepts depreciation starting on or after the in-service date", () => {
      expect(validateCapitalProject(PROJECT)).toBeNull();
      expect(
        validateCapitalProject({ ...PROJECT, depreciation_start_date: "2026-07-01" }),
      ).toBeNull();
    });

    it("rejects depreciation starting before the in-service date with CAPEX_IN_SERVICE_INVALID", () => {
      const out = validateCapitalProject({
        ...PROJECT,
        depreciation_start_date: "2026-03-31",
      });
      expect(out?.code).toBe("CAPEX_IN_SERVICE_INVALID");
    });

    it("rejects malformed dates with CAPEX_IN_SERVICE_INVALID", () => {
      expect(validateCapitalProject({ ...PROJECT, in_service_date: "2026-13-01" })?.code).toBe(
        "CAPEX_IN_SERVICE_INVALID",
      );
      expect(
        validateCapitalProject({ ...PROJECT, depreciation_start_date: "not-a-date" })?.code,
      ).toBe("CAPEX_IN_SERVICE_INVALID");
    });
  });

  describe("calculateDepreciationPreview", () => {
    it("SL divides capex evenly over life in months with HALF_UP minor rounding", () => {
      const out = calculateDepreciationPreview(PROJECT);
      expect(out.monthly_depreciation_minor).toBe(10_000); // 1.2M / 120
      expect(out.accumulated_first_year_minor).toBe(120_000);
      expect(out.monthly_depreciation_decimal).toBe("10000");
    });

    it("SL rounds repeating decimals exactly (100 over 24 months)", () => {
      const out = calculateDepreciationPreview({
        ...PROJECT,
        life_years: 2,
        capex_minor: 100,
      });
      expect(out.monthly_depreciation_minor).toBe(4); // 4.1667 → 4
      expect(out.monthly_depreciation_decimal).toBe("4.17");
      expect(out.accumulated_first_year_minor).toBe(50);
    });

    it("DDB applies double rate on capex for year one, then /12", () => {
      const out = calculateDepreciationPreview({
        ...PROJECT,
        method: "DDB",
        life_years: 6,
        capex_minor: 1_200,
      });
      // year 1 = 1200 × (2/6) = 400; monthly = 33.33…
      expect(out.accumulated_first_year_minor).toBe(400);
      expect(out.monthly_depreciation_minor).toBe(33);
      expect(out.monthly_depreciation_decimal).toBe("33.33");
    });

    it("UNITS depreciates by monthly_units / total_units share", () => {
      const out = calculateDepreciationPreview({
        ...PROJECT,
        method: "UNITS",
        capex_minor: 1_000,
        total_units: 400,
        monthly_units: 50,
      });
      expect(out.monthly_depreciation_minor).toBe(125); // 1000 × 50/400
      expect(out.accumulated_first_year_minor).toBe(1_500);
    });

    it("UNITS with zero monthly units depreciates nothing", () => {
      const out = calculateDepreciationPreview({
        ...PROJECT,
        method: "UNITS",
        capex_minor: 1_000,
        total_units: 400,
        monthly_units: 0,
      });
      expect(out.monthly_depreciation_minor).toBe(0);
      expect(out.accumulated_first_year_minor).toBe(0);
      expect(out.monthly_depreciation_decimal).toBe("0");
    });

    it("returns zeros for zero capex or non-positive life", () => {
      const zero = calculateDepreciationPreview({ ...PROJECT, capex_minor: 0 });
      expect(zero).toEqual({
        monthly_depreciation_minor: 0,
        accumulated_first_year_minor: 0,
        monthly_depreciation_decimal: "0.00",
      });
      const noLife = calculateDepreciationPreview({ ...PROJECT, life_years: 0 });
      expect(noLife.monthly_depreciation_minor).toBe(0);
    });
  });

  describe("calculateDebtFacility", () => {
    const TERM: DebtFacility = {
      id: "df-1",
      name: "Term loan",
      facility_type: "Term",
      interest_rate_bps: 650,
      opening_balance_minor: 1_000_000,
      drawdowns_minor: 500_000,
      repayments_minor: 200_000,
    };

    it("computes closing balance and HALF_UP interest on the closing balance", () => {
      const out = calculateDebtFacility(TERM);
      expect(out.closing_balance_minor).toBe(1_300_000);
      expect(out.annual_interest_minor).toBe(84_500); // 1.3M × 6.5%
      expect(out.monthly_interest_minor).toBe(7_042); // 84500/12 = 7041.67
      expect(out.is_overdrawn).toBe(false);
    });

    it("charges no interest when the closing balance is zero or negative", () => {
      const zero = calculateDebtFacility({ ...TERM, repayments_minor: 1_500_000 });
      expect(zero.closing_balance_minor).toBe(0);
      expect(zero.annual_interest_minor).toBe(0);
      expect(zero.monthly_interest_minor).toBe(0);
    });

    it("flags DEBT_SCHEDULE_OVERDRAWN when repayments exceed availability", () => {
      const out = calculateDebtFacility({
        ...TERM,
        repayments_minor: 1_600_000, // > 1.5M available
      });
      expect(out.closing_balance_minor).toBeLessThan(0);
      expect(out.is_overdrawn).toBe(true);
    });

    it("flags a Revolver over its credit limit but not within it", () => {
      const revolver = {
        ...TERM,
        facility_type: "Revolver" as const,
        credit_limit_minor: 1_000_000,
      };
      expect(calculateDebtFacility(revolver).is_overdrawn).toBe(true); // 1.3M > 1.0M
      expect(
        calculateDebtFacility({ ...revolver, credit_limit_minor: 2_000_000 }).is_overdrawn,
      ).toBe(false);
    });

    it("a Revolver without a limit is only overdrawn below zero", () => {
      const noLimit = { ...TERM, facility_type: "Revolver" as const };
      expect(calculateDebtFacility(noLimit).is_overdrawn).toBe(false);
    });
  });

  describe("calculateWorkingCapitalImpact", () => {
    it("derives AR/AP/Inventory from DSO/DPO/DIO over 365 exact days", () => {
      const out = calculateWorkingCapitalImpact({
        dso_days: 30,
        dpo_days: 40,
        dio_days: 50,
        annual_revenue_minor: 36_500_000,
        annual_cogs_minor: 18_250_000,
      });
      expect(out.ar_balance_minor).toBe(3_000_000); // 36.5M × 30/365
      expect(out.ap_balance_minor).toBe(2_000_000); // 18.25M × 40/365
      expect(out.inventory_balance_minor).toBe(2_500_000); // 18.25M × 50/365
      expect(out.net_working_capital_minor).toBe(3_500_000); // AR + Inv − AP
      expect(out.operating_cash_flow_impact_minor).toBe(14_750_000); // Rev − COGS − NWC
    });

    it("zero drivers yield zero balances and OCF equal to revenue less COGS", () => {
      const out = calculateWorkingCapitalImpact({
        dso_days: 0,
        dpo_days: 0,
        dio_days: 0,
        annual_revenue_minor: 10_000,
        annual_cogs_minor: 4_000,
      });
      expect(out.net_working_capital_minor).toBe(0);
      expect(out.operating_cash_flow_impact_minor).toBe(6_000);
    });
  });

  describe("generate13WeekCashFlow", () => {
    it("chains closing → next opening across all 13 weeks with labels", () => {
      const schedule = generate13WeekCashFlow(100, [10, 0], [5, 0], [0, 2]);
      expect(schedule).toHaveLength(13);
      expect(schedule[0]).toMatchObject({
        week_num: 1,
        week_label: "W01",
        opening_cash_minor: 100,
        receipts_minor: 10,
        disbursements_minor: 5,
        financing_minor: 0,
        closing_cash_minor: 105,
      });
      expect(schedule[1].opening_cash_minor).toBe(105);
      expect(schedule[1].closing_cash_minor).toBe(107); // +2 financing
      expect(schedule[12].week_label).toBe("W13");
      // Weeks 3..13 have no entries → all zeros, balance frozen at 107
      expect(schedule[12].closing_cash_minor).toBe(107);
      expect(schedule[12].receipts_minor).toBe(0);
    });

    it("handles a negative opening cash position without special casing", () => {
      const schedule = generate13WeekCashFlow(-50, [100], [25], []);
      expect(schedule[0].closing_cash_minor).toBe(25);
    });
  });

  describe("calculateCovenants", () => {
    it("passes exactly at the 3.5x / 2.5x boundaries (strict inequalities)", () => {
      // netDebt 2.5M / ebitda 1M = exactly 2.5x? No: 2.5 ≤ 3.5 → pass. Cover exactly 2.5.
      const out = calculateCovenants(3_000_000, 500_000, 1_000_000, 400_000);
      expect(out.net_debt_minor).toBe(2_500_000);
      expect(out.net_debt_to_ebitda).toBe("2.5");
      expect(out.net_debt_breached).toBe(false);
      expect(out.interest_cover).toBe("2.5");
      expect(out.interest_cover_breached).toBe(false);
      expect(out.is_breached).toBe(false);
    });

    it("breaches when net debt / EBITDA exceeds 3.5x", () => {
      const out = calculateCovenants(4_000_000, 0, 1_000_000, 400_000);
      expect(out.net_debt_to_ebitda).toBe("4");
      expect(out.net_debt_breached).toBe(true);
      expect(out.is_breached).toBe(true);
    });

    it("breaches when interest cover falls below 2.5x", () => {
      const out = calculateCovenants(2_000_000, 500_000, 1_000_000, 800_000);
      expect(out.interest_cover).toBe("1.25");
      expect(out.interest_cover_breached).toBe(true);
      expect(out.is_breached).toBe(true);
    });

    it("EBITDA of zero with debt is an automatic breach (> 99.00)", () => {
      const out = calculateCovenants(1_000_000, 0, 0, 100_000);
      expect(out.net_debt_to_ebitda).toBe("> 99.00");
      expect(out.net_debt_breached).toBe(true);
      expect(out.interest_cover).toBe("0");
      expect(out.interest_cover_breached).toBe(true);
    });

    it("EBITDA of zero with no debt only breaches cover", () => {
      const out = calculateCovenants(0, 0, 0, 0);
      expect(out.net_debt_to_ebitda).toBe("0.00");
      expect(out.net_debt_breached).toBe(false);
      expect(out.interest_cover).toBe("0.00");
      expect(out.interest_cover_breached).toBe(true);
    });

    it("no interest expense with positive EBITDA is full cover (99.00), not a breach", () => {
      const out = calculateCovenants(1_000_000, 0, 1_000_000, 0);
      expect(out.interest_cover).toBe("99.00");
      expect(out.interest_cover_breached).toBe(false);
      expect(out.is_breached).toBe(false); // 1.0x ≤ 3.5x
    });
  });
});
