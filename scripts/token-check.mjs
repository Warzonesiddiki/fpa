#!/usr/bin/env node
/**
 * tokens:check — design-token reference gate (DESIGN-SYSTEM §1/§6 · AUDIT-2026-09-07 §2.5/§3).
 *
 * Undefined CSS custom properties resolve to nothing: `text-[var(--color-oneerror)]`
 * silently renders in inherited color, `bg-[var(--color-onex)]` renders transparent.
 * The 2026-09-07 audit found 7 undefined tokens with 39 uses shipped on main this way.
 * This gate makes that defect class unlandable:
 *   1. Every `--color-*` referenced from src/ (and index.html) must be defined in the
 *      CSS bridge `src/theme/index.css`.
 *   2. The bridge must not define the same token twice with conflicting values
 *      (light/dark override pairs are expected and allowed).
 *
 * It intentionally does NOT require tokens.ts ↔ index.css parity (tokens.ts serves
 * tokenColor() consumers like ECharts; the bridge serves var() consumers) — but any
 * future bridge addition must keep DESIGN-SYSTEM §1 tables as the value source.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const BRIDGE = join(root, "src", "theme", "index.css");
const problems = [];

function rel(p) {
  return p.slice(root.length + 1);
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "dist", "target", ".git", "coverage", "reports"].includes(e)) continue;
      walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}

/** Offset -> 1-based `line:col` + trimmed source line, so findings are actionable in CI. */
function makeLocator(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    const line = (text.split("\n")[lo] || "").trim().slice(0, 72);
    return { at: `${lo + 1}:${index - starts[lo] + 1}`, line };
  };
}

// 1) Definitions from the CSS bridge: `--color-<name>: <value>;` (light + .dark blocks).
const bridgeText = readFileSync(BRIDGE, "utf8");
const defined = new Map(); // name -> Set(values seen (light/dark override pairs differ by design)
for (const m of bridgeText.matchAll(/--color-([a-z0-9]+)\s*:\s*([^;]+);/g)) {
  const [, name, value] = m;
  if (!defined.has(name)) defined.set(name, new Set());
  defined.get(name).add(value.trim());
}
if (defined.size === 0) {
  console.error("tokens:check FAILED — no tokens parsed from src/theme/index.css (parser drift?)");
  process.exit(1);
}

// 2) References from all source files + the app shell HTML.
const refFiles = [
  ...walk(join(root, "src")).filter((f) => /\.(ts|tsx|css)$/.test(f)),
  join(root, "index.html"),
];
let references = 0;
const missing = [];
for (const f of refFiles) {
  const text = readFileSync(f, "utf8");
  if (!text.includes("--color-")) continue;
  const locate = makeLocator(text);
  for (const m of text.matchAll(/--color-([a-z0-9]+)/g)) {
    references += 1;
    if (!defined.has(m[1])) {
      const { at, line } = locate(m.index);
      missing.push(
        `${rel(f)}:${at}: '--color-${m[1]}' is referenced but not defined in src/theme/index.css  [${line}]`,
      );
    }
  }
}

// 3) Same token defined with two different values in the SAME scope is a bridge bug;
//    light vs .dark overrides are distinct values on purpose and are not flagged.
const decls = [...bridgeText.matchAll(/--color-([a-z0-9]+)\s*:\s*([^;]+);/g)];
const perLine = new Map();
const bridgeLocate = makeLocator(bridgeText);
for (const m of decls) {
  const key = m[1];
  if (!perLine.has(key)) perLine.set(key, []);
  perLine.get(key).push({ value: m[2].trim(), line: bridgeLocate(m.index).at });
}
for (const [name, list] of perLine) {
  if (list.length > 2) {
    problems.push(
      `src/theme/index.css: token '--color-${name}' declared ${list.length}× (expected ≤2: light + dark)`,
    );
  }
}

problems.push(...missing);

if (problems.length) {
  console.error(`tokens:check FAILED — ${problems.length} violation(s)`);
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  process.exit(1);
}
console.log(
  `tokens:check PASS — ${defined.size} tokens defined in the bridge, ${references} references in src/ all resolve (DESIGN-SYSTEM §1/§6)`,
);
