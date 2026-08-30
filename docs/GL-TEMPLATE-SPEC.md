# GL-TEMPLATE-SPEC.md

> OneFP&A · v1.0.0 · **The Canonical GL Template — the documented layout every GL Dump can be mapped to, and the file format we export as a starter template (F-007/F-008/F-011/B19).** "Any ERP dump can be imported" is guaranteed by the mapping wizard, not by this template — but this template makes it one click.

---

## 1. FILE FORMAT

| Attribute | Value |
|---|---|
| Extensions | `.xlsx` (primary) · `.csv` (UTF-8, delimiter `,` or `;` for EU) · `.tsv` · `.zip` (one workbook) |
| Sheets | `GL` (required) · optional `Mapping Notes`, `COA`, `Dimensions`, `Opening Balances` |
| Header row | row 1 (always; frozen in our export) |
| Encoding | UTF-8 with BOM detection; Latin-1 auto-detected w/ preview |
| Locale | numbers with `,` or `.` decimal per source; import preview confirms (never guessed) |
| Date | ISO `YYYY-MM-DD` or `YYYYMM` period column; EU `DD.MM.YYYY` accepted w/ confirmation |

## 2. COLUMNS (Canonical GL Template — GL sheet)

| # | Column | Required | Type | Rules |
|---|---|---|---|---|
| 1 | `period` | ✅ | `YYYY-MM` or `YYYYMMDD` | maps to Fiscal Period (calendar-aware). `FY26-P08` accepted for week-based calendars |
| 2 | `account_code` | ✅ | text | normalized code (leading zeros preserved) |
| 3 | `account_name` | ⬜ | text | used to disambiguate; never a key |
| 4 | `debit` | ✅* | decimal (≥ 2 dp) | *either Debit/Credit OR signed `amount`; not both |
| 5 | `credit` | ✅* | decimal | see above |
| 6 | `amount` | ✅* | signed decimal | debit-positive convention; credit-negative |
| 7 | `cost_center` | ⬜ | text | first Dimension (key must exist or auto-create w/ confirm) |
| 8 | `project` | ⬜ | text | Dimension |
| 9 | `product` | ⬜ | text | Dimension |
| 10 | `customer` | ⬜ | text | Dimension |
| 11 | `business_unit` | ⬜ | text | BU key; required for Group imports (HARD if missing in Group mode) |
| 12 | `intercompany_tag` | ⬜ | `src_bu→dst_bu` | e.g., `bu-manu→bu-retail`; creates `ic_lines` + elimination |
| 13 | `currency` | ⬜ | ISO 4217 | defaults to Company/BU currency; `CURRENCY_UNKNOWN` if unrecognized |
| 14 | `posting_ref` | ⬜ | text | dedupe key (batch + ref unique; duplicate → WARNING → user choice) |
| 15 | `doc_type` | ⬜ | text | informational |
| 16 | `source_row` | auto | integer | generated; used in per-row error report |

## 3. SIGN CONVENTIONS (exact — import)

| Source layout | Converted to | Canonical store |
|---|---|---|
| Debit/Credit columns | debit − credit | `amount_minor` signed (debit +, credit −) |
| Signed `amount` with `debit_positive` | as-is | same |
| Signed `amount` with `credit_positive` (rare, some ERPs) | −amount | same; mapping explicitly toggles (never auto-detected silently) |
| Reversed/contra accounts (e.g., contra-revenue, allowance) | code normalization maps "contra" accounts to their Type with `is_control` flag; amounts stay signed; report section places them as deductions per Pack COA | model math unchanged |

**Tie-Out gate:** Σ(`debit`) = Σ(`credit`) (or Σ(`amount`) = source-reported balance when the source provides one). Mismatch → `IMPORT_TIE_OUT_FAILED` with exact diff rows; exclude-with-log allowed (never silent).

## 4. EXAMPLE ROWS

```
period,account_code,account_name,debit,credit,cost_center,business_unit,currency,posting_ref,doc_type
2026-08,4000,Sales Revenue,,6350000.00,sales_north,bu-manu,USD,INV-2001,INVOICE
2026-08,4100,Direct Materials,1825000.00,,plant_a,bu-manu,USD,PO-8811,PURCHASE
2026-08,1200,AR - Trade,,,  ← invalid (no amount, no debit/credit pair) → HARD row error
```

## 5. SUB-SHEETS (optional but recommended)

| Sheet | Columns | Purpose |
|---|---|---|
| `COA` | code, name, type, section, parent_code | pre-creates Accounts (COA import); missing vs existing → diff prompt |
| `Dimensions` | dimension_key, code, name, parent_code | pre-creates Dimension Values; auto-create flag with confirm |
| `Opening Balances` | period, account_code, debit, credit | imports as Opening Balances batch (guarded once — `OPENING_ALREADY_SET`) |
| `Mapping Notes` | free text | human notes; ignored by parser |

## 6. PERFORMANCE & ERROR HANDLING

| Case | Behavior |
|---|---|
| 500k rows | streamed, background, progress %, cancellable; memory < 2 GB |
| Duplicate (batch, source_row) | HARD row error with exact source row |
| Period outside Company calendar range | HARD `PERIOD_OUT_OF_RANGE` (row listed; import blocked until excluded) |
| Account missing from COA at commit | HARD `MAP_ACCOUNT_AMBIGUOUS`/`ACCOUNT_MISSING` → offer "create from name (confirmed)" — never auto-create without confirm |
| Blank required column | HARD per-row error; error report exportable (CSV) |
| Formula-looking text in source (`=...`) | treated as text; import never executes cells (injection safety) |

## 7. MAPPING TEMPLATE DEFAULT (bundled with the Canonical GL Template)

A Mapping Template "OneFP&A Canonical GL" is pre-installed mapping columns 1–15 to the exact fields above — importing a file that already follows this layout needs **zero mapping steps** (Preview shows "100% auto-mapped").

*Referenced by: PRD F-007/F-008/F-011, INTEGRATIONS, TEST-FIXTURES-SPEC, ERROR-HANDLING C.*
