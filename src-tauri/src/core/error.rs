//! AppError — the single typed error surface (ERROR-HANDLING.md; B12).
//! Codes are the exact strings from docs/ERROR-HANDLING.md; every command returns this shape.
//! `Serialize` is implemented manually so a Tauri `Err` resolves to the documented error object
//! (snake_case → camelCase per the IPC contract in API-SPEC §1).

use serde::{Serialize, ser::SerializeStruct};

#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    pub user_message: String,
    pub http_status: u16,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
    pub details: serde_json::Value,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum AppError {
    #[error("incorrect PIN")]
    PinInvalid,
    #[error("too many attempts — locked out")]
    Locked { retry_after_ms: u64 },
    #[error("company file could not be decrypted")]
    DecryptFailed,
    #[error("a file already exists at that location")]
    FileExists,
    #[error("session required")]
    SessionRequired,
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("scope error: {0}")]
    Scope(String),
    #[error("database: {0}")]
    Db(String),
    #[error("internal: {0}")]
    Internal(String),
    #[error("53-week rule conflict: {0}")]
    CalendarConflict(String),
    #[error("PIN does not meet the policy")]
    PinPolicyWeak,
    #[error("company file missing or corrupt")]
    FileCorrupt,
    #[error("company used recently — retention window applies")]
    CompanyRecentUse { days: u16 },
    #[error("transit mapping ambiguous: {0}")]
    TransitAmbiguous(String),
    #[error("period mapping conflict: {0}")]
    PeriodMappingConflict(String),
    #[error("audit chain verification failed at seq {at_seq}")]
    AuditChainBreak { at_seq: i64 },
    // ── Ingestion (GL-TEMPLATE-SPEC §6 / ERROR-HANDLING §C/F) ─────────────────
    // Native emits only its implemented subset of the locked catalog; row-level problems without a dedicated
    // code (blank column, unparseable number, unknown currency) reuse VALUE_INVALID and
    // carry the specific reason in `message`/`details` (B20: reuse, never invent).
    #[error("file could not be read: {0}")]
    ImportFileUnreadable(String),
    #[error("workbook is password protected: {0}")]
    ImportFileLocked(String),
    #[error("encoding not detected: {0}")]
    EncodingUnsupported(String),
    #[error("parse session expired or unknown: {0}")]
    ImportParseExpired(String),
    #[error("import tie-out failed: debits {debits_minor} != credits {credits_minor}")]
    ImportTieOutFailed {
        debits_minor: i64,
        credits_minor: i64,
        currency: String,
        diff_rows: serde_json::Value,
    },
    #[error("source file already imported as batch {existing_batch}")]
    ImportBatchHashExists { existing_batch: String },
    #[error("account code {} resolves to {} accounts", code, accounts.len())]
    MapAccountAmbiguous { code: String, accounts: Vec<String> },
    #[error("mapping target invalid: {0}")]
    MapTargetInvalid(String),
    #[error("driver/period granularity mismatch: {0}")]
    UnitPeriodMismatch(String),
    #[error("opening balances already set: {0}")]
    OpeningAlreadySet(String),
    #[error("batch already rolled back")]
    BatchAlreadyRolledBack,
    #[error("period not found: {0}")]
    PeriodNotFound(String),
    // ── Model grid (FORMULA-ENGINE-SPEC §4 / ERROR-HANDLING §E) ──────────────────────────
    // Codes are the locked ERROR-HANDLING taxonomy; never invent a new code (B20).
    #[error("formula uses unsupported function {function}")]
    FormulaUnsupported { function: String },
    #[error("scenario is locked")]
    ModelCellLocked,
    #[error("formula cycle detected: {path:?}")]
    FormulaCycle { path: Vec<String> },
    #[error("reference to {cell} is broken")]
    ReferenceBroken { cell: String },
    #[error("driver value {value} is outside bounds [{low}, {high}]")]
    DriverOutOfBounds {
        value: String,
        low: String,
        high: String,
    },
    #[error("assumption is used by a locked baseline")]
    AssumptionInUseLocked { assumption_id: String },
    #[error("hardcoded assumption at {cell}")]
    HardcodedAssumption { cell: String },
    // ── COA (F-002 / ERROR-HANDLING) ─────────────────────────────────────────────────────
    /// Import hits an existing code with a DIFFERENT account type (same type updates, never
    /// a silent type flip — LICENSE-free COA semantics, S-021).
    #[error("account code {code} already exists with a different type")]
    CoaDuplicateCode { code: String },
    #[error("settings write failed: {0}")]
    SettingsSaveFailed(String),
    #[error("cannot merge: account types differ ({from_type} vs {to_type})")]
    CoaTypeMismatch { from_type: String, to_type: String },
    /// Import would touch an account already referenced by GL lines — history is never
    /// rewritten (S-021: merge or remap instead).
    #[error("account is used by {count} lines; merge or remap instead")]
    CoaReferenced { count: i64 },
    // ── License (F-035 / ERROR-HANDLING §H) ──────────────────────────────────────────────
    /// Ed25519 signature verify failed, machine-fingerprint mismatch, or Company hash
    /// mismatch — all surface as the single locked code (LICENSE-SPEC §Statuses).
    #[error("license signature verification failed: {reason}")]
    LicenseInvalidSignature { reason: String },
    #[error("license is past expiry and beyond the 60-day grace window")]
    LicenseExpired,
    // ── Headcount schedule (F-016 / S-045 / ERROR-HANDLING) ──────────────────────────────
    #[error("headcount date invalid: {reason}")]
    HcDateInvalid {
        row_id: String,
        row_index: usize,
        reason: String,
    },
    #[error("headcount overlap for {role} in cost center {cost_center}")]
    HcOverlap {
        role: String,
        cost_center: String,
        period_id: Option<String>,
        row_ids: Vec<String>,
    },
    // ── Scenario Management ──────────────────────────────────────────────────────────────
    #[error("scenario name already exists: {name}")]
    ScenarioNameDup { name: String },
    #[error("scenario is already in {state}")]
    ScenarioLockConflict { state: String },
    #[error("baseline replace requires a reason")]
    BaselineReplaceReasonRequired {
        current_baseline_scenario_id: Option<String>,
    },
    // ── Model Compare (F-022 / ERROR-HANDLING §E) ──────────────────────────────────────────
    #[error("cannot compare: models or COAs differ")]
    CompareIncompatible,
    // ── What-If, Sensitivity & Goal Seek (F-022 · M4-4 · ERROR-HANDLING §E) ────────────────
    #[error(
        "goal seek did not converge in 100 iterations: last value {last_value}, target {target}"
    )]
    GoalSeekNoConverge { last_value: String, target: String },
    #[error("sensitivity range exceeds assumption bounds")]
    SensitivityOutOfBounds,
    // ── Planning Cycle & Input Collection (F-021 · F-023 · M4-5 · M4-6 · ERROR-HANDLING §E) ─
    #[error("a planning cycle with this name already exists")]
    CycleNameDup,
    #[error("this task is blocked by unfinished tasks: {list}")]
    CycleTaskBlocked { list: String },
    #[error("driver value changed by more than one contributor")]
    CollectionConflict { conflict_count: usize },
    #[error("returned sheet differs from exported template")]
    CollectionStructureChanged,
    // ── Variance & Attribution (F-024 · M5-1 · M5-2 · ERROR-HANDLING §E) ────────────────────
    #[error("selected periods mix actual and forecast")]
    VarianceSourceMixed,
    #[error("attribution unavailable for these lines")]
    VarianceNoAttributionData,
    // ── FVA Forecast Value Add (F-025 · M5-3 · ERROR-HANDLING §E) ──────────────────────────
    #[error("actuals were restated for these periods")]
    FvaRestatementFlag,
    // ── Statement suite (F-027 · M6-1 · ERROR-HANDLING) ────────────────────────────────────
    #[error("statement tie-out failed: {detail}")]
    StatementTieOutFailed {
        detail: String,
        findings: serde_json::Value,
    },
    #[error("statement scope mixes periods, calendars or currencies")]
    StatementSourceMixed,
    // ── Alerts (F-026 / ERROR-HANDLING §H-domain ALERT_RULE_INVALID) ──────────────────────
    /// Rule failed validation (target pair, operator/severity domain, or exact-decimal
    /// threshold). The catalog user text is "Alert rule invalid: {detail}".
    #[error("alert rule invalid: {detail}")]
    AlertRuleInvalid { detail: String },
    // ── Health Check (F-032 / ERROR-HANDLING §G) ──────────────────────────────────────────
    /// A waiver was submitted without a reason. Friction is intentional (US-033): a Health
    /// Check finding is never silently dismissed — the reason is persisted and audited.
    #[error("a waiver reason is required")]
    HealthWaiverReasonRequired,
    /// Export/save gate: `n` unwaived findings block the action (F-032). Carried so the
    /// export layer (M6-6) can raise the documented text without re-deriving the count.
    #[error("export blocked by {count} unwaived Health Check finding(s)")]
    HealthCheckBlocked { count: i64 },
}

impl AppError {
    pub fn body(&self) -> ErrorBody {
        let (code, http_status, retryable, retry_after_ms) = match self {
            // ERROR-HANDLING.md §A, verbatim: AUTH_PIN_INVALID 401 / retry=false (the user types a
            // new PIN — the same call is never re-issued); AUTH_LOCKED 423 / retry=true *after* the
            // countdown carried in `retryAfterMs`; SESSION_LOCKED 401 / retry=false (unlock first).
            AppError::PinInvalid => ("AUTH_PIN_INVALID", 401, false, None),
            AppError::Locked { retry_after_ms } => {
                ("AUTH_LOCKED", 423, true, Some(*retry_after_ms))
            }
            // ERROR-HANDLING.md §B: key mismatch is 401 with the exact documented user text.
            AppError::DecryptFailed => ("STORAGE_DECRYPT_FAILED", 401, false, None),
            AppError::FileExists => ("STORAGE_FILE_EXISTS", 409, false, None),
            AppError::SessionRequired => ("SESSION_LOCKED", 401, false, None),
            AppError::InvalidArgument(_) => ("VALUE_INVALID", 422, false, None),
            AppError::Scope(_) => ("VALUE_INVALID", 403, false, None),
            AppError::Db(_) => ("INTERNAL", 500, true, None),
            AppError::Internal(_) => ("INTERNAL", 500, true, None),
            AppError::PinPolicyWeak => ("PIN_POLICY_WEAK", 422, false, None),
            AppError::CalendarConflict(_) => ("CAL_53WEEK_CONFLICT", 422, false, None),
            AppError::FileCorrupt => ("STORAGE_FILE_CORRUPT", 422, false, None),
            AppError::CompanyRecentUse { .. } => ("COMPANY_IN_USE_RECENT", 409, false, None),
            AppError::TransitAmbiguous(_) => ("CAL_TRANSIT_AMBIGUOUS", 422, false, None),
            AppError::PeriodMappingConflict(_) => ("CAL_PERIOD_MAPPING_CONFLICT", 409, false, None),
            AppError::AuditChainBreak { .. } => ("AUDIT_CHAIN_BREAK", 409, false, None),
            AppError::ImportFileUnreadable(_) => ("IMPORT_FILE_UNREADABLE", 422, false, None),
            AppError::ImportFileLocked(_) => ("IMPORT_FILE_LOCKED", 422, false, None),
            // ERROR-HANDLING §C: the only ingestion code the UI may retry (pick an encoding).
            AppError::EncodingUnsupported(_) => ("ENCODING_UNSUPPORTED", 422, true, None),
            AppError::ImportParseExpired(_) => ("IMPORT_PARSE_EXPIRED", 410, true, None),
            AppError::ImportTieOutFailed { .. } => ("IMPORT_TIE_OUT_FAILED", 422, false, None),
            AppError::ImportBatchHashExists { .. } => {
                ("IMPORT_BATCH_HASH_EXISTS", 409, false, None)
            }
            AppError::MapAccountAmbiguous { .. } => ("MAP_ACCOUNT_AMBIGUOUS", 422, false, None),
            AppError::MapTargetInvalid(_) => ("MAP_TARGET_INVALID", 422, false, None),
            AppError::UnitPeriodMismatch(_) => ("UNIT_PERIOD_MISMATCH", 422, false, None),
            AppError::OpeningAlreadySet(_) => ("OPENING_ALREADY_SET", 409, false, None),
            AppError::BatchAlreadyRolledBack => ("BATCH_ALREADY_ROLLED_BACK", 409, false, None),
            AppError::PeriodNotFound(_) => ("PERIOD_NOT_FOUND", 404, false, None),
            AppError::FormulaUnsupported { .. } => {
                ("FORMULA_UNSUPPORTED_FUNCTION", 422, false, None)
            }
            AppError::ModelCellLocked => ("MODEL_CELL_LOCKED", 422, false, None),
            AppError::FormulaCycle { .. } => ("FORMULA_CYCLE", 422, false, None),
            AppError::ReferenceBroken { .. } => ("REFERENCE_BROKEN", 422, false, None),
            AppError::DriverOutOfBounds { .. } => ("DRIVER_OUT_OF_BOUNDS", 422, false, None),
            AppError::AssumptionInUseLocked { .. } => {
                ("ASSUMPTION_IN_USE_LOCKED", 422, false, None)
            }
            AppError::HardcodedAssumption { .. } => ("HARDCODED_ASSUMPTION", 422, false, None),
            // ERROR-HANDLING §H: both license codes are 403, not retryable.
            AppError::LicenseInvalidSignature { .. } => {
                ("LICENSE_INVALID_SIGNATURE", 403, false, None)
            }
            AppError::LicenseExpired => ("LICENSE_EXPIRED", 403, false, None),
            // ERROR-HANDLING §H: settings writes are exactly the documented retryable 500.
            AppError::SettingsSaveFailed(_) => ("SETTINGS_SAVE_FAILED", 500, true, None),
            AppError::CoaDuplicateCode { .. } => ("COA_DUPLICATE_CODE", 409, false, None),
            AppError::CoaTypeMismatch { .. } => ("COA_TYPE_MISMATCH", 422, false, None),
            AppError::CoaReferenced { .. } => ("COA_REFERENCED", 409, false, None),
            AppError::HcDateInvalid { .. } => ("HC_DATE_INVALID", 422, false, None),
            AppError::HcOverlap { .. } => ("HC_OVERLAP", 422, false, None),
            AppError::ScenarioNameDup { .. } => ("SCENARIO_NAME_DUP", 409, false, None),
            AppError::ScenarioLockConflict { .. } => ("SCENARIO_LOCK_CONFLICT", 409, false, None),
            AppError::BaselineReplaceReasonRequired { .. } => {
                ("BASELINE_REPLACE_REASON_REQUIRED", 422, false, None)
            }
            AppError::CompareIncompatible => ("COMPARE_INCOMPATIBLE", 422, false, None),
            AppError::GoalSeekNoConverge { .. } => ("GOAL_SEEK_NO_CONVERGE", 422, false, None),
            AppError::SensitivityOutOfBounds => ("SENSITIVITY_OUT_OF_BOUNDS", 422, false, None),
            AppError::CycleNameDup => ("CYCLE_NAME_DUP", 409, false, None),
            AppError::CycleTaskBlocked { .. } => ("CYCLE_TASK_BLOCKED", 409, false, None),
            AppError::CollectionConflict { .. } => ("COLLECTION_CONFLICT", 409, false, None),
            AppError::CollectionStructureChanged => {
                ("COLLECTION_STRUCTURE_CHANGED", 422, false, None)
            }
            AppError::VarianceSourceMixed => ("VARIANCE_SOURCE_MIXED", 422, false, None),
            AppError::VarianceNoAttributionData => {
                ("VARIANCE_NO_ATTRIBUTION_DATA", 200, false, None)
            }
            AppError::FvaRestatementFlag => ("FVA_RESTATEMENT_FLAG", 200, true, None),
            // ERROR-HANDLING: statement codes are 422, never retryable (the fix is in the
            // data/scope, not the call).
            AppError::StatementTieOutFailed { .. } => {
                ("STATEMENT_TIE_OUT_FAILED", 422, false, None)
            }
            AppError::StatementSourceMixed => ("STATEMENT_SOURCE_MIXED", 422, false, None),
            AppError::AlertRuleInvalid { .. } => ("ALERT_RULE_INVALID", 422, false, None),
            AppError::HealthWaiverReasonRequired => {
                ("HEALTH_WAIVER_REASON_REQUIRED", 422, false, None)
            }
            AppError::HealthCheckBlocked { .. } => ("HEALTH_CHECK_BLOCKED", 422, false, None),
        };
        let user_message = match self {
            // ERROR-HANDLING §A userMessages (KI-013) — kept verbatim with the doc templates.
            AppError::PinInvalid => "Incorrect PIN.",
            AppError::Locked { .. } => "Too many attempts. Try again in {countdown}s.",
            AppError::DecryptFailed => "The Company file cannot be decrypted with this PIN.",
            AppError::FileExists => "A file already exists at that location. Choose another name.",
            AppError::SessionRequired => "Session locked. Unlock to continue.",
            AppError::InvalidArgument(_) => "Invalid arguments.",
            AppError::Scope(_) => "This operation is not permitted.",
            AppError::Db(_) => "A database error occurred.",
            AppError::Internal(_) => "An unexpected error occurred. Please try again.",
            AppError::PinPolicyWeak => "PIN must be ≥8 characters with letters and digits.",
            AppError::CalendarConflict(_) => {
                "The 53rd week rule conflicts with your FY start. Choose NRF (4+ days) or full-week rule."
            }
            AppError::FileCorrupt => {
                "This Company file could not be verified. Restore from Backup? (pre-restore snapshot will be taken)"
            }
            AppError::CompanyRecentUse { days } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "This Company was used less than {days} days ago. Delete it or wait — recent Companies can't be deleted."
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({}),
                };
            }
            AppError::TransitAmbiguous(_) => {
                "BU period spans two Group periods. Map both date ranges to proceed."
            }
            AppError::PeriodMappingConflict(_) => {
                "Two BUs map the same Group period with different calendars — confirm the Transit Map."
            }
            AppError::LicenseInvalidSignature { reason } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: "This license key is invalid. Contact your vendor.".to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "reason": reason }),
                };
            }
            AppError::LicenseExpired => {
                "License expired. The Company is read-only. Activate to continue."
            }
            // Exact documented text (ERROR-HANDLING.md §H).
            AppError::SettingsSaveFailed(_) => "Settings could not be saved. Retry.",
            AppError::CoaDuplicateCode { code } => {
                // Exact documented template (ERROR-HANDLING.md) with the colliding code.
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!("Account code {code} already exists in this scope."),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "code": code }),
                };
            }
            AppError::CoaTypeMismatch { from_type, to_type } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "Cannot merge: account types differ ({} vs {}).",
                        cap(from_type),
                        cap(to_type)
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "fromType": from_type, "toType": to_type }),
                };
            }
            AppError::CoaReferenced { count } => {
                // Exact documented template (ERROR-HANDLING.md) with the live usage count.
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "Account is used by {count} lines/batches. Merge or remap instead of deleting."
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "count": count }),
                };
            }
            AppError::AuditChainBreak { at_seq } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    // Exact documented text (ERROR-HANDLING.md §H) — the restore offer.
                    user_message:
                        "Audit integrity check failed. Restore from the last verified Snapshot?"
                            .to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "brokenAtSeq": at_seq }),
                };
            }
            AppError::ImportFileUnreadable(_) => {
                "This file could not be read. Export it again as .xlsx or .csv without a password."
            }
            AppError::ImportFileLocked(_) => {
                "This file is password-protected. Remove protection and export again."
            }
            AppError::EncodingUnsupported(_) => {
                "Encoding not detected. Choose UTF-8 or Latin-1 (preview) and continue."
            }
            AppError::ImportParseExpired(_) => "This parse session expired. Re-run the import.",
            AppError::ImportTieOutFailed {
                debits_minor,
                credits_minor,
                currency,
                diff_rows,
            } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    // Exact documented text (ERROR-HANDLING §1 canonical example): money is
                    // rendered from exact minor units, never from a float.
                    user_message: format!(
                        "Import blocked: debits {} vs credits {}. Review flagged rows below.",
                        money_text(*debits_minor, currency),
                        money_text(*credits_minor, currency),
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({
                        "debitsMinor": debits_minor,
                        "creditsMinor": credits_minor,
                        "currency": currency,
                        "diffRows": diff_rows,
                    }),
                };
            }
            AppError::ImportBatchHashExists { existing_batch } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "This exact file was already imported (batch {existing_batch}). Re-import? This will create a new batch — confirm: duplicate rows are excluded automatically."
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "existingBatch": existing_batch }),
                };
            }
            AppError::MapAccountAmbiguous {
                code: account_code,
                accounts,
            } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "Account code maps to multiple Accounts ({}). Confirm the intended Account.",
                        accounts.join(", ")
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "accountCode": account_code, "list": accounts }),
                };
            }
            AppError::MapTargetInvalid(_) => {
                "This column cannot map to that field. Choose a supported target."
            }
            AppError::UnitPeriodMismatch(_) => {
                "Driver data is weekly but the calendar is monthly. Aggregate (sum) or reject?"
            }
            AppError::OpeningAlreadySet(_) => {
                "Opening balances already exist for this period. Use a new Actuals batch to adjust."
            }
            AppError::BatchAlreadyRolledBack => "This batch was already rolled back.",
            // Exact documented text (ERROR-HANDLING §2, 404 — never an invented message (B12)).
            AppError::PeriodNotFound(_) => "Period not found in this calendar.",
            AppError::FormulaUnsupported { function } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "Function {function} is not in the supported set (see FORMULA-ENGINE-SPEC.md). Replace it or file a V2 request."
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "function": function }),
                };
            }
            AppError::ModelCellLocked => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: "This scenario is locked. Create a Version to edit it."
                        .to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({}),
                };
            }
            AppError::FormulaCycle { path } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    // A full cycle path is never rendered as a raw number (FORMULA-ENGINE-SPEC §4) —
                    // the UI renders `#CYCLE!` and "Fix the reference".
                    user_message: format!(
                        "Formula cycle detected: path {} — shown as #CYCLE!. Fix the reference.",
                        path.join(" → ")
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "path": path }),
                };
            }
            AppError::ReferenceBroken { cell } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "Reference to {cell} is broken (sheet renamed/deleted). Repair or remove."
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "cell": cell }),
                };
            }
            AppError::DriverOutOfBounds { value, low, high } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "Driver value {value} is outside its bounds [{low}, {high}]. Update bounds (audited) or fix the value."
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "value": value, "low": low, "high": high }),
                };
            }
            AppError::AssumptionInUseLocked { assumption_id } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message:
                        "Assumption is used by a Locked Baseline. Create a new Version to change."
                            .to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "assumptionId": assumption_id }),
                };
            }
            AppError::HardcodedAssumption { cell } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: "This cell uses a hardcoded value instead of an Assumption Register reference. Convert (recommended) or waive with a reason.".to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "cell": cell }),
                };
            }
            AppError::HcDateInvalid {
                row_id,
                row_index,
                reason,
            } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message:
                        "A hire or termination date is outside the active fiscal calendar."
                            .to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({
                        "row_id": row_id,
                        "row_index": row_index,
                        "reason": reason,
                    }),
                };
            }
            AppError::HcOverlap {
                role,
                cost_center,
                period_id,
                row_ids,
            } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message:
                        "Two rows for the same role and cost center overlap in a fiscal period."
                            .to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({
                        "role": role,
                        "cost_center": cost_center,
                        "period_id": period_id,
                        "row_ids": row_ids,
                    }),
                };
            }
            AppError::ScenarioNameDup { name } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: "A Scenario with this name already exists.".to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "name": name }),
                };
            }
            AppError::ScenarioLockConflict { state } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "This Scenario is already in {state} — cannot transition."
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "state": state }),
                };
            }
            AppError::BaselineReplaceReasonRequired {
                current_baseline_scenario_id,
            } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: "Replacing the baseline requires a written reason.".to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "current_baseline_scenario_id": current_baseline_scenario_id }),
                };
            }
            AppError::CompareIncompatible => {
                "Cannot compare: Models/COAs differ. Select two Scenarios of the same Model."
            }
            AppError::GoalSeekNoConverge { last_value, target } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "Goal Seek did not converge in 100 iterations. Last value {last_value}, target {target}. Adjust bounds."
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({
                        "last_value": last_value,
                        "target": target,
                        "iterations": 100,
                    }),
                };
            }
            AppError::SensitivityOutOfBounds => {
                "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range."
            }
            AppError::CycleNameDup => "A planning cycle with this name already exists.",
            AppError::CycleTaskBlocked { list } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!("This task is blocked by unfinished tasks: {list}."),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "list": list }),
                };
            }
            AppError::CollectionConflict { conflict_count } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: "This Driver value was changed by more than one contributor. Resolve the conflict (choose or average) — never merged silently.".to_string(),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "conflict_count": conflict_count }),
                };
            }
            AppError::CollectionStructureChanged => {
                "The returned sheet differs from the exported template (rows/columns changed). Review the diff before merging."
            }
            AppError::VarianceSourceMixed => {
                "Selected periods mix Actual and Forecast — enable HYBRID label to view."
            }
            AppError::VarianceNoAttributionData => {
                "Attribution unavailable for these lines — no unit/driver data. Show $ variance only."
            }
            AppError::FvaRestatementFlag => {
                "Actuals were restated for these periods — FVA recomputed; versions unchanged."
            }
            // Exact documented text (ERROR-HANDLING §G, verbatim with the placeholders).
            AppError::StatementTieOutFailed { detail, findings } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    user_message: format!(
                        "Statement does not tie ({detail}). Export blocked — fix {findings} first.",
                        findings = findings_text(findings)
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "findings": findings }),
                };
            }
            AppError::AlertRuleInvalid { detail } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    // ERROR-HANDLING §H: canonical user text is "Alert rule invalid: {detail}".
                    user_message: format!("Alert rule invalid: {detail}"),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "detail": detail }),
                };
            }
            AppError::HealthCheckBlocked { count } => {
                return ErrorBody {
                    code: code.to_string(),
                    message: self.to_string(),
                    // ERROR-HANDLING §G verbatim, with {n} bound to the unwaived count.
                    user_message: format!(
                        "Export blocked by {count} Health Check findings. Fix or waive (reason required)."
                    ),
                    http_status,
                    retryable,
                    retry_after_ms,
                    details: serde_json::json!({ "count": count }),
                };
            }
            // ERROR-HANDLING §G verbatim.
            AppError::HealthWaiverReasonRequired => "A waiver reason is required.",
            AppError::StatementSourceMixed => {
                "Period/currency mix in scope is not comparable. Align scope or use Group translation."
            }
        };
        ErrorBody {
            code: code.to_string(),
            message: self.to_string(),
            user_message: user_message.to_string(),
            http_status,
            retryable,
            retry_after_ms,
            details: serde_json::json!({}),
        }
    }

    pub fn invalid(msg: impl Into<String>) -> Self {
        AppError::InvalidArgument(msg.into())
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        AppError::Internal(msg.into())
    }

    pub fn pin_policy_weak() -> Self {
        AppError::PinPolicyWeak
    }

    pub fn cal_53week_conflict() -> Self {
        AppError::CalendarConflict("nrf_4_day is exclusive to the 454 preset".into())
    }

    pub fn file_corrupt() -> Self {
        AppError::FileCorrupt
    }

    pub fn file_exists() -> Self {
        AppError::FileExists
    }

    pub fn company_recent_use(days: u16) -> Self {
        AppError::CompanyRecentUse { days }
    }

    pub fn transit_ambiguous(msg: impl Into<String>) -> Self {
        AppError::TransitAmbiguous(msg.into())
    }

    pub fn period_mapping_conflict(msg: impl Into<String>) -> Self {
        AppError::PeriodMappingConflict(msg.into())
    }

    pub fn audit_chain_break(at_seq: i64) -> Self {
        AppError::AuditChainBreak { at_seq }
    }

    pub fn import_file_unreadable(msg: impl Into<String>) -> Self {
        AppError::ImportFileUnreadable(msg.into())
    }

    pub fn import_file_locked(msg: impl Into<String>) -> Self {
        AppError::ImportFileLocked(msg.into())
    }

    pub fn encoding_unsupported(msg: impl Into<String>) -> Self {
        AppError::EncodingUnsupported(msg.into())
    }

    pub fn import_parse_expired(parse_id: &str) -> Self {
        AppError::ImportParseExpired(parse_id.to_string())
    }

    pub fn import_tie_out_failed(
        debits_minor: i64,
        credits_minor: i64,
        currency: &str,
        diff_rows: serde_json::Value,
    ) -> Self {
        AppError::ImportTieOutFailed {
            debits_minor,
            credits_minor,
            currency: currency.to_string(),
            diff_rows,
        }
    }

    pub fn import_batch_hash_exists(existing_batch: &str) -> Self {
        AppError::ImportBatchHashExists {
            existing_batch: existing_batch.to_string(),
        }
    }

    pub fn map_account_ambiguous(code: &str, accounts: Vec<String>) -> Self {
        AppError::MapAccountAmbiguous {
            code: code.to_string(),
            accounts,
        }
    }

    pub fn map_target_invalid(reason: impl Into<String>) -> Self {
        AppError::MapTargetInvalid(reason.into())
    }

    pub fn unit_period_mismatch(msg: impl Into<String>) -> Self {
        AppError::UnitPeriodMismatch(msg.into())
    }

    pub fn opening_already_set(msg: impl Into<String>) -> Self {
        AppError::OpeningAlreadySet(msg.into())
    }

    pub fn batch_already_rolled_back() -> Self {
        AppError::BatchAlreadyRolledBack
    }

    pub fn period_not_found(msg: impl Into<String>) -> Self {
        AppError::PeriodNotFound(msg.into())
    }

    pub fn formula_unsupported(function: &str) -> Self {
        AppError::FormulaUnsupported {
            function: function.to_string(),
        }
    }

    pub fn model_cell_locked() -> Self {
        AppError::ModelCellLocked
    }

    pub fn formula_cycle(path: Vec<String>) -> Self {
        AppError::FormulaCycle { path }
    }

    pub fn reference_broken(cell: &str) -> Self {
        AppError::ReferenceBroken {
            cell: cell.to_string(),
        }
    }

    pub fn driver_out_of_bounds(value: &str, low: &str, high: &str) -> Self {
        AppError::DriverOutOfBounds {
            value: value.to_string(),
            low: low.to_string(),
            high: high.to_string(),
        }
    }

    pub fn settings_save_failed(msg: impl Into<String>) -> Self {
        AppError::SettingsSaveFailed(msg.into())
    }

    pub fn assumption_in_use_locked(assumption_id: &str) -> Self {
        AppError::AssumptionInUseLocked {
            assumption_id: assumption_id.to_string(),
        }
    }

    pub fn hardcoded_assumption(cell: &str) -> Self {
        AppError::HardcodedAssumption {
            cell: cell.to_string(),
        }
    }

    pub fn hc_date_invalid(
        row_id: impl Into<String>,
        row_index: usize,
        reason: impl Into<String>,
    ) -> Self {
        AppError::HcDateInvalid {
            row_id: row_id.into(),
            row_index,
            reason: reason.into(),
        }
    }

    pub fn hc_overlap(
        role: impl Into<String>,
        cost_center: impl Into<String>,
        period_id: Option<String>,
        row_ids: Vec<String>,
    ) -> Self {
        AppError::HcOverlap {
            role: role.into(),
            cost_center: cost_center.into(),
            period_id,
            row_ids,
        }
    }

    pub fn scenario_name_dup(name: impl Into<String>) -> Self {
        AppError::ScenarioNameDup { name: name.into() }
    }

    pub fn scenario_lock_conflict(state: impl Into<String>) -> Self {
        AppError::ScenarioLockConflict {
            state: state.into(),
        }
    }

    pub fn baseline_replace_reason_required(current_baseline_scenario_id: Option<String>) -> Self {
        AppError::BaselineReplaceReasonRequired {
            current_baseline_scenario_id,
        }
    }

    pub fn compare_incompatible() -> Self {
        AppError::CompareIncompatible
    }

    pub fn goal_seek_no_converge(last_value: impl Into<String>, target: impl Into<String>) -> Self {
        AppError::GoalSeekNoConverge {
            last_value: last_value.into(),
            target: target.into(),
        }
    }

    pub fn sensitivity_out_of_bounds() -> Self {
        AppError::SensitivityOutOfBounds
    }

    pub fn cycle_name_dup() -> Self {
        AppError::CycleNameDup
    }

    pub fn cycle_task_blocked(list: impl Into<String>) -> Self {
        AppError::CycleTaskBlocked { list: list.into() }
    }

    pub fn collection_conflict(conflict_count: usize) -> Self {
        AppError::CollectionConflict { conflict_count }
    }

    pub fn collection_structure_changed() -> Self {
        AppError::CollectionStructureChanged
    }

    pub fn variance_source_mixed() -> Self {
        AppError::VarianceSourceMixed
    }

    pub fn variance_no_attribution_data() -> Self {
        AppError::VarianceNoAttributionData
    }

    pub fn fva_restatement_flag() -> Self {
        AppError::FvaRestatementFlag
    }

    pub fn statement_tie_out_failed(
        detail: impl Into<String>,
        findings: serde_json::Value,
    ) -> Self {
        AppError::StatementTieOutFailed {
            detail: detail.into(),
            findings,
        }
    }

    pub fn statement_source_mixed() -> Self {
        AppError::StatementSourceMixed
    }

    pub fn health_waiver_reason_required() -> Self {
        AppError::HealthWaiverReasonRequired
    }

    pub fn health_check_blocked(count: i64) -> Self {
        AppError::HealthCheckBlocked { count }
    }
}

/// Render a statement finding list for the documented STATEMENT_TIE_OUT_FAILED template
/// (ERROR-HANDLING §G): short codes joined, never raw JSON in a user message.
fn findings_text(findings: &serde_json::Value) -> String {
    match findings.as_array() {
        Some(list) if !list.is_empty() => {
            let codes: Vec<String> = list
                .iter()
                .filter_map(|f| f.get("code").and_then(|c| c.as_str()).map(str::to_string))
                .collect();
            if codes.is_empty() {
                format!("{} findings", list.len())
            } else {
                codes.join(", ")
            }
        }
        _ => "the listed findings".to_string(),
    }
}

/// Capitalize the first char for documented user text ("revenue" → "Revenue").
fn cap(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// Render exact minor units as a plain decimal string for user-facing text (MONEY-ROUNDING-SPEC
/// §2: no float, no locale symbol — the UI applies locale formatting, the core stays ISO-neutral).
fn money_text(minor: i64, currency: &str) -> String {
    match crate::core::money::MoneyValue::new(minor, currency) {
        Ok(m) => m.to_decimal_string(),
        Err(_) => minor.to_string(),
    }
}

/// Serialize as the documented error body (camelCase fields, ERROR-HANDLING §1).
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let b = self.body();
        let mut s = serializer.serialize_struct("AppError", 7)?;
        s.serialize_field("code", &b.code)?;
        s.serialize_field("message", &b.message)?;
        s.serialize_field("userMessage", &b.user_message)?;
        s.serialize_field("httpStatus", &b.http_status)?;
        s.serialize_field("retryable", &b.retryable)?;
        s.serialize_field("retryAfterMs", &b.retry_after_ms)?;
        s.serialize_field("details", &b.details)?;
        s.end()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// ERROR-HANDLING.md §A is the source of truth for the session/security envelopes
    /// (CLAUDE.md: when docs and code disagree, the code is the bug). Pinned here so the
    /// `retryable` flags cannot drift again (found drifted 2026-09-03).
    #[test]
    fn session_and_security_envelopes_match_error_handling_section_a() {
        let pin = AppError::PinInvalid.body();
        assert_eq!(pin.code, "AUTH_PIN_INVALID");
        assert_eq!(pin.http_status, 401);
        assert!(!pin.retryable, "AUTH_PIN_INVALID is not retryable (§A)");
        assert_eq!(pin.retry_after_ms, None);

        let locked = AppError::Locked {
            retry_after_ms: 30_000,
        }
        .body();
        assert_eq!(locked.code, "AUTH_LOCKED");
        assert_eq!(locked.http_status, 423);
        assert!(
            locked.retryable,
            "AUTH_LOCKED is retryable after the countdown (§A)"
        );
        assert_eq!(locked.retry_after_ms, Some(30_000));

        let session = AppError::SessionRequired.body();
        assert_eq!(session.code, "SESSION_LOCKED");
        assert_eq!(session.http_status, 401);
        assert!(
            !session.retryable,
            "SESSION_LOCKED is not retryable — unlock first (§A)"
        );
        assert_eq!(session.retry_after_ms, None);
    }

    /// The IPC serializer must emit the documented camelCase field names (API-SPEC §1).
    #[test]
    fn serializes_the_documented_camel_case_envelope() {
        let json = serde_json::to_value(AppError::Locked {
            retry_after_ms: 1_500,
        })
        .unwrap();
        assert_eq!(json["code"], "AUTH_LOCKED");
        assert_eq!(json["httpStatus"], 423);
        assert_eq!(json["retryable"], true);
        assert_eq!(json["retryAfterMs"], 1_500);
        assert!(json.get("userMessage").is_some());
        assert!(
            json.get("http_status").is_none(),
            "snake_case must not leak to the UI"
        );
    }

    #[test]
    fn headcount_error_envelopes_match_contract() {
        let date_err = AppError::hc_date_invalid("hc-row-1", 0, "not_an_iso_calendar_date").body();
        assert_eq!(date_err.code, "HC_DATE_INVALID");
        assert_eq!(date_err.http_status, 422);
        assert!(!date_err.retryable);
        assert_eq!(date_err.details["row_id"], "hc-row-1");
        assert_eq!(date_err.details["row_index"], 0);
        assert_eq!(date_err.details["reason"], "not_an_iso_calendar_date");

        let overlap_err = AppError::hc_overlap(
            "Engineer",
            "R&D",
            Some("p-1".to_string()),
            vec!["hc-1".to_string(), "hc-2".to_string()],
        )
        .body();
        assert_eq!(overlap_err.code, "HC_OVERLAP");
        assert_eq!(overlap_err.http_status, 422);
        assert!(!overlap_err.retryable);
        assert_eq!(overlap_err.details["role"], "Engineer");
        assert_eq!(overlap_err.details["cost_center"], "R&D");
        assert_eq!(overlap_err.details["period_id"], "p-1");
        assert_eq!(
            overlap_err.details["row_ids"],
            serde_json::json!(["hc-1", "hc-2"])
        );
    }

    #[test]
    fn scenario_errors_match_contract() {
        let dup = AppError::scenario_name_dup("Base Case").body();
        assert_eq!(dup.code, "SCENARIO_NAME_DUP");
        assert_eq!(dup.http_status, 409);
        assert!(!dup.retryable);
        assert_eq!(
            dup.user_message,
            "A Scenario with this name already exists."
        );
        assert_eq!(dup.details["name"], "Base Case");

        let lock = AppError::scenario_lock_conflict("Archived").body();
        assert_eq!(lock.code, "SCENARIO_LOCK_CONFLICT");
        assert_eq!(lock.http_status, 409);
        assert!(!lock.retryable);
        assert_eq!(
            lock.user_message,
            "This Scenario is already in Archived — cannot transition."
        );
        assert_eq!(lock.details["state"], "Archived");

        let replace1 =
            AppError::baseline_replace_reason_required(Some("scen-1".to_string())).body();
        assert_eq!(replace1.code, "BASELINE_REPLACE_REASON_REQUIRED");
        assert_eq!(replace1.http_status, 422);
        assert!(!replace1.retryable);
        assert_eq!(
            replace1.user_message,
            "Replacing the baseline requires a written reason."
        );
        assert_eq!(replace1.details["current_baseline_scenario_id"], "scen-1");

        let replace2 = AppError::baseline_replace_reason_required(None).body();
        assert_eq!(replace2.code, "BASELINE_REPLACE_REASON_REQUIRED");
        assert_eq!(
            replace2.details["current_baseline_scenario_id"],
            serde_json::Value::Null
        );
    }

    #[test]
    fn compare_incompatible_error_matches_contract() {
        let err = AppError::compare_incompatible().body();
        assert_eq!(err.code, "COMPARE_INCOMPATIBLE");
        assert_eq!(err.http_status, 422);
        assert!(!err.retryable);
        assert_eq!(err.retry_after_ms, None);
        assert_eq!(
            err.user_message,
            "Cannot compare: Models/COAs differ. Select two Scenarios of the same Model."
        );
        assert_eq!(err.details, serde_json::json!({}));
    }

    #[test]
    fn plan_whatif_and_sensitivity_errors_match_contract() {
        let gs = AppError::goal_seek_no_converge("285.4", "300.0").body();
        assert_eq!(gs.code, "GOAL_SEEK_NO_CONVERGE");
        assert_eq!(gs.http_status, 422);
        assert!(!gs.retryable);
        assert_eq!(gs.retry_after_ms, None);
        assert_eq!(
            gs.user_message,
            "Goal Seek did not converge in 100 iterations. Last value 285.4, target 300.0. Adjust bounds."
        );
        assert_eq!(gs.details["last_value"], "285.4");
        assert_eq!(gs.details["target"], "300.0");
        assert_eq!(gs.details["iterations"], 100);

        let sens = AppError::sensitivity_out_of_bounds().body();
        assert_eq!(sens.code, "SENSITIVITY_OUT_OF_BOUNDS");
        assert_eq!(sens.http_status, 422);
        assert!(!sens.retryable);
        assert_eq!(sens.retry_after_ms, None);
        assert_eq!(
            sens.user_message,
            "Sensitivity range exceeds the Assumption bounds. Adjust bounds or range."
        );
        assert_eq!(sens.details, serde_json::json!({}));
    }

    #[test]
    fn cycle_and_collection_errors_match_contract() {
        let dup = AppError::cycle_name_dup().body();
        assert_eq!(dup.code, "CYCLE_NAME_DUP");
        assert_eq!(dup.http_status, 409);
        assert!(!dup.retryable);
        assert_eq!(
            dup.user_message,
            "A planning cycle with this name already exists."
        );

        let blocked = AppError::cycle_task_blocked("Import all BU actuals").body();
        assert_eq!(blocked.code, "CYCLE_TASK_BLOCKED");
        assert_eq!(blocked.http_status, 409);
        assert!(!blocked.retryable);
        assert_eq!(
            blocked.user_message,
            "This task is blocked by unfinished tasks: Import all BU actuals."
        );
        assert_eq!(blocked.details["list"], "Import all BU actuals");

        let conflict = AppError::collection_conflict(2).body();
        assert_eq!(conflict.code, "COLLECTION_CONFLICT");
        assert_eq!(conflict.http_status, 409);
        assert!(!conflict.retryable);
        assert_eq!(
            conflict.user_message,
            "This Driver value was changed by more than one contributor. Resolve the conflict (choose or average) — never merged silently."
        );
        assert_eq!(conflict.details["conflict_count"], 2);

        let struct_changed = AppError::collection_structure_changed().body();
        assert_eq!(struct_changed.code, "COLLECTION_STRUCTURE_CHANGED");
        assert_eq!(struct_changed.http_status, 422);
        assert!(!struct_changed.retryable);
        assert_eq!(
            struct_changed.user_message,
            "The returned sheet differs from the exported template (rows/columns changed). Review the diff before merging."
        );

        let var_mixed = AppError::variance_source_mixed().body();
        assert_eq!(var_mixed.code, "VARIANCE_SOURCE_MIXED");
        assert_eq!(var_mixed.http_status, 422);
        assert!(!var_mixed.retryable);
        assert_eq!(
            var_mixed.user_message,
            "Selected periods mix Actual and Forecast — enable HYBRID label to view."
        );

        let var_no_attr = AppError::variance_no_attribution_data().body();
        assert_eq!(var_no_attr.code, "VARIANCE_NO_ATTRIBUTION_DATA");
        assert_eq!(var_no_attr.http_status, 200);
        assert!(!var_no_attr.retryable);
        assert_eq!(
            var_no_attr.user_message,
            "Attribution unavailable for these lines — no unit/driver data. Show $ variance only."
        );

        let fva_restated = AppError::fva_restatement_flag().body();
        assert_eq!(fva_restated.code, "FVA_RESTATEMENT_FLAG");
        assert_eq!(fva_restated.http_status, 200);
        assert!(fva_restated.retryable);
        assert_eq!(
            fva_restated.user_message,
            "Actuals were restated for these periods — FVA recomputed; versions unchanged."
        );
    }
}
