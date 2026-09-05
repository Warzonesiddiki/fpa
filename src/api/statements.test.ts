/**
 * `statement.get.v1` (F-027 · M6-1 · S-060) contract + mock tests.
 *
 * Verifies:
 *  - typed args + data parse cleanly via CommandArgs
 *  - mock returns populated P&L and BS responses
 *  - mock returns STATEMENT_TIE_OUT_FAILED on the dev trigger
 *  - mock returns STATEMENT_SOURCE_MIXED on group/mixed trigger
 *  - empty period scope is rejected by the args schema
 */

import { mockInvoke } from "./mock";
import { CommandArgs } from "./schema";

describe("statement.get.v1 (F-027 · M6-1 · S-060)", () => {
  const baseArgs = {
    company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    type: "pl" as const,
    period_scope: ["3f9f2c9e-9f8b-4e2d-9a1c-200000000001"] as const,
    preset: "us_gaap" as const,
    rounding: { mode: "two_decimals" as const, largest_remainder: true },
    bu_scope: { kind: "all" as const, bu_id: null },
  };

  it("parses typed args via CommandArgs", () => {
    const parsed = CommandArgs["statement.get.v1"].safeParse(baseArgs);
    expect(parsed.success).toBe(true);
  });

  it("returns populated P&L rows + totals from the mock", async () => {
    const res = await mockInvoke("statement.get.v1", baseArgs);
    expect(res.error).toBeUndefined();
    expect(res.data?.rows).toBeInstanceOf(Array);
    expect(res.data?.rows.length).toBeGreaterThan(0);
    expect(res.data?.totals.revenue).toBe(2200000);
    expect(res.data?.tieout_status).toBe("pass");
    expect(res.data?.rounding_status).toBe("exact");
    expect(res.data?.findings).toEqual([]);
    expect(res.data?.currency).toBe("USD");
  });

  it("returns populated Balance Sheet rows from the mock", async () => {
    const args = {
      ...baseArgs,
      type: "bs" as const,
    };
    const res = await mockInvoke("statement.get.v1", args);
    expect(res.error).toBeUndefined();
    const bsRows = res.data?.rows.filter((r: { section: string }) =>
      ["Current Assets", "Current Liabilities", "Equity"].includes(r.section),
    );
    expect(bsRows.length).toBeGreaterThan(0);
    // Signed per MONEY-ROUNDING-SPEC §5 (Assets + Liabilities + Equity == 0).
    expect(res.data?.totals.total_assets).toBe(1260000);
    expect(res.data?.totals.total_liabilities).toBe(-500000);
    expect(res.data?.totals.total_equity).toBe(-760000);
  });

  it("returns STATEMENT_TIE_OUT_FAILED on the dev trigger", async () => {
    const args = {
      ...baseArgs,
      company_id: "tieout_fail-3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    };
    const err = await mockInvoke("statement.get.v1", args);
    expect(err.error?.code).toBe("STATEMENT_TIE_OUT_FAILED");
    expect(err.error?.httpStatus).toBe(422);
    expect(err.error?.retryable).toBe(false);
  });

  it("returns STATEMENT_SOURCE_MIXED on group/mixed scope", async () => {
    const args = {
      ...baseArgs,
      company_id: "source_mixed-3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      bu_scope: { kind: "group", bu_id: null },
    };
    const err = await mockInvoke("statement.get.v1", args);
    expect(err.error?.code).toBe("STATEMENT_SOURCE_MIXED");
    expect(err.error?.httpStatus).toBe(422);
    expect(err.error?.retryable).toBe(false);
  });

  it("accepts an empty period scope (engine resolves the current period)", () => {
    const parsed = CommandArgs["statement.get.v1"].safeParse({
      ...baseArgs,
      period_scope: [],
    });
    expect(parsed.success).toBe(true);
  });
});
