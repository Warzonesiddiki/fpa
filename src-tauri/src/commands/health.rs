//! Model Health Check commands (F-032 · M6-7 · S-071 · US-033 · API-SPEC §7 `health.*`).
//!
//! Commands (the locked catalog carries exactly these two — there is no `health.history`
//! or `health.rerun` row, so the screen re-runs by calling `health.run` again and reads
//! history from the persisted `health_checks` rows returned by that same call):
//! - `health.run`: `{model_id}` → `{check_id, findings[], …}` — runs the five documented
//!   categories against persisted data and stores the run (`health_checks` +
//!   `health_findings`). No error row in the catalog: a failing Model is a *report*, never
//!   an exception (US-033: "findings are never silent" — and never a thrown 500 either).
//! - `health.waive`: `{finding_id, reason}` → `{waived}` — audited mutation on the
//!   Company's HMAC chain. Errors: HEALTH_WAIVER_REASON_REQUIRED (422, non-retryable —
//!   ERROR-HANDLING §G), VALUE_INVALID (422) for an unknown/foreign finding.
//!
//! The five categories (GLOSSARY "Model Health Check", QA-CHECKLIST F-032 item 1) are run
//! in this fixed order and every one of them reads real persisted rows — a category with
//! no data to inspect reports zero findings, it never reports a fabricated pass detail:
//!
//! | Category      | Severity | What is asserted (source of truth)                        |
//! |---------------|----------|-----------------------------------------------------------|
//! | `tie_out`     | hard     | Committed GL is balanced per Fiscal Period (Σ`amount_minor` = 0, GL-TEMPLATE-SPEC §3 debit-positive/credit-negative) and no committed batch carries `tie_out_status='fail'` |
//! | `reference`   | hard     | Every authored `model_values.formula` passes the whitelist gate (`core::model::validate_formula`); every `model_lines.account_id` resolves to an active Account; every `method='driver'` line resolves to a real Driver |
//! | `rounding`    | hard/warn| Money cells hold exact integer minor units (a `format='money'` cell with only `amount_text` is HARD — MONEY-ROUNDING-SPEC §1); a money line whose `decimals` disagrees with the Company's Currency Scale is WARN (display-only, §3) |
//! | `driver_feed` | hard     | Every Driver consumed by a `method='driver'` line has a `driver_values` row for every (scenario, period) the Model actually holds values for |
//! | `anomaly`     | warn     | Driver/Assumption values outside their declared `bounds_low`/`bounds_high`, and period-over-period swings above `ANOMALY_SWING_FACTOR`× the prior magnitude. **Never auto-adjusted** (GLOSSARY "Anomaly": always surfaced, never fixed) |
//!
//! Invariants:
//! - **No auto-fix, ever** (QA-CHECKLIST F-032 item 3). This module contains no UPDATE or
//!   DELETE against model/driver/GL data; it only INSERTs into `health_checks`,
//!   `health_findings`, `waivers` and `audit_events`.
//! - **Exact arithmetic only.** Money comparisons are integer `amount_minor`; bounds and
//!   swing comparisons use `rust_decimal::Decimal` on the stored decimal strings. No float
//!   anywhere (B3/B18-2).
//! - **The waiver is the only escape, and it costs a reason** (US-033 / D-010). An empty or
//!   whitespace-only reason is HEALTH_WAIVER_REASON_REQUIRED; the reason and the actor are
//!   persisted and written to the HMAC audit chain, and the waived finding stays visible.
//! - **Waivers survive a re-run.** A finding's identity is its fingerprint
//!   (`category|severity|entity_ref|message`), not its row id, so re-running a Model does
//!   not silently drop a decision the owner already made and audited. The carry-forward
//!   copies the *original* `reason`/`actor`/`created_at` and writes no new audit event —
//!   it re-states a recorded decision rather than minting a new one.
//! - **Blocking is data, not a thrown error.** `health.run` reports
//!   `blocking_count` (unwaived HARD findings); `AppError::health_check_blocked` exists for
//!   the export path (M6-6) to raise at the moment an export is actually attempted.
//! - **Scope.** `model_id` must belong to the unlocked Company; a foreign or unknown Model
//!   is VALUE_INVALID — never a cross-Company read.
//!
//! Known limitation, stated rather than faked: the catalog exposes one request/response
//! command, so results are returned as one complete report. The S-071 "partial results"
//! state is driven by the per-category rollup in `categories[]` (each category carries its
//! own finding count and status) and an indeterminate progress indicator — the UI never
//! shows a fabricated percentage. True incremental streaming needs a Tauri event channel
//! plus an API-SPEC row (Tier-3 change) and is not invented here.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::Connection;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{SessionState, require_session_write, require_unlocked};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::core::model::validate_formula;
use crate::core::money::scale_for_currency;
use crate::storage::{db, keystore};

/// The five categories, in run order (GLOSSARY "Model Health Check"). Mirrored by the
/// `health_findings.category` CHECK constraint and by `HealthCategory` in `schema.ts`.
pub const HEALTH_CATEGORIES: [&str; 5] = [
    "tie_out",
    "reference",
    "rounding",
    "driver_feed",
    "anomaly",
];

/// A period-over-period move larger than this multiple of the prior magnitude is flagged as
/// an anomaly (WARN, never auto-adjusted). Declared as an exact integer factor so the check
/// is reproducible and reviewable — not a tuned float.
pub const ANOMALY_SWING_FACTOR: i64 = 5;

/// One finding as persisted in `health_findings` (+ its waiver, when one exists).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HealthFinding {
    pub id: String,
    pub category: String,
    pub severity: String,
    pub message: String,
    /// Typed pointer to what failed, so the UI can offer "→ cell" only where a cell exists:
    /// `cell:{line_id}:{scenario_id}:{period_id}` · `line:{id}` · `driver:{id}` ·
    /// `assumption:{id}` · `period:{id}` · `batch:{id}`.
    pub entity_ref: Option<String>,
    pub waiver: Option<HealthWaiver>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HealthWaiver {
    pub reason: String,
    pub actor: String,
    pub created_at: String,
}

/// Per-category rollup — the S-071 category rows ("tie-outs · refs · rounding · driver
/// feeds · anomalies"), each with its own counts so the screen never sums them itself.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HealthCategoryResult {
    pub category: String,
    pub status: String,
    pub finding_count: i64,
    pub blocking_count: i64,
    pub warning_count: i64,
}

/// A previous run of this Model (S-071 "History + rerun", QA-CHECKLIST F-032 item 6).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HealthRunSummary {
    pub check_id: String,
    pub run_at: String,
    pub status: String,
    pub finding_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HealthRunResponse {
    pub check_id: String,
    pub model_id: String,
    pub run_at: String,
    /// `passed` when no unwaived HARD finding remains, otherwise `failed`. Mirrors the
    /// persisted `health_checks.status` (which only admits running/passed/failed).
    pub status: String,
    pub findings: Vec<HealthFinding>,
    pub categories: Vec<HealthCategoryResult>,
    /// Unwaived HARD findings — the export gate (HEALTH_CHECK_BLOCKED is raised by the
    /// export path when this is non-zero, not here).
    pub blocking_count: i64,
    pub warning_count: i64,
    pub waived_count: i64,
    /// Most recent runs first, including this one (bounded window).
    pub history: Vec<HealthRunSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HealthWaiveResponse {
    pub waived: bool,
    pub finding_id: String,
    pub audit_id: i64,
}

/// How many previous runs the response carries (S-071 history strip).
const HEALTH_HISTORY_LIMIT: i64 = 10;

/// A finding before it is persisted (no id yet).
#[derive(Debug, Clone, PartialEq, Eq)]
struct DraftFinding {
    category: &'static str,
    severity: &'static str,
    message: String,
    entity_ref: Option<String>,
}

impl DraftFinding {
    fn hard(category: &'static str, message: String, entity_ref: Option<String>) -> Self {
        DraftFinding {
            category,
            severity: "hard",
            message,
            entity_ref,
        }
    }

    fn warn(category: &'static str, message: String, entity_ref: Option<String>) -> Self {
        DraftFinding {
            category,
            severity: "warn",
            message,
            entity_ref,
        }
    }

    /// Stable identity across runs — the key waivers are carried forward on.
    fn fingerprint(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.category,
            self.severity,
            self.entity_ref.as_deref().unwrap_or(""),
            self.message
        )
    }
}

fn fingerprint_of(category: &str, severity: &str, entity_ref: Option<&str>, message: &str) -> String {
    format!(
        "{}|{}|{}|{}",
        category,
        severity,
        entity_ref.unwrap_or(""),
        message
    )
}

/// Resolve `model_id` inside the unlocked Company (VALUE_INVALID otherwise — never a
/// cross-Company read).
fn require_company_model(conn: &Connection, company_id: &str, model_id: &str) -> AppResult<()> {
    let owned: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM models WHERE id = ?1 AND company_id = ?2)",
            rusqlite::params![model_id, company_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if !owned {
        return Err(AppError::invalid(
            "VALUE_INVALID: model_id is not a Model of the unlocked Company",
        ));
    }
    Ok(())
}

/// One authored cell of the Model, with everything the checks need about its line.
#[derive(Debug, Clone)]
struct ModelCell {
    line_id: String,
    scenario_id: String,
    period_id: String,
    amount_minor: Option<i64>,
    amount_text: Option<String>,
    formula: Option<String>,
    format: String,
    decimals: i64,
}

fn model_cells(conn: &Connection, model_id: &str) -> AppResult<Vec<ModelCell>> {
    let mut stmt = conn
        .prepare(
            "SELECT mv.line_id, mv.scenario_id, mv.period_id, mv.amount_minor, mv.amount_text,
                    mv.formula, ml.format, ml.decimals
             FROM model_values mv
             JOIN model_lines ml ON ml.id = mv.line_id
             JOIN model_sheets ms ON ms.id = ml.sheet_id
             WHERE ms.model_id = ?1
             ORDER BY mv.line_id, mv.scenario_id, mv.period_id",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![model_id], |r| {
            Ok(ModelCell {
                line_id: r.get(0)?,
                scenario_id: r.get(1)?,
                period_id: r.get(2)?,
                amount_minor: r.get(3)?,
                amount_text: r.get(4)?,
                formula: r.get(5)?,
                format: r.get(6)?,
                decimals: r.get(7)?,
            })
        })
        .map_err(AppError::from)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)
}

/// Periods the Model actually holds values for, in fiscal order (start_date, then period_no).
/// This is the honest horizon: the checks never invent periods the Model has never touched.
fn model_periods(conn: &Connection, model_id: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT mv.period_id, fp.start_date, fp.period_no
             FROM model_values mv
             JOIN model_lines ml ON ml.id = mv.line_id
             JOIN model_sheets ms ON ms.id = ml.sheet_id
             JOIN fiscal_periods fp ON fp.id = mv.period_id
             WHERE ms.model_id = ?1
             ORDER BY fp.start_date, fp.period_no",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![model_id], |r| r.get::<_, String>(0))
        .map_err(AppError::from)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)
}

fn model_scenarios_with_values(conn: &Connection, model_id: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT mv.scenario_id
             FROM model_values mv
             JOIN model_lines ml ON ml.id = mv.line_id
             JOIN model_sheets ms ON ms.id = ml.sheet_id
             WHERE ms.model_id = ?1
             ORDER BY mv.scenario_id",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![model_id], |r| r.get::<_, String>(0))
        .map_err(AppError::from)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Category 1 — tie_out (HARD)
// ─────────────────────────────────────────────────────────────────────────────────────────

/// Committed GL must balance per Fiscal Period. The canonical store is debit-positive /
/// credit-negative (GL-TEMPLATE-SPEC §3), so a balanced period sums to exactly zero in
/// integer minor units. Excluded rows are out of scope by definition (they are logged at
/// import time), matching the statement engine's source rule.
fn check_tie_out(conn: &Connection, company_id: &str) -> AppResult<Vec<DraftFinding>> {
    let mut out = Vec::new();

    let mut stmt = conn
        .prepare(
            "SELECT gl.period_id, COALESCE(SUM(gl.amount_minor), 0)
             FROM gl_lines gl
             JOIN import_batches ib ON ib.id = gl.batch_id
             WHERE gl.company_id = ?1 AND gl.is_excluded = 0 AND ib.status = 'committed'
             GROUP BY gl.period_id
             ORDER BY gl.period_id",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![company_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(AppError::from)?;
    for row in rows {
        let (period_id, sum_minor) = row.map_err(AppError::from)?;
        if sum_minor != 0 {
            out.push(DraftFinding::hard(
                "tie_out",
                format!(
                    "Committed GL does not tie for period {period_id}: debits minus credits = {sum_minor} minor units (must be 0)."
                ),
                Some(format!("period:{period_id}")),
            ));
        }
    }

    let mut batches = conn
        .prepare(
            "SELECT id, source_name FROM import_batches
             WHERE company_id = ?1 AND status = 'committed' AND tie_out_status = 'fail'
             ORDER BY created_at, id",
        )
        .map_err(AppError::from)?;
    let rows = batches
        .query_map(rusqlite::params![company_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(AppError::from)?;
    for row in rows {
        let (batch_id, source_name) = row.map_err(AppError::from)?;
        out.push(DraftFinding::hard(
            "tie_out",
            format!("Committed import batch \"{source_name}\" was committed with a failed tie-out."),
            Some(format!("batch:{batch_id}")),
        ));
    }

    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Category 2 — reference (HARD)
// ─────────────────────────────────────────────────────────────────────────────────────────

/// Broken references: unsupported/malformed Formulas, Model Lines pointing at a missing or
/// inactive Account, and driver-method Lines with no resolvable Driver.
fn check_references(
    conn: &Connection,
    model_id: &str,
    cells: &[ModelCell],
) -> AppResult<Vec<DraftFinding>> {
    let mut out = Vec::new();

    for cell in cells {
        let Some(formula) = cell.formula.as_deref() else {
            continue;
        };
        if let Err(err) = validate_formula(formula) {
            out.push(DraftFinding::hard(
                "reference",
                format!("Formula is not valid: {}.", err.body().message),
                Some(format!(
                    "cell:{}:{}:{}",
                    cell.line_id, cell.scenario_id, cell.period_id
                )),
            ));
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT ml.id, ml.account_id, ml.driver_id, ml.method,
                    (SELECT COUNT(*) FROM accounts a WHERE a.id = ml.account_id AND a.active = 1),
                    (SELECT COUNT(*) FROM drivers d WHERE d.id = ml.driver_id)
             FROM model_lines ml
             JOIN model_sheets ms ON ms.id = ml.sheet_id
             WHERE ms.model_id = ?1
             ORDER BY ml.sort_order, ml.id",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![model_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })
        .map_err(AppError::from)?;
    for row in rows {
        let (line_id, account_id, driver_id, method, active_accounts, driver_hits) =
            row.map_err(AppError::from)?;
        if let Some(account_id) = account_id.as_deref()
            && active_accounts == 0
        {
            out.push(DraftFinding::hard(
                "reference",
                format!(
                    "Model Line references Account {account_id}, which is missing or inactive."
                ),
                Some(format!("line:{line_id}")),
            ));
        }
        if method == "driver" {
            match driver_id.as_deref() {
                None => out.push(DraftFinding::hard(
                    "reference",
                    "Model Line uses the driver method but references no Driver.".to_string(),
                    Some(format!("line:{line_id}")),
                )),
                Some(driver) if driver_hits == 0 => out.push(DraftFinding::hard(
                    "reference",
                    format!("Model Line references Driver {driver}, which no longer exists."),
                    Some(format!("line:{line_id}")),
                )),
                Some(_) => {}
            }
        }
    }

    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Category 3 — rounding (HARD + WARN)
// ─────────────────────────────────────────────────────────────────────────────────────────

/// Rounding integrity (MONEY-ROUNDING-SPEC §1/§3): money is stored as exact integer minor
/// units, and a money Line's display `decimals` must match the Company's Currency Scale.
fn check_rounding(cells: &[ModelCell], currency: &str, scale: i64) -> Vec<DraftFinding> {
    let mut out = Vec::new();
    let mut flagged_lines: BTreeSet<String> = BTreeSet::new();

    for cell in cells {
        if cell.format != "money" {
            continue;
        }
        if cell.amount_minor.is_none() && cell.amount_text.is_some() {
            out.push(DraftFinding::hard(
                "rounding",
                "Money cell holds text instead of exact integer minor units — the value cannot be rounded or totalled exactly.".to_string(),
                Some(format!(
                    "cell:{}:{}:{}",
                    cell.line_id, cell.scenario_id, cell.period_id
                )),
            ));
        }
        if cell.decimals != scale && flagged_lines.insert(cell.line_id.clone()) {
            out.push(DraftFinding::warn(
                "rounding",
                format!(
                    "Money Line displays {} decimals but {currency} has a Currency Scale of {scale} — displayed totals may not match the exact stored amounts.",
                    cell.decimals
                ),
                Some(format!("line:{}", cell.line_id)),
            ));
        }
    }

    out
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Category 4 — driver_feed (HARD)
// ─────────────────────────────────────────────────────────────────────────────────────────

/// Every Driver a Line consumes must be fed for every (scenario, period) the Model holds
/// values for. Missing feeds are reported per Driver with the exact missing count — the
/// engine never substitutes a default.
fn check_driver_feeds(
    conn: &Connection,
    model_id: &str,
    scenarios: &[String],
    periods: &[String],
) -> AppResult<Vec<DraftFinding>> {
    let mut out = Vec::new();
    if scenarios.is_empty() || periods.is_empty() {
        return Ok(out);
    }

    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT d.id, d.name
             FROM model_lines ml
             JOIN model_sheets ms ON ms.id = ml.sheet_id
             JOIN drivers d ON d.id = ml.driver_id
             WHERE ms.model_id = ?1 AND ml.method = 'driver'
             ORDER BY d.name, d.id",
        )
        .map_err(AppError::from)?;
    let drivers = stmt
        .query_map(rusqlite::params![model_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(AppError::from)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)?;

    for (driver_id, driver_name) in drivers {
        let mut fed: BTreeSet<(String, String)> = BTreeSet::new();
        let mut values = conn
            .prepare(
                "SELECT scenario_id, period_id FROM driver_values WHERE driver_id = ?1",
            )
            .map_err(AppError::from)?;
        let rows = values
            .query_map(rusqlite::params![driver_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(AppError::from)?;
        for row in rows {
            fed.insert(row.map_err(AppError::from)?);
        }

        let mut missing = 0i64;
        for scenario_id in scenarios {
            for period_id in periods {
                if !fed.contains(&(scenario_id.clone(), period_id.clone())) {
                    missing += 1;
                }
            }
        }
        if missing > 0 {
            let total = (scenarios.len() * periods.len()) as i64;
            out.push(DraftFinding::hard(
                "driver_feed",
                format!(
                    "Driver \"{driver_name}\" has no value for {missing} of {total} scenario/period slots the Model uses."
                ),
                Some(format!("driver:{driver_id}")),
            ));
        }
    }

    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Category 5 — anomaly (WARN — never auto-fixed)
// ─────────────────────────────────────────────────────────────────────────────────────────

fn parse_bound(value: Option<&str>) -> Option<Decimal> {
    value.and_then(|v| Decimal::from_str(v.trim()).ok())
}

/// Out-of-bounds Driver and Assumption values, plus abrupt period-over-period swings in
/// money cells. Every one is WARN and is only ever *reported* (GLOSSARY "Anomaly").
fn check_anomalies(
    conn: &Connection,
    model_id: &str,
    cells: &[ModelCell],
    periods: &[String],
) -> AppResult<Vec<DraftFinding>> {
    let mut out = Vec::new();

    // Drivers: declared bounds are a contract; a stored value outside them is surfaced.
    let mut stmt = conn
        .prepare(
            "SELECT d.id, d.name, d.bounds_low, d.bounds_high, dv.period_id, dv.value_decimal
             FROM drivers d
             JOIN driver_values dv ON dv.driver_id = d.id
             WHERE d.model_id = ?1 AND (d.bounds_low IS NOT NULL OR d.bounds_high IS NOT NULL)
             ORDER BY d.name, dv.period_id",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![model_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(AppError::from)?;
    for row in rows {
        let (driver_id, name, low, high, period_id, value) = row.map_err(AppError::from)?;
        let Ok(parsed) = Decimal::from_str(value.trim()) else {
            continue; // stored strings are written through validated paths; never 500 here
        };
        let low = parse_bound(low.as_deref());
        let high = parse_bound(high.as_deref());
        let breached = low.is_some_and(|l| parsed < l) || high.is_some_and(|h| parsed > h);
        if breached {
            out.push(DraftFinding::warn(
                "anomaly",
                format!(
                    "Driver \"{name}\" is {value} in period {period_id}, outside its declared bounds [{}, {}].",
                    low.map(|d| d.to_string()).unwrap_or_else(|| "–".to_string()),
                    high.map(|d| d.to_string()).unwrap_or_else(|| "–".to_string())
                ),
                Some(format!("driver:{driver_id}")),
            ));
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.name, a.bounds_low, a.bounds_high, av.period_id, av.value_decimal
             FROM assumptions a
             JOIN assumption_values av ON av.assumption_id = a.id
             WHERE a.model_id = ?1 AND (a.bounds_low IS NOT NULL OR a.bounds_high IS NOT NULL)
             ORDER BY a.name, av.period_id",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![model_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(AppError::from)?;
    for row in rows {
        let (assumption_id, name, low, high, period_id, value) = row.map_err(AppError::from)?;
        let Ok(parsed) = Decimal::from_str(value.trim()) else {
            continue;
        };
        let low = parse_bound(low.as_deref());
        let high = parse_bound(high.as_deref());
        if low.is_some_and(|l| parsed < l) || high.is_some_and(|h| parsed > h) {
            out.push(DraftFinding::warn(
                "anomaly",
                format!(
                    "Assumption \"{name}\" is {value} in period {period_id}, outside its declared bounds [{}, {}].",
                    low.map(|d| d.to_string()).unwrap_or_else(|| "–".to_string()),
                    high.map(|d| d.to_string()).unwrap_or_else(|| "–".to_string())
                ),
                Some(format!("assumption:{assumption_id}")),
            ));
        }
    }

    out.extend(swing_anomalies(cells, periods));
    Ok(out)
}

/// Abrupt period-over-period change in a money cell: |current − prior| > factor × |prior|,
/// with a non-zero prior (a move away from zero has no defined magnitude to compare with and
/// is not guessed at). Integer arithmetic on minor units throughout.
fn swing_anomalies(cells: &[ModelCell], periods: &[String]) -> Vec<DraftFinding> {
    let order: BTreeMap<&str, usize> = periods
        .iter()
        .enumerate()
        .map(|(i, p)| (p.as_str(), i))
        .collect();

    // (line, scenario) → ordered (period_index, period_id, minor)
    let mut series: BTreeMap<(String, String), Vec<(usize, String, i64)>> = BTreeMap::new();
    for cell in cells {
        if cell.format != "money" {
            continue;
        }
        let (Some(minor), Some(index)) = (cell.amount_minor, order.get(cell.period_id.as_str()))
        else {
            continue;
        };
        series
            .entry((cell.line_id.clone(), cell.scenario_id.clone()))
            .or_default()
            .push((*index, cell.period_id.clone(), minor));
    }

    let mut out = Vec::new();
    for ((line_id, scenario_id), mut points) in series {
        points.sort_by_key(|(index, _, _)| *index);
        for window in points.windows(2) {
            let (_, _, prior) = &window[0];
            let (_, period_id, current) = &window[1];
            if *prior == 0 {
                continue;
            }
            let delta = current.saturating_sub(*prior).saturating_abs();
            let threshold = prior.saturating_abs().saturating_mul(ANOMALY_SWING_FACTOR);
            if delta > threshold {
                out.push(DraftFinding::warn(
                    "anomaly",
                    format!(
                        "Value moves from {prior} to {current} minor units into period {period_id} — more than {ANOMALY_SWING_FACTOR}× the prior magnitude."
                    ),
                    Some(format!("cell:{line_id}:{scenario_id}:{period_id}")),
                ));
            }
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Persistence + command surface
// ─────────────────────────────────────────────────────────────────────────────────────────

fn company_currency(conn: &Connection, company_id: &str) -> AppResult<String> {
    conn.query_row(
        "SELECT default_currency_code FROM companies WHERE id = ?1",
        rusqlite::params![company_id],
        |r| r.get::<_, String>(0),
    )
    .map_err(AppError::from)
}

/// Waivers recorded on the previous runs of this Model, keyed by finding fingerprint.
/// The newest waiver wins when the same fingerprint was waived more than once.
fn prior_waivers(
    conn: &Connection,
    model_id: &str,
) -> AppResult<BTreeMap<String, HealthWaiver>> {
    let mut stmt = conn
        .prepare(
            "SELECT hf.category, hf.severity, hf.entity_ref, hf.message,
                    w.reason, w.actor, w.created_at
             FROM waivers w
             JOIN health_findings hf ON hf.id = w.finding_id
             JOIN health_checks hc ON hc.id = hf.check_id
             WHERE hc.model_id = ?1
             ORDER BY w.created_at, w.rowid",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![model_id], |r| {
            Ok((
                fingerprint_of(
                    &r.get::<_, String>(0)?,
                    &r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?.as_deref(),
                    &r.get::<_, String>(3)?,
                ),
                HealthWaiver {
                    reason: r.get(4)?,
                    actor: r.get(5)?,
                    created_at: r.get(6)?,
                },
            ))
        })
        .map_err(AppError::from)?;
    let mut out = BTreeMap::new();
    for row in rows {
        let (key, waiver) = row.map_err(AppError::from)?;
        out.insert(key, waiver); // ORDER BY created_at ⇒ last write is the newest
    }
    Ok(out)
}

fn category_rollup(findings: &[HealthFinding]) -> Vec<HealthCategoryResult> {
    HEALTH_CATEGORIES
        .iter()
        .map(|category| {
            let mine: Vec<&HealthFinding> =
                findings.iter().filter(|f| f.category == *category).collect();
            let blocking = mine
                .iter()
                .filter(|f| f.severity == "hard" && f.waiver.is_none())
                .count() as i64;
            let warnings = mine.iter().filter(|f| f.severity == "warn").count() as i64;
            HealthCategoryResult {
                category: (*category).to_string(),
                status: if blocking > 0 {
                    "failed".to_string()
                } else if !mine.is_empty() {
                    "warnings".to_string()
                } else {
                    "passed".to_string()
                },
                finding_count: mine.len() as i64,
                blocking_count: blocking,
                warning_count: warnings,
            }
        })
        .collect()
}

fn run_history(
    conn: &Connection,
    model_id: &str,
) -> AppResult<Vec<HealthRunSummary>> {
    let mut stmt = conn
        .prepare(
            "SELECT hc.id, hc.run_at, hc.status,
                    (SELECT COUNT(*) FROM health_findings hf WHERE hf.check_id = hc.id)
             FROM health_checks hc
             WHERE hc.model_id = ?1
             ORDER BY hc.run_at DESC, hc.rowid DESC
             LIMIT ?2",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![model_id, HEALTH_HISTORY_LIMIT], |r| {
            Ok(HealthRunSummary {
                check_id: r.get(0)?,
                run_at: r.get(1)?,
                status: r.get(2)?,
                finding_count: r.get(3)?,
            })
        })
        .map_err(AppError::from)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)
}

/// Run the five categories and persist the report. Pure over an open connection so the
/// engine is unit-testable without Tauri state.
pub fn run_health_check(
    conn: &mut Connection,
    company_id: &str,
    model_id: &str,
    run_at: &str,
) -> AppResult<HealthRunResponse> {
    require_company_model(conn, company_id, model_id)?;

    let currency = company_currency(conn, company_id)?;
    let scale = scale_for_currency(&currency)
        .ok_or_else(|| AppError::invalid("VALUE_INVALID: Company currency has no known scale"))?
        as i64;

    let cells = model_cells(conn, model_id)?;
    let periods = model_periods(conn, model_id)?;
    let scenarios = model_scenarios_with_values(conn, model_id)?;
    let carried = prior_waivers(conn, model_id)?;

    let mut drafts: Vec<DraftFinding> = Vec::new();
    drafts.extend(check_tie_out(conn, company_id)?);
    drafts.extend(check_references(conn, model_id, &cells)?);
    drafts.extend(check_rounding(&cells, &currency, scale));
    drafts.extend(check_driver_feeds(conn, model_id, &scenarios, &periods)?);
    drafts.extend(check_anomalies(conn, model_id, &cells, &periods)?);

    let check_id = Uuid::new_v4().to_string();
    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO health_checks (id, model_id, run_at, status) VALUES (?1, ?2, ?3, 'running')",
        rusqlite::params![check_id, model_id, run_at],
    )
    .map_err(AppError::from)?;

    let mut findings: Vec<HealthFinding> = Vec::with_capacity(drafts.len());
    for draft in &drafts {
        let finding_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO health_findings (id, check_id, category, severity, message, entity_ref)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                finding_id,
                check_id,
                draft.category,
                draft.severity,
                draft.message,
                draft.entity_ref
            ],
        )
        .map_err(AppError::from)?;

        // Carry a previously audited waiver forward onto the new row, verbatim.
        let waiver = carried.get(&draft.fingerprint()).cloned();
        if let Some(w) = &waiver {
            tx.execute(
                "INSERT INTO waivers (id, finding_id, reason, created_at, actor)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    finding_id,
                    w.reason,
                    w.created_at,
                    w.actor
                ],
            )
            .map_err(AppError::from)?;
        }

        findings.push(HealthFinding {
            id: finding_id,
            category: draft.category.to_string(),
            severity: draft.severity.to_string(),
            message: draft.message.clone(),
            entity_ref: draft.entity_ref.clone(),
            waiver,
        });
    }

    let blocking_count = findings
        .iter()
        .filter(|f| f.severity == "hard" && f.waiver.is_none())
        .count() as i64;
    let warning_count = findings.iter().filter(|f| f.severity == "warn").count() as i64;
    let waived_count = findings.iter().filter(|f| f.waiver.is_some()).count() as i64;
    let status = if blocking_count > 0 { "failed" } else { "passed" };

    tx.execute(
        "UPDATE health_checks SET status = ?1 WHERE id = ?2",
        rusqlite::params![status, check_id],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    let categories = category_rollup(&findings);
    let history = run_history(conn, model_id)?;

    Ok(HealthRunResponse {
        check_id,
        model_id: model_id.to_string(),
        run_at: run_at.to_string(),
        status: status.to_string(),
        findings,
        categories,
        blocking_count,
        warning_count,
        waived_count,
        history,
    })
}

/// `health.run` — session scope. Read-only over Model data; the run itself is stored, which
/// is system-computed evidence (like `alerts.list` firing rules), not a user mutation, so it
/// writes no audit event. It therefore only requires an unlocked session and works in
/// read-only mode — an auditor must be able to check a Model they cannot edit.
#[tauri::command(name = "health.run", rename_all = "snake_case")]
pub fn health_run(
    app: AppHandle,
    model_id: String,
    session: State<'_, SessionState>,
) -> AppResult<HealthRunResponse> {
    let company_id = require_unlocked(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let run_at = chrono::Utc::now().to_rfc3339();
    run_health_check(&mut conn, &company_id, &model_id, &run_at)
}

/// Record a waiver against a finding. Pure over an open connection; the caller supplies the
/// audit hash inputs so the HMAC key never leaves the command layer.
fn insert_waiver(
    tx: &rusqlite::Transaction<'_>,
    company_id: &str,
    finding_id: &str,
    reason: &str,
    actor: &str,
    now: &str,
    key: &[u8],
) -> AppResult<i64> {
    let waiver_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO waivers (id, finding_id, reason, created_at, actor)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![waiver_id, finding_id, reason, now, actor],
    )
    .map_err(AppError::from)?;

    let after_json = serde_json::json!({
        "action": "health.waive",
        "waiver_id": waiver_id,
        "finding_id": finding_id,
        "reason": reason,
        "actor": actor,
        "created_at": now,
    })
    .to_string();
    let prev = audited_hash(tx, company_id).map_err(AppError::from)?;
    let hash = next_hash(key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events
           (company_id, actor, action, object_type, object_id, before_json, after_json,
            prev_hash, hash, created_at)
         VALUES (?1, ?2, 'health.waive', 'health_finding', ?3, NULL, ?4, ?5, ?6, ?7)",
        rusqlite::params![company_id, actor, finding_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;
    Ok(tx.last_insert_rowid())
}

/// `health.waive` — `{finding_id, reason}` → `{waived}`. Company-write scope: waiving is a
/// governance decision, so read-only mode and a locked session both refuse it.
#[tauri::command(name = "health.waive", rename_all = "snake_case")]
pub fn health_waive(
    app: AppHandle,
    finding_id: String,
    reason: String,
    session: State<'_, SessionState>,
) -> AppResult<HealthWaiveResponse> {
    let company_id = require_session_write(&session)?;
    let trimmed = reason.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::health_waiver_reason_required());
    }

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    // The finding must belong to a Model of the unlocked Company.
    let owned: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM health_findings hf
                JOIN health_checks hc ON hc.id = hf.check_id
                JOIN models m ON m.id = hc.model_id
                WHERE hf.id = ?1 AND m.company_id = ?2
             )",
            rusqlite::params![finding_id, company_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if !owned {
        return Err(AppError::invalid(
            "VALUE_INVALID: finding_id is not a Health Check finding of the unlocked Company",
        ));
    }

    let already: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM waivers WHERE finding_id = ?1)",
            rusqlite::params![finding_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if already {
        return Err(AppError::invalid(
            "WAIVER_ALREADY_RECORDED: this finding already carries a waiver; re-run the Health Check to review it",
        ));
    }

    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(AppError::from)?;
    let audit_id = insert_waiver(&tx, &company_id, &finding_id, &trimmed, "owner", &now, &key)?;
    tx.commit().map_err(AppError::from)?;

    Ok(HealthWaiveResponse {
        waived: true,
        finding_id,
        audit_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMPANY: &str = "c-health";
    const MODEL: &str = "m-health";

    /// In-memory Company with a Model, one draft Scenario, two Fiscal Periods and a
    /// balanced committed GL. Every check below starts from this clean baseline and the
    /// test then introduces exactly one defect.
    fn fixture() -> Connection {
        let mut conn = db::open_in_memory().expect("db");
        let tx = conn.transaction().expect("tx");
        tx.execute_batch(
            r#"
            INSERT INTO companies
              (id, name, type, default_currency_code, base_locale, pack_schema_version,
               company_file_path, created_at, updated_at)
            VALUES ('c-health','Health Co','single','USD','en-US','1.0.0','/tmp/health.fpa',
                    '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
            INSERT INTO fiscal_calendars (id, company_id, name, preset, fy_start_month, week_start_day)
            VALUES ('cal-1','c-health','Standard 12M','12month',1,1);
            INSERT INTO fiscal_years (id, calendar_id, fy_label, start_date, end_date, week_count)
            VALUES ('fy-1','cal-1','FY26','2026-01-01','2026-12-31',52);
            INSERT INTO fiscal_periods (id, fiscal_year_id, period_no, code, start_date, end_date)
            VALUES ('p-01','fy-1',1,'P01','2026-01-01','2026-01-31'),
                   ('p-02','fy-1',2,'P02','2026-02-01','2026-02-28');
            INSERT INTO accounts (id, company_id, code, name, account_type, report_section, active)
            VALUES ('acc-rev','c-health','4000','Revenue','revenue','revenue',1),
                   ('acc-cash','c-health','1000','Cash','asset','current_assets',1),
                   ('acc-old','c-health','4999','Retired','revenue','revenue',0);
            INSERT INTO packs (id, key, name, version, schema_version, source_checksum, installed_at)
            VALUES ('pack-1','saas','SaaS','1.0.0','1.0.0','sha','2026-01-01T00:00:00Z');
            INSERT INTO models (id, company_id, name, horizon, status, pack_id)
            VALUES ('m-health','c-health','Main','1y','active','pack-1');
            INSERT INTO scenarios (id, model_id, name, kind, state, baseline)
            VALUES ('sc-1','m-health','Budget','budget','draft',1);
            INSERT INTO model_sheets (id, model_id, name, sheet_type, sort_order)
            VALUES ('sh-1','m-health','P&L','formula',1);
            INSERT INTO model_lines (id, sheet_id, account_id, method, format, decimals, sort_order)
            VALUES ('ln-rev','sh-1','acc-rev','manual','money',2,1);
            INSERT INTO model_values (id, line_id, scenario_id, period_id, amount_minor, computed)
            VALUES ('mv-1','ln-rev','sc-1','p-01',100000,0),
                   ('mv-2','ln-rev','sc-1','p-02',110000,0);
            INSERT INTO import_batches
              (id, company_id, kind, source_name, source_hash, mapping_version, status,
               row_count, tie_out_status, created_at)
            VALUES ('b-1','c-health','gl_dump','Jan','sha','v1','committed',2,'pass','2026-02-01T00:00:00Z');
            INSERT INTO gl_lines
              (id, company_id, batch_id, period_id, account_id, dims_json, amount_minor,
               currency_code, line_no)
            VALUES ('gl-1','c-health','b-1','p-01','acc-cash','{}',100000,'USD',1),
                   ('gl-2','c-health','b-1','p-01','acc-rev','{}',-100000,'USD',2);
            "#,
        )
        .expect("seed");
        tx.commit().expect("commit");
        conn
    }

    fn run(conn: &mut Connection) -> HealthRunResponse {
        run_health_check(conn, COMPANY, MODEL, "2026-03-01T00:00:00Z").expect("run")
    }

    fn categories_of(report: &HealthRunResponse, category: &str) -> Vec<HealthFinding> {
        report
            .findings
            .iter()
            .filter(|f| f.category == category)
            .cloned()
            .collect()
    }

    #[test]
    fn clean_model_passes_with_no_findings() {
        let mut conn = fixture();
        let report = run(&mut conn);
        assert_eq!(report.findings, vec![]);
        assert_eq!(report.status, "passed");
        assert_eq!(report.blocking_count, 0);
        assert_eq!(report.categories.len(), 5);
        assert!(report.categories.iter().all(|c| c.status == "passed"));
    }

    #[test]
    fn the_five_categories_are_always_reported_in_the_documented_order() {
        let mut conn = fixture();
        let report = run(&mut conn);
        let order: Vec<&str> = report.categories.iter().map(|c| c.category.as_str()).collect();
        assert_eq!(order, HEALTH_CATEGORIES.to_vec());
    }

    #[test]
    fn unbalanced_committed_gl_is_a_hard_tie_out_finding() {
        let mut conn = fixture();
        conn.execute(
            "INSERT INTO gl_lines (id, company_id, batch_id, period_id, account_id, dims_json,
                                   amount_minor, currency_code, line_no)
             VALUES ('gl-3','c-health','b-1','p-02','acc-cash','{}',5,'USD',3)",
            [],
        )
        .unwrap();
        let report = run(&mut conn);
        let tie = categories_of(&report, "tie_out");
        assert_eq!(tie.len(), 1);
        assert_eq!(tie[0].severity, "hard");
        assert_eq!(tie[0].entity_ref.as_deref(), Some("period:p-02"));
        assert!(tie[0].message.contains("= 5 minor units"));
        assert_eq!(report.status, "failed");
        assert_eq!(report.blocking_count, 1);
    }

    #[test]
    fn excluded_rows_and_uncommitted_batches_never_break_the_tie_out() {
        let mut conn = fixture();
        conn.execute_batch(
            "INSERT INTO import_batches
               (id, company_id, kind, source_name, source_hash, mapping_version, status,
                row_count, tie_out_status, created_at)
             VALUES ('b-2','c-health','gl_dump','Draft','sha','v1','validated',1,'pass','2026-02-02T00:00:00Z');
             INSERT INTO gl_lines (id, company_id, batch_id, period_id, account_id, dims_json,
                                   amount_minor, currency_code, is_excluded, line_no)
             VALUES ('gl-4','c-health','b-1','p-01','acc-cash','{}',999,'USD',1,4),
                    ('gl-5','c-health','b-2','p-01','acc-cash','{}',777,'USD',0,1);",
        )
        .unwrap();
        assert_eq!(categories_of(&run(&mut conn), "tie_out"), vec![]);
    }

    #[test]
    fn a_committed_batch_with_a_failed_tie_out_is_reported() {
        let mut conn = fixture();
        conn.execute(
            "UPDATE import_batches SET tie_out_status = 'fail' WHERE id = 'b-1'",
            [],
        )
        .unwrap();
        let tie = categories_of(&run(&mut conn), "tie_out");
        assert_eq!(tie.len(), 1);
        assert_eq!(tie[0].entity_ref.as_deref(), Some("batch:b-1"));
    }

    #[test]
    fn unsupported_formula_is_a_hard_reference_finding_pointing_at_the_cell() {
        let mut conn = fixture();
        conn.execute(
            "UPDATE model_values SET formula = '=LAMBDA(x, x)' WHERE id = 'mv-1'",
            [],
        )
        .unwrap();
        let refs = categories_of(&run(&mut conn), "reference");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].severity, "hard");
        assert_eq!(
            refs[0].entity_ref.as_deref(),
            Some("cell:ln-rev:sc-1:p-01")
        );
    }

    #[test]
    fn a_supported_formula_is_never_flagged() {
        let mut conn = fixture();
        conn.execute(
            "UPDATE model_values SET formula = '=SUM(C2:C13)' WHERE id = 'mv-1'",
            [],
        )
        .unwrap();
        assert_eq!(categories_of(&run(&mut conn), "reference"), vec![]);
    }

    #[test]
    fn inactive_account_and_missing_driver_are_hard_reference_findings() {
        let mut conn = fixture();
        conn.execute_batch(
            "UPDATE model_lines SET account_id = 'acc-old' WHERE id = 'ln-rev';
             INSERT INTO model_lines (id, sheet_id, method, format, decimals, sort_order)
             VALUES ('ln-drv','sh-1','driver','number',2,2);",
        )
        .unwrap();
        let refs = categories_of(&run(&mut conn), "reference");
        assert_eq!(refs.len(), 2);
        assert!(refs.iter().all(|f| f.severity == "hard"));
        assert!(refs.iter().any(|f| f.message.contains("missing or inactive")));
        assert!(refs.iter().any(|f| f.message.contains("references no Driver")));
    }

    #[test]
    fn a_money_cell_without_exact_minor_units_is_a_hard_rounding_finding() {
        let mut conn = fixture();
        conn.execute(
            "UPDATE model_values SET amount_minor = NULL, amount_text = '1,000.005' WHERE id = 'mv-1'",
            [],
        )
        .unwrap();
        let rounding = categories_of(&run(&mut conn), "rounding");
        assert_eq!(rounding.len(), 1);
        assert_eq!(rounding[0].severity, "hard");
        assert_eq!(
            rounding[0].entity_ref.as_deref(),
            Some("cell:ln-rev:sc-1:p-01")
        );
    }

    #[test]
    fn decimals_disagreeing_with_the_currency_scale_warn_once_per_line() {
        let mut conn = fixture();
        conn.execute("UPDATE model_lines SET decimals = 0 WHERE id = 'ln-rev'", [])
            .unwrap();
        let rounding = categories_of(&run(&mut conn), "rounding");
        assert_eq!(rounding.len(), 1, "two cells, one line ⇒ one warning");
        assert_eq!(rounding[0].severity, "warn");
        assert_eq!(rounding[0].entity_ref.as_deref(), Some("line:ln-rev"));
        assert_eq!(run(&mut conn).blocking_count, 0, "a warning never blocks");
    }

    #[test]
    fn a_driver_line_missing_feeds_reports_the_exact_missing_count() {
        let mut conn = fixture();
        conn.execute_batch(
            "INSERT INTO drivers (id, model_id, name, driver_type, source)
             VALUES ('drv-1','m-health','Units','volume_x_rate','global');
             INSERT INTO model_lines (id, sheet_id, driver_id, method, format, decimals, sort_order)
             VALUES ('ln-drv','sh-1','drv-1','driver','number',2,2);
             INSERT INTO driver_values (id, driver_id, scenario_id, period_id, value_decimal)
             VALUES ('dv-1','drv-1','sc-1','p-01','10');",
        )
        .unwrap();
        let feeds = categories_of(&run(&mut conn), "driver_feed");
        assert_eq!(feeds.len(), 1);
        assert_eq!(feeds[0].severity, "hard");
        assert!(feeds[0].message.contains("1 of 2"));
        assert_eq!(feeds[0].entity_ref.as_deref(), Some("driver:drv-1"));
    }

    #[test]
    fn a_fully_fed_driver_reports_nothing() {
        let mut conn = fixture();
        conn.execute_batch(
            "INSERT INTO drivers (id, model_id, name, driver_type, source)
             VALUES ('drv-1','m-health','Units','volume_x_rate','global');
             INSERT INTO model_lines (id, sheet_id, driver_id, method, format, decimals, sort_order)
             VALUES ('ln-drv','sh-1','drv-1','driver','number',2,2);
             INSERT INTO driver_values (id, driver_id, scenario_id, period_id, value_decimal)
             VALUES ('dv-1','drv-1','sc-1','p-01','10'),('dv-2','drv-1','sc-1','p-02','11');",
        )
        .unwrap();
        assert_eq!(categories_of(&run(&mut conn), "driver_feed"), vec![]);
    }

    #[test]
    fn out_of_bounds_driver_and_assumption_values_warn_and_are_not_changed() {
        let mut conn = fixture();
        conn.execute_batch(
            "INSERT INTO drivers (id, model_id, name, driver_type, source, bounds_low, bounds_high)
             VALUES ('drv-1','m-health','Churn','ratio','global','0','0.1');
             INSERT INTO driver_values (id, driver_id, scenario_id, period_id, value_decimal)
             VALUES ('dv-1','drv-1','sc-1','p-01','0.42');
             INSERT INTO assumptions (id, model_id, name, owner, bounds_low, bounds_high)
             VALUES ('as-1','m-health','Wage inflation','cfo','0','0.2');
             INSERT INTO assumption_values (id, assumption_id, period_id, value_decimal)
             VALUES ('av-1','as-1','p-01','0.90');",
        )
        .unwrap();
        let anomalies = categories_of(&run(&mut conn), "anomaly");
        assert_eq!(anomalies.len(), 2);
        assert!(anomalies.iter().all(|f| f.severity == "warn"));
        let stored: String = conn
            .query_row(
                "SELECT value_decimal FROM driver_values WHERE id = 'dv-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, "0.42", "an anomaly is never auto-adjusted");
    }

    #[test]
    fn an_abrupt_period_swing_warns_but_a_moderate_one_does_not() {
        let mut conn = fixture();
        // 100000 → 110000 in the fixture is well inside the factor: nothing yet.
        assert_eq!(categories_of(&run(&mut conn), "anomaly"), vec![]);
        conn.execute(
            "UPDATE model_values SET amount_minor = 900000 WHERE id = 'mv-2'",
            [],
        )
        .unwrap();
        let anomalies = categories_of(&run(&mut conn), "anomaly");
        assert_eq!(anomalies.len(), 1);
        assert_eq!(anomalies[0].severity, "warn");
        assert_eq!(
            anomalies[0].entity_ref.as_deref(),
            Some("cell:ln-rev:sc-1:p-02")
        );
    }

    #[test]
    fn a_swing_away_from_zero_is_not_guessed_at() {
        let mut conn = fixture();
        conn.execute(
            "UPDATE model_values SET amount_minor = 0 WHERE id = 'mv-1'",
            [],
        )
        .unwrap();
        assert_eq!(categories_of(&run(&mut conn), "anomaly"), vec![]);
    }

    #[test]
    fn every_run_is_persisted_and_surfaced_as_history_newest_first() {
        let mut conn = fixture();
        let first = run_health_check(&mut conn, COMPANY, MODEL, "2026-03-01T00:00:00Z").unwrap();
        let second = run_health_check(&mut conn, COMPANY, MODEL, "2026-03-02T00:00:00Z").unwrap();
        assert_ne!(first.check_id, second.check_id);
        assert_eq!(second.history.len(), 2);
        assert_eq!(second.history[0].check_id, second.check_id);
        assert_eq!(second.history[1].check_id, first.check_id);
        let persisted: i64 = conn
            .query_row("SELECT COUNT(*) FROM health_checks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(persisted, 2);
    }

    #[test]
    fn a_waiver_clears_the_block_but_leaves_the_finding_visible_after_a_rerun() {
        let mut conn = fixture();
        conn.execute(
            "INSERT INTO gl_lines (id, company_id, batch_id, period_id, account_id, dims_json,
                                   amount_minor, currency_code, line_no)
             VALUES ('gl-3','c-health','b-1','p-02','acc-cash','{}',5,'USD',3)",
            [],
        )
        .unwrap();
        let first = run(&mut conn);
        assert_eq!(first.blocking_count, 1);
        let finding_id = first.findings[0].id.clone();

        let tx = conn.transaction().unwrap();
        insert_waiver(
            &tx,
            COMPANY,
            &finding_id,
            "Known 5-minor rounding in the legacy Jan feed; fixed at source next close.",
            "owner",
            "2026-03-01T01:00:00Z",
            b"test-key",
        )
        .unwrap();
        tx.commit().unwrap();

        let second = run_health_check(&mut conn, COMPANY, MODEL, "2026-03-02T00:00:00Z").unwrap();
        assert_eq!(second.findings.len(), 1, "the finding is still shown");
        let carried = second.findings[0].waiver.as_ref().expect("waiver carried");
        assert_eq!(carried.actor, "owner");
        assert_eq!(carried.created_at, "2026-03-01T01:00:00Z");
        assert!(carried.reason.starts_with("Known 5-minor rounding"));
        assert_eq!(second.blocking_count, 0);
        assert_eq!(second.waived_count, 1);
        assert_eq!(second.status, "passed");
    }

    #[test]
    fn waiving_writes_exactly_one_audit_event_carrying_the_reason() {
        let mut conn = fixture();
        conn.execute(
            "INSERT INTO gl_lines (id, company_id, batch_id, period_id, account_id, dims_json,
                                   amount_minor, currency_code, line_no)
             VALUES ('gl-3','c-health','b-1','p-02','acc-cash','{}',5,'USD',3)",
            [],
        )
        .unwrap();
        let finding_id = run(&mut conn).findings[0].id.clone();
        let tx = conn.transaction().unwrap();
        insert_waiver(
            &tx,
            COMPANY,
            &finding_id,
            "Signed off by the Controller.",
            "owner",
            "2026-03-01T01:00:00Z",
            b"test-key",
        )
        .unwrap();
        tx.commit().unwrap();

        let (action, after): (String, String) = conn
            .query_row(
                "SELECT action, after_json FROM audit_events WHERE company_id = ?1",
                rusqlite::params![COMPANY],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(action, "health.waive");
        assert!(after.contains("Signed off by the Controller."));
        let events: i64 = conn
            .query_row("SELECT COUNT(*) FROM audit_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 1);

        // The carry-forward on the next run re-states the decision; it mints no new event.
        run_health_check(&mut conn, COMPANY, MODEL, "2026-03-02T00:00:00Z").unwrap();
        let events_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM audit_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events_after, 1);
    }

    #[test]
    fn a_model_of_another_company_is_refused() {
        let mut conn = fixture();
        let err = run_health_check(&mut conn, "c-other", MODEL, "2026-03-01T00:00:00Z")
            .expect_err("cross-company");
        assert_eq!(err.body().code, "VALUE_INVALID");
        assert_eq!(err.body().http_status, 422);
    }

    #[test]
    fn the_waiver_reason_error_matches_the_documented_catalog_row() {
        let body = AppError::health_waiver_reason_required().body();
        assert_eq!(body.code, "HEALTH_WAIVER_REASON_REQUIRED");
        assert_eq!(body.user_message, "A waiver reason is required.");
        assert_eq!(body.http_status, 422);
        assert!(!body.retryable);
    }

    #[test]
    fn the_export_gate_error_binds_the_unwaived_count() {
        let body = AppError::health_check_blocked(3).body();
        assert_eq!(body.code, "HEALTH_CHECK_BLOCKED");
        assert_eq!(
            body.user_message,
            "Export blocked by 3 Health Check findings. Fix or waive (reason required)."
        );
        assert_eq!(body.http_status, 422);
        assert!(!body.retryable);
    }

    #[test]
    fn fingerprints_separate_findings_that_differ_in_any_component() {
        let base = DraftFinding::hard("tie_out", "m".into(), Some("period:p-01".into()));
        let other_ref = DraftFinding::hard("tie_out", "m".into(), Some("period:p-02".into()));
        let other_sev = DraftFinding::warn("tie_out", "m".into(), Some("period:p-01".into()));
        assert_ne!(base.fingerprint(), other_ref.fingerprint());
        assert_ne!(base.fingerprint(), other_sev.fingerprint());
        assert_eq!(base.fingerprint(), base.clone().fingerprint());
    }
}
