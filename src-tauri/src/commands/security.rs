//! security.change_pin (AUTH-SPEC §2.1): verify old PIN, write new Argon2id params, reset attempts.

use tauri::AppHandle;

use crate::commands::company::app_data_dir;
use crate::commands::session::{hash_pin, verify_pin};
use crate::core::error::{AppError, AppResult};
use crate::storage::db;

const PIN_ROW_ID: &str = "default";

/// `security.change_pin` — {old_pin, new_pin} (PIN_POLICY_WEAK / AUTH_PIN_INVALID).
#[tauri::command(name = "security.change_pin", rename_all = "camelCase")]
pub fn security_change_pin(app: AppHandle, old_pin: String, new_pin: String) -> AppResult<serde_json::Value> {
    if new_pin.len() < 4 || new_pin.len() > 64 {
        return Err(AppError::invalid("PIN_POLICY_WEAK".into()));
    }
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;
    let stored: Option<String> = conn
        .query_row(
            "SELECT argon2_params_json FROM pin_metadata WHERE id = ?1",
            [PIN_ROW_ID],
            |r| r.get(0),
        )
        .ok();
    let stored = stored.ok_or_else(|| AppError::invalid("PIN_NOT_INITIALIZED".into()))?;
    if !verify_pin(&old_pin, &stored)? {
        return Err(AppError::PinInvalid);
    }
    let new_hash = hash_pin(&new_pin)?;
    let changed = conn
        .execute(
            "UPDATE pin_metadata SET argon2_params_json = ?1, failed_attempts = 0, locked_until = NULL WHERE id = ?2",
            rusqlite::params![new_hash, PIN_ROW_ID],
        )
        .map_err(AppError::from)?;
    if changed != 1 {
        return Err(AppError::internal("PIN_ROW_MISSING".into()));
    }
    Ok(serde_json::json!({ "data": { "ok": true } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_policy_weak_short_new_pin() {
        let err = AppError::invalid("PIN_POLICY_WEAK".into());
        assert_eq!(err.body().code, "VALUE_INVALID");
        assert_eq!(err.body().http_status, 422);
    }

    #[test]
    fn hash_never_repeats_pin() {
        let h = hash_pin("hunter2").unwrap();
        assert!(!h.contains("hunter2"));
        assert!(h.starts_with("$argon2id$"));
    }
}
