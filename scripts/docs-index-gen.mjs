#!/usr/bin/env node
/** docs:index-gen — regenerates docs-index.json from docs/ (B8: single source = DOCS-INDEX.md). */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const files = readdirSync("docs")
  .filter((f) => f.endsWith(".md"))
  .sort();
const out = files.map((f) => ({
  file: f,
  bytes: readFileSync(join("docs", f), "utf8").length,
  lines: readFileSync(join("docs", f), "utf8").split("\n").length,
}));
writeFileSync(
  "docs-index.json",
  JSON.stringify({ generated_at: new Date().toISOString(), docs: out }, null, 2) + "\n",
);
console.log(`docs-index.json written (${out.length} docs)`);
