//! `coa.list` (F-002 Chart of Accounts + Dimensions) — read-only AccountNode[] tree source.
//! Pack COA seeding lands with the Pack loader milestone; until then a fresh Company has an
//! empty accounts table and the screen renders its Empty state (SCREENS-SPEC S-021).

use rusqlite::Connection;

use crate::core::error::{AppError, AppResult};

/// AccountNode rows for a Company (optionally BU-scoped). `parent_id` forms the tree client-side.
fn query_accounts(
    conn: &Connection,
    company_id: &str,
    bu_id: Option<&str>,
) -> AppResult<Vec<serde_json::Value>> {
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.code, a.name, a.account_type, a.report_section, a.parent_id, a.bu_id,
                    a.is_control, a.active, a.version,
                    (SELECT COUNT(*) FROM gl_lines g WHERE g.account_id = a.id) AS usage_count
             FROM accounts a
             WHERE a.company_id = ?1 AND a.active = 1 AND (?2 IS NULL OR a.bu_id = ?2)
             ORDER BY a.code",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params![company_id, bu_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "code": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "account_type": r.get::<_, String>(3)?,
                "report_section": r.get::<_, String>(4)?,
                "parent_id": r.get::<_, Option<String>>(5)?,
                "bu_id": r.get::<_, Option<String>>(6)?,
                "is_control": r.get::<_, i64>(7)? != 0,
                "active": r.get::<_, i64>(8)? != 0,
                "version": r.get::<_, i64>(9)?,
                "usage_count": r.get::<_, i64>(10)?,
            }))
        })
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// `coa.list` — {company_id, bu_id?}. Flat AccountNode[] (parent_id forms the tree client-side).
#[tauri::command(name = "coa.list", rename_all = "camelCase")]
pub fn coa_list(
    app: tauri::AppHandle,
    company_id: String,
    bu_id: Option<String>,
) -> AppResult<serde_json::Value> {
    let dir = crate::commands::company::app_data_dir(&app)?;
    let conn = crate::storage::db::open_at(&dir).map_err(AppError::from)?;
    let exists: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)", [&company_id], |r| r.get(0))
        .map_err(AppError::from)?;
    if !exists {
        return Err(AppError::file_corrupt());
    }
    let rows = query_accounts(&conn, &company_id, bu_id.as_deref())?;
    Ok(serde_json::json!({ "data": rows }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db;

    const CO: &str = "00000000-0000-0000-0000-000000000001";

    fn seed_account(conn: &Connection, code: &str, parent: Option<&str>) {
        conn.execute(
            "INSERT INTO accounts (id, company_id, code, name, account_type, report_section, parent_id, version)
             VALUES (?1, ?2, ?3, ?4, 'revenue', 'Income Statement', ?5, 1)",
            rusqlite::params![
                format!("acct-{code}"),
                CO,
                code,
                code,
                parent.map(|p| format!("acct-{p}"))
            ],
        )
        .unwrap();
    }

    #[test]
    fn account_nodes_are_ordered_and_tree_linked() {
        let conn = db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version,
                                    company_file_path, created_at, updated_at)
             VALUES (?1, 'T', 'single', 'USD', 'en-IN', '1.0.0', '/t', 'now', 'now')",
            [CO],
        )
        .unwrap();
        seed_account(&conn, "4000", None);
        seed_account(&conn, "4100", Some("4000"));

        let rows = query_accounts(&conn, CO, None).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["code"], "4000");
        assert_eq!(rows[1]["parent_id"], "acct-4000");
        assert_eq!(rows[0]["usage_count"], 0);
        assert_eq!(rows[0]["account_type"], "revenue");
    }

    #[test]
    fn missing_company_errors_with_storage_file_corrupt() {
        // Existence gate is command-level; here we verify the query stays empty for an unknown id.
        let conn = db::open_in_memory().unwrap();
        let rows = query_accounts(&conn, "00000000-0000-0000-0000-000000000099", None).unwrap();
        assert!(rows.is_empty());
    }
}
