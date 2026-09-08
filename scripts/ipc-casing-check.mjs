#!/usr/bin/env node
/**
 * ipc:casing — Tauri invoke-argument casing gate (API-SPEC wire contract · ADR-030).
 *
 * Tauri 2 expects camelCase invoke keys by DEFAULT, and `rename_all = "camelCase"` makes a
 * command expect `companyId`-style keys. This repo's entire wire contract is snake_case
 * (API-SPEC §2 rows, the strict Zod schemas in src/api/schema.ts, and every `call()` site).
 * The 2026-09-07 audit found 21 commands annotated camelCase — 15 of them with multi-word
 * args (`session.unlock`, `company.create`, `calendar.preview`, `coa.list`, …) — which
 * deserialize NOTHING in the real desktop shell: the mock (dev preview) and the dev-server
 * E2E suite answer those commands, so no gate ever saw it.
 *
 * Rule: every `#[tauri::command]` in src-tauri/src must declare
 * `rename_all = "snake_case"`. Single-word commands are unaffected by casing, but the
 * uniform annotation keeps the contract machine-checkable and review-obvious.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dir = join(root, "src-tauri", "src");
const problems = [];

function walk(d, acc = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".rs")) acc.push(p);
  }
  return acc;
}

const files = walk(dir);
let commands = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const attrRe = /#\[tauri::command(\(([^)]*)\))?\]/g;
  for (const m of text.matchAll(attrRe)) {
    commands += 1;
    const attrs = m[2] ?? "";
    const at = m.index;
    const line = text.slice(0, at).split("\n").length;
    const rel = f.slice(root.length + 1);
    if (!attrs.includes('rename_all = "snake_case"')) {
      const kind = attrs.includes('rename_all = "camelCase"')
        ? 'rename_all = "camelCase" — invoke keys would be camelCase, the frontend sends snake_case'
        : "no rename_all — Tauri 2 defaults invoke keys to camelCase, the frontend sends snake_case";
      problems.push(`${rel}:${line}: #[tauri::command] without snake_case args — ${kind}`);
    }
  }
}

if (commands === 0) {
  console.error("ipc:casing FAILED — no commands found under src-tauri/src (parser drift?)");
  process.exit(1);
}

if (problems.length) {
  console.error(`ipc:casing FAILED — ${problems.length} violation(s) across ${commands} commands`);
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  process.exit(1);
}
console.log(
  `ipc:casing PASS — ${commands} commands all declare rename_all = "snake_case" (wire contract)`,
);
