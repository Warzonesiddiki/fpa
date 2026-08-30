//! Key material — the single owner of every secret in OneFP&A (AUTH-SPEC §2.1/§2.4/§6,
//! SECURITY-CHECKLIST A02 §3 "File encryption / Memory hygiene").
//!
//! Two-tier hierarchy (design decision, recorded here because it is the only place it lives):
//! ```text
//! PIN ──Argon2id(salt)──▶ KEK ──AES-256-GCM──▶ vault key (VK) ──AES-256-GCM──▶ Company key (CEK) ──▶ .fpa payload
//! ```
//! The PIN-derived key wraps ONE random vault key; the vault key wraps each Company file key
//! (stored in the `.fpa` header, see `container`). Consequences:
//! - `security.change_pin` re-wraps a single key instead of every Company file (AUTH-SPEC §2.4).
//! - No Company key is recoverable without the PIN, and no key is ever persisted in plaintext.
//!
//! Lifetimes: the KEK exists only for the duration of one derivation (zeroised immediately
//! after use); the vault key lives only in the in-memory `KeyVault` between unlock and lock.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};

use crate::core::error::{AppError, AppResult};

pub const KEY_LEN: usize = 32; // AES-256
pub const SALT_LEN: usize = 16; // Argon2id salt (AUTH-SPEC §2.1: 16B random)
pub const NONCE_LEN: usize = 12; // AES-256-GCM IV (AUTH-SPEC §6)
pub const TAG_LEN: usize = 16; // AES-256-GCM tag (AUTH-SPEC §6)

/// Argon2id parameters, exactly the AUTH-SPEC §6 table. `Argon2::default()` uses these values;
/// `argon2_default_matches_spec_params` asserts it against the emitted PHC string so the
/// constants can never silently drift from the derivation we actually perform.
pub const ARGON2_M_COST: u32 = 19456; // KiB
pub const ARGON2_T_COST: u32 = 2;
pub const ARGON2_P_COST: u32 = 1;

/// Argon2id(pin, salt) → 256-bit key-encryption key. Same algorithm and parameters as the
/// PIN hash (`Argon2::default()`), so one verification covers both (AUTH-SPEC §6).
pub fn derive_kek(pin: &str, salt: &[u8]) -> AppResult<[u8; KEY_LEN]> {
    let mut out = [0u8; KEY_LEN];
    Argon2::default()
        .hash_password_into(pin.as_bytes(), salt, &mut out)
        .map_err(|e| AppError::internal(format!("argon2 derive: {e}")))?;
    Ok(out)
}

/// Cryptographically secure random bytes (the OS CSPRNG via `rand::rngs::OsRng`).
pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    OsRng.fill_bytes(&mut out);
    out
}

/// Overwrite a secret in memory (AUTH-SPEC §2.3: keys are dropped on lock). `zeroize` is not in
/// the locked technology budget (B13), so this is its plain-slice equivalent: it clears every
/// short-lived key copy (the derived wrap key, the freshly unwrapped vault key) and the vault
/// slot itself before they go out of scope.
pub fn zeroize(buf: &mut [u8]) {
    buf.fill(0);
}

fn cipher(key: &[u8; KEY_LEN]) -> Aes256Gcm {
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key))
}

/// AES-256-GCM seal. A non-empty `aad` binds the ciphertext to its header bytes, so a header
/// that is spliced into another file fails the tag check instead of decrypting.
pub fn aes_seal(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    plaintext: &[u8],
) -> AppResult<Vec<u8>> {
    cipher(key)
        .encrypt(Nonce::from_slice(nonce), Payload { msg: plaintext, aad })
        .map_err(|e| AppError::internal(format!("aes-gcm seal: {e}")))
}

/// AES-256-GCM open. **Any** failure — wrong key, flipped byte, truncated tag — is reported
/// as `STORAGE_DECRYPT_FAILED` (ERROR-HANDLING); the caller never learns which it was.
pub fn aes_open(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    ciphertext: &[u8],
) -> AppResult<Vec<u8>> {
    cipher(key)
        .decrypt(Nonce::from_slice(nonce), Payload { msg: ciphertext, aad })
        .map_err(|_| AppError::DecryptFailed)
}

/// Seal a raw 256-bit key under another key: returns `(ciphertext, nonce)`. The nonce is
/// random per call — a nonce is never reused with the same key (AUTH-SPEC §6).
pub fn seal_key(
    wrapping_key: &[u8; KEY_LEN],
    key: &[u8; KEY_LEN],
) -> AppResult<(Vec<u8>, [u8; NONCE_LEN])> {
    let nonce = random_bytes::<NONCE_LEN>();
    let sealed = aes_seal(wrapping_key, &nonce, &[], key)?;
    Ok((sealed, nonce))
}

/// Inverse of `seal_key`. A GCM tag mismatch means the wrapping key is wrong (wrong PIN,
/// foreign Company file) or the sealed blob was tampered with → `STORAGE_DECRYPT_FAILED`.
pub fn open_key(
    wrapping_key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    sealed: &[u8],
) -> AppResult<[u8; KEY_LEN]> {
    let key = aes_open(wrapping_key, nonce, &[], sealed)?;
    if key.len() != KEY_LEN {
        return Err(AppError::DecryptFailed);
    }
    let mut out = [0u8; KEY_LEN];
    out.copy_from_slice(&key);
    Ok(out)
}

/// The record persisted in `pin_metadata.argon2_params_json` (AUTH-SPEC §2.1 step 5).
/// `phc` verifies the PIN itself; the remaining fields seal the random vault key under the
/// PIN-derived key. All binary fields are base64url without padding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinRecord {
    /// Argon2id PHC string (`$argon2id$v=19$m=…,t=…,p=…$…`) — the only PIN verification input.
    pub phc: String,
    /// KDF parameters actually used, recorded so a downgraded record can be rejected (A02).
    pub m: u32,
    pub t: u32,
    pub p: u32,
    /// base64url — `SALT_LEN`-byte Argon2id salt for the wrap key.
    pub salt: String,
    /// base64url — `NONCE_LEN`-byte AES-GCM nonce sealing the vault key.
    pub nonce: String,
    /// base64url — vault key (`KEY_LEN` bytes) + GCM tag, sealed under the derived key.
    pub wrapped_vault_key: String,
}

impl PinRecord {
    pub fn to_json(&self) -> AppResult<String> {
        serde_json::to_string(self).map_err(|e| AppError::internal(format!("pin record: {e}")))
    }

    pub fn from_json(json: &str) -> AppResult<Self> {
        serde_json::from_str(json).map_err(|e| AppError::internal(format!("pin record: {e}")))
    }

    /// A02 "no weak mode": a record whose KDF parameters were weakened (tampered file,
    /// downgrade attack) fails closed instead of deriving with attacker-chosen work factors.
    pub fn params_are_spec(&self) -> bool {
        self.m == ARGON2_M_COST && self.t == ARGON2_T_COST && self.p == ARGON2_P_COST
    }

    /// Derive the PIN key and unwrap the vault key. The derived key is zeroised before return.
    pub fn unseal_vault_key(&self, pin: &str) -> AppResult<[u8; KEY_LEN]> {
        if !self.params_are_spec() {
            return Err(AppError::DecryptFailed);
        }
        let salt = decode(&self.salt, SALT_LEN)?;
        let nonce = decode(&self.nonce, NONCE_LEN)?;
        let sealed = decode(&self.wrapped_vault_key, KEY_LEN + TAG_LEN)?;
        let mut nonce_buf = [0u8; NONCE_LEN];
        nonce_buf.copy_from_slice(&nonce);
        let mut kek = derive_kek(pin, &salt)?;
        let vault_key = open_key(&kek, &nonce_buf, &sealed)?;
        zeroize(&mut kek);
        Ok(vault_key)
    }
}

/// First run (`security.pin_setup`): generate the random vault key and seal it for `pin`.
/// Returns the record to persist and the plaintext vault key for the in-memory vault.
pub fn seal_pin_record(pin: &str, phc: String) -> AppResult<(PinRecord, [u8; KEY_LEN])> {
    let vault_key = random_bytes::<KEY_LEN>();
    let record = seal_vault_key(&vault_key, pin, phc)?;
    Ok((record, vault_key))
}

/// `security.change_pin`: re-seal the same vault key for a new PIN (AUTH-SPEC §2.4). Company
/// files are untouched — only the key that wraps the vault key changes, with a fresh salt+nonce.
pub fn reseal_pin_record(
    vault_key: &[u8; KEY_LEN],
    new_pin: &str,
    phc: String,
) -> AppResult<PinRecord> {
    seal_vault_key(vault_key, new_pin, phc)
}

fn seal_vault_key(vault_key: &[u8; KEY_LEN], pin: &str, phc: String) -> AppResult<PinRecord> {
    let salt = random_bytes::<SALT_LEN>();
    let mut kek = derive_kek(pin, &salt)?;
    let (sealed, nonce) = seal_key(&kek, vault_key)?;
    zeroize(&mut kek);
    Ok(PinRecord {
        phc,
        m: ARGON2_M_COST,
        t: ARGON2_T_COST,
        p: ARGON2_P_COST,
        salt: encode(&salt),
        nonce: encode(&nonce),
        wrapped_vault_key: encode(&sealed),
    })
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Decode sealed material. A malformed or wrong-length value is tampering, not a user error →
/// the same `STORAGE_DECRYPT_FAILED` the GCM tag mismatch produces.
fn decode(value: &str, expected_len: usize) -> AppResult<Vec<u8>> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| AppError::DecryptFailed)?;
    if bytes.len() != expected_len {
        return Err(AppError::DecryptFailed);
    }
    Ok(bytes)
}

/// The unlocked vault key (AUTH-SPEC §2.2/§2.3): present only between unlock and lock, held
/// in memory, never persisted, never logged, never serialised over IPC.
#[derive(Default)]
pub struct KeyVault(Mutex<Option<[u8; KEY_LEN]>>);

impl KeyVault {
    pub fn put(&self, key: [u8; KEY_LEN]) -> AppResult<()> {
        let mut guard = lock(&self.0)?;
        if let Some(mut previous) = guard.take() {
            zeroize(&mut previous);
        }
        *guard = Some(key);
        Ok(())
    }

    /// The key is copied out (32 bytes, `Copy`); callers zeroise their copy when done.
    pub fn get(&self) -> AppResult<[u8; KEY_LEN]> {
        let guard = lock(&self.0)?;
        guard.as_ref().copied().ok_or(AppError::SessionRequired)
    }

    /// Drop and zeroise the key (`session.lock` / auto-lock / close).
    pub fn clear(&self) -> AppResult<()> {
        let mut guard = lock(&self.0)?;
        if let Some(mut key) = guard.take() {
            zeroize(&mut key);
        }
        Ok(())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> AppResult<MutexGuard<'_, T>> {
    mutex.lock().map_err(|_| AppError::internal("vault lock poisoned".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::session::hash_pin;

    #[test]
    fn argon2_default_matches_spec_params() {
        // The constants above must describe the derivation we actually perform: the PHC string
        // emitted by `Argon2::default()` carries the real m/t/p (AUTH-SPEC §6).
        let phc = hash_pin("Meridian#2026").unwrap();
        assert!(phc.starts_with("$argon2id$"), "algorithm: {phc}");
        assert!(phc.contains(&format!("m={ARGON2_M_COST}")), "m cost: {phc}");
        assert!(phc.contains(&format!("t={ARGON2_T_COST}")), "t cost: {phc}");
        assert!(phc.contains(&format!("p={ARGON2_P_COST}")), "p: {phc}");
    }

    #[test]
    fn kek_derivation_is_deterministic_and_salt_dependent() {
        let salt = random_bytes::<SALT_LEN>();
        let a = derive_kek("Meridian#2026", &salt).unwrap();
        let b = derive_kek("Meridian#2026", &salt).unwrap();
        let c = derive_kek("Meridian#2026", &random_bytes::<SALT_LEN>()).unwrap();
        assert_eq!(a, b, "same PIN + salt → same key");
        assert_ne!(a, c, "different salt → different key");
        assert_ne!(a, [0u8; KEY_LEN]);
    }

    #[test]
    fn key_wrap_round_trips() {
        let wrapping = random_bytes::<KEY_LEN>();
        let key = random_bytes::<KEY_LEN>();
        let (sealed, nonce) = seal_key(&wrapping, &key).unwrap();
        assert_eq!(sealed.len(), KEY_LEN + TAG_LEN);
        assert_ne!(&sealed[..KEY_LEN], &key[..], "the sealed key is never stored raw");
        assert_eq!(open_key(&wrapping, &nonce, &sealed).unwrap(), key);
    }

    #[test]
    fn wrong_wrapping_key_fails_as_decrypt_failed() {
        let (sealed, nonce) = seal_key(&random_bytes::<KEY_LEN>(), &random_bytes::<KEY_LEN>()).unwrap();
        let err = open_key(&random_bytes::<KEY_LEN>(), &nonce, &sealed).unwrap_err();
        assert_eq!(err.body().code, "STORAGE_DECRYPT_FAILED");
        assert_eq!(err.body().http_status, 401, "ERROR-HANDLING.md §B");
    }

    #[test]
    fn tampered_sealed_key_fails_as_decrypt_failed() {
        let wrapping = random_bytes::<KEY_LEN>();
        let (mut sealed, nonce) = seal_key(&wrapping, &random_bytes::<KEY_LEN>()).unwrap();
        sealed[0] ^= 0x01;
        assert_eq!(open_key(&wrapping, &nonce, &sealed).unwrap_err().body().code, "STORAGE_DECRYPT_FAILED");
        // A truncated blob is tampering too, never a panic.
        sealed.pop();
        assert_eq!(open_key(&wrapping, &nonce, &sealed).unwrap_err().body().code, "STORAGE_DECRYPT_FAILED");
    }

    #[test]
    fn aad_is_bound_to_the_ciphertext() {
        let key = random_bytes::<KEY_LEN>();
        let nonce = random_bytes::<NONCE_LEN>();
        let sealed = aes_seal(&key, &nonce, b"header", b"payload").unwrap();
        assert_eq!(aes_open(&key, &nonce, b"header", &sealed).unwrap(), b"payload".to_vec());
        assert_eq!(aes_open(&key, &nonce, b"other", &sealed).unwrap_err().body().code, "STORAGE_DECRYPT_FAILED");
    }

    #[test]
    fn pin_record_round_trips_and_rejects_downgraded_params() {
        let phc = hash_pin("Meridian#2026").unwrap();
        let (record, vault_key) = seal_pin_record("Meridian#2026", phc.clone()).unwrap();
        let json = record.to_json().unwrap();
        let parsed = PinRecord::from_json(&json).unwrap();
        assert_eq!(parsed.phc, phc);
        assert!(parsed.params_are_spec());
        assert_eq!(parsed.unseal_vault_key("Meridian#2026").unwrap(), vault_key);

        let mut weakened = parsed.clone();
        weakened.m = 1024;
        assert!(!weakened.params_are_spec());
        assert_eq!(
            weakened.unseal_vault_key("Meridian#2026").unwrap_err().body().code,
            "STORAGE_DECRYPT_FAILED",
            "a weakened record must fail closed (A02: no weak mode)"
        );
    }

    #[test]
    fn wrong_pin_cannot_unseal_the_vault_key() {
        let (record, _) = seal_pin_record("Meridian#2026", hash_pin("Meridian#2026").unwrap()).unwrap();
        assert_eq!(
            record.unseal_vault_key("WrongPin9!").unwrap_err().body().code,
            "STORAGE_DECRYPT_FAILED"
        );
    }

    #[test]
    fn change_pin_reseals_the_same_vault_key() {
        let (record, vault_key) = seal_pin_record("Meridian#2026", hash_pin("Meridian#2026").unwrap()).unwrap();
        let new_phc = hash_pin("Meridian#2027").unwrap();
        let rotated = reseal_pin_record(&vault_key, "Meridian#2027", new_phc.clone()).unwrap();
        assert_ne!(rotated.salt, record.salt, "a new PIN gets a fresh salt");
        assert_ne!(rotated.nonce, record.nonce, "never reuse a nonce with a key");
        assert_eq!(rotated.phc, new_phc);
        assert_eq!(rotated.unseal_vault_key("Meridian#2027").unwrap(), vault_key);
    }

    #[test]
    fn vault_is_empty_until_put_and_cleared_on_lock() {
        let vault = KeyVault::default();
        assert_eq!(vault.get().unwrap_err().body().code, "SESSION_LOCKED");
        let key = random_bytes::<KEY_LEN>();
        vault.put(key).unwrap();
        assert_eq!(vault.get().unwrap(), key);
        assert!(vault.clear().is_ok());
        assert_eq!(vault.get().unwrap_err().body().code, "SESSION_LOCKED");
    }

    #[test]
    fn zeroize_leaves_no_key_bytes() {
        let mut key = random_bytes::<KEY_LEN>();
        zeroize(&mut key);
        assert_eq!(key, [0u8; KEY_LEN]);
    }
}
