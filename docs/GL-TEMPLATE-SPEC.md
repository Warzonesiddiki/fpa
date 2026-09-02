# GL-TEMPLATE-SPEC.md

> OneFP&A · v1.0.0 · **The Canonical GL Template — the documented layout every GL Dump can be mapped to, and the file format we export as a starter template (F-007/F-008/F-011/B19).** "Any ERP dump can be imported" is guaranteed by the mapping wizard, not by this template — but this template makes it one click.

---

## 1. FILE FORMAT

| Attribute | Value |
|---|---|
| Extensions | Current registered parser: `.xlsx`/`.xlsm`/`.xlsb`/`.xls`/`.ods` · `.csv` (UTF-8, delimiter `,` or `;` for EU) · `.tsv` · `.txt`. `.zip` (one workbook) remains a target only: the native parser explicitly rejects ZIP wrappers and S-030 excludes ZIP from its picker. |
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
| 4 | `debit` | ✅* | non-negative decimal | *either Debit/Credit OR signed `amount`; not both |
| 5 | `credit` | ✅* | non-negative decimal | see above; negative values are HARD `VALUE_INVALID` |
| 6 | `amount` | ✅* | signed decimal | debit-positive convention; credit-negative |
| 7 | `cost_center` | ⬜ | text | first Dimension (key must exist or auto-create w/ confirm) |
| 8 | `project` | ⬜ | text | Dimension |
| 9 | `product` | ⬜ | text | Dimension |
| 10 | `customer` | ⬜ | text | Dimension |
| 11 | `business_unit` | ⬜ | text | BU key; required for Group imports (HARD if missing in Group mode) |
| 12 | `intercompany_tag` | ⬜ | `src_bu→dst_bu` | e.g., `bu-manu→bu-retail`; creates `ic_lines` + elimination |
| 13 | `currency` | ⬜ | ISO 4217 | defaults to Company/BU currency; `CURRENCY_UNKNOWN` if unrecognized |
| 14 | `posting_ref` | ⬜ | text | attribution key; a repeated non-empty value on another valid row is a WARNING (no acknowledgement command exists) |
| 15 | `doc_type` | ⬜ | text | informational |
| 16 | `source_row` | auto | integer | generated; used in per-row error report |

## 3. SIGN CONVENTIONS (exact — import)

| Source layout | Converted to | Canonical store |
|---|---|---|
| Debit/Credit columns | debit − credit | `amount_minor` signed (debit +, credit −) |
| Signed `amount` with `debit_positive` | as-is | same |
| Signed `amount` with `credit_positive` (rare, some ERPs) | −amount | same; mapping explicitly toggles (never auto-detected silently) |
| Reversed/contra accounts (e.g., contra-revenue, allowance) | account code stays text; the existing Pack/COA Type and `is_control` metadata determine report placement. Mapping never infers a contra Type from the code or sign | model math unchanged |

### 3.1 Explicit normalization rules (mapping version owns them)

Normalization is selected in S-031, persisted with that mapping version, and applied by the Rust
resolver before row validation. It is deterministic and never inferred from a sample:

| Field | Allowed rule | Exact behavior |
|---|---|---|
| account code | `trim` | remove outer Unicode whitespace; preserve internal characters and leading zeroes |
| account code | `trim_collapse_whitespace` | also collapse each internal whitespace run to one ASCII space |
| account code | `trim_collapse_whitespace_remove_hyphens` | also remove ASCII `-`; `4100-00` → `410000`; never numeric conversion |
| cost center/project/product/customer/business unit | `trim` / `trim_collapse_whitespace` | same text-only whitespace behavior; canonical keys are stored after normalization |
| period | `documented` | pass trimmed input to the documented date/fiscal-period parser |
| period | `month_name_mmm_yy` | additionally accept exactly English `MMMYY` or `MMMYYYY`, case-insensitive; YY means 2000–2099; emit `YYYY-MM` (`AUG26` → `2026-08`) |

An explicit month-name rule does not fuzzily reinterpret other shapes; unchanged invalid input later
becomes the normal row validation finding. Before validation, S-031 shows rule examples but does
not claim a row-level normalization preview because `import.parse` exposes headers, not source row
samples. After mapping selection, its preview is populated only from valid mapped rows returned by
`import.validate`; it is not a reconstruction of raw source input.

### 3.2 Validation and preview semantics

`import.validate` applies the selected mapping and returns separate `hard` and `warnings` arrays.
Each item has an existing locked code, reason, details, and either a one-based physical source
`line_no` or `null` for batch scope. Invalid rows are omitted from `rows` and `preview`; therefore
`rows` is explicitly the number of valid mapped lines, while `preview` is their source-ordered first
50. Money is converted once to integer minor units by the core and displayed through `MoneyCell`.
The current WARNING rule is a repeated non-empty `posting_ref`; account-name differences are not
implemented and are not simulated. S-031 renders at most 50 findings per severity for responsiveness
while reporting the complete returned array counts.

**Tie-Out gate:** checked integer-minor-unit Σ(`debit`) must equal Σ(`credit`); signed amounts are reduced to the same debit/absolute-credit totals. A mismatch yields exact totals and only real rows attributable through a nonblank `posting_ref`; a difference with no such reference remains totals-only and is never spread over invented rows. S-032 can submit attributed source-line exclusions only with 1–500-character reasons. The Rust commit engine reapplies them, reruns mapping validation and Tie-Out, rejects zero retained rows, and records every exclusion in the transactional HMAC audit payload. The browser never computes adjusted money or silently drops a row.

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
| `Opening Balances` | period, account_code, debit, credit | imports as Opening Balances batch (M2-5: one period per batch, one opening balance per account/period, and once per Company — all `OPENING_ALREADY_SET`; no override/merge/replace action exists) |
| `Mapping Notes` | free text | human notes; ignored by parser |

## 6. PERFORMANCE & ERROR HANDLING

| Case | Behavior |
|---|---|
| 500k rows | Product target: streamed/background, progress, cancellation, memory < 2 GB. **Current registered `import.parse` is a synchronous in-memory grid and emits no progress event or cancel command; S-030 gates both controls and no 500k benchmark is claimed.** |
| Duplicate (batch, source_row) | `line_no` is generated once per parsed physical row and `gl_lines` enforces `UNIQUE(batch_id,line_no)`. Submitted exclusions also reject duplicate line numbers before write. |
| Period outside Company calendar range | HARD `PERIOD_NOT_FOUND` with row detail `PERIOD_OUT_OF_RANGE`; import blocked. S-031 offers source/mapping correction and re-validation, not exclusion. |
| Account missing from COA during validation | HARD `MAP_ACCOUNT_AMBIGUOUS` with row detail `ACCOUNT_MISSING`; S-031 offers source/mapping correction and re-validation only. It has no account-create or per-row remap action. |
| Blank required column | HARD per-row error with physical `line_no`; S-031 renders returned findings but has no registered report-export action. |
| Formula-looking text in source (`=...`) | treated as text; import never executes cells (injection safety) |

## 7. MAPPING TEMPLATE DEFAULT (bundled with the Canonical GL Template)

A read-only bundled Mapping Template "OneFP&A Canonical GL" (`mapping_id = canonical`, version
`canonical-v1`) maps columns 1–15 to the exact fields above — importing a file that already
follows this layout needs **zero manual column choices** (S-031 shows "100% auto-mapped" and can
select it without a persistence write). A custom map is saved only through the strict
`import.map.save_v1` contract in API-SPEC §11. Same Company/name saves retain the mapping id and
advance `vN`; latest rows are materialized while immutable before/after definitions remain in the
HMAC audit chain. The locked command catalog has no map-list/load/history command, so S-031 does
not fabricate saved-template browsing.

*Referenced by: PRD F-007/F-008/F-011, INTEGRATIONS, TEST-FIXTURES-SPEC, ERROR-HANDLING C.*
