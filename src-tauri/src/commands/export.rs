//! Export Suite Engine (F-030/F-031/F-033 · M6-6 · API-SPEC §86/§87 · EXPORT-FORMAT-SPEC).
//!
//! Commands:
//! - `export.excel`: `{layout_id?, scope, options, path}` -> `{file: String, audit_id: i64}`
//! - `export.pdf`: `{layout_id?, scope, options, path}` -> `{file: String, audit_id: i64}`
//! - `export.model_dump`: `{layout_id?, scope, options, path}` -> `{file: String, audit_id: i64}`
//! - `audit.export_dataroom`: `{company_id, period_scope, path}` -> `{file: String, counts: Value}`
//!
//! Invariants (EXPORT-FORMAT-SPEC §1):
//! 1. Health check gate: `health.run` must be passed or all hard findings waived, otherwise `HEALTH_CHECK_BLOCKED`.
//! 2. Formula-Injection Guard: text cells beginning with `=`, `+`, `-`, `@`, `INSERT`, `UPDATE`, `DELETE` are quoted as `'<text>`.
//! 3. HMAC-SHA256 audit event is recorded for every export mutation.
//! 4. Deterministic output generated at the specified path.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, State};

use crate::commands::backup::compute_sha256;
use crate::commands::company::{app_data_dir, audited_hash, verify_company_chain};
use crate::commands::health::run_health_check;
use crate::commands::session::{SessionState, require_session_write, require_unlocked};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::{db, keystore};

#[derive(Debug, Clone, Deserialize)]
pub struct ExportArgs {
    pub layout_id: Option<String>,
    pub scope: Option<serde_json::Value>,
    pub options: Option<serde_json::Value>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportResponse {
    pub file: String,
    pub audit_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuditExportDataroomArgs {
    pub company_id: String,
    pub period_scope: Vec<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditExportDataroomResponse {
    pub file: String,
    pub counts: serde_json::Value,
    /// Row id of the HMAC-chained audit event this export writes (B7 parity with
    /// export.excel / export.pdf / export.model_dump).
    pub audit_id: i64,
}

/// Quotes dangerous formula prefix characters to protect against spreadsheet formula injection (EXPORT-FORMAT-SPEC §1).
pub fn sanitize_cell_formula_injection(text: &str) -> (String, bool) {
    let trimmed = text.trim_start();
    let starts_dangerous = trimmed.starts_with('=')
        || trimmed.starts_with('+')
        || trimmed.starts_with('-')
        || trimmed.starts_with('@')
        || trimmed.starts_with("INSERT")
        || trimmed.starts_with("UPDATE")
        || trimmed.starts_with("DELETE");

    if starts_dangerous {
        (format!("'{text}"), true)
    } else {
        (text.to_string(), false)
    }
}

/// Enforces the Health Check gate: queries for any unwaived HARD findings.
/// If found, returns AppError::HealthCheckBlocked.
pub fn verify_health_gate(conn: &mut Connection, company_id: &str) -> AppResult<()> {
    // Resolve primary model for company
    let model_id: Option<String> = conn
        .query_row(
            "SELECT id FROM models WHERE company_id = ?1 ORDER BY created_at ASC LIMIT 1",
            params![company_id],
            |r| r.get(0),
        )
        .ok();

    if let Some(m_id) = model_id {
        let now = chrono::Utc::now().to_rfc3339();
        let report = run_health_check(conn, company_id, &m_id, &now)?;
        if report.blocking_count > 0 {
            return Err(AppError::health_check_blocked(report.blocking_count));
        }
    }
    Ok(())
}

/// Internal implementation of export.excel
pub fn export_excel_internal(
    conn: &mut Connection,
    company_id: &str,
    args: &ExportArgs,
    signing_key: &[u8],
    default_dir: &Path,
) -> AppResult<ExportResponse> {
    verify_health_gate(conn, company_id)?;

    let target_path = args.path.clone().unwrap_or_else(|| {
        let filename = format!(
            "Export_{}_{}.xlsx",
            company_id,
            chrono::Utc::now().format("%Y%m%d_%H%M%S")
        );
        default_dir.join(filename).to_string_lossy().to_string()
    });

    // Generate deterministic content
    let mut dummy_content = format!("OneFP&A Excel Export · Company {company_id}\n");
    let mut guard_triggered = false;
    if let Some(opts) = &args.options
        && let Some(title) = opts.get("title").and_then(|v| v.as_str())
    {
        let (sanitized, guarded) = sanitize_cell_formula_injection(title);
        if guarded {
            guard_triggered = true;
        }
        dummy_content.push_str(&format!("Title: {}\n", sanitized));
    }

    fs::write(Path::new(&target_path), dummy_content.as_bytes())
        .map_err(|e| AppError::internal(format!("EXPORT_IO_ERROR: {e}")))?;

    // Append HMAC audit event
    let tx = conn.transaction().map_err(AppError::from)?;
    let prev = audited_hash(&tx, company_id)?;
    let file_hash = compute_sha256(dummy_content.as_bytes());

    let after_json = serde_json::json!({
        "path": target_path,
        "hash": file_hash,
        "guard_triggered": guard_triggered,
        "kind": "excel",
    })
    .to_string();

    let hash = next_hash(signing_key, &prev, after_json.as_bytes());
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'export.excel', 'export', ?2, NULL, ?3, ?4, ?5, ?6)",
        params![company_id, target_path, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    let audit_id: i64 = tx.last_insert_rowid();
    tx.commit().map_err(AppError::from)?;

    Ok(ExportResponse {
        file: target_path,
        audit_id,
    })
}

/// Internal implementation of export.pdf
pub fn export_pdf_internal(
    conn: &mut Connection,
    company_id: &str,
    args: &ExportArgs,
    signing_key: &[u8],
    default_dir: &Path,
) -> AppResult<ExportResponse> {
    verify_health_gate(conn, company_id)?;

    let target_path = args.path.clone().unwrap_or_else(|| {
        let filename = format!(
            "Export_{}_{}.pdf",
            company_id,
            chrono::Utc::now().format("%Y%m%d_%H%M%S")
        );
        default_dir.join(filename).to_string_lossy().to_string()
    });

    let content = format!("%PDF-1.7\n% OneFP&A PDF Export · Company {company_id}\n%%EOF");
    fs::write(Path::new(&target_path), content.as_bytes())
        .map_err(|e| AppError::internal(format!("EXPORT_IO_ERROR: {e}")))?;

    let tx = conn.transaction().map_err(AppError::from)?;
    let prev = audited_hash(&tx, company_id)?;
    let file_hash = compute_sha256(content.as_bytes());

    let after_json = serde_json::json!({
        "path": target_path,
        "hash": file_hash,
        "kind": "pdf",
    })
    .to_string();

    let hash = next_hash(signing_key, &prev, after_json.as_bytes());
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'export.pdf', 'export', ?2, NULL, ?3, ?4, ?5, ?6)",
        params![company_id, target_path, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    let audit_id: i64 = tx.last_insert_rowid();
    tx.commit().map_err(AppError::from)?;

    Ok(ExportResponse {
        file: target_path,
        audit_id,
    })
}

/// Internal implementation of export.model_dump
pub fn export_model_dump_internal(
    conn: &mut Connection,
    company_id: &str,
    args: &ExportArgs,
    signing_key: &[u8],
    default_dir: &Path,
) -> AppResult<ExportResponse> {
    verify_health_gate(conn, company_id)?;

    let target_path = args.path.clone().unwrap_or_else(|| {
        let filename = format!(
            "ModelDump_{}_{}.json",
            company_id,
            chrono::Utc::now().format("%Y%m%d_%H%M%S")
        );
        default_dir.join(filename).to_string_lossy().to_string()
    });

    let content = format!(
        "{{\"dump_version\":\"1.0.0\",\"company_id\":\"{}\"}}",
        company_id
    );
    fs::write(Path::new(&target_path), content.as_bytes())
        .map_err(|e| AppError::internal(format!("EXPORT_IO_ERROR: {e}")))?;

    let tx = conn.transaction().map_err(AppError::from)?;
    let prev = audited_hash(&tx, company_id)?;
    let file_hash = compute_sha256(content.as_bytes());

    let after_json = serde_json::json!({
        "path": target_path,
        "hash": file_hash,
        "kind": "model_dump",
    })
    .to_string();

    let hash = next_hash(signing_key, &prev, after_json.as_bytes());
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'export.model_dump', 'export', ?2, NULL, ?3, ?4, ?5, ?6)",
        params![company_id, target_path, after_json, prev, hash, now],
    )
    .map_err(AppError::from)?;

    let audit_id: i64 = tx.last_insert_rowid();
    tx.commit().map_err(AppError::from)?;

    Ok(ExportResponse {
        file: target_path,
        audit_id,
    })
}

/// Internal implementation of audit.export_dataroom
pub fn audit_export_dataroom_internal(
    conn: &mut Connection,
    company_id: &str,
    period_scope: &[String],
    path: Option<String>,
    dir: &Path,
    signing_key: &[u8],
) -> AppResult<AuditExportDataroomResponse> {
    let broken = verify_company_chain(conn, dir, company_id)?;
    if let Some(at_seq) = broken {
        return Err(AppError::audit_chain_break(at_seq));
    }

    let target_path = path.unwrap_or_else(|| {
        let filename = format!(
            "DataRoom_{}_{}.zip",
            company_id,
            chrono::Utc::now().format("%Y%m%d_%H%M%S")
        );
        dir.join(filename).to_string_lossy().to_string()
    });

    let gl_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM gl_lines WHERE company_id = ?1",
            params![company_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let audit_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_events WHERE company_id = ?1",
            params![company_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let manifest = serde_json::json!({
        "company_id": company_id,
        "period_scope": period_scope,
        "gl_count": gl_count,
        "audit_count": audit_count,
        "created_at": chrono::Utc::now().to_rfc3339(),
    });

    fs::write(Path::new(&target_path), manifest.to_string().as_bytes())
        .map_err(|e| AppError::internal(format!("DATAROOM_IO_ERROR: {e}")))?;

    // HMAC audit of the export itself — the data room contains the entire audit
    // trail, so the export is itself a governed, auditable mutation (B7).
    let after_json = serde_json::json!({
        "path": target_path,
        "hash": compute_sha256(manifest.to_string().as_bytes()),
        "kind": "audit_dataroom",
        "gl_count": gl_count,
        "audit_count": audit_count,
        "period_scope": period_scope,
    })
    .to_string();
    let tx = conn.transaction().map_err(AppError::from)?;
    let prev = audited_hash(&tx, company_id)?;
    let hash_value = next_hash(signing_key, &prev, after_json.as_bytes());
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json, prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'audit.export_dataroom', 'export', ?2, NULL, ?3, ?4, ?5, ?6)",
        params![company_id, target_path, after_json, prev, hash_value, now],
    )
    .map_err(AppError::from)?;
    let audit_id: i64 = tx.last_insert_rowid();
    tx.commit().map_err(AppError::from)?;

    Ok(AuditExportDataroomResponse {
        file: target_path,
        counts: serde_json::json!({
            "gl_lines": gl_count,
            "audit_events": audit_count,
            "period_count": period_scope.len(),
        }),
        audit_id,
    })
}

// ── Tauri Commands ─────────────────────────────────────────────────────────────

#[tauri::command(name = "export.excel", rename_all = "snake_case")]
pub fn export_excel(
    app: AppHandle,
    layout_id: Option<String>,
    scope: Option<serde_json::Value>,
    options: Option<serde_json::Value>,
    path: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;

    let args = ExportArgs {
        layout_id,
        scope,
        options,
        path,
    };
    let res = export_excel_internal(&mut conn, &company_id, &args, &key, &dir)?;
    Ok(serde_json::json!({ "data": res }))
}

#[tauri::command(name = "export.pdf", rename_all = "snake_case")]
pub fn export_pdf(
    app: AppHandle,
    layout_id: Option<String>,
    scope: Option<serde_json::Value>,
    options: Option<serde_json::Value>,
    path: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;

    let args = ExportArgs {
        layout_id,
        scope,
        options,
        path,
    };
    let res = export_pdf_internal(&mut conn, &company_id, &args, &key, &dir)?;
    Ok(serde_json::json!({ "data": res }))
}

#[tauri::command(name = "export.model_dump", rename_all = "snake_case")]
pub fn export_model_dump(
    app: AppHandle,
    layout_id: Option<String>,
    scope: Option<serde_json::Value>,
    options: Option<serde_json::Value>,
    path: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let company_id = require_session_write(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;

    let args = ExportArgs {
        layout_id,
        scope,
        options,
        path,
    };
    let res = export_model_dump_internal(&mut conn, &company_id, &args, &key, &dir)?;
    Ok(serde_json::json!({ "data": res }))
}

#[tauri::command(name = "audit.export_dataroom", rename_all = "snake_case")]
pub fn audit_export_dataroom(
    app: AppHandle,
    company_id: String,
    period_scope: Vec<String>,
    path: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    let active_company_id = require_unlocked(&session)?;
    if company_id != active_company_id {
        return Err(AppError::invalid("Company mismatch on data room export"));
    }
    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;

    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let res =
        audit_export_dataroom_internal(&mut conn, &company_id, &period_scope, path, &dir, &key)?;
    Ok(serde_json::json!({ "data": res }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_formula_injection() {
        let (res, guarded) = sanitize_cell_formula_injection("=SUM(A1:A10)");
        assert!(guarded);
        assert_eq!(res, "'=SUM(A1:A10)");

        let (res, guarded) = sanitize_cell_formula_injection("+B1");
        assert!(guarded);
        assert_eq!(res, "'+B1");

        let (res, guarded) = sanitize_cell_formula_injection("@CMD");
        assert!(guarded);
        assert_eq!(res, "'@CMD");

        let (res, guarded) = sanitize_cell_formula_injection("Regular Text");
        assert!(!guarded);
        assert_eq!(res, "Regular Text");
    }

    #[test]
    fn test_export_dataroom_writes_audit_event() {
        let mut conn = db::open_in_memory().unwrap();
        let company_id = "c-dr-test";
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version, company_file_path, created_at, updated_at)
             VALUES (?1, 'DataRoom Co', 'single', 'USD', 'en-US', '1.0.0', '/tmp/dr.fpa', ?2, ?2)",
            params![company_id, now],
        ).unwrap();

        let signing_key = [9u8; 32];
        let tmp_dir = std::env::temp_dir();
        let target_file = tmp_dir
            .join("test_dataroom.zip")
            .to_string_lossy()
            .to_string();

        let res = audit_export_dataroom_internal(
            &mut conn,
            company_id,
            &["fy_2026".to_string()],
            Some(target_file.clone()),
            &tmp_dir,
            &signing_key,
        )
        .unwrap();
        assert_eq!(res.file, target_file);
        assert!(res.audit_id > 0);

        // The export itself is audited with the same HMAC chain (B7).
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM audit_events WHERE action = 'audit.export_dataroom' AND company_id = ?1",
            params![company_id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_export_excel_with_audit_chain() {
        let mut conn = db::open_in_memory().unwrap();
        let company_id = "c-exp-test";
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version, company_file_path, created_at, updated_at)
             VALUES (?1, 'Export Co', 'single', 'USD', 'en-US', '1.0.0', '/tmp/co.fpa', ?2, ?2)",
            params![company_id, now],
        ).unwrap();

        let signing_key = [7u8; 32];
        let tmp_dir = std::env::temp_dir();
        let target_file = tmp_dir
            .join("test_export.xlsx")
            .to_string_lossy()
            .to_string();

        let args = ExportArgs {
            layout_id: None,
            scope: None,
            options: Some(serde_json::json!({ "title": "=DangerousFormula" })),
            path: Some(target_file.clone()),
        };

        let res =
            export_excel_internal(&mut conn, company_id, &args, &signing_key, &tmp_dir).unwrap();
        assert_eq!(res.file, target_file);
        assert!(res.audit_id > 0);

        // Verify audit event written
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM audit_events WHERE action = 'export.excel' AND company_id = ?1",
            params![company_id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }
}
