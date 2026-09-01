#!/usr/bin/env node
/**
 * docs-link-check — CI stage 11 (CI-CD.md §2): cross-reference integrity for the
 * doc suite. DOCS-INDEX convention 3 requires cross-references to be resolvable;
 * broken refs are zero-drift failures (B8).
 *
 *   node scripts/docs-link-check.mjs            # warn on broken refs
 *   node scripts/docs-link-check.mjs --strict   # exit 1 on ANY broken ref (CI)
 *
 * Checks (all .md in docs/ + root-level .md):
 *  1. Markdown links  [text](target)  — relative targets must exist.
 *  2. `*Referenced by: A.md, B.md*` footers — every named doc must exist in docs/.
 * Skips http(s)/mailto/#-only targets.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const strict = process.argv.includes("--strict");

const files = [];
for (const f of readdirSync("docs")) if (f.endsWith(".md")) files.push(join("docs", f));
for (const f of readdirSync(".")) if (f.endsWith(".md")) files.push(f);

const problems = [];
let checked = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const dir = dirname(resolve(file));
  /* 1. markdown links */
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    let target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split("#")[0];
    if (!target) continue;
    checked++;
    if (!existsSync(resolve(dir, target))) problems.push(`${file}: broken link → ${m[1]}`);
  }
  /* 2. "Referenced by:" footers (canonical cross-ref surface in this suite).
   * Targets resolve against docs/ or the repo root (README.md lives at root,
   * DOCS-INDEX row 31). */
  for (const m of text.matchAll(/\*Referenced by:\s*([^*]+)\*/g)) {
    for (const name of m[1].split(",")) {
      // last name of the footer carries the sentence's trailing period
      const doc = name.trim().replace(/`/g, "").replace(/\.$/, "");
      if (!/^[A-Z0-9-]+\.md$/.test(doc)) continue;
      checked++;
      if (!existsSync(join("docs", doc)) && !existsSync(doc))
        problems.push(`${file}: "Referenced by" points to missing doc → ${doc}`);
    }
  }
}

if (problems.length) {
  console.error(`docs-link-check FAILED — ${problems.length} broken ref(s)`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(strict ? 1 : 0);
}
console.log(
  `docs-link-check PASS — ${checked} cross-ref(s) checked across ${files.length} docs (strict=${strict})`,
);
