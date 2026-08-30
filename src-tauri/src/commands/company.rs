//! company.list / company.create / company.open / company.delete (F-001 Company Manager).
//! File-backed Company records live in the app DB; the encrypted `.fpa` container wraps the
//! Company DB in a later milestone (SECURITY-CHECKLIST A02) — the id/path contract is unchanged.

use chrono::{DateTime, Datelike, Utc};
use rusqlite::OptionalExtension;
use std::path::Path;
use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

use crate::core::audit::{next_hash, GENESIS_HASH};
use crate::core::calendar::{build_12month, build_week_based, CalendarPreset, WeekRule};
use crate::core::error::{AppError, AppResult};
use crate::storage::db;
use crate::storage::keystore;

/// Retention window for `company.delete` (ERROR-HANDLING `COMPANY_IN_USE_RECENT`): a Company
/// used within the last 30 days cannot be deleted — no silent loss of recent work (F-001).
pub const COMPANY_RECENT_WINDOW_DAYS: i64 = 30;

pub fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::internal(format!("APP_DATA_DIR: {e}")))
}

/// `company.list` — CompanyMeta[] (last_opened_at = last activity: create/open/unlock).
#[tauri::command(name = "company.list", rename_all = "camelCase")]
pub fn company_list(app: AppHandle) -> AppResult<serde_json::Value> {
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;
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
    let rows = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)?;
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
    let year_end_rule_val = calendar
        .year_end_rule
        .clone()
        .unwrap_or_else(|| if preset == "454" { "nrf_4_day".into() } else { "full_week".into() });
    if year_end_rule_val == "nrf_4_day" && preset != "454" {
        return Err(AppError::cal_53week_conflict());
    }
    if preset != "12month" && calendar.week_start_day.unwrap_or(0) != 0 {
        return Err(AppError::invalid("WEEK_START_MUST_BE_SUNDAY for the NRF family (F-003)".into()));
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
            crate::core::calendar::sunday_nearest(chrono::NaiveDate::from_ymd_opt(now_year, 2, 1).unwrap()),
            horizon_years(horizon),
            if year_end_rule_val == "nrf_4_day" { WeekRule::NrfFourDay } else { WeekRule::FullWeek },
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

/// `company.create` — {name, path, pack_key, calendar{...}, plan_only?, horizon?}
#[tauri::command(name = "company.create", rename_all = "camelCase")]
pub fn company_create(
    app: AppHandle,
    name: String,
    path: String,
    pack_key: String,
    calendar: CalendarConfig,
    horizon: Option<String>,
) -> AppResult<serde_json::Value> {
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir).map_err(AppError::from)?;

    // Pack must be registered first (bundled seed on first run).
    crate::commands::pack::seed_bundled_packs(&app, &conn)?;
    let pack_key_clean = pack_key.trim().to_lowercase();
    let pack_exists: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM packs WHERE key = ?1)", [&pack_key_clean], |r| r.get(0))
        .map_err(AppError::from)?;
    if !pack_exists {
        return Err(AppError::invalid(format!("PACK_SCHEMA_INVALID: unknown pack_key '{pack_key_clean}'")));
    }

    let now = Utc::now().to_rfc3339();
    let company_id = Uuid::new_v4().to_string();
    let company_file_path =
        Path::new(&path).canonicalize().unwrap_or_else(|_| Path::new(&path).to_path_buf());
    let company_file_path = company_file_path.to_string_lossy().to_string();

    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version,
                                company_file_path, created_at, updated_at)
         VALUES (?1, ?2, 'single', 'USD', 'en-IN', '1.0.0', ?3, ?4, ?4)",
        rusqlite::params![company_id, name.trim(), company_file_path, now],
    )
    .map_err(AppError::from)?;

    let cal_id = Uuid::new_v4().to_string();
    write_calendar(&tx, &company_id, &cal_id, &calendar, horizon.as_deref().unwrap_or("1y"))?;

    // Audit event (HMAC chain; key from keychain — never the DB).
    // Chain payload = the stored `after_json` bytes → tamper detection is exact (audit.rs).
    let after_json = serde_json::json!({ "name": name, "pack": pack_key_clean }).to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                   prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'company.create', 'company', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, company_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": { "company_id": company_id } }))
}

/// `company.open` — {path}. Switches the active session Company (S-020 Open) and records the
/// activity timestamp used by the retention gate (`last_opened_at`).
#[tauri::command(name = "company.open", rename_all = "camelCase")]
pub fn company_open(
    app: AppHandle,
    path: String,
    state: tauri::State<'_, crate::commands::session::SessionState>,
) -> AppResult<serde_json::Value> {
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir).map_err(AppError::from)?;
    let row: Option<(String, String, String, String, String, String, String)> = conn
        .query_row(
            "SELECT id, name, type, default_currency_code, base_locale, pack_schema_version, company_file_path
             FROM companies WHERE company_file_path = ?1",
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
                ))
            },
        )
        .optional()
        .map_err(AppError::from)?;
    let (company_id, name, ctype, currency, locale, pack_schema_version, stored_path) =
        row.ok_or_else(AppError::file_corrupt)?;

    // Session switch (token re-minted per open — AUTH-SPEC §2).
    crate::commands::session::mint_session(&state, company_id.clone())?;

    let now = Utc::now().to_rfc3339();
    conn.execute("UPDATE companies SET updated_at = ?1 WHERE id = ?2", [&now, &company_id])
        .map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "company_id": company_id,
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

/// `company.delete` — {company_id, reason}. Erasure (COMPLIANCE-DATA-SOVEREIGNTY §Erasure):
/// blocked while the Company was used within the retention window (`COMPANY_IN_USE_RECENT`)
/// or holds model/import content; otherwise removes the Company + its calendar/BU tree and
/// excises its per-Company audit segment (F-033) inside one transaction.
#[tauri::command(name = "company.delete", rename_all = "camelCase")]
pub fn company_delete(app: AppHandle, company_id: String, reason: String) -> AppResult<serde_json::Value> {
    if reason.trim().is_empty() {
        return Err(AppError::invalid("COMPANY_DELETE_REASON_REQUIRED: a deletion reason is required for the audit".into()));
    }
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir).map_err(AppError::from)?;
    let tx = conn.transaction().map_err(AppError::from)?;

    let updated_at: Option<String> = tx
        .query_row("SELECT updated_at FROM companies WHERE id = ?1", [&company_id], |r| r.get(0))
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

    // Audit the deletion before the per-Company chain is excised (erasure semantics: the
    // Company's trail is removed with it; surviving Companies keep their own chain, F-033).
    let after_json = serde_json::json!({ "reason": reason.trim() }).to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx)?;
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
    tx.execute("DELETE FROM fiscal_calendars WHERE company_id = ?1", [&company_id]).map_err(AppError::from)?;
    tx.execute("DELETE FROM business_units WHERE company_id = ?1", [&company_id]).map_err(AppError::from)?;
    tx.execute("DELETE FROM audit_events WHERE company_id = ?1", [&company_id]).map_err(AppError::from)?;
    tx.execute("DELETE FROM companies WHERE id = ?1", [&company_id]).map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": { "deleted": true } }))
}

/// Last hash in the chain (genesis when empty) — all inside the same transaction.
fn audited_hash(conn: &rusqlite::Transaction) -> Result<String, rusqlite::Error> {
    let last: Option<String> = conn
        .query_row("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1", [], |r| r.get(0))
        .ok();
    Ok(last.unwrap_or_else(|| GENESIS_HASH.to_string()))
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
            crate::core::calendar::sunday_nearest(chrono::NaiveDate::from_ymd_opt(2024, 2, 1).unwrap()),
            5,
            WeekRule::NrfFourDay,
        );
        assert_eq!(years.len(), 5);
        let total: usize = years.iter().map(|y| y.periods.len()).sum();
        assert_eq!(total, 60); // 5 × 12 months (2028's 53rd week is inside Q4 4-5-5)
    }

    #[test]
    fn calendar_config_validates_nrf_rule_scoped_to_454() {
        let conn = db::open_in_memory().unwrap();
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
        assert_eq!(AppError::transit_ambiguous("x").body().code, "CAL_TRANSIT_AMBIGUOUS");
        assert_eq!(
            AppError::period_mapping_conflict("x").body().code,
            "CAL_PERIOD_MAPPING_CONFLICT"
        );
    }
}
