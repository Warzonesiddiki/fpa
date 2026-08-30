//! pack.list + bundled pack seeding (INDUSTRY-PACK-SPEC; B15 — data-only bundles).

use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::fs;
use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

use crate::core::error::{AppError, AppResult};

const BUNDLED_KEYS: &[&str] = &[
    "saas",
    "manufacturing",
    "retail",
    "healthcare",
    "construction",
    "professional-services",
    "nonprofit",
    "government",
    "energy",
    "financial-services",
    "logistics",
    "real-estate",
];

/// First-run seed: copy bundled packs (resource dir, dev fallback ./packs) into the DB.
pub fn seed_bundled_packs(app: &AppHandle, conn: &Connection) -> AppResult<()> {
    let already: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM packs LIMIT 1)", [], |r| r.get(0))
        .map_err(AppError::from)?;
    if already {
        return Ok(());
    }
    let dir = find_packs_dir(app)?;
    for key in BUNDLED_KEYS {
        let meta_path = dir.join(key).join("pack.json");
        let text = match fs::read_to_string(&meta_path) {
            Ok(t) => t,
            Err(e) => return Err(AppError::internal(format!("PACK_BUNDLE_READ: {key}: {e}"))),
        };
        let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| AppError::invalid(format!("PACK_SCHEMA_INVALID: {key}: {e}")))?;
        let name = v["name"].as_str().ok_or_else(|| AppError::invalid(format!("PACK_SCHEMA_INVALID: {key}: name")))?;
        let version = v["version"].as_str().ok_or_else(|| AppError::invalid(format!("PACK_SCHEMA_INVALID: {key}: version")))?;
        let schema_version =
            v["schema_version"].as_str().ok_or_else(|| AppError::invalid(format!("PACK_SCHEMA_INVALID: {key}: schema_version")))?;
        let checksum = hex_sha256(text.as_bytes());
        conn.execute(
            "INSERT INTO packs (id, key, name, version, schema_version, is_bundled, source_checksum, installed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, datetime('now'))",
            rusqlite::params![Uuid::new_v4().to_string(), *key, name, version, schema_version, checksum],
        )
        .map_err(AppError::from)?;
    }
    Ok(())
}

fn find_packs_dir(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    if let Ok(res) = app.path().resource_dir() {
        let candidate = res.join("packs");
        if candidate.join("saas").join("pack.json").exists() {
            return Ok(candidate);
        }
    }
    let cwd = std::env::current_dir().map_err(AppError::internal)?;
    let dev = cwd.join("packs");
    if dev.join("saas").join("pack.json").exists() {
        return Ok(dev);
    }
    Err(AppError::internal("PACK_BUNDLE_MISSING: bundled packs directory not found".into()))
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// `pack.list` — {company_id?}
#[tauri::command(name = "pack.list", rename_all = "camelCase")]
pub fn pack_list(app: AppHandle) -> AppResult<serde_json::Value> {
    let dir = crate::commands::company::app_data_dir(&app)?;
    let conn = crate::storage::db::open_at(&dir).map_err(AppError::from)?;
    seed_bundled_packs(&app, &conn)?;
    let mut stmt = conn
        .prepare("SELECT key, name, version, schema_version, is_bundled FROM packs ORDER BY key")
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "key": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "version": r.get::<_, String>(2)?,
                "schema_version": r.get::<_, String>(3)?,
                "is_bundled": r.get::<_, i64>(4)? != 0,
            }))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    Ok(serde_json::json!({ "data": rows }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_is_stable() {
        assert_eq!(
            hex_sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn bundled_key_list_matches_pack_schema_contract() {
        assert_eq!(BUNDLED_KEYS.len(), 12, "INDUSTRY-PACK-SPEC ships 12 packs");
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packs");
        for k in BUNDLED_KEYS {
            assert!(dir.join(k).join("pack.json").exists(), "bundled pack missing: {k}");
        }
    }
}
