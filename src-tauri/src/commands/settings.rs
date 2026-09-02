//! settings.get / settings.set (F-038 · S-075 · API-SPEC §2).
//!
//! App-global UI preferences are stored in the app-scope `settings` row (`scope='app'`,
//! `key` = a versioned document key, `value_json` = the validated JSON document). The write
//! is one SQLite transaction with an HMAC-chained audit event appended to the active Company's
//! chain, so every mutation is tamper-evident (AUTH-SPEC §2.5). localStorage remains the
//! pre-unlock/offline mirror only; the app DB is the authoritative store once a session exists.

use rusqlite::OptionalExtension;
use tauri::{AppHandle, State};

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{require_session_write, require_unlocked, SessionState};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::{db, keystore};

const SETTINGS_SCOPE_APP: &str = "app";
const SETTINGS_KEY_MAX_LEN: usize = 128;
const SETTINGS_VALUE_MAX_LEN: usize = 16_384;

fn validate_settings_key(key: &str) -> AppResult<()> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(AppError::settings_save_failed("settings key is required"));
    }
    if trimmed.len() > SETTINGS_KEY_MAX_LEN {
        return Err(AppError::settings_save_failed("settings key is too long"));
    }
    Ok(())
}

fn validate_settings_value(value_json: &str) -> AppResult<()> {
    if value_json.is_empty() || value_json.len() > SETTINGS_VALUE_MAX_LEN {
        return Err(AppError::settings_save_failed(
            "settings value must be a JSON document",
        ));
    }
    // The core is the writer: reject anything that is not a complete JSON value before it can
    // reach the DB disguised as a settings row (B18-1).
    serde_json::from_str::<serde_json::Value>(value_json)
        .map(|_| ())
        .map_err(|_| AppError::settings_save_failed("settings value is not valid JSON"))
}

/// `settings.get` — {key} → {value}. The active session is required because the app DB belongs
/// to the unlocked installation; a missing row is `null` (not an error) so first-use defaults
/// remain the client's job.
#[tauri::command(name = "settings.get", rename_all = "camelCase")]
pub fn settings_get(
    app: AppHandle,
    key: String,
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    require_unlocked(&state)?;
    let key = key.trim().to_string();
    validate_settings_key(&key)?;

    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;
    let value: Option<String> = conn
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1 AND scope = ?2",
            rusqlite::params![key, SETTINGS_SCOPE_APP],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": { "value": value } }))
}

/// `settings.set` — {key, value_json} → {ok}. A write is an app-scope settings upsert plus one
/// HMAC-chained audit event within the same transaction (never a silent auto-fix).
#[tauri::command(name = "settings.set", rename_all = "camelCase")]
pub fn settings_set(
    app: AppHandle,
    key: String,
    value_json: String,
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&state)?;
    let key = key.trim().to_string();
    validate_settings_key(&key)?;
    validate_settings_value(&value_json)?;

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir).map_err(AppError::from)?;
    let tx = conn.transaction().map_err(AppError::from)?;

    // App-scope settings are shared across Companies but written under the active Company's
    // session; the row itself is keyed globally (no company_id column in `settings`).
    tx.execute(
        "INSERT INTO settings (key, value_json, scope) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        rusqlite::params![key, value_json, SETTINGS_SCOPE_APP],
    )
    .map_err(AppError::from)?;

    let now = chrono::Utc::now().to_rfc3339();
    // Clone the key/value into the audit payload so they remain owned for the row insert below
    // (serde_json keeps the source usable, but this is the conservative, borrow-safe form).
    let after_json = serde_json::json!({
        "action": "settings.set",
        "key": key.clone(),
        "value_json": value_json.clone(),
        "created_at": now,
    })
    .to_string();
    let audit_key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id).map_err(AppError::from)?;
    let hash = next_hash(&audit_key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events
           (company_id, actor, action, object_type, object_id, before_json, after_json,
            prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'settings.set', 'settings', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, key, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": { "ok": true } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_key_requires_a_non_empty_trimmed_name() {
        assert!(validate_settings_key("onefpa.preferences.v1").is_ok());
        assert!(validate_settings_key("  onefpa.preferences.v1  ").is_ok());
        assert!(validate_settings_key("").is_err());
        assert!(validate_settings_key("   ").is_err());
        assert!(validate_settings_key(&"a".repeat(129)).is_err());
    }

    #[test]
    fn settings_value_must_be_complete_json() {
        assert!(validate_settings_value("{\"theme\":\"dark\"}").is_ok());
        assert!(validate_settings_value("null").is_ok());
        assert!(validate_settings_value("{}").is_ok());
        assert!(validate_settings_value("{not-json").is_err());
    }
}
