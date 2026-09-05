/**
 * `alerts.*` contract tests (F-026 · M5-4 · API-SPEC §7 alerts.* rows).
 *
 * Drives `mockInvoke` directly (the dev mirror of `commands/alerts.rs`) and pins the wire
 * shapes with the Zod result schemas. Validation detail strings are asserted EQUAL to the
 * native ones (the mock mirrors validate_rule exactly) so the two cannot drift silently.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, resetMockAlertState } from "./mock";
import { AlertsCreateRuleData, AlertsListData } from "./schema";

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

type Envelope = {
  error?: { code: string; userMessage: string; httpStatus: number; retryable: boolean };
  data?: unknown;
};

async function unlockSession(): Promise<void> {
  const out = (await mockInvoke("session.unlock", {
    pin: "Meridian2026",
    company_id: COMPANY_ID,
  })) as Envelope;
  expect(out.error).toBeUndefined();
}

async function lockSession(): Promise<void> {
  await mockInvoke("session.lock", {});
}

/** Contract tests drive the DEV MIRROR with raw wire payloads (some intentionally
 *  invalid — that is the point of pinning the mock's validation). mockInvoke's args are
 *  typed as zod OUTPUT, so raw payloads enter through this documented boundary cast. */
async function invokeRaw(
  command: "alerts.list" | "alerts.create_rule",
  args: unknown,
): Promise<unknown> {
  return mockInvoke(command as never, args as never);
}

function validRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Cash floor (13-week)",
    kpi_id: null,
    line_ref: "line-cash",
    threshold_operator: "lt",
    threshold_value: "2500000000",
    severity: "warning",
    active: true,
    ...overrides,
  };
}

describe("alerts.list — dev mirror contract", () => {
  beforeEach(() => {
    resetMockAlertState();
  });

  it("returns a schema-conformant envelope, undismissed only by default", async () => {
    await unlockSession();
    const out = (await invokeRaw("alerts.list", { filter: {} })) as { alerts: unknown[] };
    const parsed = AlertsListData.parse(out);
    expect(parsed.alerts).toHaveLength(1);
    const [first] = parsed.alerts;
    expect(first.rule_name).toBe("Cash floor (13-week)");
    expect(first.severity).toBe("warning");
    expect(first.trigger_chain.value).toBe("2400000000");
    expect(first.trigger_chain.threshold).toBe("2500000000");
    expect(first.dismissed_at).toBeNull();
  });

  it("include_dismissed surfaces the 90-day log (both fixture rows, newest first)", async () => {
    await unlockSession();
    const out = (await invokeRaw("alerts.list", {
      filter: { include_dismissed: true },
    })) as { alerts: { fired_at: string; dismissed_at: string | null }[] };
    const parsed = AlertsListData.parse(out);
    expect(parsed.alerts).toHaveLength(2);
    expect(Date.parse(parsed.alerts[0].fired_at)).toBeGreaterThan(
      Date.parse(parsed.alerts[1].fired_at),
    );
    expect(parsed.alerts[1].dismissed_at).not.toBeNull();
  });

  it("severity filter narrows the response", async () => {
    await unlockSession();
    const warning = (await invokeRaw("alerts.list", {
      filter: { severity: "warning" },
    })) as { alerts: unknown[] };
    expect(AlertsListData.parse(warning).alerts).toHaveLength(1);
    const critical = (await invokeRaw("alerts.list", {
      filter: { severity: "critical" },
    })) as { alerts: unknown[] };
    expect(AlertsListData.parse(critical).alerts).toHaveLength(0);
  });

  it("rejects an out-of-domain filter severity with the typed code", async () => {
    await unlockSession();
    const out = (await invokeRaw("alerts.list", { filter: { severity: "fatal" } })) as Envelope;
    expect(out.error?.code).toBe("ALERT_RULE_INVALID");
    expect(out.error?.httpStatus).toBe(422);
    expect(out.error?.userMessage).toBe(
      "Alert rule invalid: filter.severity must be one of info, warning, critical",
    );
  });

  it("requires an unlocked session (SESSION_LOCKED, 401, §A semantics)", async () => {
    await lockSession();
    const out = (await invokeRaw("alerts.list", { filter: {} })) as Envelope;
    expect(out.error?.code).toBe("SESSION_LOCKED");
    expect(out.error?.httpStatus).toBe(401);
    expect(out.error?.retryable).toBe(false);
  });
});

describe("alerts.create_rule — dev mirror contract", () => {
  beforeEach(() => {
    resetMockAlertState();
  });

  it("persists an audited rule and never fabricates an alert from it", async () => {
    await unlockSession();
    const created = (await invokeRaw("alerts.create_rule", {
      rule: validRule({ name: "Min gross margin", threshold_value: "-0.25" }),
    })) as { rule_id?: string; audit_id?: number } & { data?: unknown };
    // The mock mirrors the native {"data": {...}} envelope; bridge unwraps it.
    const payload = (created.data ?? created) as Record<string, number | string>;
    const parsed = AlertsCreateRuleData.parse(payload);
    expect(parsed.audit_id).toBeGreaterThanOrEqual(901);

    const listing = (await invokeRaw("alerts.list", { filter: {} })) as { alerts: unknown[] };
    expect(AlertsListData.parse(listing).alerts).toHaveLength(1); // unchanged — no fake fire
  });

  it("mirrors the native ALERT_RULE_INVALID details exactly", async () => {
    await unlockSession();
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        validRule({ kpi_id: null, line_ref: null }),
        "exactly one of kpi_id or line_ref is required",
      ],
      [
        validRule({ kpi_id: "k1", line_ref: "l1" }),
        "exactly one of kpi_id or line_ref is required",
      ],
      [
        validRule({ threshold_operator: "ne" }),
        "threshold_operator must be one of lt, lte, gt, gte, eq",
      ],
      [validRule({ severity: "fatal" }), "severity must be one of info, warning, critical"],
      [validRule({ threshold_value: "1.5e3" }), "threshold_value must be an exact decimal string"],
      [validRule({ name: "   " }), "name must be 1–120 characters"],
    ];
    for (const [rule, detail] of cases) {
      const out = (await invokeRaw("alerts.create_rule", { rule })) as Envelope;
      expect(out.error?.code, detail).toBe("ALERT_RULE_INVALID");
      expect(out.error?.httpStatus).toBe(422);
      expect(out.error?.retryable).toBe(false);
      expect(out.error?.userMessage).toBe(`Alert rule invalid: ${detail}`);
    }
  });

  it("a KPI-target-only rule validates and is accepted (evaluation lands with M6-4/5)", async () => {
    await unlockSession();
    const out = (await invokeRaw("alerts.create_rule", {
      rule: validRule({ kpi_id: "kpi-leverage", line_ref: null, threshold_value: "3.5" }),
    })) as Record<string, unknown> & { data?: unknown };
    const payload = (out.data ?? out) as Record<string, unknown>;
    expect(AlertsCreateRuleData.parse(payload).rule_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("requires an unlocked session for the mutation too", async () => {
    await lockSession();
    const out = (await invokeRaw("alerts.create_rule", { rule: validRule() })) as Envelope;
    expect(out.error?.code).toBe("SESSION_LOCKED");
    expect(out.error?.httpStatus).toBe(401);
  });
});
