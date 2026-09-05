//! Alert engine commands (F-026 · M5-4 · S-056 · API-SPEC §7 alerts.*).
//!
//! Commands (the locked catalog carries exactly these two for alerts — dismiss/mute and
//! rule edit/update have NO `alerts.*` rows; surfacing them would require an API-SPEC
//! row + migration decision (Tier-3), so the UI ships them disabled rather than fake):
//! - `alerts.list`: `{filter}` → `{alerts[]}` — read path; before selecting, it fires due
//!   rules against the Company's current working data (PRD F-026: "alerts evaluate the
//!   current working Model, not locked history" — US-027 edge case).
//! - `alerts.create_rule`: `{rule}` → `{rule_id, audit_id}` — audited mutation on the
//!   Company's HMAC chain (B4/audit policy). Errors: ALERT_RULE_INVALID (422,
//!   non-retryable — ERROR-HANDLING §H).
//!
//! Evaluation policy (hand-reviewable, no hidden magic):
//! - `line_ref` rules compare the line's most recently written `model_values.amount_minor`
//!   inside the Company's **draft** scenarios (the working state; review/approved/locked
//!   never fire) against the rule's exact decimal threshold. All comparisons are
//!   `rust_decimal` on the stored integer minor units — never float (B3/B18-2).
//! - `kpi_id` rules persist and validate, but no KPI engine exists before M6-4/M6-5, so
//!   there is no evaluation source: they are stored active and simply never fire until the
//!   KPI builder lands. The response never fabricates a KPI value.
//! - Fire/dedupe: at most ONE open alert per rule per UTC day (`dismissed_at IS NULL`),
//!   matching US-027 "notification sent once (dedupe) · digest ≤ 1/24h". The Alert Center
//!   list is the record; OS notification is out of scope (opt-in, M6+).
//! - Retention: the list is windowed to 90 days (S-056). Physical pruning on retention is
//!   a migration/backup concern, not this read path.
//! - Firing on the read path writes `alerts` rows like recalc writes `model_values`:
//!   system-computed data, not a user mutation — no audit event (precedent: model.recalc).

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{SessionState, require_session_write, require_unlocked};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::{db, keystore};

const ALERT_OPERATORS: [&str; 5] = ["lt", "lte", "gt", "gte", "eq"];
const ALERT_SEVERITIES: [&str; 3] = ["info", "warning", "critical"];

/// `alerts.list` filter (API-SPEC `{filter}` — optional sub-fields only; invents nothing
/// beyond the wireframe's "filters": severity + the dismissed log view).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct AlertFilter {
    pub severity: Option<String>,
    pub include_dismissed: Option<bool>,
}

/// One row of the alert log (list response item). `trigger_chain` is the persisted
/// `trigger_chain_json` (DATABASE-SCHEMA §alerts): `{rule, value, threshold, period_id?,
/// line?, driver?}` — values are exact decimal strings of minor units.
#[derive(Debug, Clone, Serialize)]
pub struct AlertRow {
    pub id: String,
    pub rule_id: String,
    pub rule_name: String,
    pub severity: String,
    pub fired_at: String,
    pub trigger_chain: serde_json::Value,
    pub dismissed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertsListResponse {
    pub alerts: Vec<AlertRow>,
}

/// `alerts.create_rule` rule payload (the 001_initial.sql `alert_rules` CHECK columns).
/// Ids are engine-generated; the client never supplies `id`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct AlertRuleInput {
    pub name: String,
    #[serde(default)]
    pub kpi_id: Option<String>,
    #[serde(default)]
    pub line_ref: Option<String>,
    pub threshold_operator: String,
    pub threshold_value: String,
    pub severity: String,
    #[serde(default = "default_active")]
    pub active: bool,
}

fn default_active() -> bool {
    true
}

fn rule_invalid(detail: impl Into<String>) -> AppError {
    AppError::AlertRuleInvalid {
        detail: detail.into(),
    }
}

/// Exact-decimal parse for threshold values: optional sign, digits, optional `.` + digits.
/// Rejects exponents/NaN/Infinity/empty/fractions without digits on either side, so no
/// float-formatted string can ever enter the money path (B3).
fn parse_exact_decimal(s: &str) -> Result<Decimal, ()> {
    let body = s.strip_prefix('-').unwrap_or(s);
    if body.is_empty() {
        return Err(());
    }
    let mut parts = body.split('.');
    let int_part = parts.next().unwrap_or("");
    let frac_part = parts.next();
    if parts.next().is_some() {
        return Err(()); // more than one '.'
    }
    if int_part.is_empty() && frac_part.is_some() {
        return Err(()); // ".5"
    }
    if frac_part == Some("") {
        return Err(()); // "5."
    }
    if !int_part.chars().all(|c| c.is_ascii_digit()) {
        return Err(());
    }
    if let Some(f) = frac_part {
        if !f.chars().all(|c| c.is_ascii_digit()) {
            return Err(());
        }
    }
    Decimal::from_str(s).map_err(|_| ())
}

/// Validate a rule against the DB domain (mirrors the alert_rules CHECK constraints;
/// violations surface as typed ALERT_RULE_INVALID with a precise detail — never a raw
/// SQLite constraint error).
fn validate_rule(rule: &AlertRuleInput) -> AppResult<Decimal> {
    let name = rule.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(rule_invalid("name must be 1–120 characters"));
    }
    let has_kpi = rule.kpi_id.as_deref().is_some_and(|v| !v.trim().is_empty());
    let has_line = rule.line_ref.as_deref().is_some_and(|v| !v.trim().is_empty());
    if has_kpi == has_line {
        // exactly one target (S-056: threshold per KPI/line — never both, never neither)
        return Err(rule_invalid("exactly one of kpi_id or line_ref is required"));
    }
    if !ALERT_OPERATORS.contains(&rule.threshold_operator.as_str()) {
        return Err(rule_invalid(format!(
            "threshold_operator must be one of {}",
            ALERT_OPERATORS.join(", ")
        )));
    }
    if !ALERT_SEVERITIES.contains(&rule.severity.as_str()) {
        return Err(rule_invalid(format!(
            "severity must be one of {}",
            ALERT_SEVERITIES.join(", ")
        )));
    }
    parse_exact_decimal(&rule.threshold_value)
        .map_err(|_| rule_invalid("threshold_value must be an exact decimal string"))
}

/// Threshold crossing under the rule operator (exact Decimal compare; `eq` compares
/// numerically so "2500.0" == "2500").
fn crosses(value: &Decimal, operator: &str, threshold: &Decimal) -> bool {
    match operator {
        "lt" => value < threshold,
        "lte" => value <= threshold,
        "gt" => value > threshold,
        "gte" => value >= threshold,
        "eq" => value == threshold,
        _ => false,
    }
}

/// The line's most recently written working value: latest draft-scenario model_values row
/// for this line inside this Company (draft = current working state; review/approved/locked
/// are history and must never fire alerts — US-027). Returns (minor, period_id).
fn latest_working_value(
    conn: &rusqlite::Connection,
    company_id: &str,
    line_ref: &str,
) -> AppResult<Option<(i64, Option<String>)>> {
    let mut stmt = conn
        .prepare(
            "SELECT mv.amount_minor, mv.period_id
             FROM model_values mv
             JOIN model_lines ml ON ml.id = mv.line_id
             JOIN model_sheets ms ON ms.id = ml.sheet_id
             JOIN models m ON m.id = ms.model_id
             JOIN scenarios s ON s.id = mv.scenario_id
             WHERE m.company_id = ?1 AND ml.id = ?2
               AND s.state = 'draft' AND mv.amount_minor IS NOT NULL
             ORDER BY mv.rowid DESC
             LIMIT 1",
        )
        .map_err(AppError::from)?;
    let row = stmt
        .query_row(rusqlite::params![company_id, line_ref], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .ok();
    Ok(row)
}

/// Fire due rules once per day (dedupe) and return the number of inserts.
/// Only `line_ref` rules have an evaluation source pre-M6-4; `kpi_id` rules are skipped.
fn fire_due_alerts(conn: &mut rusqlite::Connection, company_id: &str) -> AppResult<usize> {
    struct DueRule {
        id: String,
        name: String,
        line_ref: String,
        operator: String,
        threshold: String,
        severity: String,
    }
    let mut fired = 0usize;

    let mut rules: Vec<DueRule> = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, line_ref, threshold_operator, threshold_value, severity
                 FROM alert_rules
                 WHERE active = 1 AND line_ref IS NOT NULL",
            )
            .map_err(AppError::from)?;
        let rows = stmt.query_map([], |r| {
            Ok(DueRule {
                id: r.get(0)?,
                name: r.get(1)?,
                line_ref: r.get(2)?,
                operator: r.get(3)?,
                threshold: r.get(4)?,
                severity: r.get(5)?,
            })
        })?;
        for row in rows {
            rules.push(row?);
        }
    }

    for rule in rules {
        let Some((value_minor, period_id)) =
            latest_working_value(conn, company_id, &rule.line_ref)?
        else {
            continue; // no working value yet — nothing to compare, never fabricate
        };
        let Ok(threshold) = parse_exact_decimal(&rule.threshold) else {
            continue; // stored rows are CHECK-constrained; a legacy bad row must not 500
        };
        let value = Decimal::from(value_minor);
        if !crosses(&value, &rule.operator, &threshold) {
            continue;
        }

        let already_open_today: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM alerts
                    WHERE rule_id = ?1 AND dismissed_at IS NULL
                      AND date(fired_at) = date('now')
                 )",
                rusqlite::params![rule.id],
                |r| r.get(0),
            )
            .map_err(AppError::from)?;
        if already_open_today {
            continue; // dedupe: one open alert per rule per UTC day (≤1/24h — US-027)
        }

        let chain = serde_json::json!({
            "rule": rule.name,
            "line": rule.line_ref,
            "period_id": period_id,
            "value": value.to_string(),
            "threshold": rule.threshold,
        });
        let alert_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO alerts (id, rule_id, fired_at, trigger_chain_json, dismissed_at)
             VALUES (?1, ?2, ?3, ?4, NULL)",
            rusqlite::params![alert_id, rule.id, now, chain.to_string()],
        )
        .map_err(AppError::from)?;
        fired += 1;
    }
    Ok(fired)
}

/// `alerts.list` — session scope, read-only semantics (works while locked-read too:
/// requires only an unlocked session; no Company-write gate).
#[tauri::command(name = "alerts.list", rename_all = "snake_case")]
pub fn alerts_list(
    app: AppHandle,
    filter: Option<AlertFilter>,
    session: State<'_, SessionState>,
) -> AppResult<AlertsListResponse> {
    let company_id = require_unlocked(&session)?;
    let filter = filter.unwrap_or_default();
    if let Some(sev) = &filter.severity {
        if !ALERT_SEVERITIES.contains(&sev.as_str()) {
            return Err(rule_invalid(format!(
                "filter.severity must be one of {}",
                ALERT_SEVERITIES.join(", ")
            )));
        }
    }

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    // Fire before reading so "when the forecast crosses it, an alert appears" holds within
    // one list call (US-027). System-computed writes — like recalc — are not audited.
    fire_due_alerts(&mut conn, &company_id)?;

    // NOTE: `alerts`/`alert_rules` carry no company_id column (001_initial.sql is locked;
    // adding one is a Tier-3 migration). Company scoping therefore lives where it can:
    // rule FIRING is company-scoped (model_values resolution filters by company), while the
    // log itself is per-store, like the app-scope settings table precedent.
    let include_dismissed = filter.include_dismissed.unwrap_or(false);
    let sev = filter.severity.clone();
    let mut sql = String::from(
        "SELECT a.id, a.rule_id, r.name, r.severity, a.fired_at, a.trigger_chain_json,
                a.dismissed_at
         FROM alerts a
         JOIN alert_rules r ON r.id = a.rule_id
         WHERE a.fired_at >= datetime('now', '-90 day')",
    );
    if !include_dismissed {
        sql.push_str(" AND a.dismissed_at IS NULL");
    }
    if sev.is_some() {
        sql.push_str(" AND r.severity = ?1");
    }
    sql.push_str(" ORDER BY a.fired_at DESC, a.id");

    let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<AlertRow> {
        let chain: String = r.get(5)?;
        Ok(AlertRow {
            id: r.get(0)?,
            rule_id: r.get(1)?,
            rule_name: r.get(2)?,
            severity: r.get(3)?,
            fired_at: r.get(4)?,
            trigger_chain: serde_json::from_str(&chain)
                .unwrap_or_else(|_| serde_json::json!({ "raw": chain })),
            dismissed_at: r.get(6)?,
        })
    };
    let mut rows: Vec<AlertRow> = Vec::new();
    let mapped = match &sev {
        Some(s) => stmt.query_map(rusqlite::params![s], map_row),
        None => stmt.query_map([], map_row),
    }
    .map_err(AppError::from)?;
    for row in mapped {
        rows.push(row?);
    }
    Ok(AlertsListResponse { alerts: rows })
}

/// `alerts.create_rule` — Company-write mutation; inserts the rule and an HMAC-chained
/// audit event in one transaction (B4; every mutation is audited).
#[tauri::command(name = "alerts.create_rule", rename_all = "snake_case")]
pub fn alerts_create_rule(
    app: AppHandle,
    rule: AlertRuleInput,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    validate_rule(&rule)?; // typed ALERT_RULE_INVALID before any SQL (never a raw constraint error)

    let rule_id = Uuid::new_v4().to_string();
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;

    tx.execute(
        "INSERT INTO alert_rules
           (id, name, kpi_id, line_ref, threshold_operator, threshold_value, severity, active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            rule_id,
            rule.name.trim(),
            rule.kpi_id,
            rule.line_ref,
            rule.threshold_operator,
            rule.threshold_value,
            rule.severity,
            if rule.active { 1i64 } else { 0i64 }
        ],
    )
    .map_err(AppError::from)?;

    let now = chrono::Utc::now().to_rfc3339();
    let after_json = serde_json::json!({
        "action": "alerts.create_rule",
        "rule_id": rule_id,
        "name": rule.name.trim(),
        "kpi_id": rule.kpi_id,
        "line_ref": rule.line_ref,
        "threshold_operator": rule.threshold_operator,
        "threshold_value": rule.threshold_value,
        "severity": rule.severity,
        "active": rule.active,
        "created_at": now,
    })
    .to_string();
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id).map_err(AppError::from)?;
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events
           (company_id, actor, action, object_type, object_id, before_json, after_json,
            prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'alerts.create_rule', 'alert_rule', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![company_id, rule_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    let audit_id = tx.last_insert_rowid();
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({
        "data": {
            "rule_id": rule_id,
            "audit_id": audit_id,
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(name: &str, kpi: Option<&str>, line: Option<&str>, op: &str, value: &str) -> AlertRuleInput {
        AlertRuleInput {
            name: name.to_string(),
            kpi_id: kpi.map(str::to_string),
            line_ref: line.map(str::to_string),
            threshold_operator: op.to_string(),
            threshold_value: value.to_string(),
            severity: "warning".to_string(),
            active: true,
        }
    }

    #[test]
    fn exact_decimal_accepts_only_plain_decimal_strings() {
        assert_eq!(parse_exact_decimal("2500000000").unwrap(), Decimal::from(2_500_000_000i64));
        assert_eq!(parse_exact_decimal("-24.50").unwrap(), Decimal::from_str("-24.5").unwrap());
        for bad in ["", "-.5", "5.", "1e3", "abc", "1.2.3", "NaN", "1,000", "+5"] {
            assert!(parse_exact_decimal(bad).is_err(), "must reject {bad:?}");
        }
    }

    #[test]
    fn validation_enforces_name_target_pair_operator_and_severity() {
        assert!(validate_rule(&rule("", None, Some("l1"), "lt", "10")).is_err());
        assert!(validate_rule(&rule("n", None, None, "lt", "10")).is_err(), "no target");
        assert!(
            validate_rule(&rule("n", Some("k1"), Some("l1"), "lt", "10")).is_err(),
            "both targets"
        );
        assert!(validate_rule(&rule("n", None, Some("l1"), "ne", "10")).is_err(), "bad op");
        assert!(
            validate_rule(&rule("n", None, Some("l1"), "lt", "1.5e3")).is_err(),
            "float-form threshold"
        );
        assert!(validate_rule(&rule("n", None, Some("l1"), "lte", "-0.25")).is_ok());
    }

    #[test]
    fn crosses_matrix_is_exact_and_eq_is_numeric() {
        let t = Decimal::from_str("100").unwrap();
        let (lo, at) = (Decimal::from_str("99.99").unwrap(), Decimal::from_str("100.0").unwrap());
        assert!(crosses(&lo, "lt", &t) && crosses(&lo, "lte", &t) && !crosses(&lo, "gt", &t));
        assert!(!crosses(&at, "lt", &t) && crosses(&at, "lte", &t) && crosses(&at, "eq", &t));
        assert!(crosses(&at, "gte", &t) && !crosses(&at, "gt", &t));
    }
}
