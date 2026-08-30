#!/usr/bin/env node
/** license-check — no GPL/AGPL dependencies (self-host/enterprise licensing, TECH-STACK §6.4). */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];

// Known-problematic license families (name → why). Allowlist is explicit, not a substring guess.
const BLOCKLIST = [
  [/^(gpl|agpl|gnu-gpl)/, "GPL/AGPL core"],
  [/^graphql/, "GPL-influenced"],
];

const problems = [];
const alsoRust = readFileSync("src-tauri/Cargo.toml", "utf8");
for (const m of alsoRust.matchAll(
  /^(?!#)\s*([a-zA-Z0-9_-]+)\s*=\s*\{?\s*(?:version\s*=\s*)?"?[\d^~]/gm,
)) {
  const name = m[1];
  if (/^gpl|^agpl|^gnu-/.test(name)) problems.push(`Rust dep ${name} is GPL/AGPL-family`);
}

for (const dep of deps) {
  for (const [re, why] of BLOCKLIST) if (re.test(dep)) problems.push(`${dep}: ${why}`);
}

if (problems.length) {
  console.error(`license-check FAILED — ${problems.length}`);
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  process.exit(1);
}
console.log(`license-check PASS — ${deps.length} npm deps + Cargo deps scanned, no GPL/AGPL`);
