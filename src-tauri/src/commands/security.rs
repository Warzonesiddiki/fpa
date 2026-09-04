//! security.change_pin / security.pin_setup (AUTH-SPEC §2.1): verify old PIN, write new
//! Argon2id params, reset attempts. PIN registration is an explicit first-run command —
//! `session.unlock` never bootstraps the row (F-004; no insecure self-registration).

use tauri::{AppHandle, State};

use crate::commands::company::app_data_dir;
use crate::commands::session::{hash_pin, validate_pin_policy, verify_pin};
use crate::core::audit::{GENESIS_HASH, next_hash};
use crate::core::error::{AppError, AppResult};
use crate::storage::db;
use crate::storage::keys::{self, KeyVault, PinRecord};
use crate::storage::keystore;

const PIN_ROW_ID: &str = "default";

/// `security.change_pin` — {old_pin, new_pin} (PIN_POLICY_WEAK / AUTH_PIN_INVALID).
/// The Company files are NOT re-encrypted: the same vault key is re-sealed under the new PIN's
/// derived key with a fresh salt and nonce (AUTH-SPEC §2.4).
#[tauri::command(name = "security.change_pin", rename_all = "camelCase")]
pub fn security_change_pin(
    app: AppHandle,
    old_pin: String,
    new_pin: String,
) -> AppResult<serde_json::Value> {
    validate_pin_policy(&new_pin)?;
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;
    let stored: Option<String> = conn
        .query_row(
            "SELECT argon2_params_json FROM pin_metadata WHERE id = ?1",
            [PIN_ROW_ID],
            |r| r.get(0),
        )
        .ok();
    let stored = stored.ok_or_else(|| AppError::invalid("PIN_NOT_INITIALIZED"))?;
    let record = PinRecord::from_json(&stored)?;
    if !verify_pin(&old_pin, &record.phc)? {
        return Err(AppError::PinInvalid);
    }
    let mut vault_key = record.unseal_vault_key(&old_pin)?;
    let new_hash = hash_pin(&new_pin)?;
    let new_record = keys::reseal_pin_record(&vault_key, &new_pin, new_hash)?;
    keys::zeroize(&mut vault_key);
    let changed = conn
        .execute(
            "UPDATE pin_metadata SET argon2_params_json = ?1, failed_attempts = 0, locked_until = NULL WHERE id = ?2",
            rusqlite::params![new_record.to_json()?, PIN_ROW_ID],
        )
        .map_err(AppError::from)?;
    if changed != 1 {
        return Err(AppError::internal("PIN_ROW_MISSING"));
    }
    Ok(serde_json::json!({ "data": { "ok": true } }))
}

/// `security.pin_setup` — {pin, confirm}. First-run registration (AUTH-SPEC §2.1):
/// policy → Argon2id hash → transactional pin_metadata insert (attempts/lockout reset)
/// + HMAC audit marker. A second call fails closed (PIN_ALREADY_SET) — no silent overwrite.
#[tauri::command(name = "security.pin_setup", rename_all = "camelCase")]
pub fn security_pin_setup(
    app: AppHandle,
    pin: String,
    confirm: String,
    vault: State<'_, KeyVault>,
) -> AppResult<serde_json::Value> {
    validate_pin_policy(&pin)?;
    if pin != confirm {
        return Err(AppError::invalid(
            "PIN_CONFIRM_MISMATCH: confirm must equal pin",
        ));
    }
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pin_metadata WHERE id = ?1)",
            [PIN_ROW_ID],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if exists {
        return Err(AppError::invalid(
            "PIN_ALREADY_SET: a PIN is already registered for this installation",
        ));
    }

    let hash = hash_pin(&pin)?;
    // Key ceremony (AUTH-SPEC §2.1 step 5): generate the random vault key and seal it under
    // the PIN-derived key. Only the sealed copy is persisted; the vault key lives in memory so
    // the wizard can create the first Company without asking for the PIN again.
    let (record, mut vault_key) = keys::seal_pin_record(&pin, hash)?;
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO pin_metadata (id, argon2_params_json, recovery_phrase_hash, failed_attempts, locked_until)
         VALUES (?1, ?2, '', 0, NULL)",
        rusqlite::params![PIN_ROW_ID, record.to_json()?],
    )
    .map_err(AppError::from)?;

    // HMAC audit of the setup (AUTH-SPEC §2.1 step 6; keychain key — never the DB).
    // audit_events.company_id is a NOT NULL FK and no Company exists pre-registration, so the
    // app-scope event is stored as a tamper-evident settings marker (same HMAC chain primitives)
    // until the company-scoped chain starts at company.create (F-033).
    let after_json =
        serde_json::json!({ "action": "security.pin_setup", "created_at": now }).to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev: String = tx
        .query_row(
            "SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok()
        .unwrap_or_else(|| GENESIS_HASH.to_string());
    let hash_value = next_hash(&key, &prev, after_json.as_bytes());
    let marker = serde_json::json!({
        "action": "security.pin_setup",
        "object_type": "pin_metadata",
        "object_id": PIN_ROW_ID,
        "after_json": after_json,
        "prev_hash": prev,
        "hash": hash_value,
        "created_at": now,
    });
    tx.execute(
        "INSERT INTO settings (key, value_json, scope) VALUES ('audit.security.pin_setup', ?1, 'app')
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        [marker.to_string()],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    // Hold the vault key for the rest of this process run (first-run → wizard → company.create).
    // It is dropped and zeroised by `session.lock` (AUTH-SPEC §2.3).
    vault.put(vault_key)?;
    keys::zeroize(&mut vault_key);

    Ok(serde_json::json!({ "data": { "ok": true } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_policy_weak_short_new_pin() {
        let err = AppError::pin_policy_weak();
        assert_eq!(err.body().code, "PIN_POLICY_WEAK");
        assert_eq!(err.body().http_status, 422);
        assert_eq!(
            err.body().user_message,
            "PIN must be ≥8 characters with letters and digits."
        );
    }

    #[test]
    fn hash_never_repeats_pin() {
        let h = hash_pin("Meridian#2026").unwrap();
        assert!(!h.contains("Meridian"));
        assert!(h.starts_with("$argon2id$"));
    }
}
