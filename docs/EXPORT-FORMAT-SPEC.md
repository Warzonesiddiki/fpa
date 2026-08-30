# EXPORT-FORMAT-SPEC.md

> OneFP&A · v1.0.0 · **Exact output contracts for Excel, PDF, Model Dump, Auditor Data-Room, and the Board Pack (F-030/F-031).** Determinism + injection safety + Health gate are non-negotiable (B18-1/7).

---

## 1. COMMON RULES (all exports)

| Rule | Value |
|---|---|
| Health gate | `health.run` must be `passed` or each finding waived with a reason → else `HEALTH_CHECK_BLOCKED` (no export) |
| Version stamp | every file carries `OneFP&A vX.Y.Z · Company · Model · Scenario[Version] · Period scope · exported_at UTC` |
| Rounding | display rounding per Report Layout, always with `largest_remainder=true` (MONEY-ROUNDING-SPEC §4) |
| Money | stored values exact; exported values display-rounded to the layout's decimals |
| Locale | numbers per layout/`format.*` settings; users may override per export (dialog) |
| Auditing | every export writes an Audit event (`export.excel` etc.) with file name + hash — traceable |
| Formula-Injection Guard | text cell beginning with `=`/`+`/`-`/`@` or `INSERT`/`UPDATE`/`DELETE` → quoted as text (prefixed `'` in xlsx writer) + one-time dialog note (never executes in the target app) |

## 2. EXCEL EXPORT (`.xlsx` — rust_xlsxwriter)

| Aspect | Spec |
|---|---|
| Engine | `rust_xlsxwriter` 0.79 (not exceljs — deterministic, no browser dependency) |
| Formulas | preserved where authored (cell `formula` string → real xlsx formula); computed values written alongside (cached) so viewers without recalc see exact values |
| Number formats | per-line decimals, thousands separator, `(1,234.00)` for negatives, `0.00%` for percentages |
| Structure | one sheet per statement/layout; freeze header row; first column frozen; column widths set; print area + fit-to-width; merged header cells only for section spans (with per-cell labels for a11y) |
| Hidden metadata | `OneFP&A-Meta` sheet: export version, hash, mapping version, Health Check status (never secrets) |
| Model Dump | see §4 |
| Determinism | identical workbook bytes for identical inputs on all 3 OS (hash test in CI) |

## 3. PDF EXPORT (`.pdf` — typst)

| Aspect | Spec |
|---|---|
| Engine | `typst` 0.12 crate; embedded fonts (Inter, JetBrains Mono subset); no system-font dependency |
| Structure | Tagged PDF (headings/table headers/reading order) — a11y parity (ACCESSIBILITY §6); page headers/footers with doc title + period; page numbers |
| Tables | repeating header rows on page break; footer note "rounded to 000s; exact source available in Excel export"; no orphan section title |
| Charts | ECharts rendered → SVG → typst vector embed (crisp at zoom) + accessible data table on the same page (toggleable) |
| Waterfall | explicit start/end bars with step labels; include a text summary line (color never sole signal) |
| Determinism | byte-identical PDF for identical input on 3 OS (hash gate) |

## 4. MODEL DUMP (full workbook, re-importable)

| Sheet layout | Contents |
|---|---|
| `Sheets` index | model name, horizon, scenario[version], calendar preset, period list, line counts |
| Per-Sheet | lines with `method`, `format`, `decimals`, period columns (P01…, YTD), values + formulas (formula column separate — round-trip) |
| `Drivers` | driver table (values by period + bounds + source) |
| `Assumptions` | register (all metadata) |
| `Layouts` | saved Report Layout JSONs |
| `Meta` | schema_version (dump), export version, Health status, pack version |

Round-trip contract: export→import into a fresh Company reproduces **identical model values** (cent-exact) — integration test `dump_roundtrip` (fixture in TEST-FIXTURES-SPEC §4). Import of a dump = `Import Batch kind=excel_csv` with mapping template "Model Dump" (pre-installed).

## 5. AUDITOR DATA-ROOM PACKAGE (F-033)

One `.zip` (or directory export) with:

```
manifest.json            # index, versions, hashes, generated_at
statements/              # P&L, BS, CF, SoCE, Segment (xlsx + pdf)
drivers/                 # driver registers + values (all scenarios)
assumptions/             # register snapshot + history
mappings/                # mapping templates used per batch (versions + checksums)
batches/                 # import batch metadata + per-batch validation report
source_files/            # original GL dumps (from Source Vault, compressed)
audit_chain/             # full audit JSON + chain verification report (HMAC verified)
health/                  # last health reports + waivers (with reasons)
license/                 # license status (no private key!)
```

Rules: all financial values already redaction-safe (values are the business data — the auditor needs them); no secrets; chain verified before packaging (`AUDIT_CHAIN_BREAK` → read-only + restore path); package hash recorded in Audit Trail.

## 6. BOARD PACK (F-030)

Fixed template order: Cover → Executive summary → KPI dashboard → P&L → Balance Sheet → Cash Flow → Segment (group) → Variance + commentary (Reason Codes) → Waterfalls → Notes/Adjusted items → glossary page.
Generation: `board_pack.generate` → preview (S-064) → Excel + PDF; `PACK_NO_COMMENTARY` blocks if commentary_required=1 and variance notes are empty (never ship an unexplained board pack).

*Referenced by: PRD F-030/F-031/F-033, SCREENS S-060–S-064/S-070, QA F-031, MONITORING.*
