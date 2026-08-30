#!/usr/bin/env node
/** telemetry-scan — zero telemetry gate (B18-9 / A7). No fetch/websocket/analytics in shipped UI. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const problems = [];
function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "dist", "target"].includes(e)) continue;
      walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}

const forbidden =
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\baxios\b|\bsentry\b|\banalytica|\bposthog\b|\bamplitude\b/gi;
for (const f of walk(join(root, "src"))) {
  if (!/\.(ts|tsx)$/.test(f)) continue;
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(forbidden)) {
    const ctx = text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, " ");
    problems.push(`${f.replace(root + "/", "")}: ${m[0]} → …${ctx}…`);
  }
}

if (problems.length) {
  console.error(`telemetry-scan FAILED — network/telemetry found in shipped UI`);
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  process.exit(1);
}
console.log("telemetry-scan PASS — no telemetry/analytics code in src/ (B18-9)");
