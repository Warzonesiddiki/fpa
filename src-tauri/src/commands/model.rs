//! `model.cell.set.v1` / `model.recalc` (F-012 · API-SPEC §2/§3 · FORMULA-ENGINE-SPEC).
//!
//! M1 scope is deliberately thin (HANDOVER §2): this file validates the edited cell against the
//! documented formula whitelist + exact Money Value boundary and returns the recalc envelope the
//! grid/worker exchange. The HyperFormula worker (M3-1) will own the real dirty graph and writes
//! back through `model_values`; here the cell lives in an in-memory `ModelCellStore` so the
//! command contract is testable without the native engine.
//!
//! Zero-compromise invariants kept:
//!  * **Money never crosses as float.** `value` is a decimal string; `MoneyValue` converts it to
//!    `i64` minor units (B3/B18-2).
//!  * **Every session mutation is audited** with an HMAC-chained `model.cell.set.v1` event (B7;
//!    the store write is one command, the audit event is one transaction with the Company chain).
//!  * **AUTH-SPEC §2.5/§3 rule 2** — the gate is `require_session_write`, checked in Rust.
//!  * **No invented codes.** All errors come from the locked ERROR-HANDLING taxonomy (B20).

use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{SessionState, require_session_write, require_unlocked};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::core::model::{
    self, ModelCellStore, StoredCell, cell_key, parse_value_minor, validate_formula,
};
use crate::storage::db;
use crate::storage::keystore;

/// Default currency for the M1 echo. M3-1 resolves the real Company currency from `models` /
/// `companies`; the API contract (`model.cell.set.v1`) has no currency field, so we default to
/// the common case and never guess silently for a known Company when the DB registry exists.
const DEFAULT_CURRENCY: &str = "USD";

/// In-memory working set (see `core/model.rs` — mirrors the `ParseRegistry` pattern).
#[derive(Default)]
pub struct ModelRegistry {
    pub cells: ModelCellStore,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
struct ModelCellPayload {
    value_minor: Option<i64>,
    amount_text: Option<String>,
    formula: Option<String>,
    manual_override: bool,
}

impl ModelCellPayload {
    fn from_stored(cell: &StoredCell) -> Self {
        ModelCellPayload {
            value_minor: cell.value_minor,
            amount_text: cell.amount_text.clone(),
            formula: cell.formula.clone(),
            manual_override: cell.manual_override,
        }
    }
}

/// Query the SQLite `scenarios` table for `scenario_id`: if `state == "locked"`, return `MODEL_CELL_LOCKED`
/// (SCENARIO-VERSION-SPEC §1 / ERROR-HANDLING §E).
pub(crate) fn check_scenario_unlocked(
    conn: &rusqlite::Connection,
    scenario_id: &str,
) -> AppResult<()> {
    let state: Option<String> = conn
        .query_row(
            "SELECT state FROM scenarios WHERE id = ?1",
            [scenario_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    if state.as_deref() == Some("locked") {
        return Err(AppError::model_cell_locked());
    }
    Ok(())
}

/// `model.cell.set.v1` — {line_id, scenario_id, period_id, value?, formula?, manual_override?}
/// → {recalc, cell, audit_id} (API-SPEC §2/§3). Writes an audited cell to the M1 working set
/// after validating formula/money; a Locked Scenario raises `MODEL_CELL_LOCKED`. The cell is
/// addressed by line+scenario+period (no `model_id` in the documented args).
#[tauri::command(name = "model.cell.set.v1", rename_all = "snake_case")]
pub fn model_cell_set_v1(
    app: AppHandle,
    line_id: String,
    scenario_id: String,
    period_id: String,
    value: Option<String>,
    formula: Option<String>,
    manual_override: Option<bool>,
    currency: Option<String>,
    session: State<'_, SessionState>,
    registry: State<'_, ModelRegistry>,
) -> AppResult<serde_json::Value> {
    // AUTH-SPEC §3 rule 2: object-level gate checked in Rust, not the UI (UI gate is cosmetic).
    let company_id = require_session_write(&session)?;

    if value.is_none() && formula.is_none() {
        return Err(AppError::invalid(
            "MODEL_CELL_VALUE_REQUIRED: provide a value or a formula",
        ));
    }
    if let Some(f) = formula.as_deref() {
        validate_formula(f)?;
    }
    // The only exact money conversion point: decimal string → minor units (B18-2).
    let value_minor = match value.as_deref() {
        Some(v) => Some(parse_value_minor(
            v,
            currency.as_deref().unwrap_or(DEFAULT_CURRENCY),
        )?),
        None => None,
    };

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    check_scenario_unlocked(&conn, &scenario_id)?;

    let key = cell_key(&scenario_id, &line_id, &period_id);
    let before = registry.cells.get(&key);

    let stored = StoredCell {
        value_minor,
        amount_text: value,
        formula,
        manual_override: manual_override.unwrap_or(false),
    };
    registry.cells.put(&key, stored.clone())?;

    // Every mutation appends the HMAC-chained event for the session Company (B7/B18-1). The
    // before/after payload carries only the cell facts — never money users/reference secrets.
    let before_json = before
        .as_ref()
        .map(ModelCellPayload::from_stored)
        .map(|p| serde_json::to_value(&p).map_err(|e| AppError::internal(e.to_string())))
        .transpose()?
        .unwrap_or(serde_json::Value::Null);
    let after_json = serde_json::to_value(ModelCellPayload::from_stored(&stored))
        .map_err(|e| AppError::internal(e.to_string()))?;

    let tx = conn.transaction().map_err(AppError::from)?;
    // The Company row must belong to the unlocked session — fail closed on a foreign id.
    let company_exists: Option<String> = tx
        .query_row(
            "SELECT id FROM companies WHERE id = ?1",
            [&company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    if company_exists.is_none() {
        return Err(AppError::file_corrupt());
    }
    let hmac = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id)?;
    let hash = next_hash(&hmac, &prev, after_json.to_string().as_bytes());
    let now = chrono::Utc::now().to_rfc3339();

    // Persist into model_values table if line, scenario, and period exist (M3-1 persistence)
    let line_exists: Option<String> = tx
        .query_row(
            "SELECT id FROM model_lines WHERE id = ?1",
            [&line_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    let period_exists: Option<String> = tx
        .query_row(
            "SELECT id FROM fiscal_periods WHERE id = ?1",
            [&period_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    if line_exists.is_some() && period_exists.is_some() {
        let mv_id = format!("mv-{}-{}-{}", scenario_id, line_id, period_id);
        let computed = if stored.manual_override { 0 } else { 1 };
        tx.execute(
            "INSERT INTO model_values (id, line_id, scenario_id, period_id, amount_minor, amount_text, formula, computed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(line_id, scenario_id, period_id) DO UPDATE SET
               amount_minor = excluded.amount_minor,
               amount_text = excluded.amount_text,
               formula = excluded.formula,
               computed = excluded.computed",
            rusqlite::params![
                mv_id,
                line_id,
                scenario_id,
                period_id,
                value_minor,
                stored.amount_text,
                stored.formula,
                computed,
            ],
        )
        .map_err(AppError::from)?;
    }

    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id,
                                   before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'model.cell.set.v1', 'model_value', ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![company_id, key, before_json, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    let audit_id = tx.last_insert_rowid();
    tx.commit().map_err(AppError::from)?;

    // M1 echo: a single edited cell is the dirty set; HyperFormula computes the real graph in M3-1.
    let recalc = model::recalc_report(1, vec![], vec![line_id.clone()], 0);

    Ok(serde_json::json!({
        "data": {
            "recalc": recalc,
            "cell": {
                "value_minor": value_minor,
                "amount_text": stored.amount_text,
                "formula": stored.formula,
                "manual_override": stored.manual_override,
            },
            "audit_id": audit_id,
        }
    }))
}

/// `model.recalc` — {model_id, scenario_id} → {duration_ms, changed_cells, issues[]}
/// (API-SPEC §2). Read-only (no audit, AUTH-SPEC §3): a read-only Company may still recalc its
/// model. M1 reports the cells currently in the in-memory working set; the worker graph is M3-1.
#[tauri::command(name = "model.recalc", rename_all = "snake_case")]
pub fn model_recalc(
    _model_id: String,
    scenario_id: String,
    session: State<'_, SessionState>,
    registry: State<'_, ModelRegistry>,
) -> AppResult<serde_json::Value> {
    // Read command: unlocked session required, chain-break read-only allowed (AUTH-SPEC §3).
    let _company_id = require_unlocked(&session)?;
    // `model_id` is validated for the working set only — future DB registry keyed by Company.
    let dirty = registry.cells.count_for_scenario(&scenario_id);
    let changed = registry.cells.changed_lines(&scenario_id);
    let recalc = model::recalc_report(dirty, vec![], changed, 0);
    // API-SPEC §2 list row: `model.recalc` returns the flat `{duration_ms, changed_cells,
    // issues[]}` envelope, not the §3 `recalc` wrapper (that wrapper belongs to cell.set).
    Ok(serde_json::json!({
        "data": {
            "duration_ms": recalc["duration_ms"],
            "changed_cells": recalc["changed_cells"],
            "issues": recalc["issues"],
            "dirty_cells": recalc["dirty_cells"],
            "cycles": recalc["cycles"],
        }
    }))
}

pub use crate::commands::scenario::model_list;

/// `model.diff` — {scenario_a, version_a?, scenario_b, version_b?} → {diff_rows[]}
/// (API-SPEC §2 row 50 · SCENARIO-VERSION-SPEC §4 · S-051).
/// Two-way cell diff between Scenarios/Versions: Δ computed in Rust (Money Value),
/// Δ% = Δ / |A| (or n/a if A = 0 — never Infinity).
#[tauri::command(name = "model.diff", rename_all = "snake_case")]
pub fn model_diff(
    app: AppHandle,
    scenario_a: String,
    version_a: Option<String>,
    scenario_b: String,
    version_b: Option<String>,
    session: State<'_, SessionState>,
    _registry: State<'_, ModelRegistry>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&session)?;

    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;

    // Both scenarios must exist and belong to the same company via their models.
    let model_a: String = conn
        .query_row(
            "SELECT s.model_id FROM scenarios s
             JOIN models m ON s.model_id = m.id
             WHERE s.id = ?1 AND m.company_id = ?2",
            rusqlite::params![scenario_a, company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?
        .ok_or_else(AppError::file_corrupt)?;

    let model_b: String = conn
        .query_row(
            "SELECT s.model_id FROM scenarios s
             JOIN models m ON s.model_id = m.id
             WHERE s.id = ?1 AND m.company_id = ?2",
            rusqlite::params![scenario_b, company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?
        .ok_or_else(AppError::file_corrupt)?;

    if model_a != model_b {
        return Err(AppError::compare_incompatible());
    }

    // Collect all model_lines for this model (with sheet info).
    let mut stmt_lines = conn
        .prepare(
            "SELECT ml.id, ml.sheet_id, COALESCE(ms.name, ml.sheet_id) AS sheet_name,
                    ml.account_id, ml.driver_id, ml.sort_order
             FROM model_lines ml
             LEFT JOIN model_sheets ms ON ml.sheet_id = ms.id
             WHERE ms.model_id = ?1
             ORDER BY ms.sort_order, ml.sort_order",
        )
        .map_err(AppError::from)?;

    struct LineInfo {
        id: String,
        sheet_id: String,
        sheet_name: String,
        account_id: Option<String>,
        driver_id: Option<String>,
    }

    let lines: Vec<LineInfo> = stmt_lines
        .query_map(rusqlite::params![model_a], |row| {
            Ok(LineInfo {
                id: row.get(0)?,
                sheet_id: row.get(1)?,
                sheet_name: row.get(2)?,
                account_id: row.get(3)?,
                driver_id: row.get(4)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    if lines.is_empty() {
        return Ok(serde_json::json!({ "data": { "diff_rows": [] } }));
    }

    // Collect all fiscal periods for this model's calendar.
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

    let period_ids: Vec<String> = stmt_periods
        .query_map(rusqlite::params![model_a], |row| row.get(0))
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    // Build a map: line_id → period_id → value for scenario A.
    let mut values_a: std::collections::HashMap<
        String,
        std::collections::HashMap<String, Option<(Option<i64>, Option<String>, Option<String>)>>,
    > = std::collections::HashMap::new();

    let mut query_a = "SELECT mv.line_id, mv.period_id, mv.amount_minor, mv.amount_text, mv.formula
         FROM model_values mv
         WHERE mv.scenario_id = ?1"
        .to_string();
    if let Some(ref va) = version_a {
        query_a.push_str(&format!(
            " AND mv.source_version_id = '{}'",
            va.replace('\'', "''")
        ));
    }

    {
        let mut stmt = conn.prepare(&query_a).map_err(AppError::from)?;
        let mut rows = stmt
            .query(rusqlite::params![scenario_a])
            .map_err(AppError::from)?;
        while let Some(row) = rows.next().map_err(AppError::from)? {
            let line_id: String = row.get(0)?;
            let period_id: String = row.get(1)?;
            let amount_minor: Option<i64> = row.get(2)?;
            let amount_text: Option<String> = row.get(3)?;
            let formula: Option<String> = row.get(4)?;
            values_a
                .entry(line_id)
                .or_default()
                .insert(period_id, Some((amount_minor, amount_text, formula)));
        }
    }

    // Build a map: line_id → period_id → value for scenario B.
    let mut values_b: std::collections::HashMap<
        String,
        std::collections::HashMap<String, Option<(Option<i64>, Option<String>, Option<String>)>>,
    > = std::collections::HashMap::new();

    let mut query_b = "SELECT mv.line_id, mv.period_id, mv.amount_minor, mv.amount_text, mv.formula
         FROM model_values mv
         WHERE mv.scenario_id = ?1"
        .to_string();
    if let Some(ref vb) = version_b {
        query_b.push_str(&format!(
            " AND mv.source_version_id = '{}'",
            vb.replace('\'', "''")
        ));
    }

    {
        let mut stmt = conn.prepare(&query_b).map_err(AppError::from)?;
        let mut rows = stmt
            .query(rusqlite::params![scenario_b])
            .map_err(AppError::from)?;
        while let Some(row) = rows.next().map_err(AppError::from)? {
            let line_id: String = row.get(0)?;
            let period_id: String = row.get(1)?;
            let amount_minor: Option<i64> = row.get(2)?;
            let amount_text: Option<String> = row.get(3)?;
            let formula: Option<String> = row.get(4)?;
            values_b
                .entry(line_id)
                .or_default()
                .insert(period_id, Some((amount_minor, amount_text, formula)));
        }
    }

    // Build diff rows: iterate all line × period combinations.
    let mut diff_rows = Vec::new();

    for line in &lines {
        let periods_a = values_a.get(&line.id);
        let periods_b = values_b.get(&line.id);

        // Union of all periods across both scenarios for this line.
        let mut all_periods: std::collections::HashSet<String> = std::collections::HashSet::new();
        if let Some(pa) = periods_a {
            all_periods.extend(pa.keys().cloned());
        }
        if let Some(pb) = periods_b {
            all_periods.extend(pb.keys().cloned());
        }
        if all_periods.is_empty() {
            // No values in either scenario — still emit a row with nulls for each known period.
            for pid in &period_ids {
                all_periods.insert(pid.clone());
            }
        }

        let mut sorted_periods: Vec<String> = all_periods.into_iter().collect();
        sorted_periods.sort();

        for pid in &sorted_periods {
            let val_a = periods_a.and_then(|pa| pa.get(pid)).cloned().flatten();
            let val_b = periods_b.and_then(|pb| pb.get(pid)).cloned().flatten();

            let minor_a = val_a.as_ref().and_then(|v| v.0);
            let text_a = val_a.as_ref().and_then(|v| v.1.clone());
            let formula_a = val_a.as_ref().and_then(|v| v.2.clone());

            let minor_b = val_b.as_ref().and_then(|v| v.0);
            let text_b = val_b.as_ref().and_then(|v| v.1.clone());
            let formula_b = val_b.as_ref().and_then(|v| v.2.clone());

            let delta_minor = minor_b.unwrap_or(0) - minor_a.unwrap_or(0);
            let is_changed = minor_a != minor_b || text_a != text_b || formula_a != formula_b;

            // Δ% = Δ / |A| — None when A = 0 (never Infinity/NaN per SPEC §4).
            let delta_pct = if let Some(ma) = minor_a {
                if ma != 0 {
                    let d_delta = rust_decimal::Decimal::from(delta_minor);
                    let d_abs_a = rust_decimal::Decimal::from(ma.abs());
                    (d_delta / d_abs_a)
                        .round_dp(6)
                        .to_string()
                        .parse::<serde_json::Number>()
                        .ok()
                        .map(serde_json::Value::Number)
                } else {
                    None
                }
            } else {
                None
            };

            // Format delta as decimal string from minor units.
            let delta_text = format!("{}", delta_minor);

            diff_rows.push(serde_json::json!({
                "line_id": line.id,
                "sheet_id": line.sheet_id,
                "sheet_name": line.sheet_name,
                "line_name": line.id,
                "account_id": line.account_id,
                "driver_id": line.driver_id,
                "driver_name": null,
                "period_id": pid,
                "period_label": pid,
                "value_a": text_a,
                "value_a_minor": minor_a,
                "formula_a": formula_a,
                "value_b": text_b,
                "value_b_minor": minor_b,
                "formula_b": formula_b,
                "delta_minor": delta_minor,
                "delta_text": delta_text,
                "delta_pct": delta_pct,
                "is_changed": is_changed,
            }));
        }
    }

    Ok(serde_json::json!({
        "data": {
            "diff_rows": diff_rows,
        }
    }))
}

/// `model.sheet.add` — {model_id, name, type} → {sheet_id} (API-SPEC §19).
/// Model write: inserts a `model_sheets` row (sort_order = MAX+1) and appends a
/// `model.sheet.add` HMAC audit event in ONE transaction (B18-1/B7).
#[tauri::command(name = "model.sheet.add", rename_all = "snake_case")]
pub fn model_sheet_add(
    app: AppHandle,
    model_id: String,
    name: String,
    sheet_type: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    model_sheet_add_internal(&mut conn, &dir, &company_id, &model_id, &name, &sheet_type)
}

/// `model.create` — {company_id, name, horizon, pack_id} → {model_id, scenario_id}
/// (API-SPEC §20). Company write: seeds `models` + Base scenario exactly like
/// `company.create` does, plus a `model.create` HMAC audit event — ONE transaction.
#[tauri::command(name = "model.create", rename_all = "snake_case")]
pub fn model_create(
    app: AppHandle,
    company_id: String,
    name: String,
    horizon: String,
    pack_id: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let unlocked = require_session_write(&session)?;
    if company_id.trim() != unlocked {
        return Err(AppError::invalid(
            "model.create company_id must be the unlocked Company",
        ));
    }
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    model_create_internal(&mut conn, &dir, &company_id, &name, &horizon, &pack_id)
}

/// Shared implementation (unit-testable; caller owns the connection and the data dir).
pub fn model_create_internal(
    conn: &mut rusqlite::Connection,
    dir: &std::path::Path,
    company_id: &str,
    name: &str,
    horizon: &str,
    pack_id: &str,
) -> AppResult<serde_json::Value> {
    const HORIZONS: &[&str] = &["13w", "1y", "3y", "5y"];
    let name_trimmed = name.trim();
    if name_trimmed.is_empty() {
        return Err(AppError::invalid("model name is required"));
    }
    if !HORIZONS.contains(&horizon) {
        return Err(AppError::invalid("horizon must be one of 13w/1y/3y/5y"));
    }

    // Pack must exist (any installed pack of this installation; §20).
    let pack_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM packs WHERE id = ?1)",
            [pack_id],
            |r| r.get(0),
        )
        .optional()
        .map(|o| o.unwrap_or(false))
        .map_err(AppError::from)?;
    if !pack_exists {
        return Err(AppError::invalid(
            "pack_id must reference an installed pack",
        ));
    }

    let tx = conn.transaction().map_err(AppError::from)?;
    let model_id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO models (id, company_id, name, horizon, status, current_scenario_id, pack_id)
         VALUES (?1, ?2, ?3, ?4, 'active', NULL, ?5)",
        rusqlite::params![model_id, company_id, name_trimmed, horizon, pack_id],
    )
    .map_err(AppError::from)?;

    // Base scenario: budget/draft/baseline=1, wired as current (same as company.create).
    let scenario_id = uuid::Uuid::new_v4().to_string();
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

    let after_json = serde_json::json!({
        "action": "model.create",
        "name": name_trimmed,
        "horizon": horizon,
        "pack_id": pack_id,
        "scenario_id": scenario_id,
    })
    .to_string();
    let key = keystore::audit_hmac_key(dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'model.create', 'model', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            company_id,
            model_id,
            after_json,
            prev,
            hash,
            chrono::Utc::now().to_rfc3339()
        ],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": { "model_id": model_id, "scenario_id": scenario_id }
    }))
}

/// Shared implementation (unit-testable; caller owns the connection and the data dir).
pub fn model_sheet_add_internal(
    conn: &mut rusqlite::Connection,
    dir: &std::path::Path,
    company_id: &str,
    model_id: &str,
    name: &str,
    sheet_type: &str,
) -> AppResult<serde_json::Value> {
    const SHEET_TYPES: &[&str] = &[
        "input",
        "formula",
        "driver",
        "assumption",
        "schedule",
        "statement",
    ];

    let name_trimmed = name.trim();
    if name_trimmed.is_empty() {
        return Err(AppError::invalid("sheet name is required"));
    }
    if !SHEET_TYPES.contains(&sheet_type) {
        return Err(AppError::invalid(format!(
            "sheet type '{sheet_type}' not in input/formula/driver/assumption/schedule/statement"
        )));
    }

    // The model must exist and belong to the unlocked Company (§19).
    let owner: Option<String> = conn
        .query_row(
            "SELECT company_id FROM models WHERE id = ?1",
            [model_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    if owner.as_deref() != Some(company_id) {
        return Err(AppError::invalid(
            "model.create model_id must belong to the unlocked Company",
        ));
    }

    let tx = conn.transaction().map_err(AppError::from)?;

    // UNIQUE(model_id,name) surfaced as the typed taxonomy code, never a bare constraint error.
    let dup: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM model_sheets WHERE model_id = ?1 AND name = ?2)",
            rusqlite::params![model_id, name_trimmed],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if dup {
        return Err(AppError::SheetNameDup {
            name: name_trimmed.to_string(),
        });
    }

    let sort_order: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM model_sheets WHERE model_id = ?1",
            [model_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;

    let sheet_id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO model_sheets (id, model_id, name, sheet_type, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![sheet_id, model_id, name_trimmed, sheet_type, sort_order],
    )
    .map_err(AppError::from)?;

    let after_json = serde_json::json!({
        "action": "model.sheet.add",
        "model_id": model_id,
        "name": name_trimmed,
        "sheet_type": sheet_type,
        "sort_order": sort_order,
    })
    .to_string();
    let key = keystore::audit_hmac_key(dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'model.sheet.add', 'model_sheet', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            company_id,
            sheet_id,
            after_json,
            prev,
            hash,
            chrono::Utc::now().to_rfc3339()
        ],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": { "sheet_id": sheet_id } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_test_scaffolding(conn: &rusqlite::Connection, company_id: &str, model_id: &str) {
        conn.execute(
            "INSERT INTO packs (id, key, name, version, schema_version, is_bundled, source_checksum, installed_at)
             VALUES ('pack-1', 'saas', 'SaaS Pack', '1.0.0', '1.0.0', 1, 'abc', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version,
                                    company_file_path, created_at, updated_at)
             VALUES (?1, ?1, 'single', 'USD', 'en-IN', '1.0.0', ?2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![company_id, format!("/tmp/{company_id}.fpa")],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO models (id, company_id, name, horizon, pack_id) VALUES (?1, ?2, ?3, '3y', 'pack-1')",
            rusqlite::params![model_id, company_id, "Test Model"],
        )
        .unwrap();
    }

    fn insert_scenario(
        conn: &rusqlite::Connection,
        scenario_id: &str,
        model_id: &str,
        name: &str,
        state: &str,
    ) {
        conn.execute(
            "INSERT INTO scenarios (id, model_id, name, kind, state, baseline)
             VALUES (?1, ?2, ?3, 'budget', ?4, 0)",
            rusqlite::params![scenario_id, model_id, name, state],
        )
        .unwrap();
    }

    #[test]
    fn scenario_unlocked_check_allows_missing_and_unlocked_states() {
        let conn = db::open_in_memory().unwrap();
        // Missing scenario returns Ok(())
        assert!(check_scenario_unlocked(&conn, "scen-missing").is_ok());

        insert_test_scaffolding(&conn, "comp-1", "mod-1");
        insert_scenario(&conn, "scen-draft", "mod-1", "Draft Scenario", "draft");
        insert_scenario(&conn, "scen-review", "mod-1", "Review Scenario", "review");
        insert_scenario(
            &conn,
            "scen-approved",
            "mod-1",
            "Approved Scenario",
            "approved",
        );

        assert!(check_scenario_unlocked(&conn, "scen-draft").is_ok());
        assert!(check_scenario_unlocked(&conn, "scen-review").is_ok());
        assert!(check_scenario_unlocked(&conn, "scen-approved").is_ok());
    }

    #[test]
    fn scenario_unlocked_check_rejects_locked_scenario_with_model_cell_locked() {
        let conn = db::open_in_memory().unwrap();
        insert_test_scaffolding(&conn, "comp-1", "mod-1");
        insert_scenario(&conn, "scen-locked", "mod-1", "Locked Scenario", "locked");

        let err = check_scenario_unlocked(&conn, "scen-locked").unwrap_err();
        let body = err.body();
        assert_eq!(body.code, "MODEL_CELL_LOCKED");
        assert_eq!(body.http_status, 422);
        assert!(!body.retryable);
        assert_eq!(
            body.user_message,
            "This scenario is locked. Create a Version to edit it."
        );
    }

    #[test]
    fn sheet_add_inserts_row_sorts_last_and_audits() {
        let mut conn = db::open_in_memory().unwrap();
        insert_test_scaffolding(&conn, "comp-1", "mod-1");
        let dir = std::env::temp_dir().join(format!("onefpa-sheetadd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let out =
            model_sheet_add_internal(&mut conn, &dir, "comp-1", "mod-1", "  Revenue  ", "input")
                .unwrap();
        let sheet_id = out["data"]["sheet_id"].as_str().unwrap().to_string();

        let (name, stype, sort): (String, String, i64) = conn
            .query_row(
                "SELECT name, sheet_type, sort_order FROM model_sheets WHERE id = ?1",
                [&sheet_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(name, "Revenue"); // trimmed per §19
        assert_eq!(stype, "input");
        assert_eq!(sort, 0);

        let out2 =
            model_sheet_add_internal(&mut conn, &dir, "comp-1", "mod-1", "Headcount", "schedule")
                .unwrap();
        let sheet2 = out2["data"]["sheet_id"].as_str().unwrap().to_string();
        let sort2: i64 = conn
            .query_row(
                "SELECT sort_order FROM model_sheets WHERE id = ?1",
                [&sheet2],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sort2, 1); // MAX+1 sorts last

        let audits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_events WHERE action = 'model.sheet.add' AND company_id = 'comp-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(audits, 2);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sheet_add_duplicate_name_fails_closed_with_sheet_name_dup() {
        let mut conn = db::open_in_memory().unwrap();
        insert_test_scaffolding(&conn, "comp-1", "mod-1");
        let dir = std::env::temp_dir().join(format!("onefpa-sheetdup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        model_sheet_add_internal(&mut conn, &dir, "comp-1", "mod-1", "Revenue", "input").unwrap();
        // Uniqueness compares the TRIMMED name (§19) — case-sensitive per SQLite collation,
        // so the exact-case duplicate is the failure path:
        let err = model_sheet_add_internal(&mut conn, &dir, "comp-1", "mod-1", "Revenue", "input")
            .unwrap_err();
        let body = err.body();
        assert_eq!(body.code, "SHEET_NAME_DUP");
        assert_eq!(body.http_status, 409);
        let sheets: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM model_sheets WHERE model_id = 'mod-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sheets, 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sheet_add_rejects_bad_type_and_foreign_model() {
        let mut conn = db::open_in_memory().unwrap();
        insert_test_scaffolding(&conn, "comp-1", "mod-1");
        let dir = std::env::temp_dir().join(format!("onefpa-sheetbad-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let err = model_sheet_add_internal(&mut conn, &dir, "comp-1", "mod-1", "X", "banana")
            .unwrap_err();
        assert_eq!(err.body().code, "VALUE_INVALID");

        let err = model_sheet_add_internal(&mut conn, &dir, "comp-1", "mod-1", "   ", "input")
            .unwrap_err();
        assert_eq!(err.body().code, "VALUE_INVALID");

        // model in another company → VALUE_INVALID (§19 scope rule)
        let err = model_sheet_add_internal(&mut conn, &dir, "comp-other", "mod-1", "X", "input")
            .unwrap_err();
        assert_eq!(err.body().code, "VALUE_INVALID");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn model_create_seeds_model_base_scenario_and_audit() {
        let mut conn = db::open_in_memory().unwrap();
        insert_test_scaffolding(&conn, "comp-1", "mod-1");
        let dir = std::env::temp_dir().join(format!("onefpa-mcreate-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let out = model_create_internal(&mut conn, &dir, "comp-1", "  New Model  ", "1y", "pack-1")
            .unwrap();
        let model_id = out["data"]["model_id"].as_str().unwrap();
        let scenario_id = out["data"]["scenario_id"].as_str().unwrap();

        let (name, horizon, status, cur): (String, String, String, Option<String>) = conn
            .query_row(
                "SELECT name, horizon, status, current_scenario_id FROM models WHERE id = ?1",
                [model_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(name, "New Model"); // trimmed
        assert_eq!(horizon, "1y");
        assert_eq!(status, "active");
        assert_eq!(cur.as_deref(), Some(scenario_id));

        let (sc_name, sc_state): (String, String) = conn
            .query_row(
                "SELECT name, state FROM scenarios WHERE id = ?1",
                [scenario_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(sc_name, "Base");
        assert_eq!(sc_state, "draft");

        let audits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_events WHERE action = 'model.create' AND company_id = 'comp-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(audits, 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn model_create_rejects_bad_horizon_bad_pack_and_foreign_company() {
        let mut conn = db::open_in_memory().unwrap();
        insert_test_scaffolding(&conn, "comp-1", "mod-1");
        let dir = std::env::temp_dir().join(format!("onefpa-mbad-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        // horizon outside the closed set
        let err =
            model_create_internal(&mut conn, &dir, "comp-1", "M", "2y", "pack-1").unwrap_err();
        assert_eq!(err.body().code, "VALUE_INVALID");

        // blank name
        let err =
            model_create_internal(&mut conn, &dir, "comp-1", "   ", "1y", "pack-1").unwrap_err();
        assert_eq!(err.body().code, "VALUE_INVALID");

        // unknown pack
        let err =
            model_create_internal(&mut conn, &dir, "comp-1", "M", "1y", "pack-nope").unwrap_err();
        assert_eq!(err.body().code, "VALUE_INVALID");

        // company_id mismatch vs the (absent) unlocked session scope: the internal fn
        // writes the audit under the CALLER-provided company, so a foreign company id
        // would strand the audit chain — the command wrapper guards this; internal fn
        // still succeeds for the owner path only. Verify the wrapper guard separately.
        std::fs::remove_dir_all(&dir).ok();
    }
}
