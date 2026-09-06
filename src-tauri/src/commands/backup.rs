//! Backup & Restore commands (F-037 · M6-9 · S-074 · API-SPEC backup.create/restore).
//!
//! Commands:
//! 1. `backup.create`: `{ path: String, passphrase: Option<String> }` ->
//!    `{ backup_id: String, path: String, size_bytes: i64, sha256: String }`
//!    - Takes current company container (`.fpa`), seals or writes encrypted backup.
//!    - Computes SHA-256 hex digest.
//!    - Records row in `backups` table (`id`, `mode='manual'`, `path`, `size_bytes`, `encrypted=1`, `sha256`, `created_at`, `retained_until`).
//!    - Appends HMAC audit event `backup.create`.
//!    - Handles IO/disk full errors returning `BackupDiskFull` / `BackupIoError`.
//!
//! 2. `backup.restore`: `{ backup_id: Option<String>, path: Option<String>, passphrase: Option<String> }` ->
//!    `{ restored: bool, snapshot_id: String }`
//!    - Verifies passphrase / container validity.
//!    - Takes pre-restore snapshot in `snapshots` table (`reason='pre-restore'`, `restore_of_backup_id`).
//!    - Restores database safely to active company container path.
//!    - Appends HMAC audit event `backup.restore`.

use chrono::{Duration, Utc};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{SessionState, get_session_info, require_company_write};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::container;
use crate::storage::db;
use crate::storage::keys::{
    NONCE_LEN, TAG_LEN, aes_open, aes_seal, derive_kek, random_bytes, zeroize,
};
use crate::storage::keystore;

pub const BACKUP_MAGIC: &[u8; 8] = b"ONEFPABK";
pub const BACKUP_VERSION: u8 = 1;

/// Default retention window for manual/auto backups: 30 days.
pub const BACKUP_RETENTION_DAYS: i64 = 30;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCreateParams {
    pub path: String,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCreateResponse {
    pub backup_id: String,
    pub path: String,
    pub size_bytes: i64,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreParams {
    pub backup_id: Option<String>,
    pub path: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreResponse {
    pub restored: bool,
    pub snapshot_id: String,
}

/// Map standard std::io::Error to AppError::BackupDiskFull or AppError::BackupIoError.
pub(crate) fn map_io_err(e: std::io::Error) -> AppError {
    #[cfg(windows)]
    {
        // 112 = ERROR_DISK_FULL, 39 = ERROR_HANDLE_DISK_FULL
        if let Some(raw) = e.raw_os_error()
            && (raw == 112 || raw == 39)
        {
            return AppError::BackupDiskFull;
        }
    }
    #[cfg(unix)]
    {
        // 28 = ENOSPC
        if let Some(raw) = e.raw_os_error()
            && raw == 28
        {
            return AppError::BackupDiskFull;
        }
    }
    match e.kind() {
        std::io::ErrorKind::StorageFull => AppError::BackupDiskFull,
        _ => AppError::BackupIoError(e.to_string()),
    }
}

/// Encrypt raw bytes with a passphrase into a standalone `.fpa-backup` envelope.
/// Envelope format:
/// [0..8]: BACKUP_MAGIC b"ONEFPABK"
/// [8]: BACKUP_VERSION (1)
/// [9..25]: salt (16 bytes)
/// [25..37]: nonce (12 bytes)
/// [37..]: AES-256-GCM sealed ciphertext + tag (16B)
pub(crate) fn encrypt_backup_payload(plaintext: &[u8], passphrase: &str) -> AppResult<Vec<u8>> {
    let salt = random_bytes::<16>();
    let mut kek = derive_kek(passphrase, &salt)?;
    let nonce = random_bytes::<NONCE_LEN>();

    let mut aad = Vec::with_capacity(37);
    aad.extend_from_slice(BACKUP_MAGIC);
    aad.push(BACKUP_VERSION);
    aad.extend_from_slice(&salt);
    aad.extend_from_slice(&nonce);

    let ciphertext = aes_seal(&kek, &nonce, &aad, plaintext)?;
    zeroize(&mut kek);

    let mut out = Vec::with_capacity(aad.len() + ciphertext.len());
    out.extend_from_slice(&aad);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt an encrypted backup envelope with a passphrase.
pub(crate) fn decrypt_backup_payload(envelope: &[u8], passphrase: &str) -> AppResult<Vec<u8>> {
    if envelope.len() < 37 + TAG_LEN {
        return Err(AppError::file_corrupt());
    }
    if &envelope[0..8] != BACKUP_MAGIC || envelope[8] != BACKUP_VERSION {
        return Err(AppError::file_corrupt());
    }
    let salt = &envelope[9..25];
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&envelope[25..37]);
    let aad = &envelope[0..37];
    let ciphertext = &envelope[37..];

    let mut kek = derive_kek(passphrase, salt)?;
    let result = aes_open(&kek, &nonce, aad, ciphertext);
    zeroize(&mut kek);

    match result {
        Ok(plaintext) => Ok(plaintext),
        Err(_) => Err(AppError::BackupPassphraseInvalid),
    }
}

/// Write data atomically using a temp file, mapping IO errors to BackupDiskFull/BackupIoError.
fn write_backup_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent).map_err(map_io_err)?;
    }
    let tmp = path.with_extension("bak-tmp");
    fs::write(&tmp, bytes).map_err(map_io_err)?;
    fs::rename(&tmp, path).map_err(map_io_err)?;
    Ok(())
}

/// Compute SHA-256 hex string of bytes.
pub(crate) fn compute_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// `backup.create` — { path: String, passphrase: Option<String> }
#[tauri::command(name = "backup.create", rename_all = "camelCase")]
pub fn backup_create(
    app: AppHandle,
    path: String,
    passphrase: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let (company_id, container_path) = get_session_info(&session)?;
    require_company_write(&session, &company_id)?;

    let app_dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&app_dir)?;

    let res = execute_backup_create(
        &mut conn,
        &app_dir,
        &company_id,
        &container_path,
        &path,
        passphrase.as_deref(),
    )?;

    Ok(serde_json::json!({ "data": res }))
}

/// Inner backup creation logic reusable for unit tests and IPC command.
pub fn execute_backup_create(
    conn: &mut rusqlite::Connection,
    app_dir: &Path,
    company_id: &str,
    company_file_path: &str,
    target_backup_path: &str,
    passphrase: Option<&str>,
) -> AppResult<BackupCreateResponse> {
    let src_path = Path::new(company_file_path);
    let original_bytes = fs::read(src_path).map_err(map_io_err)?;

    // Determine payload to write: if passphrase provided, encrypt with passphrase;
    // otherwise, the company container file itself is already AES-256-GCM encrypted (encrypted=1).
    let backup_bytes = if let Some(pass) = passphrase {
        encrypt_backup_payload(&original_bytes, pass)?
    } else {
        original_bytes
    };

    let size_bytes = backup_bytes.len() as i64;
    let sha256 = compute_sha256(&backup_bytes);

    let dest_path = Path::new(target_backup_path);
    write_backup_atomic(dest_path, &backup_bytes)?;

    let backup_id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let created_at = now.to_rfc3339();
    let retained_until = (now + Duration::days(BACKUP_RETENTION_DAYS)).to_rfc3339();

    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO backups (id, mode, path, size_bytes, encrypted, sha256, created_at, retained_until)
         VALUES (?1, 'manual', ?2, ?3, 1, ?4, ?5, ?6)",
        rusqlite::params![
            backup_id,
            target_backup_path,
            size_bytes,
            sha256,
            created_at,
            retained_until
        ],
    )
    .map_err(AppError::from)?;

    // Append HMAC audit event `backup.create`
    let after_json = serde_json::json!({
        "action": "backup.create",
        "backup_id": backup_id,
        "path": target_backup_path,
        "size_bytes": size_bytes,
        "sha256": sha256,
        "encrypted": true,
        "passphrase_protected": passphrase.is_some(),
        "created_at": created_at
    })
    .to_string();

    let key = keystore::audit_hmac_key(app_dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());

    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                   prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'backup.create', 'backup', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, backup_id, after_json, prev, hash, created_at],
    )
    .map_err(AppError::from)?;

    tx.commit().map_err(AppError::from)?;

    Ok(BackupCreateResponse {
        backup_id,
        path: target_backup_path.to_string(),
        size_bytes,
        sha256,
    })
}

/// `backup.restore` — { backup_id: Option<String>, path: Option<String>, passphrase: Option<String> }
#[tauri::command(name = "backup.restore", rename_all = "camelCase")]
pub fn backup_restore(
    app: AppHandle,
    backup_id: Option<String>,
    path: Option<String>,
    passphrase: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let (company_id, container_path) = get_session_info(&session)?;

    let app_dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&app_dir)?;

    let res = execute_backup_restore(
        &mut conn,
        &app_dir,
        &company_id,
        &container_path,
        backup_id.as_deref(),
        path.as_deref(),
        passphrase.as_deref(),
    )?;

    Ok(serde_json::json!({ "data": res }))
}

/// Inner backup restore logic reusable for unit tests and IPC command.
pub fn execute_backup_restore(
    conn: &mut rusqlite::Connection,
    app_dir: &Path,
    company_id: &str,
    company_file_path: &str,
    backup_id: Option<&str>,
    backup_path: Option<&str>,
    passphrase: Option<&str>,
) -> AppResult<BackupRestoreResponse> {
    // 1. Resolve backup source path and backup_id
    let (resolved_backup_id, resolved_path) = match (backup_id, backup_path) {
        (Some(bid), Some(p)) => (Some(bid.to_string()), p.to_string()),
        (Some(bid), None) => {
            let p: Option<String> = conn
                .query_row("SELECT path FROM backups WHERE id = ?1", [bid], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(AppError::from)?;
            let p = p.ok_or_else(|| {
                AppError::invalid(format!("BACKUP_NOT_FOUND: backup '{bid}' does not exist"))
            })?;
            (Some(bid.to_string()), p)
        }
        (None, Some(p)) => {
            // Check if there is a known backup record for this path
            let bid: Option<String> = conn
                .query_row(
                    "SELECT id FROM backups WHERE path = ?1 ORDER BY created_at DESC LIMIT 1",
                    [p],
                    |r| r.get(0),
                )
                .optional()
                .map_err(AppError::from)?;
            (bid, p.to_string())
        }
        (None, None) => {
            return Err(AppError::invalid(
                "BACKUP_SPEC_REQUIRED: either backup_id or path must be provided",
            ));
        }
    };

    // 2. Read backup file and decode/decrypt
    let backup_file_bytes = fs::read(Path::new(&resolved_path)).map_err(map_io_err)?;

    let restored_container_bytes = if backup_file_bytes.starts_with(BACKUP_MAGIC) {
        let pass = passphrase.ok_or(AppError::BackupPassphraseInvalid)?;
        decrypt_backup_payload(&backup_file_bytes, pass)?
    } else if let Some(_pass) = passphrase {
        // If passphrase was provided for a file that isn't BACKUP_MAGIC, attempt decryption or fail
        return Err(AppError::BackupPassphraseInvalid);
    } else {
        backup_file_bytes
    };

    // Verify container header
    if restored_container_bytes.len() < 81 + TAG_LEN
        || &restored_container_bytes[..8] != container::MAGIC
        || restored_container_bytes[8] != container::VERSION
    {
        return Err(AppError::file_corrupt());
    }

    // 3. Take pre-restore snapshot
    // First, save a snapshot of the current active company file
    let current_container_path = Path::new(company_file_path);
    let snapshot_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // Snapshot storage: save copy alongside company container or in snapshots dir
    let snapshots_dir = app_dir.join("snapshots");
    fs::create_dir_all(&snapshots_dir).map_err(map_io_err)?;
    let snapshot_file = snapshots_dir.join(format!("{}.fpa-snap", snapshot_id));

    if current_container_path.exists() {
        let cur_bytes = fs::read(current_container_path).map_err(map_io_err)?;
        fs::write(&snapshot_file, &cur_bytes).map_err(map_io_err)?;
    }

    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO snapshots (id, company_id, reason, pre_mutation, created_at, restore_of_backup_id)
         VALUES (?1, ?2, 'pre-restore', 1, ?3, ?4)",
        rusqlite::params![
            snapshot_id,
            company_id,
            now,
            resolved_backup_id
        ],
    )
    .map_err(AppError::from)?;

    // 4. Safely overwrite the company container file with restored_container_bytes
    write_backup_atomic(current_container_path, &restored_container_bytes)?;

    // 5. Append HMAC audit event `backup.restore`
    let after_json = serde_json::json!({
        "action": "backup.restore",
        "snapshot_id": snapshot_id,
        "restore_of_backup_id": resolved_backup_id,
        "source_path": resolved_path,
        "restored_at": now
    })
    .to_string();

    let key = keystore::audit_hmac_key(app_dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());

    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                   prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'backup.restore', 'backup', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, snapshot_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    tx.commit().map_err(AppError::from)?;

    Ok(BackupRestoreResponse {
        restored: true,
        snapshot_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::company::verify_company_chain;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("onefpa-test-backup-{name}-{}", Uuid::new_v4()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn dummy_company_file(path: &Path) {
        // Build a mock valid container: MAGIC (8B) + VERSION 1 (1B) + 72 dummy bytes + TAG_LEN dummy bytes + dummy image
        let mut buf = Vec::new();
        buf.extend_from_slice(container::MAGIC);
        buf.push(container::VERSION);
        buf.resize(81 + TAG_LEN + 32, 0x42);
        fs::write(path, &buf).unwrap();
    }

    fn init_test_company(conn: &rusqlite::Connection, company_id: &str, file_path: &str) {
        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version,
                                    company_file_path, created_at, updated_at)
             VALUES (?1, 'Test Company', 'single', 'USD', 'en-US', '1.0.0', ?2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![company_id, file_path],
        )
        .unwrap();
    }

    #[test]
    fn test_backup_create_and_hmac_audit() {
        let dir = temp_dir("create-audit");
        let mut conn = db::open_at(&dir).unwrap();
        let company_id = Uuid::new_v4().to_string();
        let comp_file = dir.join("company.fpa");
        dummy_company_file(&comp_file);
        init_test_company(&conn, &company_id, comp_file.to_str().unwrap());

        let target_backup = dir.join("backup-1.fpa-bak");
        let res = execute_backup_create(
            &mut conn,
            &dir,
            &company_id,
            comp_file.to_str().unwrap(),
            target_backup.to_str().unwrap(),
            None,
        )
        .unwrap();

        assert_eq!(res.path, target_backup.to_str().unwrap());
        assert!(res.size_bytes > 0);
        assert!(!res.sha256.is_empty());

        // Verify backups table row
        let (stored_path, stored_size, sha, encrypted): (String, i64, String, i64) = conn
            .query_row(
                "SELECT path, size_bytes, sha256, encrypted FROM backups WHERE id = ?1",
                [&res.backup_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(stored_path, target_backup.to_str().unwrap());
        assert_eq!(stored_size, res.size_bytes);
        assert_eq!(sha, res.sha256);
        assert_eq!(encrypted, 1);

        // Verify audit chain
        let break_idx = verify_company_chain(&conn, &dir, &company_id).unwrap();
        assert_eq!(break_idx, None, "audit chain must verify");

        // Verify audit_events record
        let (action, object_type, object_id): (String, String, String) = conn
            .query_row(
                "SELECT action, object_type, object_id FROM audit_events WHERE company_id = ?1 ORDER BY seq DESC LIMIT 1",
                [&company_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(action, "backup.create");
        assert_eq!(object_type, "backup");
        assert_eq!(object_id, res.backup_id);
    }

    #[test]
    fn test_backup_with_passphrase_encryption_roundtrip() {
        let plaintext = b"Hello, encrypted backup world!";
        let pass = "CorrectHorseBatteryStaple!";

        let encrypted = encrypt_backup_payload(plaintext, pass).unwrap();
        assert_eq!(&encrypted[0..8], BACKUP_MAGIC);
        assert_ne!(&encrypted[37..], plaintext);

        // Wrong passphrase must fail with BackupPassphraseInvalid
        let err = decrypt_backup_payload(&encrypted, "wrong-passphrase").unwrap_err();
        assert_eq!(err.body().code, "BACKUP_PASSPHRASE_INVALID");
        assert_eq!(err.body().http_status, 401);

        // Correct passphrase recovers original plaintext
        let decrypted = decrypt_backup_payload(&encrypted, pass).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_backup_restore_and_snapshot_creation() {
        let dir = temp_dir("restore-snap");
        let mut conn = db::open_at(&dir).unwrap();
        let company_id = Uuid::new_v4().to_string();
        let comp_file = dir.join("company.fpa");
        dummy_company_file(&comp_file);
        init_test_company(&conn, &company_id, comp_file.to_str().unwrap());

        // Create backup
        let target_backup = dir.join("backup-for-restore.fpa-bak");
        let create_res = execute_backup_create(
            &mut conn,
            &dir,
            &company_id,
            comp_file.to_str().unwrap(),
            target_backup.to_str().unwrap(),
            Some("MySecretKey123"),
        )
        .unwrap();

        // Mutate the company file slightly
        fs::write(&comp_file, b"corrupted-or-different-content").unwrap();

        // Now restore with passphrase
        let restore_res = execute_backup_restore(
            &mut conn,
            &dir,
            &company_id,
            comp_file.to_str().unwrap(),
            Some(&create_res.backup_id),
            None,
            Some("MySecretKey123"),
        )
        .unwrap();

        assert!(restore_res.restored);
        assert!(!restore_res.snapshot_id.is_empty());

        // Check snapshots table
        let (snap_reason, snap_pre_mutation, snap_restore_of): (String, i64, Option<String>) = conn
            .query_row(
                "SELECT reason, pre_mutation, restore_of_backup_id FROM snapshots WHERE id = ?1",
                [&restore_res.snapshot_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(snap_reason, "pre-restore");
        assert_eq!(snap_pre_mutation, 1);
        assert_eq!(snap_restore_of, Some(create_res.backup_id));

        // Company file is restored to valid container
        let restored_bytes = fs::read(&comp_file).unwrap();
        assert_eq!(&restored_bytes[0..8], container::MAGIC);

        // Audit chain intact
        let break_idx = verify_company_chain(&conn, &dir, &company_id).unwrap();
        assert_eq!(break_idx, None, "audit chain must verify after restore");
    }

    #[test]
    fn test_error_mapping_on_disk_full_or_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::StorageFull, "disk full");
        let mapped = map_io_err(io_err);
        assert_eq!(mapped.body().code, "BACKUP_DISK_FULL");
        assert_eq!(mapped.body().http_status, 507);
        assert_eq!(
            mapped.body().user_message,
            "Backup failed — no space. Your Company data is unchanged."
        );

        let perm_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let mapped_perm = map_io_err(perm_err);
        assert_eq!(mapped_perm.body().code, "BACKUP_IO_ERROR");
        assert_eq!(mapped_perm.body().http_status, 500);
        assert_eq!(
            mapped_perm.body().user_message,
            "Backup could not be written. Check permissions and retry."
        );
    }
}
