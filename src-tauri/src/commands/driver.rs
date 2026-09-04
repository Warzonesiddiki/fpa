//! driver.upsert / driver.set_value (F-013 · M3-3 · S-043 · API-SPEC §2).
//!
//! M3-3 scope is deliberately thin in the same way M3-1's `model.cell.set.v1` is (HANDOVER §2):
//! this file validates the driver definition/value against the documented contract and appends an
//! HMAC-chained audit event for the session Company. The HyperFormula worker owns the driver sheet
//! (M3-1) and the S-043 store holds the working set; `driver_values` persistence lands once the
//! scenario/period selection produces real UUIDs instead of the API-SPEC example ids.
//!
//! Zero-compromise invariants kept:
//!  * Exact decimals stay strings; bounds are compared with `rust_decimal`, never rewritten as float.
//!  * Every mutation is audited with an HMAC-chained event in a single transaction.
//!  * No invented codes: all errors come from the locked ERROR-HANDLING taxonomy (B20).

use rusqlite::OptionalExtension;
use serde::Deserialize;
use std::str::FromStr;
use tauri::{AppHandle, State};

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{SessionState, require_session_write};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::{db, keystore};

const DRIVER_TYPES: [&str; 7] = [
    "volume_x_rate",
    "headcount",
    "growth",
    "seasonal",
    "spread",
    "ratio",
    "manual",
];
const DRIVER_SOURCES: [&str; 4] = ["global", "bu_override", "collection", "imported"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct DriverInput {
    id: Option<String>,
    name: String,
    driver_type: String,
    unit: Option<String>,
    source: String,
    #[serde(default)]
    is_core: bool,
    bounds_low: Option<String>,
    bounds_high: Option<String>,
}

fn valid_driver_id(id: &str) -> bool {
    let Some(suffix) = id.strip_prefix("dr-") else {
        return false;
    };
    !suffix.is_empty()
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_lowercase())
        && chars.all(|c| c == '_' || c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn parse_exact_decimal(label: &str, value: &str) -> AppResult<rust_decimal::Decimal> {
    let body = value.strip_prefix('-').unwrap_or(value);
    let mut pieces = body.split('.');
    let whole = pieces.next().unwrap_or_default();
    let fraction = pieces.next();
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || pieces.next().is_some()
        || fraction
            .is_some_and(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(AppError::invalid(format!(
            "VALUE_INVALID: {label} must be an exact decimal string"
        )));
    }
    rust_decimal::Decimal::from_str(value).map_err(|_| {
        AppError::invalid(format!(
            "VALUE_INVALID: {label} must be an exact decimal string"
        ))
    })
}

fn validate_input(input: &DriverInput) -> AppResult<()> {
    if let Some(id) = input.id.as_deref()
        && !valid_driver_id(id)
    {
        return Err(AppError::invalid("VALUE_INVALID: driver id must be a slug"));
    }
    if !valid_name(&input.name) {
        return Err(AppError::invalid(
            "VALUE_INVALID: driver name must be lowercase snake_case",
        ));
    }
    if !DRIVER_TYPES.contains(&input.driver_type.as_str()) {
        return Err(AppError::invalid("VALUE_INVALID: unknown driver_type"));
    }
    if !DRIVER_SOURCES.contains(&input.source.as_str()) {
        return Err(AppError::invalid("VALUE_INVALID: unknown source"));
    }
    let low = input
        .bounds_low
        .as_deref()
        .map(|v| parse_exact_decimal("bounds_low", v))
        .transpose()?;
    let high = input
        .bounds_high
        .as_deref()
        .map(|v| parse_exact_decimal("bounds_high", v))
        .transpose()?;
    if let (Some(l), Some(h)) = (low, high)
        && l > h
    {
        return Err(AppError::invalid(
            "VALUE_INVALID: bounds_low exceeds bounds_high",
        ));
    }
    Ok(())
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

fn period_exists(
    conn: &rusqlite::Connection,
    company_id: &str,
    period_id: &str,
) -> AppResult<bool> {
    let exists = conn
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM fiscal_periods fp
               JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
               JOIN fiscal_calendars fc ON fc.id = fy.calendar_id
               WHERE fp.id = ?1 AND fc.company_id = ?2
             )",
            rusqlite::params![period_id, company_id],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    Ok(exists)
}

/// `driver.upsert` — {model_id, driver{...}} → {driver_id, created} (API-SPEC §2).
#[tauri::command(name = "driver.upsert", rename_all = "snake_case")]
pub fn driver_upsert(
    app: AppHandle,
    model_id: String,
    driver: DriverInput,
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&state)?;
    validate_input(&driver)?;

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    if !model_belongs_to_company(&conn, &model_id, &company_id)? {
        return Err(AppError::Scope(
            "model is not owned by the active Company".into(),
        ));
    }

    let tx = conn.transaction().map_err(AppError::from)?;
    let (driver_id, created) = if let Some(id) = driver.id.as_deref() {
        let owner_model: Option<String> = tx
            .query_row("SELECT model_id FROM drivers WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(AppError::from)?;
        match owner_model {
            Some(owner) if owner == model_id => (id.to_string(), false),
            Some(_) => {
                return Err(AppError::Scope(
                    "driver is not owned by the requested Model".into(),
                ));
            }
            None => (id.to_string(), true),
        }
    } else {
        (format!("dr-{}", uuid::Uuid::new_v4()), true)
    };

    // A duplicate name inside the same Model is bad input, never a silent second driver.
    let duplicate = {
        let name = driver.name.trim();
        if created {
            tx.query_row(
                "SELECT 1 FROM drivers WHERE model_id = ?1 AND name = ?2",
                rusqlite::params![model_id, name],
                |_| Ok(()),
            )
            .optional()
            .map_err(AppError::from)?
            .is_some()
        } else {
            tx.query_row(
                "SELECT 1 FROM drivers WHERE model_id = ?1 AND name = ?2 AND id <> ?3",
                rusqlite::params![model_id, driver.name.trim(), driver_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(AppError::from)?
            .is_some()
        }
    };
    if duplicate {
        return Err(AppError::invalid(
            "VALUE_INVALID: driver name already exists in this Model",
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let after_json = serde_json::json!({
        "id": driver_id,
        "model_id": model_id,
        "name": driver.name.trim(),
        "driver_type": driver.driver_type,
        "unit": driver.unit,
        "source": driver.source,
        "is_core": driver.is_core,
        "bounds_low": driver.bounds_low,
        "bounds_high": driver.bounds_high,
    })
    .to_string();

    tx.execute(
        "INSERT INTO drivers
           (id, model_id, name, driver_type, unit, source, is_core, bounds_low, bounds_high)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           driver_type = excluded.driver_type,
           unit = excluded.unit,
           source = excluded.source,
           is_core = excluded.is_core,
           bounds_low = excluded.bounds_low,
           bounds_high = excluded.bounds_high",
        rusqlite::params![
            driver_id,
            model_id,
            driver.name.trim(),
            driver.driver_type,
            driver.unit,
            driver.source,
            driver.is_core as i64,
            driver.bounds_low,
            driver.bounds_high,
        ],
    )
    .map_err(AppError::from)?;

    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events
           (company_id, actor, action, object_type, object_id, before_json, after_json,
            prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'driver.upsert', 'driver', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, driver_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": { "driver_id": driver_id, "created": created } }))
}

/// `driver.set_value` — {driver_id, scenario_id, period_id, value_decimal} → {ok, recalc, value_decimal}
/// (API-SPEC §2). M3-3 validates the driver/period and appends the audited event; the engine sheet
/// remains the owner of the derived graph until `driver_values` persistence lands with real ids.
#[tauri::command(name = "driver.set_value", rename_all = "snake_case")]
pub fn driver_set_value(
    app: AppHandle,
    driver_id: String,
    scenario_id: String,
    period_id: String,
    value_decimal: String,
    state: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&state)?;
    if !valid_driver_id(&driver_id) {
        return Err(AppError::invalid("VALUE_INVALID: driver id must be a slug"));
    }
    parse_exact_decimal("value_decimal", &value_decimal)?;

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    let driver_row: Option<(String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT model_id, bounds_low, bounds_high FROM drivers WHERE id = ?1",
            [&driver_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(AppError::from)?;
    let (model_id, bounds_low, bounds_high) =
        driver_row.ok_or_else(|| AppError::invalid("VALUE_INVALID: driver id does not exist"))?;

    // The scenario must belong to the same Model as the driver (API-SPEC §2 scoping).
    let scenario_model: Option<String> = conn
        .query_row(
            "SELECT model_id FROM scenarios WHERE id = ?1",
            [&scenario_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    if let Some(owner) = scenario_model
        && owner != model_id
    {
        return Err(AppError::Scope(
            "scenario is not owned by the driver's Model".into(),
        ));
    }
    if !period_exists(&conn, &company_id, &period_id)? {
        return Err(AppError::period_not_found(period_id.as_str()));
    }

    let value = parse_exact_decimal("value_decimal", &value_decimal)?;
    let low = bounds_low
        .as_deref()
        .map(|v| parse_exact_decimal("bounds_low", v))
        .transpose()?;
    let high = bounds_high
        .as_deref()
        .map(|v| parse_exact_decimal("bounds_high", v))
        .transpose()?;
    if let Some(l) = low
        && value < l
    {
        return Err(AppError::driver_out_of_bounds(
            &value_decimal,
            bounds_low.as_deref().unwrap_or(""),
            bounds_high.as_deref().unwrap_or(""),
        ));
    }
    if let Some(h) = high
        && value > h
    {
        return Err(AppError::driver_out_of_bounds(
            &value_decimal,
            bounds_low.as_deref().unwrap_or(""),
            bounds_high.as_deref().unwrap_or(""),
        ));
    }

    let tx = conn.transaction().map_err(AppError::from)?;
    let after_json = serde_json::json!({
        "action": "driver.set_value",
        "driver_id": driver_id,
        "scenario_id": scenario_id,
        "period_id": period_id,
        "value_decimal": value_decimal,
    })
    .to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO audit_events
           (company_id, actor, action, object_type, object_id, before_json, after_json,
            prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'driver.set_value', 'driver_value', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, driver_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "ok": true,
            "value_decimal": value_decimal,
            "recalc": {
                "dirty_cells": 0,
                "cycles": [],
                "changed_cells": [],
                "issues": [],
                "duration_ms": 0,
            },
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn driver_name_and_id_validation() {
        assert!(valid_name("units_sold"));
        assert!(valid_name("_units"));
        assert!(!valid_name("Units Sold"));
        assert!(valid_driver_id("dr-units_sold"));
        assert!(!valid_driver_id("units"));
    }

    #[test]
    fn exact_decimal_validation_accepts_decimal_strings() {
        assert!(parse_exact_decimal("value", "12000.00").is_ok());
        assert!(parse_exact_decimal("value", "-0.5").is_ok());
        assert!(parse_exact_decimal("value", "1e2").is_err());
        assert!(parse_exact_decimal("value", "12.50.20").is_err());
    }

    #[test]
    fn driver_input_rejects_unknown_enums_and_bad_bounds() {
        let ok = DriverInput {
            id: None,
            name: "units".into(),
            driver_type: "manual".into(),
            unit: None,
            source: "global".into(),
            is_core: false,
            bounds_low: None,
            bounds_high: None,
        };
        assert!(validate_input(&ok).is_ok());

        let bad_type = DriverInput {
            driver_type: "magic".into(),
            ..ok.clone()
        };
        assert!(validate_input(&bad_type).is_err());

        let bad_bounds = DriverInput {
            bounds_low: Some("10".into()),
            bounds_high: Some("1".into()),
            ..ok
        };
        assert!(validate_input(&bad_bounds).is_err());
    }
}
