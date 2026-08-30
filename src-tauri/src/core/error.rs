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
}

impl AppError {
    pub fn body(&self) -> ErrorBody {
        let (code, user_message, http_status, retryable, retry_after_ms) = match self {
            AppError::PinInvalid => (
                "AUTH_PIN_INVALID",
                "Incorrect PIN. Please try again.",
                401,
                true,
                None,
            ),
            AppError::Locked { retry_after_ms } => (
                "AUTH_LOCKED",
                "Too many attempts. Try again later.",
                423,
                false,
                Some(*retry_after_ms),
            ),
            AppError::DecryptFailed => (
                "STORAGE_DECRYPT_FAILED",
                "This Company file could not be decrypted. Choose a different file or restore a backup.",
                500,
                false,
                None,
            ),
            AppError::SessionRequired => {
                ("SESSION_LOCKED", "The session is locked. Unlock first.", 401, true, None)
            }
            AppError::InvalidArgument(_) => ("VALUE_INVALID", "Invalid arguments.", 422, false, None),
            AppError::Scope(_) => ("VALUE_INVALID", "This operation is not permitted.", 403, false, None),
            AppError::Db(_) => ("INTERNAL", "A database error occurred.", 500, true, None),
            AppError::Internal(_) => ("INTERNAL", "An unexpected error occurred. Please try again.", 500, true, None),
            AppError::CalendarConflict(_) => (
                "CAL_53WEEK_CONFLICT",
                "The 53rd week rule conflicts with your FY start. Choose NRF (4+ days) or full-week rule.",
                422,
                false,
                None,
            ),
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

    pub fn cal_53week_conflict() -> Self {
        AppError::CalendarConflict("nrf_4_day is exclusive to the 454 preset".into())
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
