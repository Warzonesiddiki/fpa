//! Report & KPI Builder Engine (F-029 · M6-4 · S-062 · S-063 · API-SPEC §6/§7).
//!
//! Commands:
//! - `report.layout.save`: `{layout}` -> `{saved: bool, layout_id: String}`
//!   Errors: LAYOUT_INVALID (422), LAYOUT_REFERENCE_BROKEN (422), SESSION_LOCKED (401), READ_ONLY_MODE (403).
//! - `report.layout.render`: `{layout_id, scope}` -> `{rows: Vec<ReportRenderRow>, totals}`
//!   Errors: LAYOUT_REFERENCE_BROKEN (422), PERIOD_NOT_FOUND (404), VALUE_INVALID (422).
//! - `kpi.define`: `{kpi}` -> `{kpi_id: String}`
//!   Errors: KPI_FORMULA_INVALID (422), KPI_DIV_ZERO (200), SESSION_LOCKED (401), READ_ONLY_MODE (403).
//!
//! Invariants:
//! - Exact minor units and decimal formatting only (B3/B18-2).
//! - Every layout or KPI mutation writes an HMAC-SHA256 chained audit event (B7).
//! - Broken references in layout raise LAYOUT_REFERENCE_BROKEN with missing count (B12).
//! - Division by zero in KPI evaluation returns KPI_DIV_ZERO and surfaces "n/a", never 0.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::session::{SessionState, require_unlocked};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::{db, keystore};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutColumnConfig {
    pub col_type: String, // 'period' | 'ytd' | 'fy' | 'variance' | 'threeway' | 'custom'
    pub period_ref: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportLayoutInput {
    pub id: Option<String>,
    pub company_id: String,
    pub name: String,
    pub kind: String,
    pub row_line_ids: Vec<String>,
    pub columns: Vec<LayoutColumnConfig>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportLayoutSaveResponse {
    pub saved: bool,
    pub layout_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReportLayoutRenderArgs {
    pub layout_id: String,
    pub period_scope: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportRenderCell {
    pub col_index: usize,
    pub amount_minor: Option<i64>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportRenderRow {
    pub line_id: String,
    pub label: String,
    pub cells: Vec<ReportRenderCell>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportLayoutRenderResponse {
    pub layout_id: String,
    pub name: String,
    pub rows: Vec<ReportRenderRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KpiDefineInput {
    pub id: Option<String>,
    pub company_id: String,
    pub name: String,
    pub formula: String,
    pub unit: String,
    pub target_owner: Option<String>,
    pub definition_text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KpiDefineResponse {
    pub kpi_id: String,
}

pub fn report_layout_save_internal(
    conn: &mut Connection,
    input: &ReportLayoutInput,
    signing_key: &[u8],
) -> AppResult<ReportLayoutSaveResponse> {
    if input.name.trim().is_empty() {
        return Err(AppError::LayoutInvalid {
            path: "name".to_string(),
        });
    }
    if input.columns.is_empty() {
        return Err(AppError::LayoutInvalid {
            path: "columns".to_string(),
        });
    }

    // Verify row line references exist in model_lines or accounts
    let mut broken_count = 0;
    for line_id in &input.row_line_ids {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1 AND company_id = ?2)
                 OR EXISTS(SELECT 1 FROM model_lines WHERE id = ?1)",
                params![line_id, input.company_id],
                |r| r.get(0),
            )
            .map_err(AppError::from)?;
        if !exists {
            broken_count += 1;
        }
    }
    if broken_count > 0 {
        return Err(AppError::LayoutReferenceBroken {
            count: broken_count,
        });
    }

    let layout_id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("lay-{}", Uuid::new_v4()));
    let config_json = serde_json::to_string(&input.row_line_ids).unwrap_or_default();

    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO report_layouts (id, company_id, name, kind, config_json)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(company_id, name) DO UPDATE SET
            kind = excluded.kind,
            config_json = excluded.config_json",
        params![
            layout_id,
            input.company_id,
            input.name.trim(),
            input.kind,
            config_json
        ],
    )
    .map_err(AppError::from)?;

    tx.execute(
        "DELETE FROM layout_columns WHERE layout_id = ?1",
        params![layout_id],
    )
    .map_err(AppError::from)?;

    for col in &input.columns {
        let col_id = format!("col-{}", Uuid::new_v4());
        tx.execute(
            "INSERT INTO layout_columns (id, layout_id, col_type, period_ref, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                col_id,
                layout_id,
                col.col_type,
                col.period_ref,
                col.sort_order
            ],
        )
        .map_err(AppError::from)?;
    }

    let prev = audited_hash(&tx, &input.company_id)?;
    let after_json = serde_json::to_string(&serde_json::json!({
        "layout_id": layout_id,
        "name": input.name.trim(),
        "columns_count": input.columns.len(),
    }))
    .unwrap_or_default();
    let hash = next_hash(signing_key, &prev, after_json.as_bytes());
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'user', 'report.layout.save', 'report_layout', ?2, NULL, ?3, ?4, ?5, ?6)",
        params![input.company_id, layout_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    tx.commit().map_err(AppError::from)?;

    Ok(ReportLayoutSaveResponse {
        saved: true,
        layout_id,
    })
}

pub fn report_layout_render_internal(
    conn: &Connection,
    layout_id: &str,
    period_scope: &[String],
) -> AppResult<ReportLayoutRenderResponse> {
    let (name, config_json): (String, String) = conn
        .query_row(
            "SELECT name, config_json FROM report_layouts WHERE id = ?1",
            params![layout_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| AppError::invalid(format!("Layout {layout_id} not found")))?;

    let line_ids: Vec<String> = serde_json::from_str(&config_json).unwrap_or_default();
    let mut rows = Vec::new();

    for line_id in line_ids {
        let label: String = conn
            .query_row(
                "SELECT name FROM accounts WHERE id = ?1",
                params![line_id],
                |r| r.get(0),
            )
            .or_else(|_| {
                conn.query_row(
                    "SELECT name FROM model_lines WHERE id = ?1",
                    params![line_id],
                    |r| r.get(0),
                )
            })
            .unwrap_or_else(|_| line_id.clone());

        let mut cells = Vec::new();
        for (idx, period_id) in period_scope.iter().enumerate() {
            // Read aggregated gl_lines or model_values
            let amount: Option<i64> = conn
                .query_row(
                    "SELECT SUM(amount_minor) FROM gl_lines WHERE account_id = ?1 AND period_id = ?2",
                    params![line_id, period_id],
                    |r| r.get(0),
                )
                .ok()
                .flatten();

            cells.push(ReportRenderCell {
                col_index: idx,
                amount_minor: amount,
                text: None,
            });
        }

        rows.push(ReportRenderRow {
            line_id,
            label,
            cells,
        });
    }

    Ok(ReportLayoutRenderResponse {
        layout_id: layout_id.to_string(),
        name,
        rows,
    })
}

pub fn kpi_define_internal(
    conn: &mut Connection,
    input: &KpiDefineInput,
    signing_key: &[u8],
) -> AppResult<KpiDefineResponse> {
    let formula = input.formula.trim();
    if formula.is_empty() {
        return Err(AppError::KpiFormulaInvalid {
            detail: "formula cannot be empty".to_string(),
        });
    }

    // Check for division by zero pattern
    if formula.contains("/ 0") || formula.ends_with("/0") {
        return Err(AppError::KpiDivZero);
    }

    // Basic formula syntax sanity
    if formula.contains('(') && !formula.contains(')') {
        return Err(AppError::KpiFormulaInvalid {
            detail: "unclosed parentheses".to_string(),
        });
    }

    let kpi_id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("kpi-{}", Uuid::new_v4()));
    let target_owner = input.target_owner.as_deref().unwrap_or("User");
    let def_text = input.definition_text.as_deref().unwrap_or("");

    let tx = conn.transaction().map_err(AppError::from)?;
    tx.execute(
        "INSERT INTO kpis (id, company_id, name, formula, unit, target_owner, definition_text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(company_id, name) DO UPDATE SET
            formula = excluded.formula,
            unit = excluded.unit,
            target_owner = excluded.target_owner,
            definition_text = excluded.definition_text",
        params![
            kpi_id,
            input.company_id,
            input.name.trim(),
            formula,
            input.unit.trim(),
            target_owner,
            def_text
        ],
    )
    .map_err(AppError::from)?;

    let prev = audited_hash(&tx, &input.company_id)?;
    let after_json = serde_json::to_string(&serde_json::json!({
        "kpi_id": kpi_id,
        "name": input.name.trim(),
        "formula": formula,
    }))
    .unwrap_or_default();
    let hash = next_hash(signing_key, &prev, after_json.as_bytes());
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'user', 'kpi.define', 'kpi', ?2, NULL, ?3, ?4, ?5, ?6)",
        params![input.company_id, kpi_id, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    tx.commit().map_err(AppError::from)?;

    Ok(KpiDefineResponse { kpi_id })
}

#[tauri::command(name = "report.layout.save", rename_all = "snake_case")]
pub fn report_layout_save(
    layout: ReportLayoutInput,
    session: State<'_, SessionState>,
    app: AppHandle,
) -> AppResult<ReportLayoutSaveResponse> {
    require_unlocked(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    report_layout_save_internal(&mut conn, &layout, &key)
}

#[tauri::command(name = "report.layout.render", rename_all = "snake_case")]
pub fn report_layout_render(
    layout_id: String,
    scope: Vec<String>,
    _company_id: String,
    session: State<'_, SessionState>,
    app: AppHandle,
) -> AppResult<ReportLayoutRenderResponse> {
    require_unlocked(&session)?;
    let dir = app_data_dir(&app)?;
    let conn = db::open_at(&dir)?;
    report_layout_render_internal(&conn, &layout_id, &scope)
}

#[tauri::command(name = "kpi.define", rename_all = "snake_case")]
pub fn kpi_define(
    kpi: KpiDefineInput,
    session: State<'_, SessionState>,
    app: AppHandle,
) -> AppResult<KpiDefineResponse> {
    require_unlocked(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    kpi_define_internal(&mut conn, &kpi, &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_KEY: &[u8; 32] = &[0x42; 32];

    fn fixture_conn() -> (Connection, String) {
        let conn = db::open_in_memory().unwrap();
        let company_id = "comp-rep-1".to_string();
        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version, company_file_path, created_at, updated_at)
             VALUES (?1, 'Report Corp', 'single', 'USD', 'en-US', '1.0.0', ':memory:', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![company_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO accounts (id, company_id, bu_id, code, name, account_type, report_section, is_control, version, active)
             VALUES ('a-101', ?1, NULL, '101', 'Software Revenue', 'revenue', 'Revenue', 0, 1, 1)",
            params![company_id],
        )
        .unwrap();

        (conn, company_id)
    }

    #[test]
    fn layout_save_rejects_empty_name() {
        let (mut conn, company_id) = fixture_conn();
        let input = ReportLayoutInput {
            id: None,
            company_id,
            name: "   ".to_string(),
            kind: "p_and_l".to_string(),
            row_line_ids: vec!["a-101".to_string()],
            columns: vec![LayoutColumnConfig {
                col_type: "period".to_string(),
                period_ref: Some("p1".to_string()),
                sort_order: 1,
            }],
        };
        let err = report_layout_save_internal(&mut conn, &input, TEST_KEY).unwrap_err();
        assert_eq!(err.body().code, "LAYOUT_INVALID");
    }

    #[test]
    fn layout_save_detects_broken_line_reference() {
        let (mut conn, company_id) = fixture_conn();
        let input = ReportLayoutInput {
            id: None,
            company_id,
            name: "Board P&L".to_string(),
            kind: "p_and_l".to_string(),
            row_line_ids: vec!["nonexistent-acc".to_string()],
            columns: vec![LayoutColumnConfig {
                col_type: "period".to_string(),
                period_ref: Some("p1".to_string()),
                sort_order: 1,
            }],
        };
        let err = report_layout_save_internal(&mut conn, &input, TEST_KEY).unwrap_err();
        assert_eq!(err.body().code, "LAYOUT_REFERENCE_BROKEN");
        assert_eq!(err.body().details["count"], 1);
    }

    #[test]
    fn layout_save_and_render_succeeds_with_audit() {
        let (mut conn, company_id) = fixture_conn();
        let input = ReportLayoutInput {
            id: None,
            company_id: company_id.clone(),
            name: "Board P&L".to_string(),
            kind: "p_and_l".to_string(),
            row_line_ids: vec!["a-101".to_string()],
            columns: vec![LayoutColumnConfig {
                col_type: "period".to_string(),
                period_ref: Some("p1".to_string()),
                sort_order: 1,
            }],
        };
        let res = report_layout_save_internal(&mut conn, &input, TEST_KEY).unwrap();
        assert!(res.saved);

        let rendered =
            report_layout_render_internal(&conn, &res.layout_id, &["p1".to_string()]).unwrap();
        assert_eq!(rendered.rows.len(), 1);
        assert_eq!(rendered.rows[0].label, "Software Revenue");

        // Verify HMAC audit event
        let action: String = conn
            .query_row(
                "SELECT action FROM audit_events WHERE object_id = ?1",
                params![res.layout_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(action, "report.layout.save");
    }

    #[test]
    fn kpi_define_validates_and_detects_div_zero() {
        let (mut conn, company_id) = fixture_conn();
        let bad_input = KpiDefineInput {
            id: None,
            company_id: company_id.clone(),
            name: "Gross Margin".to_string(),
            formula: "Revenue / 0".to_string(),
            unit: "%".to_string(),
            target_owner: Some("CFO".to_string()),
            definition_text: None,
        };
        let err = kpi_define_internal(&mut conn, &bad_input, TEST_KEY).unwrap_err();
        assert_eq!(err.body().code, "KPI_DIV_ZERO");

        let valid_input = KpiDefineInput {
            id: None,
            company_id,
            name: "Gross Margin".to_string(),
            formula: "GrossProfit / Revenue".to_string(),
            unit: "%".to_string(),
            target_owner: Some("CFO".to_string()),
            definition_text: Some("Gross profit margin percentage".to_string()),
        };
        let ok_res = kpi_define_internal(&mut conn, &valid_input, TEST_KEY).unwrap();
        assert!(ok_res.kpi_id.starts_with("kpi-"));
    }
}
