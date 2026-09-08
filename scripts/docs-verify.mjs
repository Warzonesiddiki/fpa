#!/usr/bin/env node
/**
 * docs:verify — machine gate for the documentation suite (B8, B10, B18-7).
 * Mirrors the Stage-3 audit: index↔files, ID definitions vs references, counts, banned terms.
 * Exit 1 (blocking) on ANY finding.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DOCS = "docs";
const files = readdirSync(DOCS)
  .filter((f) => f.endsWith(".md"))
  .sort();
const index = readFileSync(join(DOCS, "DOCS-INDEX.md"), "utf8");
const problems = [];
const err = (m) => problems.push(m);

/* 1. Index completeness (B8: off-index docs forbidden; index self-excluded) */
const indexRows = [...index.matchAll(/^\|\s*(\d+)\s*\|\s*`([^`]+\.md)`/gm)].map((m) => m[2]);
const allIndexRows = [...index.matchAll(/^\|\s*(\d+)\s*\|\s*`([^`]+)`/gm)].map((m) => m[2]);
for (const f of files)
  if (f !== "DOCS-INDEX.md" && !indexRows.includes(f)) err(`off-index doc: ${f}`);
// README.md is listed as a pointer row in DOCS-INDEX (root README, not a docs/ spec) — allowed.
const indexed = indexRows.filter((f) => f !== "DOCS-INDEX.md");
for (const f of indexed)
  if (f !== "README.md" && !files.includes(f)) err(`index references missing file: ${f}`);
if (indexed.length !== files.length)
  err(
    `count mismatch: index docs=${indexed.length} actual=${files.length} (README pointer row allowed)`,
  );

// CRLF-tolerant read (B18-8): a Windows checkout must parse identically to LF.
const read = (f) => readFileSync(join(DOCS, f), "utf8").replace(/\r\n/g, "\n");
const all = Object.fromEntries(files.map((f) => [f, read(f)]));
const idDefs = (text, re) => new Set([...text.matchAll(re)].map((m) => m[1]));
const idRefs = (re) => {
  const s = new Set();
  for (const [f, t] of Object.entries(all)) {
    if (f === "SCREENS-SPEC.md" || f === "USER-STORIES.md" || f === "PRD.md") continue;
    for (const m of t.matchAll(re)) s.add(m[1] ?? m[0]);
  }
  return s;
};
// (regexes written with or without capture groups — both supported)

/* 2. Screens: every S-### referenced must be defined (SCREENS-SPEC `### S-###`); S-001..S-076 all defined */
const screenDefs = idDefs(all["SCREENS-SPEC.md"], /^###\s+(S-\d{3})/gm);
const screenRefs = idRefs(/(?<![A-Z])S-\d{3}/g);
for (const r of screenRefs) if (!screenDefs.has(r)) err(`orphan screen ref: ${r}`);
if (screenDefs.size !== 42) err(`screen count ${screenDefs.size} != 42`);

/* 3. Each screen has all 5 states */
for (const id of screenDefs) {
  const body =
    all["SCREENS-SPEC.md"].split(new RegExp(`^### ${id} `, "m"))[1]?.split(/^### /m)[0] ?? "";
  for (const st of ["Loading", "Empty", "Error", "Success", "Populated"])
    if (!body.includes(`**${st}:**`)) err(`screen ${id} missing state ${st}`);
}

/* 4. User stories */
const usDefs = idDefs(all["USER-STORIES.md"], /^###\s+(US-\d{3})/gm);
const usRefs = idRefs(/(?<![A-Z])US-\d{3}/g);
for (const r of usRefs) if (!usDefs.has(r)) err(`orphan story ref: ${r}`);

/* 5. Features: refs must be F-001..F-038 (no F-000 artifacts) */
const featRefs = idRefs(/(?<![A-Z])F-\d{3}/g);
for (const r of featRefs)
  if (!/^F-0(0[1-9]|[123][0-9]|38)$/.test(r)) err(`invalid feature ref: ${r}`);

/* 6. Dialogs D-001..D-010 */
const dlgs = new Set(
  [...all["SCREENS-SPEC.md"].matchAll(/^\|\s*(D-\d{3})\s*\|/gm)].map((m) => m[1]),
);
for (const r of idRefs(/(?<![A-Z])\bD-\d{3}/g)) if (!dlgs.has(r)) err(`orphan dialog ref: ${r}`);

/* 7. API command rows must only reference defined error codes */
const errDefs = idDefs(all["ERROR-HANDLING.md"], /^\|\s*([A-Z][A-Z0-9_]+)\s*\|/gm);
const api = all["API-SPEC.md"];
let cmdCount = 0;
for (const line of api.split("\n")) {
  const m = line.match(/^\|\s*`([a-z_]+\.[a-z0-9_.]+)`/);
  if (!m) continue;
  cmdCount +=
    line
      .split("`")
      .filter((_, i) => i % 2 === 1)
      .join(" ")
      .match(/[a-z_]+\.[a-z0-9_.]+/g)?.length ?? 0;
  for (const c of line.matchAll(/`[a-z_]+\.[a-z0-9_.]+`/g)) cmdCount += 0; // tokens (noop, kept simple)
}
/* 7b. Error codes cited in API-SPEC.md must exist in ERROR-HANDLING.md §2.
   KI-015 (found 2026-09-04): the original condition `!errDefs.has(c) &&
   !["AUTH_PIN_INVALID","AUTH_LOCKED"].every((x) => x !== c)` was unsatisfiable — the second
   clause needs `c` to BE one of two codes that are both defined — so the rule could never
   fire, and its loose regex was equally unusable (55 hits on API-SPEC alone: `NULL`, `JSON`,
   section titles). Rewritten 2026-09-05 as a live check with a ratchet:
     · a citation is one of the three shapes this suite actually uses: a code in the trailing
       Errors cell of a catalog row, a backticked SCREAMING_SNAKE token, or a `"CODE: …"`
       prefix inside a JSON example (≥1 underscore required, which is what excludes `NULL`,
       `JSON` and section titles that the old regex treated as codes);
     · UNDEFINED_CODE_BASELINE parks the drift that predates the fix and **may only shrink** —
       an entry that becomes defined, or stops being cited, fails the run;
     · the probe self-test proves the matcher fires, so this guard cannot go inert again. */
const CODE_SHAPE = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g;
// §2B of ERROR-HANDLING.md is the ONLY exemption source: a validator message prefix is a legal
// token in the API catalog precisely when the spec declares it and names a governing code that
// itself exists in §2. KI-015's hand-maintained baseline list is deleted — the exemption now
// lives in the spec, so widening the docs is the only way to widen the gate (ADR-027).
const validatorPrefixes = new Map(
  [
    ...all["ERROR-HANDLING.md"].matchAll(
      /^- `([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)` → \*\*([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\*\*/gm,
    ),
  ].map((m) => [m[1], m[2]]),
);
for (const [prefix, governing] of validatorPrefixes)
  if (!errDefs.has(governing))
    err(
      `ERROR-HANDLING 2B: prefix ${prefix} cites governing code ${governing}, which §2 does not define`,
    );
// 14 = 7 import-row validators + 5 command-argument validators (batch name,
// rollback reason, company-delete reason) + IMPORT_KIND_DESTINATION_UNAVAILABLE
// + the INVALID_ARGUMENT note. Bump only when a prefix is added/dropped
// deliberately alongside its Rust assertion.
if (validatorPrefixes.size !== 14)
  err(
    `ERROR-HANDLING 2B: expected 14 validator prefixes, parsed ${validatorPrefixes.size} — the section format changed`,
  );
const citations = (text) => {
  const out = new Set();
  for (const line of text.split("\n")) {
    if (/^\|\s*`[a-z_]+\.[a-z0-9_.]+`/.test(line)) {
      const cells = line.split("|");
      const errorsCell = cells[cells.length - 2] ?? ""; // the trailing Errors column
      for (const m of errorsCell.matchAll(CODE_SHAPE)) out.add(m[0]);
    }
    for (const m of line.matchAll(/`([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)`/g)) out.add(m[1]);
    for (const m of line.matchAll(/"([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+): /g)) out.add(m[1]);
  }
  return out;
};
/* §2C reserved names: cited by specs, produced nowhere. 7b accepts them as known
   citations (specs may name them), but 7d proves §2 itself contains only codes real
   code emits — a catalog row with no producer is a phantom (found 2026-09-07: 13). */
const sec2c = all["ERROR-HANDLING.md"].split("## 2C.")[1]?.split(/\n## /)[0] ?? "";
const reservedNames = new Set(
  sec2c
    .split("\n")
    .filter((l) => /^- `/.test(l) && l.includes("→"))
    .flatMap((l) =>
      [...l.slice(0, l.indexOf("→")).matchAll(/`([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)`/g)].map(
        (m) => m[1],
      ),
    ),
);
const knownCode = (c) => errDefs.has(c) || validatorPrefixes.has(c) || reservedNames.has(c);
const citedCodes = citations(api);
for (const c of [...citedCodes].sort())
  if (!knownCode(c)) err(`API references undefined code: ${c}`);
{
  // Mutation self-test on the same path the file uses: a fake code in a real catalog row MUST be
  // caught, or this guard is dead — that is exactly how KI-015 hid for a whole revision.
  const probeRow = "| `probe.fake_command` | session | `{x}` | `{ok}` | ZZ_GUARD_PROBE_CODE |";
  const caught = [...citations(probeRow)].some((c) => !knownCode(c));
  if (!caught)
    err("docs:verify self-test FAILED: the undefined-code guard is inert (KI-015 regression)");
}

/* 7d. Phantom guard — every §2 code must be emitted by real code (2026-09-07).
   A §2 row that no non-test source under src/ or src-tauri/src/ quotes is a phantom:
   documented-as-built but unimplemented. Quote-delimited (", ', `) in .ts/.tsx/.rs;
   tests are excluded as evidence (a test asserting a code proves nothing produces it).
   KI-015 lesson applied: a mutation self-test proves the guard fires. */
{
  const { readdirSync, readFileSync } = await import("node:fs");
  const blob = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}/${e.name}`);
      else if (
        (/\.(ts|tsx|rs)$/.test(e.name) && !/\.test\./.test(e.name) && !/_test\.rs$/.test(e.name)) ||
        (e.name.endsWith(".json") && d.replaceAll("\\", "/").endsWith("src/i18n"))
      )
        blob.push(readFileSync(`${d}/${e.name}`, "utf8"));
    }
  };
  walk("src");
  walk("src-tauri/src");
  const code = blob.join("\n");
  const produced = (c) =>
    code.includes(`\"${c}\"`) || code.includes(`'${c}'`) || code.includes(`\`${c}\``);
  for (const c of errDefs)
    if (!produced(c))
      err(
        `ERROR-HANDLING §2 phantom: ${c} is documented but produced nowhere under src/ or src-tauri/src/ (move it to §2C or implement it)`,
      );
  // 7e. The compiled in-app Error reference (src/pages/s076-help/errorCatalog.ts,
  // consumed by S-076) must be byte-identical to what §2 generates now.
  {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync(process.execPath, ["scripts/gen-error-catalog.mjs", "--check"], {
        stdio: "pipe",
      });
    } catch {
      err(
        "errorCatalog.ts is out of sync with ERROR-HANDLING.md §2 — run `npm run errors:catalog`",
      );
    }
  }
  // self-test: a fake §2 row must be caught, or this guard is dead.
  const fake = "ZZ_PHANTOM_GUARD_PROBE";
  const fakeDefs = idDefs(`| ${fake} | x | "x" | 422 | false |`, /^\|\s*([A-Z][A-Z0-9_]+)\s*\|/gm);
  if (!(!produced(fake) && fakeDefs.has(fake)))
    err("docs:verify self-test FAILED: the phantom guard is inert");
}

/* 7f. Screen error contracts: every code on a SCREENS-SPEC "- **Error:**" line
   must exist in ERROR-HANDLING §2 (produced) or §2C (reserved) — a screen citing
   an uncataloged code is B12 drift (found 2026-09-07: 2 screen-invented codes). */
{
  const screenErr = new Set();
  for (const line of (all["SCREENS-SPEC.md"] ?? "").split("\n")) {
    if (/^- \*\*Error:\*\*/.test(line))
      for (const m of line.matchAll(/`([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)`/g)) screenErr.add(m[1]);
  }
  for (const c of screenErr)
    if (!errDefs.has(c) && !reservedNames.has(c))
      err(
        `SCREENS-SPEC Error line cites uncataloged code: ${c} (add it to §2/§2C or map the screen to a catalog code)`,
      );
  // self-test: the matcher must fire on a fake screen error line.
  const fakeLine = "- **Error:** `ZZ_SCREEN_GUARD_PROBE`.";
  const caught = [...fakeLine.matchAll(/`([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)`/g)].some(
    ([, c]) => !errDefs.has(c) && !reservedNames.has(c),
  );
  if (!caught) err("docs:verify self-test FAILED: the screen-error guard is inert");
}

/* 8. Banned-term scan (GLOSSARY synonyms used as domain terms — context-filtered) */
const banned = /(?<![A-Za-z])(workspace|uploaded?|metric)(?![A-Za-z])/gi;
for (const [f, t] of Object.entries(all)) {
  for (const m of t.matchAll(banned)) {
    const ctx = t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ");
    if (
      /(banned|synonym|never|not Metric|not metric|rust|Cargo|file upload|financial-metric|fixed 4|meets? the metric|the metric in|metric in PERFORMANCE|metric cards|no telemetry|product metrics|adoption metrics|Score|Entity\/Workspace|Tenant|Organization|Screens, DB, Auth|Workspace, Tenant)/i.test(
        ctx,
      )
    )
      continue;
    err(`banned term in ${f}: …${ctx}…`);
  }
}

/* 9. TBD / placeholders */
for (const [f, t] of Object.entries(all)) {
  for (const m of t.matchAll(/\bTBD\b|to be determined|decide later|figure out later/gi)) {
    const ctx = t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ");
    if (/no TBD|never TBD|without TBD|no tbd|TBD \(B18|TODO\`, `FIXME/i.test(ctx)) continue;
    err(`TBD in ${f}: …${ctx}…`);
  }
}

/* 10. Ground-truth count claims embedded in headers */
const claims = [
  ["42 screens", /42 screens/],
  ["103 commands", /103 typed commands/],
  ["56 tables", /56 \(49 original/],
  ["87 errors", /87 \(2026-09-08/],
  ["60 docs", /60 docs\/ specs/],
];
for (const [label, re] of claims) {
  const hit = files.some((f) => re.test(all[f]));
  if (!hit) err(`claim not found in any doc: ${label}`);
}

if (problems.length) {
  console.error(`docs:verify FAILED — ${problems.length} finding(s)`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(
  `docs:verify PASS — ${files.length - 1} docs indexed, ${screenDefs.size} screens, ${cmdCount} command rows, ${errDefs.size} error codes, ${reservedNames.size} reserved names`,
);
