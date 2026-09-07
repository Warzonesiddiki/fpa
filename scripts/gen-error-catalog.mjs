#!/usr/bin/env node
// Generates src/pages/s076-help/errorCatalog.ts from docs/ERROR-HANDLING.md §2.
// The doc table is the single source of truth (ADR-027); this module is its compiled
// form for the in-app Error reference (ERROR-HANDLING §3 rule 5 — S-076).
//
//   node scripts/gen-error-catalog.mjs          # write the file
//   node scripts/gen-error-catalog.mjs --check  # exit 1 if out of sync (docs:verify 7e)
//
// Output is deterministic and prettier-stable: doc row order, 2-space indent,
// double quotes, trailing commas. A §2 row carries: code | cause | userMessage |
// httpStatus | retryable. Placeholders like {provider} survive verbatim.
import { readFileSync, writeFileSync } from "node:fs";
import * as prettier from "prettier";

const DOC = "docs/ERROR-HANDLING.md";
const OUT = "src/pages/s076-help/errorCatalog.ts";

const doc = readFileSync(DOC, "utf8");
const sec2 = doc.split("## 2.")[1]?.split("## 2B")[0];
if (!sec2) {
  console.error("gen-error-catalog: could not locate ERROR-HANDLING.md §2");
  process.exit(1);
}
// | CODE | cause | "copy with ""escaped"" quotes" | 422 | false |
// AUTH_LOCKED carries a parenthetical ("true (after countdown)") — the bare token is the contract.
const rowRe =
  /^\|\s*([A-Z][A-Z0-9_]+)\s*\|[^|]*\|[^|]*\|[^|]*\|\s*(true|false)(?: \([^)]*\))?\s*\|$/gm;
const codes = [];
const dupes = new Set();
for (const m of sec2.matchAll(rowRe)) {
  const line = m[0];
  const cells = line.split("|").map((c) => c.trim());
  // cells: ['', code, cause, copy, http, retry, '']
  const code = cells[1];
  if (dupes.has(code)) {
    console.error(`gen-error-catalog: duplicate §2 row ${code}`);
    process.exit(1);
  }
  dupes.add(code);
  const copyCell = cells[3];
  if (!/^".*"$/.test(copyCell)) {
    console.error(`gen-error-catalog: §2 row ${code} userMessage is not quoted: ${copyCell}`);
    process.exit(1);
  }
  const http = Number(cells[4]);
  if (!Number.isInteger(http)) {
    console.error(`gen-error-catalog: §2 row ${code} httpStatus is not an integer: ${cells[4]}`);
    process.exit(1);
  }
  codes.push({
    code,
    cause: cells[2],
    userMessage: copyCell.slice(1, -1).replace(/""/g, '"'),
    httpStatus: http,
    retryable: cells[5].replace(/ \(.*\)/, "") === "true",
  });
}
if (codes.length === 0) {
  console.error("gen-error-catalog: parsed 0 rows — §2 table format changed?");
  process.exit(1);
}

const ts = `// @generated — DO NOT EDIT. Regenerate with \`npm run errors:catalog\`.
// Source of truth: docs/ERROR-HANDLING.md §2 (${codes.length} codes). Sync-enforced by
// scripts/docs-verify.mjs (7e). Consumed by the S-076 in-app Error reference (§3 rule 5).

/** One §2 catalog row: the wire contract every screen renders (B12). */
export interface ErrorCatalogEntry {
  code: string;
  /** Short machine cause from the doc table (not user-facing copy). */
  cause: string;
  /** The exact catalog userMessage — what a user should read in-app. */
  userMessage: string;
  httpStatus: number;
  retryable: boolean;
}

export const ERROR_CATALOG: readonly ErrorCatalogEntry[] = [
${codes
  .map(
    (c) =>
      `  { code: ${JSON.stringify(c.code)}, cause: ${JSON.stringify(c.cause)}, userMessage: ${JSON.stringify(
        c.userMessage,
      )}, httpStatus: ${c.httpStatus}, retryable: ${c.retryable} },`,
  )
  .join("\n")}
] as const;
`;

const prettierOpts = {
  ...(await prettier.resolveConfig(OUT)),
  parser: "typescript",
};
const formatted = await prettier.format(ts, prettierOpts);

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== formatted) {
    console.error(
      `gen-error-catalog --check: ${OUT} is out of sync with ${DOC} §2 — run \`npm run errors:catalog\``,
    );
    process.exit(1);
  }
  console.log(`gen-error-catalog PASS — ${OUT} in sync with §2 (${codes.length} codes)`);
} else {
  // Prettier-formatted at generation time so fmt:check never fights the generator.
  writeFileSync(OUT, formatted);
  console.log(`gen-error-catalog: wrote ${OUT} (${codes.length} codes)`);
}
