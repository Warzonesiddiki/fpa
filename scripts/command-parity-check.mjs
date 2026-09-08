#!/usr/bin/env node
/**
 * command-parity-check — every typed IPC command is implemented on BOTH sides of the wire.
 *
 * The contract (API-SPEC §2) is closed: a command exists only when ALL THREE registries
 * agree — the Zod binding in `src/api/schema.ts` (`CommandArgs`), a dev-preview answer in
 * `src/api/mock.ts` (`case "…"`), and a native implementation (a `#[tauri::command(name =
 * "…")]` registered in `src-tauri/src/lib.rs`, or an engine command registered via
 * `registerEngineCommand("…")` in `src/`). A command present in one registry and missing
 * from another is exactly how the 2026-09-07 audit found shipped-but-undocumented handlers
 * (`security.pin_setup`, `assumption.waive`) and documented-but-unanswerable rows — this
 * gate makes that class of drift a local failure instead of an audit finding.
 *
 * Ownership is checked too: a `#[tauri::command]` that is NOT in `lib.rs`'s
 * `generate_handler![…]` is dead code the wire can never reach, and a mock case with no
 * schema binding is a preview answering for a contract nobody validates.
 *
 * Exit 0 = full three-way parity; exit 1 lists every offender with its registry.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const problems = [];

/** Zod contract: the `CommandArgs` map in schema.ts is the single source of truth (§2). */
function schemaCommands() {
  const src = readFileSync(join(ROOT, "src/api/schema.ts"), "utf8");
  const block = src.match(/CommandArgs = \{([\s\S]*?)\n\}/);
  if (!block) throw new Error("schema.ts: `CommandArgs = {…}` block not found");
  return new Set([...block[1].matchAll(/"([a-z0-9_.]+)":/g)].map((m) => m[1]));
}

/** Dev-preview answers: one `case "…":` per command the browser mock serves. */
function mockCommands() {
  const src = readFileSync(join(ROOT, "src/api/mock.ts"), "utf8");
  return new Set([...src.matchAll(/case "([a-z0-9_.]+)":/g)].map((m) => m[1]));
}

/** Native side: #[tauri::command(name = "…")] → fn, plus lib.rs registration. */
function nativeCommands() {
  const attrMap = new Map(); // command name → owning file (for the report)
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".rs")) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(
          /#\[tauri::command\(\s*name\s*=\s*"([a-z0-9_.]+)"[^)]*\)\]\s*(?:pub\s+)?fn\s+([a-z_0-9]+)/g,
        )) {
          if (attrMap.has(m[1]) && attrMap.get(m[1]).fn !== m[2]) {
            problems.push(
              `command "${m[1]}" declared twice: ${attrMap.get(m[1]).fn} and ${m[2]} (${relative(ROOT, p)})`,
            );
          }
          attrMap.set(m[1], { fn: m[2], file: relative(ROOT, p) });
        }
      }
    }
  };
  walk(join(ROOT, "src-tauri/src"));

  const lib = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
  const handlerBlock = lib.slice(lib.indexOf("generate_handler!"));
  if (!handlerBlock) throw new Error("lib.rs: `generate_handler![…]` not found");
  const registered = new Set(
    [...handlerBlock.matchAll(/^\s*([a-z_0-9]+),?\s*$/gm)].map((m) => m[1]),
  );

  // engine-served commands (ADR-029): the graph answers these; the mock is the fallback.
  const engine = new Set();
  const walkTs = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walkTs(p);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/registerEngineCommand\(\s*"([a-z0-9_.]+)"/g)) {
          engine.add(m[1]);
        }
      }
    }
  };
  walkTs(join(ROOT, "src"));

  return { attrMap, registered, engine };
}

const schema = schemaCommands();
const mock = mockCommands();
const { attrMap, registered, engine } = nativeCommands();

// 1. Contract → mock: every typed command must have a preview answer.
for (const cmd of schema) {
  if (!mock.has(cmd)) problems.push(`schema "${cmd}" has NO mock case (src/api/mock.ts)`);
}

// 2. Contract → native: every typed command must be Rust- or engine-served.
for (const cmd of schema) {
  const isRust = attrMap.has(cmd) && registered.has(attrMap.get(cmd).fn);
  if (!isRust && !engine.has(cmd)) {
    problems.push(`schema "${cmd}" has NO native implementation (no lib.rs handler, no engine)`);
  }
}

// 3. Mock → contract: the preview may not answer for an unvalidated command.
for (const cmd of mock) {
  if (!schema.has(cmd)) problems.push(`mock case "${cmd}" has NO schema binding (CommandArgs)`);
}

// 4. Native → contract + wire: a handler nobody can invoke, or the wire can't reach.
for (const [cmd, { fn }] of attrMap) {
  if (!schema.has(cmd)) problems.push(`Rust handler "${cmd}" (${fn}) has NO schema binding`);
  if (!registered.has(fn)) {
    problems.push(`Rust handler "${cmd}" (${fn}) is NOT registered in lib.rs generate_handler![…]`);
  }
}
for (const cmd of engine) {
  if (!schema.has(cmd)) problems.push(`engine command "${cmd}" has NO schema binding`);
}

if (problems.length) {
  console.error(`command-parity FAILED — ${problems.length} finding(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const nativeCount = [...schema].filter(
  (c) => (attrMap.has(c) && registered.has(attrMap.get(c).fn)) || engine.has(c),
).length;
console.log(
  `command-parity PASS — ${schema.size} typed commands: ${mock.size} mock answers, ` +
    `${nativeCount} native (${[...schema].filter((c) => engine.has(c)).length} engine-served), ` +
    `full three-way parity`,
);
