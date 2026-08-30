//! `calendar.preview` — pure engine output (F-003). No DB writes: the UI previews before `calendar.apply`.

use chrono::NaiveDate;

use crate::core::calendar::{build_12month, build_week_based, CalendarPreset, WeekRule};
use crate::core::error::{AppError, AppResult};

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
}
