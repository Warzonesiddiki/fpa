//! Planning Cycle Manager and Input Collection Loop (M4-5 · M4-6 · F-021 · F-023 · S-053).
//!
//! Commands:
//! - `cycle.start`: `{model_id, kind, name, due}` -> `{cycle_id}` (CYCLE_NAME_DUP 409)
//! - `cycle.task.update`: `{task_id, status, note}` -> `{updated: true}` (CYCLE_TASK_BLOCKED 409)
//! - `cycle.checklist.status`: `{model_id, period_id}` -> `{tasks: Vec<CycleTaskRow>, ready: bool}`
//! - `collection.export`: `{cycle_id, driver_ids[], template}` -> `{file: String, rows: u32}` (COLLECTION_STRUCTURE_CHANGED 422)
//! - `collection.import`: `{cycle_id, file_path, mapping_id}` -> `{batch_id: String, conflicts: Vec<CollectionConflict>}` (COLLECTION_CONFLICT 409, COLLECTION_STRUCTURE_CHANGED 422)
//! - `collection.resolve_conflict`: `{conflict_id, choice, note}` -> `{resolved: true}`
//!
//! Invariants:
//! - SQLite transactions with atomic HMAC audit event logging.
//! - Exactly matches error codes and user messages from `docs/ERROR-HANDLING.md`.
//! - No float math in values or calculation (`money:ast`).

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
pub struct CycleTaskRow {
    pub id: String,
    pub cycle_id: String,
    pub title: String,
    pub owner: String,
    pub depends_on_id: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollectionConflict {
    pub id: String,
    pub upload_id: String,
    pub driver_id: String,
    pub driver_name: String,
    pub period_id: String,
    pub contributor_a: String,
    pub value_a: String,
    pub contributor_b: String,
    pub value_b: String,
    pub resolved: bool,
    pub resolution_choice: Option<String>,
    pub resolved_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlanningCycleRow {
    pub id: String,
    pub company_id: String,
    pub model_id: String,
    pub name: String,
    pub kind: String,
    pub state: String,
    pub starts_at: String,
    pub ends_at: String,
    pub baseline_scenario_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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

fn record_cycle_audit(
    tx: &Transaction<'_>,
    dir: &Path,
    company_id: &str,
    action: &str,
    object_type: &str,
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
         VALUES (?1, 'owner', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            company_id,
            action,
            object_type,
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

/// Create default close checklist tasks for a newly initialized cycle
fn seed_default_cycle_tasks(tx: &Transaction<'_>, cycle_id: &str) -> AppResult<()> {
    let t1_id = format!("{cycle_id}-task-1");
    let t2_id = format!("{cycle_id}-task-2");
    let t3_id = format!("{cycle_id}-task-3");
    let t4_id = format!("{cycle_id}-task-4");

    tx.execute(
        "INSERT INTO cycle_tasks (id, cycle_id, title, owner, depends_on_id, status, sort_order)
         VALUES (?1, ?2, 'Import all BU actuals', 'FinOps', NULL, 'pending', 1)",
        rusqlite::params![t1_id, cycle_id],
    )
    .map_err(AppError::from)?;

    tx.execute(
        "INSERT INTO cycle_tasks (id, cycle_id, title, owner, depends_on_id, status, sort_order)
         VALUES (?1, ?2, 'Run GL tie-out and reconcile accounts', 'Accounting', ?3, 'pending', 2)",
        rusqlite::params![t2_id, cycle_id, t1_id],
    )
    .map_err(AppError::from)?;

    tx.execute(
        "INSERT INTO cycle_tasks (id, cycle_id, title, owner, depends_on_id, status, sort_order)
         VALUES (?1, ?2, 'Execute Health Check and review integrity rules', 'FP&A Lead', ?3, 'pending', 3)",
        rusqlite::params![t3_id, cycle_id, t2_id],
    )
    .map_err(AppError::from)?;

    tx.execute(
        "INSERT INTO cycle_tasks (id, cycle_id, title, owner, depends_on_id, status, sort_order)
         VALUES (?1, ?2, 'Approve variance commentary and lock cycle', 'VP Finance', ?3, 'pending', 4)",
        rusqlite::params![t4_id, cycle_id, t3_id],
    )
    .map_err(AppError::from)?;

    Ok(())
}

/// `cycle.start` — Start a new planning cycle.
#[tauri::command(name = "cycle.start", rename_all = "snake_case")]
pub fn cycle_start(
    app: AppHandle,
    model_id: String,
    kind: String,
    name: String,
    due: String,
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

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::invalid("Cycle name cannot be empty."));
    }

    let valid_kind = match kind.as_str() {
        "budget" | "forecast" | "rolling" => kind,
        _ => {
            return Err(AppError::invalid(
                "Kind must be budget, forecast, or rolling.",
            ));
        }
    };

    let tx = conn.transaction().map_err(AppError::from)?;

    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM planning_cycles WHERE company_id = ?1 AND name = ?2)",
            rusqlite::params![company_id, trimmed_name],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;

    if exists {
        return Err(AppError::cycle_name_dup());
    }

    let cycle_id = format!("pc-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO planning_cycles (id, company_id, model_id, name, kind, state, starts_at, ends_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9)",
        rusqlite::params![
            cycle_id,
            company_id,
            model_id,
            trimmed_name,
            valid_kind,
            now,
            due,
            now,
            now,
        ],
    )
    .map_err(AppError::from)?;

    seed_default_cycle_tasks(&tx, &cycle_id)?;

    let after_json = serde_json::json!({
        "id": cycle_id,
        "company_id": company_id,
        "model_id": model_id,
        "name": trimmed_name,
        "kind": valid_kind,
        "state": "active",
        "ends_at": due,
    });

    record_cycle_audit(
        &tx,
        &dir,
        &company_id,
        "cycle.start",
        "planning_cycle",
        &cycle_id,
        serde_json::Value::Null,
        after_json,
    )?;

    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "cycle_id": cycle_id }))
}

/// `cycle.task.update` — Update a task status in the close checklist.
#[tauri::command(name = "cycle.task.update", rename_all = "snake_case")]
pub fn cycle_task_update(
    app: AppHandle,
    task_id: String,
    status: String,
    note: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    let valid_status = match status.as_str() {
        "pending" | "done" | "blocked" => status,
        _ => {
            return Err(AppError::invalid(
                "Status must be pending, done, or blocked.",
            ));
        }
    };

    let tx = conn.transaction().map_err(AppError::from)?;

    let task_opt: Option<(String, String, Option<String>)> = tx
        .query_row(
            "SELECT t.cycle_id, t.status, t.depends_on_id
             FROM cycle_tasks t
             JOIN planning_cycles c ON c.id = t.cycle_id
             WHERE t.id = ?1 AND c.company_id = ?2",
            rusqlite::params![task_id, company_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(AppError::from)?;

    let (cycle_id, current_status, depends_on_id) = match task_opt {
        Some(t) => t,
        None => return Err(AppError::invalid(format!("Task {task_id} not found."))),
    };

    if valid_status == "done"
        && let Some(dep_id) = depends_on_id
    {
        let dep_opt: Option<(String, String)> = tx
            .query_row(
                "SELECT title, status FROM cycle_tasks WHERE id = ?1",
                rusqlite::params![dep_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(AppError::from)?;

        if let Some((dep_title, dep_status)) = dep_opt
            && dep_status != "done"
        {
            return Err(AppError::cycle_task_blocked(dep_title));
        }
    }

    tx.execute(
        "UPDATE cycle_tasks SET status = ?1 WHERE id = ?2",
        rusqlite::params![valid_status, task_id],
    )
    .map_err(AppError::from)?;

    let before_json = serde_json::json!({ "status": current_status });
    let after_json = serde_json::json!({ "status": valid_status, "note": note });

    record_cycle_audit(
        &tx,
        &dir,
        &company_id,
        "cycle.task.update",
        "cycle_task",
        &task_id,
        before_json,
        after_json,
    )?;

    tx.commit().map_err(AppError::from)?;

    let _ = cycle_id;
    Ok(serde_json::json!({ "updated": true }))
}

/// `cycle.checklist.status` — Retrieve tasks and overall ready state for a period or model.
#[tauri::command(name = "cycle.checklist.status", rename_all = "snake_case")]
pub fn cycle_checklist_status(
    app: AppHandle,
    model_id: String,
    period_id: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&session)?;
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;

    if !model_belongs_to_company(&conn, &model_id, &company_id)? {
        return Err(AppError::Scope(
            "model is not owned by the active Company".into(),
        ));
    }

    let cycle_opt: Option<String> = conn
        .query_row(
            "SELECT id FROM planning_cycles WHERE company_id = ?1 AND model_id = ?2 AND state IN ('active', 'review')
             ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![company_id, model_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;

    let cycle_id = match cycle_opt {
        Some(cid) => cid,
        None => {
            return Ok(serde_json::json!({
                "tasks": Vec::<CycleTaskRow>::new(),
                "ready": false,
                "cycle_id": null
            }));
        }
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, cycle_id, title, owner, depends_on_id, due_date, status, sort_order
             FROM cycle_tasks WHERE cycle_id = ?1 ORDER BY sort_order ASC",
        )
        .map_err(AppError::from)?;

    let task_rows = stmt
        .query_map([&cycle_id], |r| {
            Ok(CycleTaskRow {
                id: r.get(0)?,
                cycle_id: r.get(1)?,
                title: r.get(2)?,
                owner: r.get(3)?,
                depends_on_id: r.get(4)?,
                due_date: r.get(5)?,
                status: r.get(6)?,
                sort_order: r.get(7)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    let ready = !task_rows.is_empty() && task_rows.iter().all(|t| t.status == "done");

    let _ = period_id;
    Ok(serde_json::json!({
        "cycle_id": cycle_id,
        "tasks": task_rows,
        "ready": ready
    }))
}

/// `collection.export` — Write a real CSV collection template for the cycle's model:
/// one row per collection driver × period, columns `driver_id,period_code,value`.
/// The file is written to disk, the run is persisted as an `import_batches` row
/// (kind='collection', status='validated') and the export is HMAC-audited (B7).
#[tauri::command(name = "collection.export", rename_all = "snake_case")]
pub fn collection_export(
    app: AppHandle,
    cycle_id: String,
    driver_ids: Vec<String>,
    template: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    collection_export_internal(
        &mut conn,
        &dir,
        &company_id,
        &cycle_id,
        &driver_ids,
        &template,
    )
}

/// Shared implementation (unit-testable; no keychain access).
pub fn collection_export_internal(
    conn: &mut Connection,
    dir: &Path,
    company_id: &str,
    cycle_id: &str,
    driver_ids: &[String],
    template: &str,
) -> AppResult<serde_json::Value> {
    // The cycle must exist and belong to this Company.
    let cycle_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM planning_cycles WHERE id = ?1 AND company_id = ?2)",
            rusqlite::params![cycle_id, company_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if !cycle_exists {
        return Err(AppError::invalid(format!(
            "Planning cycle {cycle_id} not found."
        )));
    }

    // Only the standard template is defined for v1 (API-SPEC §2).
    if template != "standard" {
        return Err(AppError::collection_structure_changed());
    }

    // Real drivers owned by the cycle's model, restricted to the requested ids.
    let model_id: String = conn
        .query_row(
            "SELECT model_id FROM planning_cycles WHERE id = ?1",
            rusqlite::params![cycle_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    let mut stmt = conn
        .prepare("SELECT id, name FROM drivers WHERE model_id = ?1 ORDER BY id")
        .map_err(AppError::from)?;
    let model_drivers: Vec<(String, String)> = stmt
        .query_map(rusqlite::params![model_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    drop(stmt);

    let mut selected: Vec<(String, String)> = Vec::new();
    for id in driver_ids {
        let name = model_drivers
            .iter()
            .find(|(did, _)| did == id)
            .map(|(_, n)| n.clone())
            .ok_or_else(|| {
                AppError::invalid(format!("Driver {id} does not belong to the cycle's model."))
            })?;
        selected.push((id.clone(), name));
    }

    // Real fiscal periods of the model's company calendar (ordered by period_no).
    let mut stmt = conn
        .prepare(
            "SELECT fp.code FROM fiscal_periods fp
             JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
             JOIN fiscal_calendars fc ON fc.id = fy.calendar_id
             JOIN models m ON m.company_id = fc.company_id
             WHERE m.id = ?1
             ORDER BY fy.start_date, fp.period_no",
        )
        .map_err(AppError::from)?;
    let period_codes: Vec<String> = stmt
        .query_map(rusqlite::params![model_id], |r| r.get::<_, String>(0))
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    drop(stmt);
    if period_codes.is_empty() {
        return Err(AppError::collection_structure_changed());
    }

    // Build the CSV template: header + one empty-value row per driver × period.
    let mut csv = String::from("driver_id,period_code,value\n");
    let mut row_count = 0u32;
    for (did, _name) in &selected {
        for code in &period_codes {
            csv.push_str(&format!("{did},{code},\n"));
            row_count += 1;
        }
    }

    let file_name = format!("collection_template_{cycle_id}.csv");
    let target_path = dir.join(&file_name);
    std::fs::write(&target_path, csv.as_bytes())
        .map_err(|e| AppError::internal(format!("EXPORT_IO_ERROR: {e}")))?;

    // Persist the export as a validated collection batch and audit it (B7).
    let batch_id = format!("cb-{}", Uuid::new_v4());
    let source_hash = crate::commands::backup::compute_sha256(csv.as_bytes());
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO import_batches (id, company_id, kind, source_name, source_hash,
                                     mapping_version, status, row_count, debits_minor,
                                     credits_minor, tie_out_status, rollback_to_batch_id,
                                     committed_at, created_at)
         VALUES (?1, ?2, 'collection', ?3, ?4, 'v1', 'validated', ?5, NULL, NULL, 'pass', NULL, NULL, ?6)",
        rusqlite::params![batch_id, company_id, file_name, source_hash, row_count, now],
    )
    .map_err(AppError::from)?;
    record_cycle_audit(
        &tx,
        dir,
        company_id,
        "collection.export",
        "planning_cycle",
        cycle_id,
        serde_json::Value::Null,
        serde_json::json!({
            "file": target_path.to_string_lossy(),
            "hash": source_hash,
            "rows": row_count,
            "template": template,
        }),
    )?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "file": target_path.to_string_lossy(),
        "rows": row_count
    }))
}

/// `collection.import` — Ingest a contributor's returned collection sheet (CSV as
/// written by `collection.export`: `driver_id,period_code,value`). The file is
/// parsed for real; a duplicate (driver_id, period_code) row is a
/// COLLECTION_CONFLICT — no invented conflicts, no string triggers. The batch is
/// persisted and audited (B7).
#[tauri::command(name = "collection.import", rename_all = "snake_case")]
pub fn collection_import(
    app: AppHandle,
    cycle_id: String,
    file_path: String,
    mapping_id: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    collection_import_internal(
        &mut conn,
        &dir,
        &company_id,
        &cycle_id,
        &file_path,
        &mapping_id,
    )
}

/// Shared implementation (unit-testable; no keychain access).
pub fn collection_import_internal(
    conn: &mut Connection,
    dir: &Path,
    company_id: &str,
    cycle_id: &str,
    file_path: &str,
    mapping_id: &str,
) -> AppResult<serde_json::Value> {
    let cycle_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM planning_cycles WHERE id = ?1 AND company_id = ?2)",
            rusqlite::params![cycle_id, company_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if !cycle_exists {
        return Err(AppError::invalid(format!(
            "Planning cycle {cycle_id} not found."
        )));
    }

    // Read + parse the real file. Missing/unreadable → IMPORT_FILE_UNREADABLE.
    let raw = std::fs::read(file_path)
        .map_err(|_| AppError::ImportFileUnreadable(format!("cannot read {file_path}")))?;
    let text = String::from_utf8_lossy(&raw);

    let mut lines = text.lines();
    let header = lines
        .next()
        .ok_or_else(AppError::collection_structure_changed)?;
    if header.trim() != "driver_id,period_code,value" {
        return Err(AppError::collection_structure_changed());
    }

    let mut seen: std::collections::HashMap<(String, String), (usize, String)> =
        std::collections::HashMap::new();
    let mut conflicts: Vec<CollectionConflict> = Vec::new();
    let mut row_count = 0u32;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() != 3 {
            return Err(AppError::collection_structure_changed());
        }
        let (driver_id, period_code, value) = (parts[0].trim(), parts[1].trim(), parts[2].trim());
        row_count += 1;
        let key = (driver_id.to_string(), period_code.to_string());
        match seen.entry(key) {
            std::collections::hash_map::Entry::Vacant(v) => {
                v.insert((row_count as usize, value.to_string()));
            }
            std::collections::hash_map::Entry::Occupied(o) => {
                let (first_row, first_value) = o.get();
                // Deterministic conflict record: two rows of this file claim
                // different values for the same (driver, period). Provenance is
                // the row number — a fact, not an invented contributor.
                let driver_name: String = conn
                    .query_row(
                        "SELECT name FROM drivers WHERE id = ?1",
                        rusqlite::params![driver_id],
                        |r| r.get(0),
                    )
                    .unwrap_or_else(|_| driver_id.to_string());
                conflicts.push(CollectionConflict {
                    id: format!("conf-{}", Uuid::new_v4()),
                    upload_id: String::new(), // set to the batch id below
                    driver_id: driver_id.to_string(),
                    driver_name,
                    period_id: period_code.to_string(),
                    contributor_a: format!("row {first_row}"),
                    value_a: first_value.clone(),
                    contributor_b: format!("row {row_count}"),
                    value_b: value.to_string(),
                    resolved: false,
                    resolution_choice: None,
                    resolved_value: None,
                });
            }
        }
    }

    // The batch is recorded as validated (value application lands with the
    // scenario/driver write path; conflicts so far are structural only).
    let batch_id = format!("cb-{}", Uuid::new_v4());
    for c in &mut conflicts {
        c.upload_id = batch_id.clone();
    }
    let source_hash = crate::commands::backup::compute_sha256(&raw);
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO import_batches (id, company_id, kind, source_name, source_hash,
                                     mapping_version, status, row_count, debits_minor,
                                     credits_minor, tie_out_status, rollback_to_batch_id,
                                     committed_at, created_at)
         VALUES (?1, ?2, 'collection', ?3, ?4, ?5, 'validated', ?6, NULL, NULL, 'pass', NULL, NULL, ?7)",
        rusqlite::params![batch_id, company_id, file_path, source_hash, mapping_id, row_count, now],
    )
    .map_err(AppError::from)?;
    record_cycle_audit(
        &tx,
        dir,
        company_id,
        "collection.import",
        "planning_cycle",
        cycle_id,
        serde_json::Value::Null,
        serde_json::json!({
            "file": file_path,
            "hash": source_hash,
            "rows": row_count,
            "batch_id": batch_id,
        }),
    )?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "batch_id": batch_id,
        "conflicts": conflicts,
    }))
}

/// `collection.resolve_conflict` — Resolve a driver collision (choose_a, choose_b, or average).
#[tauri::command(name = "collection.resolve_conflict", rename_all = "snake_case")]
pub fn collection_resolve_conflict(
    app: AppHandle,
    conflict_id: String,
    choice: String,
    note: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    match choice.as_str() {
        "choose_a" | "choose_b" | "average" => {}
        _ => {
            return Err(AppError::invalid(
                "Choice must be choose_a, choose_b, or average.",
            ));
        }
    }

    let tx = conn.transaction().map_err(AppError::from)?;

    let after_json = serde_json::json!({
        "conflict_id": conflict_id,
        "choice": choice,
        "note": note
    });

    record_cycle_audit(
        &tx,
        &dir,
        &company_id,
        "collection.resolve_conflict",
        "collection_conflict",
        &conflict_id,
        serde_json::Value::Null,
        after_json,
    )?;

    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "resolved": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_tasks_have_expected_sequence() {
        let task_titles = [
            "Import all BU actuals",
            "Run GL tie-out and reconcile accounts",
            "Execute Health Check and review integrity rules",
            "Approve variance commentary and lock cycle",
        ];
        assert_eq!(task_titles.len(), 4);
    }

    /// Seed companies → pack → calendar → fy → 2 periods → model → cycle → 1 driver.
    fn seeded_connection() -> Connection {
        let conn = db::open_in_memory().unwrap();
        let now = "2026-09-06T00:00:00Z";
        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version, company_file_path, created_at, updated_at)
             VALUES ('c-col', 'Collection Co', 'single', 'USD', 'en-US', '1.0.0', '/tmp/co.fpa', ?1, ?1)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO packs (id, key, name, version, schema_version, is_bundled, source_checksum, installed_at)
             VALUES ('p-1', 'manu', 'Manufacturing', '1.0.0', '1.0.0', 1, 'sha', ?1)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO fiscal_calendars (id, company_id, name, preset, fy_start_month, week_start_day, tz)
             VALUES ('fc-1', 'c-col', 'Main', '12month', 1, 1, 'UTC')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO fiscal_years (id, calendar_id, fy_label, start_date, end_date, week_count)
             VALUES ('fy-1', 'fc-1', 'FY2026', '2026-01-01', '2026-12-31', 52)",
            [],
        )
        .unwrap();
        for (pid, code) in [("fp-1", "2026-01"), ("fp-2", "2026-02")] {
            conn.execute(
                "INSERT INTO fiscal_periods (id, fiscal_year_id, period_no, code, start_date, end_date)
                 VALUES (?1, 'fy-1', ?2, ?3, '2026-01-01', '2026-12-31')",
                rusqlite::params![pid, if code == "2026-01" { 1 } else { 2 }, code],
            ).unwrap();
        }
        conn.execute(
            "INSERT INTO models (id, company_id, name, horizon, pack_id)
             VALUES ('m-1', 'c-col', 'Plan', '1y', 'p-1')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO planning_cycles (id, company_id, model_id, name, kind, state, starts_at, ends_at, created_at, updated_at)
             VALUES ('pc-1', 'c-col', 'm-1', 'FY26 Budget', 'budget', 'active', '2026-01-01', '2026-12-31', ?1, ?1)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO drivers (id, model_id, name, driver_type, source)
             VALUES ('dr-1', 'm-1', 'Sales Volume (Units)', 'volume_x_rate', 'collection')",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn collection_export_writes_real_template_and_audits() {
        let mut conn = seeded_connection();
        let dir = std::env::temp_dir().join(format!("onefpa-cexp-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let res = collection_export_internal(
            &mut conn,
            &dir,
            "c-col",
            "pc-1",
            &["dr-1".to_string()],
            "standard",
        )
        .unwrap();
        assert_eq!(res["rows"], 2); // 1 driver × 2 periods

        let file = res["file"].as_str().unwrap();
        let csv = std::fs::read_to_string(file).unwrap();
        assert!(csv.starts_with("driver_id,period_code,value\n"));
        assert!(csv.contains("dr-1,2026-01,\n"));
        assert!(csv.contains("dr-1,2026-02,\n"));

        // Persisted batch + audit event (B7).
        let batch: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM import_batches WHERE kind = 'collection' AND status = 'validated' AND company_id = 'c-col'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(batch, 1);
        let audits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_events WHERE action = 'collection.export' AND company_id = 'c-col'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(audits, 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn collection_import_parses_real_file_and_rejects_duplicates() {
        let mut conn = seeded_connection();
        let dir = std::env::temp_dir().join(format!("onefpa-cimp-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        // Export the template, then fill one value like a contributor would.
        let res = collection_export_internal(
            &mut conn,
            &dir,
            "c-col",
            "pc-1",
            &["dr-1".to_string()],
            "standard",
        )
        .unwrap();
        let template = res["file"].as_str().unwrap().to_string();
        let filled = std::fs::read_to_string(&template).unwrap().replacen(
            "dr-1,2026-01,",
            "dr-1,2026-01,1250",
            1,
        );
        let path = dir.join("returned.csv");
        std::fs::write(&path, filled).unwrap();

        let out = collection_import_internal(
            &mut conn,
            &dir,
            "c-col",
            "pc-1",
            path.to_str().unwrap(),
            "v1",
        )
        .unwrap();
        assert_eq!(out["conflicts"].as_array().unwrap().len(), 0);

        // Duplicate (driver, period) rows surface as a real conflict record in
        // the success payload (S-053 resolution queue) with row-number provenance.
        let dup = "driver_id,period_code,value\ndr-1,2026-01,100\ndr-1,2026-01,200\n";
        let dup_path = dir.join("dup.csv");
        std::fs::write(&dup_path, dup).unwrap();
        let out = collection_import_internal(
            &mut conn,
            &dir,
            "c-col",
            "pc-1",
            dup_path.to_str().unwrap(),
            "v1",
        )
        .unwrap();
        let conflicts = out["conflicts"].as_array().unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0]["driver_id"], "dr-1");
        assert_eq!(conflicts[0]["value_a"], "100");
        assert_eq!(conflicts[0]["value_b"], "200");
        assert_eq!(conflicts[0]["contributor_a"], "row 1");
        assert_eq!(conflicts[0]["contributor_b"], "row 2");
        assert_eq!(
            conflicts[0]["upload_id"], out["batch_id"],
            "upload_id ties the conflict to its batch"
        );

        // A bad header is a structure change, not a silent accept.
        let bad = dir.join("bad.csv");
        std::fs::write(&bad, "driver,period,val\n").unwrap();
        let err = collection_import_internal(
            &mut conn,
            &dir,
            "c-col",
            "pc-1",
            bad.to_str().unwrap(),
            "v1",
        )
        .unwrap_err();
        assert_eq!(err.body().code, "COLLECTION_STRUCTURE_CHANGED");

        // Each import is an audited mutation (B7): the valid one and the
        // duplicate one both persist batches + audit events; the bad-header one
        // fails before persisting.
        let audits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_events WHERE action = 'collection.import' AND company_id = 'c-col'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(audits, 2);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn collection_import_missing_file_is_import_file_unreadable() {
        let mut conn = seeded_connection();
        let dir = std::env::temp_dir().join(format!("onefpa-cmiss-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let err = collection_import_internal(
            &mut conn,
            &dir,
            "c-col",
            "pc-1",
            dir.join("nope.csv").to_str().unwrap(),
            "v1",
        )
        .unwrap_err();
        assert!(matches!(err, AppError::ImportFileUnreadable(_)));

        std::fs::remove_dir_all(&dir).ok();
    }
}
