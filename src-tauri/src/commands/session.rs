//! session.status / session.unlock / session.lock (AUTH-SPEC §2).
//! PIN = Argon2id hash in pin_metadata (never the PIN itself); attempts/lockout enforced in Rust.
//! Company verification happens against the app DB; the encrypted `.fpa` container gate lands
//! with the Company file milestone (SECURITY-CHECKLIST A02) — error codes are already final.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use base64::Engine;
use chrono::Utc;
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::commands::company::app_data_dir;
use crate::core::error::{AppError, AppResult};
use crate::storage::db;

const PIN_ROW_ID: &str = "default";
const MAX_FAILED_ATTEMPTS: u32 = 5;
const LOCKOUT_MS: u64 = 30_000;
const MIN_PIN_LEN: usize = 4;

#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

#[derive(Clone, Serialize)]
struct Session {
    company_id: String,
    session_token: String,
}

pub fn hash_pin(pin: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|e| AppError::internal(format!("argon2 hash: {e}")))?
        .to_string();
    Ok(hash)
}

pub fn verify_pin(pin: &str, stored_hash: &str) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(stored_hash).map_err(|e| AppError::internal(format!("argon2 parse: {e}")))?;
    Ok(Argon2::default().verify_password(pin.as_bytes(), &parsed).is_ok())
}

/// Mint a fresh session token for `company_id` and swap it into the session state.
/// Shared by `session.unlock` and `company.open` (S-020) — one place owns the token (AUTH-SPEC §2).
pub fn mint_session(state: &State<'_, SessionState>, company_id: String) -> AppResult<String> {
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Uuid::new_v4().as_bytes());
    let mut guard = state.0.lock().map_err(|_| AppError::internal("session lock poisoned".into()))?;
    *guard = Some(Session { company_id, session_token: token.clone() });
    Ok(token)
}

/// `session.status` — pre-unlock safe (no secrets).
#[tauri::command(name = "session.status")]
pub fn session_status(state: State<'_, SessionState>) -> AppResult<serde_json::Value> {
    let guard = state.0.lock().map_err(|_| AppError::internal("session lock poisoned".into()))?;
    let unlocked = guard.is_some();
    Ok(serde_json::json!({
        "data": {
            "unlocked": unlocked,
            "company_id": guard.as_ref().map(|s| s.company_id.clone()),
            "license": null::<serde_json::Value>,
        }
    }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PinRow {
    hash: String,
    failed_attempts: u32,
    locked_until: Option<i64>, // unix ms
}

fn load_pin_row(conn: &Connection) -> Result<Option<PinRow>, AppError> {
    let mut stmt = conn
        .prepare("SELECT argon2_params_json, failed_attempts, locked_until FROM pin_metadata WHERE id = ?1")
        .map_err(AppError::from)?;
    let mut rows = stmt.query_map([PIN_ROW_ID], |r| {
        // locked_until is TEXT (unix ms as string); parse back to i64 — never trust a cast.
        let locked_until: Option<String> = r.get(2)?;
        Ok(PinRow {
            hash: r.get(0)?,
            failed_attempts: r.get::<_, i64>(1)? as u32,
            locked_until: locked_until.and_then(|s| s.parse::<i64>().ok()),
        })
    })?;
    match rows.next() {
        Some(r) => Ok(Some(r.map_err(AppError::from)?)),
        None => Ok(None),
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// `session.unlock` — verify PIN (Argon2id), enforce lockout, mint session token.
#[tauri::command(name = "session.unlock", rename_all = "camelCase")]
pub fn session_unlock(
    app: AppHandle,
    pin: String,
    company_id: String,
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    if pin.len() < MIN_PIN_LEN || pin.len() > 64 {
        return Err(AppError::invalid("PIN_POLICY_WEAK".into()));
    }
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;

    // Company must exist (file gate — encrypted container in a later milestone).
    let company_exists: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", [&company_id], |r| r.get(0))
        .map_err(AppError::from)?;
    if !company_exists {
        return Err(AppError::DecryptFailed);
    }

    let row = match load_pin_row(&conn)? {
        Some(r) => r,
        None => {
            // First-run bootstrap: the Wizard "set PIN" step creates this row (F-004).
            let hash = hash_pin(&pin)?;
            conn.execute(
                "INSERT INTO pin_metadata (id, argon2_params_json, recovery_phrase_hash, failed_attempts, locked_until)
                 VALUES (?1, ?2, '', 0, NULL)",
                rusqlite::params![PIN_ROW_ID, hash],
            )
            .map_err(AppError::from)?;
            PinRow { hash, failed_attempts: 0, locked_until: None }
        }
    };

    if let Some(until) = row.locked_until {
        if now_ms() < until {
            return Err(AppError::Locked { retry_after_ms: (until - now_ms()).max(1) as u64 });
        }
    }

    if verify_pin(&pin, &row.hash)? {
        conn.execute(
            "UPDATE pin_metadata SET failed_attempts = 0, locked_until = NULL WHERE id = ?1",
            [PIN_ROW_ID],
        )
        .map_err(AppError::from)?;
        // Touch last-activity so company.list `last_opened_at` reflects the unlock (F-001 retention).
        conn.execute(
            "UPDATE companies SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![Utc::now().to_rfc3339(), company_id],
        )
        .map_err(AppError::from)?;
        let token = mint_session(&state, company_id.clone())?;
        return Ok(serde_json::json!({ "data": { "company_id": company_id, "session_token": token } }));
    }

    // Wrong PIN: increment attempts; lockout at threshold (AUTH-SPEC §2).
    let attempts = row.failed_attempts + 1;
    if attempts >= MAX_FAILED_ATTEMPTS {
        let until = now_ms() + LOCKOUT_MS as i64;
        conn.execute(
            "UPDATE pin_metadata SET failed_attempts = 0, locked_until = ?1 WHERE id = ?2",
            rusqlite::params![until, PIN_ROW_ID],
        )
        .map_err(AppError::from)?;
        return Err(AppError::Locked { retry_after_ms: LOCKOUT_MS });
    }
    conn.execute(
        "UPDATE pin_metadata SET failed_attempts = ?1 WHERE id = ?2",
        rusqlite::params![attempts, PIN_ROW_ID],
    )
    .map_err(AppError::from)?;
    Err(AppError::PinInvalid)
}

/// `session.lock`
#[tauri::command(name = "session.lock")]
pub fn session_lock(state: State<'_, SessionState>) -> AppResult<serde_json::Value> {
    let mut guard = state.0.lock().map_err(|_| AppError::internal("session lock poisoned".into()))?;
    *guard = None;
    Ok(serde_json::json!({ "data": { "locked": true } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2_round_trip_and_wrong_pin() {
        let hash = hash_pin("1234").unwrap();
        assert!(verify_pin("1234", &hash).unwrap());
        assert!(!verify_pin("9999", &hash).unwrap());
    }

    #[test]
    fn hashes_are_salted_and_unique() {
        let a = hash_pin("1234").unwrap();
        let b = hash_pin("1234").unwrap();
        assert_ne!(a, b, "Argon2id must salt per hash (AUTH-SPEC §6)");
    }

    #[test]
    fn first_run_bootstrap_writes_pin_row() {
        let conn = db::open_in_memory().unwrap();
        // simulate wizard PIN setup
        let hash = hash_pin("1234").unwrap();
        conn.execute(
            "INSERT INTO pin_metadata (id, argon2_params_json, recovery_phrase_hash, failed_attempts, locked_until)
             VALUES (?, ?, '', 0, NULL)",
            rusqlite::params![PIN_ROW_ID, hash],
        )
        .unwrap();
        let row = load_pin_row(&conn).unwrap().unwrap();
        assert!(verify_pin("1234", &row.hash).unwrap());
        assert_eq!(row.failed_attempts, 0);
        assert!(row.locked_until.is_none());
    }
}
