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
}

impl AppError {
    pub fn body(&self) -> ErrorBody {
        let (code, http_status, retryable, retry_after_ms) = match self {
            AppError::PinInvalid => ("AUTH_PIN_INVALID", 401, true, None),
            AppError::Locked { retry_after_ms } => ("AUTH_LOCKED", 423, false, Some(*retry_after_ms)),
            AppError::DecryptFailed => ("STORAGE_DECRYPT_FAILED", 500, false, None),
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
        };
        let user_message = match self {
            AppError::PinInvalid => "Incorrect PIN. Please try again.",
            AppError::Locked { .. } => "Too many attempts. Try again later.",
            AppError::DecryptFailed => {
                "This Company file could not be decrypted. Choose a different file or restore a backup."
            }
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

    pub fn company_recent_use(days: u16) -> Self {
        AppError::CompanyRecentUse { days }
    }

    pub fn transit_ambiguous(msg: impl Into<String>) -> Self {
        AppError::TransitAmbiguous(msg.into())
    }

    pub fn period_mapping_conflict(msg: impl Into<String>) -> Self {
        AppError::PeriodMappingConflict(msg.into())
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
