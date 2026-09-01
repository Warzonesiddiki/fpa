#!/usr/bin/env node
/**
 * coverage-gate — CI stage 5 (CI-CD.md §2): enforces the documented coverage
 * thresholds on the vitest v8 `coverage-final.json` produced by the run that
 * just completed. Run immediately AFTER the matching vitest run:
 *
 *   npx vitest run --coverage            && node scripts/coverage-gate.mjs main
 *   npx vitest run --config vitest.critical.config.ts --coverage \
 *                 && node scripts/coverage-gate.mjs critical
 *
 * Thresholds MUST stay in sync with vitest.config.ts (main) and
 * vitest.critical.config.ts (critical) — CI-CD §2 stage 3/5, DEFINITION-OF-DONE §1.
 * Exit 1 (blocking) on any threshold miss or missing summary file.
 */
import { existsSync, readFileSync } from "node:fs";

const THRESHOLDS = {
  // metrics enforced on the aggregate: statements, branches, functions, lines
  main: { statements: 85, branches: 80, functions: 80, lines: 85 },
  critical: { statements: 95, branches: 90, functions: 90, lines: 95 },
};

const mode = process.argv[2] ?? "main";
const min = THRESHOLDS[mode];
if (!min) {
  console.error(`coverage-gate FAILED — unknown mode '${mode}' (use 'main' | 'critical')`);
  process.exit(1);
}

const file = "coverage/coverage-final.json";
if (!existsSync(file)) {
  console.error(
    `coverage-gate FAILED — ${file} not found. Run the matching vitest run with --coverage first.`,
  );
  process.exit(1);
}

let final;
try {
  final = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`coverage-gate FAILED — cannot parse ${file}: ${e.message}`);
  process.exit(1);
}

/* v8 final format: per file { s/f: { counterIndex: hits }, b: { branchIndex: [hits per arm] | null } }.
 * A counter is covered when hits > 0; null branch entries (unreachable) are excluded
 * from the denominator (same semantics as vitest's own report).
 * Lines: the v8 final JSON carries no line map, so this gate derives the conservative
 * proxy "a line is covered iff a statement STARTING on it is covered" (underestimates
 * vitest's text metric → stricter). The exact lines threshold is ALSO hard-enforced by
 * vitest itself at run time (non-zero exit), so no gate is lost. */
const agg = { statements: [0, 0], branches: [0, 0], functions: [0, 0], lines: [0, 0] };
const addHits = (key, hits) => {
  if (hits === null) return;
  agg[key][0] += hits > 0 ? 1 : 0;
  agg[key][1] += 1;
};
for (const entry of Object.values(final)) {
  if (entry.s && typeof entry.s === "object")
    for (const h of Object.values(entry.s)) addHits("statements", h);
  if (entry.f && typeof entry.f === "object")
    for (const h of Object.values(entry.f)) addHits("functions", h);
  if (entry.b && typeof entry.b === "object")
    for (const arms of Object.values(entry.b))
      if (Array.isArray(arms)) for (const h of arms) addHits("branches", h);
  const startLines = new Map();
  if (entry.statementMap)
    for (const [idx, range] of Object.entries(entry.statementMap)) {
      const ln = range?.start?.line ?? 0;
      if (ln <= 0) continue;
      const covered = (entry.s?.[idx] ?? 0) > 0;
      startLines.set(ln, startLines.has(ln) ? startLines.get(ln) && covered : covered);
    }
  for (const covered of startLines.values()) {
    agg.lines[1] += 1;
    if (covered) agg.lines[0] += 1;
  }
}

const pct = (key) => (agg[key][1] === 0 ? 100 : (agg[key][0] / agg[key][1]) * 100);
const problems = [];
for (const [metric, floor] of Object.entries(min)) {
  const p = pct(metric);
  if (p < floor) problems.push(`${metric}: ${p.toFixed(2)}% < ${floor}% floor`);
}

if (problems.length) {
  console.error(`coverage-gate FAILED (${mode}) — ${problems.length} threshold miss(es)`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(
  `coverage-gate PASS (${mode}) — ` +
    Object.entries(min)
      .map(([k]) => `${k} ${pct(k).toFixed(2)}% (≥${min[k]}%)`)
      .join(" · "),
);
