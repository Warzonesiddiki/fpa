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
        .query_row("SELECT EXISTS(SELECT 1 FROM packs LIMIT 1)", [], |r| {
            r.get(0)
        })
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
        let v: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| AppError::invalid(format!("PACK_SCHEMA_INVALID: {key}: {e}")))?;
        // Canonical pack.json layout (packs/schema/pack.schema.json; INDUSTRY-PACK-SPEC §File
        // Layout): identity lives in the nested `pack` object, `schema_version` is top-level.
        // Field paths in errors match the schema paths (S-002 error banner shows the path).
        let name = v["pack"]["name"]
            .as_str()
            .ok_or_else(|| AppError::invalid(format!("PACK_SCHEMA_INVALID: {key}: pack.name")))?;
        let version = v["pack"]["version"].as_str().ok_or_else(|| {
            AppError::invalid(format!("PACK_SCHEMA_INVALID: {key}: pack.version"))
        })?;
        let description = v["pack"]["description"].as_str().unwrap_or("").to_string();
        let schema_version = v["schema_version"].as_str().ok_or_else(|| {
            AppError::invalid(format!("PACK_SCHEMA_INVALID: {key}: schema_version"))
        })?;
        let checksum = hex_sha256(text.as_bytes());
        conn.execute(
            "INSERT INTO packs (id, key, name, version, schema_version, description, is_bundled, source_checksum, installed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, datetime('now'))",
            rusqlite::params![
                Uuid::new_v4().to_string(),
                *key,
                name,
                version,
                schema_version,
                description,
                checksum
            ],
        )
        .map_err(AppError::from)?;
    }
    Ok(())
}

pub(crate) fn find_packs_dir(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    if let Ok(res) = app.path().resource_dir() {
        let candidate = res.join("packs");
        if candidate.join("saas").join("pack.json").exists() {
            return Ok(candidate);
        }
    }
    let cwd = std::env::current_dir().map_err(|e| AppError::internal(e.to_string()))?;
    let dev = cwd.join("packs");
    if dev.join("saas").join("pack.json").exists() {
        return Ok(dev);
    }
    Err(AppError::internal(
        "PACK_BUNDLE_MISSING: bundled packs directory not found",
    ))
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
    let conn = crate::storage::db::open_at(&dir)?;
    seed_bundled_packs(&app, &conn)?;
    let mut stmt = conn
        .prepare("SELECT key, name, version, schema_version, description, is_bundled FROM packs ORDER BY key")
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "key": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "version": r.get::<_, String>(2)?,
                "schema_version": r.get::<_, String>(3)?,
                "description": r.get::<_, String>(4)?,
                "is_bundled": r.get::<_, i64>(5)? != 0,
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
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../packs");
        for k in BUNDLED_KEYS {
            assert!(
                dir.join(k).join("pack.json").exists(),
                "bundled pack missing: {k}"
            );
        }
    }

    /// The seed reads the NESTED `pack` object (packs/schema/pack.schema.json); if a bundled
    /// pack.json ever regresses to a flat layout the seed must fail with the schema field
    /// path — this test pins that contract against the real bundled files.
    #[test]
    fn bundled_pack_files_use_the_nested_pack_layout_the_seed_reads() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../packs");
        for k in BUNDLED_KEYS {
            let text = fs::read_to_string(dir.join(k).join("pack.json")).unwrap();
            let v: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert!(
                v["pack"]["name"].is_string(),
                "{k}: pack.name missing — seed would fail with PACK_SCHEMA_INVALID"
            );
            assert!(
                v["pack"]["version"].is_string(),
                "{k}: pack.version missing"
            );
            assert!(
                v["pack"]["description"].is_string(),
                "{k}: pack.description missing"
            );
            assert!(
                v["schema_version"].is_string(),
                "{k}: schema_version missing"
            );
            // The flat layout must NOT be what the seed sees:
            assert!(
                v.get("name").is_none(),
                "{k}: unexpected flat `name` at top level"
            );
        }
    }
}
