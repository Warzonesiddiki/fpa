#!/usr/bin/env node
/** secret-scan — never commit credentials (ENV-VARIABLES §4; B18-4). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const problems = [];
function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "dist", "target", ".git", "reports"].includes(e)) continue;
      walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}

const patterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, "private key block"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, "api key literal"],
  [/ghp_[A-Za-z0-9]{36}/, "GitHub token"],
  [/xox[baprs]-/i, "Slack token"],
  [/sk-[A-Za-z0-9]{20,}/, "secret key pattern"],
];

const files = [
  ...walk(join(root, "src")),
  ...walk(join(root, "src-tauri")),
  ...walk(join(root, "scripts")),
];
for (const f of files) {
  if (!/\.(ts|tsx|rs|js|mjs|py)$/.test(f)) continue;
  const text = readFileSync(f, "utf8");
  for (const [re, label] of patterns) {
    const m = text.match(re);
    if (m) problems.push(`${f.replace(root + "/", "")}: ${label} (${m[0].slice(0, 20)}…)`);
  }
}
// docs example licenses must be clearly "example" only
const docs = [...walk(join(root, "docs"))];
for (const f of docs) {
  if (!f.endsWith(".md")) continue;
  const text = readFileSync(f, "utf8");
  const m = text.match(/LICENSE_INVALID_SIGNATURE|private key/i);
  // informational: only flag realistic secrets
  if (m && /-----BEGIN/.test(text))
    problems.push(`${f.replace(root + "/", "")}: embedded key material`);
}

if (problems.length) {
  console.error(`secret-scan FAILED — ${problems.length}`);
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  process.exit(1);
}
console.log("secret-scan PASS — no credentials in repo");
