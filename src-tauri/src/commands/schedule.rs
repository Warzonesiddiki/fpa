//! model.schedule.upsert (F-016 · M3-6 · S-045 · API-SPEC §3 · MODELING-METHODS-SPEC §6).
//!
//! Native handler for headcount schedule calculations and persistence:
//!  * Strict date validation: ISO dates, termination >= start, dates within active fiscal horizon.
//!  * Same-role and cost-center overlap checking (`HC_OVERLAP`).
//!  * Day-count proration and linear ramp factor calculation with `rust_decimal::Decimal` (B3/B14 - no float).
//!  * Persists rollup calculations to `model_values` and audit log in a single SQLite transaction.
//!  * Chained HMAC-SHA256 audit event.

use chrono::NaiveDate;
use rusqlite::OptionalExtension;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use tauri::{AppHandle, State};

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{SessionState, require_session_write};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::core::model;
use crate::storage::{db, keystore};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct HeadcountScheduleRowInput {
    pub id: Option<String>,
    pub role: String,
    pub cost_center: String,
    pub start_date: String,
    pub termination_date: Option<String>,
    pub base_comp_decimal: String,
    #[serde(default = "default_zero")]
    pub bonus_pct: String,
    #[serde(default = "default_zero")]
    pub benefits_pct: String,
    #[serde(default = "default_zero")]
    pub employer_load_pct: String,
    #[serde(default)]
    pub ramp_months: u32,
}

fn default_zero() -> String {
    "0".to_string()
}

#[derive(Debug, Clone)]
pub struct FiscalPeriodRow {
    pub id: String,
    pub name: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
}

fn row_id(row: &HeadcountScheduleRowInput, index: usize) -> String {
    row.id
        .clone()
        .unwrap_or_else(|| format!("hc-row-{}", index + 1))
}

fn parse_iso_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

fn parse_decimal(label: &str, value: &str) -> AppResult<Decimal> {
    Decimal::from_str(value).map_err(|_| {
        AppError::invalid(format!(
            "VALUE_INVALID: {label} must be an exact decimal string"
        ))
    })
}

fn validate_headcount_rows(
    rows: &[HeadcountScheduleRowInput],
    periods: &[FiscalPeriodRow],
) -> AppResult<()> {
    if rows.is_empty() {
        return Ok(());
    }

    let first_date = periods.first().map(|p| p.start_date);
    let last_date = periods.last().map(|p| p.end_date);

    for (index, row) in rows.iter().enumerate() {
        let rid = row_id(row, index);

        let start = match parse_iso_date(&row.start_date) {
            Some(d) => d,
            None => {
                return Err(AppError::hc_date_invalid(
                    rid,
                    index,
                    "not_an_iso_calendar_date",
                ));
            }
        };

        let end = match &row.termination_date {
            Some(s) => match parse_iso_date(s) {
                Some(d) => Some(d),
                None => {
                    return Err(AppError::hc_date_invalid(
                        rid,
                        index,
                        "not_an_iso_calendar_date",
                    ));
                }
            },
            None => None,
        };

        if let Some(end_d) = end
            && end_d < start
        {
            return Err(AppError::hc_date_invalid(
                rid,
                index,
                "termination_before_start",
            ));
        }

        if let Some(first) = first_date
            && start < first
        {
            return Err(AppError::hc_date_invalid(
                rid,
                index,
                "start_before_first_period",
            ));
        }

        if let Some(last) = last_date
            && start > last
        {
            return Err(AppError::hc_date_invalid(
                rid,
                index,
                "start_after_last_period",
            ));
        }

        if row.role.trim().is_empty() || row.cost_center.trim().is_empty() {
            return Err(AppError::invalid(
                "VALUE_INVALID: role and cost_center are required",
            ));
        }
        if row.role.trim().len() > 120 || row.cost_center.trim().len() > 120 {
            return Err(AppError::invalid(
                "VALUE_INVALID: role and cost_center max length is 120",
            ));
        }
        if row.ramp_months > 120 {
            return Err(AppError::invalid(
                "VALUE_INVALID: ramp_months must be between 0 and 120",
            ));
        }

        parse_decimal("base_comp_decimal", &row.base_comp_decimal)?;
        parse_decimal("bonus_pct", &row.bonus_pct)?;
        parse_decimal("benefits_pct", &row.benefits_pct)?;
        parse_decimal("employer_load_pct", &row.employer_load_pct)?;
    }

    // Check same-role, same-cost-center overlaps
    let mut same_role: HashMap<(String, String), Vec<(usize, &HeadcountScheduleRowInput)>> =
        HashMap::new();
    for (index, row) in rows.iter().enumerate() {
        let key = (
            row.role.trim().to_lowercase(),
            row.cost_center.trim().to_lowercase(),
        );
        same_role.entry(key).or_default().push((index, row));
    }

    let far_future = NaiveDate::from_ymd_opt(9999, 12, 31).expect("valid far future date");
    let fallback_end = last_date.unwrap_or(far_future);

    for group in same_role.values() {
        for i in 0..group.len() {
            let (left_idx, left_row) = group[i];
            let left_start = parse_iso_date(&left_row.start_date).unwrap();
            let left_end = left_row
                .termination_date
                .as_deref()
                .and_then(parse_iso_date)
                .unwrap_or(fallback_end);

            for &(right_idx, right_row) in group.iter().skip(i + 1) {
                let right_start = parse_iso_date(&right_row.start_date).unwrap();
                let right_end = right_row
                    .termination_date
                    .as_deref()
                    .and_then(parse_iso_date)
                    .unwrap_or(fallback_end);

                let overlap = left_start <= right_end && right_start <= left_end;
                if overlap {
                    let period_id = periods
                        .iter()
                        .find(|p| {
                            left_start <= p.end_date
                                && right_start <= p.end_date
                                && left_end >= p.start_date
                                && right_end >= p.start_date
                        })
                        .map(|p| p.id.clone());

                    return Err(AppError::hc_overlap(
                        left_row.role.trim(),
                        left_row.cost_center.trim(),
                        period_id,
                        vec![row_id(left_row, left_idx), row_id(right_row, right_idx)],
                    ));
                }
            }
        }
    }

    Ok(())
}

fn load_fiscal_periods(
    conn: &rusqlite::Connection,
    model_id: &str,
) -> AppResult<Vec<FiscalPeriodRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT fp.id, fp.name, fp.start_date, fp.end_date
             FROM fiscal_periods fp
             JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
             JOIN fiscal_calendars fc ON fc.id = fy.calendar_id
             JOIN models m ON m.company_id = fc.company_id
             WHERE m.id = ?1
             ORDER BY fp.start_date ASC",
        )
        .map_err(AppError::from)?;

    let rows = stmt
        .query_map([model_id], |r| {
            let start_str: String = r.get(2)?;
            let end_str: String = r.get(3)?;
            let start = NaiveDate::parse_from_str(&start_str, "%Y-%m-%d").unwrap_or_default();
            let end = NaiveDate::parse_from_str(&end_str, "%Y-%m-%d").unwrap_or_default();
            Ok(FiscalPeriodRow {
                id: r.get(0)?,
                name: r.get(1)?,
                start_date: start,
                end_date: end,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    Ok(rows)
}

fn model_belongs_to_company(
    conn: &rusqlite::Connection,
    model_id: &str,
    company_id: &str,
) -> AppResult<bool> {
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM models WHERE id = ?1 AND company_id = ?2)",
            rusqlite::params![model_id, company_id],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    Ok(exists)
}

/// Calculate headcount rollups per fiscal period (matching src/model/headcount.ts).
pub fn calculate_rollups(
    rows: &[HeadcountScheduleRowInput],
    periods: &[FiscalPeriodRow],
) -> Vec<(String, i64, Decimal)> {
    if periods.is_empty() || rows.is_empty() {
        return Vec::new();
    }

    let period_count = Decimal::from(periods.len().max(1));
    let one_hundred = Decimal::from(100);

    periods
        .iter()
        .enumerate()
        .map(|(p_idx, period)| {
            let mut active_count: i64 = 0;
            let mut total_cost = Decimal::ZERO;

            for row in rows {
                let start = match parse_iso_date(&row.start_date) {
                    Some(d) => d,
                    None => continue,
                };
                let term = row.termination_date.as_deref().and_then(parse_iso_date);

                let act_start = start.max(period.start_date);
                let act_end = term.unwrap_or(period.end_date).min(period.end_date);

                if act_start > act_end {
                    continue;
                }

                let active_days = (act_end - act_start).num_days() + 1;
                let period_days = (period.end_date - period.start_date).num_days() + 1;
                if period_days <= 0 || active_days <= 0 {
                    continue;
                }

                active_count += 1;

                let base = Decimal::from_str(&row.base_comp_decimal).unwrap_or(Decimal::ZERO);
                let bonus = Decimal::from_str(&row.bonus_pct).unwrap_or(Decimal::ZERO);
                let benefits = Decimal::from_str(&row.benefits_pct).unwrap_or(Decimal::ZERO);
                let load = Decimal::from_str(&row.employer_load_pct).unwrap_or(Decimal::ZERO);

                let load_mult = Decimal::ONE + (bonus + benefits + load) / one_hundred;
                let proration = Decimal::from(active_days) / Decimal::from(period_days);

                let ramp = if row.ramp_months == 0 {
                    Decimal::ONE
                } else {
                    let first_active = periods.iter().position(|p| p.end_date >= start);
                    match first_active {
                        Some(fa) if p_idx >= fa => {
                            let months = (p_idx - fa + 1).min(row.ramp_months as usize);
                            Decimal::from(months) / Decimal::from(row.ramp_months)
                        }
                        _ => Decimal::ZERO,
                    }
                };

                let cost = (base / period_count) * load_mult * proration * ramp;
                total_cost += cost;
            }

            (period.id.clone(), active_count, total_cost.round_dp(2))
        })
        .collect()
}

/// `model.schedule.upsert` — S-045 headcount schedule handler.
#[tauri::command(name = "model.schedule.upsert", rename_all = "snake_case")]
pub fn model_schedule_upsert(
    app: AppHandle,
    model_id: String,
    schedule_type: String,
    rows: Vec<HeadcountScheduleRowInput>,
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&state)?;

    if schedule_type != "headcount" {
        return Err(AppError::invalid(format!(
            "VALUE_INVALID: unsupported schedule type: {schedule_type}"
        )));
    }

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    if !model_belongs_to_company(&conn, &model_id, &company_id)? {
        return Err(AppError::Scope(
            "model is not owned by the active Company".into(),
        ));
    }

    let periods = load_fiscal_periods(&conn, &model_id)?;
    validate_headcount_rows(&rows, &periods)?;

    let changed_cells: Vec<String> = rows.iter().enumerate().map(|(i, r)| row_id(r, i)).collect();

    let tx = conn.transaction().map_err(AppError::from)?;

    // Retrieve or allocate stable schedule_id for this model
    let existing_schedule_id: Option<String> = tx
        .query_row(
            "SELECT object_id FROM audit_events
             WHERE company_id = ?1 AND action = 'model.schedule.upsert'
               AND json_extract(after_json, '$.model_id') = ?2
             ORDER BY seq DESC LIMIT 1",
            rusqlite::params![company_id, model_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    let schedule_id = existing_schedule_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Optional model_values rollup persistence if scenario exists
    let rollups = calculate_rollups(&rows, &periods);
    if !rollups.is_empty() {
        let scenario_id: Option<String> = tx
            .query_row(
                "SELECT current_scenario_id FROM models WHERE id = ?1",
                [&model_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(AppError::from)?
            .flatten();

        if let Some(scen_id) = scenario_id {
            let sheet_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM model_sheets WHERE model_id = ?1 AND sheet_type = 'schedule' LIMIT 1",
                    [&model_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(AppError::from)?;

            let target_sheet_id = match sheet_id {
                Some(s) => s,
                None => {
                    let new_sheet_id = uuid::Uuid::new_v4().to_string();
                    tx.execute(
                        "INSERT INTO model_sheets (id, model_id, name, sheet_type, sort_order)
                         VALUES (?1, ?2, 'Headcount Schedule', 'schedule', 10)",
                        rusqlite::params![new_sheet_id, model_id],
                    )
                    .map_err(AppError::from)?;
                    new_sheet_id
                }
            };

            let line_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM model_lines WHERE sheet_id = ?1 AND format = 'money' LIMIT 1",
                    [&target_sheet_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(AppError::from)?;

            let target_line_id = match line_id {
                Some(l) => l,
                None => {
                    let new_line_id = uuid::Uuid::new_v4().to_string();
                    tx.execute(
                        "INSERT INTO model_lines (id, sheet_id, method, format, decimals, is_parent, sort_order)
                         VALUES (?1, ?2, 'driver', 'money', 2, 0, 1)",
                        rusqlite::params![new_line_id, target_sheet_id],
                    )
                    .map_err(AppError::from)?;
                    new_line_id
                }
            };

            for (p_id, _hc_count, total_cost) in &rollups {
                let cost_minor = (total_cost * Decimal::from(100))
                    .to_string()
                    .parse::<i64>()
                    .unwrap_or(0);
                let cost_text = total_cost.to_string();
                let val_id = uuid::Uuid::new_v4().to_string();

                tx.execute(
                    "INSERT INTO model_values (id, line_id, scenario_id, period_id, amount_minor, amount_text, computed)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
                     ON CONFLICT(line_id, scenario_id, period_id) DO UPDATE SET
                       amount_minor = excluded.amount_minor,
                       amount_text = excluded.amount_text,
                       computed = 1",
                    rusqlite::params![val_id, target_line_id, scen_id, p_id, cost_minor, cost_text],
                )
                .map_err(AppError::from)?;
            }
        }
    }

    // HMAC chained audit event
    let now = chrono::Utc::now().to_rfc3339();
    let after_json = serde_json::json!({
        "schedule_id": schedule_id,
        "model_id": model_id,
        "schedule_type": "headcount",
        "row_count": rows.len(),
        "rows": rows,
    })
    .to_string();

    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());

    tx.execute(
        "INSERT INTO audit_events
           (company_id, actor, action, object_type, object_id, before_json, after_json,
            prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'model.schedule.upsert', 'schedule', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, schedule_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    let audit_id = tx.last_insert_rowid();
    tx.commit().map_err(AppError::from)?;

    let recalc = model::recalc_report(rows.len(), vec![], changed_cells, 0);

    Ok(serde_json::json!({
        "data": {
            "schedule_id": schedule_id,
            "recalc": recalc,
            "audit_id": audit_id,
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_period(id: &str, start: &str, end: &str) -> FiscalPeriodRow {
        FiscalPeriodRow {
            id: id.to_string(),
            name: id.to_string(),
            start_date: NaiveDate::parse_from_str(start, "%Y-%m-%d").unwrap(),
            end_date: NaiveDate::parse_from_str(end, "%Y-%m-%d").unwrap(),
        }
    }

    fn sample_row(id: Option<&str>, start: &str, term: Option<&str>) -> HeadcountScheduleRowInput {
        HeadcountScheduleRowInput {
            id: id.map(|s| s.to_string()),
            role: "Software Engineer".to_string(),
            cost_center: "R&D".to_string(),
            start_date: start.to_string(),
            termination_date: term.map(|s| s.to_string()),
            base_comp_decimal: "120000.00".to_string(),
            bonus_pct: "10.00".to_string(),
            benefits_pct: "5.00".to_string(),
            employer_load_pct: "8.00".to_string(),
            ramp_months: 0,
        }
    }

    #[test]
    fn validation_accepts_valid_rows() {
        let periods = vec![
            sample_period("p1", "2026-01-01", "2026-01-31"),
            sample_period("p2", "2026-02-01", "2026-02-28"),
        ];
        let rows = vec![sample_row(Some("hc-1"), "2026-01-15", None)];
        assert!(validate_headcount_rows(&rows, &periods).is_ok());
    }

    #[test]
    fn validation_rejects_bad_date_format() {
        let periods = vec![sample_period("p1", "2026-01-01", "2026-01-31")];
        let rows = vec![sample_row(Some("hc-1"), "2026-02-30", None)];
        let err = validate_headcount_rows(&rows, &periods).unwrap_err();
        assert_eq!(err.body().code, "HC_DATE_INVALID");
        assert_eq!(err.body().details["reason"], "not_an_iso_calendar_date");
    }

    #[test]
    fn validation_rejects_termination_before_start() {
        let periods = vec![sample_period("p1", "2026-01-01", "2026-01-31")];
        let rows = vec![sample_row(Some("hc-1"), "2026-01-15", Some("2026-01-10"))];
        let err = validate_headcount_rows(&rows, &periods).unwrap_err();
        assert_eq!(err.body().code, "HC_DATE_INVALID");
        assert_eq!(err.body().details["reason"], "termination_before_start");
    }

    #[test]
    fn validation_rejects_hire_outside_fiscal_horizon() {
        let periods = vec![
            sample_period("p1", "2026-01-01", "2026-01-31"),
            sample_period("p2", "2026-02-01", "2026-02-28"),
        ];
        let before = vec![sample_row(Some("hc-1"), "2025-12-31", None)];
        let err_before = validate_headcount_rows(&before, &periods).unwrap_err();
        assert_eq!(err_before.body().code, "HC_DATE_INVALID");
        assert_eq!(
            err_before.body().details["reason"],
            "start_before_first_period"
        );

        let after = vec![sample_row(Some("hc-2"), "2026-03-01", None)];
        let err_after = validate_headcount_rows(&after, &periods).unwrap_err();
        assert_eq!(err_after.body().code, "HC_DATE_INVALID");
        assert_eq!(
            err_after.body().details["reason"],
            "start_after_last_period"
        );
    }

    #[test]
    fn validation_rejects_same_role_and_cost_center_overlap() {
        let periods = vec![
            sample_period("p1", "2026-01-01", "2026-01-31"),
            sample_period("p2", "2026-02-01", "2026-02-28"),
        ];
        let rows = vec![
            sample_row(Some("hc-1"), "2026-01-01", None),
            sample_row(Some("hc-2"), "2026-01-15", None),
        ];
        let err = validate_headcount_rows(&rows, &periods).unwrap_err();
        assert_eq!(err.body().code, "HC_OVERLAP");
        assert_eq!(err.body().details["role"], "Software Engineer");
        assert_eq!(err.body().details["cost_center"], "R&D");
        assert_eq!(
            err.body().details["row_ids"],
            serde_json::json!(["hc-1", "hc-2"])
        );
    }

    #[test]
    fn rollup_calculation_exact_proration_and_additive_load() {
        let periods = vec![
            sample_period("p1", "2026-01-01", "2026-01-31"), // 31 days
            sample_period("p2", "2026-02-01", "2026-02-28"), // 28 days
        ];
        // 2 periods total. Base = 120,000. Base/period = 60,000.
        // bonus 10% + benefits 5% + load 8% = 23% additive load. Multiplier = 1.23.
        // Full period cost = 60,000 * 1.23 = 73,800.00.
        // Hired 2026-01-17: active 15 days in P1 (17th to 31st inclusive). Proration = 15/31.
        // P1 cost = 73,800 * (15 / 31) = 35709.6774... -> 35709.68.
        let rows = vec![sample_row(Some("hc-1"), "2026-01-17", None)];
        let rollups = calculate_rollups(&rows, &periods);

        assert_eq!(rollups.len(), 2);
        assert_eq!(rollups[0].0, "p1");
        assert_eq!(rollups[0].1, 1); // active headcount
        assert_eq!(rollups[0].2, Decimal::from_str("35709.68").unwrap());

        assert_eq!(rollups[1].0, "p2");
        assert_eq!(rollups[1].1, 1);
        assert_eq!(rollups[1].2, Decimal::from_str("73800.00").unwrap());
    }
}
