import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * COA fixture integrity (TEST-FIXTURES-SPEC §1 coa/; matrix F-002).
 * Sandbox-runnable checks of the fixture FILES themselves (parse + internal
 * consistency of each sidecar against its input). Engine parity (fixture ↔
 * `import_coa` / `merge_accounts`) is asserted by the cargo tests
 * `fixture_import_pack_coa` / `fixture_import_update` / `fixture_import_duplicate_code` /
 * `fixture_import_referenced_account` / `fixture_merge_remap` (CI — no cargo in sandbox).
 */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/coa");

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(DIR, name), "utf8")) as Record<string, unknown>;
}

type Account = {
  code: string;
  name: string;
  type: string;
  section: string;
  is_control?: boolean;
  parent_code?: string | null;
};

describe("tests/fixtures/coa", () => {
  it("import-pack-coa: sidecar matches the clean import source", () => {
    const f = load("import-pack-coa.json");
    const expected = load("import-pack-coa.expected.json");
    const accounts = f.accounts as Account[];
    expect(accounts.length).toBeGreaterThan(0);
    // Clean source: unique codes, no pre-existing set → every account is created.
    const codes = accounts.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(expected.created as number).toBe(codes.length);
    expect(expected.updated as number).toBe(0);
    // At least one control account (pack shape parity).
    expect(accounts.some((a) => a.is_control)).toBe(true);
  });

  it("import-update: incoming code exists with the SAME type and no usage", () => {
    const f = load("import-update.json");
    const expected = load("import-update.expected.json");
    const existing = f.existing as Account[];
    const incoming = f.accounts as Account[];
    const code = incoming[0].code;
    const match = existing.find((a) => a.code === code);
    expect(match).toBeDefined();
    expect(match!.type).toBe(incoming[0].type); // same type → upsert, not COA_DUPLICATE_CODE
    expect(expected.created as number).toBe(0);
    expect(expected.updated as number).toBe(1);
    // In-place versioning: the row keeps its id, the version bumps to 2.
    expect(expected.code_4000_version as number).toBe(2);
    expect(expected.code_4000_name).toBe(incoming[0].name);
  });

  it("duplicate-code: the collision is a real type mismatch", () => {
    const f = load("duplicate-code.json");
    const expected = load("duplicate-code.expected.json");
    const existing = f.existing as Account[];
    const incoming = f.accounts as Account[];
    const collision = incoming.find((a) => existing.some((e) => e.code === a.code));
    expect(collision).toBeDefined();
    const existingSide = existing.find((e) => e.code === collision!.code)!;
    expect(existingSide.type).not.toBe(collision!.type);
    expect(expected.error).toBe("COA_DUPLICATE_CODE");
    expect(expected.http_status).toBe(409);
    expect(expected.code).toBe(collision!.code);
  });

  it("referenced-account: the line count equals the sidecar count", () => {
    const f = load("referenced-account.json");
    const expected = load("referenced-account.expected.json");
    const existing = f.existing as Account[];
    const lines = f.gl_lines as {
      account_code: string;
      debit_minor: number;
      credit_minor: number;
    }[];
    const code = lines[0].account_code;
    const match = existing.find((a) => a.code === code);
    expect(match).toBeDefined();
    const incoming = f.accounts as Account[];
    expect(incoming[0].type).toBe(match!.type); // same type — the guard is about USAGE, not type
    expect(expected.error).toBe("COA_REFERENCED");
    expect(expected.http_status).toBe(409);
    expect(expected.count).toBe(lines.length);
    // Deterministic money: each line balances to its own debit/credit minor units.
    for (const l of lines) {
      expect(l.debit_minor + l.credit_minor).toBeGreaterThan(0);
    }
  });

  it("merge-remap: remapped count equals the source's line count; child reparents to the target", () => {
    const f = load("merge-remap.json");
    const expected = load("merge-remap.expected.json");
    const existing = f.existing as Account[];
    const lines = f.gl_lines as { account_code: string }[];
    const from = existing.find((a) => a.code === f.from_code);
    const to = existing.find((a) => a.code === f.to_code);
    expect(from).toBeDefined();
    expect(to).toBeDefined();
    expect(from!.type).toBe(to!.type); // mergeable — COA_TYPE_MISMATCH must not fire
    expect(f.from_code).not.toBe(f.to_code);
    // The source is NOT the target's parent (cycle guard must not fire).
    expect(from!.parent_code ?? null).not.toBe(to!.code);
    const onSource = lines.filter((l) => l.account_code === f.from_code).length;
    expect(expected.remapped).toBe(onSource);
    expect(expected.from_active).toBe(0);
    expect(expected.from_version).toBe(2);
    // The child exists and points at the source before the merge.
    const child = existing.find((a) => a.code === expected.child_code);
    expect(child).toBeDefined();
    expect(child!.parent_code).toBe(f.from_code);
    expect(expected.child_new_parent_code).toBe(f.to_code);
  });
});
