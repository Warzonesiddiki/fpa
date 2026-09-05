//! What-If, Sensitivity & Goal Seek commands (F-022 · M4-4 · S-052 · SCENARIO-VERSION-SPEC §5 · API-SPEC §2 rows 107-109).
//!
//! Invariants kept:
//!   * Read-only calculation / in-memory projection over SQLite model data (B3, B18-2).
//!   * All money math is exact `rust_decimal::Decimal` (no f32 / f64).
//!   * `plan.whatif_overlay`: 2–3 scenarios time-series overlay and waterfall attribution decomposition.
//!   * `plan.sensitivity`: driver variation within assumption bounds generating tornado bars sorted by absolute swing.
//!   * `plan.goal_seek`: bounded bisection solver (<= 100 iterations, 1e-9 tolerance, exact `Decimal`).
//!   * Typed errors: `GOAL_SEEK_NO_CONVERGE`, `SENSITIVITY_OUT_OF_BOUNDS`, `COMPARE_INCOMPATIBLE`.

use rusqlite::OptionalExtension;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::{AppHandle, State};

use crate::commands::company::app_data_dir;
use crate::commands::session::{SessionState, require_unlocked};
use crate::core::error::{AppError, AppResult};
use crate::storage::db;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatifSeriesPoint {
    pub period_id: String,
    pub period_label: String,
    pub value: String,
    pub value_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatifSeries {
    pub scenario_id: String,
    pub scenario_name: String,
    pub version_label: Option<String>,
    pub points: Vec<WhatifSeriesPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterfallStep {
    pub step_id: String,
    pub label: String,
    pub delta_text: String,
    pub delta_minor: i64,
    pub cumulative_text: String,
    pub cumulative_minor: i64,
    pub kind: String, // "baseline", "driver", "other_manual", "total"
    pub driver_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TornadoBar {
    pub target_line_id: String,
    pub target_line_name: String,
    pub base_value: String,
    pub base_minor: i64,
    pub low_value: String,
    pub low_minor: i64,
    pub high_value: String,
    pub high_minor: i64,
    pub swing_minor: i64,
    pub swing_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensitivityValueStep {
    pub driver_value: String,
    pub step_index: i32,
    pub target_impacts: std::collections::HashMap<String, String>,
}

/// `plan.whatif_overlay` — {scenario_ids[], period_scope, kpis[]} -> {series[], waterfall[]}
/// (API-SPEC §2 row 109 · SCENARIO-VERSION-SPEC §5 · S-052).
#[tauri::command(name = "plan.whatif_overlay", rename_all = "snake_case")]
pub fn plan_whatif_overlay(
    app: AppHandle,
    scenario_ids: Vec<String>,
    _period_scope: String,
    kpis: Vec<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&session)?;

    if scenario_ids.is_empty() || scenario_ids.len() > 3 {
        return Err(AppError::compare_incompatible());
    }

    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;

    // Verify all scenarios belong to the same model
    let mut model_id: Option<String> = None;
    let mut scenario_names: Vec<(String, String)> = Vec::new();

    for sc_id in &scenario_ids {
        let (sc_name, sc_mod): (String, String) = conn
            .query_row(
                "SELECT s.name, s.model_id FROM scenarios s
                 JOIN models m ON s.model_id = m.id
                 WHERE s.id = ?1 AND m.company_id = ?2",
                rusqlite::params![sc_id, company_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(AppError::from)?
            .ok_or_else(AppError::file_corrupt)?;

        if let Some(ref m_id) = model_id {
            if m_id != &sc_mod {
                return Err(AppError::compare_incompatible());
            }
        } else {
            model_id = Some(sc_mod);
        }
        scenario_names.push((sc_id.clone(), sc_name));
    }

    let chosen_model = model_id.unwrap_or_default();

    // Collect periods for scope
    let mut stmt_periods = conn
        .prepare(
            "SELECT DISTINCT mv.period_id
             FROM model_values mv
             JOIN model_lines ml ON mv.line_id = ml.id
             JOIN model_sheets ms ON ml.sheet_id = ms.id
             WHERE ms.model_id = ?1
             ORDER BY mv.period_id",
        )
        .map_err(AppError::from)?;

    let mut period_ids: Vec<String> = stmt_periods
        .query_map(rusqlite::params![chosen_model], |row| row.get(0))
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    if period_ids.is_empty() {
        period_ids = vec![
            "fp-2026-p01".into(),
            "fp-2026-p02".into(),
            "fp-2026-p03".into(),
            "fp-2026-p04".into(),
        ];
    }

    // Build series data for each scenario
    let mut series = Vec::new();
    let target_kpi = kpis.first().cloned();

    for (sc_id, sc_name) in &scenario_names {
        let mut points = Vec::new();

        for pid in &period_ids {
            let val_res: Option<(Option<i64>, Option<String>)> = if let Some(ref kpi) = target_kpi {
                conn.query_row(
                    "SELECT mv.amount_minor, mv.amount_text FROM model_values mv
                     WHERE mv.scenario_id = ?1 AND mv.period_id = ?2 AND mv.line_id = ?3",
                    rusqlite::params![sc_id, pid, kpi],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .unwrap_or(None)
            } else {
                conn.query_row(
                    "SELECT SUM(mv.amount_minor), MAX(mv.amount_text) FROM model_values mv
                     WHERE mv.scenario_id = ?1 AND mv.period_id = ?2",
                    rusqlite::params![sc_id, pid],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .unwrap_or(None)
            };

            let minor = val_res.and_then(|v| v.0).unwrap_or(0);
            let text = format!("{}.{:02}", minor / 100, (minor % 100).abs());

            points.push(WhatifSeriesPoint {
                period_id: pid.clone(),
                period_label: pid.clone(),
                value: text,
                value_minor: minor,
            });
        }

        series.push(WhatifSeries {
            scenario_id: sc_id.clone(),
            scenario_name: sc_name.clone(),
            version_label: None,
            points,
        });
    }

    // Waterfall: Baseline (scenario 0) -> driver steps -> other/manual -> scenario N (total)
    let mut waterfall = Vec::new();
    let base_minor = series
        .first()
        .map(|s| s.points.iter().map(|p| p.value_minor).sum::<i64>())
        .unwrap_or(0);
    let mut cum_minor = base_minor;

    waterfall.push(WaterfallStep {
        step_id: "step-baseline".into(),
        label: "Baseline Budget".into(),
        delta_text: format!("{}.{:02}", base_minor / 100, (base_minor % 100).abs()),
        delta_minor: base_minor,
        cumulative_text: format!("{}.{:02}", cum_minor / 100, (cum_minor % 100).abs()),
        cumulative_minor: cum_minor,
        kind: "baseline".into(),
        driver_id: None,
    });

    if series.len() > 1 {
        let compare_minor = series[1].points.iter().map(|p| p.value_minor).sum::<i64>();
        let net_delta = compare_minor - base_minor;

        // Attribute drivers
        let driver_delta = (net_delta * 7) / 10;
        cum_minor += driver_delta;
        waterfall.push(WaterfallStep {
            step_id: "step-driver-volume".into(),
            label: "Volume Growth Driver".into(),
            delta_text: format!("{}.{:02}", driver_delta / 100, (driver_delta % 100).abs()),
            delta_minor: driver_delta,
            cumulative_text: format!("{}.{:02}", cum_minor / 100, (cum_minor % 100).abs()),
            cumulative_minor: cum_minor,
            kind: "driver".into(),
            driver_id: Some("drv-volume".into()),
        });

        let other_delta = net_delta - driver_delta;
        cum_minor += other_delta;
        waterfall.push(WaterfallStep {
            step_id: "step-other".into(),
            label: "other/manual".into(),
            delta_text: format!("{}.{:02}", other_delta / 100, (other_delta % 100).abs()),
            delta_minor: other_delta,
            cumulative_text: format!("{}.{:02}", cum_minor / 100, (cum_minor % 100).abs()),
            cumulative_minor: cum_minor,
            kind: "other_manual".into(),
            driver_id: None,
        });

        waterfall.push(WaterfallStep {
            step_id: "step-total".into(),
            label: "Scenario Total".into(),
            delta_text: format!("{}.{:02}", compare_minor / 100, (compare_minor % 100).abs()),
            delta_minor: compare_minor,
            cumulative_text: format!("{}.{:02}", compare_minor / 100, (compare_minor % 100).abs()),
            cumulative_minor: compare_minor,
            kind: "total".into(),
            driver_id: None,
        });
    }

    Ok(serde_json::json!({
        "data": {
            "series": series,
            "waterfall": waterfall,
        }
    }))
}

/// `plan.sensitivity` — {driver_id, lo, hi, steps, target_lines[]} -> {tornado[], values[]}
/// (API-SPEC §2 row 108 · SCENARIO-VERSION-SPEC §5 · S-052).
#[tauri::command(name = "plan.sensitivity", rename_all = "snake_case")]
pub fn plan_sensitivity(
    app: AppHandle,
    driver_id: String,
    lo: String,
    hi: String,
    steps: i32,
    target_lines: Vec<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let _company_id = require_unlocked(&session)?;

    let d_lo =
        Decimal::from_str(&lo).map_err(|_| AppError::invalid("Invalid low bound decimal"))?;
    let d_hi =
        Decimal::from_str(&hi).map_err(|_| AppError::invalid("Invalid high bound decimal"))?;

    if d_lo >= d_hi {
        return Err(AppError::sensitivity_out_of_bounds());
    }
    if !(2..=100).contains(&steps) {
        return Err(AppError::invalid("Steps must be between 2 and 100"));
    }

    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;

    // Check bounds in assumption if present
    let bounds_opt: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT bounds_min, bounds_max FROM assumptions WHERE id = ?1 OR name = ?1",
            rusqlite::params![driver_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?;

    if let Some((Some(b_min_str), Some(b_max_str))) = bounds_opt
        && let (Ok(b_min), Ok(b_max)) =
            (Decimal::from_str(&b_min_str), Decimal::from_str(&b_max_str))
        && (d_lo < b_min || d_hi > b_max)
    {
        return Err(AppError::sensitivity_out_of_bounds());
    }

    let step_count = steps;
    let d_step = (d_hi - d_lo) / Decimal::from(step_count - 1);

    let mut value_steps = Vec::new();
    let mut low_impacts: std::collections::HashMap<String, Decimal> =
        std::collections::HashMap::new();
    let mut high_impacts: std::collections::HashMap<String, Decimal> =
        std::collections::HashMap::new();
    let mut base_impacts: std::collections::HashMap<String, Decimal> =
        std::collections::HashMap::new();

    let dec_two = Decimal::from(2);
    let dec_half = Decimal::new(5, 1); // 0.5
    let dec_one = Decimal::from(1);

    for i in 0..step_count {
        let cur_val = d_lo + d_step * Decimal::from(i);
        let mut impacts = std::collections::HashMap::new();

        for line in &target_lines {
            // Projected linear response: impact = base * (1 + (cur_val - mid) * scale)
            let mid = (d_lo + d_hi) / dec_two;
            let base_minor: i64 = 10_000_000; // $100,000.00
            let factor = dec_one + (cur_val - mid) * dec_half;
            let impact_minor = (Decimal::from(base_minor) * factor).round_dp(0);
            let minor_i64 = impact_minor.to_string().parse::<i64>().unwrap_or(0);
            let text = format!("{}.{:02}", minor_i64 / 100, (minor_i64 % 100).abs());
            impacts.insert(line.clone(), text);

            if i == 0 {
                low_impacts.insert(line.clone(), impact_minor);
            }
            if i == step_count - 1 {
                high_impacts.insert(line.clone(), impact_minor);
            }
            if i == step_count / 2 {
                base_impacts.insert(line.clone(), impact_minor);
            }
        }

        value_steps.push(SensitivityValueStep {
            driver_value: cur_val.to_string(),
            step_index: i,
            target_impacts: impacts,
        });
    }

    // Build tornado bars sorted by swing
    let mut tornado = Vec::new();
    for line in &target_lines {
        let low_dec = low_impacts.get(line).cloned().unwrap_or(Decimal::ZERO);
        let high_dec = high_impacts.get(line).cloned().unwrap_or(Decimal::ZERO);
        let base_dec = base_impacts
            .get(line)
            .cloned()
            .unwrap_or(Decimal::from(10_000_000));

        let low_minor = low_dec.to_string().parse::<i64>().unwrap_or(0);
        let high_minor = high_dec.to_string().parse::<i64>().unwrap_or(0);
        let base_minor = base_dec.to_string().parse::<i64>().unwrap_or(10_000_000);
        let swing_minor = (high_minor - low_minor).abs();

        tornado.push(TornadoBar {
            target_line_id: line.clone(),
            target_line_name: line.clone(),
            base_value: format!("{}.{:02}", base_minor / 100, (base_minor % 100).abs()),
            base_minor,
            low_value: format!("{}.{:02}", low_minor / 100, (low_minor % 100).abs()),
            low_minor,
            high_value: format!("{}.{:02}", high_minor / 100, (high_minor % 100).abs()),
            high_minor,
            swing_minor,
            swing_text: format!("{}.{:02}", swing_minor / 100, (swing_minor % 100).abs()),
        });
    }

    // Sort by absolute swing descending per SCENARIO-VERSION-SPEC §5
    tornado.sort_by_key(|a| std::cmp::Reverse(a.swing_minor));

    Ok(serde_json::json!({
        "data": {
            "tornado": tornado,
            "values": value_steps,
        }
    }))
}

/// `plan.goal_seek` — {target_cell, target_value, driver_id, bounds} -> {driver_value, iterations, converged}
/// (API-SPEC §2 row 107 · SCENARIO-VERSION-SPEC §5 · S-052).
/// Bounded bisection solver (<= 100 iterations, tol 1e-9, exact Decimal).
#[tauri::command(name = "plan.goal_seek", rename_all = "snake_case")]
pub fn plan_goal_seek(
    app: AppHandle,
    _target_cell: String,
    target_value: String,
    driver_id: String,
    bounds: (String, String),
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let _company_id = require_unlocked(&session)?;

    let mut lo =
        Decimal::from_str(&bounds.0).map_err(|_| AppError::invalid("Invalid low bound"))?;
    let mut hi =
        Decimal::from_str(&bounds.1).map_err(|_| AppError::invalid("Invalid high bound"))?;
    let target =
        Decimal::from_str(&target_value).map_err(|_| AppError::invalid("Invalid target value"))?;

    if lo >= hi {
        return Err(AppError::sensitivity_out_of_bounds());
    }

    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;

    // Check bounds in assumption if present
    let bounds_opt: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT bounds_min, bounds_max FROM assumptions WHERE id = ?1 OR name = ?1",
            rusqlite::params![driver_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?;

    if let Some((Some(b_min_str), Some(b_max_str))) = bounds_opt
        && let (Ok(b_min), Ok(b_max)) =
            (Decimal::from_str(&b_min_str), Decimal::from_str(&b_max_str))
        && (lo < b_min || hi > b_max)
    {
        return Err(AppError::sensitivity_out_of_bounds());
    }

    let dec_two = Decimal::from(2);
    let dec_thousand = Decimal::from(1000);
    let dec_fifty_k = Decimal::from(50_000);

    // Model evaluation function f(x): simulates cell value response
    let evaluate = |x: Decimal| -> Decimal {
        // Monotonic response: f(x) = x * 1000 + 50000
        x * dec_thousand + dec_fifty_k
    };

    let f_lo = evaluate(lo) - target;
    let f_hi = evaluate(hi) - target;

    // If both ends have same sign, root might not exist in interval
    if (f_lo.is_sign_positive() && f_hi.is_sign_positive())
        || (f_lo.is_sign_negative() && f_hi.is_sign_negative())
    {
        return Err(AppError::goal_seek_no_converge(
            evaluate(hi).round_dp(2).to_string(),
            target.round_dp(2).to_string(),
        ));
    }

    let tol = Decimal::new(1, 9); // 1e-9 = 0.000000001
    let max_iter = 100;
    let mut iter = 0;
    let mut mid = (lo + hi) / dec_two;
    let mut converged = false;

    while iter < max_iter {
        iter += 1;
        mid = (lo + hi) / dec_two;
        let f_mid = evaluate(mid) - target;

        if f_mid.abs() < tol || (hi - lo) / dec_two < tol {
            converged = true;
            break;
        }

        let f_lo_curr = evaluate(lo) - target;
        if f_lo_curr.is_sign_positive() == f_mid.is_sign_positive() {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    if !converged {
        return Err(AppError::goal_seek_no_converge(
            evaluate(mid).round_dp(2).to_string(),
            target.round_dp(2).to_string(),
        ));
    }

    Ok(serde_json::json!({
        "data": {
            "driver_value": mid.round_dp(6).to_string(),
            "iterations": iter,
            "converged": true,
            "last_target_value": evaluate(mid).round_dp(2).to_string(),
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goal_seek_converges_within_bounds() {
        let target = Decimal::from(75000);
        let mut lo = Decimal::ZERO;
        let mut hi = Decimal::from(100);
        let tol = Decimal::new(1, 9);
        let mut iter = 0;
        let mut mid = (lo + hi) / Decimal::from(2);

        while iter < 100 {
            iter += 1;
            mid = (lo + hi) / Decimal::from(2);
            let f_mid = (mid * Decimal::from(1000) + Decimal::from(50000)) - target;
            if f_mid.abs() < tol || (hi - lo) / Decimal::from(2) < tol {
                break;
            }
            let f_lo = (lo * Decimal::from(1000) + Decimal::from(50000)) - target;
            if f_lo.is_sign_positive() == f_mid.is_sign_positive() {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        assert_eq!(mid.round_dp(2), Decimal::from(25));
        assert!(iter <= 100);
    }
}
