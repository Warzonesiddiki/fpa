# ERROR-HANDLING.md

> OneFP&A · v1.0.0 · **Standard error shape + full taxonomy: code → internal message → user-facing text → httpStatus → retry?**
> Every error returns JSON of the exact shape below; UI renders `userMessage` + code chip + retry when `retryable`. No silent catches anywhere (B18-5/6).

---

## 1. STANDARD ERROR SHAPE (IPC — canonical)

```json
{
  "error": {
    "code": "IMPORT_TIE_OUT_FAILED",
    "message": "import tie-out failed: debits 4128300000 != credits 4128300005",
    "userMessage": "Import blocked: debits ₹41,28,30,000.00 vs credits ₹41,28,30,000.05. Review the 1 flagged row below.",
    "httpStatus": 422,
    "retryable": false,
    "retryAfterMs": null,
    "details": { "diffRows": [ { "lineNo": 47129, "debitMinor": 100, "creditMinor": 105 } ] }
  }
}
```

- `code` = PascalCase identifier, globally unique.
- `message` = internal log text (never shown raw to users; redaction: no currency/secrets).
- `userMessage` = exact UI string (locale-aware; includes action + optional retry).
- `httpStatus` = mapped status (400/401/403/404/409/410/422/429/500/503) — retained for consistency and future API (V-012).
- `retryable` + `retryAfterMs` govern the retry button + countdown.
- `details` = safe structured context (never secrets, never money beyond the business case).
- Unhandled Rust panics → `INTERNAL` (500, retry true) + Local Diagnostics capture; UI never shows stack traces.

---

## 2. ERROR TAXONOMY (complete — adding a code requires updating API-SPEC.md §7 + this table)

### A. Session & Security
| Code | Message | userMessage | httpStatus | Retry |
|---|---|---|---|---|
| AUTH_PIN_INVALID | pin verification failed | "Incorrect PIN." | 401 | false |
| AUTH_LOCKED | too many failed attempts | "Too many attempts. Try again in {countdown}s." | 423 | true (after countdown) |
| SESSION_LOCKED | session expired | "Session locked. Unlock to continue." | 401 | false |
| RECOVERY_PHRASE_INVALID | phrase mismatch | "Recovery phrase does not match. {attempts} left." | 401 | false |
| PIN_POLICY_WEAK | policy not met | "PIN must be ≥8 characters with letters and digits." | 422 | false |
| KEYCHAIN_UNAVAILABLE | os keychain missing | "OS keychain unavailable on this system. Use the local encrypted credential store (recommended warning)." | 503 | false |
| LICENSE_INVALID_SIGNATURE | ed25519 verify failed | "This license key is invalid. Contact your vendor." | 403 | false |
| LICENSE_EXPIRED | license past expiry | "License expired. The Company is read-only. Activate to continue." | 403 | false |

### B. Storage & Files
| Code | Message | userMessage | httpStatus | Retry |
|---|---|---|---|---|
| STORAGE_FILE_EXISTS | path exists | "A file already exists at that location. Choose another name." | 409 | false |
| STORAGE_INSUFFICIENT | no space | "Not enough disk space for this operation. Free up space or choose another location." | 507 | false |
| STORAGE_FILE_CORRUPT | integrity check failed | "This Company file could not be verified. Restore from Backup? (pre-restore snapshot will be taken)" | 422 | false |
| STORAGE_DECRYPT_FAILED | key mismatch | "The Company file cannot be decrypted with this PIN." | 401 | false |
| FILE_IN_USE | second instance | "This file is open in another window — opened read-only." | 409 | false |
| IMPORT_FILE_UNREADABLE | parse failed | "This file could not be read. Export it again as .xlsx or .csv without a password." | 422 | false |
| IMPORT_FILE_LOCKED | encrypted workbook | "This file is password-protected. Remove protection and export again." | 422 | false |
| ENCODING_UNSUPPORTED | unknown charset | "Encoding not detected. Choose UTF-8 or Latin-1 (preview) and continue." | 422 | true |
| BACKUP_DISK_FULL | disk full | "Backup failed — no space. Your Company data is unchanged." | 507 | true |
| BACKUP_PASSPHRASE_INVALID | wrong passphrase | "Incorrect backup passphrase." | 401 | false |
| BACKUP_IO_ERROR | io failed | "Backup could not be written. Check permissions and retry." | 500 | true |

### C. Import & Mapping
| Code | Message | userMessage | httpStatus | Retry |
|---|---|---|---|---|
| IMPORT_TIE_OUT_FAILED | debits != credits | "Import blocked: debits {d} vs credits {c}. Review flagged rows below." | 422 | false |
| IMPORT_BATCH_HASH_EXISTS | duplicate source | "This exact file was already imported (batch {id}). Re-import? This will create a new batch — confirm: duplicate rows are excluded automatically." | 409 | false |
| IMPORT_PARSE_EXPIRED | session expired | "This parse session expired. Re-run the import." | 410 | true |
| MAP_ACCOUNT_AMBIGUOUS | account not unique | "Account code maps to multiple Accounts ({list}). Confirm the intended Account." | 422 | false |
| MAP_TARGET_INVALID | mapping target invalid | "This column cannot map to that field. Choose a supported target." | 422 | false |
| UNIT_PERIOD_MISMATCH | driver/week period | "Driver data is weekly but the calendar is monthly. Aggregate (sum) or reject?" | 422 | false |
| OPENING_ALREADY_SET | opening exists | "Opening balances already exist for this period. Use a new Actuals batch to adjust." | 409 | false |

### D. Calendar & Structure
| Code | Message | userMessage | httpStatus | Retry |
|---|---|---|---|---|
| CAL_53WEEK_CONFLICT | rule mismatch | "The 53rd week rule conflicts with your FY start. Choose NRF (4+ days) or full-week rule." | 422 | false |
| CAL_TRANSIT_AMBIGUOUS | partial mapping | "BU period {p} spans two Group periods. Map both date ranges to proceed." | 422 | false |
| CAL_PERIOD_MAPPING_CONFLICT | overlap | "Two BUs map the same Group period with different calendars — confirm the Transit Map." | 409 | false |
| COA_DUPLICATE_CODE | code exists | "Account code {code} already exists in this scope." | 409 | false |
| COA_REFERENCED | in use | "Account is used by {n} lines/batches. Merge or remap instead of deleting." | 409 | false |
| COA_TYPE_MISMATCH | type differs | "Cannot merge: account types differ (Revenue vs COGS)." | 422 | false |
| ARCHIVE_IN_USE | refs exist | "This Fiscal Year is referenced by {n} models/layouts. Remove references before archiving." | 409 | false |
| ARCHIVE_IN_USE_REF | reference | "Sandbox references the archived year. Use a Year copy before cloning." | 409 | false |

### E. Model & Formulas
| Code | Message | userMessage | httpStatus | Retry |
|---|---|---|---|---|
| MODEL_CELL_LOCKED | scenario locked | "This scenario is locked. Create a Version to edit it." | 422 | false |
| MODEL_SIZE_LIMIT | exceeds 1M cells | "This Model exceeds the 1,000,000-cell limit. Split it or reduce the horizon." | 422 | false |
| SHEET_NAME_DUP | name exists | "A Sheet with this name already exists." | 409 | false |
| FORMULA_CYCLE | cycle detected | "Formula cycle detected: path {path} — shown as #CYCLE!. Fix the reference." | 422 | false |
| REFERENCE_BROKEN | broken ref | "Reference to {cell} is broken (sheet renamed/deleted). Repair or remove." | 422 | false |
| DRIVER_OUT_OF_BOUNDS | driver beyond bounds | "Driver value {v} is outside its bounds [{low}, {high}]. Update bounds (audited) or fix the value." | 422 | false |
| DRIVER_FEED_MISSING | no source | "Driver has no data and no feed source. Import, collect, or set a static value." | 422 | false |
| HARDCODED_ASSUMPTION | value not reference | "This cell uses a hardcoded value instead of an Assumption Register reference. Convert (recommended) or waive with a reason." | 422 | false |
| VALUE_INVALID | parse/type | "Value is not valid for this cell ({type})." | 422 | false |
| GOAL_SEEK_NO_CONVERGE | iterations exhausted | "Goal Seek did not converge in 100 iterations. Last value {v}, target {t}. Adjust bounds." | 422 | false |
| SENSITIVITY_OUT_OF_BOUNDS | outside bounds | "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range." | 422 | false |
| SCENARIO_NAME_DUP | name exists | "A Scenario with this name already exists." | 409 | false |
| SCENARIO_LOCK_CONFLICT | state conflict | "This Scenario is already in {state} — cannot transition." | 409 | false |
| COMPARE_INCOMPATIBLE | different model | "Cannot compare: Models/COAs differ. Select two Scenarios of the same Model." | 422 | false |
| ASSUMPTION_IN_USE_LOCKED | locked | "Assumption is used by a Locked Baseline. Create a new Version to change." | 422 | false |
| SPREAD_WEIGHTS_INVALID | sum != 100 | "Seasonality weights total {sum}% — normalize to 100% or fix." | 422 | false |
| PACK_SCHEMA_INVALID | validation failed | "Industry Pack failed validation at {path}. Retry or use the bundled Core Pack." | 422 | false |
| PACK_UPDATE_AVAILABLE | new pack version | "A newer version of this Industry Pack is available ({old} → {new}) for new Models." | 200 | false |
| MODEL/RECALC_IN_FLIGHT | busy | "Recalculation is in progress — try again in a moment." | 409 | true |

### F. Connectors & Reconciliation
| Code | Message | userMessage | httpStatus | Retry |
|---|---|---|---|---|
| CONNECTOR_AUTH_EXPIRED | token expired | "Connection expired. Re-authorize {provider} (previous data is intact)." | 401 | false |
| CONNECTOR_RATE_LIMITED | 429 | "{provider} is rate-limiting. Sync paused — retry in ~{minutes} or use Manual Import." | 429 | true |
| CONNECTOR_NETWORK | unreachable | "Could not reach {provider}. Check your connection. Manual Import is available." | 503 | true |
| CONNECTOR_ALREADY_CONNECTED | dup connect | "This provider is already connected." | 409 | false |
| CONNECTOR_AUTH_STATE_MISMATCH | csrf | "Authorization state mismatch. Re-try the connection." | 400 | false |
| SRC_MISMATCH_UNRESOLVED | diff open | "Sources differ on {n} accounts. Resolve or mark authoritative before closing." | 409 | false |

### G. Analysis & Reports
| Code | Message | userMessage | httpStatus | Retry |
|---|---|---|---|---|
| STATEMENT_TIE_OUT_FAILED | tie out fail | "Statement does not tie ({detail}). Export blocked — fix {findings} first." | 422 | false |
| STATEMENT_SOURCE_MIXED | calendar/currency | "Period/currency mix in scope is not comparable. Align scope or use Group translation." | 422 | false |
| PERIOD_NOT_FOUND | period missing | "Period not found in this calendar." | 404 | false |
| VARIANCE_NO_ATTRIBUTION_DATA | no driver data | "Attribution unavailable for these lines — no unit/driver data. Show $ variance only." | 200 | false |
| VARIANCE_SOURCE_MIXED | mixed states | "Selected periods mix Actual and Forecast — enable HYBRID label to view." | 422 | false |
| FVA_RESTATEMENT_FLAG | restated | "Actuals were restated for these periods — FVA recomputed; versions unchanged." | 200 | true |
| KPI_FORMULA_INVALID | formula bad | "KPI formula invalid: {detail}." | 422 | false |
| KPI_DIV_ZERO | div by zero | "KPI divides by zero — shows n/a. Add a denominator source or guard." | 200 | false |
| LAYOUT_REFERENCE_BROKEN | broken refs | "Layout references {n} missing lines. Auto-remap or fix." | 422 | false |
| LAYOUT_INVALID | schema bad | "Layout schema invalid at {path}." | 422 | false |
| ALERT_RULE_INVALID | rule bad | "Alert rule invalid: {detail}" | 422 | false |
| HEALTH_CHECK_BLOCKED | findings | "Export blocked by {n} Health Check findings. Fix or waive (reason required)." | 422 | false |
| HEALTH_WAIVER_REASON_REQUIRED | no reason | "A waiver reason is required." | 422 | false |

### H. Governance & Platform
| Code | Message | userMessage | httpStatus | Retry |
|---|---|---|---|---|
| AUDIT_CHAIN_BREAK | hash mismatch | "Audit integrity check failed. Restore from the last verified Snapshot?" | 409 | false |
| BATCH_ALREADY_ROLLED_BACK | state | "This batch was already rolled back." | 409 | false |
| IC_UNMATCHED | no counterpart | "Intercompany line {id} has no matching counterpart. Pair or classify as external." | 422 | false |
| GROUP_ROLLUP_INCOMPLETE | map missing | "Group Rollup Map incomplete for {n} Accounts. Complete mapping to consolidate." | 422 | false |
| SEGMENT_TRANSLATION_PENDING | rates missing | "FX rates missing for {periods}. Add rates or set policy." | 409 | true |
| CONSOLIDATION_RUNNING | busy | "A consolidation is already running for this Company." | 409 | true |
| STORAGE_FILE_CORRUPT → (B) | | | |
| UPDATE_FETCH_FAILED | updater network | "Could not check for updates (offline?). You can install manually." | 503 | true |
| SETTINGS_SAVE_FAILED | write failed | "Settings could not be saved. Retry." | 500 | true |
| HELP_TOPIC_MISSING | no topic | "No help topic for '{x}' — try search." | 404 | false |
| EXPORT_FORMULA_INJECTION_GUARD | guard | "Text cells starting with '=' were quoted (formula-injection protection) — review before export." | 200 | false |
| INTERNAL | unexpected | "Something went wrong. Diagnostics were captured — retry or export Local Diagnostics." | 500 | true |

---

## 3. UI RENDERING RULES

1. `httpStatus 401/403` → lock/license UX (never a generic toast).
2. `retryable=true` → button + countdown (`retryAfterMs`); auto-retry only for idempotent reads (max 2).
3. `422` → inline field-level or dialog-level errors with `details`; form stays open with user input intact.
4. Toast only for transient (success/info); errors on destructive actions render in Modal/D-004 context.
5. Every error code is documented in-app (Help → "Error reference") — users never see raw `message`.
6. Errors are logged to Local Diagnostics with redaction (no money, no secrets, no paths with user names when removable).
7. Aggregation: 5+ identical errors in 1 min → collapsed banner + link to error log.

*Referenced by: API-SPEC.md, QA-CHECKLIST.md, SECURITY-CHECKLIST.md, CLAUDE.md.*
