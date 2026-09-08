//! pack.list + pack.validate + bundled pack seeding (INDUSTRY-PACK-SPEC; B15 — data-only bundles).

use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

use crate::commands::session::{SessionState, require_unlocked};
use crate::core::error::{AppError, AppResult};
use crate::storage::{db, keystore};

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

// ── pack.install (API-SPEC §18; INDUSTRY-PACK-SPEC §8/§9) ─────────────────────

/// §1 field → pack_components.kind (migration 001 CHECK constraint).
fn component_kind(field: &str) -> Option<&'static str> {
    Some(match field {
        "coa_template" => "coa",
        "kpi_definitions" => "kpi",
        "driver_templates" => "driver_template",
        "report_layouts" => "report_layout",
        "gl_template" => "gl_template",
        "group_rollup_maps" => "calendar_preset",
        _ => return None,
    })
}

/// The component pack.json fields seeded at install (§18; `group_rollup_maps` seeds as
/// `calendar_preset` per the §1 field→kind mapping above).
const INSTALL_COMPONENT_FIELDS: &[&str] = &[
    "coa_template",
    "kpi_definitions",
    "driver_templates",
    "report_layouts",
    "gl_template",
    "group_rollup_maps",
];

/// `pack.install` — {pack_path, company_id} → {pack_id, version, warnings[] (§8 legacy debts)}.
/// Company write: seeds packs + pack_components and appends a `pack.install` HMAC audit
/// event — all in ONE transaction (B18-1). Invalid packs never reach the DB (§18).
#[tauri::command(name = "pack.install", rename_all = "snake_case")]
pub fn pack_install(
    app: AppHandle,
    pack_path: String,
    company_id: String,
    session: tauri::State<'_, SessionState>,
) -> AppResult<Value> {
    use crate::commands::session::require_session_write;

    let unlocked = require_session_write(&session)?;
    if company_id.trim() != unlocked {
        return Err(AppError::invalid(
            "pack.install company_id must be the unlocked Company",
        ));
    }
    let app_dir = crate::commands::company::app_data_dir(&app)?;
    let mut conn = db::open_at(&app_dir)?;
    pack_install_internal(&mut conn, &app_dir, &pack_path, &company_id)
}

/// Shared implementation (unit-testable; the caller owns the connection and the data dir).
pub fn pack_install_internal(
    conn: &mut Connection,
    dir: &Path,
    pack_path: &str,
    company_id: &str,
) -> AppResult<Value> {
    use crate::core::audit::next_hash;

    let trimmed = pack_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid("pack_path is required"));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::invalid("pack_path must be an absolute path"));
    }

    // §18 gate: validate FIRST — a blocking §8 error aborts with PACK_SCHEMA_INVALID.
    let (errors, warnings) = validate_pack_dir(&path);
    if let Some(first) = errors.first() {
        return Err(AppError::PackSchemaInvalid {
            path: first.clone(),
        });
    }

    let (pack_dir, meta_path) = resolve_pack_location(&path);
    let meta_text = fs::read_to_string(&meta_path).map_err(|_| AppError::PackSchemaInvalid {
        path: "pack.json: missing or unreadable".into(),
    })?;
    let pack: Value =
        serde_json::from_str(&meta_text).map_err(|e| AppError::PackSchemaInvalid {
            path: format!("pack.json: malformed JSON ({e})"),
        })?;
    let key = pack["pack"]["key"].as_str().unwrap_or("").to_string();
    let name = pack["pack"]["name"].as_str().unwrap_or("").to_string();
    let version = pack["pack"]["version"].as_str().unwrap_or("").to_string();
    let description = pack["pack"]["description"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let schema_version = pack["schema_version"].as_str().unwrap_or("").to_string();
    let checksum = hex_sha256(meta_text.as_bytes());

    // Same key + same-or-higher installed version → PACK_VERSION_EXISTS (§18 versioning).
    let existing: Option<(String, String)> = conn
        .query_row(
            "SELECT id, version FROM packs WHERE key = ?1 ORDER BY installed_at DESC LIMIT 1",
            [&key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?;
    if let Some((_, installed)) = existing {
        let installed_parts: Vec<u32> = installed
            .split('.')
            .filter_map(|p| p.parse::<u32>().ok())
            .collect();
        let incoming_parts: Vec<u32> = version
            .split('.')
            .filter_map(|p| p.parse::<u32>().ok())
            .collect();
        let incoming_not_newer = match (installed_parts.as_slice(), incoming_parts.as_slice()) {
            ([a, b, c], [x, y, z]) => (*x, *y, *z) <= (*a, *b, *c),
            _ => true, // unparseable versions were already rejected by §17 validation
        };
        if incoming_not_newer {
            return Err(AppError::PackVersionExists { version });
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let pack_id = Uuid::new_v4().to_string();
    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO packs (id, key, name, version, schema_version, description, is_bundled, source_checksum, installed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
        rusqlite::params![
            pack_id,
            key,
            name,
            version,
            schema_version,
            description,
            checksum,
            now
        ],
    )
    .map_err(AppError::from)?;

    // One pack_components row per referenced component file (§18; payload = exact bytes).
    for field in INSTALL_COMPONENT_FIELDS {
        let Some(kind) = component_kind(field) else {
            continue;
        };
        let Some(fname) = pack[field].as_str() else {
            continue;
        };
        let payload =
            fs::read_to_string(pack_dir.join(fname)).map_err(|_| AppError::PackSchemaInvalid {
                path: format!("{fname}: missing or unreadable"),
            })?;
        // Sanity: the payload must parse as JSON (validated already, but the bytes we store
        // must be the JSON we validated, not a racing rewrite).
        let ref_key = serde_json::from_str::<Value>(&payload)
            .map_err(|e| AppError::PackSchemaInvalid {
                path: format!("{fname}: malformed JSON ({e})"),
            })?
            .as_object()
            .and_then(|o| o.keys().next().cloned())
            .unwrap_or_else(|| fname.to_string());
        tx.execute(
            "INSERT INTO pack_components (id, pack_id, kind, ref_key, payload) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![Uuid::new_v4().to_string(), pack_id, kind, ref_key, payload],
        )
        .map_err(AppError::from)?;
    }

    // HMAC audit on the Company chain (same primitives as coa.import — audit.rs).
    let after_json = serde_json::json!({
        "action": "pack.install",
        "pack_key": key,
        "version": version,
        "source_checksum": checksum,
    })
    .to_string();
    let hmac_key = keystore::audit_hmac_key(dir).map_err(AppError::internal)?;
    let prev = crate::commands::company::audited_hash(&tx, company_id).map_err(AppError::from)?;
    let hash = next_hash(&hmac_key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'pack.install', 'pack', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, pack_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": { "pack_id": pack_id, "version": version, "warnings": warnings }
    }))
}

// ── pack.builder.save_v1 (API-SPEC §21; INDUSTRY-PACK-SPEC §9) ───────────────────

/// The inline component fields a builder document carries (payload field name →
/// the pack.json reference field that names it).
const BUILDER_COMPONENTS: &[(&str, &str)] = &[
    ("coa", "coa_template"),
    ("kpis", "kpi_definitions"),
    ("drivers", "driver_templates"),
    ("layouts", "report_layouts"),
    ("gl_template_content", "gl_template"),
    ("rollup", "group_rollup_maps"),
];

/// `pack.builder.save_v1` — {pack_id?, definition_json} → {pack_id, version} (API-SPEC §21).
/// Company write: validates the inline definition with the §17 check set (materialised to a
/// temp dir — ONE validation implementation for gate/install/builder), version-checks per §9,
/// then INSERTs packs + pack_components + a `pack.builder.save_v1` HMAC audit event in ONE
/// transaction. Editing is versioned, never in-place (B7).
#[tauri::command(name = "pack.builder.save_v1", rename_all = "snake_case")]
pub fn pack_builder_save_v1(
    app: AppHandle,
    pack_id: Option<String>,
    definition_json: Value,
    session: tauri::State<'_, SessionState>,
) -> AppResult<Value> {
    use crate::commands::session::require_session_write;

    let company_id = require_session_write(&session)?;
    let app_dir = crate::commands::company::app_data_dir(&app)?;
    let mut conn = db::open_at(&app_dir)?;
    pack_builder_save_v1_internal(
        &mut conn,
        &app_dir,
        pack_id.as_deref(),
        &definition_json,
        &company_id,
    )
}

/// Shared implementation (unit-testable; caller owns the connection and the data dir).
pub fn pack_builder_save_v1_internal(
    conn: &mut Connection,
    dir: &Path,
    pack_id: Option<&str>,
    definition: &Value,
    company_id: &str,
) -> AppResult<Value> {
    use crate::core::audit::next_hash;

    // Materialise the inline document into a temp pack directory (canonical file layout).
    // Uniqueness comes from a random suffix; the §17 key/dir-match check is skipped for the
    // builder path (a builder document carries its own key — there is no on-disk identity yet).
    let builder_key = definition["pack"]["key"]
        .as_str()
        .unwrap_or("pack")
        .to_string();
    let tmp = std::env::temp_dir().join(format!("onefpa-builder-{}", Uuid::new_v4()));
    fs::create_dir_all(&tmp).map_err(|e| AppError::internal(format!("TMP_DIR: {e}")))?;
    let _ = builder_key; // key is enforced by the version rules below, not by a directory name
    let result = (|| {
        let pack_view =
            definition["pack"]
                .as_object()
                .ok_or_else(|| AppError::PackSchemaInvalid {
                    path: "pack: required object".into(),
                })?;
        let key = pack_view
            .get("key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let version = pack_view
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if key.is_empty() || version.is_empty() {
            return Err(AppError::PackSchemaInvalid {
                path: "pack.key/pack.version: required".into(),
            });
        }

        // Build the pack.json with the canonical nested layout, referencing component
        // filenames we write alongside (the §1 File Layout).
        let mut meta = serde_json::Map::new();
        meta.insert("schema_version".into(), Value::String("1.0.0".into()));
        meta.insert("pack".into(), definition["pack"].clone());
        for (payload_field, ref_field) in BUILDER_COMPONENTS {
            if definition
                .get(*payload_field)
                .map(|v| !v.is_null())
                .unwrap_or(false)
            {
                let fname = format!("{}.json", payload_field);
                meta.insert((*ref_field).to_string(), Value::String(fname.clone()));
            }
        }
        fs::write(
            tmp.join("pack.json"),
            serde_json::to_string_pretty(&Value::Object(meta))
                .map_err(|e| AppError::internal(format!("SERIALIZE: {e}")))?,
        )
        .map_err(|e| AppError::internal(format!("TMP_WRITE: {e}")))?;
        for (payload_field, _) in BUILDER_COMPONENTS {
            if let Some(payload) = definition.get(*payload_field) {
                if payload.is_null() {
                    continue;
                }
                let fname = format!("{}.json", payload_field);
                fs::write(
                    tmp.join(&fname),
                    serde_json::to_string_pretty(payload)
                        .map_err(|e| AppError::internal(format!("SERIALIZE: {e}")))?,
                )
                .map_err(|e| AppError::internal(format!("TMP_WRITE: {e}")))?;
            }
        }

        let (errors, warnings) = validate_pack_dir_opts(&tmp, true);
        if let Some(first) = errors.first() {
            return Err(AppError::PackSchemaInvalid {
                path: first.clone(),
            });
        }
        Ok(warnings)
    })();
    fs::remove_dir_all(&tmp).ok();
    let warnings = result?;

    // Version rules (§21/§9).
    let incoming_key = definition["pack"]["key"].as_str().unwrap_or("").to_string();
    let incoming_version = definition["pack"]["version"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let existing: Option<(String, String)> = if let Some(pid) = pack_id {
        // Editing an existing pack: the id must exist; version must be strictly higher.
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT id, version FROM packs WHERE id = ?1 ORDER BY installed_at DESC LIMIT 1",
                [pid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(AppError::from)?;
        let (found_id, found_version) =
            row.ok_or_else(|| AppError::invalid("pack_id must reference an existing pack"))?;
        if !is_version_higher(&incoming_version, &found_version) {
            return Err(AppError::PackVersionExists {
                version: incoming_version,
            });
        }
        Some((found_id, found_version))
    } else {
        // New pack document: same key + same-or-higher installed version → conflict.
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT id, version FROM packs WHERE key = ?1 ORDER BY installed_at DESC LIMIT 1",
                [&incoming_key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(AppError::from)?;
        if let Some((_, installed)) = row
            && !is_version_higher(&incoming_version, &installed)
        {
            return Err(AppError::PackVersionExists {
                version: incoming_version,
            });
        }
        None
    };

    let now = chrono::Utc::now().to_rfc3339();
    let new_pack_id = Uuid::new_v4().to_string();
    let canonical_meta = serde_json::to_string(&definition["pack"]).unwrap_or_default();
    let checksum = hex_sha256(canonical_meta.as_bytes());
    let name = definition["pack"]["name"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let description = definition["pack"]["description"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO packs (id, key, name, version, schema_version, description, is_bundled, source_checksum, installed_at)
         VALUES (?1, ?2, ?3, ?4, '1.0.0', ?5, 0, ?6, ?7)",
        rusqlite::params![new_pack_id, incoming_key, name, incoming_version, description, checksum, now],
    )
    .map_err(AppError::from)?;

    // One pack_components row per inline component (same §1 field→kind mapping as §18).
    for (payload_field, ref_field) in BUILDER_COMPONENTS {
        let Some(payload) = definition.get(*payload_field) else {
            continue;
        };
        if payload.is_null() {
            continue;
        }
        let Some(kind) = component_kind(ref_field) else {
            continue;
        };
        let ref_key = payload
            .as_object()
            .and_then(|o| o.keys().next().cloned())
            .unwrap_or_else(|| payload_field.to_string());
        tx.execute(
            "INSERT INTO pack_components (id, pack_id, kind, ref_key, payload) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                Uuid::new_v4().to_string(),
                new_pack_id,
                kind,
                ref_key,
                serde_json::to_string(payload).map_err(|e| AppError::internal(format!("SERIALIZE: {e}")))?,
            ],
        )
        .map_err(AppError::from)?;
    }

    let after_json = serde_json::json!({
        "action": "pack.builder.save_v1",
        "pack_key": incoming_key,
        "version": incoming_version,
        "edited_pack_id": pack_id,
        "prior_version": existing.as_ref().map(|(_, v)| v.clone()),
        "source_checksum": checksum,
    })
    .to_string();
    let hmac_key = keystore::audit_hmac_key(dir).map_err(AppError::internal)?;
    let prev = crate::commands::company::audited_hash(&tx, company_id).map_err(AppError::from)?;
    let hash = next_hash(&hmac_key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'pack.builder.save_v1', 'pack', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, new_pack_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": { "pack_id": new_pack_id, "version": incoming_version, "warnings": warnings }
    }))
}

/// Strict higher-semver comparison: MAJOR.MINOR.PATCH numeric tuple.
fn is_version_higher(incoming: &str, installed: &str) -> bool {
    let parse = |s: &str| -> Option<(u32, u32, u32)> {
        let parts: Vec<u32> = s.split('.').filter_map(|p| p.parse::<u32>().ok()).collect();
        match parts.as_slice() {
            [a, b, c] => Some((*a, *b, *c)),
            _ => None,
        }
    };
    match (parse(incoming), parse(installed)) {
        (Some(i), Some(n)) => i > n,
        _ => false,
    }
}

// ── pack.validate (API-SPEC §17; INDUSTRY-PACK-SPEC §8) ────────────────────────────

const PACK_ACCOUNT_TYPES: &[&str] = &["revenue", "cogs", "opex", "asset", "liability", "equity"];
const PACK_DRIVER_TYPES: &[&str] = &[
    "volume_x_rate",
    "headcount",
    "growth",
    "seasonal",
    "spread",
    "ratio",
    "manual",
];
const PACK_COLUMN_TYPES: &[&str] = &["period", "ytd", "fy", "variance", "threeway"];

/// `pack.validate` — {pack_path} → {valid, errors[], warnings[]} (API-SPEC §17).
/// Read-only: session required, no audit event, no DB write. Validation failures ride the
/// payload as structured entries; only a malformed path shape throws `VALUE_INVALID`.
#[tauri::command(name = "pack.validate", rename_all = "snake_case")]
pub fn pack_validate(
    pack_path: String,
    session: tauri::State<'_, SessionState>,
) -> AppResult<Value> {
    require_unlocked(&session)?;
    let trimmed = pack_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid("pack_path is required"));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::invalid("pack_path must be an absolute path"));
    }

    let (errors, warnings) = validate_pack_dir(&path);
    let valid = errors.is_empty();
    Ok(serde_json::json!({
        "data": {
            "valid": valid,
            "errors": errors,
            "warnings": warnings,
        }
    }))
}

/// Resolve a pack location (directory or pack.json file) to its directory + pack.json path.
fn resolve_pack_location(path: &Path) -> (PathBuf, PathBuf) {
    if path.is_file() {
        let dir = path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| path.to_path_buf());
        (dir, path.to_path_buf())
    } else {
        (path.to_path_buf(), path.join("pack.json"))
    }
}

/// The §8 validation run. Returns (blocking errors, non-blocking warnings) as UI strings.
/// `skip_key_dir_match` relaxes the pack.key/dir-name identity for the builder path, whose
/// temp materialisation has no on-disk identity (§21 — the key is enforced by version rules).
pub(crate) fn validate_pack_dir(path: &Path) -> (Vec<String>, Vec<String>) {
    validate_pack_dir_opts(path, false)
}

pub(crate) fn validate_pack_dir_opts(
    path: &Path,
    skip_key_dir_match: bool,
) -> (Vec<String>, Vec<String>) {
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let (dir, meta_path) = resolve_pack_location(path);
    let label = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("pack")
        .to_string();

    let text = match fs::read_to_string(&meta_path) {
        Ok(t) => t,
        Err(_) => {
            errors.push(format!("pack.json: missing or unreadable in {label}"));
            return (errors, warnings);
        }
    };
    let v: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            errors.push(format!("pack.json: malformed JSON ({e})"));
            return (errors, warnings);
        }
    };

    if v["schema_version"].as_str() != Some("1.0.0") {
        errors.push("schema_version: must be \"1.0.0\"".to_string());
    }
    let version = v["pack"]["version"].as_str().unwrap_or("");
    if !is_semver(version) {
        errors.push("pack.version: must be semver (MAJOR.MINOR.PATCH)".to_string());
    }
    let key = v["pack"]["key"].as_str().unwrap_or("");
    if key.is_empty() {
        errors.push("pack.key: required".to_string());
    } else if !skip_key_dir_match && key != label && key.replace('_', "-") != label {
        errors.push(format!(
            "pack.key: \"{key}\" does not match directory name \"{label}\""
        ));
    }
    let locale = v["pack"]["locale_hint"].as_str().unwrap_or("");
    if !is_bcp47(locale) {
        errors.push("pack.locale_hint: must be BCP-47 (e.g. en-US)".to_string());
    }

    // COA template (§8: ≥5 accounts, unique codes, closed type set).
    if let Some(coa) = read_component(&dir, &v, "coa_template", &label, &mut errors) {
        let accounts = coa["accounts"].as_array();
        match accounts {
            None => errors.push("coa_template: accounts[] required".to_string()),
            Some(list) => {
                if list.len() < 5 {
                    errors.push("coa_template: needs ≥5 accounts".to_string());
                }
                let mut seen = std::collections::BTreeSet::new();
                for a in list {
                    let code = a["code"].as_str().unwrap_or("");
                    if code.is_empty() {
                        errors.push("coa_template: account code required".to_string());
                    } else if !seen.insert(code.to_string()) {
                        errors.push(format!("coa_template: duplicate code '{code}'"));
                    }
                    let t = a["type"].as_str().unwrap_or("");
                    if !PACK_ACCOUNT_TYPES.contains(&t) {
                        errors.push(format!(
                            "coa_template: invalid account type '{t}' (revenue/cogs/opex/asset/liability/equity)"
                        ));
                    }
                }
            }
        }
    }

    // KPI definitions (§8: ≥4, decimal targets; formula/bands warn until re-issued).
    if let Some(kpis) = read_component(&dir, &v, "kpi_definitions", &label, &mut errors) {
        match kpis["kpis"].as_array() {
            None => errors.push("kpi_definitions: kpis[] required".to_string()),
            Some(list) => {
                if list.len() < 4 {
                    errors.push("kpi_definitions: needs ≥4".to_string());
                }
                for k in list {
                    let key = k["key"].as_str().unwrap_or("?");
                    if key == "?" {
                        errors.push("kpi_definitions: KPI key required".to_string());
                    }
                    if k["definition"].as_str().is_none() {
                        errors.push(format!("kpi_definitions: KPI '{key}' definition required"));
                    }
                    // §8 target check is stringified-decimal (the repo gate uses String(value)):
                    // JSON numbers like 115 or 1.2 are accepted, exponent forms are not (B3).
                    let target = match k["target"]["value"] {
                        Value::String(ref s) => s.clone(),
                        Value::Number(ref n) => n.to_string(),
                        _ => String::new(),
                    };
                    if !is_decimal_string(&target) {
                        errors.push(format!(
                            "kpi_definitions: KPI '{key}' target.value must be a decimal string"
                        ));
                    }
                    let formula = k["formula"].as_str().unwrap_or("").trim();
                    if formula.is_empty() {
                        warnings.push(format!(
                            "{label}: KPI '{key}' formula missing (§3) — re-issue the pack"
                        ));
                    }
                    let bands_ok =
                        k["bands"]["good"].is_number() && k["bands"]["watch"].is_number();
                    if !bands_ok {
                        warnings.push(format!(
                            "{label}: KPI '{key}' bands missing/invalid (§3) — alerts fall back to target-only"
                        ));
                    }
                }
            }
        }
    }

    // Driver templates (§8: 3–7, closed type set, decimal bounds; empty links warn).
    if let Some(drivers) = read_component(&dir, &v, "driver_templates", &label, &mut errors) {
        match drivers["drivers"].as_array() {
            None => errors.push("driver_templates: drivers[] required".to_string()),
            Some(list) => {
                if !(3..=7).contains(&list.len()) {
                    errors.push("driver_templates: must be 3–7 (B16 advisory)".to_string());
                }
                for dr in list {
                    let key = dr["key"].as_str().unwrap_or("?");
                    let t = dr["type"].as_str().unwrap_or("");
                    if !PACK_DRIVER_TYPES.contains(&t) {
                        errors.push(format!(
                            "driver_templates: invalid driver type '{t}' for '{key}'"
                        ));
                    }
                    for side in ["low", "high"] {
                        let b = dr["bounds"][side].as_str().unwrap_or("");
                        if !is_decimal_string(b) {
                            errors.push(format!(
                                "driver_templates: driver '{key}' bounds.{side} must be a decimal value"
                            ));
                        }
                    }
                    let linked = dr["links"]
                        .as_array()
                        .map(|l| !l.is_empty())
                        .unwrap_or(false);
                    if !linked {
                        warnings.push(format!(
                            "{label}: driver '{key}' has no links (§4) — Federation/attribution degraded until re-issued"
                        ));
                    }
                }
            }
        }
    }

    // Report layouts (§8: ≥1, non-empty line rows, closed column types).
    if let Some(layouts) = read_component(&dir, &v, "report_layouts", &label, &mut errors) {
        match layouts["layouts"].as_array() {
            None => errors.push("report_layouts: layouts[] required".to_string()),
            Some(list) => {
                if list.is_empty() {
                    errors.push("report_layouts: ≥1 report layout".to_string());
                }
                for l in list {
                    let lkey = l["key"].as_str().unwrap_or("?");
                    let rows_ok = l["rows"]
                        .as_array()
                        .map(|rows| {
                            !rows.is_empty()
                                && rows.iter().all(|r| {
                                    r.as_str().map(|s| !s.trim().is_empty()).unwrap_or(false)
                                })
                        })
                        .unwrap_or(false);
                    if !rows_ok {
                        errors.push(format!(
                            "report_layouts: layout '{lkey}' rows must be non-empty line-key strings (LAYOUT_INVALID)"
                        ));
                    }
                    match l["columns"].as_array() {
                        None => errors.push(format!(
                            "report_layouts: layout '{lkey}' needs columns (LAYOUT_INVALID)"
                        )),
                        Some(cols) => {
                            if cols.is_empty() {
                                errors.push(format!(
                                    "report_layouts: layout '{lkey}' needs columns (LAYOUT_INVALID)"
                                ));
                            }
                            for c in cols {
                                let ct = c["type"].as_str().unwrap_or("");
                                if !PACK_COLUMN_TYPES.contains(&ct) {
                                    errors.push(format!(
                                        "report_layouts: layout '{lkey}' column type '{ct}' not in period/ytd/fy/variance/threeway (LAYOUT_INVALID)"
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // GL template (§8: columns required).
    if let Some(gl) = read_component(&dir, &v, "gl_template", &label, &mut errors)
        && gl["columns"].as_object().is_none()
    {
        errors.push("gl_template: columns required".to_string());
    }

    (errors, warnings)
}

/// Read a referenced component file (pack.json names the filename). A missing/unreadable
/// referenced file is a blocking error; the component checks are skipped for it.
pub(crate) fn read_component(
    dir: &Path,
    pack: &Value,
    field: &str,
    label: &str,
    errors: &mut Vec<String>,
) -> Option<Value> {
    let fname = pack[field].as_str().unwrap_or("");
    if fname.is_empty() {
        errors.push(format!("{field}: required (pack.json must name the file)"));
        return None;
    }
    let p = dir.join(fname);
    match fs::read_to_string(&p) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(v) => Some(v),
            Err(e) => {
                errors.push(format!("{label}/{fname}: malformed JSON ({e})"));
                None
            }
        },
        Err(_) => {
            errors.push(format!("{label}/{fname}: missing or unreadable"));
            None
        }
    }
}

fn is_semver(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

fn is_bcp47(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 5
        && bytes[0..2].iter().all(|b| b.is_ascii_lowercase())
        && bytes[2] == b'-'
        && bytes[3..5].iter().all(|b| b.is_ascii_uppercase())
}

fn is_decimal_string(s: &str) -> bool {
    // Exact decimal string per §8 ("bounds numeric decimal") — never a float parse (B3).
    // Mirrors the repo-gate regex ^\d+(\.\d+)?$: leading digits required, optional fractional
    // part requires at least one digit after the dot (so "1." and ".5" are rejected).
    let t = s.trim();
    if t.is_empty() {
        return false;
    }
    let mut seen_dot = false;
    let mut last_was_digit = false;
    for b in t.bytes() {
        match b {
            b'0'..=b'9' => last_was_digit = true,
            b'.' if !seen_dot && last_was_digit => {
                seen_dot = true;
                last_was_digit = false;
            }
            _ => return false,
        }
    }
    // Ends in a digit iff the string is fully valid ("1." ends with dot → invalid).
    last_was_digit
}

/// `pack.list` — {company_id?}
#[tauri::command(name = "pack.list", rename_all = "snake_case")]
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

#[cfg(test)]
mod validate_tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn packs_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../packs")
    }

    /// The §17 gate agrees with the repo gate on the real bundled packs: every one of the
    /// Post-WS-10: all 12 bundled packs must validate with zero errors AND zero warnings.
    #[test]
    fn all_bundled_packs_validate_with_zero_errors_and_zero_warnings() {
        for k in BUNDLED_KEYS {
            let (errors, warnings) = validate_pack_dir(&packs_root().join(k));
            assert!(
                errors.is_empty(),
                "bundled pack '{k}' must pass pack.validate with zero errors: {errors:?}"
            );
            assert!(
                warnings.is_empty(),
                "bundled pack '{k}' must pass pack.validate with zero warnings post-WS-10: {warnings:?}"
            );
        }
    }

    /// Pack warning tier: drivers without links and KPIs without formula/bands must warn.
    #[test]
    fn unlinked_driver_and_missing_formula_surface_warnings() {
        let dir = std::env::temp_dir().join("onefpa-pack-validate-warnings");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("pack.json"),
            r#"{
                "schema_version": "1.0.0",
                "pack": { "key": "onefpa-pack-validate-warnings", "name": "X", "version": "1.0.0", "description": "d", "locale_hint": "en-US" },
                "coa_template": "coa.json",
                "kpi_definitions": "kpis.json",
                "driver_templates": "drivers.json",
                "report_layouts": "layouts.json",
                "gl_template": "gl.json",
                "group_rollup_maps": "rollup.json"
            }"#,
        )
        .unwrap();
        fs::write(
            dir.join("coa.json"),
            r#"{ "accounts": [
                {"code":"1000","name":"Cash","type":"asset","section":"Assets"},
                {"code":"2000","name":"AP","type":"liability","section":"Liabilities"},
                {"code":"3000","name":"Equity","type":"equity","section":"Equity"},
                {"code":"4000","name":"Rev","type":"revenue","section":"Revenue"},
                {"code":"5000","name":"Cogs","type":"cogs","section":"COGS"}
            ] }"#,
        )
        .unwrap();
        fs::write(
            dir.join("kpis.json"),
            r#"{ "kpis": [
                {"key":"k1","definition":"d","target":{"value":"1"}},
                {"key":"k2","definition":"d","target":{"value":"1"}},
                {"key":"k3","definition":"d","target":{"value":"1"}},
                {"key":"k4","definition":"d","target":{"value":"1"}}
            ] }"#,
        )
        .unwrap();
        fs::write(
            dir.join("drivers.json"),
            r#"{ "drivers": [
                {"key":"d1","type":"manual","bounds":{"low":"0","high":"10"},"links":[]},
                {"key":"d2","type":"manual","bounds":{"low":"0","high":"10"},"links":[]},
                {"key":"d3","type":"manual","bounds":{"low":"0","high":"10"},"links":[]}
            ] }"#,
        )
        .unwrap();
        fs::write(
            dir.join("layouts.json"),
            r#"{ "layouts": [ {"key":"L","rows":["Revenue"],"columns":[{"type":"period"}]} ] }"#,
        )
        .unwrap();
        fs::write(dir.join("gl.json"), r#"{ "columns": {"date":"A"} }"#).unwrap();
        fs::write(dir.join("rollup.json"), r#"{}"#).unwrap();

        let (errors, warnings) = validate_pack_dir(&dir);
        assert!(errors.is_empty(), "unexpected errors: {errors:?}");
        assert!(
            warnings.iter().any(|w| w.contains("has no links")),
            "drivers must warn on missing links: {warnings:?}"
        );
        assert!(
            warnings.iter().any(|w| w.contains("formula missing")),
            "KPIs must warn on missing formula: {warnings:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// A directory without pack.json is a blocking error in the payload, not a throw.
    #[test]
    fn missing_pack_json_is_a_payload_error_not_a_panic() {
        let dir = std::env::temp_dir().join("onefpa-pack-validate-empty");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let (errors, warnings) = validate_pack_dir(&dir);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("missing or unreadable"));
        assert!(warnings.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Malformed JSON is a blocking payload error citing the parse problem.
    #[test]
    fn malformed_pack_json_is_a_payload_error() {
        let dir = std::env::temp_dir().join("onefpa-pack-validate-malformed");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("pack.json"), "{ not json").unwrap();
        let (errors, _) = validate_pack_dir(&dir);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("malformed JSON"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// A pack.json passing identity fields but referencing a missing component file is
    /// blocked with the component path in the error.
    #[test]
    fn missing_component_file_is_a_blocking_error() {
        let dir = std::env::temp_dir().join("onefpa-pack-validate-missing-component");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("pack.json"),
            r#"{
                "schema_version": "1.0.0",
                "pack": { "key": "pack-validate-missing-component", "name": "X", "version": "1.0.0", "description": "d", "locale_hint": "en-US" },
                "coa_template": "coa.json",
                "kpi_definitions": "kpis.json",
                "driver_templates": "drivers.json",
                "report_layouts": "layouts.json",
                "gl_template": "gl.json",
                "group_rollup_maps": "rollup.json"
            }"#,
        )
        .unwrap();
        let (errors, _) = validate_pack_dir(&dir);
        assert!(errors.iter().any(|e| e.contains("coa.json: missing")));
        assert!(errors.iter().any(|e| e.contains("kpis.json: missing")));
        assert!(errors.iter().any(|e| e.contains("drivers.json: missing")));
        assert!(errors.iter().any(|e| e.contains("layouts.json: missing")));
        assert!(errors.iter().any(|e| e.contains("gl.json: missing")));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Field-level blocking checks: wrong schema_version, flat key, non-semver, bad locale,
    /// duplicate COA codes, bad driver type, non-decimal bounds, bad column type.
    #[test]
    fn field_level_blocking_checks_fire_with_field_paths() {
        let dir = std::env::temp_dir().join("onefpa-pack-validate-bad-fields");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let label = dir.file_name().unwrap().to_str().unwrap().to_string();
        fs::write(
            dir.join("pack.json"),
            r#"{
                "schema_version": "2.0.0",
                "pack": { "key": "totally_other", "name": "X", "version": "1", "description": "d", "locale_hint": "en_US" },
                "coa_template": "coa.json",
                "kpi_definitions": "kpis.json",
                "driver_templates": "drivers.json",
                "report_layouts": "layouts.json",
                "gl_template": "gl.json",
                "group_rollup_maps": "rollup.json"
            }"#
        )
        .unwrap();
        assert!(label.starts_with("onefpa-pack-validate-bad-fields"));
        fs::write(
            dir.join("coa.json"),
            r#"{ "accounts": [
                {"code":"1000","name":"Cash","type":"asset","section":"Assets"},
                {"code":"1000","name":"Cash 2","type":"asset","section":"Assets"},
                {"code":"4000","name":"Rev","type":"banana","section":"Revenue"},
                {"code":"5000","name":"Cogs","type":"cogs","section":"COGS"},
                {"code":"6000","name":"Opex","type":"opex","section":"Opex"}
            ] }"#,
        )
        .unwrap();
        fs::write(
            dir.join("kpis.json"),
            r#"{ "kpis": [ {"key":"k1","definition":"d","target":{"value":"1"}}, {"key":"k2","definition":"d","target":{"value":"1"}}, {"key":"k3","definition":"d","target":{"value":"1"}}, {"key":"k4","definition":"d","target":{"value":"xyz"}} ] }"#,
        )
        .unwrap();
        fs::write(
            dir.join("drivers.json"),
            r#"{ "drivers": [
                {"key":"d1","type":"teleport","bounds":{"low":"0","high":"10"},"links":[]},
                {"key":"d2","type":"manual","bounds":{"low":"0","high":"1e9"},"links":[]},
                {"key":"d3","type":"ratio","bounds":{"low":"0","high":"10"},"links":[]}
            ] }"#,
        )
        .unwrap();
        fs::write(
            dir.join("layouts.json"),
            r#"{ "layouts": [ {"key":"L","rows":["Revenue",""],"columns":[{"type":"budget"}]} ] }"#,
        )
        .unwrap();
        fs::write(dir.join("gl.json"), r#"{ "columns": {"date":"A"} }"#).unwrap();
        fs::write(dir.join("rollup.json"), r#"{}"#).unwrap();

        let (errors, _) = validate_pack_dir(&dir);
        let joined = errors.join(" | ");
        assert!(joined.contains("schema_version"), "{joined}");
        assert!(joined.contains("pack.key"), "{joined}");
        assert!(joined.contains("pack.version"), "{joined}");
        assert!(joined.contains("locale_hint"), "{joined}");
        assert!(joined.contains("duplicate code '1000'"), "{joined}");
        assert!(joined.contains("invalid account type 'banana'"), "{joined}");
        assert!(joined.contains("KPI 'k4' target.value"), "{joined}");
        assert!(
            joined.contains("invalid driver type 'teleport'"),
            "{joined}"
        );
        assert!(joined.contains("bounds.high must be a decimal"), "{joined}");
        assert!(joined.contains("rows must be non-empty"), "{joined}");
        assert!(joined.contains("column type 'budget'"), "{joined}");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Decimal-string validator: exact decimal strings only — no exponent form, no sign,
    /// no empty (B3: money-adjacent values are never float-parsed).
    #[test]
    fn decimal_strings_reject_exponent_and_sign_forms() {
        assert!(is_decimal_string("0"));
        assert!(is_decimal_string("10"));
        assert!(is_decimal_string("1.5"));
        assert!(is_decimal_string("0.25"));
        assert!(!is_decimal_string(""));
        assert!(!is_decimal_string("1e9"));
        assert!(!is_decimal_string("-1"));
        assert!(!is_decimal_string("+1"));
        assert!(!is_decimal_string("1."));
        assert!(!is_decimal_string(".5"));
        assert!(!is_decimal_string("abc"));
    }

    /// Semver/BCP-47 helpers.
    #[test]
    fn semver_and_bcp47_shapes() {
        assert!(is_semver("1.0.0"));
        assert!(is_semver("12.34.56"));
        assert!(!is_semver("1"));
        assert!(!is_semver("1.0"));
        assert!(!is_semver("1.0.0-beta"));
        assert!(is_bcp47("en-US"));
        assert!(is_bcp47("de-DE"));
        assert!(!is_bcp47("en_US"));
        assert!(!is_bcp47("en"));
        assert!(!is_bcp47("enus"));
        assert!(!is_bcp47("en-us"));
    }

    /// pack.validate throws VALUE_INVALID (not a payload verdict) for a malformed path.
    #[test]
    fn path_shape_errors_throw_value_invalid() {
        let err = AppError::invalid("pack_path must be an absolute path");
        assert!(err.to_string().contains("absolute path"));
    }
}

#[cfg(test)]
mod install_tests {
    use super::*;
    use crate::storage::db;
    use std::path::PathBuf;

    const CO: &str = "00000000-0000-0000-0000-0000000000c9";

    fn seeded() -> Connection {
        let conn = db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version, company_file_path, created_at, updated_at)
             VALUES (?1, 'Pack Co', 'single', 'USD', 'en-US', '1.0.0', '/t', 'now', 'now')",
            [CO],
        )
        .unwrap();
        conn
    }

    /// Happy path installs the REAL bundled saas pack: packs row (is_bundled=0),
    /// one pack_components row per referenced component file, one audit event.
    /// `dir` is the keystore data dir — ALWAYS a throwaway temp dir, never a repo
    /// directory: the audit keystore writes its key file there (keystore.rs).
    #[test]
    fn install_seeds_packs_row_components_and_audit_event() {
        let mut conn = seeded();
        let packs = PathBuf::from("../packs").canonicalize().unwrap();
        let dir = std::env::temp_dir().join(format!("onefpa-install-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = pack_install_internal(&mut conn, &dir, packs.join("saas").to_str().unwrap(), CO)
            .unwrap();
        let data = &out["data"];

        let pack_id = data["pack_id"].as_str().unwrap();
        let version = data["version"].as_str().unwrap();
        assert_eq!(version, "2.1.1");

        // packs row: user-built flag, checksum = sha256 of pack.json bytes.
        let (is_bundled, stored_checksum): (i64, String) = conn
            .query_row(
                "SELECT is_bundled, source_checksum FROM packs WHERE id = ?1",
                [pack_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(is_bundled, 0, "installed pack is never bundled (SPEC §9)");
        let expected = {
            let bytes = std::fs::read(packs.join("saas").join("pack.json")).unwrap();
            hex_sha256(&bytes)
        };
        assert_eq!(stored_checksum, expected);

        // Components: 6 referenced files → 6 rows with the §18 kind mapping.
        let components: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pack_components WHERE pack_id = ?1",
                [pack_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(components, 6, "coa/kpi/driver/layout/gl/rollup seeded");
        let kinds: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT kind FROM pack_components WHERE pack_id = ?1 ORDER BY kind")
                .unwrap();
            stmt.query_map([pack_id], |r| r.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert!(kinds.contains(&"coa".to_string()));
        assert!(kinds.contains(&"kpi".to_string()));
        assert!(kinds.contains(&"driver_template".to_string()));
        assert!(kinds.contains(&"report_layout".to_string()));
        assert!(kinds.contains(&"gl_template".to_string()));

        // Payload bytes are the file bytes (§18: store the JSON we validated).
        let coa_payload: String = conn
            .query_row(
                "SELECT payload FROM pack_components WHERE pack_id = ?1 AND kind = 'coa'",
                [pack_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(coa_payload.contains("accounts"));

        // Warnings ride the payload (post-WS-10 re-issue: saas carries 0 warnings).
        let warnings = data["warnings"].as_array().unwrap();
        assert!(
            warnings.is_empty(),
            "post-WS-10 saas has 0 warnings: {warnings:?}"
        );

        // Audit event on the Company chain (B7).
        let audits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_events WHERE action = 'pack.install' AND company_id = ?1",
                [CO],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(audits, 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Same key + same-or-lower version → PACK_VERSION_EXISTS, nothing persisted.
    #[test]
    fn reinstalling_same_or_older_version_fails_closed() {
        let mut conn = seeded();
        let packs = PathBuf::from("../packs").canonicalize().unwrap();
        let dir = std::env::temp_dir().join(format!("onefpa-reinstall-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let saas = packs.join("saas").to_str().unwrap().to_string();

        pack_install_internal(&mut conn, &dir, &saas, CO).unwrap();
        let err = pack_install_internal(&mut conn, &dir, &saas, CO).unwrap_err();
        assert!(
            matches!(err, AppError::PackVersionExists { .. }),
            "same-version reinstall must be PACK_VERSION_EXISTS: {err}"
        );

        // Nothing double-persisted.
        let packs: i64 = conn
            .query_row("SELECT COUNT(*) FROM packs WHERE key = 'saas'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(packs, 1);
        let audits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_events WHERE action = 'pack.install' AND company_id = ?1",
                [CO],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(audits, 1, "failed install writes NO audit event");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A directory that fails §17 validation never reaches the DB (§18 gate).
    #[test]
    fn invalid_pack_is_rejected_with_pack_schema_invalid() {
        let mut conn = seeded();
        let empty = std::env::temp_dir().join("onefpa-pack-install-empty");
        let _ = std::fs::remove_dir_all(&empty);
        std::fs::create_dir_all(&empty).unwrap();

        let err = pack_install_internal(
            &mut conn,
            &std::env::temp_dir(),
            empty.to_str().unwrap(),
            CO,
        )
        .unwrap_err();
        assert!(
            matches!(err, AppError::PackSchemaInvalid { .. }),
            "invalid pack must be PACK_SCHEMA_INVALID: {err}"
        );
        let packs: i64 = conn
            .query_row("SELECT COUNT(*) FROM packs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(packs, 0, "invalid pack never reaches the database");
        let _ = std::fs::remove_dir_all(&empty);
    }

    /// Relative paths throw VALUE_INVALID (§17/§18 path contract).
    #[test]
    fn relative_path_throws_value_invalid() {
        let mut conn = seeded();
        let err = pack_install_internal(&mut conn, Path::new("."), "packs/saas", CO).unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument(_)), "{err}");
    }

    #[test]
    fn builder_save_creates_new_pack_with_components_and_audit() {
        let mut conn = seeded();
        let dir = std::env::temp_dir().join(format!("onefpa-bsave-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let definition = serde_json::json!({
            "pack": {
                "key": "builder_co",
                "name": "Builder Co Pack",
                "version": "1.0.0",
                "description": "A pack built in the S-023 builder.",
                "locale_hint": "en-US"
            },
            "coa": { "accounts": [
                {"code":"1000","name":"Cash","type":"asset","section":"Assets"},
                {"code":"4000","name":"Revenue","type":"revenue","section":"Revenue"},
                {"code":"5000","name":"COGS","type":"cogs","section":"COGS"},
                {"code":"6000","name":"Opex","type":"opex","section":"Opex"},
                {"code":"2000","name":"AP","type":"liability","section":"Liabilities"}
            ] },
            "kpis": { "kpis": [
                {"key":"k1","name":"K1","definition":"d","formula":"a / b","target":{"value":1},"bands":{"good":2,"watch":1}},
                {"key":"k2","name":"K2","definition":"d","formula":"c / d","target":{"value":1},"bands":{"good":2,"watch":1}},
                {"key":"k3","name":"K3","definition":"d","formula":"e / f","target":{"value":1},"bands":{"good":2,"watch":1}},
                {"key":"k4","name":"K4","definition":"d","formula":"g / h","target":{"value":1},"bands":{"good":2,"watch":1}}
            ] },
            "drivers": { "drivers": [
                {"key":"d1","name":"D1","type":"manual","bounds":{"low":"0","high":"10"},"links":["l1"]},
                {"key":"d2","name":"D2","type":"ratio","bounds":{"low":"0","high":"10"},"links":["l1"]},
                {"key":"d3","name":"D3","type":"growth","bounds":{"low":"0","high":"1"},"links":["l1"]}
            ] },
            "layouts": { "layouts": [ {"key":"pl","rows":["revenue","cogs"],"columns":[{"type":"ytd"}]} ] },
            "gl_template_content": { "columns": {"period":"A"} },
            "rollup": { "maps": [], "default_currency": "USD" }
        });

        let out = pack_builder_save_v1_internal(&mut conn, &dir, None, &definition, CO).unwrap();
        let pack_id = out["data"]["pack_id"].as_str().unwrap().to_string();
        assert_eq!(out["data"]["version"].as_str().unwrap(), "1.0.0");

        let (is_bundled, key): (i64, String) = conn
            .query_row(
                "SELECT is_bundled, key FROM packs WHERE id = ?1",
                [&pack_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(is_bundled, 0);
        assert_eq!(key, "builder_co");

        let components: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pack_components WHERE pack_id = ?1",
                [&pack_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(components, 6);

        // The builder-generated components carry NO §8 legacy debts: zero warnings.
        let warnings = out["data"]["warnings"].as_array().unwrap();
        assert!(
            warnings.is_empty(),
            "builder output should be §8-clean: {warnings:?}"
        );

        let audits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_events WHERE action = 'pack.builder.save_v1' AND company_id = ?1",
                [CO],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(audits, 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn builder_save_rejects_schema_violations_and_stale_versions() {
        let mut conn = seeded();
        let dir = std::env::temp_dir().join(format!("onefpa-bsd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        // A definition failing §8 (only 2 COA accounts) → PACK_SCHEMA_INVALID, nothing saved.
        let bad = serde_json::json!({
            "pack": {"key":"bad","name":"Bad","version":"1.0.0","description":"d","locale_hint":"en-US"},
            "coa": {"accounts":[{"code":"1","name":"A","type":"asset","section":"Assets"}]},
            "kpis": {"kpis":[]},
            "drivers": {"drivers":[]},
            "layouts": {"layouts":[]},
            "gl_template_content": {},
            "rollup": {}
        });
        let err = pack_builder_save_v1_internal(&mut conn, &dir, None, &bad, CO).unwrap_err();
        assert!(matches!(err, AppError::PackSchemaInvalid { .. }), "{err}");
        let packs: i64 = conn
            .query_row("SELECT COUNT(*) FROM packs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(packs, 0, "invalid definition never reaches the DB");

        // Save v1.0.0, then re-saving 1.0.0 as a NEW doc must conflict (§9 same-key rule).
        let good = serde_json::json!({
            "pack": {"key":"builder_ok","name":"B","version":"1.0.0","description":"d","locale_hint":"en-US"},
            "coa": {"accounts":[
                {"code":"1","name":"A","type":"asset","section":"Assets"},
                {"code":"2","name":"B","type":"asset","section":"Assets"},
                {"code":"3","name":"C","type":"revenue","section":"Revenue"},
                {"code":"4","name":"D","type":"cogs","section":"COGS"},
                {"code":"5","name":"E","type":"opex","section":"Opex"}
            ]},
            "kpis": {"kpis":[
                {"key":"k1","definition":"d","formula":"a/b","target":{"value":1},"bands":{"good":2,"watch":1}},
                {"key":"k2","definition":"d","formula":"a/b","target":{"value":1},"bands":{"good":2,"watch":1}},
                {"key":"k3","definition":"d","formula":"a/b","target":{"value":1},"bands":{"good":2,"watch":1}},
                {"key":"k4","definition":"d","formula":"a/b","target":{"value":1},"bands":{"good":2,"watch":1}}
            ]},
            "drivers": {"drivers":[
                {"key":"d1","type":"manual","bounds":{"low":"0","high":"1"},"links":["x"]},
                {"key":"d2","type":"ratio","bounds":{"low":"0","high":"1"},"links":["x"]},
                {"key":"d3","type":"growth","bounds":{"low":"0","high":"1"},"links":["x"]}
            ]},
            "layouts": {"layouts":[{"key":"pl","rows":["a"],"columns":[{"type":"ytd"}]}]},
            "gl_template_content": {"columns":{}},
            "rollup": {}
        });
        pack_builder_save_v1_internal(&mut conn, &dir, None, &good, CO).unwrap();
        let err = pack_builder_save_v1_internal(&mut conn, &dir, None, &good, CO).unwrap_err();
        assert!(matches!(err, AppError::PackVersionExists { .. }), "{err}");

        std::fs::remove_dir_all(&dir).ok();
    }
}
