//! The encrypted `.fpa` Company container (SECURITY-CHECKLIST A02 / §3 "File encryption").
//!
//! Format v1. Every field after `version` is either inside a GCM tag or used as that tag's
//! AAD, so no header byte can be edited without failing authentication:
//!
//! ```text
//! off  len  field
//! 0     8   magic          b"ONEFPA01"
//! 8     1   version        1
//! 9    12   cek_nonce      AES-256-GCM nonce sealing the Company key under the vault key
//! 21   48   cek_sealed     CEK (32B) + tag (16B)          · AAD = bytes 0..21
//! 69   12   payload_nonce  AES-256-GCM nonce for the image
//! 81    ..  payload        SQLite image + tag (16B)        · AAD = bytes 0..69
//! ```
//!
//! WAL (SECURITY-CHECKLIST §3: "WAL in same encrypted container"): SQLite's `-wal`/`-shm`
//! sidecars are never stored beside a sealed container. The image is built from a
//! **checkpointed** database (`PRAGMA wal_checkpoint(TRUNCATE)`), so every committed byte —
//! journal included — lives inside the single sealed file. Opening a container authenticates
//! the header and decrypts the image in memory: no plaintext copy of the database is ever
//! written next to the container, so `session.lock` has nothing left to scrub (AUTH-SPEC §2.3).
//!
//! M1 boundary: `company.create` seals the image and `company.open` authenticates it. The
//! commands that write Company data into the image land with the ingestion milestone — they
//! re-`seal` with the same Company key, which is why the key is returned from `open`.

use std::fs;
use std::path::{Path, PathBuf};

use crate::core::error::{AppError, AppResult};
use crate::storage::db;
use crate::storage::keys::{aes_open, aes_seal, open_key, random_bytes, KEY_LEN, NONCE_LEN, TAG_LEN};

pub const MAGIC: &[u8; 8] = b"ONEFPA01";
pub const VERSION: u8 = 1;

const MAGIC_LEN: usize = 8;
const CEK_NONCE_OFF: usize = MAGIC_LEN + 1; // 9
const CEK_SEALED_OFF: usize = CEK_NONCE_OFF + NONCE_LEN; // 21
const CEK_SEALED_LEN: usize = KEY_LEN + TAG_LEN; // 48
const PAYLOAD_NONCE_OFF: usize = CEK_SEALED_OFF + CEK_SEALED_LEN; // 69
const HEADER_LEN: usize = PAYLOAD_NONCE_OFF + NONCE_LEN; // 81
const MIN_FILE_LEN: usize = HEADER_LEN + TAG_LEN;

/// The SQLite database file header — used to verify a decrypted image before it is used.
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

/// A decrypted container: the Company file key (so the caller can re-seal) plus the image.
pub struct CompanyFile {
    pub key: [u8; KEY_LEN],
    pub image: Vec<u8>,
}

/// A random 256-bit Company file key. It is generated once per Company and never derived from
/// the PIN, so changing the PIN re-wraps one key instead of re-encrypting the payload.
pub fn create_key() -> [u8; KEY_LEN] {
    random_bytes::<KEY_LEN>()
}

/// Directory holding the working copy of a Company's database while it is being built.
pub fn work_dir(data_dir: &Path, company_id: &str) -> PathBuf {
    data_dir.join("companies").join(company_id)
}

/// Seal `image` into a brand-new container at `path` (random key wrap nonce, random payload
/// nonce — a nonce is never reused with the same key, AUTH-SPEC §6).
pub fn seal(
    path: &Path,
    image: &[u8],
    cek: &[u8; KEY_LEN],
    vault_key: &[u8; KEY_LEN],
) -> AppResult<()> {
    let mut out = Vec::with_capacity(HEADER_LEN + image.len() + TAG_LEN);
    out.extend_from_slice(MAGIC);
    out.push(VERSION);

    let cek_nonce = random_bytes::<NONCE_LEN>();
    out.extend_from_slice(&cek_nonce);
    let cek_sealed = aes_seal(vault_key, &cek_nonce, &out[..CEK_SEALED_OFF], cek)?;
    out.extend_from_slice(&cek_sealed);

    let payload_nonce = random_bytes::<NONCE_LEN>();
    out.extend_from_slice(&payload_nonce);
    let payload = aes_seal(cek, &payload_nonce, &out[..PAYLOAD_NONCE_OFF], image)?;
    out.extend_from_slice(&payload);

    write_atomic(path, &out)
}

/// Authenticate the header and unwrap the Company key — no payload decryption. This is the
/// whole PIN→file chain in one call, which is what `session.unlock` proves on unlock
/// (API-SPEC: `session.unlock` may return STORAGE_DECRYPT_FAILED).
pub fn read_key(path: &Path, vault_key: &[u8; KEY_LEN]) -> AppResult<[u8; KEY_LEN]> {
    let bytes = read(path)?;
    unwrap_key(&bytes, vault_key)
}

/// Open, authenticate and decrypt a container: header first, then the image.
pub fn open(path: &Path, vault_key: &[u8; KEY_LEN]) -> AppResult<CompanyFile> {
    let bytes = read(path)?;
    let key = unwrap_key(&bytes, vault_key)?;
    let mut payload_nonce = [0u8; NONCE_LEN];
    payload_nonce.copy_from_slice(&bytes[PAYLOAD_NONCE_OFF..HEADER_LEN]);
    let image = aes_open(&key, &payload_nonce, &bytes[..PAYLOAD_NONCE_OFF], &bytes[HEADER_LEN..])?;
    Ok(CompanyFile { key, image })
}

fn unwrap_key(bytes: &[u8], vault_key: &[u8; KEY_LEN]) -> AppResult<[u8; KEY_LEN]> {
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&bytes[CEK_NONCE_OFF..CEK_SEALED_OFF]);
    open_key(vault_key, &nonce, &bytes[CEK_SEALED_OFF..PAYLOAD_NONCE_OFF])
}

/// Read a container and validate its envelope. A missing, short, foreign or future-version
/// file is `STORAGE_FILE_CORRUPT` (422 → user is offered a restore); only an authentication
/// failure is `STORAGE_DECRYPT_FAILED` (401 → the PIN/file pair does not match).
fn read(path: &Path) -> AppResult<Vec<u8>> {
    let bytes = fs::read(path).map_err(|_| AppError::file_corrupt())?;
    if bytes.len() < MIN_FILE_LEN || bytes[..MAGIC_LEN] != MAGIC[..] || bytes[MAGIC_LEN] != VERSION {
        return Err(AppError::file_corrupt());
    }
    Ok(bytes)
}

/// True when `image` carries the SQLite file header — the integrity gate for a decrypted
/// image (SECURITY-CHECKLIST §3 "File integrity").
pub fn is_sqlite_image(image: &[u8]) -> bool {
    image.len() >= SQLITE_MAGIC.len() && image[..SQLITE_MAGIC.len()] == SQLITE_MAGIC[..]
}

/// Build the initial database image for a new Company: materialise a real database so
/// `db::open_at` runs the migrations, checkpoint the WAL into the main file, read the bytes,
/// then delete the temporary directory. The sealed container is the only copy that survives.
pub fn new_image(data_dir: &Path, company_id: &str) -> AppResult<Vec<u8>> {
    let dir = work_dir(data_dir, company_id);
    let path = dir.join(db::DB_FILE);
    fs::create_dir_all(&dir).map_err(|e| AppError::Db(format!("DB_DIR: {e}")))?;
    let conn = db::open_at(&dir)?;
    checkpoint(&conn)?;
    drop(conn);
    let image = fs::read(&path).map_err(|e| AppError::Db(format!("DB_READ: {e}")))?;
    fs::remove_dir_all(&dir).map_err(|e| AppError::Db(format!("DB_TMP_CLEANUP: {e}")))?;
    Ok(image)
}

/// Fold the WAL back into the main database file so the sealed image is one complete database
/// ("WAL in same encrypted container", SECURITY-CHECKLIST §3).
fn checkpoint(conn: &rusqlite::Connection) -> AppResult<()> {
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
        .map_err(AppError::from)
}

/// Write via a temporary file + rename so a crash mid-write cannot leave a half-sealed
/// container where a valid one used to be.
fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| AppError::internal(format!("FILE_DIR: {e}")))?;
        }
    }
    let tmp = path.with_extension("fpa-tmp");
    fs::write(&tmp, bytes).map_err(|e| AppError::internal(format!("FILE_WRITE: {e}")))?;
    fs::rename(&tmp, path).map_err(|e| AppError::internal(format!("FILE_RENAME: {e}")))?;
    restrict(path)
}

/// A sealed Company file is owner-only (SECURITY-CHECKLIST §3).
#[cfg(unix)]
fn restrict(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|e| AppError::internal(format!("FILE_MODE: {e}")))
}

#[cfg(not(unix))]
fn restrict(_path: &Path) -> AppResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("onefpa-container-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("company.fpa")
    }

    #[test]
    fn round_trip_seals_and_opens() {
        let path = tmp("round-trip");
        let vault_key = random_bytes::<KEY_LEN>();
        let cek = create_key();
        let image = b"SQLite format 3\0-an-image".to_vec();
        seal(&path, &image, &cek, &vault_key).unwrap();

        let file = open(&path, &vault_key).unwrap();
        assert_eq!(file.key, cek);
        assert_eq!(file.image, image);
        assert!(is_sqlite_image(&file.image));
    }

    #[test]
    fn sealed_bytes_never_contain_the_image() {
        let path = tmp("no-plaintext");
        let vault_key = random_bytes::<KEY_LEN>();
        let secret = b"SUPER-SECRET-GL-TOTAL-9123456789".to_vec();
        seal(&path, &secret, &create_key(), &vault_key).unwrap();
        let raw = fs::read(&path).unwrap();
        let as_text = String::from_utf8_lossy(&raw);
        assert!(!as_text.contains("SUPER-SECRET-GL-TOTAL"), "no plaintext on disk (A02)");
    }

    #[test]
    fn wrong_key_fails_with_decrypt_failed() {
        let path = tmp("wrong-key");
        seal(&path, b"image", &create_key(), &random_bytes::<KEY_LEN>()).unwrap();
        // A different PIN derives a different vault key → the header cannot be unwrapped.
        let err = open(&path, &random_bytes::<KEY_LEN>()).unwrap_err();
        assert_eq!(err.body().code, "STORAGE_DECRYPT_FAILED");
        assert_eq!(err.body().http_status, 401, "ERROR-HANDLING.md §B");
        assert_eq!(err.body().user_message, "The Company file cannot be decrypted with this PIN.");
        assert!(!err.body().retryable);
        // The cheap key-only check reports the same failure.
        assert_eq!(read_key(&path, &random_bytes::<KEY_LEN>()).unwrap_err().body().code, "STORAGE_DECRYPT_FAILED");
    }

    #[test]
    fn tampered_byte_fails_with_decrypt_failed() {
        let path = tmp("tampered");
        let vault_key = random_bytes::<KEY_LEN>();
        seal(&path, b"SQLite format 3\0-image", &create_key(), &vault_key).unwrap();

        for offset in [0usize, 8, 9, 20, 21, 40, 68, 69, 80, 81, 95] {
            let mut bytes = fs::read(&path).unwrap();
            if offset >= bytes.len() {
                continue;
            }
            bytes[offset] ^= 0x01;
            fs::write(&path, &bytes).unwrap();
            let code = open(&path, &vault_key).unwrap_err().body().code;
            assert!(
                code == "STORAGE_DECRYPT_FAILED" || code == "STORAGE_FILE_CORRUPT",
                "byte {offset} must not open: got {code}"
            );
        }
    }

    #[test]
    fn truncated_and_foreign_files_are_corrupt_not_decrypt() {
        let path = tmp("corrupt");
        let vault_key = random_bytes::<KEY_LEN>();
        seal(&path, b"SQLite format 3\0-image", &create_key(), &vault_key).unwrap();

        let mut bytes = fs::read(&path).unwrap();
        bytes.truncate(HEADER_LEN);
        fs::write(&path, &bytes).unwrap();
        assert_eq!(open(&path, &vault_key).unwrap_err().body().code, "STORAGE_FILE_CORRUPT");

        fs::write(&path, b"not a company file at all, just text").unwrap();
        assert_eq!(open(&path, &vault_key).unwrap_err().body().code, "STORAGE_FILE_CORRUPT");

        // A missing file is reported the same way — never a panic, never a raw io error.
        assert_eq!(open(&tmp("missing").join("nope.fpa"), &vault_key).unwrap_err().body().code, "STORAGE_FILE_CORRUPT");
    }

    #[test]
    fn layout_constants_describe_the_sealed_file() {
        let path = tmp("layout");
        let vault_key = random_bytes::<KEY_LEN>();
        seal(&path, b"x", &create_key(), &vault_key).unwrap();
        let bytes = fs::read(&path).unwrap();
        // header + 1 payload byte + tag
        assert_eq!(bytes.len(), HEADER_LEN + 1 + TAG_LEN);
        assert_eq!(&bytes[..MAGIC_LEN], &MAGIC[..]);
        assert_eq!(bytes[MAGIC_LEN], VERSION);
    }

    #[test]
    fn a_non_sqlite_image_is_detected() {
        assert!(is_sqlite_image(b"SQLite format 3\0 rest"));
        assert!(!is_sqlite_image(b"SQLite format 4\0 rest"));
        assert!(!is_sqlite_image(b"short"));
        assert!(!is_sqlite_image(b""));
    }
}
