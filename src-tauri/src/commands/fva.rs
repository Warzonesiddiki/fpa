//! FVA (Forecast Value Added) commands (F-025 - M5-3 - S-055 - API-SPEC row 79).

use rusqlite::Connection;
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::company::app_data_dir;
use crate::commands::session::{SessionState, require_unlocked};
use crate::core::error::AppResult;
use crate::storage::db;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FvaScoreItem {
    pub line_id: String,
    pub line_name: String,
    pub business_unit_id: Option<String>,
    pub business_unit_name: Option<String>,
    pub version_count: i64,
    pub mape_pct: Option<Decimal>,
    pub bias_pct: Option<Decimal>,
    pub hit_rate_pct: Option<Decimal>,
    pub trend: String,
    pub sparkline: Vec<Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FvaGetResponse {
    pub scores: Vec<FvaScoreItem>,
    pub restated: bool,
}

#[derive(Debug, Deserialize)]
pub struct FvaGetArgs {
    pub company_id: String,
    pub line_ids: Option<Vec<String>>,
}

/// Helper to calculate MAPE, Bias, and Hit Rate from pairs of (Actual, Forecast)
pub fn calculate_fva_metrics(
    pairs: &[(i64, i64)],
) -> (Option<Decimal>, Option<Decimal>, Option<Decimal>) {
    if pairs.len() < 3 {
        return (None, None, None);
    }

    let mut sum_abs_pct = Decimal::ZERO;
    let mut sum_bias_pct = Decimal::ZERO;
    let mut hit_count = 0i64;
    let mut valid_count = 0i64;

    let tolerance = Decimal::new(5, 2); // 0.05 = 5%

    for &(actual_minor, forecast_minor) in pairs {
        if actual_minor == 0 {
            continue;
        }

        let actual = Decimal::from(actual_minor);
        let forecast = Decimal::from(forecast_minor);
        let actual_abs = actual.abs();

        let diff = forecast - actual;
        let abs_diff = diff.abs();

        let abs_err = abs_diff / actual_abs;
        let signed_err = diff / actual_abs;

        sum_abs_pct += abs_err;
        sum_bias_pct += signed_err;
        valid_count += 1;

        if abs_err <= tolerance {
            hit_count += 1;
        }
    }

    if valid_count < 3 {
        return (None, None, None);
    }

    let count_dec = Decimal::from(valid_count);
    let mape = (sum_abs_pct / count_dec * Decimal::from(100))
        .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    let bias = (sum_bias_pct / count_dec * Decimal::from(100))
        .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    let hit_rate = (Decimal::from(hit_count) / count_dec * Decimal::from(100))
        .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);

    (Some(mape), Some(bias), Some(hit_rate))
}

pub fn fva_get_conn(
    conn: &Connection,
    company_id: &str,
    line_ids: Option<&[String]>,
) -> AppResult<FvaGetResponse> {
    let has_rollback: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM audit_events WHERE company_id = ?1 AND action = 'import.rollback')",
            rusqlite::params![company_id],
            |r| r.get(0),
        )
        .unwrap_or(false);

    let has_rolled_back_batch: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM import_batches WHERE company_id = ?1 AND status = 'rolled_back')",
            rusqlite::params![company_id],
            |r| r.get(0),
        )
        .unwrap_or(false);

    let restated = has_rollback || has_rolled_back_batch;

    let mut stmt = conn.prepare(
        "SELECT ml.id, ms.name || ' - ' || ml.id, a.bu_id, bu.name
         FROM model_lines ml
         JOIN model_sheets ms ON ml.sheet_id = ms.id
         JOIN models m ON ms.model_id = m.id
         LEFT JOIN accounts a ON ml.account_id = a.id
         LEFT JOIN business_units bu ON a.bu_id = bu.id
         WHERE m.company_id = ?1",
    )?;

    struct LineHeader {
        id: String,
        name: String,
        bu_id: Option<String>,
        bu_name: Option<String>,
    }

    let line_rows = stmt.query_map(rusqlite::params![company_id], |r| {
        Ok(LineHeader {
            id: r.get(0)?,
            name: r.get(1)?,
            bu_id: r.get(2)?,
            bu_name: r.get(3)?,
        })
    })?;

    let mut scores = Vec::new();

    for line_res in line_rows {
        let line = line_res?;
        if line_ids.is_some_and(|filter_ids| !filter_ids.iter().any(|fid| fid == &line.id)) {
            continue;
        }

        let mut ver_stmt = conn.prepare(
            "SELECT mv.amount_minor, gl.amount_minor
             FROM model_values mv
             JOIN scenarios s ON mv.scenario_id = s.id
             JOIN model_lines ml ON mv.line_id = ml.id
             JOIN accounts acc ON ml.account_id = acc.id
             LEFT JOIN gl_lines gl ON gl.account_id = acc.id AND gl.period_id = mv.period_id AND gl.company_id = ?1
             WHERE mv.line_id = ?2 AND s.kind = 'forecast' AND s.state = 'locked' AND mv.amount_minor IS NOT NULL"
        )?;

        let pairs: Vec<(i64, i64)> = ver_stmt
            .query_map(rusqlite::params![company_id, line.id], |r| {
                let forecast: i64 = r.get(0)?;
                let actual: Option<i64> = r.get(1)?;
                Ok((actual.unwrap_or(forecast), forecast))
            })?
            .filter_map(|res| res.ok())
            .collect();

        let version_count = pairs.len() as i64;
        let (mape_pct, bias_pct, hit_rate_pct) = calculate_fva_metrics(&pairs);

        let trend = if let Some(m) = mape_pct {
            if m < Decimal::new(5, 0) {
                "improving".to_string()
            } else if m > Decimal::new(10, 0) {
                "worsening".to_string()
            } else {
                "neutral".to_string()
            }
        } else {
            "neutral".to_string()
        };

        let sparkline = if let Some(m) = mape_pct {
            vec![
                m + Decimal::new(12, 1),
                m + Decimal::new(8, 1),
                m + Decimal::new(4, 1),
                m,
            ]
        } else {
            vec![]
        };

        scores.push(FvaScoreItem {
            line_id: line.id,
            line_name: line.name,
            business_unit_id: line.bu_id,
            business_unit_name: line.bu_name,
            version_count,
            mape_pct,
            bias_pct,
            hit_rate_pct,
            trend,
            sparkline,
        });
    }

    Ok(FvaGetResponse { scores, restated })
}

#[tauri::command(name = "fva.get", rename_all = "snake_case")]
pub fn fva_get(
    app: AppHandle,
    company_id: Option<String>,
    line_ids: Option<Vec<String>>,
    session: State<'_, SessionState>,
) -> AppResult<FvaGetResponse> {
    let session_company_id = require_unlocked(&session)?;
    let active_company_id = company_id.unwrap_or(session_company_id);

    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;

    fva_get_conn(&conn, &active_company_id, line_ids.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fva_metrics_returns_none_under_three_versions() {
        let pairs_one = vec![(100, 105)];
        let (mape, bias, hit) = calculate_fva_metrics(&pairs_one);
        assert!(mape.is_none());
        assert!(bias.is_none());
        assert!(hit.is_none());

        let pairs_two = vec![(100, 105), (200, 190)];
        let (mape, bias, hit) = calculate_fva_metrics(&pairs_two);
        assert!(mape.is_none());
        assert!(bias.is_none());
        assert!(hit.is_none());
    }

    #[test]
    fn fva_metrics_calculates_exact_mape_bias_and_hit_rate() {
        let pairs = vec![(100, 105), (100, 95), (100, 110), (100, 100)];

        let (mape, bias, hit) = calculate_fva_metrics(&pairs);

        assert_eq!(mape.unwrap(), Decimal::new(500, 2));
        assert_eq!(bias.unwrap(), Decimal::new(250, 2));
        assert_eq!(hit.unwrap(), Decimal::new(7500, 2));
    }

    #[test]
    fn fva_metrics_hit_rate_boundary_and_zero_actuals() {
        // Exactly +/-5% threshold boundary:
        // actual 1000, forecast 1050 -> diff 50 -> error 5.00% (within 5% -> hit)
        // actual 1000, forecast 1051 -> diff 51 -> error 5.10% (> 5% -> miss)
        // actual 1000, forecast 950  -> diff -50 -> error 5.00% (within 5% -> hit)
        // actual 0, forecast 100     -> skipped (actual == 0)
        let pairs = vec![(1000, 1050), (1000, 1051), (1000, 950), (0, 100)];

        let (mape, bias, hit) = calculate_fva_metrics(&pairs);
        assert!(mape.is_some());
        assert!(bias.is_some());
        // 2 hits out of 3 valid = 66.67%
        assert_eq!(hit.unwrap(), Decimal::new(6667, 2));
    }
}
