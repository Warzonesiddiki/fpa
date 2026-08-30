//! company.list / company.create (F-001 Company Manager).
//! File-backed Company records live in the app DB; the encrypted `.fpa` container wraps the
//! Company DB in a later milestone (SECURITY-CHECKLIST A02) — the id/path contract is unchanged.

use chrono::{Datelike, Utc};
use std::path::Path;
use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

use crate::core::audit::{next_hash, GENESIS_HASH};
use crate::core::calendar::{build_12month, build_week_based, CalendarPreset, WeekRule};
use crate::core::error::{AppError, AppResult};
use crate::storage::db;
use crate::storage::keystore;

pub fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::internal(format!("APP_DATA_DIR: {e}")))
}

/// `company.list`
#[tauri::command(name = "company.list", rename_all = "camelCase")]
pub fn company_list(app: AppHandle) -> AppResult<serde_json::Value> {
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.type, c.default_currency_code, c.base_locale,
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
                "last_opened_at": null::<String>,
                "license_status": r.get::<_, String>(5)?,
            }))
        })
        .map_err(AppError::from)?
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
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarConfig {
    pub preset: String,
    pub fy_start_month: Option<u32>,
    pub week_start_day: Option<u32>,
    pub anchor_rule: Option<String>,
    pub year_end_rule: Option<String>,
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

    // Fiscal calendar record + generated years/periods (F-003 engine is the single owner).
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
    let cal_id = Uuid::new_v4().to_string();
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
            horizon_years(horizon.as_deref().unwrap_or("1y")),
        ),
        _ => build_week_based(
            parse_preset(preset)?,
            crate::core::calendar::sunday_nearest(chrono::NaiveDate::from_ymd_opt(now_year, 2, 1).unwrap()),
            horizon_years(horizon.as_deref().unwrap_or("1y")),
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
}
