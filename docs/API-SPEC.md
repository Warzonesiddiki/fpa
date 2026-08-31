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
| `import.parse` | session | `{file_path, kind}` | `{parse_id, sheets, encodings, row_counts}` | IMPORT_FILE_UNREADABLE, IMPORT_FILE_LOCKED, ENCODING_UNSUPPORTED |
| `import.map.save_v1` | session | `{template{...}}` | `{mapping_id, version}` | MAP_TARGET_INVALID |
| `import.validate` | session | `{parse_id, mapping_id}` | `{hard[], warnings[], preview[]}` | MAP_ACCOUNT_AMBIGUOUS, UNIT_PERIOD_MISMATCH, OPENING_ALREADY_SET |
| `import.tieout` | session | `{parse_id, mapping_id}` | `{debits_minor, credits_minor, diff_rows[]}` | IMPORT_TIE_OUT_FAILED |
| `import.commit` | session | `{parse_id, mapping_id, name, exclusions[]}` | `{batch_id, audit_id}` | IMPORT_BATCH_HASH_EXISTS, IMPORT_TIE_OUT_FAILED, MODEL_CELL_LOCKED |
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

*Referenced by: STATE-MANAGEMENT.md, ERROR-HANDLING.md, INTEGRATIONS.md, FEATURE-TRACEABILITY-MATRIX.md.*
