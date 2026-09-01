#!/usr/bin/env node
/**
 * money:ast — financial float gate (B3 / B18-2 / MONEY-ROUNDING-SPEC §8).
 * Fails on: parseFloat(, Math.round(, Number( in src/ or src-tauri/src/;
 * `.toFixed(` outside the designated display formatter; `REAL` money columns in migrations;
 * `f64`/`f32` money field names in Rust core modules.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const problems = [];

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "dist", "target", ".git"].includes(e)) continue;
      walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}

const tsFiles = walk(join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
for (const f of tsFiles) {
  const text = readFileSync(f, "utf8");
  const floatOps = [...text.matchAll(/parseFloat\s*\(|Math\.round\s*\(|\bNumber\s*\(/g)];
  for (const m of floatOps) problems.push(`${rel(f)}: financial float op '${m[0]}' (B3)`);
  const toFixed = [...text.matchAll(/\.toFixed\s*\(/g)];
  if (toFixed.length && !f.includes("utils/money.ts"))
    for (const m of toFixed)
      problems.push(`${rel(f)}: toFixed outside money display formatter (${m.index})`);
}

const rustFiles = walk(join(root, "src-tauri/src")).filter((f) => f.endsWith(".rs"));
// String-literal contents are masked before scanning: a hex fingerprint like
// "fp-…ff32e4…" contains the bytes `f32` but can never be a float type (B3 targets
// f64/f32 in CODE — types, casts, and arithmetic; string payloads are data, not math).
const maskRustStrings = (line) => line.replace(/"((?:[^"\\]|\\.)*)"/g, '""');
for (const f of rustFiles) {
  const text = readFileSync(f, "utf8");
  if (/f64|f32/.test(text)) {
    const lines = text.split("\n");
    lines.forEach((l, i) => {
      const code = maskRustStrings(l);
      if (/f64|f32/.test(code) && !l.trim().startsWith("//"))
        problems.push(`${rel(f)}:${i + 1}: float in core (B3)`);
    });
  }
}
for (const f of walk(join(root, "src-tauri/migrations")).filter((f) => f.endsWith(".sql"))) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/^\s*([a-z_]+)\s+REAL\b/gm)) {
    if (!/rate|weight|pct|percent/.test(m[1]))
      problems.push(`${rel(f)}: REAL money column '${m[1]}' (I1)`);
  }
}

function rel(p) {
  return p.slice(root.length + 1);
}

if (problems.length) {
  console.error(`money:ast FAILED — ${problems.length} violation(s)`);
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  process.exit(1);
}
console.log("money:ast PASS — no financial float paths (B3/B18-2)");
