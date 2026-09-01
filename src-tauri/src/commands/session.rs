//! session.status / session.unlock / session.lock (AUTH-SPEC §2).
//! PIN = Argon2id hash in pin_metadata (never the PIN itself); attempts/lockout enforced in Rust.
//! Unlocking derives the PIN's wrap key, unwraps the in-memory vault key and proves the
//! Company's encrypted `.fpa` container opens with it (SECURITY-CHECKLIST A02); the vault key
//! is the only thing held between unlock and lock and is zeroised on lock (AUTH-SPEC §2.3).

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use base64::Engine;
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::commands::company::app_data_dir;
use crate::core::error::{AppError, AppResult};
use crate::storage::container;
use crate::storage::db;
use crate::storage::keys::{self, KeyVault, PinRecord};

const PIN_ROW_ID: &str = "default";
const MAX_FAILED_ATTEMPTS: u32 = 5;
const LOCKOUT_MS: u64 = 30_000;
pub const MIN_PIN_LEN: usize = 8;
pub const MAX_PIN_LEN: usize = 64;

/// PIN policy (AUTH-SPEC §2.1): ≥8 chars, ≤64, ≥2 classes (lower/upper/digit/symbol),
/// no sequential run ≥4 (ascending, descending, or repeated). Single owner for the
/// policy — `session.unlock`, `security.pin_setup` and `security.change_pin` all use it.
pub fn validate_pin_policy(pin: &str) -> AppResult<()> {
    if pin.len() < MIN_PIN_LEN || pin.len() > MAX_PIN_LEN {
        return Err(AppError::pin_policy_weak());
    }
    let mut classes = 0;
    if pin.chars().any(|c| c.is_lowercase()) {
        classes += 1;
    }
    if pin.chars().any(|c| c.is_uppercase()) {
        classes += 1;
    }
    if pin.chars().any(|c| c.is_ascii_digit()) {
        classes += 1;
    }
    if pin.chars().any(|c| !c.is_ascii_alphanumeric()) {
        classes += 1;
    }
    if classes < 2 {
        return Err(AppError::pin_policy_weak());
    }
    let code_points: Vec<u32> = pin.chars().map(|c| c as u32).collect();
    for w in code_points.windows(4) {
        let ascending = w[1] == w[0] + 1 && w[2] == w[1] + 1 && w[3] == w[2] + 1;
        let descending = w[1] + 1 == w[0] && w[2] + 1 == w[1] && w[3] + 1 == w[2];
        let repeated = w[1] == w[0] && w[2] == w[0] && w[3] == w[0];
        if ascending || descending || repeated {
            return Err(AppError::pin_policy_weak());
        }
    }
    Ok(())
}

#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

#[derive(Clone, Serialize)]
struct Session {
    company_id: String,
    session_token: String,
    /// The sealed `.fpa` container this session opened (A02) — held so `company.open`/lock
    /// know which file the in-memory keys belong to.
    container_path: String,
    /// Unlock-time audit-chain verification (AUTH-SPEC §2.5): `Some(seq)` = the first event
    /// that failed verification. The Company then stays read-only until restored
    /// (`AUDIT_CHAIN_BREAK` → read-only + restore offer, ADR-011).
    chain_broken_at: Option<i64>,
}

impl Session {
    fn read_only(&self) -> bool {
        self.chain_broken_at.is_some()
    }
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
/// `chain_broken_at` is the unlock-time audit-chain verdict (§2.5): `Some(seq)` opens the
/// Company read-only so a trail that failed verification can never be silently extended.
pub fn mint_session(
    state: &State<'_, SessionState>,
    company_id: String,
    container_path: String,
    chain_broken_at: Option<i64>,
) -> AppResult<String> {
    mint_session_into(state.inner(), company_id, container_path, chain_broken_at)
}

/// The state-mutating core of `mint_session`, reachable from unit tests (no Tauri `State`).
fn mint_session_into(
    state: &SessionState,
    company_id: String,
    container_path: String,
    chain_broken_at: Option<i64>,
) -> AppResult<String> {
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Uuid::new_v4().as_bytes());
    let mut guard = state.0.lock().map_err(|_| AppError::internal("session lock poisoned".into()))?;
    *guard = Some(Session { company_id, session_token: token.clone(), container_path, chain_broken_at });
    Ok(token)
}

/// Read-only gate for a Company whose audit chain failed verification on unlock
/// (AUTH-SPEC §2.5 / §3 rule 2 — object-level gates are checked in Rust, not the UI):
/// the compromised Company accepts no mutations until it is restored, so a chain whose
/// hashes no longer verify is never extended with new "trusted" events.
pub fn require_company_write(state: &SessionState, company_id: &str) -> AppResult<()> {
    let guard = state.0.lock().map_err(|_| AppError::internal("session lock poisoned".into()))?;
    if let Some(session) = guard.as_ref() {
        if session.company_id == company_id {
            if let Some(at_seq) = session.chain_broken_at {
                return Err(AppError::audit_chain_break(at_seq));
            }
        }
    }
    Ok(())
}

/// Commands that mutate the session Company but carry no `company_id` (the locked API catalog
/// marks the whole `import.*` family `session` — API-SPEC §2): the target is the unlocked
/// Company. Fails `SESSION_LOCKED` (401, retryable) when nothing is unlocked.
pub fn require_unlocked(state: &SessionState) -> AppResult<String> {
    let guard = state.0.lock().map_err(|_| AppError::internal("session lock poisoned".into()))?;
    guard.as_ref().map(|s| s.company_id.clone()).ok_or(AppError::SessionRequired)
}

/// Write gate for session-scoped mutations without an explicit `company_id`: an unlocked
/// Company must exist (`SESSION_LOCKED`) and must not be the read-only residue of a broken
/// audit chain (`AUDIT_CHAIN_BREAK`, AUTH-SPEC §2.5 / §3 rule 2).
pub fn require_session_write(state: &SessionState) -> AppResult<String> {
    let company_id = require_unlocked(state)?;
    require_company_write(state, &company_id)?;
    Ok(company_id)
}

/// `session.status` — pre-unlock safe (no secrets).
#[tauri::command(name = "session.status")]
pub fn session_status(app: AppHandle, state: State<'_, SessionState>) -> AppResult<serde_json::Value> {
    let guard = state.0.lock().map_err(|_| AppError::internal("session lock poisoned".into()))?;
    let unlocked = guard.is_some();
    let company_id = guard.as_ref().map(|s| s.company_id.clone());
    // Keep the active model discoverable after a frontend reload while preserving the
    // pre-unlock-safe status contract (no model lookup is attempted without a Company).
    // The live license summary (S-073) rides the same connection: persisted row re-evaluated
    // against the current clock (license_status_json), None = not activated.
    let (model_id, license) = if let Some(company_id) = company_id.as_deref() {
        let dir = app_data_dir(&app)?;
        let conn = db::open_at(&dir).map_err(AppError::from)?;
        let model_id = conn
            .query_row("SELECT id FROM models WHERE company_id = ?1 ORDER BY id LIMIT 1", [company_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(AppError::from)?;
        (model_id, crate::commands::license::license_status_json(&conn, company_id))
    } else {
        (None, None)
    };
    Ok(serde_json::json!({
        "data": {
            "unlocked": unlocked,
            "company_id": company_id,
            "model_id": model_id,
            // AUTH-SPEC §2.5 degraded session: derived at unlock from the chain verdict, never
            // from a UI flag (§3 rule 4 — no capability is granted on UI flags alone).
            "read_only": guard.as_ref().map(|s| s.read_only()).unwrap_or(false),
            "license": license,
        }
    }))
}

#[derive(Debug, Clone)]
struct PinRow {
    /// `pin_metadata.argon2_params_json` — the PIN hash plus the vault key sealed under it.
    record: PinRecord,
    failed_attempts: u32,
    locked_until: Option<i64>, // unix ms
}

fn load_pin_row(conn: &Connection) -> Result<Option<PinRow>, AppError> {
    // locked_until is TEXT (unix ms as string); parse back to i64 — never trust a cast.
    let row: Option<(String, i64, Option<String>)> = conn
        .query_row(
            "SELECT argon2_params_json, failed_attempts, locked_until FROM pin_metadata WHERE id = ?1",
            [PIN_ROW_ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(AppError::from)?;
    let (json, failed_attempts, locked_until) = match row {
        Some(r) => r,
        None => return Ok(None),
    };
    Ok(Some(PinRow {
        record: PinRecord::from_json(&json)?,
        failed_attempts: failed_attempts as u32,
        locked_until: locked_until.and_then(|s| s.parse::<i64>().ok()),
    }))
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// `session.unlock` — verify PIN (Argon2id), enforce lockout, unwrap the vault key, prove the
/// Company container opens with it, then mint the session token (AUTH-SPEC §2.2).
#[tauri::command(name = "session.unlock", rename_all = "camelCase")]
pub fn session_unlock(
    app: AppHandle,
    pin: String,
    company_id: String,
    state: State<'_, SessionState>,
    vault: State<'_, KeyVault>,
) -> AppResult<serde_json::Value> {
    validate_pin_policy(&pin)?;
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;

    // The Company row owns the path of its sealed `.fpa` container — opened below (A02).
    let container_path: String = conn
        .query_row(
            "SELECT company_file_path FROM companies WHERE id = ?1",
            [&company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?
        .ok_or(AppError::DecryptFailed)?;
    let model_id: Option<String> = conn
        .query_row(
            "SELECT id FROM models WHERE company_id = ?1 ORDER BY id LIMIT 1",
            [&company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    let row = match load_pin_row(&conn)? {
        Some(r) => r,
        // F-004: no bootstrap — the PIN row is created only by the explicit
        // `security.pin_setup` command (first-run screen before the wizard).
        None => return Err(AppError::invalid("PIN_NOT_SET: run security.pin_setup before creating a Company")),
    };

    if let Some(until) = row.locked_until {
        if now_ms() < until {
            return Err(AppError::Locked { retry_after_ms: (until - now_ms()).max(1) as u64 });
        }
    }

    if verify_pin(&pin, &row.record.phc)? {
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

        // Correct PIN → unwrap the vault key and prove this PIN opens THIS Company file. A
        // container copied from another installation (different PIN → different wrap key) or a
        // tampered record fails here with STORAGE_DECRYPT_FAILED and nothing is cached.
        let mut vault_key = row.record.unseal_vault_key(&pin)?;
        container::read_key(Path::new(&container_path), &vault_key)?;
        vault.put(vault_key)?;
        keys::zeroize(&mut vault_key);

        // AUTH-SPEC §2.5 / ADR-011: on every unlock (after the PIN and container are proven),
        // verify this Company's audit chain against the keychain-held HMAC key. A break does
        // NOT refuse the unlock — the data may be intact and the user must still be able to
        // read it — but the Company opens read-only with the restore offer surfaced to the UI,
        // so a trail that failed verification can never be silently extended.
        let chain_broken_at = crate::commands::company::verify_company_chain(&conn, &dir, &company_id)?;

        let token = mint_session(&state, company_id.clone(), container_path, chain_broken_at)?;
        return Ok(serde_json::json!({
            "data": {
                "company_id": company_id,
                "model_id": model_id,
                "session_token": token,
                "read_only": chain_broken_at.is_some(),
                "integrity": {
                    "audit_chain_ok": chain_broken_at.is_none(),
                    "broken_at_seq": chain_broken_at,
                },
            }
        }));
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

/// `session.lock` — invalidate the session token and drop every key from memory
/// (AUTH-SPEC §2.3). Nothing unencrypted is ever written beside the container, so locking has
/// nothing to scrub on disk: the next unlock re-derives the keys from the PIN.
#[tauri::command(name = "session.lock")]
pub fn session_lock(
    state: State<'_, SessionState>,
    vault: State<'_, KeyVault>,
) -> AppResult<serde_json::Value> {
    let mut guard = state.0.lock().map_err(|_| AppError::internal("session lock poisoned".into()))?;
    *guard = None;
    drop(guard);
    // KeyVault::clear zeroises the vault key; the Company file key lives only inside the
    // sealed container, so no plaintext copy exists to delete.
    vault.clear()?;
    Ok(serde_json::json!({ "data": { "locked": true } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_policy_accepts_spec_strong_pin() {
        assert!(validate_pin_policy("Meridian#2026").is_ok());
        assert!(validate_pin_policy("Meridian2026").is_ok(), "letters+digits = 2 classes");
        assert!(validate_pin_policy("aB3!zQ9$xK").is_ok());
    }

    #[test]
    fn pin_policy_rejects_short_pin() {
        let err = validate_pin_policy("Ab1!").unwrap_err();
        assert_eq!(err.body().code, "PIN_POLICY_WEAK");
        assert_eq!(err.body().http_status, 422);
    }

    #[test]
    fn pin_policy_rejects_one_class() {
        for pin in ["abcdefgh", "ABCDEFGH", "12345678"] {
            let err = validate_pin_policy(pin).unwrap_err();
            assert_eq!(err.body().code, "PIN_POLICY_WEAK", "one class: {pin}");
        }
    }

    #[test]
    fn pin_policy_rejects_sequential_runs() {
        for pin in ["abcd1234", "9876abCD", "a1!aaaa1", "ABcd1234"] {
            let err = validate_pin_policy(pin).unwrap_err();
            assert_eq!(err.body().code, "PIN_POLICY_WEAK", "sequential run: {pin}");
        }
    }

    #[test]
    fn pin_policy_rejects_over_64_chars() {
        let long = format!("Ab1!{}", "x".repeat(61));
        assert_eq!(validate_pin_policy(&long).unwrap_err().body().code, "PIN_POLICY_WEAK");
    }

    #[test]
    fn pin_row_is_written_by_explicit_setup_not_unlock() {
        let conn = db::open_in_memory().unwrap();
        // No row before registration — session.unlock must fail closed (no bootstrap F-004).
        assert!(load_pin_row(&conn).unwrap().is_none());
        // Simulate `security.pin_setup` (explicit first-run command): the row carries the
        // structured record — the PIN hash plus the vault key sealed under the PIN.
        let phc = hash_pin("Meridian#2026").unwrap();
        let (record, vault_key) = keys::seal_pin_record("Meridian#2026", phc.clone()).unwrap();
        conn.execute(
            "INSERT INTO pin_metadata (id, argon2_params_json, recovery_phrase_hash, failed_attempts, locked_until)
             VALUES (?, ?, '', 0, NULL)",
            rusqlite::params![PIN_ROW_ID, record.to_json().unwrap()],
        )
        .unwrap();
        let row = load_pin_row(&conn).unwrap().unwrap();
        assert_eq!(row.record.phc, phc);
        assert!(verify_pin("Meridian#2026", &row.record.phc).unwrap());
        assert_eq!(row.record.unseal_vault_key("Meridian#2026").unwrap(), vault_key);
        assert_eq!(row.failed_attempts, 0);
        assert!(row.locked_until.is_none());
    }

    #[test]
    fn argon2_round_trip_and_wrong_pin() {
        let hash = hash_pin("Meridian#2026").unwrap();
        assert!(verify_pin("Meridian#2026", &hash).unwrap());
        assert!(!verify_pin("WrongPin9!", &hash).unwrap());
    }

    #[test]
    fn hashes_are_salted_and_unique() {
        let a = hash_pin("Meridian#2026").unwrap();
        let b = hash_pin("Meridian#2026").unwrap();
        assert_ne!(a, b, "Argon2id must salt per hash (AUTH-SPEC §6)");
    }

    #[test]
    fn read_only_session_blocks_writes_to_the_compromised_company_only() {
        let state = SessionState::default();
        mint_session_into(&state, "comp-a".into(), "/tmp/a.fpa".into(), Some(41)).unwrap();
        let err = require_company_write(&state, "comp-a").unwrap_err();
        assert_eq!(err.body().code, "AUDIT_CHAIN_BREAK");
        assert_eq!(err.body().http_status, 409);
        assert!(!err.body().retryable);
        assert_eq!(
            err.body().user_message,
            "Audit integrity check failed. Restore from the last verified Snapshot?"
        );
        assert_eq!(err.body().details["brokenAtSeq"], 41);
        assert!(
            require_company_write(&state, "comp-b").is_ok(),
            "a chain break sandboxes its own Company — other Companies stay writable"
        );
    }

    #[test]
    fn verified_session_allows_writes_and_reunlock_clears_the_break() {
        let state = SessionState::default();
        mint_session_into(&state, "comp-a".into(), "/tmp/a.fpa".into(), None).unwrap();
        assert!(require_company_write(&state, "comp-a").is_ok());
        // A restored Company re-unlocked with a clean chain replaces the session wholesale:
        // no read-only residue survives the re-mint.
        mint_session_into(&state, "comp-a".into(), "/tmp/a.fpa".into(), Some(7)).unwrap();
        assert!(require_company_write(&state, "comp-a").is_err());
        mint_session_into(&state, "comp-a".into(), "/tmp/a.fpa".into(), None).unwrap();
        assert!(require_company_write(&state, "comp-a").is_ok());
    }

    #[test]
    fn write_gate_is_open_when_no_session_targets_the_company() {
        let state = SessionState::default();
        assert!(require_company_write(&state, "comp-a").is_ok());
    }

    #[test]
    fn session_scoped_commands_need_an_unlocked_company() {
        // The `import.*` family carries no company_id (API-SPEC §2): the target is the
        // unlocked Company, so a locked session fails closed with SESSION_LOCKED (401).
        let state = SessionState::default();
        assert_eq!(require_unlocked(&state).unwrap_err().body().code, "SESSION_LOCKED");
        assert_eq!(require_session_write(&state).unwrap_err().body().code, "SESSION_LOCKED");

        mint_session_into(&state, "comp-a".into(), "/tmp/a.fpa".into(), None).unwrap();
        assert_eq!(require_unlocked(&state).unwrap(), "comp-a");
        assert_eq!(require_session_write(&state).unwrap(), "comp-a");
    }

    #[test]
    fn session_scoped_write_gate_honours_the_chain_break() {
        let state = SessionState::default();
        mint_session_into(&state, "comp-a".into(), "/tmp/a.fpa".into(), Some(7)).unwrap();
        // Read-only is a write gate, not a read gate: the Company is still addressable...
        assert_eq!(require_unlocked(&state).unwrap(), "comp-a");
        // ...but no session-scoped mutation may extend a chain that failed verification.
        assert_eq!(require_session_write(&state).unwrap_err().body().code, "AUDIT_CHAIN_BREAK");
    }
}
