/**
 * `audit.list` contract tests (F-033 · US-034 · API-SPEC §2 `audit.list` row).
 *
 * Drives `mockInvoke` directly (the dev mirror of `commands/audit.rs`) and pins the wire
 * shape with the Zod result schema, plus the argument gate through the real `call` path.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, MOCK_AUDIT_PAGE_SIZE, MOCK_CHAIN_BREAK_PIN } from "./mock";
import { AuditListArgs, AuditListData } from "./schema";

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

type Envelope = {
  error?: { code: string; userMessage: string; httpStatus: number; retryable: boolean };
  data?: unknown;
};

async function unlockSession(pin = "Meridian2026"): Promise<Envelope> {
  return (await mockInvoke("session.unlock", { pin, company_id: COMPANY_ID })) as Envelope;
}

async function lockSession(): Promise<void> {
  await mockInvoke("session.lock", {});
}

async function list(args: unknown): Promise<Envelope> {
  return (await mockInvoke("audit.list" as never, args as never)) as Envelope;
}

describe("audit.list — dev mirror contract", () => {
  beforeEach(async () => {
    await lockSession();
  });

  it("requires an unlocked session", async () => {
    const out = await list({ company_id: COMPANY_ID, page: 1 });
    expect(out.error?.code).toBe("SESSION_LOCKED");
    expect(out.error?.httpStatus).toBe(401);
  });

  it("returns a schema-conformant envelope with events, chain status, meta and facets", async () => {
    await unlockSession();
    const out = await list({ company_id: COMPANY_ID, page: 1 });
    expect(out.error).toBeUndefined();
    const data = AuditListData.parse(out.data);
    expect(data.events.length).toBeGreaterThan(0);
    expect(data.meta.page).toBe(1);
    expect(data.meta.page_size).toBe(MOCK_AUDIT_PAGE_SIZE);
    expect(data.meta.total).toBe(data.chain_status.event_count);
    expect(data.facets.actors).toContain("owner");
    expect(data.facets.actions).toContain("import.commit");
    expect(data.facets.object_types).toContain("scenario");
  });

  it("orders events newest-first and links each hash to the previous event", async () => {
    await unlockSession();
    const data = AuditListData.parse((await list({ company_id: COMPANY_ID, page: 1 })).data);
    const seqs = data.events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
    // Chain integrity of the fixture itself: every event's prev_hash is its predecessor's hash.
    const ascending = [...data.events].sort((a, b) => a.seq - b.seq);
    expect(ascending[0].prev_hash).toBe("genesis");
    for (let i = 1; i < ascending.length; i += 1) {
      expect(ascending[i].prev_hash).toBe(ascending[i - 1].hash);
    }
  });

  it("reports a verified chain for a healthy session", async () => {
    await unlockSession();
    const data = AuditListData.parse((await list({ company_id: COMPANY_ID, page: 1 })).data);
    expect(data.chain_status.verified).toBe(true);
    expect(data.chain_status.broken_at_seq).toBeNull();
  });

  it("reports the tamper as DATA (not an error) and keeps the log readable", async () => {
    await unlockSession(MOCK_CHAIN_BREAK_PIN);
    const out = await list({ company_id: COMPANY_ID, page: 1 });
    expect(out.error).toBeUndefined();
    const data = AuditListData.parse(out.data);
    expect(data.chain_status.verified).toBe(false);
    expect(data.chain_status.broken_at_seq).not.toBeNull();
    expect(data.events.length).toBeGreaterThan(0);
  });

  it("narrows by actor/action/object_type but keeps facets over the whole chain", async () => {
    await unlockSession();
    const out = await list({
      company_id: COMPANY_ID,
      filters: { action: "scenario.approve" },
      page: 1,
    });
    const data = AuditListData.parse(out.data);
    expect(data.events).toHaveLength(1);
    expect(data.events[0].action).toBe("scenario.approve");
    expect(data.meta.total).toBe(1);
    // The filter must stay reversible: every value in the chain is still offered.
    expect(data.facets.actions.length).toBeGreaterThan(1);
    expect(data.chain_status.event_count).toBeGreaterThan(1);
  });

  it("an over-narrow filter yields an empty page, not an error", async () => {
    await unlockSession();
    const out = await list({
      company_id: COMPANY_ID,
      filters: { actor: "nobody" },
      page: 1,
    });
    const data = AuditListData.parse(out.data);
    expect(data.events).toEqual([]);
    expect(data.meta.total).toBe(0);
    expect(data.meta.total_pages).toBe(0);
  });

  it("rejects a cross-Company read", async () => {
    await unlockSession();
    const out = await list({
      company_id: "11111111-2222-4333-8444-555555555555",
      page: 1,
    });
    expect(out.error?.code).toBe("VALUE_INVALID");
    expect(out.error?.httpStatus).toBe(422);
  });
});

describe("AuditListArgs — boundary gate", () => {
  it("accepts a bare company + page (filters optional)", () => {
    expect(AuditListArgs.safeParse({ company_id: COMPANY_ID, page: 1 }).success).toBe(true);
  });

  it("rejects page 0 and non-integer pages before the IPC boundary", () => {
    expect(AuditListArgs.safeParse({ company_id: COMPANY_ID, page: 0 }).success).toBe(false);
    expect(AuditListArgs.safeParse({ company_id: COMPANY_ID, page: 1.5 }).success).toBe(false);
  });

  it("rejects an unknown filter key (strict — no invented capability)", () => {
    const parsed = AuditListArgs.safeParse({
      company_id: COMPANY_ID,
      filters: { severity: "critical" },
      page: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("requires ISO-8601 date bounds", () => {
    expect(
      AuditListArgs.safeParse({
        company_id: COMPANY_ID,
        filters: { from: "2026-08-01" },
        page: 1,
      }).success,
    ).toBe(false);
    expect(
      AuditListArgs.safeParse({
        company_id: COMPANY_ID,
        filters: { from: "2026-08-01T00:00:00Z" },
        page: 1,
      }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid company id", () => {
    expect(AuditListArgs.safeParse({ company_id: "c-01", page: 1 }).success).toBe(false);
  });
});
