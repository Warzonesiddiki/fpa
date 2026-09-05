/**
 * `health.run` / `health.waive` contract tests (F-032 · US-033 · API-SPEC §7 `health.*`).
 *
 * Drives `mockInvoke` directly (the dev mirror of `commands/health.rs`) and pins the wire
 * shape with the Zod result schemas, plus the argument gates.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, MOCK_CHAIN_BREAK_PIN } from "./mock";
import {
  HEALTH_CATEGORIES,
  HealthRunArgs,
  HealthRunData,
  HealthWaiveArgs,
  HealthWaiveData,
} from "./schema";

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";
const MODEL_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000010";

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

async function run(args: unknown = { model_id: MODEL_ID }): Promise<Envelope> {
  return (await mockInvoke("health.run" as never, args as never)) as Envelope;
}

async function waive(args: unknown): Promise<Envelope> {
  return (await mockInvoke("health.waive" as never, args as never)) as Envelope;
}

describe("health.run — dev mirror contract", () => {
  beforeEach(async () => {
    await lockSession();
  });

  it("requires an unlocked session", async () => {
    const out = await run();
    expect(out.error?.code).toBe("SESSION_LOCKED");
    expect(out.error?.httpStatus).toBe(401);
  });

  it("returns a schema-conformant report with all five categories", async () => {
    await unlockSession();
    const out = await run();
    expect(out.error).toBeUndefined();
    const data = HealthRunData.parse(out.data);
    expect(data.model_id).toBe(MODEL_ID);
    expect(data.categories.map((c) => c.category)).toEqual([...HEALTH_CATEGORIES]);
  });

  it("reports a failing Model as DATA, never as an error", async () => {
    await unlockSession();
    const out = await run();
    expect(out.error).toBeUndefined();
    const data = HealthRunData.parse(out.data);
    expect(data.status).toBe("failed");
    expect(data.blocking_count).toBeGreaterThan(0);
  });

  it("counts blocking as unwaived HARD findings only, and warnings separately", async () => {
    await unlockSession();
    const data = HealthRunData.parse((await run()).data);
    const hardUnwaived = data.findings.filter(
      (f) => f.severity === "hard" && f.waiver === null,
    ).length;
    const warnings = data.findings.filter((f) => f.severity === "warn").length;
    expect(data.blocking_count).toBe(hardUnwaived);
    expect(data.warning_count).toBe(warnings);
  });

  it("the per-category rollup sums back to the finding list", async () => {
    await unlockSession();
    const data = HealthRunData.parse((await run()).data);
    for (const category of data.categories) {
      const mine = data.findings.filter((f) => f.category === category.category);
      expect(category.finding_count).toBe(mine.length);
      expect(category.blocking_count).toBe(
        mine.filter((f) => f.severity === "hard" && f.waiver === null).length,
      );
    }
    expect(data.categories.reduce((n, c) => n + c.finding_count, 0)).toBe(data.findings.length);
  });

  it("mints at least one cell-scoped entity_ref and one that is not a cell", async () => {
    await unlockSession();
    const data = HealthRunData.parse((await run()).data);
    const refs = data.findings.map((f) => f.entity_ref ?? "");
    expect(refs.some((r) => r.startsWith("cell:"))).toBe(true);
    expect(refs.some((r) => r !== "" && !r.startsWith("cell:"))).toBe(true);
  });

  it("records each run in the history, newest first", async () => {
    await unlockSession();
    const first = HealthRunData.parse((await run()).data);
    const second = HealthRunData.parse((await run()).data);
    expect(second.check_id).not.toBe(first.check_id);
    expect(second.history[0].check_id).toBe(second.check_id);
    expect(second.history.map((h) => h.check_id)).toContain(first.check_id);
  });

  it("rejects a non-uuid model id at the argument gate", () => {
    expect(HealthRunArgs.safeParse({ model_id: "m-1" }).success).toBe(false);
    expect(HealthRunArgs.safeParse({ model_id: MODEL_ID }).success).toBe(true);
  });

  it("rejects unknown argument keys", () => {
    expect(HealthRunArgs.safeParse({ model_id: MODEL_ID, deep: true }).success).toBe(false);
  });
});

describe("health.waive — dev mirror contract", () => {
  beforeEach(async () => {
    await lockSession();
  });

  it("requires an unlocked session", async () => {
    const out = await waive({ finding_id: "f-1", reason: "x" });
    expect(out.error?.code).toBe("SESSION_LOCKED");
  });

  it("refuses a blank reason with the documented catalog row", async () => {
    await unlockSession();
    const findingId = HealthRunData.parse((await run()).data).findings[0].id;
    const out = await waive({ finding_id: findingId, reason: "   " });
    expect(out.error?.code).toBe("HEALTH_WAIVER_REASON_REQUIRED");
    expect(out.error?.userMessage).toBe("A waiver reason is required.");
    expect(out.error?.httpStatus).toBe(422);
    expect(out.error?.retryable).toBe(false);
  });

  it("refuses an unknown finding", async () => {
    await unlockSession();
    const out = await waive({ finding_id: "3f9f2c9e-9f8b-4e2d-9a1c-0000000000ff", reason: "x" });
    expect(out.error?.code).toBe("VALUE_INVALID");
    expect(out.error?.httpStatus).toBe(422);
  });

  it("refuses to waive while the Company is read-only", async () => {
    await unlockSession(MOCK_CHAIN_BREAK_PIN);
    const findingId = HealthRunData.parse((await run()).data).findings[0].id;
    const out = await waive({ finding_id: findingId, reason: "Signed off." });
    expect(out.error?.code).toBe("READ_ONLY_MODE");
  });

  it("records the waiver, and the next run carries it forward without hiding the finding", async () => {
    await unlockSession();
    const before = HealthRunData.parse((await run()).data);
    const target = before.findings.find((f) => f.severity === "hard" && f.waiver === null);
    expect(target).toBeDefined();

    const out = await waive({
      finding_id: target!.id,
      reason: "  Signed off by the Controller.  ",
    });
    expect(out.error).toBeUndefined();
    const receipt = HealthWaiveData.parse(out.data);
    expect(receipt.waived).toBe(true);
    expect(receipt.finding_id).toBe(target!.id);

    const after = HealthRunData.parse((await run()).data);
    expect(after.findings).toHaveLength(before.findings.length);
    const carried = after.findings.find((f) => f.id === target!.id);
    expect(carried?.waiver?.reason).toBe("Signed off by the Controller.");
    expect(carried?.waiver?.actor).toBe("owner");
    expect(after.blocking_count).toBe(before.blocking_count - 1);
    expect(after.waived_count).toBeGreaterThanOrEqual(1);
  });

  it("the argument gate itself refuses an empty reason (D-010, before the wire)", () => {
    expect(HealthWaiveArgs.safeParse({ finding_id: MODEL_ID, reason: "" }).success).toBe(false);
    expect(HealthWaiveArgs.safeParse({ finding_id: MODEL_ID, reason: "   " }).success).toBe(false);
    expect(HealthWaiveArgs.safeParse({ finding_id: MODEL_ID, reason: "ok" }).success).toBe(true);
  });
});
