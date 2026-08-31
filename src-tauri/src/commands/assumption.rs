//! Assumption Register commands (F-014 · M3-4 · S-044).
//!
//! The Rust core owns the persisted register. Values are kept as the exact decimal strings received
//! from the UI; `rust_decimal` is used only to compare bounds, never to rewrite a value. Every
//! mutation replaces the definition/value set and appends one HMAC-chained audit event in the same
//! SQLite transaction. Usage lookup is read-only and is scoped to the active Company + Model.

use rusqlite::{Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::str::FromStr;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{require_session_write, require_unlocked, SessionState};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::{db, keystore};

/// `assumption.upsert` payload. `values` defaults to an empty map for compatibility with the
/// Zod contract, but the Rust command always returns it explicitly.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct AssumptionInput {
    pub id: Option<String>,
    pub name: String,
    pub unit: Option<String>,
    pub owner: String,
    pub source: Option<String>,
    pub bounds_low: Option<String>,
    pub bounds_high: Option<String>,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    #[serde(default)]
    pub values: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
struct AssumptionRow {
    id: String,
    name: String,
    unit: Option<String>,
    owner: String,
    source: Option<String>,
    bounds_low: Option<String>,
    bounds_high: Option<String>,
    effective_from: Option<String>,
    effective_to: Option<String>,
    values: BTreeMap<String, String>,
}

impl AssumptionRow {
    fn from_input(id: String, input: &AssumptionInput) -> Self {
        Self {
            id,
            name: input.name.trim().to_string(),
            unit: input.unit.as_ref().map(|value| value.trim().to_string()),
            owner: input.owner.trim().to_string(),
            source: input.source.as_ref().map(|value| value.trim().to_string()),
            bounds_low: input.bounds_low.clone(),
            bounds_high: input.bounds_high.clone(),
            effective_from: input.effective_from.clone(),
            effective_to: input.effective_to.clone(),
            values: input.values.clone(),
        }
    }

    fn into_json(self) -> Result<serde_json::Value, AppError> {
        serde_json::to_value(self).map_err(|error| AppError::internal(format!("assumption JSON: {error}")))
    }
}

#[derive(Debug, Clone, Serialize)]
struct AssumptionListRow {
    #[serde(flatten)]
    assumption: AssumptionRow,
    version: i64,
    last_changed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct AssumptionUsage {
    line_id: String,
    period_id: String,
    formula: String,
}

fn valid_slug(id: &str) -> bool {
    let Some(suffix) = id.strip_prefix("as-") else { return false };
    !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else { return false };
    (first == '_' || first.is_ascii_lowercase())
        && chars.all(|character| character == '_' || character.is_ascii_lowercase() || character.is_ascii_digit())
}

/// Match the DecimalString Zod contract without accepting exponent/plus notation. The original
/// string is retained after validation, so `4.0` and `4.00` remain distinct user inputs.
fn parse_exact_decimal(label: &str, value: &str) -> AppResult<rust_decimal::Decimal> {
    let body = value.strip_prefix('-').unwrap_or(value);
    let mut pieces = body.split('.');
    let whole = pieces.next().unwrap_or_default();
    let fraction = pieces.next();
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || pieces.next().is_some()
        || fraction.is_some_and(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(AppError::invalid(format!("VALUE_INVALID: {label} must be an exact decimal string")));
    }
    rust_decimal::Decimal::from_str(value)
        .map_err(|_| AppError::invalid(format!("VALUE_INVALID: {label} must be an exact decimal string")))
}

fn validate_period_shape(label: &str, period_id: &str) -> AppResult<()> {
    if period_id.starts_with("fp-") && period_id.len() > 3 && !period_id.bytes().any(|byte| byte.is_ascii_whitespace()) {
        Ok(())
    } else {
        Err(AppError::invalid(format!("VALUE_INVALID: {label} must be a fiscal period id")))
    }
}

fn validate_input(input: &AssumptionInput) -> AppResult<()> {
    if let Some(id) = input.id.as_deref() {
        if !valid_slug(id) {
            return Err(AppError::invalid("VALUE_INVALID: assumption id must be an as- slug"));
        }
    }
    let name = input.name.trim();
    if !valid_name(name) || name.len() > 120 {
        return Err(AppError::invalid("VALUE_INVALID: assumption name must be lowercase snake_case"));
    }
    if input.owner.trim().is_empty() || input.owner.trim().len() > 120 {
        return Err(AppError::invalid("VALUE_INVALID: assumption owner is required"));
    }
    if input.unit.as_deref().is_some_and(|value| value.trim().len() > 40) {
        return Err(AppError::invalid("VALUE_INVALID: assumption unit is too long"));
    }
    if input.source.as_deref().is_some_and(|value| value.trim().len() > 120) {
        return Err(AppError::invalid("VALUE_INVALID: assumption source is too long"));
    }

    let low = input
        .bounds_low
        .as_deref()
        .map(|value| parse_exact_decimal("bounds_low", value))
        .transpose()?;
    let high = input
        .bounds_high
        .as_deref()
        .map(|value| parse_exact_decimal("bounds_high", value))
        .transpose()?;
    if let (Some(low), Some(high)) = (low, high) {
        if low > high {
            return Err(AppError::invalid("VALUE_INVALID: bounds_low cannot exceed bounds_high"));
        }
    }
    if let Some(period_id) = input.effective_from.as_deref() {
        validate_period_shape("effective_from", period_id)?;
    }
    if let Some(period_id) = input.effective_to.as_deref() {
        validate_period_shape("effective_to", period_id)?;
    }
    for (period_id, value) in &input.values {
        validate_period_shape("value period", period_id)?;
        let decimal = parse_exact_decimal("value", value)?;
        if let Some(low) = input.bounds_low.as_deref() {
            if decimal < parse_exact_decimal("bounds_low", low)? {
                return Err(AppError::invalid(format!("VALUE_INVALID: value for {period_id} is below bounds_low")));
            }
        }
        if let Some(high) = input.bounds_high.as_deref() {
            if decimal > parse_exact_decimal("bounds_high", high)? {
                return Err(AppError::invalid(format!("VALUE_INVALID: value for {period_id} exceeds bounds_high")));
            }
        }
    }
    Ok(())
}

fn period_exists(conn: &Connection, company_id: &str, period_id: &str) -> Result<bool, rusqlite::Error> {
    conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM fiscal_periods fp
           JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
           JOIN fiscal_calendars fc ON fc.id = fy.calendar_id
           WHERE fp.id = ?1 AND fc.company_id = ?2
         )",
        rusqlite::params![period_id, company_id],
        |row| row.get(0),
    )
}

fn validate_periods(conn: &Connection, company_id: &str, input: &AssumptionInput) -> AppResult<()> {
    for period_id in input
        .effective_from
        .iter()
        .chain(input.effective_to.iter())
        .chain(input.values.keys())
    {
        if !period_exists(conn, company_id, period_id).map_err(AppError::from)? {
            return Err(AppError::period_not_found(period_id));
        }
    }
    Ok(())
}

fn values_for(conn: &Connection, assumption_id: &str) -> Result<BTreeMap<String, String>, rusqlite::Error> {
    let mut statement = conn.prepare(
        "SELECT period_id, value_decimal FROM assumption_values WHERE assumption_id = ?1 ORDER BY period_id",
    )?;
    let rows = statement.query_map([assumption_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}

fn row_for(conn: &Connection, model_id: &str, assumption_id: &str) -> Result<Option<AssumptionRow>, rusqlite::Error> {
    let base: Option<(String, String, Option<String>, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT id, name, unit, owner, source, bounds_low, bounds_high, effective_from, effective_to
             FROM assumptions WHERE id = ?1 AND model_id = ?2",
            rusqlite::params![assumption_id, model_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            },
        )
        .optional()?;
    base.map(|(id, name, unit, owner, source, bounds_low, bounds_high, effective_from, effective_to)| {
        Ok(AssumptionRow {
            id,
            name,
            unit,
            owner,
            source,
            bounds_low,
            bounds_high,
            effective_from,
            effective_to,
            values: values_for(conn, assumption_id)?,
        })
    })
    .transpose()
}

fn model_belongs_to_company(conn: &Connection, model_id: &str, company_id: &str) -> Result<bool, rusqlite::Error> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM models WHERE id = ?1 AND company_id = ?2)",
        rusqlite::params![model_id, company_id],
        |row| row.get(0),
    )
}

fn assumption_model(conn: &Connection, assumption_id: &str) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row("SELECT model_id FROM assumptions WHERE id = ?1", [assumption_id], |row| row.get(0))
        .optional()
}

/// Formula names are identifiers, so a substring such as `wage_inflation_adjusted` is not a use
/// of `wage_inflation`. The optional `@` used by the register UI is naturally handled by the
/// identifier-boundary check.
fn formula_references_name(formula: &str, name: &str) -> bool {
    let formula = formula.to_ascii_lowercase();
    let name = name.to_ascii_lowercase();
    let formula_bytes = formula.as_bytes();
    let name_bytes = name.as_bytes();
    if name_bytes.is_empty() {
        return false;
    }
    let mut offset = 0;
    while let Some(relative) = formula[offset..].find(name.as_str()) {
        let start = offset + relative;
        let end = start + name_bytes.len();
        let is_identifier = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
        let left_ok = start == 0 || !is_identifier(formula_bytes[start - 1]);
        let right_ok = end == formula_bytes.len() || !is_identifier(formula_bytes[end]);
        if left_ok && right_ok {
            return true;
        }
        offset = end;
        if offset >= formula_bytes.len() {
            break;
        }
    }
    false
}

fn locked_baseline_uses(conn: &Connection, model_id: &str, name: &str) -> Result<bool, rusqlite::Error> {
    let mut statement = conn.prepare(
        "SELECT mv.formula
         FROM model_values mv
         JOIN scenarios s ON s.id = mv.scenario_id
         WHERE s.model_id = ?1 AND s.state = 'locked' AND s.baseline = 1 AND mv.formula IS NOT NULL",
    )?;
    let formulas = statement.query_map([model_id], |row| row.get::<_, String>(0))?;
    for formula in formulas {
        if formula_references_name(&formula?, name) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn replace_values(tx: &Transaction<'_>, assumption_id: &str, values: &BTreeMap<String, String>) -> AppResult<()> {
    tx.execute("DELETE FROM assumption_values WHERE assumption_id = ?1", [assumption_id])
        .map_err(AppError::from)?;
    for (period_id, value) in values {
        tx.execute(
            "INSERT INTO assumption_values (id, assumption_id, period_id, value_decimal)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![Uuid::new_v4().to_string(), assumption_id, period_id, value],
        )
        .map_err(AppError::from)?;
    }
    Ok(())
}

/// `assumption.upsert` — create/update a register definition and replace its period values.
#[tauri::command(name = "assumption.upsert", rename_all = "snake_case")]
pub fn assumption_upsert(
    app: AppHandle,
    model_id: String,
    assumption: AssumptionInput,
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&state)?;
    validate_input(&assumption)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir).map_err(AppError::from)?;
    let tx = conn.transaction().map_err(AppError::from)?;

    if !model_belongs_to_company(&tx, &model_id, &company_id).map_err(AppError::from)? {
        return Err(AppError::Scope("model is not owned by the active Company".into()));
    }
    validate_periods(&tx, &company_id, &assumption)?;

    let (assumption_id, existing) = if let Some(id) = assumption.id.as_deref() {
        let owner_model = assumption_model(&tx, id).map_err(AppError::from)?;
        if let Some(owner_model) = owner_model {
            if owner_model != model_id {
                return Err(AppError::Scope("assumption is not owned by the requested Model".into()));
            }
        }
        let existing = row_for(&tx, &model_id, id).map_err(AppError::from)?;
        if existing.is_none() {
            return Err(AppError::invalid("VALUE_INVALID: assumption id does not exist"));
        }
        let duplicate: Option<String> = tx
            .query_row(
                "SELECT id FROM assumptions WHERE model_id = ?1 AND name = ?2 AND id <> ?3",
                rusqlite::params![model_id, assumption.name.trim(), id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::from)?;
        if duplicate.is_some() {
            return Err(AppError::invalid("VALUE_INVALID: assumption name already exists in this Model"));
        }
        (id.to_string(), existing)
    } else {
        let duplicate: Option<String> = tx
            .query_row(
                "SELECT id FROM assumptions WHERE model_id = ?1 AND name = ?2",
                rusqlite::params![model_id, assumption.name.trim()],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::from)?;
        if duplicate.is_some() {
            return Err(AppError::invalid("VALUE_INVALID: assumption name already exists in this Model"));
        }
        (format!("as-{}", Uuid::new_v4()), None)
    };

    if let Some(existing_row) = existing.as_ref() {
        if locked_baseline_uses(&tx, &model_id, &existing_row.name).map_err(AppError::from)? {
            return Err(AppError::assumption_in_use_locked(&assumption_id));
        }
    }

    let created = existing.is_none();
    let next = AssumptionRow::from_input(assumption_id.clone(), &assumption);
    let before_json = existing.map(AssumptionRow::into_json).transpose()?.unwrap_or(serde_json::Value::Null);
    let after_json = next.clone().into_json()?;

    tx.execute(
        "INSERT INTO assumptions
           (id, model_id, name, unit, owner, source, bounds_low, bounds_high, effective_from, effective_to)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           unit = excluded.unit,
           owner = excluded.owner,
           source = excluded.source,
           bounds_low = excluded.bounds_low,
           bounds_high = excluded.bounds_high,
           effective_from = excluded.effective_from,
           effective_to = excluded.effective_to",
        rusqlite::params![
            next.id,
            model_id,
            next.name,
            next.unit,
            next.owner,
            next.source,
            next.bounds_low,
            next.bounds_high,
            next.effective_from,
            next.effective_to,
        ],
    )
    .map_err(AppError::from)?;
    replace_values(&tx, &assumption_id, &next.values)?;

    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.to_string().as_bytes());
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO audit_events
           (company_id, actor, action, object_type, object_id, before_json, after_json,
            prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'assumption.upsert', 'assumption', ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![company_id, assumption_id, before_json, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": { "assumption_id": assumption_id, "created": created }
    }))
}

/// `assumption.list` — the read side required by S-044. This command closes the original catalog
/// gap: the UI must never infer that an empty session cache means a persisted Company is empty.
#[tauri::command(name = "assumption.list", rename_all = "snake_case")]
pub fn assumption_list(
    app: AppHandle,
    model_id: String,
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&state)?;
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;
    if !model_belongs_to_company(&conn, &model_id, &company_id).map_err(AppError::from)? {
        return Err(AppError::Scope("model is not owned by the active Company".into()));
    }

    let mut statement = conn.prepare(
        "SELECT a.id, a.name, a.unit, a.owner, a.source, a.bounds_low, a.bounds_high,
                a.effective_from, a.effective_to,
                (SELECT COUNT(*) FROM audit_events ae
                 WHERE ae.company_id = ?2 AND ae.object_type = 'assumption' AND ae.object_id = a.id) AS version,
                (SELECT MAX(ae.created_at) FROM audit_events ae
                 WHERE ae.company_id = ?2 AND ae.object_type = 'assumption' AND ae.object_id = a.id) AS last_changed_at
         FROM assumptions a WHERE a.model_id = ?1 ORDER BY a.name",
    )
    .map_err(AppError::from)?;
    let base_rows = statement
        .query_map(rusqlite::params![&model_id, &company_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })
        .map_err(AppError::from)?;
    let base_rows: Vec<_> = base_rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)?;
    drop(statement);

    let mut rows = Vec::with_capacity(base_rows.len());
    for (id, name, unit, owner, source, bounds_low, bounds_high, effective_from, effective_to, version, last_changed_at) in base_rows {
        rows.push(AssumptionListRow {
            assumption: AssumptionRow {
                values: values_for(&conn, &id).map_err(AppError::from)?,
                id,
                name,
                unit,
                owner,
                source,
                bounds_low,
                bounds_high,
                effective_from,
                effective_to,
            },
            version,
            last_changed_at,
        });
    }
    Ok(serde_json::json!({ "data": rows }))
}

/// `assumption.find_usages` — locate formula cells that reference the named assumption.
#[tauri::command(name = "assumption.find_usages", rename_all = "snake_case")]
pub fn assumption_find_usages(
    app: AppHandle,
    assumption_id: String,
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_unlocked(&state)?;
    if !valid_slug(&assumption_id) {
        return Err(AppError::invalid("VALUE_INVALID: assumption id must be an as- slug"));
    }
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir).map_err(AppError::from)?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT a.model_id, a.name
             FROM assumptions a JOIN models m ON m.id = a.model_id
             WHERE a.id = ?1 AND m.company_id = ?2",
            rusqlite::params![assumption_id, company_id],
            |result| Ok((result.get(0)?, result.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?;
    let Some((model_id, name)) = row else {
        return Err(AppError::invalid("VALUE_INVALID: assumption was not found"));
    };

    let mut statement = conn
        .prepare(
            "SELECT mv.line_id, mv.period_id, mv.formula
             FROM model_values mv
             JOIN scenarios s ON s.id = mv.scenario_id
             WHERE s.model_id = ?1 AND mv.formula IS NOT NULL
             ORDER BY mv.line_id, mv.period_id",
        )
        .map_err(AppError::from)?;
    let rows = statement
        .query_map([model_id], |result| {
            Ok((
                result.get::<_, String>(0)?,
                result.get::<_, String>(1)?,
                result.get::<_, String>(2)?,
            ))
        })
        .map_err(AppError::from)?;
    let mut cells = Vec::new();
    for row in rows {
        let (line_id, period_id, formula) = row.map_err(AppError::from)?;
        if formula_references_name(&formula, &name) {
            cells.push(AssumptionUsage { line_id, period_id, formula });
        }
    }
    Ok(serde_json::json!({ "data": { "cells": cells } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_decimal_validation_preserves_scale_without_accepting_exponents() {
        assert_eq!(parse_exact_decimal("value", "4.0").unwrap().to_string(), "4.0");
        assert!(parse_exact_decimal("value", "4e0").is_err());
        assert!(parse_exact_decimal("value", "+4").is_err());
        assert!(parse_exact_decimal("value", "4.").is_err());
    }

    #[test]
    fn formula_usage_requires_identifier_boundaries() {
        assert!(formula_references_name("=base+@wage_inflation", "wage_inflation"));
        assert!(formula_references_name("=WAGE_INFLATION*2", "wage_inflation"));
        assert!(!formula_references_name("=wage_inflation_adjusted*2", "wage_inflation"));
        assert!(!formula_references_name("=wage_inflation2*2", "wage_inflation"));
    }

    #[test]
    fn locked_baseline_error_matches_the_documented_contract() {
        let body = AppError::assumption_in_use_locked("as-wage_inflation").body();
        assert_eq!(body.code, "ASSUMPTION_IN_USE_LOCKED");
        assert_eq!(body.http_status, 422);
        assert!(!body.retryable);
        assert_eq!(
            body.user_message,
            "Assumption is used by a Locked Baseline. Create a new Version to change."
        );
        assert_eq!(body.details["assumptionId"], "as-wage_inflation");
    }

    #[test]
    fn input_validation_rejects_out_of_bounds_exactly() {
        let mut input = AssumptionInput {
            id: None,
            name: "wage_inflation".into(),
            unit: Some("%".into()),
            owner: "HR".into(),
            source: Some("plan".into()),
            bounds_low: Some("0".into()),
            bounds_high: Some("10".into()),
            effective_from: None,
            effective_to: None,
            values: BTreeMap::from([("fp-2026-p01".into(), "10.01".into())]),
        };
        assert!(validate_input(&input).is_err());
        input.values.insert("fp-2026-p01".into(), "10.0".into());
        assert!(validate_input(&input).is_ok());
    }
}
