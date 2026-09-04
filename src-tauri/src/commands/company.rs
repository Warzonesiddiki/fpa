//! company.list / company.create / company.open / company.delete (F-001 Company Manager).
//! Company records live in the app DB; each Company's data lives in an encrypted `.fpa`
//! container (`storage::container`, SECURITY-CHECKLIST A02) whose key is wrapped by the
//! PIN-derived vault key. The id/path contract across IPC is unchanged.

use chrono::{DateTime, Datelike, Utc};
use rusqlite::OptionalExtension;
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri::Manager;
use tauri::State;
use uuid::Uuid;

use crate::core::audit::{GENESIS_HASH, next_hash};
use crate::core::calendar::{CalendarPreset, WeekRule, build_12month, build_week_based};
use crate::core::error::{AppError, AppResult};
use crate::storage::container;
use crate::storage::db;
use crate::storage::keys::{self, KeyVault};
use crate::storage::keystore;

/// Retention window for `company.delete` (ERROR-HANDLING `COMPANY_IN_USE_RECENT`): a Company
/// used within the last 30 days cannot be deleted — no silent loss of recent work (F-001).
pub const COMPANY_RECENT_WINDOW_DAYS: i64 = 30;

pub fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::internal(format!("APP_DATA_DIR: {e}")))
}

/// `company.list` — CompanyMeta[] (last_opened_at = last activity: create/open/unlock).
#[tauri::command(name = "company.list", rename_all = "camelCase")]
pub fn company_list(app: AppHandle) -> AppResult<serde_json::Value> {
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.type, c.default_currency_code, c.base_locale, c.updated_at,
                    c.company_file_path,
                    COALESCE((SELECT l.status FROM licenses l WHERE l.licensed_company_hash = c.id), 'invalid')
             FROM companies c ORDER BY c.updated_at DESC",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "type": r.get::<_, String>(2)?,
                "default_currency_code": r.get::<_, String>(3)?,
                "base_locale": r.get::<_, String>(4)?,
                "last_opened_at": r.get::<_, String>(5)?,
                "company_file_path": r.get::<_, String>(6)?,
                "license_status": r.get::<_, String>(7)?,
            }))
        })
        .map_err(AppError::from)?;
    let rows = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    Ok(serde_json::json!({ "data": rows }))
}

fn horizon_years(horizon: &str) -> u32 {
    match horizon {
        "13w" => 1,
        "3y" => 3,
        "5y" => 5,
        _ => 1,
    }
}

fn parse_preset(preset: &str) -> Result<CalendarPreset, AppError> {
    match preset {
        "454" => Ok(CalendarPreset::Nrf454),
        "445" => Ok(CalendarPreset::Nrf445),
        "544" => Ok(CalendarPreset::Nrf544),
        "3334" => Ok(CalendarPreset::ThreeThreeThreeFour),
        other => Err(AppError::invalid(format!("CAL_PRESET_UNKNOWN: {other}"))),
    }
}

/// Calendar config (mirrors the schema's `calendar` object; camelCase across IPC).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarConfig {
    pub preset: String,
    pub fy_start_month: Option<u32>,
    pub week_start_day: Option<u32>,
    pub anchor_rule: Option<String>,
    pub year_end_rule: Option<String>,
}

/// Shared calendar persistence (F-003 engine = single owner, B14): inserts the company's
/// 'Default' fiscal calendar + generated years/periods inside the caller's transaction.
/// Used by `company.create` and `calendar.apply` (which replaces the Default calendar).
pub(crate) fn write_calendar(
    tx: &rusqlite::Transaction<'_>,
    company_id: &str,
    cal_id: &str,
    calendar: &CalendarConfig,
    horizon: &str,
) -> AppResult<()> {
    let preset = calendar.preset.as_str();
    if preset != "12month" {
        parse_preset(preset)?;
    }
    let year_end_rule_val = calendar.year_end_rule.clone().unwrap_or_else(|| {
        if preset == "454" {
            "nrf_4_day".into()
        } else {
            "full_week".into()
        }
    });
    if year_end_rule_val == "nrf_4_day" && preset != "454" {
        return Err(AppError::cal_53week_conflict());
    }
    if preset != "12month" && calendar.week_start_day.unwrap_or(0) != 0 {
        return Err(AppError::invalid(
            "WEEK_START_MUST_BE_SUNDAY for the NRF family (F-003)",
        ));
    }

    tx.execute(
        "INSERT INTO fiscal_calendars (id, company_id, name, preset, fy_start_month, week_start_day,
                                       anchor_rule, year_end_rule, tz)
         VALUES (?1, ?2, 'Default', ?3, ?4, ?5, ?6, ?7, 'UTC')",
        rusqlite::params![
            cal_id,
            company_id,
            preset,
            calendar.fy_start_month,
            calendar.week_start_day.unwrap_or(0) as i64,
            calendar.anchor_rule.clone().unwrap_or_else(|| "sunday_near_feb_1".into()),
            year_end_rule_val,
        ],
    )
    .map_err(AppError::from)?;

    let now_year = Utc::now().year();
    let years = match preset {
        "12month" => build_12month(
            now_year,
            calendar.fy_start_month.unwrap_or(1).clamp(1, 12),
            horizon_years(horizon),
        ),
        _ => build_week_based(
            parse_preset(preset)?,
            crate::core::calendar::sunday_nearest(
                chrono::NaiveDate::from_ymd_opt(now_year, 2, 1).unwrap(),
            ),
            horizon_years(horizon),
            if year_end_rule_val == "nrf_4_day" {
                WeekRule::NrfFourDay
            } else {
                WeekRule::FullWeek
            },
        ),
    };
    for y in &years {
        let fy_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO fiscal_years (id, calendar_id, fy_label, start_date, end_date, week_count, is_leap_fiscal)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![fy_id, cal_id, y.fy_label, y.start_date, y.end_date, y.week_count as i64],
        )
        .map_err(AppError::from)?;
        for p in &y.periods {
            tx.execute(
                "INSERT INTO fiscal_periods (id, fiscal_year_id, period_no, code, start_date, end_date, is_53rd_week)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    fy_id,
                    p.period_no as i64,
                    p.code,
                    p.start_date,
                    p.end_date,
                    p.is_53rd_week as i64
                ],
            )
            .map_err(AppError::from)?;
        }
    }
    Ok(())
}

/// Bootstrap the first planning Model for a new Company. Model ids are generated per Company
/// (the frontend must never reuse the documented example UUID across files); the default Scenario
/// gives locked-baseline reference checks a real ownership anchor from the first persisted write.
fn create_default_model(
    tx: &rusqlite::Transaction<'_>,
    company_id: &str,
    company_name: &str,
    horizon: &str,
    pack_id: &str,
) -> AppResult<String> {
    let model_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO models (id, company_id, name, horizon, status, current_scenario_id, pack_id)
         VALUES (?1, ?2, ?3, ?4, 'active', NULL, ?5)",
        rusqlite::params![
            model_id,
            company_id,
            format!("{} Model", company_name.trim()),
            horizon,
            pack_id
        ],
    )
    .map_err(AppError::from)?;

    let scenario_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO scenarios (id, model_id, name, kind, state, parent_scenario_id, baseline)
         VALUES (?1, ?2, 'Base', 'budget', 'draft', NULL, 1)",
        rusqlite::params![scenario_id, model_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "UPDATE models SET current_scenario_id = ?1 WHERE id = ?2",
        rusqlite::params![scenario_id, model_id],
    )
    .map_err(AppError::from)?;
    Ok(model_id)
}

/// `company.create` — {name, path, pack_key, calendar{...}, plan_only?, horizon?}
/// Seals a fresh `.fpa` container at `path`: random 256-bit Company key, wrapped by the
/// PIN-derived vault key (AUTH-SPEC §2.1). Requires an unlocked vault (API-SPEC: session).
#[tauri::command(name = "company.create", rename_all = "camelCase")]
pub fn company_create(
    app: AppHandle,
    name: String,
    path: String,
    pack_key: String,
    calendar: CalendarConfig,
    horizon: Option<String>,
    vault: State<'_, KeyVault>,
) -> AppResult<serde_json::Value> {
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    // First-run gate (F-004): `security.pin_setup` must have registered the PIN before a
    // Company can exist (AUTH-SPEC §2.1 — setup precedes company.create).
    let pin_set: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pin_metadata WHERE id = 'default')",
            [],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if !pin_set {
        return Err(AppError::invalid(
            "PIN_NOT_SET: run security.pin_setup before creating a Company",
        ));
    }

    // Pack must be registered first (bundled seed on first run).
    crate::commands::pack::seed_bundled_packs(&app, &conn)?;
    let pack_key_clean = pack_key.trim().to_lowercase();
    let pack_id: Option<String> = conn
        .query_row(
            "SELECT id FROM packs WHERE key = ?1",
            [&pack_key_clean],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    let Some(pack_id) = pack_id else {
        return Err(AppError::invalid(format!(
            "PACK_SCHEMA_INVALID: unknown pack_key '{pack_key_clean}'"
        )));
    };

    let now = Utc::now().to_rfc3339();
    let company_id = Uuid::new_v4().to_string();
    let company_file_path = Path::new(&path)
        .canonicalize()
        .unwrap_or_else(|_| Path::new(&path).to_path_buf());
    let company_file_path = company_file_path.to_string_lossy().to_string();

    // Never overwrite an existing Company file (ERROR-HANDLING STORAGE_FILE_EXISTS).
    if Path::new(&company_file_path).exists() {
        return Err(AppError::file_exists());
    }
    // The vault key is only present between unlock and lock (AUTH-SPEC §2.2/§2.3): a locked
    // app cannot mint a Company key, so `company.create` fails closed with SESSION_LOCKED.
    let mut vault_key = vault.get()?;

    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version,
                                company_file_path, created_at, updated_at)
         VALUES (?1, ?2, 'single', 'USD', 'en-IN', '1.0.0', ?3, ?4, ?4)",
        rusqlite::params![company_id, name.trim(), company_file_path, now],
    )
    .map_err(AppError::from)?;

    let horizon = horizon.as_deref().unwrap_or("1y");
    let cal_id = Uuid::new_v4().to_string();
    write_calendar(&tx, &company_id, &cal_id, &calendar, horizon)?;
    let model_id = create_default_model(&tx, &company_id, &name, horizon, &pack_id)?;

    // Audit event (HMAC chain; key from keychain — never the DB).
    // Chain payload = the stored `after_json` bytes → tamper detection is exact (audit.rs).
    let after_json = serde_json::json!({
        "name": name,
        "pack": pack_key_clean,
        "model_id": model_id.clone()
    })
    .to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                   prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'company.create', 'company', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, company_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    // Seal the encrypted container LAST, still inside the transaction: if the image cannot be
    // built or sealed the transaction rolls back, so there is never a Company row without its
    // `.fpa` file (nor a sealed file without its Company).
    let mut cek = container::create_key();
    let image = container::new_image(&dir, &company_id)?;
    container::seal(Path::new(&company_file_path), &image, &cek, &vault_key)?;
    keys::zeroize(&mut cek);

    tx.commit().map_err(AppError::from)?;
    keys::zeroize(&mut vault_key);

    Ok(serde_json::json!({ "data": { "company_id": company_id, "model_id": model_id } }))
}

/// `company.open` — {path}. Switches the active session Company (S-020 Open) and records the
/// activity timestamp used by the retention gate (`last_opened_at`).
#[tauri::command(name = "company.open", rename_all = "camelCase")]
pub fn company_open(
    app: AppHandle,
    path: String,
    state: tauri::State<'_, crate::commands::session::SessionState>,
    vault: State<'_, KeyVault>,
) -> AppResult<serde_json::Value> {
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;
    let row: Option<(String, String, String, String, String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT c.id, c.name, c.type, c.default_currency_code, c.base_locale, c.pack_schema_version,
                    c.company_file_path,
                    (SELECT m.id FROM models m WHERE m.company_id = c.id ORDER BY m.id LIMIT 1)
             FROM companies c WHERE c.company_file_path = ?1",
            [&path],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::from)?;
    let (company_id, name, ctype, currency, locale, pack_schema_version, stored_path, model_id) =
        row.ok_or_else(AppError::file_corrupt)?;

    // Authenticate the sealed container with the vault key held since unlock (A02). A Company
    // file brought from another installation — sealed under a different PIN — fails here with
    // STORAGE_DECRYPT_FAILED; a decrypted image that is not a SQLite database is FILE_CORRUPT.
    let mut vault_key = vault.get()?;
    let mut opened = container::open(Path::new(&stored_path), &vault_key)?;
    if !container::is_sqlite_image(&opened.image) {
        return Err(AppError::file_corrupt());
    }
    keys::zeroize(&mut opened.key);
    keys::zeroize(&mut vault_key);

    // AUTH-SPEC §2.5: switching the active Company re-runs the unlock-time chain check for it
    // (the read-only flag is per-Company and dies with the re-minted session).
    let chain_broken_at = verify_company_chain(&conn, &dir, &company_id)?;

    // Session switch (token re-minted per open — AUTH-SPEC §2).
    crate::commands::session::mint_session(
        &state,
        company_id.clone(),
        stored_path.clone(),
        chain_broken_at,
    )?;

    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE companies SET updated_at = ?1 WHERE id = ?2",
        [&now, &company_id],
    )
    .map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "company_id": company_id,
            "model_id": model_id,
            "read_only": chain_broken_at.is_some(),
            "integrity": {
                "audit_chain_ok": chain_broken_at.is_none(),
                "broken_at_seq": chain_broken_at,
            },
            "summary": {
                "name": name,
                "type": ctype,
                "default_currency_code": currency,
                "base_locale": locale,
                "pack_schema_version": pack_schema_version,
                "company_file_path": stored_path,
            }
        }
    }))
}

/// `company.clone_sandbox` — {company_id, name}. Copies the source Company's structural
/// definition — fiscal calendar + Fiscal Years + periods, business units, and the Chart of
/// Accounts — into a NEW Company with a freshly sealed `.fpa` container, so a what-if sandbox
/// can be built without touching the source (F-001 Clone as Sandbox; SCREENS-SPEC S-020).
///
/// The sandbox file path is derived from the source file's directory + `<sandbox name>.fpa`
/// (API-SPEC §2.1: `{company_id, name} → {company_id}`); a path that already holds a file is
/// `STORAGE_FILE_EXISTS`. GL lines, scenarios, model cells, and any Models beyond the source's
/// first are NOT copied at M1 — the sandbox starts from the source's structure and calendar and
/// the sandboxer imports its own data (TASKBOARD M1-5).
///
/// `ARCHIVE_IN_USE_REF` guard: cloning is blocked while the source references an archived
/// Fiscal Year. At M1 no Fiscal Year can be archived yet (`company.archive_year` lands with the
/// archive schema), so the guard is structurally present but vacuously satisfied.
#[tauri::command(name = "company.clone_sandbox", rename_all = "camelCase")]
pub fn company_clone_sandbox(
    app: AppHandle,
    company_id: String,
    name: String,
    vault: State<'_, KeyVault>,
) -> AppResult<serde_json::Value> {
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::invalid("Sandbox name is required"));
    }

    // Source Company must exist.
    let src: Option<(String, String, String, String, String, String)> = conn
        .query_row(
            "SELECT name, type, default_currency_code, base_locale, pack_schema_version, company_file_path
             FROM companies WHERE id = ?1",
            [&company_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::from)?;
    let (src_type, src_currency, src_locale, src_pack_schema_version, src_path) = src
        .map(|(_, ty, cu, lo, pv, path)| (ty, cu, lo, pv, path))
        .ok_or_else(|| AppError::invalid(format!("Source Company '{company_id}' not found")))?;

    // Company names are unique (companies.name UNIQUE) — a taken name is bad input.
    let name_taken: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM companies WHERE name = ?1)",
            [&name],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if name_taken {
        return Err(AppError::invalid(format!(
            "A Company named '{name}' already exists"
        )));
    }

    // Sandbox file path = the source file's directory + `<sandbox name>.fpa` (API-SPEC §2.1).
    let src_file = Path::new(&src_path);
    let parent = src_file.parent().unwrap_or_else(|| Path::new("."));
    let stem: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();
    let target_path = parent.join(format!("{stem}.fpa"));
    let target_path_str = target_path.to_string_lossy().to_string();
    if target_path.exists() {
        return Err(AppError::file_exists());
    }

    // The sandbox's default Model reuses the source's first Model horizon + pack.
    let src_model: Option<(String, String)> = conn
        .query_row(
            "SELECT horizon, pack_id FROM models WHERE company_id = ?1 ORDER BY id LIMIT 1",
            [&company_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?;
    let (src_horizon, src_pack_id) = src_model.ok_or_else(|| {
        AppError::internal(format!(
            "CLONE_NO_MODEL: source '{company_id}' has no Model to clone"
        ))
    })?;

    // The vault key is only present between unlock and lock (AUTH-SPEC §2.2/§2.3): a locked app
    // cannot mint a sandbox key, so a locked `company.clone_sandbox` fails closed (SESSION_LOCKED).
    let mut vault_key = vault.get()?;

    let now = Utc::now().to_rfc3339();
    let dst_id = Uuid::new_v4().to_string();
    let tx = conn.transaction().map_err(AppError::from)?;

    // Destination Company row (never overwrites the source).
    tx.execute(
        "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version,
                                company_file_path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        rusqlite::params![
            &dst_id, name, src_type, src_currency, src_locale, src_pack_schema_version, target_path_str, now
        ],
    )
    .map_err(AppError::from)?;

    // ── Copy the structural rows, remapping every id in FK-safe order ──────────────────
    use std::collections::HashMap;

    // 1. Fiscal calendars (id remap).
    let mut cal_map = HashMap::new();
    {
        let mut stmt = tx
            .prepare(
                "SELECT id, name, preset, fy_start_month, week_start_day, anchor_rule, year_end_rule, tz
                 FROM fiscal_calendars WHERE company_id = ?1",
            )
            .map_err(AppError::from)?;
        let rows = stmt
            .query_map([&company_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, String>(7)?,
                ))
            })
            .map_err(AppError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;
        for (old, cname, preset, fy_start_month, week_start_day, anchor_rule, year_end_rule, tz) in
            rows
        {
            let new_id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO fiscal_calendars (id, company_id, name, preset, fy_start_month, week_start_day,
                                               anchor_rule, year_end_rule, tz)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![new_id, &dst_id, &cname, &preset, fy_start_month, week_start_day, anchor_rule, year_end_rule, &tz],
            )
            .map_err(AppError::from)?;
            cal_map.insert(old, new_id);
        }
    }

    // 2. Fiscal years (calendar_id → new; id remap).
    let mut fy_map = HashMap::new();
    {
        let mut stmt = tx
            .prepare(
                "SELECT fy.id, fy.calendar_id, fy.fy_label, fy.start_date, fy.end_date, fy.week_count, fy.is_leap_fiscal
                 FROM fiscal_years fy JOIN fiscal_calendars fc ON fc.id = fy.calendar_id
                 WHERE fc.company_id = ?1",
            )
            .map_err(AppError::from)?;
        let rows = stmt
            .query_map([&company_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            })
            .map_err(AppError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;
        for (old, cal_id, fy_label, start_date, end_date, week_count, is_leap_fiscal) in rows {
            let new_id = Uuid::new_v4().to_string();
            let new_cal = cal_map.get(&cal_id).cloned().ok_or_else(|| {
                AppError::internal(format!("CLONE_CAL_REMAP: missing calendar {cal_id}"))
            })?;
            tx.execute(
                "INSERT INTO fiscal_years (id, calendar_id, fy_label, start_date, end_date, week_count, is_leap_fiscal)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![new_id, new_cal, &fy_label, &start_date, &end_date, week_count, is_leap_fiscal],
            )
            .map_err(AppError::from)?;
            fy_map.insert(old, new_id);
        }
    }

    // 3. Fiscal periods (fiscal_year_id → new; ids remapped, not referenced elsewhere here).
    {
        let mut stmt = tx
            .prepare(
                "SELECT fp.id, fp.fiscal_year_id, fp.period_no, fp.code, fp.start_date, fp.end_date, fp.is_53rd_week
                 FROM fiscal_periods fp
                 JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
                 JOIN fiscal_calendars fc ON fc.id = fy.calendar_id
                 WHERE fc.company_id = ?1",
            )
            .map_err(AppError::from)?;
        let rows = stmt
            .query_map([&company_id], |r| {
                Ok((
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            })
            .map_err(AppError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;
        for (old_fy, period_no, code, start_date, end_date, is_53rd_week) in rows {
            let new_fy = fy_map.get(&old_fy).cloned().ok_or_else(|| {
                AppError::internal(format!("CLONE_FY_REMAP: missing fiscal year {old_fy}"))
            })?;
            tx.execute(
                "INSERT INTO fiscal_periods (id, fiscal_year_id, period_no, code, start_date, end_date, is_53rd_week)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![Uuid::new_v4().to_string(), new_fy, period_no, &code, &start_date, &end_date, is_53rd_week],
            )
            .map_err(AppError::from)?;
        }
    }

    // 4. Business units (parent_bu_id + calendar_id remap; pack_id kept). Inserted by a
    //    fixpoint pass so a parent BU is always mapped before its child regardless of source
    //    row order — otherwise the BU tree would silently flatten (no TODO, no corruption).
    let bu_rows: Vec<(
        String,
        String,
        Option<String>,
        String,
        String,
        String,
        i64,
        Option<rusqlite::types::Value>,
        i64,
    )> = {
        let mut stmt = tx
            .prepare(
                "SELECT id, name, parent_bu_id, pack_id, calendar_id, reporting_currency_code, is_consolidated, ownership_pct, sort_order
                 FROM business_units WHERE company_id = ?1",
            )
            .map_err(AppError::from)?;
        stmt.query_map([&company_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, Option<rusqlite::types::Value>>(7)?,
                r.get::<_, i64>(8)?,
            ))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?
    };
    let mut bu_map = HashMap::new();
    while bu_map.len() < bu_rows.len() {
        let mut progress = false;
        for (
            old,
            bname,
            parent_bu_id,
            pack_id,
            calendar_id,
            reporting_currency_code,
            is_consolidated,
            ownership_pct,
            sort_order,
        ) in &bu_rows
        {
            if bu_map.contains_key(old) {
                continue;
            }
            let new_parent = parent_bu_id.as_ref().and_then(|p| bu_map.get(p).cloned());
            if parent_bu_id.is_some() && new_parent.is_none() {
                continue; // parent not mapped yet — resolved on a later pass
            }
            let new_cal = cal_map.get(calendar_id).cloned().ok_or_else(|| {
                AppError::internal(format!(
                    "CLONE_BU_CAL_REMAP: missing calendar {calendar_id}"
                ))
            })?;
            // ownership_pct is a NUMERIC ownership ratio (not money) — round-trip it as its
            // textual form so no float type touches the core (B3); NUMERIC affinity coerces the
            // text back to the exact INTEGER/REAL storage class on insert.
            let ownership_param: Option<String> = ownership_pct.as_ref().and_then(|v| match v {
                rusqlite::types::Value::Integer(i) => Some(i.to_string()),
                rusqlite::types::Value::Real(f) => Some(f.to_string()),
                rusqlite::types::Value::Text(t) => Some(t.clone()),
                _ => None,
            });
            let new_id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO business_units (id, company_id, name, parent_bu_id, pack_id, calendar_id,
                                             reporting_currency_code, is_consolidated, ownership_pct, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    new_id,
                    dst_id.as_str(),
                    bname.as_str(),
                    new_parent,
                    pack_id.as_str(),
                    new_cal.as_str(),
                    reporting_currency_code.as_str(),
                    *is_consolidated,
                    ownership_param,
                    *sort_order
                ],
            )
            .map_err(AppError::from)?;
            bu_map.insert(old.clone(), new_id);
            progress = true;
        }
        if !progress {
            return Err(AppError::internal(
                "CLONE_BU_REMAP: business-unit tree has a cycle or a missing parent",
            ));
        }
    }

    // 5. Chart of Accounts (bu_id + parent_id remap; same fixpoint so the COA tree survives
    //    regardless of source row order).
    let acct_rows: Vec<(
        String,
        Option<String>,
        String,
        String,
        String,
        String,
        Option<String>,
        i64,
        i64,
        i64,
    )> = {
        let mut stmt = tx
            .prepare(
                "SELECT id, bu_id, code, name, account_type, report_section, parent_id, is_control, version, active
                 FROM accounts WHERE company_id = ?1",
            )
            .map_err(AppError::from)?;
        stmt.query_map([&company_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, i64>(9)?,
            ))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?
    };
    let mut acct_map = HashMap::new();
    while acct_map.len() < acct_rows.len() {
        let mut progress = false;
        for (
            old,
            bu_id,
            code,
            aname,
            account_type,
            report_section,
            parent_id,
            is_control,
            version,
            active,
        ) in &acct_rows
        {
            if acct_map.contains_key(old) {
                continue;
            }
            let new_parent = parent_id.as_ref().and_then(|p| acct_map.get(p).cloned());
            if parent_id.is_some() && new_parent.is_none() {
                continue; // parent not mapped yet — resolved on a later pass
            }
            let new_bu = bu_id.as_ref().and_then(|b| bu_map.get(b).cloned());
            let new_id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO accounts (id, company_id, bu_id, code, name, account_type, report_section,
                                       parent_id, is_control, version, active)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                rusqlite::params![
                    new_id,
                    dst_id.as_str(),
                    new_bu,
                    code.as_str(),
                    aname.as_str(),
                    account_type.as_str(),
                    report_section.as_str(),
                    new_parent,
                    *is_control,
                    *version,
                    *active
                ],
            )
            .map_err(AppError::from)?;
            acct_map.insert(old.clone(), new_id);
            progress = true;
        }
        if !progress {
            return Err(AppError::internal(
                "CLONE_COA_REMAP: account tree has a cycle or a missing parent",
            ));
        }
    }

    // 6. Bootstrap the sandbox's default Model + Base scenario (source horizon + pack).
    let model_id = create_default_model(&tx, &dst_id, &name, &src_horizon, &src_pack_id)?;

    // Audit event (HMAC chain; per-Company, starts at genesis for the new Company).
    let after_json = serde_json::json!({
        "name": name,
        "source_company_id": company_id,
        "model_id": model_id.clone()
    })
    .to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &dst_id)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                   prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'company.clone_sandbox', 'company', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![dst_id, dst_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    // Seal the sandbox container LAST, still inside the transaction: a failure rolls back so
    // there is never a Company row without its `.fpa` file (mirror of company.create).
    let mut cek = container::create_key();
    let image = container::new_image(&dir, &dst_id)?;
    container::seal(Path::new(&target_path_str), &image, &cek, &vault_key)?;
    keys::zeroize(&mut cek);

    tx.commit().map_err(AppError::from)?;
    keys::zeroize(&mut vault_key);

    Ok(serde_json::json!({ "data": { "company_id": dst_id } }))
}

/// `company.delete` — {company_id, reason}. Erasure (COMPLIANCE-DATA-SOVEREIGNTY §Erasure):
/// blocked while the Company was used within the retention window (`COMPANY_IN_USE_RECENT`)
/// or holds model/import content; otherwise removes the Company + its calendar/BU tree and
/// excises its per-Company audit segment (F-033) inside one transaction.
#[tauri::command(name = "company.delete", rename_all = "camelCase")]
pub fn company_delete(
    app: AppHandle,
    company_id: String,
    reason: String,
    state: tauri::State<'_, crate::commands::session::SessionState>,
) -> AppResult<serde_json::Value> {
    if reason.trim().is_empty() {
        return Err(AppError::invalid(
            "COMPANY_DELETE_REASON_REQUIRED: a deletion reason is required for the audit",
        ));
    }
    // AUTH-SPEC §2.5: erasure is a mutation — a Company under read-only (chain break) cannot
    // be deleted while its session is read-only; restore first, then erase (if still wanted).
    crate::commands::session::require_company_write(&state, &company_id)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;

    let updated_at: Option<String> = tx
        .query_row(
            "SELECT updated_at FROM companies WHERE id = ?1",
            [&company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    let updated_at = updated_at.ok_or_else(AppError::file_corrupt)?;

    // Retention gate: used within the last 30 days → deletion blocked (F-001).
    let last_used = updated_at
        .parse::<DateTime<Utc>>()
        .map_err(|e| AppError::internal(format!("UPDATED_AT_PARSE: {e}")))?;
    let days = (Utc::now() - last_used).num_days();
    if days < COMPANY_RECENT_WINDOW_DAYS {
        return Err(AppError::company_recent_use(days.max(0) as u16));
    }

    // Content guard: models/imports/GL data must be archived before the Company goes away.
    for table in ["models", "import_batches", "gl_lines"] {
        let n: i64 = tx
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE company_id = ?1"),
                [&company_id],
                |r| r.get(0),
            )
            .map_err(AppError::from)?;
        if n > 0 {
            return Err(AppError::invalid(format!(
                "COMPANY_HAS_CONTENT: {table} reference this Company — archive or remove them first"
            )));
        }
    }

    // Erasure covers the sealed file as well as the row (COMPLIANCE-DATA-SOVEREIGNTY §Erasure):
    // the container is only ciphertext without the vault key, but it still belongs to the Company.
    let container_path: String = tx
        .query_row(
            "SELECT company_file_path FROM companies WHERE id = ?1",
            [&company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?
        .ok_or_else(AppError::file_corrupt)?;

    // Audit the deletion before the per-Company chain is excised (erasure semantics: the
    // Company's trail is removed with it; surviving Companies keep their own chain, F-033).
    let after_json = serde_json::json!({ "reason": reason.trim() }).to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                   prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'company.delete', 'company', ?1, NULL, ?2, ?3, ?4, ?5)",
        rusqlite::params![company_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    // Purge dependency order: transit maps → periods → years → calendars → BUs → audit → company.
    tx.execute(
        "DELETE FROM bu_calendar_map WHERE company_id = ?1",
        [&company_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "DELETE FROM fiscal_periods WHERE fiscal_year_id IN
           (SELECT id FROM fiscal_years WHERE calendar_id IN
             (SELECT id FROM fiscal_calendars WHERE company_id = ?1))",
        [&company_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "DELETE FROM fiscal_years WHERE calendar_id IN
           (SELECT id FROM fiscal_calendars WHERE company_id = ?1)",
        [&company_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "DELETE FROM fiscal_calendars WHERE company_id = ?1",
        [&company_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "DELETE FROM business_units WHERE company_id = ?1",
        [&company_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "DELETE FROM audit_events WHERE company_id = ?1",
        [&company_id],
    )
    .map_err(AppError::from)?;
    tx.execute("DELETE FROM companies WHERE id = ?1", [&company_id])
        .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    match fs::remove_file(Path::new(&container_path)) {
        Ok(()) => {}
        // A Company whose file was already moved/removed by the user is still erased.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(AppError::internal(format!("COMPANY_FILE_DELETE: {e}"))),
    }

    Ok(serde_json::json!({ "data": { "deleted": true } }))
}

/// Last hash of THIS Company's audit chain (genesis when it has no events yet) — inside the
/// same transaction. Chains are per-Company (F-033, "surviving Companies keep their own
/// chain"): `company.delete` may excise a Company's whole audit segment without ever breaking
/// a surviving Company's chain, which AUTH-SPEC §2.5 verifies at every unlock.
pub(crate) fn audited_hash(
    conn: &rusqlite::Transaction,
    company_id: &str,
) -> Result<String, rusqlite::Error> {
    let last: Option<String> = conn
        .query_row(
            "SELECT hash FROM audit_events WHERE company_id = ?1 ORDER BY seq DESC LIMIT 1",
            [company_id],
            |r| r.get(0),
        )
        .ok();
    Ok(last.unwrap_or_else(|| GENESIS_HASH.to_string()))
}

/// Unlock-time chain verification (AUTH-SPEC §2.5 / ADR-011): replay the Company's audit
/// events against the keychain-held HMAC key; return the `seq` of the first event that no
/// longer verifies, or `None` when the chain is intact. Hash payloads are the stored
/// `after_json` bytes — the exact bytes every writer chains (audit.rs::next_hash).
pub(crate) fn verify_company_chain(
    conn: &rusqlite::Connection,
    data_dir: &Path,
    company_id: &str,
) -> AppResult<Option<i64>> {
    let key = keystore::audit_hmac_key(data_dir).map_err(AppError::internal)?;
    let mut stmt = conn
        .prepare(
            "SELECT seq, prev_hash, hash, COALESCE(after_json, '') FROM audit_events
             WHERE company_id = ?1 ORDER BY seq ASC",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([company_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    let events: Vec<(String, String, Vec<u8>)> = rows
        .iter()
        .map(|(_, prev, hash, payload)| (prev.clone(), hash.clone(), payload.clone().into_bytes()))
        .collect();
    Ok(crate::core::audit::verify_chain(&key, &events).map(|broken_idx| rows[broken_idx].0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horizon_mapping_is_exact() {
        assert_eq!(horizon_years("13w"), 1);
        assert_eq!(horizon_years("1y"), 1);
        assert_eq!(horizon_years("3y"), 3);
        assert_eq!(horizon_years("5y"), 5);
    }

    #[test]
    fn engine_generates_60_periods_for_five_years() {
        let years = build_week_based(
            CalendarPreset::Nrf454,
            crate::core::calendar::sunday_nearest(
                chrono::NaiveDate::from_ymd_opt(2024, 2, 1).unwrap(),
            ),
            5,
            WeekRule::NrfFourDay,
        );
        assert_eq!(years.len(), 5);
        let total: usize = years.iter().map(|y| y.periods.len()).sum();
        assert_eq!(total, 60); // 5 × 12 months (2028's 53rd week is inside Q4 4-5-5)
    }

    #[test]
    fn calendar_config_validates_nrf_rule_scoped_to_454() {
        let mut conn = db::open_in_memory().unwrap();
        let tx = conn.transaction().unwrap();
        let err = write_calendar(
            &tx,
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
            &CalendarConfig {
                preset: "445".into(),
                fy_start_month: None,
                week_start_day: Some(0),
                anchor_rule: Some("sunday_near_feb_1".into()),
                year_end_rule: Some("nrf_4_day".into()),
            },
            "1y",
        )
        .unwrap_err();
        assert_eq!(err.body().code, "CAL_53WEEK_CONFLICT");
        assert_eq!(err.body().http_status, 422);
    }

    #[test]
    fn error_bodies_for_new_variants_match_contract() {
        assert_eq!(AppError::file_corrupt().body().code, "STORAGE_FILE_CORRUPT");
        assert_eq!(AppError::file_corrupt().body().http_status, 422);
        let recent = AppError::company_recent_use(12).body();
        assert_eq!(recent.code, "COMPANY_IN_USE_RECENT");
        assert!(recent.user_message.contains("12 days"));
        assert_eq!(
            AppError::transit_ambiguous("x").body().code,
            "CAL_TRANSIT_AMBIGUOUS"
        );
        assert_eq!(
            AppError::period_mapping_conflict("x").body().code,
            "CAL_PERIOD_MAPPING_CONFLICT"
        );
    }

    /* ── AUTH-SPEC §2.5 audit-chain verification (per-Company chains, F-033) ── */

    const COMP_A: &str = "00000000-0000-0000-0000-00000000000a";
    const COMP_B: &str = "00000000-0000-0000-0000-00000000000b";

    fn audit_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("onefpa-audit-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn insert_company(conn: &rusqlite::Connection, id: &str) {
        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version,
                                    company_file_path, created_at, updated_at)
             VALUES (?1, ?1, 'single', 'USD', 'en-IN', '1.0.0', ?2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![id, format!("/tmp/{id}.fpa")],
        )
        .unwrap();
    }

    /// Append an event through the same writer primitives the commands use (HMAC key from the
    /// keystore, per-Company prev-hash, payload = stored `after_json` bytes).
    fn chain_append(conn: &rusqlite::Connection, dir: &Path, company_id: &str, payload: &str) {
        let key = keystore::audit_hmac_key(dir).unwrap();
        let prev: String = conn
            .query_row(
                "SELECT hash FROM audit_events WHERE company_id = ?1 ORDER BY seq DESC LIMIT 1",
                [company_id],
                |r| r.get(0),
            )
            .optional()
            .unwrap()
            .unwrap_or_else(|| GENESIS_HASH.to_string());
        let hash = next_hash(&key, &prev, payload.as_bytes());
        conn.execute(
            "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                       prev_hash, hash, created_at)
             VALUES (?1, 'owner', 'test.event', 'test', ?1, NULL, ?2, ?3, ?4, '2026-01-01T00:00:00Z')",
            rusqlite::params![company_id, payload, prev, hash],
        )
        .unwrap();
    }

    #[test]
    fn per_company_chain_survives_excision_of_another_companys_segment() {
        // F-033 erasure semantics: excising one Company's audit trail must never break a
        // surviving Company's chain (verified at every unlock, AUTH-SPEC §2.5).
        let dir = audit_dir("excision");
        let conn = db::open_in_memory().unwrap();
        insert_company(&conn, COMP_A);
        insert_company(&conn, COMP_B);
        chain_append(&conn, &dir, COMP_A, "a-1");
        chain_append(&conn, &dir, COMP_B, "b-1");
        chain_append(&conn, &dir, COMP_A, "a-2");
        chain_append(&conn, &dir, COMP_B, "b-2");
        assert_eq!(verify_company_chain(&conn, &dir, COMP_A).unwrap(), None);
        assert_eq!(verify_company_chain(&conn, &dir, COMP_B).unwrap(), None);

        conn.execute("DELETE FROM audit_events WHERE company_id = ?1", [COMP_B])
            .unwrap();
        assert_eq!(
            verify_company_chain(&conn, &dir, COMP_A).unwrap(),
            None,
            "a global prev-hash chained A's events through B's — excision used to break A"
        );
        // … and A's chain keeps extending from A's own last event afterwards.
        chain_append(&conn, &dir, COMP_A, "a-3");
        assert_eq!(verify_company_chain(&conn, &dir, COMP_A).unwrap(), None);
    }

    #[test]
    fn tampered_event_is_detected_with_its_seq() {
        let dir = audit_dir("tamper");
        let conn = db::open_in_memory().unwrap();
        insert_company(&conn, COMP_A);
        chain_append(&conn, &dir, COMP_A, "original-1");
        chain_append(&conn, &dir, COMP_A, "original-2");
        let first_seq: i64 = conn
            .query_row(
                "SELECT seq FROM audit_events WHERE company_id = ?1 ORDER BY seq ASC LIMIT 1",
                [COMP_A],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "UPDATE audit_events SET after_json = 'EVIL-EDIT' WHERE seq = ?1",
            [first_seq],
        )
        .unwrap();
        assert_eq!(
            verify_company_chain(&conn, &dir, COMP_A).unwrap(),
            Some(first_seq)
        );
    }

    #[test]
    fn empty_chain_verifies_ok() {
        let dir = audit_dir("empty");
        let conn = db::open_in_memory().unwrap();
        insert_company(&conn, COMP_A);
        assert_eq!(verify_company_chain(&conn, &dir, COMP_A).unwrap(), None);
    }

    #[test]
    fn audit_chain_break_body_matches_the_documented_contract() {
        // ERROR-HANDLING.md §H: 409, not retryable, restore offer as the user text.
        let body = AppError::audit_chain_break(41).body();
        assert_eq!(body.code, "AUDIT_CHAIN_BREAK");
        assert_eq!(body.http_status, 409);
        assert!(!body.retryable);
        assert_eq!(body.retry_after_ms, None);
        assert_eq!(
            body.user_message,
            "Audit integrity check failed. Restore from the last verified Snapshot?"
        );
        assert_eq!(body.details["brokenAtSeq"], 41);
    }
}
