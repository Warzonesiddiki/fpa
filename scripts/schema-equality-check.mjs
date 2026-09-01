#!/usr/bin/env node
/**
 * schema-equality-check — CI stage 6 (CI-CD.md §2): zero drift between the
 * migration SQL (source of truth for storage, B4) and DATABASE-SCHEMA.md (B8).
 *
 * Checks:
 *  1. Table sets identical: every CREATE TABLE in src-tauri/migrations/*.sql
 *     has a `### `table`` section in DATABASE-SCHEMA.md and vice versa
 *     (joined sections name several tables, e.g. `backups` / `snapshots`).
 *  2. Column coverage: for each table, EVERY SQL column name must appear as a
 *     whole word in its doc section body (the doc documents columns in several
 *     notations — plain rows, `table.col/col` qualified rows, slash/comma
 *     lists, parenthetical composite rows — so containment is the honest
 *     check; a column absent from the whole section is a real doc gap).
 *  3. Money safety (I1/B18-2): no float type (REAL/DOUBLE/FLOAT) on a
 *     money-shaped column (names matching: amount, _minor, _decimal, balance).
 *
 * Exit 1 (blocking) on any finding.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const problems = [];
const err = (m) => problems.push(m);

/* ---- 1. Parse migrations (all files, version order) ---- */
const migDir = "src-tauri/migrations";
const sqlTables = new Map(); // name -> [columns]
if (!existsSync(migDir)) {
  err(`migration dir missing: ${migDir}`);
} else {
  for (const f of readdirSync(migDir)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const clean = readFileSync(join(migDir, f), "utf8")
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    for (const m of clean.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\)/gi,
    )) {
      const name = m[1];
      const cols = [];
      for (const line of m[2].split("\n")) {
        const cm = line.match(
          /^\s*([a-z_][a-z0-9_]*)\s+(TEXT|INTEGER|REAL|DOUBLE|FLOAT|NUMERIC|BLOB)\b/i,
        );
        if (cm && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(cm[1])) cols.push(cm[1]);
      }
      if (sqlTables.has(name)) err(`duplicate CREATE TABLE ${name} across migrations`);
      sqlTables.set(name, cols);
    }
  }
}

/* ---- 2. Parse DATABASE-SCHEMA.md sections (heading → body) ---- */
const doc = readFileSync("docs/DATABASE-SCHEMA.md", "utf8");
const docSections = new Map(); // table -> section body text
{
  const lines = doc.split("\n");
  let currentNames = [];
  let body = [];
  const flush = () => {
    for (const t of currentNames) if (!docSections.has(t)) docSections.set(t, "");
    for (const t of currentNames)
      docSections.set(t, (docSections.get(t) ?? "") + body.join("\n") + "\n");
    body = [];
  };
  for (const line of lines) {
    const h = line.match(/^###\s+(.*)$/);
    if (h) {
      flush();
      currentNames = [...h[1].matchAll(/`([a-z_][a-z0-9_]*)`/g)].map((x) => x[1]);
      if (!currentNames.length) currentNames = [];
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      currentNames = [];
      continue;
    }
    if (currentNames.length) body.push(line);
  }
  flush();
}

/* ---- 3. Table-set equality ---- */
for (const t of sqlTables.keys())
  if (!docSections.has(t)) err(`table in migrations but missing from DATABASE-SCHEMA.md: ${t}`);
for (const t of docSections.keys())
  if (!sqlTables.has(t)) err(`table in DATABASE-SCHEMA.md but missing from migrations: ${t}`);

/* ---- 4. Column coverage (section containment) + money safety ---- */
for (const [t, cols] of sqlTables) {
  const section = docSections.get(t) ?? "";
  for (const c of cols) {
    if (!new RegExp(`\\b${c}\\b`).test(section))
      err(`column ${t}.${c} not documented in its DATABASE-SCHEMA.md section`);
  }
}
for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql"))) {
  const text = readFileSync(join(migDir, f), "utf8")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
  for (const m of text.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+(REAL|DOUBLE|FLOAT)\b/gim)) {
    if (/amount|_minor$|_decimal|balance/i.test(m[1]))
      err(
        `I1 violation: money-shaped column '${m[1]}' declared ${m[2]} (money must be INTEGER minor units / TEXT decimal)`,
      );
  }
}

if (problems.length) {
  console.error(`schema-equality-check FAILED — ${problems.length} finding(s)`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(
  `schema-equality-check PASS — ${sqlTables.size} tables, all SQL columns documented, no float money columns (I1)`,
);
