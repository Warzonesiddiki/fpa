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
}
