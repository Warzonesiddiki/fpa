/**
 * `statement.get.v1` (F-027 · M6-1 · S-060) contract + mock tests.
 *
 * Verifies:
 *  - typed args + data parse cleanly via CommandArgs
 *  - mock returns populated P&L and BS responses
 *  - mock returns STATEMENT_TIE_OUT_FAILED on the dev trigger
 *  - mock returns STATEMENT_SOURCE_MIXED on group/mixed trigger
 *  - empty period scope is accepted (engine resolves the current period)
 *  - `bu_scope.kind === "single"` requires a `bu_id` (typed 422 gate, not a serde hole)
 */

import { mockInvoke } from "./mock";
import { CommandArgs } from "./schema";

/** The mock's dev envelope: `{data}` on success, `{error}` with the typed code on failure. */
type Envelope<T> = {
  data?: T;
  error?: {
    code: string;
    message: string;
    userMessage: string;
    httpStatus: number;
    retryable: boolean;
    retryAfterMs: number | null;
    details: Record<string, unknown>;
  };
};

describe("statement.get.v1 (F-027 · M6-1 · S-060)", () => {
  const baseArgs = {
    company_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
    type: "pl" as const,
    period_scope: ["3f9f2c9e-9f8b-4e2d-9a1c-200000000001"],
    preset: "us_gaap" as const,
    rounding: { mode: "two_decimals" as const, largest_remainder: true },
    bu_scope: { kind: "all" as const, bu_id: null },
  };

  it("parses typed args via CommandArgs", () => {
    const parsed = CommandArgs["statement.get.v1"].safeParse(baseArgs);
    expect(parsed.success).toBe(true);
  });

  it("returns populated P&L rows + totals from the mock", async () => {
    const res = (await mockInvoke("statement.get.v1", baseArgs)) as Envelope<{
      rows: unknown[];
      totals: { revenue: number | null };
      tieout_status: string;
      rounding_status: string;
      findings: unknown[];
      currency: string;
    }>;
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
    const res = (await mockInvoke("statement.get.v1", args)) as Envelope<{
      rows: Array<{ section: string }>;
      totals: {
        total_assets: number | null;
        total_liabilities: number | null;
        total_equity: number | null;
      };
    }>;
    expect(res.error).toBeUndefined();
    const bsRows =
      res.data?.rows.filter((r) =>
        ["Current Assets", "Current Liabilities", "Equity"].includes(r.section),
      ) ?? [];
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
    const res = (await mockInvoke("statement.get.v1", args)) as Envelope<unknown>;
    expect(res.error?.code).toBe("STATEMENT_TIE_OUT_FAILED");
    expect(res.error?.httpStatus).toBe(422);
    expect(res.error?.retryable).toBe(false);
  });

  it("returns STATEMENT_SOURCE_MIXED on group/mixed scope", async () => {
    const args = {
      ...baseArgs,
      company_id: "source_mixed-3f9f2c9e-9f8b-4e2d-9a1c-000000000001",
      bu_scope: { kind: "group" as const, bu_id: null },
    };
    const res = (await mockInvoke("statement.get.v1", args)) as Envelope<unknown>;
    expect(res.error?.code).toBe("STATEMENT_SOURCE_MIXED");
    expect(res.error?.httpStatus).toBe(422);
    expect(res.error?.retryable).toBe(false);
  });

  it("accepts an empty period scope (engine resolves the current period)", () => {
    const parsed = CommandArgs["statement.get.v1"].safeParse({
      ...baseArgs,
      period_scope: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects single-BU scope without a bu_id at the typed gate", () => {
    const parsed = CommandArgs["statement.get.v1"].safeParse({
      ...baseArgs,
      bu_scope: { kind: "single", bu_id: null },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts single-BU scope with a bu_id", () => {
    const parsed = CommandArgs["statement.get.v1"].safeParse({
      ...baseArgs,
      bu_scope: { kind: "single", bu_id: "3f9f2c9e-9f8b-4e2d-9a1c-000000000009" },
    });
    expect(parsed.success).toBe(true);
  });

  it("answers the bad-period dev trigger with STATEMENT_TIE_OUT_FAILED", async () => {
    // Direct-to-mock trigger (mirrors the Rust tie-out gate; the dev-preview store
    // can only send Uuid-shaped periods, the mock keys off the scope itself).
    const res = (await mockInvoke("statement.get.v1", {
      ...baseArgs,
      period_scope: ["bad"],
    })) as Envelope<unknown>;
    expect(res.error?.code).toBe("STATEMENT_TIE_OUT_FAILED");
  });

  it("flags approximate rounding when largest-remainder is off (mirror of rounding_status)", async () => {
    const res = (await mockInvoke("statement.get.v1", {
      ...baseArgs,
      rounding: { mode: "thousands" as const, largest_remainder: false },
    })) as Envelope<{ rounding_status: string }>;
    expect(res.error).toBeUndefined();
    expect(res.data?.rounding_status).toBe("approximate");
  });

  it("rejects group BU scope even for a plain company id (source rule, not the trigger)", async () => {
    const res = (await mockInvoke("statement.get.v1", {
      ...baseArgs,
      bu_scope: { kind: "group" as const, bu_id: null },
    })) as Envelope<unknown>;
    expect(res.error?.code).toBe("STATEMENT_SOURCE_MIXED");
  });
});
