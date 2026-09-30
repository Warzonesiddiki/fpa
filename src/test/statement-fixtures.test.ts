import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Decimal from "decimal.js";
import { largestRemainderAllocate } from "@/model/largestRemainder";

/**
 * Statement & Rounding Oracle fixture integrity (TEST-FIXTURES-SPEC §1 statements/ & §3; MONEY-ROUNDING-SPEC §3-5).
 * Validates the hand-computed and oracle statement fixtures:
 *   - pl_basic: Revenue - COGS = Gross Profit, EBITDA, Depreciation, EBIT, Tax, Net Income.
 *   - bs_basic: Assets = Liabilities + Equity, and signed sum Assets + Liab + Equity = 0.
 *   - cf_basic: OCF + ICF = FCF, FCF + Financing = Net Change = BS Cash delta.
 *   - rounding_oracle: Largest-remainder allocation reproduces exact results with zero drift.
 */
const DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/statements",
);

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DIR, name), "utf8")) as T;
}

describe("tests/fixtures/statements", () => {
  it("pl_basic: hand-computed income statement satisfies structural and tax invariants", () => {
    interface PlFixture {
      currency: string;
      scale: number;
      lines: Array<{
        account_code: string;
        label: string;
        section: string;
        amount_decimal: string;
        amount_minor: number;
        tax_rate_percent?: string;
      }>;
    }

    interface PlExpected {
      revenue: string;
      revenue_minor: number;
      cogs: string;
      cogs_minor: number;
      gross_profit: string;
      gross_profit_minor: number;
      opex: string;
      opex_minor: number;
      ebitda: string;
      ebitda_minor: number;
      depreciation: string;
      depreciation_minor: number;
      ebit: string;
      ebit_minor: number;
      tax_rate_pct: string;
      tax: string;
      tax_minor: number;
      net_income: string;
      net_income_minor: number;
      invariants: {
        gross_profit_equals_revenue_minus_cogs: boolean;
        ebitda_equals_gross_profit_minus_opex: boolean;
        ebit_equals_ebitda_minus_depreciation: boolean;
        net_income_equals_ebit_minus_tax: boolean;
      };
    }

    const fixture = loadJson<PlFixture>("pl_basic.json");
    const expected = loadJson<PlExpected>("pl_basic.expected.json");

    expect(fixture.currency).toBe("USD");
    expect(fixture.scale).toBe(2);

    const rev = new Decimal(expected.revenue);
    const cogs = new Decimal(expected.cogs);
    const gp = rev.minus(cogs);
    expect(gp.toDecimalPlaces(2).toString()).toBe(new Decimal(expected.gross_profit).toString());
    expect(expected.gross_profit_minor).toBe(expected.revenue_minor - expected.cogs_minor);

    const opex = new Decimal(expected.opex);
    const ebitda = gp.minus(opex);
    expect(ebitda.toDecimalPlaces(2).toString()).toBe(new Decimal(expected.ebitda).toString());

    const depr = new Decimal(expected.depreciation);
    const ebit = ebitda.minus(depr);
    expect(ebit.toDecimalPlaces(2).toString()).toBe(new Decimal(expected.ebit).toString());

    const taxRate = new Decimal(expected.tax_rate_pct).dividedBy(100);
    const tax = ebit.times(taxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(tax.toDecimalPlaces(2).toString()).toBe(new Decimal(expected.tax).toString());

    const netIncome = ebit.minus(tax);
    expect(netIncome.toDecimalPlaces(2).toString()).toBe(
      new Decimal(expected.net_income).toString(),
    );
    expect(expected.net_income_minor).toBe(69420000);
    expect(expected.invariants.gross_profit_equals_revenue_minus_cogs).toBe(true);
    expect(expected.invariants.ebitda_equals_gross_profit_minus_opex).toBe(true);
    expect(expected.invariants.ebit_equals_ebitda_minus_depreciation).toBe(true);
    expect(expected.invariants.net_income_equals_ebit_minus_tax).toBe(true);
  });

  it("bs_basic: balance sheet ties out exactly with Assets = Liab + Equity", () => {
    interface BsLine {
      account_code: string;
      label: string;
      class: string;
      amount_decimal: string;
      amount_minor: number;
      signed_amount_minor?: number;
    }
    interface BsFixture {
      assets: BsLine[];
      liabilities: BsLine[];
      equity: BsLine[];
    }
    interface BsExpected {
      total_assets_minor: number;
      total_liabilities_minor: number;
      total_equity_minor: number;
      total_liabilities_and_equity_minor: number;
      tie_out: {
        assets_equal_liabilities_plus_equity: boolean;
        delta_minor: number;
        signed_sum_zero: boolean;
      };
    }

    const fixture = loadJson<BsFixture>("bs_basic.json");
    const expected = loadJson<BsExpected>("bs_basic.expected.json");

    const assetSumMinor = fixture.assets.reduce((sum, line) => sum + line.amount_minor, 0);
    const liabSumMinor = fixture.liabilities.reduce((sum, line) => sum + line.amount_minor, 0);
    const equitySumMinor = fixture.equity.reduce((sum, line) => sum + line.amount_minor, 0);

    expect(assetSumMinor).toBe(expected.total_assets_minor);
    expect(liabSumMinor).toBe(expected.total_liabilities_minor);
    expect(equitySumMinor).toBe(expected.total_equity_minor);
    expect(assetSumMinor).toBe(liabSumMinor + equitySumMinor);
    expect(expected.tie_out.delta_minor).toBe(0);

    // Signed convention check per MONEY-ROUNDING-SPEC §5: Assets + (Liab) + (Equity) = 0
    const signedAssets = assetSumMinor;
    const signedLiab = fixture.liabilities.reduce(
      (sum, line) => sum + (line.signed_amount_minor ?? -line.amount_minor),
      0,
    );
    const signedEquity = fixture.equity.reduce(
      (sum, line) => sum + (line.signed_amount_minor ?? -line.amount_minor),
      0,
    );
    expect(signedAssets + signedLiab + signedEquity).toBe(0);
  });

  it("cf_basic: cash flow statement ties out to balance sheet cash delta", () => {
    interface CfFixture {
      operating_activities: Array<{ amount_minor: number }>;
      investing_activities: Array<{ amount_minor: number }>;
      financing_activities: Array<{ amount_minor: number }>;
      balance_sheet_cash_reference: {
        beginning_cash_minor: number;
        ending_cash_minor: number;
        cash_delta_minor: number;
      };
    }
    interface CfExpected {
      operating_cash_flow_minor: number;
      investing_cash_flow_minor: number;
      free_cash_flow_minor: number;
      financing_cash_flow_minor: number;
      net_cash_change_minor: number;
      tie_out: {
        fcf_equals_ocf_plus_icf: boolean;
        net_change_equals_fcf_plus_financing: boolean;
        net_change_equals_bs_cash_delta: boolean;
        bs_cash_delta_minor: number;
      };
    }

    const fixture = loadJson<CfFixture>("cf_basic.json");
    const expected = loadJson<CfExpected>("cf_basic.expected.json");

    const ocf = fixture.operating_activities.reduce((sum, l) => sum + l.amount_minor, 0);
    const icf = fixture.investing_activities.reduce((sum, l) => sum + l.amount_minor, 0);
    const financing = fixture.financing_activities.reduce((sum, l) => sum + l.amount_minor, 0);

    expect(ocf).toBe(expected.operating_cash_flow_minor);
    expect(icf).toBe(expected.investing_cash_flow_minor);
    expect(ocf + icf).toBe(expected.free_cash_flow_minor);
    expect(financing).toBe(expected.financing_cash_flow_minor);

    const netChange = ocf + icf + financing;
    expect(netChange).toBe(expected.net_cash_change_minor);
    expect(netChange).toBe(fixture.balance_sheet_cash_reference.cash_delta_minor);
  });

  it("rounding_oracle: largest-remainder allocation reproduces exact oracle targets across all cases", () => {
    interface OracleCase {
      id: string;
      name: string;
      unit: string;
      exact_lines: string[];
    }
    interface RoundingFixture {
      cases: OracleCase[];
    }
    interface RoundingExpected {
      results: Record<
        string,
        {
          displayed: string[];
          displayed_total: string;
          sum_ties_to_total: boolean;
        }
      >;
    }

    const fixture = loadJson<RoundingFixture>("rounding_oracle.json");
    const expected = loadJson<RoundingExpected>("rounding_oracle.expected.json");

    for (const testCase of fixture.cases) {
      const exp = expected.results[testCase.id];
      expect(exp, `Expected case ${testCase.id} to be defined`).toBeDefined();

      const result = largestRemainderAllocate(testCase.exact_lines, testCase.unit);
      expect(result.displayed).toEqual(exp.displayed);
      expect(result.displayedTotal).toBe(exp.displayed_total);

      // Verify that sum(displayed) === displayedTotal exactly
      const sumDisplayed = result.displayed.reduce(
        (acc, val) => acc.plus(new Decimal(val)),
        new Decimal(0),
      );
      expect(sumDisplayed.toString()).toBe(result.displayedTotal);
    }
  });
});
