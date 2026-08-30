//! `calendar.preview` / `calendar.apply` (F-003). preview is pure engine output — the UI
//! previews before apply persists the config + generated years/periods for a Company.

use chrono::NaiveDate;
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::commands::company::{audited_hash, write_calendar, CalendarConfig};
use crate::core::audit::next_hash;
use crate::core::calendar::{build_12month, build_week_based, CalendarPreset, WeekRule};
use crate::core::error::{AppError, AppResult};
use crate::storage::keystore;

fn parse_preset(s: &str) -> Result<CalendarPreset, AppError> {
    match s {
        "12month" => Ok(CalendarPreset::TwelveMonth),
        "454" => Ok(CalendarPreset::Nrf454),
        "445" => Ok(CalendarPreset::Nrf445),
        "544" => Ok(CalendarPreset::Nrf544),
        "3334" => Ok(CalendarPreset::ThreeThreeThreeFour),
        other => Err(AppError::invalid(format!("CAL_PRESET_UNKNOWN: {other}"))),
    }
}

fn parse_week_rule(s: Option<&str>, preset: CalendarPreset) -> Result<WeekRule, AppError> {
    let rule = match s.unwrap_or(if preset == CalendarPreset::Nrf454 { "nrf_4_day" } else { "full_week" }) {
        "nrf_4_day" => WeekRule::NrfFourDay,
        "full_week" => WeekRule::FullWeek,
        other => return Err(AppError::invalid(format!("CAL_WEEK_RULE_UNKNOWN: {other}"))),
    };
    // CAL_53WEEK_CONFLICT: NRF (4+ days) is exclusive to 4-5-4 (SCREENS-SPEC S-003).
    if rule == WeekRule::NrfFourDay && preset != CalendarPreset::Nrf454 {
        return Err(AppError::cal_53week_conflict());
    }
    Ok(rule)
}

/// `calendar.preview` — {preset, fy_start_month?, week_start_day?, anchor_rule?, year_end_rule?, from, year_count?}
#[tauri::command(name = "calendar.preview", rename_all = "camelCase")]
pub fn calendar_preview(
    preset: String,
    fy_start_month: Option<u32>,
    week_start_day: Option<u32>,
    anchor_rule: Option<String>,
    year_end_rule: Option<String>,
    from: String,
    year_count: Option<u32>,
) -> AppResult<serde_json::Value> {
    let preset = parse_preset(&preset)?;
    let week_rule = parse_week_rule(year_end_rule.as_deref(), preset)?;
    let count = year_count.unwrap_or(3).clamp(1, 5);

    let from_date = NaiveDate::parse_from_str(&from, "%Y-%m-%d").map_err(|_| AppError::invalid("DATE_INVALID"))?;

    let fiscal_years = match preset {
        CalendarPreset::TwelveMonth => {
            let m = fy_start_month.ok_or_else(|| AppError::invalid("FY_START_MONTH_REQUIRED"))?;
            build_12month(from_date.year(), m, count)
        }
        _ => {
            let anchor = match anchor_rule.as_deref().unwrap_or("sunday_near_feb_1") {
                "sunday_near_feb_1" => crate::core::calendar::sunday_nearest(from_date),
                "first_day" | "nearest_weekday" => from_date,
                other => return Err(AppError::invalid(format!("ANCHOR_RULE_UNKNOWN: {other}"))),
            };
            // NRF family weeks start Sunday; a different week start is out of scope (CAL_53WEEK_CONFLICT family).
            if week_start_day.unwrap_or(0) != 0 {
                return Err(AppError::invalid("WEEK_START_MUST_BE_SUNDAY for the NRF family (F-003)".into()));
            }
            build_week_based(preset, anchor, count, week_rule)
        }
    };

    Ok(serde_json::json!({ "data": { "fiscal_years": fiscal_years } }))
}

/// Transit-map row: how a BU period relates to a Group period (SCREENS-SPEC S-022).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuMapEntry {
    pub bu_id: String,
    pub group_period_id: String,
    pub bu_period_id: String,
    pub mapping: String, // "exact" | "partial"
    pub share_pct: Option<rust_decimal::Decimal>,
}

/// Validate the apply payload: exactly one Default-calendar config for a single-entity Company
/// (more requires the BU matrix → CAL_PERIOD_MAPPING_CONFLICT) and a non-ambiguous transit map
/// (partial mapping must carry an explicit share → CAL_TRANSIT_AMBIGUOUS).
fn validate_apply(company_id: &str, config: &[CalendarConfig], bu_map: &[BuMapEntry]) -> AppResult<()> {
    if config.len() != 1 {
        return Err(AppError::period_mapping_conflict(format!(
            "expected exactly 1 calendar config for company {company_id}, got {}",
            config.len()
        )));
    }
    for entry in bu_map {
        if entry.mapping != "exact" && entry.mapping != "partial" {
            return Err(AppError::invalid(format!("CAL_MAPPING_UNKNOWN: {}", entry.mapping)));
        }
        if entry.mapping == "partial" && entry.share_pct.is_none() {
            return Err(AppError::transit_ambiguous(format!(
                "bu_period {} spans two Group periods without a share_pct",
                entry.bu_period_id
            )));
        }
    }
    Ok(())
}

/// `calendar.apply` — {company_id, config[], bu_map[]}. Replaces the Company's 'Default'
/// calendar with the validated config + generated years/periods (transactional + audited).
/// bu_map is the Group-transit contract (empty for a single-entity Company in M1).
#[tauri::command(name = "calendar.apply", rename_all = "camelCase")]
pub fn calendar_apply(
    app: tauri::AppHandle,
    company_id: String,
    config: Vec<CalendarConfig>,
    bu_map: Vec<BuMapEntry>,
    state: tauri::State<'_, crate::commands::session::SessionState>,
) -> AppResult<serde_json::Value> {
    // AUTH-SPEC §2.5/§3: a read-only (audit-chain-broken) Company accepts no mutations.
    crate::commands::session::require_company_write(&state, &company_id)?;
    let dir = crate::commands::company::app_data_dir(&app)?;
    let mut conn = crate::storage::db::open_at(&dir).map_err(AppError::from)?;

    validate_apply(&company_id, &config, &bu_map)?;
    let calendar = &config[0];

    let tx = conn.transaction().map_err(AppError::from)?;
    let exists: Option<String> = tx
        .query_row("SELECT name FROM companies WHERE id = ?1", [&company_id], |r| r.get(0))
        .optional()
        .map_err(AppError::from)?;
    if exists.is_none() {
        return Err(AppError::file_corrupt());
    }

    // Replace the 'Default' calendar tree (FK order: maps → periods → years → calendars).
    tx.execute(
        "DELETE FROM bu_calendar_map WHERE company_id = ?1",
        [&company_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "DELETE FROM fiscal_periods WHERE fiscal_year_id IN
           (SELECT id FROM fiscal_years WHERE calendar_id IN
             (SELECT id FROM fiscal_calendars WHERE company_id = ?1 AND name = 'Default'))",
        [&company_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "DELETE FROM fiscal_years WHERE calendar_id IN
           (SELECT id FROM fiscal_calendars WHERE company_id = ?1 AND name = 'Default')",
        [&company_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "DELETE FROM fiscal_calendars WHERE company_id = ?1 AND name = 'Default'",
        [&company_id],
    )
    .map_err(AppError::from)?;

    let cal_id = Uuid::new_v4().to_string();
    write_calendar(&tx, &company_id, &cal_id, calendar, "1y")?;

    // Audit (HMAC chain; key from keychain — never the DB; per-Company chain, F-033).
    let after_json = serde_json::json!({ "preset": calendar.preset }).to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                   prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'calendar.apply', 'calendar', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, cal_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": { "applied": true } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_454_matches_oracle() {
        let out = calendar_preview(
            "454".into(),
            None,
            Some(0),
            Some("sunday_near_feb_1".into()),
            Some("nrf_4_day".into()),
            "2024-02-01".into(),
            Some(5),
        )
        .unwrap();
        let years = out["data"]["fiscal_years"].as_array().unwrap();
        assert_eq!(years.len(), 5);
        assert_eq!(years[0]["start_date"], "2024-02-04");
        assert_eq!(years[4]["week_count"], 53);
    }

    #[test]
    fn nrf_rule_on_non_454_is_conflict() {
        let e = calendar_preview(
            "445".into(),
            None,
            Some(0),
            None,
            Some("nrf_4_day".into()),
            "2026-02-01".into(),
            None,
        )
        .unwrap_err();
        assert_eq!(e.body().code, "CAL_53WEEK_CONFLICT");
        assert_eq!(e.body().http_status, 422);
    }

    #[test]
    fn twelve_month_requires_start_month() {
        let e = calendar_preview("12month".into(), None, None, None, None, "2026-04-01".into(), None)
            .unwrap_err();
        assert_eq!(e.body().code, "VALUE_INVALID");
    }

    fn cfg(preset: &str) -> CalendarConfig {
        CalendarConfig {
            preset: preset.into(),
            fy_start_month: None,
            week_start_day: Some(0),
            anchor_rule: Some("sunday_near_feb_1".into()),
            year_end_rule: Some("nrf_4_day".into()),
        }
    }

    #[test]
    fn apply_rejects_multiple_configs_with_mapping_conflict() {
        let e = validate_apply("c1", &[cfg("454"), cfg("445")], &[]).unwrap_err();
        assert_eq!(e.body().code, "CAL_PERIOD_MAPPING_CONFLICT");
        assert_eq!(e.body().http_status, 409);
    }

    #[test]
    fn apply_rejects_partial_transit_without_share() {
        let e = validate_apply(
            "c1",
            &[cfg("454")],
            &[BuMapEntry {
                bu_id: "bu1".into(),
                group_period_id: "gp1".into(),
                bu_period_id: "bp1".into(),
                mapping: "partial".into(),
                share_pct: None,
            }],
        )
        .unwrap_err();
        assert_eq!(e.body().code, "CAL_TRANSIT_AMBIGUOUS");
        assert_eq!(e.body().http_status, 422);
    }

    #[test]
    fn apply_accepts_exact_and_shared_partial_maps() {
        let ok = validate_apply(
            "c1",
            &[cfg("454")],
            &[
                BuMapEntry {
                    bu_id: "bu1".into(),
                    group_period_id: "gp1".into(),
                    bu_period_id: "bp1".into(),
                    mapping: "exact".into(),
                    share_pct: None,
                },
                BuMapEntry {
                    bu_id: "bu2".into(),
                    group_period_id: "gp1".into(),
                    bu_period_id: "bp1".into(),
                    mapping: "partial".into(),
                    share_pct: Some(rust_decimal::Decimal::new(50, 2)),
                },
            ],
        );
        assert!(ok.is_ok());
    }
}
