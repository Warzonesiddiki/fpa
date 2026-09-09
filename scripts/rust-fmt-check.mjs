#!/usr/bin/env node
/**
 * rust-fmt-check — local verification of Rust formatting WITHOUT a Rust toolchain (ADR-031).
 *
 * `@scalar/rust-fmt` vendors rustfmt compiled to WebAssembly; it formats with the same
 * rules `cargo fmt` applies (max_width 100, fn_call_width 60, chain_width 60 …), driven
 * through rustfmt's own Config::override_value. The sandbox/dev machine cannot reach
 * rustup/crates.io, so before this gate the ONLY place Rust formatting was verified was
 * the CI rust job — a formatting miss cost a full CI round-trip to discover (three in a
 * row on WS-07: collapsible let, 108-char import list, fn_call_width violations).
 *
 * Authority: CI's `cargo fmt --check` (Stage 2) remains the gate of record. This local
 * check catches the same class of drift before the push. All 40 crate files agree with
 * it at the time of adoption; if the vendored rustfmt and CI's stable ever disagree, CI
 * wins and this script gets re-pinned.
 *
 * Exit 0 = every .rs file in src-tauri/src is rustfmt-clean; exit 1 lists the offenders.
 */
import { format } from "@scalar/rust-fmt";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src-tauri", "src");

/** Edition is owned by the workspace Cargo.toml (single source of truth). */
function rustEdition() {
  const m = readFileSync(join(ROOT, "Cargo.toml"), "utf8").match(/^edition\s*=\s*"(.+)"/m);
  if (!m) throw new Error('Cargo.toml: no `edition = "…"` line found');
  return m[1];
}

function listRsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRsFiles(p));
    else if (entry.name.endsWith(".rs")) out.push(p);
  }
  return out;
}

const edition = rustEdition();
const files = listRsFiles(SRC);
const offenders = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  let formatted;
  try {
    formatted = await format(src, { edition });
  } catch (err) {
    offenders.push(`${file}: rustfmt could not parse (${String(err).slice(0, 120)})`);
    continue;
  }
  if (formatted !== src) offenders.push(file);
}

if (offenders.length > 0) {
  console.error(
    `rust-fmt-check FAILED — ${offenders.length} of ${files.length} files drift from rustfmt:`,
  );
  for (const f of offenders) console.error(`  ✗ ${f}`);
  console.error(
    "Run `cargo fmt` in src-tauri (CI parity) — no Rust toolchain locally? Reformat by hand against the printed offenders.",
  );
  process.exit(1);
}
console.log(
  `rust-fmt-check PASS — ${files.length} Rust files rustfmt-clean (edition ${edition}, ADR-031)`,
);
