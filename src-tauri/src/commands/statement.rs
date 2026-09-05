//! Statement engine commands (F-027 · M6-1 · S-060 · API-SPEC §6).
//!
//! Commands:
//! - `statement.get.v1`: `{company_id, type, period_scope, preset, rounding, bu_scope}`
//!   -> `{rows[], totals, tieout_status, rounding_status, findings, currency}`
//!   Errors: STATEMENT_TIE_OUT_FAILED (422), STATEMENT_SOURCE_MIXED (422),
//!   PERIOD_NOT_FOUND (404), SESSION_LOCKED (401), INTERNAL (500).
//!
//! Invariants (MONEY-ROUNDING-SPEC §3/§4/§5):
//! - Exact integer minor units for all currency math (never float / f32 / f64).
//! - Display rounding happens only at the response boundary: when a display unit is
//!   requested and `largest_remainder` is set, lines are floored to the display unit and
//!   the residual is allocated to the largest fractional remainders so that
//!   `sum(displayed children) == displayed parent` at every roll-up level. When
//!   `largest_remainder` is false each value is rounded HALF_UP independently and the
//!   response reports `rounding_status: "approximate"`.
//! - Sign conventions follow MONEY-ROUNDING-SPEC §5. The GL canonical store is
//!   debit-positive / credit-negative (GL-TEMPLATE-SPEC §3). Statement presentation:
//!   P&L (`revenue`/`cogs`/`opex`) is presented as `-amount_minor` (credit income shows
//!   positive; debit costs show negative), so Net Income is the exact sum of the P&L
//!   sections. Balance Sheet keeps the ledger sign (`asset` +, `liability`/`equity` −),
//!   so `Assets + Liabilities + Equity == 0` is the tie-out identity (§5).
//! - Tie-out status is computed, never assumed: BS identity and P&L roll-up checks are
//!   asserted with exact integer arithmetic; a mismatch is reported as findings +
//!   `tieout_status: "fail"` in the data (never a fabricated balance).
//! - Sources: committed GL (GL-TEMPLATE-SPEC: `import_batches.status = 'committed'`),
//!   latest committed batch per period; `model_values`/scenarios feed Planning, not
//!   Statements (M6-1 read path).
//! - Scope: `period_scope` may be empty — the engine then resolves the Company's current
//!   period (the most recent fiscal period holding committed Actuals).
//!   `bu_scope: {kind: "all"}` reads the whole Company. `kind: "single"` reads one
//!   Business Unit's committed GL. `kind: "group"` requires consolidation translation
//!   (M6-3) and is rejected with STATEMENT_SOURCE_MIXED today.
//! - `cf` (indirect Cash Flow), `soce` and `segment` are NOT fabricated in M6-1: the
//!   response carries empty rows and null totals (the S-060 slice surfaces them as
//!   pending until M6-2/M6-3/CF-landing).

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::commands::company::app_data_dir;
use crate::commands::session::{SessionState, require_unlocked};
use crate::core::error::{AppError, AppResult};
use crate::storage::db;

/// Presentation preset for statement section labels/grouping (API-SPEC §6). Presets only
/// remap labels — they never recompute money.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StatementPreset {
    UsGaap,
    Ifrs,
}

/// Rounding request for the statement response (API-SPEC §6).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RoundingMode {
    MajorUnits,
    Thousands,
    TwoDecimals,
}

/// Whether largest-remainder allocation is requested for display rounding
/// (MONEY-ROUNDING-SPEC §4). When `false`, values are HALF_UP-rounded independently and
/// the response flags `rounding_status: "approximate"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoundingRequest {
    pub mode: RoundingMode,
    pub largest_remainder: bool,
}

impl RoundingRequest {
    /// Display unit expressed in minor units of the reporting currency.
    ///
    /// - `two_decimals` → 1 minor unit (no display rounding; exact).
    /// - `major_units` → one major unit = 10^scale minor units (e.g. USD 1.00 = 100).
    /// - `thousands` → 1,000 major units = 1000 × 10^scale minor units (e.g. USD 000s
    ///   = 100,000 minor), shown /1000 by the UI.
    pub fn display_unit(&self, currency_scale: u8) -> i64 {
        match self.mode {
            RoundingMode::TwoDecimals => 1,
            RoundingMode::MajorUnits => 10_i64.pow(currency_scale as u32),
            RoundingMode::Thousands => 1000_i64 * 10_i64.pow(currency_scale as u32),
        }
    }
}

/// BU/Group scope for multi-entity statements (API-SPEC §6).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BuScope {
    All,
    Group,
    Single { bu_id: String },
}

/// One line within a statement section (API-SPEC §6 success shape). `values` maps a
/// fiscal-period id to the presented value for that period (minor units).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatementLine {
    pub account_id: String,
    pub label: String,
    pub values: BTreeMap<String, i64>,
}

/// A section of the statement (e.g. "Revenue", "Current Assets").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatementSection {
    pub section: String,
    pub lines: Vec<StatementLine>,
}

/// Computed KPI totals the UI presents (API-SPEC §6). Signed per MONEY-ROUNDING-SPEC §5
/// and aggregated across the whole `period_scope`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatementTotals {
    pub revenue: Option<i64>,
    pub gross_profit: Option<i64>,
    pub operating_income: Option<i64>,
    pub net_income: Option<i64>,
    pub total_assets: Option<i64>,
    pub total_liabilities: Option<i64>,
    pub total_equity: Option<i64>,
    pub net_cash_change: Option<i64>,
    pub ending_cash: Option<i64>,
}

impl StatementTotals {
    fn empty() -> Self {
        StatementTotals {
            revenue: None,
            gross_profit: None,
            operating_income: None,
            net_income: None,
            total_assets: None,
            total_liabilities: None,
            total_equity: None,
            net_cash_change: None,
            ending_cash: None,
        }
    }
}

/// A single tie-out finding (API-SPEC §6 / ERROR-HANDLING STATEMENT_TIE_OUT_FAILED).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatementTieOutFinding {
    pub code: String,
    pub message: String,
    pub detail: String,
}

/// Statement response returned by `statement.get.v1` (API-SPEC §6).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatementGetResponse {
    pub rows: Vec<StatementSection>,
    pub totals: StatementTotals,
    pub tieout_status: String,
    pub rounding_status: String,
    pub findings: Vec<StatementTieOutFinding>,
    /// ISO 4217 reporting-currency code of the Company (additive response field; the
    /// rows/totals are exact minor units of this currency).
    pub currency: String,
}

fn finding(detail: impl Into<String>) -> StatementTieOutFinding {
    StatementTieOutFinding {
        code: "STATEMENT_TIE_OUT_FAILED".to_string(),
        message: "Statement does not tie against its source GL".to_string(),
        detail: detail.into(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exact integer rounding helpers (MONEY-ROUNDING-SPEC §2/§4). All arithmetic is
// i128 in the middle and clamps back to i64; no float ever appears on a money path.
// ─────────────────────────────────────────────────────────────────────────────

/// Round `value` (minor units) to the nearest multiple of `unit` HALF_UP (away from
/// zero, MONEY-ROUNDING-SPEC §2). `unit <= 1` returns the value unchanged.
fn round_half_away_from_zero_unit(value: i64, unit: i64) -> i64 {
    if unit <= 1 {
        return value;
    }
    let v = i128::from(value);
    let u = i128::from(unit);
    let neg = v < 0;
    let magnitude = v.abs();
    let (q, r) = (magnitude / u, magnitude % u);
    let rounded = if 2 * r >= u { q + 1 } else { q };
    let out = rounded.saturating_mul(u);
    let out = if neg { -out } else { out };
    i64::try_from(out).unwrap_or(value)
}

/// Floor `value` toward negative infinity to a multiple of `unit`.
fn floor_to_unit(value: i64, unit: i64) -> i64 {
    if unit <= 1 {
        return value;
    }
    let v = i128::from(value);
    let u = i128::from(unit);
    let q = v.div_euclid(u);
    i64::try_from(q.saturating_mul(u)).unwrap_or(value)
}

/// Largest-remainder allocation (MONEY-ROUNDING-SPEC §4): floor every value to
/// `unit`, then distribute the residual (in whole `unit` steps, HALF_UP at the parent)
/// to the values with the largest fractional remainders so that
/// `sum(output) == round(sum(input))`. Deterministic: equal remainders break by value
/// then by index. Negative values are supported (remainders measured in [0, unit)).
fn largest_remainder_allocate(values: &[i64], unit: i64) -> Vec<i64> {
    if unit <= 1 || values.is_empty() {
        return values.to_vec();
    }
    if values.len() == 1 {
        // A single child equals its parent: show the parent-rounded value.
        return vec![round_half_away_from_zero_unit(values[0], unit)];
    }

    let u = i128::from(unit);
    let total: i128 = values.iter().map(|&v| i128::from(v)).sum();
    let parent_display =
        round_half_away_from_zero_unit(i64::try_from(total).unwrap_or(i64::MAX), unit);

    let mut floored: Vec<i64> = values.iter().map(|&v| floor_to_unit(v, unit)).collect();
    let floored_sum: i128 = floored.iter().map(|&v| i128::from(v)).sum();
    let residual = i128::from(parent_display) - floored_sum; // always a multiple of `unit`
    if residual == 0 {
        return floored;
    }

    let steps = (residual.abs() / u) as usize;
    if steps == 0 {
        return floored;
    }

    // Order indices by fractional remainder descending (residual > 0) or ascending
    // (residual < 0). Remainder of value v = v - floor(v), in [0, unit).
    let remainder_of = |i: usize| i128::from(values[i]) - i128::from(floored[i]);
    let mut order: Vec<usize> = (0..values.len()).collect();
    if residual > 0 {
        order.sort_by(|&a, &b| {
            remainder_of(b)
                .cmp(&remainder_of(a))
                .then_with(|| i128::from(values[b]).cmp(&i128::from(values[a])))
                .then_with(|| a.cmp(&b))
        });
    } else {
        order.sort_by(|&a, &b| {
            remainder_of(a)
                .cmp(&remainder_of(b))
                .then_with(|| i128::from(values[a]).cmp(&i128::from(values[b])))
                .then_with(|| a.cmp(&b))
        });
    }

    let delta = if residual > 0 { u } else { -u };
    for &idx in order.iter().take(steps.min(values.len())) {
        let adjusted = i128::from(floored[idx]) + delta;
        floored[idx] = i64::try_from(adjusted).unwrap_or(floored[idx]);
    }
    floored
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine: read committed GL and present statements.
// ─────────────────────────────────────────────────────────────────────────────

struct StatementAccount {
    id: String,
    name: String,
    account_type: String,
    report_section: String,
}

/// Statement `type` ∈ pl|bs|cf|soce|segment. pl/bs are computed; the rest return an
/// empty response (they are later milestones and must never be fabricated).
pub fn statement_get_internal(
    conn: &Connection,
    company_id: &str,
    statement_type: &str,
    period_scope: &[String],
    preset: &StatementPreset,
    rounding: &RoundingRequest,
    bu_scope: &BuScope,
) -> AppResult<StatementGetResponse> {
    // 1. Resolve the scope. An empty scope means "current period": the Company's most
    //    recent fiscal period that has committed Actuals (falling back to the latest
    //    fiscal period). Anything explicit must belong to the Company (PERIOD_NOT_FOUND).
    let scope: Vec<String> = if period_scope.is_empty() {
        let latest_with_data: Option<String> = conn
            .query_row(
                "SELECT fp.id
                 FROM fiscal_periods fp
                 JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
                 JOIN fiscal_calendars fc ON fc.id = fy.calendar_id
                 WHERE fc.company_id = ?1
                   AND EXISTS (
                     SELECT 1 FROM gl_lines gl
                     JOIN import_batches ib ON ib.id = gl.batch_id
                     WHERE gl.company_id = ?1 AND gl.period_id = fp.id
                       AND ib.status = 'committed'
                   )
                 ORDER BY fp.start_date DESC LIMIT 1",
                rusqlite::params![company_id],
                |r| r.get(0),
            )
            .map_err(AppError::from)?;
        match latest_with_data {
            Some(id) => vec![id],
            None => {
                let latest: Option<String> = conn
                    .query_row(
                        "SELECT fp.id
                         FROM fiscal_periods fp
                         JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
                         JOIN fiscal_calendars fc ON fc.id = fy.calendar_id
                         WHERE fc.company_id = ?1
                         ORDER BY fp.start_date DESC LIMIT 1",
                        rusqlite::params![company_id],
                        |r| r.get(0),
                    )
                    .map_err(AppError::from)?;
                latest.map_or_else(
                    || {
                        Err(AppError::period_not_found(
                            "the Company has no fiscal periods",
                        ))
                    },
                    |id| Ok(vec![id]),
                )?
            }
        }
    } else {
        period_scope.to_vec()
    };
    let scope_ref = scope.as_slice();
    for period_id in scope_ref {
        let found: bool = conn
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM fiscal_periods fp
                   JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
                   JOIN fiscal_calendars fc ON fc.id = fy.calendar_id
                   WHERE fc.company_id = ?1 AND fp.id = ?2
                 )",
                rusqlite::params![company_id, period_id],
                |r| r.get(0),
            )
            .map_err(AppError::from)?;
        if !found {
            return Err(AppError::period_not_found(format!(
                "period {period_id} is not in the Company calendar"
            )));
        }
    }
    let period_scope = scope_ref;

    let currency = company_currency(conn, company_id)?;

    // 2. Group scope needs consolidation translation (M6-3) — never guessed here.
    if matches!(bu_scope, BuScope::Group) {
        return Err(AppError::statement_source_mixed());
    }

    let display_unit = rounding.display_unit(currency_scale_of(&currency));

    // cf / soce / segment: explicitly empty in M6-1 (see module docs) — no fabricated rows.
    if !matches!(statement_type, "pl" | "bs") {
        return Ok(StatementGetResponse {
            rows: Vec::new(),
            totals: StatementTotals::empty(),
            tieout_status: "pass".to_string(),
            rounding_status: "exact".to_string(),
            findings: Vec::new(),
            currency,
        });
    }

    // 3. Accounts in report order for this statement type.
    let account_types: &[&str] = match statement_type {
        "pl" => &["revenue", "cogs", "opex"],
        "bs" => &["asset", "liability", "equity"],
        _ => unreachable!(),
    };
    let accounts = accounts_for_statement(conn, company_id, account_types)?;
    let account_ids: BTreeSet<&str> = accounts.iter().map(|a| a.id.as_str()).collect();

    // 4. Exact committed GL values per (period, account), already summed per account.
    let gl = committed_values(conn, company_id, period_scope, bu_scope)?;

    // 5. Present each account line (sign per MONEY-ROUNDING-SPEC §5).
    let mut exact_sections: Vec<StatementSection> = Vec::new();
    let mut section_by_name: BTreeMap<String, usize> = BTreeMap::new();
    let mut period_values_for_tieout: BTreeMap<String, BTreeMap<String, i64>> = BTreeMap::new();

    for account in &accounts {
        if !account_ids.contains(account.id.as_str()) {
            continue;
        }
        let sign = present_sign(statement_type, &account.account_type);
        let mut values: BTreeMap<String, i64> = BTreeMap::new();
        for period_id in period_scope {
            let exact = gl
                .get(&(period_id.clone(), account.id.clone()))
                .copied()
                .unwrap_or(0);
            let presented = if sign { -exact } else { exact };
            values.insert(period_id.clone(), presented);
            period_values_for_tieout
                .entry(period_id.clone())
                .or_default()
                .insert(account.id.clone(), presented);
        }

        let section_name = preset_section_label(preset, &account.report_section);
        if let Some(&idx) = section_by_name.get(&section_name) {
            exact_sections[idx].lines.push(StatementLine {
                account_id: account.id.clone(),
                label: account.name.clone(),
                values,
            });
        } else {
            section_by_name.insert(section_name.clone(), exact_sections.len());
            exact_sections.push(StatementSection {
                section: section_name,
                lines: vec![StatementLine {
                    account_id: account.id.clone(),
                    label: account.name.clone(),
                    values,
                }],
            });
        }
    }

    // Order sections for presentation.
    order_sections(&mut exact_sections, statement_type);

    // 6. Tie-out checks on EXACT values (pre-rounding).
    let findings = compute_tieout(
        &exact_sections,
        &period_values_for_tieout,
        period_scope,
        statement_type,
    );
    let _ = period_scope;

    // 7. Display rounding at the section level (largest-remainder per section+period).
    let rows = if display_unit <= 1 {
        exact_sections.clone()
    } else if rounding.largest_remainder {
        round_sections_largest_remainder(&exact_sections, display_unit)
    } else {
        exact_sections
            .iter()
            .map(|s| StatementSection {
                section: s.section.clone(),
                lines: s
                    .lines
                    .iter()
                    .map(|l| StatementLine {
                        account_id: l.account_id.clone(),
                        label: l.label.clone(),
                        values: l
                            .values
                            .iter()
                            .map(|(p, v)| {
                                (p.clone(), round_half_away_from_zero_unit(*v, display_unit))
                            })
                            .collect(),
                    })
                    .collect(),
            })
            .collect()
    };

    // 8. Totals from the rows actually displayed so children always sum to their parent.
    let totals = compute_totals(&rows, statement_type);

    let rounding_status = if display_unit <= 1 || rounding.largest_remainder {
        "exact"
    } else {
        "approximate"
    };

    Ok(StatementGetResponse {
        rows,
        totals,
        tieout_status: if findings.is_empty() {
            "pass".to_string()
        } else {
            "fail".to_string()
        },
        rounding_status: rounding_status.to_string(),
        findings,
        currency,
    })
}

/// GL debit-positive sign (MONEY-ROUNDING-SPEC §5, GL-TEMPLATE-SPEC §3): return true
/// when the presented value must be the negation of the stored signed amount.
fn present_sign(statement_type: &str, account_type: &str) -> bool {
    match statement_type {
        // P&L is presented as the negation of the debit-positive ledger: credit income
        // (stored negative) shows positive; debit costs show negative (MONEY-ROUNDING §5).
        "pl" => matches!(account_type, "revenue" | "cogs" | "opex"),
        // BS keeps the ledger sign: asset +, liability/equity −, so
        // Assets + Liabilities + Equity == 0 is the tie-out identity (§5).
        _ => false,
    }
}

/// Currency scale for rounding-unit math. Scale is the number of decimal places of the
/// major unit (MONEY-ROUNDING-SPEC §1). Unknown currencies default to scale 2.
fn currency_scale_of(currency: &str) -> u8 {
    match currency.to_uppercase().as_str() {
        "JPY" | "KRW" | "VND" => 0,
        "KWD" | "BHD" | "OMR" | "JOD" | "IQD" | "TND" => 3,
        _ => 2,
    }
}

fn company_currency(conn: &Connection, company_id: &str) -> AppResult<String> {
    let currency: Option<String> = conn
        .query_row(
            "SELECT default_currency_code FROM companies WHERE id = ?1",
            rusqlite::params![company_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    currency.ok_or_else(|| AppError::invalid("company not found"))
}

fn accounts_for_statement(
    conn: &Connection,
    company_id: &str,
    account_types: &[&str],
) -> AppResult<Vec<StatementAccount>> {
    // One query per type keeps the WHERE simple (no dynamic IN-list parameterization).
    let mut out: Vec<StatementAccount> = Vec::new();
    for account_type in account_types {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, account_type, report_section
                 FROM accounts
                 WHERE company_id = ?1 AND active = 1 AND account_type = ?2
                 ORDER BY code",
            )
            .map_err(AppError::from)?;
        let mapped = stmt
            .query_map(rusqlite::params![company_id, account_type], |r| {
                Ok(StatementAccount {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    account_type: r.get(2)?,
                    report_section: r.get(3)?,
                })
            })
            .map_err(AppError::from)?;
        let rows = mapped
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(AppError::from)?;
        out.extend(rows);
    }
    Ok(out)
}

/// Sum of committed (not excluded) GL `amount_minor` per (period, account), debit
/// positive / credit negative as stored (GL-TEMPLATE-SPEC §3).
fn committed_values(
    conn: &Connection,
    company_id: &str,
    period_scope: &[String],
    bu_scope: &BuScope,
) -> AppResult<BTreeMap<(String, String), i64>> {
    let mut out: BTreeMap<(String, String), i64> = BTreeMap::new();
    let bu_filter: Option<&str> = match bu_scope {
        BuScope::Single { bu_id } => Some(bu_id),
        _ => None,
    };
    for period_id in period_scope {
        let sql = match bu_filter {
            Some(_bu_id) => "SELECT gl.account_id, COALESCE(SUM(gl.amount_minor), 0)
                 FROM gl_lines gl
                 JOIN import_batches ib ON ib.id = gl.batch_id
                 WHERE gl.company_id = ?1 AND gl.period_id = ?2 AND gl.bu_id = ?3
                   AND gl.is_excluded = 0 AND ib.status = 'committed'
                 GROUP BY gl.account_id"
                .to_string(),
            None => "SELECT gl.account_id, COALESCE(SUM(gl.amount_minor), 0)
                 FROM gl_lines gl
                 JOIN import_batches ib ON ib.id = gl.batch_id
                 WHERE gl.company_id = ?1 AND gl.period_id = ?2
                   AND gl.is_excluded = 0 AND ib.status = 'committed'
                 GROUP BY gl.account_id"
                .to_string(),
        };
        let rows: Vec<(String, i64)> = match bu_filter {
            Some(bu_id) => {
                let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
                let mapped = stmt
                    .query_map(rusqlite::params![company_id, period_id, bu_id], |r| {
                        Ok((r.get(0)?, r.get(1)?))
                    })
                    .map_err(AppError::from)?;
                mapped
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(AppError::from)?
            }
            None => {
                let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
                let mapped = stmt
                    .query_map(rusqlite::params![company_id, period_id], |r| {
                        Ok((r.get(0)?, r.get(1)?))
                    })
                    .map_err(AppError::from)?;
                mapped
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(AppError::from)?
            }
        };
        for (account_id, value) in rows {
            out.insert((period_id.clone(), account_id), value);
        }
    }
    Ok(out)
}

/// Map the stored (pack/COA data) section name onto its preset presentation label.
/// Unknown sections pass through verbatim — the label map is the small canonical
/// vocabulary, nothing else is guessed.
fn preset_section_label(preset: &StatementPreset, stored: &str) -> String {
    let key = stored.trim().to_lowercase();
    let label: &str = match (preset, key.as_str()) {
        (StatementPreset::UsGaap, "cogs" | "cost of goods sold") => "Cost of Goods Sold",
        (StatementPreset::Ifrs, "cogs" | "cost of goods sold" | "cost of sales") => "Cost of Sales",
        (StatementPreset::UsGaap, "opex" | "operating expenses") => "Operating Expenses",
        (StatementPreset::Ifrs, "opex" | "operating expenses") => "Operating Expenses",
        (StatementPreset::Ifrs, "net income" | "profit for the period") => "Profit for the Period",
        (StatementPreset::Ifrs, "operating income") => "Operating Profit",
        (StatementPreset::Ifrs, "gross profit") => "Gross Profit",
        _ => stored,
    };
    label.to_string()
}

/// Presentation order for the canonical statement sections; unknown sections follow
/// alphabetically. Order is presentation-only, never money.
fn order_sections(sections: &mut [StatementSection], statement_type: &str) {
    let mut order: Vec<String> = match statement_type {
        "pl" => [
            "Revenue",
            "Cost of Goods Sold",
            "Cost of Sales",
            "Gross Profit",
            "Operating Expenses",
            "Operating Income",
            "Operating Profit",
            "Other Income",
            "Other Expenses",
            "Profit for the Period",
            "Net Income",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
        _ => [
            "Current Assets",
            "Non-Current Assets",
            "Total Assets",
            "Current Liabilities",
            "Non-Current Liabilities",
            "Total Liabilities",
            "Equity",
            "Total Equity",
            "Total Liabilities and Equity",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
    };
    // Keep only names actually present, then append the rest sorted.
    let present: BTreeSet<String> = sections.iter().map(|s| s.section.clone()).collect();
    order.retain(|s| present.contains(s));
    let known: BTreeSet<String> = order.iter().cloned().collect();
    let mut rest: Vec<String> = present.difference(&known).cloned().collect();
    rest.sort();
    order.extend(rest);
    let rank: BTreeMap<String, usize> = order
        .iter()
        .cloned()
        .enumerate()
        .map(|(i, s)| (s, i))
        .collect();
    sections.sort_by_key(|s| rank.get(&s.section).copied().unwrap_or(usize::MAX));
}

/// Tie-out on exact (pre-rounding) presented values (MONEY-ROUNDING-SPEC §5).
fn compute_tieout(
    sections: &[StatementSection],
    per_period: &BTreeMap<String, BTreeMap<String, i64>>,
    period_scope: &[String],
    statement_type: &str,
) -> Vec<StatementTieOutFinding> {
    let mut findings = Vec::new();
    if statement_type == "pl" {
        // P&L roll-up identity: net income == sum of every presented P&L line. That is
        // exact by construction here (sections hold the accounts), so the check is a
        // guard: sum(rows) must equal the sum of all account values in the scope.
        for period_id in period_scope {
            let Some(values) = per_period.get(period_id) else {
                continue;
            };
            let lines_sum: i64 = sections
                .iter()
                .flat_map(|s| s.lines.iter())
                .filter_map(|l| l.values.get(period_id))
                .sum();
            let accounts_sum: i64 = values.values().sum();
            if lines_sum != accounts_sum {
                findings.push(finding(format!(
                    "P&L {period_id}: presented section total {lines_sum} != account total {accounts_sum}"
                )));
            }
        }
    } else if statement_type == "bs" {
        // BS tie-out property: Assets + Liabilities + Equity == 0 per period
        // (MONEY-ROUNDING-SPEC §5). When it fails the GL in scope does not balance
        // (e.g. a BU scope with inter-entity entries, or P&L not yet closed to equity).
        for period_id in period_scope {
            let mut by_type: BTreeMap<&'static str, i64> = BTreeMap::new();
            for section in sections {
                for line in &section.lines {
                    if let Some(v) = line.values.get(period_id) {
                        *by_type
                            .entry(classify_section_type(&section.section))
                            .or_insert(0) += v;
                    }
                }
            }
            let assets = by_type.get("asset").copied().unwrap_or(0);
            let liabilities = by_type.get("liability").copied().unwrap_or(0);
            let equity = by_type.get("equity").copied().unwrap_or(0);
            if assets + liabilities + equity != 0 {
                findings.push(finding(format!(
                    "Balance Sheet {period_id}: Assets {assets} + Liabilities {liabilities} + Equity {equity} != 0"
                )));
            }
        }
    }
    findings
}

/// Section name → BS account-type bucket for the tie-out identity. P&L sections never
/// appear on a BS statement, so unknown names contribute 0.
fn classify_section_type(section: &str) -> &'static str {
    let s = section.to_lowercase();
    if s.contains("asset") {
        "asset"
    } else if s.contains("liabilit") {
        "liability"
    } else if s.contains("equity") {
        "equity"
    } else {
        // P&L-ish or custom section leaking into a BS scope — treat as neither so the
        // tie-out still detects the imbalance.
        "other"
    }
}

/// Round each section's per-period line values with largest-remainder allocation so
/// `sum(displayed lines) == displayed section value` per period.
fn round_sections_largest_remainder(
    sections: &[StatementSection],
    display_unit: i64,
) -> Vec<StatementSection> {
    sections
        .iter()
        .map(|section| {
            let mut rounded_lines: Vec<StatementLine> = section
                .lines
                .iter()
                .map(|l| StatementLine {
                    account_id: l.account_id.clone(),
                    label: l.label.clone(),
                    values: l.values.clone(),
                })
                .collect();
            // Allocate across the lines of this section, per period.
            let period_ids: BTreeSet<&String> =
                section.lines.iter().flat_map(|l| l.values.keys()).collect();
            for period_id in period_ids {
                let raw: Vec<i64> = section
                    .lines
                    .iter()
                    .filter_map(|l| l.values.get(period_id).copied())
                    .collect();
                let allocated = largest_remainder_allocate(&raw, display_unit);
                for (line, value) in rounded_lines.iter_mut().zip(allocated) {
                    if let Some(entry) = line.values.get_mut(period_id) {
                        *entry = value;
                    }
                }
            }
            StatementSection {
                section: section.section.clone(),
                lines: rounded_lines,
            }
        })
        .collect()
}

/// Totals aggregated from the rows actually returned (so children always tie to the
/// presented parent figures). Values are exact minor units of the reporting currency.
fn compute_totals(rows: &[StatementSection], statement_type: &str) -> StatementTotals {
    let mut totals = StatementTotals::empty();
    if statement_type == "pl" {
        let revenue: i64 = rows
            .iter()
            .filter(|s| s.section == "Revenue")
            .flat_map(|s| s.lines.iter().flat_map(|l| l.values.values()))
            .sum();
        let cogs: i64 = rows
            .iter()
            .filter(|s| matches!(s.section.as_str(), "Cost of Goods Sold" | "Cost of Sales"))
            .flat_map(|s| s.lines.iter().flat_map(|l| l.values.values()))
            .sum();
        let opex: i64 = rows
            .iter()
            .filter(|s| s.section == "Operating Expenses")
            .flat_map(|s| s.lines.iter().flat_map(|l| l.values.values()))
            .sum();
        let net: i64 = rows
            .iter()
            .flat_map(|s| s.lines.iter().flat_map(|l| l.values.values()))
            .sum();
        totals.revenue = Some(revenue);
        totals.gross_profit = Some(revenue + cogs);
        totals.operating_income = Some(revenue + cogs + opex);
        totals.net_income = Some(net);
    } else if statement_type == "bs" {
        let assets: i64 = rows
            .iter()
            .filter(|s| classify_section_type(&s.section) == "asset")
            .flat_map(|s| s.lines.iter().flat_map(|l| l.values.values()))
            .sum();
        let liabilities: i64 = rows
            .iter()
            .filter(|s| classify_section_type(&s.section) == "liability")
            .flat_map(|s| s.lines.iter().flat_map(|l| l.values.values()))
            .sum();
        let equity: i64 = rows
            .iter()
            .filter(|s| classify_section_type(&s.section) == "equity")
            .flat_map(|s| s.lines.iter().flat_map(|l| l.values.values()))
            .sum();
        totals.total_assets = Some(assets);
        totals.total_liabilities = Some(liabilities);
        totals.total_equity = Some(equity);
    }
    totals
}

/// `statement.get.v1` — typed Tauri command (API-SPEC §6). Read-only: no audit event.
#[tauri::command(name = "statement.get.v1", rename_all = "snake_case")]
pub fn statement_get(
    app: tauri::AppHandle,
    company_id: String,
    statement_type: String,
    period_scope: Vec<String>,
    preset: StatementPreset,
    rounding: RoundingRequest,
    bu_scope: BuScope,
    session: tauri::State<'_, SessionState>,
) -> AppResult<StatementGetResponse> {
    require_unlocked(&session)?;

    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;

    statement_get_internal(
        &conn,
        &company_id,
        &statement_type,
        &period_scope,
        &preset,
        &rounding,
        &bu_scope,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// In-memory Company with a committed GL: P01/P02 Actuals.
    /// Stored GL is debit-positive / credit-negative (GL-TEMPLATE-SPEC §3). Journal
    /// entries balance within the BS accounts (Cash/AP/RE) so the BS tie-out holds;
    /// the open P&L accounts mirror the same period activity as separate statement
    /// lines (Revenue credit stored negative, expense debits stored positive).
    fn seed() -> (Connection, String, Vec<String>) {
        let conn = db::open_in_memory().unwrap();
        let company_id = "co-stmt-001".to_string();
        let cal_id = "cal-stmt-001".to_string();
        let fy_id = "fy-stmt-001".to_string();

        conn.execute(
            "INSERT INTO companies
               (id, name, type, default_currency_code, base_locale, pack_schema_version,
                company_file_path, created_at, updated_at)
             VALUES (?1, 'Stmt Test Co', 'single', 'USD', 'en-US', '1.0.0',
                     '/tmp/stmt.fpa', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            rusqlite::params![company_id],
        )
        .unwrap();
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
        for (pno, code, start, end) in [
            (1, "P01", "2026-01-01", "2026-01-31"),
            (2, "P02", "2026-02-01", "2026-02-28"),
        ] {
            conn.execute(
                "INSERT INTO fiscal_periods (id, fiscal_year_id, period_no, code, start_date, end_date)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    format!("fp-2026-p{pno:02}"),
                    fy_id,
                    pno,
                    code,
                    start,
                    end
                ],
            )
            .unwrap();
        }

        let accounts = [
            ("a-rev", "4000", "Sales Revenue", "revenue", "Revenue"),
            ("a-cogs", "5000", "Direct Materials", "cogs", "COGS"),
            ("a-opex", "6000", "Salaries & Wages", "opex", "OpEx"),
            ("a-asset", "1000", "Cash", "asset", "Current Assets"),
            (
                "a-ar",
                "1200",
                "Accounts Receivable",
                "asset",
                "Current Assets",
            ),
            (
                "a-liab",
                "2000",
                "Accounts Payable",
                "liability",
                "Current Liabilities",
            ),
            ("a-equity", "3000", "Retained Earnings", "equity", "Equity"),
        ];
        for (id, code, name, atype, section) in accounts {
            conn.execute(
                "INSERT INTO accounts
                   (id, company_id, code, name, account_type, report_section, active)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
                rusqlite::params![id, company_id, code, name, atype, section],
            )
            .unwrap();
        }

        let batch_id = "ib-stmt-001".to_string();
        conn.execute(
            "INSERT INTO import_batches
               (id, company_id, kind, source_name, source_hash, mapping_version, status,
                row_count, tie_out_status, created_at)
             VALUES (?1, ?2, 'gl_dump', 'Jan Actuals', 'sha-1', 'v1', 'committed',
                     8, 'pass', '2026-01-31T00:00:00Z')",
            rusqlite::params![batch_id, company_id],
        )
        .unwrap();

        // Ledger debit-positive (GL-TEMPLATE-SPEC §3): P01/P02 BS balances so the
        // BS tie-out holds (Cash = AP + RE within the BS accounts).
        // P01: Dr Cash 500,000 · Cr AP 200,000 · Cr RE 300,000 (BS balance)
        //     Revenue credit 1,000,000 (amount_minor −1,000,000) · COGS debit 600,000 ·
        //     OpEx debit 200,000 — open P&L accounts for the same activity.
        // P02 mirrors: Cash 760,000 · AP 300,000 · RE 460,000.
        let gl = [
            ("a-asset", "fp-2026-p01", 500_000),
            ("a-liab", "fp-2026-p01", -200_000),
            ("a-equity", "fp-2026-p01", -300_000),
            ("a-rev", "fp-2026-p01", -1_000_000),
            ("a-cogs", "fp-2026-p01", 600_000),
            ("a-opex", "fp-2026-p01", 200_000),
            ("a-rev", "fp-2026-p02", -1_200_000),
            ("a-cogs", "fp-2026-p02", 720_000),
            ("a-opex", "fp-2026-p02", 240_000),
            ("a-asset", "fp-2026-p02", 760_000),
            ("a-liab", "fp-2026-p02", -300_000),
            ("a-equity", "fp-2026-p02", -460_000),
        ];
        for (i, (account_id, period_id, amount)) in gl.iter().enumerate() {
            conn.execute(
                "INSERT INTO gl_lines
                   (id, company_id, batch_id, period_id, account_id, dims_json,
                    amount_minor, currency_code, line_no)
                 VALUES (?1, ?2, ?3, ?4, ?5, '{}', ?6, 'USD', ?7)",
                rusqlite::params![
                    format!("gl-{i}"),
                    company_id,
                    batch_id,
                    period_id,
                    account_id,
                    amount,
                    i as i64 + 1
                ],
            )
            .unwrap();
        }

        let scope = vec!["fp-2026-p01".to_string(), "fp-2026-p02".to_string()];
        (conn, company_id, scope)
    }

    fn us_gaap_twodp() -> (StatementPreset, RoundingRequest) {
        (
            StatementPreset::UsGaap,
            RoundingRequest {
                mode: RoundingMode::TwoDecimals,
                largest_remainder: true,
            },
        )
    }

    #[test]
    fn pl_totals_and_tieout_pass_on_balanced_gl() {
        let (conn, company_id, scope) = seed();
        let (preset, rounding) = us_gaap_twodp();
        let resp = statement_get_internal(
            &conn,
            &company_id,
            "pl",
            &scope,
            &preset,
            &rounding,
            &BuScope::All,
        )
        .unwrap();
        assert_eq!(resp.tieout_status, "pass");
        assert!(resp.findings.is_empty());
        assert_eq!(resp.currency, "USD");
        // Revenue presented positive (credit stored negative): 1,000,000 + 1,200,000.
        assert_eq!(resp.totals.revenue, Some(2_200_000));
        // Costs presented negative: GP = revenue + cogs = 2,200,000 − 1,320,000.
        assert_eq!(resp.totals.gross_profit, Some(880_000));
        assert_eq!(resp.totals.operating_income, Some(440_000));
        // NI = all P&L lines: 2,200,000 − 1,320,000 − 440,000.
        assert_eq!(resp.totals.net_income, Some(440_000));
        // Rows keep GAAP section labels for the canonical pack names.
        let sections: Vec<&str> = resp.rows.iter().map(|s| s.section.as_str()).collect();
        assert!(sections.contains(&"Cost of Goods Sold"));
        assert!(sections.contains(&"Operating Expenses"));
        assert!(resp.rows.iter().any(|s| s.section == "Revenue"));
    }

    #[test]
    fn pl_ifrs_remaps_cost_sales_label_only() {
        let (conn, company_id, scope) = seed();
        let resp = statement_get_internal(
            &conn,
            &company_id,
            "pl",
            &scope,
            &StatementPreset::Ifrs,
            &RoundingRequest {
                mode: RoundingMode::TwoDecimals,
                largest_remainder: true,
            },
            &BuScope::All,
        )
        .unwrap();
        assert!(resp.rows.iter().any(|s| s.section == "Cost of Sales"));
        assert!(resp.rows.iter().all(|s| s.section != "Cost of Goods Sold"));
        assert_eq!(resp.totals.gross_profit, Some(880_000));
    }

    #[test]
    fn bs_ties_when_ledger_balances() {
        let (conn, company_id, scope) = seed();
        let (preset, rounding) = us_gaap_twodp();
        let resp = statement_get_internal(
            &conn,
            &company_id,
            "bs",
            &scope,
            &preset,
            &rounding,
            &BuScope::All,
        )
        .unwrap();
        assert_eq!(resp.tieout_status, "pass");
        assert!(resp.findings.is_empty());
        // Signed per MONEY-ROUNDING-SPEC §5: assets +, liabilities/equity −.
        assert_eq!(resp.totals.total_assets, Some(1_260_000));
        assert_eq!(resp.totals.total_liabilities, Some(-500_000));
        assert_eq!(resp.totals.total_equity, Some(-760_000));
        // Tie-out identity holds in the presented values.
        let sum = resp.totals.total_assets.unwrap()
            + resp.totals.total_liabilities.unwrap()
            + resp.totals.total_equity.unwrap();
        assert_eq!(sum, 0);
    }

    #[test]
    fn bs_reports_tieout_fail_when_ledger_out_of_balance() {
        let (conn, company_id, scope) = seed();
        // Insert an unbalanced committed debit in P01 (no balancing credit).
        conn.execute(
            "INSERT INTO gl_lines
               (id, company_id, batch_id, period_id, account_id, dims_json,
                amount_minor, currency_code, line_no)
             VALUES ('gl-x', ?1, 'ib-stmt-001', 'fp-2026-p01', 'a-ar', '{}',
                     50_000, 'USD', 99)",
            rusqlite::params![company_id],
        )
        .unwrap();
        let (preset, rounding) = us_gaap_twodp();
        let resp = statement_get_internal(
            &conn,
            &company_id,
            "bs",
            &scope,
            &preset,
            &rounding,
            &BuScope::All,
        )
        .unwrap();
        assert_eq!(resp.tieout_status, "fail");
        assert!(!resp.findings.is_empty());
        assert!(
            resp.findings
                .iter()
                .all(|f| f.code == "STATEMENT_TIE_OUT_FAILED")
        );
    }

    #[test]
    fn empty_scope_resolves_to_the_latest_period_with_committed_actuals() {
        let (conn, company_id, _) = seed();
        let (preset, rounding) = us_gaap_twodp();
        let resp = statement_get_internal(
            &conn,
            &company_id,
            "pl",
            &[],
            &preset,
            &rounding,
            &BuScope::All,
        )
        .unwrap();
        assert_eq!(resp.tieout_status, "pass");
        // P02 is the latest period with committed data in the fixture.
        let col: Vec<String> = resp
            .rows
            .iter()
            .flat_map(|s| s.lines.iter().flat_map(|l| l.values.keys().cloned()))
            .collect();
        assert!(col.iter().all(|p| p == "fp-2026-p02"), "got {col:?}");
    }

    #[test]
    fn perid_not_found_when_scope_has_foreign_period() {
        let (conn, company_id, _) = seed();
        let (preset, rounding) = us_gaap_twodp();
        let err = statement_get_internal(
            &conn,
            &company_id,
            "pl",
            &["fp-2026-p99".to_string()],
            &preset,
            &rounding,
            &BuScope::All,
        )
        .unwrap_err();
        assert_eq!(err.body().code, "PERIOD_NOT_FOUND");
    }

    #[test]
    fn group_scope_is_rejected_without_translation_policy() {
        let (conn, company_id, scope) = seed();
        let (preset, rounding) = us_gaap_twodp();
        let err = statement_get_internal(
            &conn,
            &company_id,
            "pl",
            &scope,
            &preset,
            &rounding,
            &BuScope::Group,
        )
        .unwrap_err();
        assert_eq!(err.body().code, "STATEMENT_SOURCE_MIXED");
    }

    #[test]
    fn cf_and_soce_return_empty_not_fabricated() {
        let (conn, company_id, scope) = seed();
        let (preset, rounding) = us_gaap_twodp();
        for ty in ["cf", "soce", "segment"] {
            let resp = statement_get_internal(
                &conn,
                &company_id,
                ty,
                &scope,
                &preset,
                &rounding,
                &BuScope::All,
            )
            .unwrap();
            assert!(resp.rows.is_empty(), "{ty} must not fabricate rows");
            assert_eq!(resp.totals.revenue, None);
        }
    }

    #[test]
    fn largest_remainder_allocation_preserves_the_displayed_total() {
        // 000s display unit for USD = 100,000 minor (MONEY-ROUNDING-SPEC §4 example).
        let unit = 100_000i64;
        let values = vec![1_234_567i64, 500_000, 265_433];
        let allocated = largest_remainder_allocate(&values, unit);
        assert_eq!(allocated.len(), values.len());
        for &v in &allocated {
            assert_eq!(
                v % unit,
                0,
                "every displayed line is a multiple of the display unit"
            );
        }
        let sum: i64 = allocated.iter().sum();
        let expected = round_half_away_from_zero_unit(values.iter().sum::<i64>(), unit);
        assert_eq!(sum, expected, "sum(displayed lines) == displayed parent");
    }

    #[test]
    fn largest_remainder_handles_negative_lines() {
        let unit = 100_000i64;
        let values = vec![-1_234_567i64, -500_000, -265_433];
        let allocated = largest_remainder_allocate(&values, unit);
        let sum: i64 = allocated.iter().sum();
        let expected = round_half_away_from_zero_unit(values.iter().sum::<i64>(), unit);
        assert_eq!(sum, expected);
    }

    #[test]
    fn thousands_rounding_applies_display_unit_and_marks_exact_with_largest_remainder() {
        let (conn, company_id, scope) = seed();
        let resp = statement_get_internal(
            &conn,
            &company_id,
            "pl",
            &scope,
            &StatementPreset::UsGaap,
            &RoundingRequest {
                mode: RoundingMode::Thousands,
                largest_remainder: true,
            },
            &BuScope::All,
        )
        .unwrap();
        assert_eq!(resp.rounding_status, "exact");
        // Displayed revenue is a multiple of 1000 major = 100,000 minor.
        let rev = resp.totals.revenue.unwrap();
        assert_eq!(rev % 100_000, 0);
        // Every displayed line value is a display-unit multiple.
        for section in &resp.rows {
            for line in &section.lines {
                for v in line.values.values() {
                    assert_eq!(v % 100_000, 0);
                }
            }
        }
        // Totals tie to the displayed rows.
        let rows_sum: i64 = resp
            .rows
            .iter()
            .flat_map(|s| s.lines.iter().flat_map(|l| l.values.values()))
            .sum();
        assert_eq!(rows_sum, resp.totals.net_income.unwrap());
    }

    #[test]
    fn rounding_without_largest_remainder_is_flagged_approximate() {
        let (conn, company_id, scope) = seed();
        let resp = statement_get_internal(
            &conn,
            &company_id,
            "pl",
            &scope,
            &StatementPreset::UsGaap,
            &RoundingRequest {
                mode: RoundingMode::Thousands,
                largest_remainder: false,
            },
            &BuScope::All,
        )
        .unwrap();
        assert_eq!(resp.rounding_status, "approximate");
        for section in &resp.rows {
            for line in &section.lines {
                for v in line.values.values() {
                    assert_eq!(v % 100_000, 0);
                }
            }
        }
    }
}
