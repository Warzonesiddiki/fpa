# API-SPEC.md

> OneFP&A · v1.0.0 · **"API" = typed Tauri IPC (Rust core ↔ TS UI via tauri-specta).** No HTTP server exists (B1).
> URL-shaped commands `domain.action`; versioned `domain.action.v1` when breaking.
> Auth column: `session` = requires unlocked (PIN-verified) session; `none` = pre-unlock.
> Every command: validates with serde + Zod, writes Audit Trail (except read-only), returns typed JSON.
> Errors: standard shape in ERROR-HANDLING.md. `httpStatus` is the mapped code retained for future API layer (V-012) and for debugging consistency.
> **Command count: 97 commands (ZC revision — gaps closed: pack, cycle, collection, scenario lifecycle, plan-analysis, board pack, schedule, reconcile-authoritative; S-044 persisted read side).**

---

## 1. CONVENTIONS

```jsonc
// Request (invoke args): serde struct passed by the UI — snake_case, tauri-specta generated.
// Success response: { "data": <typed> }
// Error response (always): {
//   "error": { "code": "MODEL_CELL_LOCKED", "message": "scenario is locked",
//              "userMessage": "This scenario is locked. Create a Version to edit.",
//              "httpStatus": 422, "retryable": false, "retryAfterMs": null, "details": { } }
// }
```

Money fields: `amount_minor: i64` (currency-scaled). IDs: `uuid`. Periods: `period_id` (never `"P08"` strings alone).

## 2. COMMAND CATALOG (all commands)

| Command | Auth | Input (key fields) | Success data | Error codes (subset; full in §7) |
|---|---|---|---|---|
| `session.unlock` | none | `pin` | `{company_id, model_id?, session_token}` | AUTH_PIN_INVALID, AUTH_LOCKED, STORAGE_DECRYPT_FAILED |
| `session.lock` | session | — | `{locked: true}` | — |
| `session.status` | none | — | `{unlocked, company_id?, model_id?, license}` | — |
| `company.create` | session | `{name, path, pack_key, calendar, plan_only}` | `{company_id, model_id}` | STORAGE_FILE_EXISTS, STORAGE_INSUFFICIENT, PACK_SCHEMA_INVALID |
| `company.open` | session | `{path}` | `{company_id, model_id, summary}` | STORAGE_FILE_CORRUPT, LICENSE_EXPIRED, FILE_IN_USE |
| `company.list` | session | — | `CompanyMeta[]` | — |
| `company.clone_sandbox` | session | `{company_id, name}` | `{company_id}` | ARCHIVE_IN_USE_REF |
| `company.archive_year` | session | `{company_id, fy_label}` | `{affected_periods}` | ARCHIVE_IN_USE |
| `company.delete` | session | `{company_id, reason}` | `{deleted}` | COMPANY_IN_USE_RECENT |
| `coa.import` | session | `{company_id, file_path?, pack_key?}` | `{created, updated}` | COA_DUPLICATE_CODE, COA_REFERENCED |
| `coa.list` | session | `{company_id, bu_id?}` | `AccountNode[]` | — |
| `coa.merge_accounts` | session | `{from_id, to_id}` | `{remapped}` | COA_REFERENCED, COA_TYPE_MISMATCH |
| `calendar.preview` | session | `{preset, fy_start, week_start, year_end_rule}` | `{fy_periods[]}` | CAL_53WEEK_CONFLICT |
| `calendar.apply` | session | `{company_id, config[], bu_map[]}` | `{applied}` | CAL_TRANSIT_AMBIGUOUS, CAL_PERIOD_MAPPING_CONFLICT |
| `model.create` | session | `{company_id, name, horizon, pack_id}` | `{model_id}` | MODEL_SIZE_LIMIT, PACK_UPDATE_AVAILABLE |
| `model.list` | session | `{company_id}` | `Model[]` | — |
| `model.sheet.add` | session | `{model_id, name, type}` | `{sheet_id}` | SHEET_NAME_DUP |
| `model.cell.set.v1` | session | `{line_id, scenario_id, period_id, value?, formula?, manual_override?}` | `{recalc: {dirty_cells, cycles, changed_cells[], duration_ms}}` | MODEL_CELL_LOCKED, FORMULA_CYCLE, REFERENCE_BROKEN, DRIVER_OUT_OF_BOUNDS, HARDCODED_ASSUMPTION |
| `model.recalc` | session | `{model_id, scenario_id}` | `{duration_ms, changed_cells, issues[]}` | — |
| `model.inspect` | session | `{line_id, period_id}` | `{precedents[], dependents[], cycle?}` | — |
| `model.diff` | session | `{scenario_a, version_a?, scenario_b, version_b?}` | `{diff_rows[]}` | COMPARE_INCOMPATIBLE |
| `model.dump_export` | session | `{model_id, path}` | `{file, audit_id}` | HEALTH_CHECK_BLOCKED |
| `scenario.create` / `scenario.duplicate` / `scenario.submit` / `scenario.approve` / `scenario.lock` / `scenario.reopen` / `scenario.delete` | session | `{model_id, name?, base_id?}` / `{scenario_id}` / `{reason?}` | `{scenario_id, version_id}` | SCENARIO_NAME_DUP, SCENARIO_LOCK_CONFLICT |
| `baseline.set` | session | `{scenario_id, reason?}` | `{baseline_version_id}` | BASELINE_REPLACE_REASON_REQUIRED |
| `model.year.copy` | session | `{source_model_id, target_fy, options}` | `{target_model_id, lines_copied}` | MODEL_YEAR_EXISTS |
| `bootstrap.copy` | session | `{scenario_id, mode, options}` | `{lines, warnings[]}` | SOURCE_BOOTSTRAP_EMPTY |
| `driver.upsert` | session | `{model_id, driver{...}}` | `{driver_id}` | DRIVER_FEED_MISSING |
| `driver.set_value` | session | `{driver_id, scenario_id, period_id, value_decimal}` | `{ok, recalc}` | DRIVER_OUT_OF_BOUNDS |
| `driver.import` | session | `{file_path, mapping_id}` | `{batch_id}` | IMPORT_* |
| `assumption.upsert` | session | `{model_id, assumption{...}}` | `{assumption_id}` | ASSUMPTION_IN_USE_LOCKED |
| `assumption.list` | session | `{model_id}` | `AssumptionListRow[]` (`version`, `last_changed_at`) | — |
| `assumption.find_usages` | session | `{assumption_id}` | `{cells[]}` | — |
| `import.parse` | session | `{file_path, kind}` | `{parse_id, sheets, encodings, row_counts, source_name, source_hash, size_bytes, headers}` | IMPORT_FILE_UNREADABLE, IMPORT_FILE_LOCKED, ENCODING_UNSUPPORTED |
| `import.map.save_v1` | session (write) | `{template{name, columns[], sign_convention, normalization}}` | `{mapping_id, version}` | MAP_TARGET_INVALID, AUDIT_CHAIN_BREAK, STORAGE_FILE_CORRUPT |
| `import.validate` | session | `{parse_id, mapping_id}` | strict snake_case `{hard[], warnings[], preview[≤50], rows(valid), mapping_version}` | IMPORT_PARSE_EXPIRED, VALUE_INVALID, STORAGE_FILE_CORRUPT, SESSION_LOCKED, INTERNAL; finding codes in §12 |
| `import.tieout` | session | `{parse_id, mapping_id}` | `{debits_minor, credits_minor, diff_rows[], balanced, rows, currency}` | IMPORT_TIE_OUT_FAILED, STORAGE_FILE_CORRUPT |
| `import.commit` | session | `{parse_id, mapping_id, name, exclusions[]}` | `{batch_id, audit_id, rows, debits_minor, credits_minor, tie_out_status, excluded_rows, source_hash}` | IMPORT_BATCH_HASH_EXISTS, IMPORT_TIE_OUT_FAILED, MODEL_CELL_LOCKED, STORAGE_FILE_CORRUPT |
| `import.rollback` | session | `{batch_id, reason}` | `{rolled_back_to}` | BATCH_ALREADY_ROLLED_BACK |
| `import.history` | session | `{company_id, page}` | `{rows[], meta}` | — |
| `connector.connect` | session | `{connector_key}` | `{auth_url}` | CONNECTOR_ALREADY_CONNECTED |
| `connector.callback` | session | `{connector_key, code, state}` | `{connected}` | CONNECTOR_AUTH_EXPIRED, CONNECTOR_AUTH_STATE_MISMATCH |
| `connector.sync` | session | `{connector_key, scope}` | `{run_id}` | CONNECTOR_RATE_LIMITED, CONNECTOR_NETWORK, CONNECTOR_AUTH_EXPIRED |
| `connector.health` | session | `{connector_key}` | `{state, last_run, rows}` | — |
| `reconcile.run` | session | `{batch_a, batch_b}` | `{diffs[]}` | SRC_MISMATCH_UNRESOLVED |
| `consolidation.run` | session | `{company_id, period_id, options}` | `{run_id, status}` | IC_UNMATCHED, CAL_TRANSIT_AMBIGUOUS, SEGMENT_TRANSLATION_PENDING |
| `consolidation.status` | session | `{run_id}` | `{stage, progress, issues[]}` | — |
| `statement.get.v1` | session | `{company_id, type, period_scope[], preset, rounding, bu_scope}` | `{rows[], totals, tieout_status}` | STATEMENT_TIE_OUT_FAILED, STATEMENT_SOURCE_MIXED |
| `variance.get` | session | `{company_id, period_id, compare, attribution}` | `{rows[], attribution[], threeway}` | VARIANCE_NO_ATTRIBUTION_DATA, VARIANCE_SOURCE_MIXED |
| `variance.set_reason_code` | session | `{line_id, period_id, code, note}` | `{saved}` | — |
| `fva.get` | session | `{company_id, line_ids?}` | `{scores[]}` | FVA_RESTATEMENT_FLAG |
| `report.layout.save` / `report.layout.render` | session | `{layout{...}}` / `{layout_id, scope}` | `{saved}` / `{rows[]}` | LAYOUT_REFERENCE_BROKEN, LAYOUT_INVALID |
| `kpi.define` | session | `{kpi{...}}` | `{kpi_id}` | KPI_FORMULA_INVALID, KPI_DIV_ZERO |
| `alerts.list` / `alerts.create_rule` | session | `{filter}` / `{rule}` | `{alerts[]}` / `{rule_id}` | ALERT_RULE_INVALID |
| `health.run` | session | `{model_id}` | `{check_id, findings[]}` | — |
| `health.waive` | session | `{finding_id, reason}` | `{waived}` | HEALTH_WAIVER_REASON_REQUIRED |
| `audit.list` | session | `{company_id, filters, page}` | `{events[], chain_status}` | AUDIT_CHAIN_BREAK |
| `audit.export_dataroom` | session | `{company_id, period_scope, path}` | `{file, counts}` | AUDIT_CHAIN_BREAK |
| `export.excel` / `export.pdf` / `export.model_dump` | session | `{layout_id?, scope, options, path}` | `{file, audit_id}` | HEALTH_CHECK_BLOCKED, EXPORT_FORMULA_INJECTION_GUARD |
| `backup.create` / `backup.restore` | session | `{path, passphrase}` / `{backup_id, passphrase}` | `{backup_id}` / `{restored}` | BACKUP_DISK_FULL, BACKUP_PASSPHRASE_INVALID, BACKUP_IO_ERROR |
| `security.change_pin` | session | `{old_pin, new_pin}` | `{ok}` | PIN_POLICY_WEAK, AUTH_PIN_INVALID |
| `security.recovery_reveal` | session | `{confirm}` | `{phrase[]}` | — |
| `security.recovery_reset` | none | `{phrase, new_pin}` | `{ok}` | RECOVERY_PHRASE_INVALID, AUTH_LOCKED |
| `license.verify` | none | `{license_payload}` | `{status, days_left}` | LICENSE_INVALID_SIGNATURE, LICENSE_EXPIRED |
| `license.request_file` | session | `{company_path}` | `{file}` | — |
| `license.apply_response` | session | `{response_path_or_payload}` | `{status, plan, days_left}` | LICENSE_INVALID_SIGNATURE, LICENSE_EXPIRED |
| `pack.list` | session | `{company_id?}` | `PackMeta[]` | — |
| `pack.validate` | session | `{pack_path}` | `{valid, errors[], warnings[]}` | PACK_SCHEMA_INVALID |
| `pack.install` | session | `{pack_path, company_id}` | `{pack_id, version}` | PACK_VERSION_EXISTS, PACK_SCHEMA_INVALID |
| `pack.builder.save_v1` | session | `{pack_id?, definition_json}` | `{pack_id, version}` | PACK_SCHEMA_INVALID, PACK_IN_USE_LOCKED |
| `pack.builder.apply_diff` | session | `{pack_id, model_ids[]}` | `{applied, skipped[]}` | PACK_IN_USE_LOCKED |
| `model.schedule.upsert` | session | `{model_id, schedule_type, rows[]}` | `{schedule_id, recalc}` | CAPEX_IN_SERVICE_INVALID, PRODUCTION_CAPACITY, REVREC_COST_ESTIMATE_INVALID |
| `cycle.start` | session | `{model_id, kind, name, due}` | `{cycle_id}` | CYCLE_NAME_DUP |
| `cycle.task.update` | session | `{task_id, status, note}` | `{updated}` | CYCLE_TASK_BLOCKED |
| `cycle.checklist.status` | session | `{model_id, period_id}` | `{tasks[], ready}` | — |
| `collection.export` | session | `{cycle_id, driver_ids[], template}` | `{file, rows}` | COLLECTION_STRUCTURE_CHANGED |
| `collection.import` | session | `{cycle_id, file_path, mapping_id}` | `{batch_id, conflicts[]}` | COLLECTION_CONFLICT, COLLECTION_STRUCTURE_CHANGED |
| `collection.resolve_conflict` | session | `{conflict_id, choice, note}` | `{resolved}` | — |
| `plan.goal_seek` | session | `{target_cell, target_value, driver_id, bounds}` | `{driver_value, iterations, converged}` | GOAL_SEEK_NO_CONVERGE, SENSITIVITY_OUT_OF_BOUNDS |
| `plan.sensitivity` | session | `{driver_id, lo, hi, steps, target_lines[]}` | `{tornado[], values[]}` | SENSITIVITY_OUT_OF_BOUNDS |
| `plan.whatif_overlay` | session | `{scenario_ids[], period_scope, kpis[]}` | `{series[], waterfall[]}` | COMPARE_INCOMPATIBLE |
| `board_pack.generate` | session | `{template_id, period_scope, commentary_required}` | `{pack_id, preview_files[]}` | HEALTH_CHECK_BLOCKED, PACK_NO_COMMENTARY |
| `reconcile.mark_authoritative` | session | `{batch_id, account_ids[], reason}` | `{updated}` | SRC_MISMATCH_UNRESOLVED, HEALTH_WAIVER_REASON_REQUIRED |
| `update.check` | session | — | `{available, version, notes}` | UPDATE_FETCH_FAILED |
| `settings.get` / `settings.set` | session | `{key}` / `{key, value_json}` | `{value}` / `{ok}` | SETTINGS_SAVE_FAILED |
| `app.diagnostics.export` | session | `{path}` | `{file}` | — |

## 3. DETAILED SPEC — `model.cell.set.v1` (flagship write)

**Input**
```json
{ "line_id": "ln-rev", "scenario_id": "sc-base", "period_id": "fp-2027-p08",
  "value": "182500.00", "formula": null, "manual_override": false }
```
**Success**
```json
{ "data": { "recalc": { "dirty_cells": 482, "cycles": [], "changed_cells": ["ln-rev","ln-cogs","ln-gp"],
            "duration_ms": 320 } } }
```
**All errors** — `MODEL_CELL_LOCKED (422, retry false)` · `FORMULA_CYCLE (422, retry false, details.cycle_path)` · `REFERENCE_BROKEN (422, retry false, details.cell)` · `DRIVER_OUT_OF_BOUNDS (422, retry false, details.bounds)` · `HARDCODED_ASSUMPTION (422, retry false, details.cell)` · `SESSION_LOCKED (401)` · `VALUE_INVALID (422)` · `INTERNAL (500, retry true)`.

## 4. DETAILED SPEC — `import.commit` (ingestion gate)

**Input**
```json
{ "parse_id": "p-1", "mapping_id": "mt-1", "name": "2026-08-30_001",
  "exclusions": [ { "line_no": 47129, "reason": "credit_line_rounding_conflict" } ] }
```
**Success**
```json
{ "data": { "batch_id": "ib-1", "rows": 47999, "debits_minor": 4128300000,
            "credits_minor": 4128300000, "tie_out_status": "excluded_rows_logged",
            "audit_id": 99 } }
```
**All errors** — `IMPORT_TIE_OUT_FAILED (422, retry false, details.diff_rows)` · `IMPORT_BATCH_HASH_EXISTS (409, retry false, details.existing_batch)` · `MODEL_CELL_LOCKED?` no — `SESSION_LOCKED (401)` · `IMPORT_PARSE_EXPIRED (410, retry true)` · `INTERNAL (500, retry true)`.

## 5. DETAILED SPEC — `consolidation.run` (group)

**Input**
```json
{ "company_id": "c-01", "period_id": "fp-2027-p08",
  "options": { "fx_policy": "average_closing_oci", "include_nci": true, "eliminate_ic": true } }
```
**Success**
```json
{ "data": { "run_id": "cr-1", "status": "started" } }
```
**All errors** — `IC_UNMATCHED (422, retry false, details.unmatched[])` · `CAL_TRANSIT_AMBIGUOUS (422, retry false, details.bu_periods)` · `SEGMENT_TRANSLATION_PENDING (409, retry true, details.rates_missing)` · `CONSOLIDATION_RUNNING (409, retry true)` · `GROUP_ROLLUP_INCOMPLETE (422)` · `INTERNAL (500, retry true)`.

## 6. DETAILED SPEC — `statement.get.v1` (reporting)

**Input**
```json
{ "company_id": "c-01", "type": "pl", "period_scope": ["fp-2027-p08"],
  "preset": "us_gaap", "rounding": { "mode": "000s", "largest_remainder": true },
  "bu_scope": { "kind": "group" } }
```
**Success**
```json
{ "data": { "rows": [ { "section": "Revenue", "lines": [ { "account_id": "a-4000",
  "label": "Revenue", "values": { "fp-2027-p08": 6350000, "ytd": 25100000 } } ] } ],
  "totals": { "revenue": 6350000, "gross_profit": 2380000 },
  "tieout_status": "pass", "rounding_status": "exact" } }
```
**All errors** — `STATEMENT_TIE_OUT_FAILED (422, retry false, details.findings)` · `STATEMENT_SOURCE_MIXED (422, retry false)` · `PERIOD_NOT_FOUND (404)` · `SESSION_LOCKED (401)` · `INTERNAL (500, retry true)`.

## 7. ERROR CODE INDEX → ERROR-HANDLING.md

All codes referenced in this spec are defined **exactly once** in ERROR-HANDLING.md (§2 taxonomy). This file uses only codes from that table. Adding a new code requires updating BOTH files + the OpenAPI-style command map in `docs-index.json` (Stage 3 audit).

## 8. DETAILED SPEC — `license.*` (activation, F-035)

Full protocol in LICENSE-SPEC.md; the command shapes:

- `license.verify {license_payload}` → `{status: active|grace, days_left}`. Session-less
  (no Company to bind to before unlock); signature + expiry only.
- `license.request_file {company_path}` → `{file}`. Writes
  `<company_path>.license-request.json`
  (`{company_id, machine_fingerprint, license_pubkey_hex, app_version, created_at}`).
  `company_path` = a `company_file_path` value from `company.list`.
- `license.apply_response {response_path_or_payload}` → `{status: active|grace, plan, days_left}`.
  Value is used verbatim when it parses as JSON, otherwise treated as a file path.
  Upserts `licenses` + audited in the same transaction.
- `session.status` carries the **live** license summary: `license: null` (not
  activated) or `{status, days_left, plan, expires_at, license_key_id, machine_fingerprint}`
  — the persisted row re-evaluated against the current clock (grace → expired without
  re-activation; `expires_at` NULL = perpetual).

## 9. DETAILED SPEC — `coa.import` / `coa.merge_accounts` (F-002)

`coa.import {company_id, file_path?, pack_key?}` → `{created, updated}`. Exactly ONE
source — neither or both is `VALUE_INVALID`. The source is a Pack's `coa.json`
(`pack_key`, path-segment validated) or a JSON file with the same shape
`{accounts: [{code, name, type, section, is_control?}]}` (file parse/shape problems
surface as `IMPORT_FILE_UNREADABLE`). Codes are normalized on import (trim + collapse
whitespace; leading zeros kept — codes are never parsed as numbers; empty after
normalization → `VALUE_INVALID`). Left-padding to the pack-defined width (default 6) is a
Pack Builder rule at pack creation (INDUSTRY-PACK-SPEC §2), NOT an import-time rewrite.
Upsert against the Company's BU-less accounts (S-021):

| Existing code | Behaviour |
|---|---|
| absent | INSERT (version 1) → `created++` |
| same `account_type`, zero `gl_lines` usage | in-place UPDATE (name/section/is_control) + `version += 1` → `updated++` |
| same `account_type`, ≥1 GL line | `COA_REFERENCED` — history is never rewritten |
| different `account_type` | `COA_DUPLICATE_CODE` — no silent type flip |

The whole import AND its `coa.import` audit event (object `coa`) run in ONE
transaction (B18-1). Versioning is in-place — `accounts.id` is stable (gl_lines /
child FKs never move); change history rides the HMAC audit chain.

`coa.merge_accounts {from_id, to_id}` → `{remapped}`. The Company is resolved from
`from_id`; both accounts must be active rows of that Company (every UPDATE is
company-scoped, so a cross-Company `to_id` is impossible). Guards: `from_id == to_id`
or `from_id`'s parent is `to_id` → `VALUE_INVALID`; different `account_type` →
`COA_TYPE_MISMATCH`. Effects (single transaction, audited as `coa.merge_accounts`,
object `account`): remap `gl_lines.account_id` from `from_id` → `to_id` (the returned
`remapped` count), reparent active children onto `to_id`, soft-deactivate `from_id`
(`active = 0`, `version += 1` — history preserved).

## 10. DETAILED SPEC — `company.clone_sandbox` (F-001 Clone as Sandbox)

`company.clone_sandbox {company_id, name}` → `{company_id}`. Copies the source Company's
**structure** into a NEW Company with a freshly sealed `.fpa` container (a what-if sandbox
that never touches the source; SCREENS-SPEC S-020). Copied with every id remapped in one
transaction, in FK-safe order: `fiscal_calendars` → `fiscal_years` → `fiscal_periods`,
`business_units` (parent + calendar remap), `accounts` (bu + parent remap) — parents are
inserted before children via a fixpoint pass so the BU/COA trees survive regardless of
source row order — plus a new default Model + Base scenario (source's horizon + pack).
The sandbox's `company_file_path` is the source file's **directory** + `<name>.fpa`; a path
that already holds a file is `STORAGE_FILE_EXISTS`, a taken Company name or an empty name
is `INVALID_ARGUMENT`.

**NOT copied at M1:** GL lines, scenarios, model cells, and any Models beyond the source's
first — the sandbox starts from the source's structure and calendar and the sandboxer
imports its own data (TASKBOARD M1-5). The `ARCHIVE_IN_USE_REF` guard (source references an
archived Fiscal Year) is structurally present but vacuously satisfied at M1, because no
Fiscal Year can be archived yet (`company.archive_year` lands with the archive schema).

The sandbox Company gets its own genesis-rooted HMAC audit chain; the clone is recorded as
a `company.clone_sandbox` audit event (object `company`) inside the same transaction that
inserts the rows and seals the container (B18-1) — a failed seal rolls back the whole clone.

## 11. DETAILED SPEC — `import.map.save_v1` (S-031 mapping contract)

`import.map.save_v1` is the only mapping write in the locked 97-command catalog. It requires a
writable unlocked session and derives `company_id` from that session; callers cannot write a
mapping into another Company. The request is strict (unknown object keys or enum values are
invalid):

```json
{
  "template": {
    "name": "Tally GL",
    "columns": [
      { "source_pattern": "Posting Date", "semantic_target": "period" },
      { "source_pattern": "Ledger Code", "semantic_target": "account_code" },
      { "source_pattern": "Dr", "semantic_target": "debit" },
      { "source_pattern": "Cr", "semantic_target": "credit" }
    ],
    "sign_convention": "debit_positive",
    "normalization": {
      "account_code": "trim_collapse_whitespace_remove_hyphens",
      "dimension_values": "trim_collapse_whitespace",
      "period": "month_name_mmm_yy"
    }
  }
}
```

`semantic_target` is exactly one of `period`, `account_code`, `account_name`, `debit`,
`credit`, `amount`, `cost_center`, `project`, `product`, `customer`, `business_unit`,
`intercompany_tag`, `currency`, `posting_ref`, or `doc_type`. Sources and targets are unique
case-insensitively. `period` and `account_code` are required, plus either `amount` or both
`debit` and `credit`; 3–15 mapped columns (the finite target set is unique) and a trimmed
1–120-character name are accepted.
Unknown, duplicate, missing-required, blank, control-character, or reserved rule sources return
`MAP_TARGET_INVALID (422, retry false)` with locked text “This column cannot map to that field.
Choose a supported target.” The same error covers invalid
sign/normalization enums; validation occurs independently in Zod and serde-backed Rust code.

The finite rule enums are:

- `sign_convention`: `debit_positive | credit_positive`; it applies only to a signed `amount`
  source. Explicit debit/credit columns retain debit-minus-credit semantics.
- `normalization.account_code`: `trim | trim_collapse_whitespace |
  trim_collapse_whitespace_remove_hyphens`. Codes always remain text and leading zeroes survive.
- `normalization.dimension_values`: `trim | trim_collapse_whitespace` for cost center, project,
  product, customer, and business-unit values.
- `normalization.period`: `documented | month_name_mmm_yy`. The additive explicit pattern accepts
  only `MMMYY` or `MMMYYYY` (English month abbreviation, case-insensitive), maps two-digit years
  to 2000–2099, and emits `YYYY-MM` (`AUG26` → `2026-08`). Other inputs pass unchanged to the
  documented period parser and can still fail validation; there is no fuzzy date guess.

A first Company/name save returns `{mapping_id: <uuid>, version: "v1"}`. A later exact-name save
in that Company keeps the id and increments the checked `vN` label. The current materialized
`mapping_templates`/`mapping_columns` body is replaced, including the four reserved policy rows
defined in DATABASE-SCHEMA §7, and its deterministic SHA-256 checksum changes with the semantic
definition. The replacement and an `import.map.save_v1` HMAC audit event commit in one immediate
transaction; an audit failure rolls the mapping write back. Resolution recomputes the body checksum
and matches the complete normalized definition, id, checksum, and version to the latest verified
mapping audit payload; a materialized-row or metadata mismatch is `STORAGE_FILE_CORRUPT`, never a
silently altered map. A degraded
audit-chain session is read-only and returns `AUDIT_CHAIN_BREAK` before opening the transaction.

Historical definitions are immutable in the append-only HMAC audit chain: every event stores the
full new definition in `after_json`; a version bump also stores the full prior persisted body in
`before_json`. `import.commit` captures the mapping id and version in its audit payload and the
version in `import_batches.mapping_version`. The schema intentionally materializes only the latest
body, so historical versions are not mutable rows and cannot be loaded by id today. There is no
mapping-list/load/history command in the locked catalog; S-031 visibly gates browsing instead of
inventing one. The bundled `mapping_id = "canonical"` is read-only, needs no save, and resolves to
`canonical-v1`.

**Success**

```json
{ "data": { "mapping_id": "00000000-0000-4000-8000-000000000031", "version": "v1" } }
```

*Referenced by: STATE-MANAGEMENT.md, ERROR-HANDLING.md, INTEGRATIONS.md, FEATURE-TRACEABILITY-MATRIX.md, LICENSE-SPEC.md, SCREENS-SPEC.md, TEST-FIXTURES-SPEC.md, DATABASE-SCHEMA.md.*

## 12. DETAILED SPEC — `import.validate` (S-031 validation contract)

`import.validate {parse_id, mapping_id}` is a read-only Company-scoped command. It resolves the
same ephemeral parse and either bundled `canonical-v1` or the complete latest audited mapping body;
it is allowed in an audit-degraded read-only session because it writes neither rows nor an audit
event. A real response uses the following strict snake_case wire shape:

```json
{
  "data": {
    "hard": [
      {
        "code": "MAP_ACCOUNT_AMBIGUOUS",
        "message": "ACCOUNT_MISSING: '99999' is not in this Company's COA — correct the source or mapping and validate again (GL-TEMPLATE-SPEC §6)",
        "line_no": 3,
        "details": { "accountCode": "99999", "list": [] }
      }
    ],
    "warnings": [
      {
        "code": "VALUE_INVALID",
        "message": "POSTING_REF_DUPLICATE: 'INV-2001' first seen on row 2",
        "line_no": 4,
        "details": { "postingRef": "INV-2001", "firstLineNo": 2 }
      }
    ],
    "preview": [
      {
        "line_no": 2,
        "period_id": "fp-2026-p08",
        "account_id": "00000000-0000-4000-8000-000000004000",
        "account_code": "4000",
        "business_unit_id": null,
        "amount_minor": -635000000,
        "debit_minor": null,
        "credit_minor": 635000000,
        "currency": "USD",
        "posting_ref": "INV-2001",
        "doc_type": "INVOICE",
        "is_ic": false
      }
    ],
    "rows": 47999,
    "mapping_version": "v3"
  }
}
```

`line_no` is the one-based physical source row and is `null` only for a batch-scope finding.
`rows` means **valid mapped rows**, not total parsed source rows. `preview` contains only valid
mapped rows, in source order, and is capped at 50 by both the core and Zod response schema; invalid
raw rows are never reconstructed in the browser. Every money field is an integer minor-unit value.
`mapping_version` is exactly `canonical-v1` or checked `vN`, and the client rejects a version that
differs from the selected mapping.

The finding code is restricted to the existing locked subset `VALUE_INVALID`, `PERIOD_NOT_FOUND`,
`MAP_ACCOUNT_AMBIGUOUS`, `UNIT_PERIOD_MISMATCH`, or `OPENING_ALREADY_SET`; an ad-hoc validation
code is malformed. Current HARD checks cover required/parseable period and amount fields, Company
calendar resolution, Company/BU-scoped account resolution, supported currency, Group BU presence,
intercompany tag/BU resolution, mixed-currency batch input, weekly driver data against a monthly
calendar, and duplicate opening balances. The currently implemented WARNING is a duplicate
non-empty posting reference on another valid row. Missing account names are not currently a
WARNING and are not fabricated by the mock or S-031.

HARD and WARNING arrays remain separate and preserve row-versus-batch scope. S-031 reports their
full returned counts but renders only the first 50 items in each list to keep the webview responsive;
it says when more returned findings are not rendered. It does not expose row exclusion, account
creation, per-row remap, warning acknowledgement, Tie-Out, or commit controls. The only S-031
remediation paths are edit the mapping or return to the Import Hub, correct/re-select the source,
and re-parse.

Command errors use the normal envelope. In particular, `IMPORT_PARSE_EXPIRED (410, retry true)`
must display the locked text “This parse session expired. Re-run the import.” and route to S-030;
S-031 must not invoke Retry against the same expired id. Mapping/company mismatch is
`VALUE_INVALID`; an audited-body/checksum mismatch is `STORAGE_FILE_CORRUPT`; locked sessions use
`SESSION_LOCKED`; unexpected transport/storage failures use the existing `INTERNAL` envelope.

*Referenced by: STATE-MANAGEMENT.md, ERROR-HANDLING.md, FEATURE-TRACEABILITY-MATRIX.md, GL-TEMPLATE-SPEC.md, SCREENS-SPEC.md, USER-FLOWS.md.*
