//! AppError — the single typed error surface (ERROR-HANDLING.md; B12).
//! Codes are the exact strings from docs/ERROR-HANDLING.md; every command returns this shape.
//! `Serialize` is implemented manually so a Tauri `Err` resolves to the documented error object
//! (snake_case → camelCase per the IPC contract in API-SPEC §1).

use serde::{ser::SerializeStruct, Serialize};

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
    // Only the 97 locked codes are ever emitted; row-level problems without a dedicated
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
    ImportTieOutFailed { debits_minor: i64, credits_minor: i64, currency: String, diff_rows: serde_json::Value },
    #[error("source file already imported as batch {existing_batch}")]
    ImportBatchHashExists { existing_batch: String },
    #[error("account code {} resolves to {} accounts", code, accounts.len())]
    MapAccountAmbiguous { code: String, accounts: Vec<String> },
    #[error("driver/period granularity mismatch: {0}")]
    UnitPeriodMismatch(String),
    #[error("opening balances already set: {0}")]
    OpeningAlreadySet(String),
    #[error("batch already rolled back")]
    BatchAlreadyRolledBack,
    #[error("period not found: {0}")]
    PeriodNotFound(String),
}

impl AppError {
    pub fn body(&self) -> ErrorBody {
        let (code, http_status, retryable, retry_after_ms) = match self {
            AppError::PinInvalid => ("AUTH_PIN_INVALID", 401, true, None),
            AppError::Locked { retry_after_ms } => ("AUTH_LOCKED", 423, false, Some(*retry_after_ms)),
            // ERROR-HANDLING.md §B: key mismatch is 401 with the exact documented user text.
            AppError::DecryptFailed => ("STORAGE_DECRYPT_FAILED", 401, false, None),
            AppError::FileExists => ("STORAGE_FILE_EXISTS", 409, false, None),
            AppError::SessionRequired => ("SESSION_LOCKED", 401, true, None),
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
            AppError::ImportBatchHashExists { .. } => ("IMPORT_BATCH_HASH_EXISTS", 409, false, None),
            AppError::MapAccountAmbiguous { .. } => ("MAP_ACCOUNT_AMBIGUOUS", 422, false, None),
            AppError::UnitPeriodMismatch(_) => ("UNIT_PERIOD_MISMATCH", 422, false, None),
            AppError::OpeningAlreadySet(_) => ("OPENING_ALREADY_SET", 409, false, None),
            AppError::BatchAlreadyRolledBack => ("BATCH_ALREADY_ROLLED_BACK", 409, false, None),
            AppError::PeriodNotFound(_) => ("PERIOD_NOT_FOUND", 404, false, None),
        };
        let user_message = match self {
            AppError::PinInvalid => "Incorrect PIN. Please try again.",
            AppError::Locked { .. } => "Too many attempts. Try again later.",
            AppError::DecryptFailed => "The Company file cannot be decrypted with this PIN.",
            AppError::FileExists => "A file already exists at that location. Choose another name.",
            AppError::SessionRequired => "The session is locked. Unlock first.",
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
            AppError::ImportTieOutFailed { debits_minor, credits_minor, currency, diff_rows } => {
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
            AppError::MapAccountAmbiguous { code: account_code, accounts } => {
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
            AppError::UnitPeriodMismatch(_) => {
                "Driver data is weekly but the calendar is monthly. Aggregate (sum) or reject?"
            }
            AppError::OpeningAlreadySet(_) => {
                "Opening balances already exist for this period. Use a new Actuals batch to adjust."
            }
            AppError::BatchAlreadyRolledBack => "This batch was already rolled back.",
            // Exact documented text (ERROR-HANDLING §2, 404 — never an invented message (B12)).
            AppError::PeriodNotFound(_) => "Period not found in this calendar.",
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
        AppError::ImportBatchHashExists { existing_batch: existing_batch.to_string() }
    }

    pub fn map_account_ambiguous(code: &str, accounts: Vec<String>) -> Self {
        AppError::MapAccountAmbiguous { code: code.to_string(), accounts }
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
