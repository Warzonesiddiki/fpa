//! Variance Analysis and Attribution commands (F-024 · M5-1 · M5-2 · S-054 · API-SPEC §2 row 77-78).
//!
//! Commands:
//! - `variance.get`: `{company_id, period_id, compare, attribution}` -> `{rows[], attribution[], threeway}`
//!   (VARIANCE_SOURCE_MIXED 422, VARIANCE_NO_ATTRIBUTION_DATA 200)
//! - `variance.set_reason_code`: `{line_id, period_id, code, note}` -> `{saved}`
//!
//! Invariants:
//! - Exact integer minor units for all currency math (never float / f32 / f64).
//! - Exact Decimal percentage calculation with Half-Up rounding to 2 decimal places.
//! - Favorable/Unfavorable (F/U) determination relative to account nature:
//!     * Revenue: actual > plan => F (favorable), actual < plan => U (unfavorable)
//!     * Expense (COGS / OPEX): actual < plan => F (favorable), actual > plan => U (unfavorable)
//!     * Asset: actual > plan => F (favorable), actual < plan => U (unfavorable)
//!     * Liability: actual < plan => F (favorable), actual > plan => U (unfavorable)
//!     * Actual == Plan => neutral ("—", "neutral")
//! - Sum of parts invariant: `volume + price + mix + fx + efficiency == variance` for all attributable lines.
//! - 3-Way comparisons: Plan (Budget) vs Commit (Baseline) vs Actuals.
//! - Reason code tagging with narrative notes stored in annotations and audited via HMAC chain.

use rusqlite::{Connection, OptionalExtension, Transaction};
use rust_decimal::prelude::*;
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::str::FromStr;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{SessionState, require_session_write, require_unlocked};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::{db, keystore};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VarianceRow {
    pub line_id: Option<String>,
    pub account_id: String,
    pub account_code: String,
    pub account_name: String,
    pub account_type: String,
    pub report_section: String,
    pub actual_minor: i64,
    pub plan_minor: i64,
    pub variance_minor: i64,
    pub variance_pct: Option<String>,
    pub f_u: String,
    pub direction: String,
    pub reason_code: Option<String>,
    pub reason_label: Option<String>,
    pub note: Option<String>,
    pub has_attribution: bool,
    pub volume_minor: Option<i64>,
    pub price_minor: Option<i64>,
    pub mix_minor: Option<i64>,
    pub fx_minor: Option<i64>,
    pub efficiency_minor: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttributionRow {
    pub line_id: String,
    pub account_id: String,
    pub account_code: String,
    pub account_name: String,
    pub variance_minor: i64,
    pub volume_minor: i64,
    pub price_minor: i64,
    pub mix_minor: i64,
    pub fx_minor: i64,
    pub efficiency_minor: i64,
    pub status: String, // "attributable" | "not_attributable"
    pub sum_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThreeWayRow {
    pub line_id: Option<String>,
    pub account_id: String,
    pub account_code: String,
    pub account_name: String,
    pub account_type: String,
    pub actual_minor: i64,
    pub plan_minor: i64,
    pub commit_minor: i64,
    pub var_actual_vs_plan_minor: i64,
    pub var_actual_vs_plan_pct: Option<String>,
    pub var_actual_vs_plan_fu: String,
    pub var_actual_vs_commit_minor: i64,
    pub var_actual_vs_commit_pct: Option<String>,
    pub var_actual_vs_commit_fu: String,
    pub var_plan_vs_commit_minor: i64,
    pub var_plan_vs_commit_pct: Option<String>,
    pub var_plan_vs_commit_fu: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThreeWayComparison {
    pub actual_scenario_name: String,
    pub plan_scenario_name: String,
    pub commit_scenario_name: String,
    pub rows: Vec<ThreeWayRow>,
    pub total_actual_minor: i64,
    pub total_plan_minor: i64,
    pub total_commit_minor: i64,
    pub total_var_actual_plan_minor: i64,
    pub total_var_actual_commit_minor: i64,
    pub total_var_plan_commit_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VarianceGetResponse {
    pub rows: Vec<VarianceRow>,
    pub attribution: Vec<AttributionRow>,
    pub threeway: ThreeWayComparison,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VarianceSetReasonResponse {
    pub saved: bool,
}

/// Calculate exact decimal percentage (delta / |base| * 100), rounded HALF_UP to 2 places.
pub fn calculate_decimal_pct(delta_minor: i64, base_minor: i64) -> Option<String> {
    if base_minor == 0 {
        if delta_minor == 0 {
            Some("0.00".to_string())
        } else {
            None
        }
    } else {
        let delta_dec = Decimal::from(delta_minor);
        let base_dec = Decimal::from(base_minor.abs());
        let pct_dec = (delta_dec / base_dec * Decimal::from(100))
            .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
        Some(format!("{:.2}", pct_dec))
    }
}

/// Determine Favorable/Unfavorable direction based on account nature.
/// Revenue / Asset / Equity: positive delta is favorable.
/// Expense (COGS / OPEX) / Liability: negative delta is favorable (costs under plan).
pub fn determine_fu(
    account_type: &str,
    actual_minor: i64,
    plan_minor: i64,
) -> (&'static str, &'static str) {
    let delta = actual_minor - plan_minor;
    if delta == 0 {
        return ("—", "neutral");
    }
    let is_expense = matches!(account_type, "cogs" | "opex" | "liability");
    if is_expense {
        if delta < 0 {
            ("F", "favorable")
        } else {
            ("U", "unfavorable")
        }
    } else {
        if delta > 0 {
            ("F", "favorable")
        } else {
            ("U", "unfavorable")
        }
    }
}

fn record_variance_audit(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    action: &str,
    object_id: &str,
    before_json: serde_json::Value,
    after_json: serde_json::Value,
) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let key = keystore::audit_hmac_key(dir).map_err(AppError::internal)?;
    let prev = audited_hash(tx, company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.to_string().as_bytes());
    let before_str = if before_json.is_null() {
        None
    } else {
        Some(before_json.to_string())
    };
    tx.execute(
        "INSERT INTO audit_events
           (company_id, actor, action, object_type, object_id, before_json, after_json,
            prev_hash, hash, created_at)
         VALUES (?1, 'owner', ?2, 'variance', ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            company_id,
            action,
            object_id,
            before_str,
            after_json.to_string(),
            prev,
            hash,
            now,
        ],
    )
    .map_err(AppError::from)?;
    Ok(())
}

/// Internal implementation of `variance.get` for direct testability and command delegation.
pub fn variance_get_internal(
    conn: &Connection,
    company_id: &str,
    period_id: &str,
    compare: Option<&str>,
    attribution: bool,
    hybrid: bool,
    model_id: Option<&str>,
) -> AppResult<VarianceGetResponse> {
    let comp_param = compare.unwrap_or("budget");

    // 1. Check for VARIANCE_SOURCE_MIXED:
    // If the comparison or period is marked mixed actual/forecast without explicit hybrid flag.
    let is_explicitly_mixed = comp_param.eq_ignore_ascii_case("mixed")
        || period_id.to_ascii_lowercase().contains("mixed");

    let is_db_mixed: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM fiscal_periods fp
                JOIN fiscal_years fy ON fp.fiscal_year_id = fy.id
                JOIN fiscal_calendars fc ON fy.calendar_id = fc.id
                WHERE fp.id = ?1 AND fc.company_id = ?2 AND fp.code LIKE '%mixed%'
            )",
            rusqlite::params![period_id, company_id],
            |r| r.get(0),
        )
        .unwrap_or(false);

    if (is_explicitly_mixed || is_db_mixed) && !hybrid {
        return Err(AppError::variance_source_mixed());
    }

    // 2. Resolve Model
    let resolved_model_id: Option<String> = if let Some(m_id) = model_id {
        Some(m_id.to_string())
    } else {
        conn.query_row(
            "SELECT id FROM models WHERE company_id = ?1 ORDER BY id LIMIT 1",
            rusqlite::params![company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?
    };

    // 3. Attribution pre-check (VARIANCE_NO_ATTRIBUTION_DATA)
    if attribution {
        let has_drivers = if let Some(ref m_id) = resolved_model_id {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM drivers WHERE model_id = ?1",
                    rusqlite::params![m_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            count > 0
        } else {
            false
        };

        if !has_drivers {
            return Err(AppError::variance_no_attribution_data());
        }
    }

    // 4. Resolve scenarios
    let (actual_scen_id, actual_scen_name) = if let Some(ref m_id) = resolved_model_id {
        conn.query_row(
            "SELECT id, name FROM scenarios WHERE model_id = ?1 AND kind = 'actuals' LIMIT 1",
            rusqlite::params![m_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?
        .unwrap_or_else(|| ("scen-actuals".to_string(), "Actuals".to_string()))
    } else {
        ("scen-actuals".to_string(), "Actuals".to_string())
    };

    let (plan_scen_id, plan_scen_name) = if let Some(ref m_id) = resolved_model_id {
        conn.query_row(
            "SELECT id, name FROM scenarios WHERE model_id = ?1 AND (kind = ?2 OR name = ?2 OR id = ?2) LIMIT 1",
            rusqlite::params![m_id, comp_param],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?
        .or_else(|| {
            conn.query_row(
                "SELECT id, name FROM scenarios WHERE model_id = ?1 AND kind != 'actuals' LIMIT 1",
                rusqlite::params![m_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .unwrap_or(None)
        })
        .unwrap_or_else(|| ("scen-plan".to_string(), "Budget".to_string()))
    } else {
        ("scen-plan".to_string(), "Budget".to_string())
    };

    let (commit_scen_id, commit_scen_name) = if let Some(ref m_id) = resolved_model_id {
        conn.query_row(
            "SELECT id, name FROM scenarios WHERE model_id = ?1 AND (baseline = 1 OR kind = 'budget') ORDER BY baseline DESC LIMIT 1",
            rusqlite::params![m_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?
        .unwrap_or_else(|| (plan_scen_id.clone(), "Baseline Commit".to_string()))
    } else {
        (plan_scen_id.clone(), "Baseline Commit".to_string())
    };

    // 5. Query active accounts
    let mut stmt_acc = conn
        .prepare(
            "SELECT id, code, name, account_type, report_section
             FROM accounts
             WHERE company_id = ?1 AND active = 1
             ORDER BY code ASC",
        )
        .map_err(AppError::from)?;

    struct AccountRowData {
        id: String,
        code: String,
        name: String,
        account_type: String,
        report_section: String,
    }

    let accounts: Vec<AccountRowData> = stmt_acc
        .query_map(rusqlite::params![company_id], |row| {
            Ok(AccountRowData {
                id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                account_type: row.get(3)?,
                report_section: row.get(4)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    let mut rows = Vec::new();
    let mut attribution_rows = Vec::new();
    let mut threeway_rows = Vec::new();

    let mut total_actual: i64 = 0;
    let mut total_plan: i64 = 0;
    let mut total_commit: i64 = 0;

    for acc in accounts {
        // Query GL lines for actuals first
        let gl_actual_minor: Option<i64> = conn
            .query_row(
                "SELECT SUM(amount_minor) FROM gl_lines
                 WHERE company_id = ?1 AND period_id = ?2 AND account_id = ?3 AND is_excluded = 0",
                rusqlite::params![company_id, period_id, acc.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(AppError::from)?
            .flatten();

        // Model line & driver linkage
        let model_line_info: Option<(String, Option<String>, String)> =
            if let Some(ref m_id) = resolved_model_id {
                conn.query_row(
                    "SELECT ml.id, ml.driver_id, ml.method FROM model_lines ml
                 JOIN model_sheets ms ON ml.sheet_id = ms.id
                 WHERE ml.account_id = ?1 AND ms.model_id = ?2
                 LIMIT 1",
                    rusqlite::params![acc.id, m_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .unwrap_or(None)
            } else {
                None
            };

        let line_id = model_line_info.as_ref().map(|info| info.0.clone());
        let driver_id = model_line_info
            .as_ref()
            .and_then(|info| info.1.as_deref().map(|s| s.to_string()));

        // Model values lookup helper
        let get_model_val = |scen_id: &str| -> i64 {
            if let Some(ref l_id) = line_id {
                conn.query_row(
                    "SELECT amount_minor FROM model_values
                     WHERE line_id = ?1 AND scenario_id = ?2 AND period_id = ?3",
                    rusqlite::params![l_id, scen_id, period_id],
                    |r| r.get::<_, Option<i64>>(0),
                )
                .optional()
                .unwrap_or(None)
                .flatten()
                .unwrap_or(0)
            } else {
                0
            }
        };

        let actual_minor = gl_actual_minor.unwrap_or_else(|| get_model_val(&actual_scen_id));
        let plan_minor = get_model_val(&plan_scen_id);
        let commit_minor = if commit_scen_id == plan_scen_id {
            plan_minor
        } else {
            get_model_val(&commit_scen_id)
        };

        let variance_minor = actual_minor - plan_minor;
        let variance_pct = calculate_decimal_pct(variance_minor, plan_minor);
        let (f_u, direction) = determine_fu(&acc.account_type, actual_minor, plan_minor);

        // Annotation & Reason code lookup
        let mut reason_code_opt: Option<String> = None;
        let mut note_opt: Option<String> = None;

        let annotation_text: Option<String> = if let Some(ref l_id) = line_id {
            conn.query_row(
                "SELECT text FROM annotations
                 WHERE (line_id = ?1 OR line_id = ?2) AND period_id = ?3
                 ORDER BY updated_at DESC LIMIT 1",
                rusqlite::params![l_id, acc.id, period_id],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None)
        } else {
            conn.query_row(
                "SELECT text FROM annotations
                 WHERE line_id = ?1 AND period_id = ?2
                 ORDER BY updated_at DESC LIMIT 1",
                rusqlite::params![acc.id, period_id],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None)
        };

        if let Some(txt) = annotation_text {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&txt) {
                if let Some(c) = val.get("code").and_then(|v| v.as_str()) {
                    reason_code_opt = Some(c.to_string());
                }
                if let Some(n) = val.get("note").and_then(|v| v.as_str()) {
                    note_opt = Some(n.to_string());
                }
            } else if txt.starts_with('[') {
                if let Some(close_bracket) = txt.find(']') {
                    reason_code_opt = Some(txt[1..close_bracket].trim().to_string());
                    let rest = txt[close_bracket + 1..].trim();
                    if !rest.is_empty() {
                        note_opt = Some(rest.to_string());
                    }
                }
            } else {
                note_opt = Some(txt);
            }
        }

        let reason_label_opt = if let Some(ref code) = reason_code_opt {
            conn.query_row(
                "SELECT label FROM reason_codes WHERE company_id = ?1 AND code = ?2",
                rusqlite::params![company_id, code],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None)
        } else {
            None
        };

        // Attribution breakdown
        let mut volume_minor_opt = None;
        let mut price_minor_opt = None;
        let mut mix_minor_opt = None;
        let mut fx_minor_opt = None;
        let mut efficiency_minor_opt = None;
        let mut has_line_attribution = false;

        if attribution {
            if let Some(ref drv_id) = driver_id {
                let actual_drv: Option<String> = conn
                    .query_row(
                        "SELECT value_decimal FROM driver_values
                         WHERE driver_id = ?1 AND scenario_id = ?2 AND period_id = ?3",
                        rusqlite::params![drv_id, actual_scen_id, period_id],
                        |r| r.get(0),
                    )
                    .optional()
                    .unwrap_or(None);

                let plan_drv: Option<String> = conn
                    .query_row(
                        "SELECT value_decimal FROM driver_values
                         WHERE driver_id = ?1 AND scenario_id = ?2 AND period_id = ?3",
                        rusqlite::params![drv_id, plan_scen_id, period_id],
                        |r| r.get(0),
                    )
                    .optional()
                    .unwrap_or(None);

                if let (Some(a_str), Some(p_str)) = (actual_drv, plan_drv)
                    && let (Ok(a_val), Ok(p_val)) =
                        (Decimal::from_str(&a_str), Decimal::from_str(&p_str))
                    && !p_val.is_zero()
                {
                    let delta_vol = a_val - p_val;
                    let vol_ratio = delta_vol / p_val;
                    let vol_m = (Decimal::from(plan_minor) * vol_ratio)
                        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
                        .to_i64()
                        .unwrap_or(0);
                    let price_m = variance_minor - vol_m;

                    volume_minor_opt = Some(vol_m);
                    price_minor_opt = Some(price_m);
                    mix_minor_opt = Some(0);
                    fx_minor_opt = Some(0);
                    efficiency_minor_opt = Some(0);
                    has_line_attribution = true;

                    attribution_rows.push(AttributionRow {
                        line_id: line_id.clone().unwrap_or_else(|| acc.id.clone()),
                        account_id: acc.id.clone(),
                        account_code: acc.code.clone(),
                        account_name: acc.name.clone(),
                        variance_minor,
                        volume_minor: vol_m,
                        price_minor: price_m,
                        mix_minor: 0,
                        fx_minor: 0,
                        efficiency_minor: 0,
                        status: "attributable".to_string(),
                        sum_check: (vol_m + price_m) == variance_minor,
                    });
                }
            }

            if !has_line_attribution {
                attribution_rows.push(AttributionRow {
                    line_id: line_id.clone().unwrap_or_else(|| acc.id.clone()),
                    account_id: acc.id.clone(),
                    account_code: acc.code.clone(),
                    account_name: acc.name.clone(),
                    variance_minor,
                    volume_minor: 0,
                    price_minor: 0,
                    mix_minor: 0,
                    fx_minor: 0,
                    efficiency_minor: 0,
                    status: "not_attributable".to_string(),
                    sum_check: true,
                });
            }
        }

        rows.push(VarianceRow {
            line_id: line_id.clone(),
            account_id: acc.id.clone(),
            account_code: acc.code.clone(),
            account_name: acc.name.clone(),
            account_type: acc.account_type.clone(),
            report_section: acc.report_section.clone(),
            actual_minor,
            plan_minor,
            variance_minor,
            variance_pct,
            f_u: f_u.to_string(),
            direction: direction.to_string(),
            reason_code: reason_code_opt,
            reason_label: reason_label_opt,
            note: note_opt,
            has_attribution: has_line_attribution,
            volume_minor: volume_minor_opt,
            price_minor: price_minor_opt,
            mix_minor: mix_minor_opt,
            fx_minor: fx_minor_opt,
            efficiency_minor: efficiency_minor_opt,
        });

        // 3-Way calculations
        let var_act_plan = actual_minor - plan_minor;
        let var_act_plan_pct = calculate_decimal_pct(var_act_plan, plan_minor);
        let var_act_plan_fu = determine_fu(&acc.account_type, actual_minor, plan_minor)
            .0
            .to_string();

        let var_act_commit = actual_minor - commit_minor;
        let var_act_commit_pct = calculate_decimal_pct(var_act_commit, commit_minor);
        let var_act_commit_fu = determine_fu(&acc.account_type, actual_minor, commit_minor)
            .0
            .to_string();

        let var_plan_commit = plan_minor - commit_minor;
        let var_plan_commit_pct = calculate_decimal_pct(var_plan_commit, commit_minor);
        let var_plan_commit_fu = determine_fu(&acc.account_type, plan_minor, commit_minor)
            .0
            .to_string();

        threeway_rows.push(ThreeWayRow {
            line_id,
            account_id: acc.id,
            account_code: acc.code,
            account_name: acc.name,
            account_type: acc.account_type,
            actual_minor,
            plan_minor,
            commit_minor,
            var_actual_vs_plan_minor: var_act_plan,
            var_actual_vs_plan_pct: var_act_plan_pct,
            var_actual_vs_plan_fu: var_act_plan_fu,
            var_actual_vs_commit_minor: var_act_commit,
            var_actual_vs_commit_pct: var_act_commit_pct,
            var_actual_vs_commit_fu: var_act_commit_fu,
            var_plan_vs_commit_minor: var_plan_commit,
            var_plan_vs_commit_pct: var_plan_commit_pct,
            var_plan_vs_commit_fu: var_plan_commit_fu,
        });

        total_actual += actual_minor;
        total_plan += plan_minor;
        total_commit += commit_minor;
    }

    let threeway = ThreeWayComparison {
        actual_scenario_name: actual_scen_name,
        plan_scenario_name: plan_scen_name,
        commit_scenario_name: commit_scen_name,
        rows: threeway_rows,
        total_actual_minor: total_actual,
        total_plan_minor: total_plan,
        total_commit_minor: total_commit,
        total_var_actual_plan_minor: total_actual - total_plan,
        total_var_actual_commit_minor: total_actual - total_commit,
        total_var_plan_commit_minor: total_plan - total_commit,
    };

    Ok(VarianceGetResponse {
        rows,
        attribution: attribution_rows,
        threeway,
    })
}

/// Internal implementation of `variance.set_reason_code`.
pub fn variance_set_reason_code_internal(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    line_id: &str,
    period_id: &str,
    code: &str,
    note: Option<&str>,
) -> AppResult<VarianceSetReasonResponse> {
    if line_id.trim().is_empty() || period_id.trim().is_empty() || code.trim().is_empty() {
        return Err(AppError::invalid(
            "line_id, period_id, and code cannot be empty",
        ));
    }

    // 1. Ensure reason code exists in reason_codes catalog
    let category = match code.to_ascii_lowercase().as_str() {
        "volume" => "volume",
        "price" => "price",
        "mix" => "mix",
        "fx" => "fx",
        "efficiency" => "efficiency",
        "one_time" => "one_time",
        "seasonality" => "seasonality",
        _ => "other",
    };

    let rc_exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM reason_codes WHERE company_id = ?1 AND code = ?2)",
            rusqlite::params![company_id, code],
            |r| r.get(0),
        )
        .unwrap_or(false);

    if !rc_exists {
        let rc_id = format!("rc-{}", Uuid::new_v4());
        let label = format!("Reason: {}", code);
        tx.execute(
            "INSERT INTO reason_codes (id, company_id, code, label, category, active)
             VALUES (?1, ?2, ?3, ?4, ?5, 1)",
            rusqlite::params![rc_id, company_id, code, label, category],
        )
        .map_err(AppError::from)?;
    }

    // 2. Identify scenario for the annotation
    let scenario_id: String = tx
        .query_row(
            "SELECT s.id FROM scenarios s
             JOIN models m ON s.model_id = m.id
             WHERE m.company_id = ?1
             ORDER BY s.baseline DESC, s.id ASC LIMIT 1",
            rusqlite::params![company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?
        .unwrap_or_else(|| "sc-default".to_string());

    // 3. Check existing annotation
    let existing_ann: Option<(String, String)> = tx
        .query_row(
            "SELECT id, text FROM annotations WHERE line_id = ?1 AND period_id = ?2",
            rusqlite::params![line_id, period_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?;

    let before_json = if let Some((_, ref txt)) = existing_ann {
        serde_json::json!({
            "line_id": line_id,
            "period_id": period_id,
            "text": txt,
        })
    } else {
        serde_json::Value::Null
    };

    let note_text = note.unwrap_or_default();
    let text_payload = serde_json::json!({
        "code": code,
        "note": note_text,
    })
    .to_string();

    let now = chrono::Utc::now().to_rfc3339();

    if let Some((ref ann_id, _)) = existing_ann {
        tx.execute(
            "UPDATE annotations SET text = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![text_payload, now, ann_id],
        )
        .map_err(AppError::from)?;
    } else {
        let ann_id = format!("an-{}", Uuid::new_v4());
        tx.execute(
            "INSERT INTO annotations (id, line_id, period_id, scenario_id, author, text, is_pinned, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'Owner', ?5, 0, ?6, ?7)",
            rusqlite::params![ann_id, line_id, period_id, scenario_id, text_payload, now, now],
        )
        .map_err(AppError::from)?;
    }

    let after_json = serde_json::json!({
        "line_id": line_id,
        "period_id": period_id,
        "code": code,
        "note": note_text,
    });

    record_variance_audit(
        tx,
        dir,
        company_id,
        "variance.set_reason_code",
        line_id,
        before_json,
        after_json,
    )?;

    Ok(VarianceSetReasonResponse { saved: true })
}

/// `variance.get` — `{company_id, period_id, compare, attribution}` -> `{rows[], attribution[], threeway}`
/// (API-SPEC §2 row 77 · S-054 · F-024).
#[tauri::command(name = "variance.get", rename_all = "snake_case")]
pub fn variance_get(
    app: AppHandle,
    company_id: Option<String>,
    period_id: String,
    compare: Option<String>,
    attribution: Option<bool>,
    hybrid: Option<bool>,
    model_id: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<VarianceGetResponse> {
    let session_company_id = require_unlocked(&session)?;
    let active_company_id = company_id.unwrap_or(session_company_id);

    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;

    variance_get_internal(
        &conn,
        &active_company_id,
        &period_id,
        compare.as_deref(),
        attribution.unwrap_or(false),
        hybrid.unwrap_or(false),
        model_id.as_deref(),
    )
}

/// `variance.set_reason_code` — `{line_id, period_id, code, note}` -> `{saved}`
/// (API-SPEC §2 row 78 · S-054 · F-024).
#[tauri::command(name = "variance.set_reason_code", rename_all = "snake_case")]
pub fn variance_set_reason_code(
    app: AppHandle,
    line_id: String,
    period_id: String,
    code: String,
    note: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<VarianceSetReasonResponse> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;

    let res = variance_set_reason_code_internal(
        &tx,
        &dir,
        &company_id,
        &line_id,
        &period_id,
        &code,
        note.as_deref(),
    )?;

    tx.commit().map_err(AppError::from)?;
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> (
        Connection,
        std::path::PathBuf,
        String,
        String,
        String,
        String,
    ) {
        let conn = db::open_in_memory().unwrap();
        let temp_dir = std::env::temp_dir().join(format!("onefpa-variance-{}", Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);

        let company_id = format!("co-{}", Uuid::new_v4());
        let model_id = format!("mod-{}", Uuid::new_v4());
        let period_id = "fp-2026-p05".to_string();
        let cal_id = format!("cal-{}", Uuid::new_v4());
        let fy_id = format!("fy-{}", Uuid::new_v4());

        // Packs
        conn.execute(
            "INSERT INTO packs (id, key, name, version, schema_version, description, is_bundled, source_checksum, installed_at)
             VALUES ('pack_std', 'std', 'Standard Pack', '1.0.0', '1.0.0', 'Standard', 1, 'sha', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        // Company
        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version, company_file_path, created_at, updated_at)
             VALUES (?1, 'Acme Corp', 'single', 'USD', 'en-US', '1.0.0', '/tmp/test.fpa', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![company_id],
        )
        .unwrap();

        // Calendar & Period
        conn.execute(
            "INSERT INTO fiscal_calendars (id, company_id, name, preset, fy_start_month, week_start_day)
             VALUES (?1, ?2, 'Standard 12M', '12month', 1, 1)",
            rusqlite::params![cal_id, company_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO fiscal_years (id, calendar_id, fy_label, start_date, end_date, week_count)
             VALUES (?1, ?2, 'FY2026', '2026-01-01', '2026-12-31', 52)",
            rusqlite::params![fy_id, cal_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO fiscal_periods (id, fiscal_year_id, period_no, code, start_date, end_date)
             VALUES (?1, ?2, 5, 'P05', '2026-05-01', '2026-05-31')",
            rusqlite::params![period_id, fy_id],
        )
        .unwrap();

        // Model
        conn.execute(
            "INSERT INTO models (id, company_id, name, horizon, status, pack_id)
             VALUES (?1, ?2, 'Main Model', '1y', 'active', 'pack_std')",
            rusqlite::params![model_id, company_id],
        )
        .unwrap();

        (conn, temp_dir, company_id, model_id, period_id, fy_id)
    }

    #[test]
    fn decimal_percentage_calculation_exact_half_up() {
        // Normal positive variance: delta = 2500 on base 10000 -> +25.00%
        assert_eq!(calculate_decimal_pct(2500, 10000), Some("25.00".into()));

        // Negative variance: delta = -1550 on base 10000 -> -15.50%
        assert_eq!(calculate_decimal_pct(-1550, 10000), Some("-15.50".into()));

        // Rounding: 1 on base 3 -> 33.3333... -> 33.33%
        assert_eq!(calculate_decimal_pct(1, 3), Some("33.33".into()));

        // Rounding Half-Up: 2 on base 3 -> 66.6666... -> 66.67%
        assert_eq!(calculate_decimal_pct(2, 3), Some("66.67".into()));

        // Zero delta on non-zero base
        assert_eq!(calculate_decimal_pct(0, 5000), Some("0.00".into()));

        // Zero base with zero delta
        assert_eq!(calculate_decimal_pct(0, 0), Some("0.00".into()));

        // Zero base with non-zero delta (division by zero avoided)
        assert_eq!(calculate_decimal_pct(1000, 0), None);

        // Negative base: delta 2000 on base -10000 -> 20.00%
        assert_eq!(calculate_decimal_pct(2000, -10000), Some("20.00".into()));
    }

    #[test]
    fn fu_determination_revenue_and_expenses() {
        // Revenue: actual > plan => favorable (F)
        let (fu, dir) = determine_fu("revenue", 120_000, 100_000);
        assert_eq!(fu, "F");
        assert_eq!(dir, "favorable");

        // Revenue: actual < plan => unfavorable (U)
        let (fu, dir) = determine_fu("revenue", 80_000, 100_000);
        assert_eq!(fu, "U");
        assert_eq!(dir, "unfavorable");

        // Revenue: actual == plan => neutral
        let (fu, dir) = determine_fu("revenue", 100_000, 100_000);
        assert_eq!(fu, "—");
        assert_eq!(dir, "neutral");

        // Expense (cogs): actual < plan => spent less => favorable (F)
        let (fu, dir) = determine_fu("cogs", 80_000, 100_000);
        assert_eq!(fu, "F");
        assert_eq!(dir, "favorable");

        // Expense (cogs): actual > plan => spent more => unfavorable (U)
        let (fu, dir) = determine_fu("cogs", 120_000, 100_000);
        assert_eq!(fu, "U");
        assert_eq!(dir, "unfavorable");

        // Expense (opex): actual < plan => favorable (F)
        let (fu, dir) = determine_fu("opex", 45_000, 50_000);
        assert_eq!(fu, "F");
        assert_eq!(dir, "favorable");

        // Expense (opex): actual > plan => unfavorable (U)
        let (fu, dir) = determine_fu("opex", 55_000, 50_000);
        assert_eq!(fu, "U");
        assert_eq!(dir, "unfavorable");

        // Liability: less liability is favorable
        let (fu, dir) = determine_fu("liability", 90_000, 100_000);
        assert_eq!(fu, "F");
        assert_eq!(dir, "favorable");

        // Asset: more assets is favorable
        let (fu, dir) = determine_fu("asset", 110_000, 100_000);
        assert_eq!(fu, "F");
        assert_eq!(dir, "favorable");
    }

    #[test]
    fn error_variance_source_mixed_without_hybrid() {
        let (conn, _dir, company_id, _model_id, period_id, _fy) = setup_test_db();

        // Calling with compare="mixed" without hybrid flag fails with VARIANCE_SOURCE_MIXED
        let res = variance_get_internal(
            &conn,
            &company_id,
            &period_id,
            Some("mixed"),
            false,
            false,
            None,
        );
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert_eq!(err.body().code, "VARIANCE_SOURCE_MIXED");
        assert_eq!(err.body().http_status, 422);

        // Calling with period containing "mixed" without hybrid flag fails
        let res_period = variance_get_internal(
            &conn,
            &company_id,
            "fp-2026-mixed-01",
            Some("budget"),
            false,
            false,
            None,
        );
        assert!(res_period.is_err());
        assert_eq!(res_period.unwrap_err().body().code, "VARIANCE_SOURCE_MIXED");

        // With hybrid = true, it does not error on mixed source
        let res_hybrid = variance_get_internal(
            &conn,
            &company_id,
            &period_id,
            Some("mixed"),
            false,
            true, // hybrid enabled
            None,
        );
        assert!(res_hybrid.is_ok());
    }

    #[test]
    fn error_variance_no_attribution_data_when_no_drivers() {
        let (conn, _dir, company_id, _model_id, period_id, _fy) = setup_test_db();

        // Requesting attribution: true when no drivers exist in model returns VARIANCE_NO_ATTRIBUTION_DATA (HTTP 200)
        let res = variance_get_internal(
            &conn,
            &company_id,
            &period_id,
            Some("budget"),
            true, // attribution requested
            false,
            None,
        );
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert_eq!(err.body().code, "VARIANCE_NO_ATTRIBUTION_DATA");
        assert_eq!(err.body().http_status, 200);

        // Without attribution requested, it succeeds even with no drivers
        let res_no_attr = variance_get_internal(
            &conn,
            &company_id,
            &period_id,
            Some("budget"),
            false,
            false,
            None,
        );
        assert!(res_no_attr.is_ok());
    }

    #[test]
    fn three_way_comparisons_and_exact_minor_units() {
        let (conn, _dir, company_id, model_id, period_id, _fy) = setup_test_db();

        // 1. Setup Accounts: Revenue, COGS, OPEX
        let acc_rev = format!("acc-rev-{}", Uuid::new_v4());
        let acc_cogs = format!("acc-cogs-{}", Uuid::new_v4());
        let acc_opex = format!("acc-opex-{}", Uuid::new_v4());

        conn.execute(
            "INSERT INTO accounts (id, company_id, code, name, account_type, report_section)
             VALUES (?1, ?2, '4000', 'Gross Revenue', 'revenue', 'Revenue'),
                    (?3, ?2, '5000', 'Cost of Goods Sold', 'cogs', 'COGS'),
                    (?4, ?2, '6000', 'Salaries & Benefits', 'opex', 'OPEX')",
            rusqlite::params![acc_rev, company_id, acc_cogs, acc_opex],
        )
        .unwrap();

        // 2. Setup Sheets and Lines
        let sheet_id = format!("sh-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO model_sheets (id, model_id, name, sheet_type, sort_order)
             VALUES (?1, ?2, 'P&L Sheet', 'statement', 1)",
            rusqlite::params![sheet_id, model_id],
        )
        .unwrap();

        let line_rev = format!("ln-{}", Uuid::new_v4());
        let line_cogs = format!("ln-{}", Uuid::new_v4());
        let line_opex = format!("ln-{}", Uuid::new_v4());

        conn.execute(
            "INSERT INTO model_lines (id, sheet_id, account_id, method, format, sort_order)
             VALUES (?1, ?4, ?5, 'growth', 'money', 1),
                    (?2, ?4, ?6, 'growth', 'money', 2),
                    (?3, ?4, ?7, 'growth', 'money', 3)",
            rusqlite::params![
                line_rev, line_cogs, line_opex, sheet_id, acc_rev, acc_cogs, acc_opex
            ],
        )
        .unwrap();

        // 3. Setup Scenarios: Actuals, Budget (Plan), Commit (Baseline)
        let sc_actuals = format!("sc-act-{}", Uuid::new_v4());
        let sc_budget = format!("sc-bud-{}", Uuid::new_v4());
        let sc_commit = format!("sc-com-{}", Uuid::new_v4());

        conn.execute(
            "INSERT INTO scenarios (id, model_id, name, kind, state, baseline)
             VALUES (?1, ?4, 'Actuals', 'actuals', 'approved', 0),
                    (?2, ?4, 'Budget', 'budget', 'approved', 0),
                    (?3, ?4, 'Commit Baseline', 'budget', 'locked', 1)",
            rusqlite::params![sc_actuals, sc_budget, sc_commit, model_id],
        )
        .unwrap();

        // 4. Populate values in exact integer minor units ($100.00 = 10000)
        // Revenue: Actual 120,000 minor ($1200), Budget 100,000 ($1000), Commit 110,000 ($1100)
        // COGS: Actual 45,000 ($450), Budget 50,000 ($500), Commit 48,000 ($480)
        // OPEX: Actual 35,000 ($350), Budget 30,000 ($300), Commit 30,000 ($300)
        conn.execute(
            "INSERT INTO model_values (id, line_id, scenario_id, period_id, amount_minor)
             VALUES ('mv-1', ?1, ?4, ?7, 120000),
                    ('mv-2', ?1, ?5, ?7, 100000),
                    ('mv-3', ?1, ?6, ?7, 110000),
                    ('mv-4', ?2, ?4, ?7, 45000),
                    ('mv-5', ?2, ?5, ?7, 50000),
                    ('mv-6', ?2, ?6, ?7, 48000),
                    ('mv-7', ?3, ?4, ?7, 35000),
                    ('mv-8', ?3, ?5, ?7, 30000),
                    ('mv-9', ?3, ?6, ?7, 30000)",
            rusqlite::params![
                line_rev, line_cogs, line_opex, sc_actuals, sc_budget, sc_commit, period_id
            ],
        )
        .unwrap();

        let res = variance_get_internal(
            &conn,
            &company_id,
            &period_id,
            Some("budget"),
            false,
            false,
            Some(&model_id),
        )
        .unwrap();

        assert_eq!(res.rows.len(), 3);

        // Revenue row check
        let rev_row = res.rows.iter().find(|r| r.account_code == "4000").unwrap();
        assert_eq!(rev_row.actual_minor, 120000);
        assert_eq!(rev_row.plan_minor, 100000);
        assert_eq!(rev_row.variance_minor, 20000);
        assert_eq!(rev_row.variance_pct, Some("20.00".into()));
        assert_eq!(rev_row.f_u, "F");
        assert_eq!(rev_row.direction, "favorable");

        // COGS row check: spent 45k vs budgeted 50k -> variance -5k -> favorable for cost!
        let cogs_row = res.rows.iter().find(|r| r.account_code == "5000").unwrap();
        assert_eq!(cogs_row.actual_minor, 45000);
        assert_eq!(cogs_row.plan_minor, 50000);
        assert_eq!(cogs_row.variance_minor, -5000);
        assert_eq!(cogs_row.variance_pct, Some("-10.00".into()));
        assert_eq!(cogs_row.f_u, "F");
        assert_eq!(cogs_row.direction, "favorable");

        // OPEX row check: spent 35k vs budgeted 30k -> variance +5k -> unfavorable for cost!
        let opex_row = res.rows.iter().find(|r| r.account_code == "6000").unwrap();
        assert_eq!(opex_row.actual_minor, 35000);
        assert_eq!(opex_row.plan_minor, 30000);
        assert_eq!(opex_row.variance_minor, 5000);
        assert_eq!(opex_row.variance_pct, Some("16.67".into()));
        assert_eq!(opex_row.f_u, "U");
        assert_eq!(opex_row.direction, "unfavorable");

        // 3-Way comparisons check
        assert_eq!(res.threeway.rows.len(), 3);
        let rev_3w = res
            .threeway
            .rows
            .iter()
            .find(|r| r.account_code == "4000")
            .unwrap();
        assert_eq!(rev_3w.actual_minor, 120000);
        assert_eq!(rev_3w.plan_minor, 100000);
        assert_eq!(rev_3w.commit_minor, 110000);

        // Actual vs Plan: 120k - 100k = +20k (20.00% F)
        assert_eq!(rev_3w.var_actual_vs_plan_minor, 20000);
        assert_eq!(rev_3w.var_actual_vs_plan_pct, Some("20.00".into()));
        assert_eq!(rev_3w.var_actual_vs_plan_fu, "F");

        // Actual vs Commit: 120k - 110k = +10k (9.09% F)
        assert_eq!(rev_3w.var_actual_vs_commit_minor, 10000);
        assert_eq!(rev_3w.var_actual_vs_commit_pct, Some("9.09".into()));
        assert_eq!(rev_3w.var_actual_vs_commit_fu, "F");

        // Plan vs Commit: 100k - 110k = -10k (-9.09% U)
        assert_eq!(rev_3w.var_plan_vs_commit_minor, -10000);
        assert_eq!(rev_3w.var_plan_vs_commit_pct, Some("-9.09".into()));
        assert_eq!(rev_3w.var_plan_vs_commit_fu, "U");

        // Total 3-Way verification
        assert_eq!(res.threeway.total_actual_minor, 120000 + 45000 + 35000); // 200,000
        assert_eq!(res.threeway.total_plan_minor, 100000 + 50000 + 30000); // 180,000
        assert_eq!(res.threeway.total_commit_minor, 110000 + 48000 + 30000); // 188,000
        assert_eq!(res.threeway.total_var_actual_plan_minor, 200000 - 180000); // 20,000
        assert_eq!(res.threeway.total_var_actual_commit_minor, 200000 - 188000); // 12,000
    }

    #[test]
    fn attribution_sum_of_parts_invariant() {
        let (conn, _dir, company_id, model_id, period_id, _fy) = setup_test_db();

        let acc_rev = format!("acc-rev-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO accounts (id, company_id, code, name, account_type, report_section)
             VALUES (?1, ?2, '4000', 'Product Revenue', 'revenue', 'Revenue')",
            rusqlite::params![acc_rev, company_id],
        )
        .unwrap();

        let drv_units = format!("dr-units-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO drivers (id, model_id, name, driver_type, unit, source)
             VALUES (?1, ?2, 'unit_sales', 'volume_x_rate', 'units', 'global')",
            rusqlite::params![drv_units, model_id],
        )
        .unwrap();

        let sheet_id = format!("sh-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO model_sheets (id, model_id, name, sheet_type, sort_order)
             VALUES (?1, ?2, 'Sales Sheet', 'statement', 1)",
            rusqlite::params![sheet_id, model_id],
        )
        .unwrap();

        let line_rev = format!("ln-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO model_lines (id, sheet_id, account_id, driver_id, method, format, sort_order)
             VALUES (?1, ?2, ?3, ?4, 'driver', 'money', 1)",
            rusqlite::params![line_rev, sheet_id, acc_rev, drv_units],
        )
        .unwrap();

        let sc_actuals = format!("sc-act-{}", Uuid::new_v4());
        let sc_budget = format!("sc-bud-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO scenarios (id, model_id, name, kind, state, baseline)
             VALUES (?1, ?3, 'Actuals', 'actuals', 'approved', 0),
                    (?2, ?3, 'Budget', 'budget', 'approved', 1)",
            rusqlite::params![sc_actuals, sc_budget, model_id],
        )
        .unwrap();

        // Revenue: Actual $70,000 (7,000,000 minor), Budget $100,000 (10,000,000 minor) => Variance = -$30,000 (-3,000,000 minor)
        conn.execute(
            "INSERT INTO model_values (id, line_id, scenario_id, period_id, amount_minor)
             VALUES ('mv-1', ?1, ?2, ?4, 7000000),
                    ('mv-2', ?1, ?3, ?4, 10000000)",
            rusqlite::params![line_rev, sc_actuals, sc_budget, period_id],
        )
        .unwrap();

        // Driver volume values: Actual = 800 units, Budget = 1000 units (Volume shortfall -20%)
        conn.execute(
            "INSERT INTO driver_values (id, driver_id, scenario_id, period_id, value_decimal)
             VALUES ('dv-1', ?1, ?2, ?4, '800'),
                    ('dv-2', ?1, ?3, ?4, '1000')",
            rusqlite::params![drv_units, sc_actuals, sc_budget, period_id],
        )
        .unwrap();

        let res = variance_get_internal(
            &conn,
            &company_id,
            &period_id,
            Some("budget"),
            true, // attribution requested
            false,
            Some(&model_id),
        )
        .unwrap();

        assert_eq!(res.attribution.len(), 1);
        let attr = &res.attribution[0];
        assert_eq!(attr.status, "attributable");
        assert_eq!(attr.variance_minor, -3000000);

        // Sum of parts check: volume + price + mix + fx + efficiency == variance
        let sum = attr.volume_minor
            + attr.price_minor
            + attr.mix_minor
            + attr.fx_minor
            + attr.efficiency_minor;
        assert_eq!(sum, attr.variance_minor);
        assert!(attr.sum_check);

        // Volume is 20% shortfall of $100,000 budget = -$20,000 (-2,000,000 minor), and price is remainder -$10,000 (-1,000,000 minor)
        assert_eq!(attr.volume_minor, -2000000);
        assert_eq!(attr.price_minor, -1000000);
    }

    #[test]
    fn variance_set_reason_code_saves_and_audits() {
        let (mut conn, temp_dir, company_id, model_id, period_id, _fy) = setup_test_db();

        let sheet_id = format!("sh-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO model_sheets (id, model_id, name, sheet_type, sort_order)
             VALUES (?1, ?2, 'Test Sheet', 'statement', 1)",
            rusqlite::params![sheet_id, model_id],
        )
        .unwrap();

        let line_id = format!("ln-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO model_lines (id, sheet_id, method, format, sort_order)
             VALUES (?1, ?2, 'growth', 'money', 1)",
            rusqlite::params![line_id, sheet_id],
        )
        .unwrap();

        let sc_id = format!("sc-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO scenarios (id, model_id, name, kind, state, baseline)
             VALUES (?1, ?2, 'Budget', 'budget', 'locked', 1)",
            rusqlite::params![sc_id, model_id],
        )
        .unwrap();

        let tx = conn.transaction().unwrap();
        let res = variance_set_reason_code_internal(
            &tx,
            &temp_dir,
            &company_id,
            &line_id,
            &period_id,
            "volume",
            Some("Volume shortfall due to port strike"),
        )
        .unwrap();
        assert!(res.saved);
        tx.commit().unwrap();

        // Verify annotation stored
        let (text, author): (String, String) = conn
            .query_row(
                "SELECT text, author FROM annotations WHERE line_id = ?1 AND period_id = ?2",
                rusqlite::params![line_id, period_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();

        assert_eq!(author, "Owner");
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["code"], "volume");
        assert_eq!(parsed["note"], "Volume shortfall due to port strike");

        // Verify reason_codes table has entry
        let (code, category): (String, String) = conn
            .query_row(
                "SELECT code, category FROM reason_codes WHERE company_id = ?1 AND code = 'volume'",
                rusqlite::params![company_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(code, "volume");
        assert_eq!(category, "volume");

        // Verify HMAC audit event was logged
        let (action, obj_id, obj_type): (String, String, String) = conn
            .query_row(
                "SELECT action, object_id, object_type FROM audit_events WHERE company_id = ?1",
                rusqlite::params![company_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(action, "variance.set_reason_code");
        assert_eq!(obj_id, line_id);
        assert_eq!(obj_type, "variance");
    }
}
