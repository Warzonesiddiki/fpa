//! Scenario lifecycle and versioning commands (F-021 · F-022 · SCENARIO-VERSION-SPEC · API-SPEC §3).
//!
//! State machine:
//!   Draft -> Review -> Approved -> Locked
//!   Review -> Draft (reason required)
//!   Approved -> Draft (reason required)
//!   Locked -> Draft (reason required; only if NOT the Baseline)
//!   Draft -> Deleted (only if no Versions exist)
//!
//! Invariants kept:
//!   * Every mutation appends an HMAC-chained audit event in the SAME transaction.
//!   * Lock auto-writes the next immutable Version (v1, v2, ...).
//!   * Baseline MUST be Locked; replacing an existing Baseline demands a written reason.
//!   * No invented codes (re-use catalogued SCENARIO_NAME_DUP, SCENARIO_LOCK_CONFLICT,
//!     BASELINE_REPLACE_REASON_REQUIRED, VALUE_INVALID).

use rusqlite::{Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{SessionState, require_session_write, require_unlocked};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::{db, keystore};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScenarioVersionRow {
    pub id: String,
    pub scenario_id: String,
    pub version_no: u32,
    pub label: String,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScenarioRow {
    pub id: String,
    pub model_id: String,
    pub name: String,
    pub kind: String,
    pub state: String,
    pub parent_scenario_id: Option<String>,
    pub baseline: bool,
    pub versions: Vec<ScenarioVersionRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelSummary {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub horizon: u32,
    pub pack_id: Option<String>,
    pub scenarios: Vec<ScenarioRow>,
}

fn model_belongs_to_company(
    conn: &Connection,
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

fn record_scenario_audit(
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
         VALUES (?1, 'owner', ?2, 'scenario', ?3, ?4, ?5, ?6, ?7, ?8)",
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

pub fn create_scenario_inner(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    model_id: &str,
    name: Option<&str>,
    base_id: Option<&str>,
) -> AppResult<String> {
    let mut base_name = None;
    let mut base_kind = None;
    if let Some(bid) = base_id {
        let base: Option<(String, String)> = tx
            .query_row(
                "SELECT name, kind FROM scenarios WHERE id = ?1 AND model_id = ?2",
                rusqlite::params![bid, model_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(AppError::from)?;
        match base {
            Some((b_name, b_kind)) => {
                base_name = Some(b_name);
                base_kind = Some(b_kind);
            }
            None => {
                return Err(AppError::invalid(format!("Base scenario {bid} not found")));
            }
        }
    }

    let kind = base_kind.unwrap_or_else(|| "budget".to_string());

    let final_name = match name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) => {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM scenarios WHERE model_id = ?1 AND name = ?2)",
                    rusqlite::params![model_id, n],
                    |row| row.get(0),
                )
                .map_err(AppError::from)?;
            if exists {
                return Err(AppError::scenario_name_dup(n));
            }
            n.to_string()
        }
        None => {
            if let Some(ref b_name) = base_name {
                let mut candidate = format!("{b_name} (copy)");
                let mut counter = 1;
                while tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM scenarios WHERE model_id = ?1 AND name = ?2)",
                        rusqlite::params![model_id, candidate],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(AppError::from)?
                {
                    counter += 1;
                    candidate = format!("{b_name} (copy {counter})");
                }
                candidate
            } else {
                let mut candidate = "Base".to_string();
                let mut counter = 1;
                while tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM scenarios WHERE model_id = ?1 AND name = ?2)",
                        rusqlite::params![model_id, candidate],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(AppError::from)?
                {
                    counter += 1;
                    candidate = format!("Base (copy {counter})");
                }
                candidate
            }
        }
    };

    let scenario_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO scenarios (id, model_id, name, kind, state, parent_scenario_id, baseline)
         VALUES (?1, ?2, ?3, ?4, 'draft', ?5, 0)",
        rusqlite::params![scenario_id, model_id, final_name, kind, base_id],
    )
    .map_err(AppError::from)?;

    let after_json = serde_json::json!({
        "id": scenario_id,
        "model_id": model_id,
        "name": final_name,
        "kind": kind,
        "state": "draft",
        "parent_scenario_id": base_id,
        "baseline": false,
    });
    record_scenario_audit(
        tx,
        dir,
        company_id,
        "scenario.create",
        &scenario_id,
        serde_json::Value::Null,
        after_json,
    )?;

    Ok(scenario_id)
}

pub fn duplicate_scenario_inner(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    model_id: &str,
    name: Option<&str>,
    base_id: Option<&str>,
) -> AppResult<String> {
    let mut base_name = None;
    let mut base_kind = None;
    if let Some(bid) = base_id {
        let base: Option<(String, String)> = tx
            .query_row(
                "SELECT name, kind FROM scenarios WHERE id = ?1 AND model_id = ?2",
                rusqlite::params![bid, model_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(AppError::from)?;
        match base {
            Some((b_name, b_kind)) => {
                base_name = Some(b_name);
                base_kind = Some(b_kind);
            }
            None => {
                return Err(AppError::invalid(format!("Base scenario {bid} not found")));
            }
        }
    }

    let kind = base_kind.unwrap_or_else(|| "budget".to_string());

    let final_name = match name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) => {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM scenarios WHERE model_id = ?1 AND name = ?2)",
                    rusqlite::params![model_id, n],
                    |row| row.get(0),
                )
                .map_err(AppError::from)?;
            if exists {
                return Err(AppError::scenario_name_dup(n));
            }
            n.to_string()
        }
        None => {
            if let Some(ref b_name) = base_name {
                let mut candidate = format!("{b_name} (copy)");
                let mut counter = 1;
                while tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM scenarios WHERE model_id = ?1 AND name = ?2)",
                        rusqlite::params![model_id, candidate],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(AppError::from)?
                {
                    counter += 1;
                    candidate = format!("{b_name} (copy {counter})");
                }
                candidate
            } else {
                let mut candidate = "Base".to_string();
                let mut counter = 1;
                while tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM scenarios WHERE model_id = ?1 AND name = ?2)",
                        rusqlite::params![model_id, candidate],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(AppError::from)?
                {
                    counter += 1;
                    candidate = format!("Base (copy {counter})");
                }
                candidate
            }
        }
    };

    let scenario_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO scenarios (id, model_id, name, kind, state, parent_scenario_id, baseline)
         VALUES (?1, ?2, ?3, ?4, 'draft', ?5, 0)",
        rusqlite::params![scenario_id, model_id, final_name, kind, base_id],
    )
    .map_err(AppError::from)?;

    // Duplicate cell values from base if available
    if let Some(bid) = base_id {
        let mut stmt = tx
            .prepare(
                "SELECT line_id, period_id, amount_minor, amount_text, formula, computed, source_version_id
                 FROM model_values WHERE scenario_id = ?1",
            )
            .map_err(AppError::from)?;
        let rows = stmt
            .query_map([bid], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(AppError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;
        drop(stmt);

        for (line_id, period_id, amount_minor, amount_text, formula, computed, source_version_id) in
            rows
        {
            let val_id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO model_values (id, line_id, scenario_id, period_id, amount_minor, amount_text, formula, computed, source_version_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    val_id,
                    line_id,
                    scenario_id,
                    period_id,
                    amount_minor,
                    amount_text,
                    formula,
                    computed,
                    source_version_id
                ],
            )
            .map_err(AppError::from)?;
        }
    }

    let after_json = serde_json::json!({
        "id": scenario_id,
        "model_id": model_id,
        "name": final_name,
        "kind": kind,
        "state": "draft",
        "parent_scenario_id": base_id,
        "baseline": false,
    });
    record_scenario_audit(
        tx,
        dir,
        company_id,
        "scenario.duplicate",
        &scenario_id,
        serde_json::Value::Null,
        after_json,
    )?;

    Ok(scenario_id)
}

pub fn submit_scenario_inner(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    scenario_id: &str,
) -> AppResult<()> {
    let scenario: Option<String> = tx
        .query_row(
            "SELECT s.state
             FROM scenarios s
             JOIN models m ON m.id = s.model_id
             WHERE s.id = ?1 AND m.company_id = ?2",
            rusqlite::params![scenario_id, company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    let state = match scenario {
        Some(s) => s,
        None => {
            return Err(AppError::invalid(format!(
                "Scenario {scenario_id} not found"
            )));
        }
    };

    if state != "draft" {
        return Err(AppError::scenario_lock_conflict(&state));
    }

    tx.execute(
        "UPDATE scenarios SET state = 'review' WHERE id = ?1",
        [scenario_id],
    )
    .map_err(AppError::from)?;

    let before_json = serde_json::json!({ "state": "draft" });
    let after_json = serde_json::json!({ "state": "review" });
    record_scenario_audit(
        tx,
        dir,
        company_id,
        "scenario.submit",
        scenario_id,
        before_json,
        after_json,
    )?;
    Ok(())
}

pub fn approve_scenario_inner(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    scenario_id: &str,
) -> AppResult<()> {
    let scenario: Option<String> = tx
        .query_row(
            "SELECT s.state
             FROM scenarios s
             JOIN models m ON m.id = s.model_id
             WHERE s.id = ?1 AND m.company_id = ?2",
            rusqlite::params![scenario_id, company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    let state = match scenario {
        Some(s) => s,
        None => {
            return Err(AppError::invalid(format!(
                "Scenario {scenario_id} not found"
            )));
        }
    };

    if state != "review" {
        return Err(AppError::scenario_lock_conflict(&state));
    }

    tx.execute(
        "UPDATE scenarios SET state = 'approved' WHERE id = ?1",
        [scenario_id],
    )
    .map_err(AppError::from)?;

    let before_json = serde_json::json!({ "state": "review" });
    let after_json = serde_json::json!({ "state": "approved" });
    record_scenario_audit(
        tx,
        dir,
        company_id,
        "scenario.approve",
        scenario_id,
        before_json,
        after_json,
    )?;
    Ok(())
}

pub fn lock_scenario_inner(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    scenario_id: &str,
) -> AppResult<String> {
    let scenario: Option<String> = tx
        .query_row(
            "SELECT s.state
             FROM scenarios s
             JOIN models m ON m.id = s.model_id
             WHERE s.id = ?1 AND m.company_id = ?2",
            rusqlite::params![scenario_id, company_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    let state = match scenario {
        Some(s) => s,
        None => {
            return Err(AppError::invalid(format!(
                "Scenario {scenario_id} not found"
            )));
        }
    };

    if state != "approved" {
        return Err(AppError::scenario_lock_conflict(&state));
    }

    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM scenario_versions WHERE scenario_id = ?1",
            [scenario_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;

    let version_no = count + 1;
    let version_id = Uuid::new_v4().to_string();
    let label = format!("v{version_no}");
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO scenario_versions (id, scenario_id, version_no, label, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, '', ?5)",
        rusqlite::params![version_id, scenario_id, version_no, label, now],
    )
    .map_err(AppError::from)?;

    tx.execute(
        "UPDATE scenarios SET state = 'locked' WHERE id = ?1",
        [scenario_id],
    )
    .map_err(AppError::from)?;

    let before_json = serde_json::json!({ "state": "approved" });
    let after_json = serde_json::json!({
        "state": "locked",
        "version_id": version_id,
        "version_no": version_no,
    });
    record_scenario_audit(
        tx,
        dir,
        company_id,
        "scenario.lock",
        scenario_id,
        before_json,
        after_json,
    )?;

    Ok(version_id)
}

pub fn reopen_scenario_inner(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    scenario_id: &str,
    reason: Option<&str>,
) -> AppResult<()> {
    let reason_trimmed = reason.map(str::trim).filter(|s| !s.is_empty());
    let reason_str = match reason_trimmed {
        Some(r) => r,
        None => {
            return Err(AppError::invalid(
                "A written reason is required to reopen a Scenario.",
            ));
        }
    };

    let scenario: Option<(String, bool)> = tx
        .query_row(
            "SELECT s.state, s.baseline
             FROM scenarios s
             JOIN models m ON m.id = s.model_id
             WHERE s.id = ?1 AND m.company_id = ?2",
            rusqlite::params![scenario_id, company_id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
        )
        .optional()
        .map_err(AppError::from)?;

    let (state, baseline) = match scenario {
        Some(s) => s,
        None => {
            return Err(AppError::invalid(format!(
                "Scenario {scenario_id} not found"
            )));
        }
    };

    if state == "draft" {
        return Err(AppError::scenario_lock_conflict(&state));
    }

    if state == "locked" && baseline {
        return Err(AppError::scenario_lock_conflict(&state));
    }

    tx.execute(
        "UPDATE scenarios SET state = 'draft' WHERE id = ?1",
        [scenario_id],
    )
    .map_err(AppError::from)?;

    let before_json = serde_json::json!({ "state": state });
    let after_json = serde_json::json!({ "state": "draft", "reason": reason_str });
    record_scenario_audit(
        tx,
        dir,
        company_id,
        "scenario.reopen",
        scenario_id,
        before_json,
        after_json,
    )?;

    Ok(())
}

pub fn delete_scenario_inner(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    scenario_id: &str,
) -> AppResult<()> {
    let scenario: Option<(String, bool)> = tx
        .query_row(
            "SELECT s.state, s.baseline
             FROM scenarios s
             JOIN models m ON m.id = s.model_id
             WHERE s.id = ?1 AND m.company_id = ?2",
            rusqlite::params![scenario_id, company_id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
        )
        .optional()
        .map_err(AppError::from)?;

    let (state, baseline) = match scenario {
        Some(s) => s,
        None => {
            return Err(AppError::invalid(format!(
                "Scenario {scenario_id} not found"
            )));
        }
    };

    if state != "draft" {
        return Err(AppError::scenario_lock_conflict(&state));
    }

    if baseline {
        return Err(AppError::scenario_lock_conflict(&state));
    }

    let version_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM scenario_versions WHERE scenario_id = ?1",
            [scenario_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;

    if version_count > 0 {
        return Err(AppError::scenario_lock_conflict(&state));
    }

    tx.execute(
        "DELETE FROM model_values WHERE scenario_id = ?1",
        [scenario_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "UPDATE models SET current_scenario_id = NULL WHERE current_scenario_id = ?1",
        [scenario_id],
    )
    .map_err(AppError::from)?;
    tx.execute("DELETE FROM scenarios WHERE id = ?1", [scenario_id])
        .map_err(AppError::from)?;

    let before_json = serde_json::json!({ "id": scenario_id, "state": "draft" });
    let after_json = serde_json::json!({ "deleted": true });
    record_scenario_audit(
        tx,
        dir,
        company_id,
        "scenario.delete",
        scenario_id,
        before_json,
        after_json,
    )?;

    Ok(())
}

pub fn baseline_set_inner(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    scenario_id: &str,
    reason: Option<&str>,
) -> AppResult<String> {
    let scenario: Option<(String, String)> = tx
        .query_row(
            "SELECT s.state, s.model_id
             FROM scenarios s
             JOIN models m ON m.id = s.model_id
             WHERE s.id = ?1 AND m.company_id = ?2",
            rusqlite::params![scenario_id, company_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?;

    let (state, model_id) = match scenario {
        Some(s) => s,
        None => {
            return Err(AppError::invalid(format!(
                "Scenario {scenario_id} not found"
            )));
        }
    };

    if state != "locked" {
        return Err(AppError::scenario_lock_conflict(&state));
    }

    let current_baseline: Option<String> = tx
        .query_row(
            "SELECT id FROM scenarios WHERE model_id = ?1 AND baseline = 1 AND id != ?2",
            rusqlite::params![model_id, scenario_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    let reason_trimmed = reason.map(str::trim).filter(|s| !s.is_empty());
    if let (Some(cur_id), None) = (&current_baseline, reason_trimmed) {
        return Err(AppError::baseline_replace_reason_required(Some(
            cur_id.clone(),
        )));
    }

    tx.execute(
        "UPDATE scenarios SET baseline = 0 WHERE model_id = ?1",
        [&model_id],
    )
    .map_err(AppError::from)?;
    tx.execute(
        "UPDATE scenarios SET baseline = 1 WHERE id = ?1",
        [scenario_id],
    )
    .map_err(AppError::from)?;

    let latest_version: Option<String> = tx
        .query_row(
            "SELECT id FROM scenario_versions WHERE scenario_id = ?1 ORDER BY version_no DESC LIMIT 1",
            [scenario_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    let baseline_version_id = latest_version.unwrap_or_else(|| scenario_id.to_string());

    let after_json = serde_json::json!({
        "baseline": true,
        "baseline_version_id": baseline_version_id,
        "reason": reason_trimmed,
    });
    record_scenario_audit(
        tx,
        dir,
        company_id,
        "baseline.set",
        scenario_id,
        serde_json::Value::Null,
        after_json,
    )?;

    Ok(baseline_version_id)
}

pub fn list_models_inner(conn: &Connection, company_id: &str) -> AppResult<Vec<ModelSummary>> {
    let mut model_stmt = conn
        .prepare(
            "SELECT id, company_id, name, horizon, pack_id
             FROM models WHERE company_id = ?1 ORDER BY rowid ASC",
        )
        .map_err(AppError::from)?;

    let model_rows = model_stmt
        .query_map([company_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    drop(model_stmt);

    let mut models = Vec::new();
    for (m_id, c_id, m_name, h_str, p_id) in model_rows {
        let digits: String = h_str.chars().filter(|c| c.is_ascii_digit()).collect();
        let horizon_val: u32 = digits.parse().unwrap_or(1).max(1);

        let mut scen_stmt = conn
            .prepare(
                "SELECT id, model_id, name, kind, state, parent_scenario_id, baseline
                 FROM scenarios WHERE model_id = ?1 ORDER BY rowid ASC",
            )
            .map_err(AppError::from)?;

        let scen_rows = scen_stmt
            .query_map([&m_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, i64>(6)? != 0,
                ))
            })
            .map_err(AppError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;
        drop(scen_stmt);

        let mut scenarios = Vec::new();
        for (s_id, sm_id, s_name, s_kind, s_state, s_parent, s_baseline) in scen_rows {
            let mut ver_stmt = conn
                .prepare(
                    "SELECT id, scenario_id, version_no, label, reason, created_at
                     FROM scenario_versions WHERE scenario_id = ?1 ORDER BY version_no ASC",
                )
                .map_err(AppError::from)?;

            let ver_rows = ver_stmt
                .query_map([&s_id], |r| {
                    let reason_raw: Option<String> = r.get(4)?;
                    let reason = reason_raw.filter(|s| !s.is_empty());
                    Ok(ScenarioVersionRow {
                        id: r.get(0)?,
                        scenario_id: r.get(1)?,
                        version_no: r.get::<_, u32>(2)?,
                        label: r.get(3)?,
                        reason,
                        created_at: r.get(5)?,
                    })
                })
                .map_err(AppError::from)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::from)?;
            drop(ver_stmt);

            scenarios.push(ScenarioRow {
                id: s_id,
                model_id: sm_id,
                name: s_name,
                kind: s_kind,
                state: s_state,
                parent_scenario_id: s_parent,
                baseline: s_baseline,
                versions: ver_rows,
            });
        }

        models.push(ModelSummary {
            id: m_id,
            company_id: c_id,
            name: m_name,
            horizon: horizon_val,
            pack_id: p_id,
            scenarios,
        });
    }

    Ok(models)
}

/// `scenario.create` — {model_id, name?, base_id?} -> {scenario_id, version_id} (API-SPEC §3).
#[tauri::command(name = "scenario.create", rename_all = "snake_case")]
pub fn scenario_create(
    app: AppHandle,
    model_id: String,
    name: Option<String>,
    base_id: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    if !model_belongs_to_company(&conn, &model_id, &company_id)? {
        return Err(AppError::Scope(
            "model is not owned by the active Company".into(),
        ));
    }

    let tx = conn.transaction().map_err(AppError::from)?;
    let scenario_id = create_scenario_inner(
        &tx,
        &dir,
        &company_id,
        &model_id,
        name.as_deref(),
        base_id.as_deref(),
    )?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "scenario_id": scenario_id,
            "version_id": serde_json::Value::Null,
        }
    }))
}

/// `scenario.duplicate` — {model_id, name?, base_id?} -> {scenario_id, version_id} (API-SPEC §3).
#[tauri::command(name = "scenario.duplicate", rename_all = "snake_case")]
pub fn scenario_duplicate(
    app: AppHandle,
    model_id: String,
    name: Option<String>,
    base_id: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    if !model_belongs_to_company(&conn, &model_id, &company_id)? {
        return Err(AppError::Scope(
            "model is not owned by the active Company".into(),
        ));
    }

    let tx = conn.transaction().map_err(AppError::from)?;
    let scenario_id = duplicate_scenario_inner(
        &tx,
        &dir,
        &company_id,
        &model_id,
        name.as_deref(),
        base_id.as_deref(),
    )?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "scenario_id": scenario_id,
            "version_id": serde_json::Value::Null,
        }
    }))
}

/// `scenario.submit` — {scenario_id} -> {scenario_id, version_id} (API-SPEC §3).
#[tauri::command(name = "scenario.submit", rename_all = "snake_case")]
pub fn scenario_submit(
    app: AppHandle,
    scenario_id: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;
    submit_scenario_inner(&tx, &dir, &company_id, &scenario_id)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "scenario_id": scenario_id,
            "version_id": serde_json::Value::Null,
        }
    }))
}

/// `scenario.approve` — {scenario_id} -> {scenario_id, version_id} (API-SPEC §3).
#[tauri::command(name = "scenario.approve", rename_all = "snake_case")]
pub fn scenario_approve(
    app: AppHandle,
    scenario_id: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;
    approve_scenario_inner(&tx, &dir, &company_id, &scenario_id)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "scenario_id": scenario_id,
            "version_id": serde_json::Value::Null,
        }
    }))
}

/// `scenario.lock` — {scenario_id} -> {scenario_id, version_id} (API-SPEC §3).
#[tauri::command(name = "scenario.lock", rename_all = "snake_case")]
pub fn scenario_lock(
    app: AppHandle,
    scenario_id: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;
    let version_id = lock_scenario_inner(&tx, &dir, &company_id, &scenario_id)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "scenario_id": scenario_id,
            "version_id": version_id,
        }
    }))
}

/// `scenario.reopen` — {scenario_id, reason?} -> {scenario_id, version_id} (API-SPEC §3).
#[tauri::command(name = "scenario.reopen", rename_all = "snake_case")]
pub fn scenario_reopen(
    app: AppHandle,
    scenario_id: String,
    reason: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;
    reopen_scenario_inner(&tx, &dir, &company_id, &scenario_id, reason.as_deref())?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "scenario_id": scenario_id,
            "version_id": serde_json::Value::Null,
        }
    }))
}

/// `scenario.delete` — {scenario_id} -> {scenario_id, version_id} (API-SPEC §3).
#[tauri::command(name = "scenario.delete", rename_all = "snake_case")]
pub fn scenario_delete(
    app: AppHandle,
    scenario_id: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;
    delete_scenario_inner(&tx, &dir, &company_id, &scenario_id)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "scenario_id": scenario_id,
            "version_id": serde_json::Value::Null,
        }
    }))
}

/// `baseline.set` — {scenario_id, reason?} -> {baseline_version_id} (API-SPEC §3).
#[tauri::command(name = "baseline.set", rename_all = "snake_case")]
pub fn baseline_set(
    app: AppHandle,
    scenario_id: String,
    reason: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;
    let baseline_version_id =
        baseline_set_inner(&tx, &dir, &company_id, &scenario_id, reason.as_deref())?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "baseline_version_id": baseline_version_id,
        }
    }))
}

/// `model.list` — {company_id} -> Model[] (API-SPEC §3).
#[tauri::command(name = "model.list", rename_all = "snake_case")]
pub fn model_list(
    app: AppHandle,
    company_id: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let session_company_id = require_unlocked(&session)?;
    if session_company_id != company_id {
        return Err(AppError::Scope(
            "requested company does not match unlocked session".into(),
        ));
    }

    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;
    let models = list_models_inner(&conn, &company_id)?;

    Ok(serde_json::json!({ "data": models }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("onefpa-scenario-{}", Uuid::new_v4()));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    fn setup_test_db() -> (Connection, std::path::PathBuf, String, String) {
        let conn = db::open_in_memory().unwrap();
        let temp_dir = test_dir();
        let company_id = Uuid::new_v4().to_string();
        let model_id = Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO packs (id, key, name, version, schema_version, description, is_bundled, source_checksum, installed_at)
             VALUES ('pack_mfg', 'mfg', 'Manufacturing', '1.0.0', '1.0.0', 'Mfg Pack', 1, 'abc', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version, company_file_path, created_at, updated_at)
             VALUES (?1, 'Acme Corp', 'single', 'USD', 'en-US', '1.0.0', '/tmp/acme.fpa', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [&company_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO models (id, company_id, name, horizon, status, current_scenario_id, pack_id)
             VALUES (?1, ?2, 'Acme Model', '1y', 'active', NULL, 'pack_mfg')",
            rusqlite::params![model_id, company_id],
        )
        .unwrap();

        (conn, temp_dir, company_id, model_id)
    }

    #[test]
    fn model_summary_serializes_cleanly() {
        let summary = ModelSummary {
            id: "m-1".into(),
            company_id: "c-1".into(),
            name: "Main Model".into(),
            horizon: 1,
            pack_id: None,
            scenarios: vec![ScenarioRow {
                id: "sc-1".into(),
                model_id: "m-1".into(),
                name: "Base".into(),
                kind: "budget".into(),
                state: "draft".into(),
                parent_scenario_id: None,
                baseline: true,
                versions: vec![ScenarioVersionRow {
                    id: "v-1".into(),
                    scenario_id: "sc-1".into(),
                    version_no: 1,
                    label: "v1".into(),
                    reason: None,
                    created_at: "2026-09-04T00:00:00Z".into(),
                }],
            }],
        };

        let v = serde_json::to_value(&summary).unwrap();
        assert_eq!(v["name"], "Main Model");
        assert_eq!(v["scenarios"][0]["name"], "Base");
        assert_eq!(v["scenarios"][0]["versions"][0]["label"], "v1");
        assert_eq!(
            v["scenarios"][0]["versions"][0]["reason"],
            serde_json::Value::Null
        );
    }

    #[test]
    fn scenario_lifecycle_full_state_machine_and_audit() {
        let (mut conn, temp_dir, company_id, model_id) = setup_test_db();
        let dir = &temp_dir;

        // 1. Create Base Scenario
        let tx = conn.transaction().unwrap();
        let base_id = create_scenario_inner(
            &tx,
            dir,
            &company_id,
            &model_id,
            Some("Base Scenario"),
            None,
        )
        .unwrap();
        tx.commit().unwrap();

        // 2. Duplicate name check fails with SCENARIO_NAME_DUP
        let tx = conn.transaction().unwrap();
        let err = create_scenario_inner(
            &tx,
            dir,
            &company_id,
            &model_id,
            Some("Base Scenario"),
            None,
        )
        .unwrap_err();
        assert_eq!(err.body().code, "SCENARIO_NAME_DUP");
        tx.rollback().unwrap();

        // 3. Duplicate without name derives candidate name "Base Scenario (copy)"
        let tx = conn.transaction().unwrap();
        let copy_id =
            duplicate_scenario_inner(&tx, dir, &company_id, &model_id, None, Some(&base_id))
                .unwrap();
        tx.commit().unwrap();

        // Check name
        let copy_name: String = conn
            .query_row(
                "SELECT name FROM scenarios WHERE id = ?1",
                [&copy_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(copy_name, "Base Scenario (copy)");

        // 4. Submit Base: Draft -> Review
        let tx = conn.transaction().unwrap();
        submit_scenario_inner(&tx, dir, &company_id, &base_id).unwrap();
        tx.commit().unwrap();

        // Submit again fails with SCENARIO_LOCK_CONFLICT
        let tx = conn.transaction().unwrap();
        let err = submit_scenario_inner(&tx, dir, &company_id, &base_id).unwrap_err();
        assert_eq!(err.body().code, "SCENARIO_LOCK_CONFLICT");
        tx.rollback().unwrap();

        // 5. Approve Base: Review -> Approved
        let tx = conn.transaction().unwrap();
        approve_scenario_inner(&tx, dir, &company_id, &base_id).unwrap();
        tx.commit().unwrap();

        // Approve again fails
        let tx = conn.transaction().unwrap();
        let err = approve_scenario_inner(&tx, dir, &company_id, &base_id).unwrap_err();
        assert_eq!(err.body().code, "SCENARIO_LOCK_CONFLICT");
        tx.rollback().unwrap();

        // 6. Lock Base: Approved -> Locked + creates version v1
        let tx = conn.transaction().unwrap();
        let v1_id = lock_scenario_inner(&tx, dir, &company_id, &base_id).unwrap();
        tx.commit().unwrap();
        assert!(!v1_id.is_empty());

        let ver_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scenario_versions WHERE scenario_id = ?1",
                [&base_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ver_count, 1);

        // 7. Baseline set: marks Base as baseline
        let tx = conn.transaction().unwrap();
        let base_ver = baseline_set_inner(&tx, dir, &company_id, &base_id, None).unwrap();
        tx.commit().unwrap();
        assert_eq!(base_ver, v1_id);

        // 8. Reopen on locked baseline fails conflict
        let tx = conn.transaction().unwrap();
        let err = reopen_scenario_inner(&tx, dir, &company_id, &base_id, Some("need adjustments"))
            .unwrap_err();
        assert_eq!(err.body().code, "SCENARIO_LOCK_CONFLICT");
        tx.rollback().unwrap();

        // 9. Reopen without reason fails VALUE_INVALID
        let tx = conn.transaction().unwrap();
        let err = reopen_scenario_inner(&tx, dir, &company_id, &copy_id, Some("   ")).unwrap_err();
        assert_eq!(err.body().code, "VALUE_INVALID");
        tx.rollback().unwrap();

        // 10. Delete copy (which is in draft and has no versions): succeeds
        let tx = conn.transaction().unwrap();
        delete_scenario_inner(&tx, dir, &company_id, &copy_id).unwrap();
        tx.commit().unwrap();

        // 11. Model list returns the model with nested Base scenario and its version v1
        let models = list_models_inner(&conn, &company_id).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "Acme Model");
        assert_eq!(models[0].horizon, 1);
        assert_eq!(models[0].scenarios.len(), 1);
        assert_eq!(models[0].scenarios[0].name, "Base Scenario");
        assert_eq!(models[0].scenarios[0].state, "locked");
        assert!(models[0].scenarios[0].baseline);
        assert_eq!(models[0].scenarios[0].versions.len(), 1);
        assert_eq!(models[0].scenarios[0].versions[0].label, "v1");
    }
}
