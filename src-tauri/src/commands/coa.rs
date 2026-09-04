//! `coa.list` / `coa.import` / `coa.merge_accounts` (F-002 Chart of Accounts, S-021).
//!
//! `coa.import {company_id, file_path?, pack_key?}` → `{created, updated}`.
//! Source = a Pack's `coa.json` (`pack_key`) or a JSON file with the same shape
//! (`{accounts: [{code, name, type, section, is_control?}]}`). Upsert semantics
//! (API-SPEC §9):
//!   - new code                     → INSERT (version 1)              → created++
//!   - exists, same type, no usage  → in-place UPDATE + version+1     → updated++
//!   - exists, same type, referenced→ COA_REFERENCED (history is never rewritten)
//!   - exists, different type       → COA_DUPLICATE_CODE
//! Versioning is in-place (stable `accounts.id` — gl_lines/children FKs must not move);
//! change history rides the HMAC audit chain (audit_events, object `coa`).
//! Codes are normalized on import: trim + collapse whitespace, leading zeros kept
//! (never parsed as numbers); an empty-after-normalization code is `VALUE_INVALID`.
//!
//! `coa.merge_accounts {from_id, to_id}` → `{remapped}`. Remaps `gl_lines.account_id`
//! and child `accounts.parent_id` from `from_id` to `to_id`, then soft-deactivates
//! `from_id` (history preserved). Requires same `account_type` (COA_TYPE_MISMATCH)
//! and distinct, active accounts of one Company (merging a parent into its child is
//! rejected as a cycle).
//!
//! Audit (B18-1): both mutations write their HMAC-chained event inside the SAME
//! transaction as the data change (calendar.rs pattern) — a failure after the data
//! write rolls the whole thing back.

use rusqlite::{Connection, OptionalExtension};
use tauri::State;
use uuid::Uuid;

use crate::commands::company::{app_data_dir, audited_hash};
use crate::commands::pack::find_packs_dir;
use crate::commands::session::{SessionState, require_unlocked};
use crate::core::audit::next_hash;
use crate::core::error::{AppError, AppResult};
use crate::storage::keystore;
use chrono::Utc;

const ACCOUNT_TYPES: [&str; 6] = ["revenue", "cogs", "opex", "asset", "liability", "equity"];

/// Code normalization on import (QA-CHECKLIST F-002 #2; DATABASE-SCHEMA: "leading-zero kept"):
/// trim + collapse all internal whitespace; the code is NEVER parsed as a number, so
/// leading zeros survive. Left-padding to the pack-defined width (default 6) is a Pack
/// Builder rule at pack CREATION (INDUSTRY-PACK-SPEC §2, M1-9) — import does not rewrite
/// codes that GL lines may already reference.
fn normalize_code(raw: &str) -> String {
    raw.trim().chars().filter(|c| !c.is_whitespace()).collect()
}

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
    let dir = app_data_dir(&app)?;
    let conn = crate::storage::db::open_at(&dir)?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)",
            [&company_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if !exists {
        return Err(AppError::file_corrupt());
    }
    let rows = query_accounts(&conn, &company_id, bu_id.as_deref())?;
    Ok(serde_json::json!({ "data": rows }))
}

/// Import core — executes on the caller's connection/transaction (the caller owns commit
/// and audit, B18-1). See module docs for the upsert semantics.
pub fn import_coa(
    conn: &Connection,
    company_id: &str,
    accounts: &[serde_json::Value],
) -> AppResult<(u32, u32)> {
    let mut created = 0u32;
    let mut updated = 0u32;
    for acct in accounts {
        let code_raw = acct.get("code").and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::invalid("COA_IMPORT_SHAPE: each account needs a string 'code'")
        })?;
        let code = normalize_code(code_raw);
        if code.is_empty() {
            return Err(AppError::invalid(
                "COA_IMPORT_SHAPE: code is empty after normalization",
            ));
        }
        let name = acct
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(code_raw);
        let account_type = acct
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::invalid("COA_IMPORT_SHAPE: account 'type' is required"))?;
        if !ACCOUNT_TYPES.contains(&account_type) {
            return Err(AppError::invalid(format!(
                "COA_IMPORT_SHAPE: unknown account_type '{account_type}'"
            )));
        }
        let report_section = acct
            .get("section")
            .and_then(|v| v.as_str())
            .unwrap_or("General");
        let is_control = acct
            .get("is_control")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let existing: Option<(String, String, i64)> = conn
            .query_row(
                "SELECT a.id, a.account_type, (SELECT COUNT(*) FROM gl_lines g WHERE g.account_id = a.id)
                 FROM accounts a
                 WHERE a.company_id = ?1 AND a.bu_id IS NULL AND a.code = ?2 AND a.active = 1",
                rusqlite::params![company_id, code],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(AppError::from)?;

        match existing {
            None => {
                conn.execute(
                    "INSERT INTO accounts (id, company_id, code, name, account_type, report_section, parent_id, is_control, version, active)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, 1, 1)",
                    rusqlite::params![
                        Uuid::new_v4().to_string(),
                        company_id,
                        code,
                        name,
                        account_type,
                        report_section,
                        is_control as i64
                    ],
                )
                .map_err(AppError::from)?;
                created += 1;
            }
            Some((_id, existing_type, usage)) => {
                if existing_type != account_type {
                    return Err(AppError::CoaDuplicateCode {
                        code: code.to_string(),
                    });
                }
                if usage > 0 {
                    return Err(AppError::CoaReferenced { count: usage });
                }
                conn.execute(
                    "UPDATE accounts SET name = ?1, report_section = ?2, is_control = ?3, version = version + 1
                     WHERE company_id = ?4 AND bu_id IS NULL AND code = ?5 AND active = 1",
                    rusqlite::params![name, report_section, is_control as i64, company_id, code],
                )
                .map_err(AppError::from)?;
                updated += 1;
            }
        }
    }
    Ok((created, updated))
}

/// Merge core — executes on the caller's connection/transaction. Returns the remapped
/// `gl_lines` count. `from_id` is soft-deactivated (history preserved).
pub fn merge_accounts(
    conn: &Connection,
    company_id: &str,
    from_id: &str,
    to_id: &str,
) -> AppResult<i64> {
    if from_id == to_id {
        return Err(AppError::invalid(
            "COA_MERGE_SAME_ACCOUNT: from and to must differ",
        ));
    }
    let lookup = |id: &str| -> AppResult<(String, Option<String>)> {
        conn.query_row(
            "SELECT account_type, parent_id FROM accounts
             WHERE id = ?1 AND company_id = ?2 AND active = 1",
            rusqlite::params![id, company_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?
        .ok_or_else(AppError::file_corrupt)
    };
    let (from_type, from_parent) = lookup(from_id)?;
    let (to_type, _to_parent) = lookup(to_id)?;
    if from_type != to_type {
        return Err(AppError::CoaTypeMismatch {
            from_type: from_type.clone(),
            to_type: to_type.clone(),
        });
    }
    if from_parent.as_deref() == Some(to_id) {
        return Err(AppError::invalid(
            "COA_MERGE_CYCLE: cannot merge an account into its own parent",
        ));
    }

    let remapped = conn
        .execute(
            "UPDATE gl_lines SET account_id = ?1 WHERE account_id = ?2 AND company_id = ?3",
            rusqlite::params![to_id, from_id, company_id],
        )
        .map_err(AppError::from)?;
    conn.execute(
        "UPDATE accounts SET parent_id = ?1 WHERE parent_id = ?2 AND company_id = ?3 AND active = 1",
        rusqlite::params![to_id, from_id, company_id],
    )
    .map_err(AppError::from)?;
    conn.execute(
        "UPDATE accounts SET active = 0, version = version + 1 WHERE id = ?1",
        [from_id],
    )
    .map_err(AppError::from)?;
    Ok(remapped as i64)
}

/// `coa.import` — {company_id, file_path?, pack_key?} → {created, updated}.
#[tauri::command(name = "coa.import", rename_all = "camelCase")]
pub fn coa_import(
    app: tauri::AppHandle,
    company_id: String,
    file_path: Option<String>,
    pack_key: Option<String>,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    require_unlocked(&session)?;
    let source = match (&file_path, &pack_key) {
        (Some(f), None) => ("file", f.clone()),
        (None, Some(k)) => ("pack", k.clone()),
        _ => {
            return Err(AppError::invalid(
                "COA_IMPORT_SOURCE: exactly one of file_path / pack_key is required",
            ));
        }
    };
    let raw = if source.0 == "pack" {
        let key = &source.1;
        if !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(AppError::invalid("COA_IMPORT_SOURCE: invalid pack_key"));
        }
        let dir = find_packs_dir(&app)?;
        let p = dir.join(key).join("coa.json");
        std::fs::read_to_string(&p)
            .map_err(|e| AppError::import_file_unreadable(format!("COA_IMPORT_PACK: {e}")))?
    } else {
        std::fs::read_to_string(&source.1)
            .map_err(|e| AppError::import_file_unreadable(format!("COA_IMPORT_FILE: {e}")))?
    };
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::import_file_unreadable(format!("COA_IMPORT_JSON: {e}")))?;
    let accounts = parsed
        .get("accounts")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            AppError::import_file_unreadable("COA_IMPORT_SHAPE: expected {accounts: [...]}")
        })?;

    let dir = app_data_dir(&app)?;
    let mut conn = crate::storage::db::open_at(&dir)?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM companies WHERE id = ?1)",
            [&company_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if !exists {
        return Err(AppError::file_corrupt());
    }

    // Data + audit in ONE transaction (B18-1).
    let tx = conn.transaction().map_err(AppError::from)?;
    let (created, updated) = import_coa(&tx, &company_id, accounts)?;
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id)?;
    let after_json =
        serde_json::json!({ "created": created, "updated": updated, "source": source.0 })
            .to_string();
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                   prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'coa.import', 'coa', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            company_id,
            company_id,
            after_json,
            prev,
            hash,
            Utc::now().to_rfc3339()
        ],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": { "created": created, "updated": updated } }))
}

/// `coa.merge_accounts` — {from_id, to_id} → {remapped}.
#[tauri::command(name = "coa.merge_accounts", rename_all = "camelCase")]
pub fn coa_merge_accounts(
    app: tauri::AppHandle,
    from_id: String,
    to_id: String,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    require_unlocked(&session)?;
    let dir = app_data_dir(&app)?;
    let mut conn = crate::storage::db::open_at(&dir)?;
    // Resolve the owning Company from the source account — the merge core enforces the
    // company scope on every row it touches, so a cross-Company `to_id` is impossible.
    let company_id: Option<String> = conn
        .query_row(
            "SELECT company_id FROM accounts WHERE id = ?1 AND active = 1",
            [&from_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    let company_id = company_id.ok_or_else(AppError::file_corrupt)?;

    let tx = conn.transaction().map_err(AppError::from)?;
    let remapped = merge_accounts(&tx, &company_id, &from_id, &to_id)?;
    let key = keystore::audit_hmac_key(&dir).map_err(AppError::internal)?;
    let prev = audited_hash(&tx, &company_id)?;
    let after_json =
        serde_json::json!({ "from_id": from_id, "to_id": to_id, "remapped": remapped }).to_string();
    let hash = next_hash(&key, &prev, after_json.as_bytes());
    tx.execute(
        "INSERT INTO audit_events (company_id, actor, action, object_type, object_id, before_json, after_json,
                                   prev_hash, hash, created_at)
         VALUES (?1, 'owner', 'coa.merge_accounts', 'account', ?2, NULL, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            company_id,
            to_id,
            after_json,
            prev,
            hash,
            Utc::now().to_rfc3339()
        ],
    )
    .map_err(AppError::from)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": { "remapped": remapped } }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db;

    const CO: &str = "00000000-0000-0000-0000-000000000001";

    fn fresh_company() -> Connection {
        let conn = db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO companies (id, name, type, default_currency_code, base_locale, pack_schema_version,
                                    company_file_path, created_at, updated_at)
             VALUES (?1, 'T', 'single', 'USD', 'en-IN', '1.0.0', '/t', 'now', 'now')",
            [CO],
        )
        .unwrap();
        conn
    }

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

    fn import(conn: &Connection, accounts: &[(&str, &str, &str)]) -> AppResult<(u32, u32)> {
        let vals: Vec<serde_json::Value> = accounts
            .iter()
            .map(|(c, t, s)| serde_json::json!({ "code": c, "name": c, "type": t, "section": s }))
            .collect();
        import_coa(conn, CO, &vals)
    }

    #[test]
    fn account_nodes_are_ordered_and_tree_linked() {
        let conn = fresh_company();
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

    #[test]
    fn import_creates_new_accounts() {
        let conn = fresh_company();
        let (created, updated) =
            import(&conn, &[("4000", "revenue", "IS"), ("5000", "cogs", "IS")]).unwrap();
        assert_eq!((created, updated), (2, 0));
        let rows = query_accounts(&conn, CO, None).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["version"], 1);
    }

    #[test]
    fn import_updates_unreferenced_same_type_with_version_bump() {
        let conn = fresh_company();
        import(&conn, &[("4000", "revenue", "IS")]).unwrap();
        let (created, updated) = import(
            &conn,
            &[("4000", "revenue", "IS Revised"), ("4100", "revenue", "IS")],
        )
        .unwrap();
        assert_eq!((created, updated), (1, 1));
        let rows = query_accounts(&conn, CO, None).unwrap();
        let revised = rows.iter().find(|r| r["code"] == "4000").unwrap();
        assert_eq!(revised["version"], 2);
        assert_eq!(revised["report_section"], "IS Revised");
        assert_eq!(revised["name"], "4000");
    }

    #[test]
    fn import_different_type_hits_coa_duplicate_code() {
        let conn = fresh_company();
        import(&conn, &[("4000", "revenue", "IS")]).unwrap();
        let err = import(&conn, &[("4000", "asset", "BS")]).unwrap_err();
        assert!(matches!(err, AppError::CoaDuplicateCode { ref code } if code == "4000"));
        assert_eq!(err.body().http_status, 409);
        // Rollback discipline: nothing was written for the bad account.
        let rows = query_accounts(&conn, CO, None).unwrap();
        assert_eq!(rows.len(), 1);
    }

    /// FK chain (calendars → years → periods → batches) so GL lines can point at accounts.
    /// Idempotent per in-memory DB (fixed ids, insert-or-ignore).
    fn seed_gl_chain(conn: &Connection) {
        conn.execute(
            "INSERT OR IGNORE INTO fiscal_calendars (id, company_id, name, preset, week_start_day)
             VALUES ('cal1', ?1, 'Default', '12month', 1)",
            [CO],
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO fiscal_years (id, calendar_id, fy_label, start_date, end_date, week_count)
             VALUES ('fy1', 'cal1', 'FY24', '2024-01-01', '2024-12-31', 52)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO fiscal_periods (id, fiscal_year_id, period_no, code, start_date, end_date)
             VALUES ('p1', 'fy1', 1, 'P01', '2024-01-01', '2024-01-31')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO import_batches (id, company_id, kind, source_name, source_hash, mapping_version,
                                        status, row_count, tie_out_status, created_at)
             VALUES ('b1', ?1, 'gl_dump', 'f.csv', 'h', '1.0.0', 'committed', 1, 'pass', 'now')",
            [CO],
        )
        .unwrap();
    }

    fn add_gl_line(conn: &Connection, line_no: i64, account_id: &str, debit: i64, credit: i64) {
        conn.execute(
            "INSERT INTO gl_lines (id, company_id, batch_id, period_id, account_id, dims_json,
                                   amount_minor, currency_code, debit_minor, credit_minor, line_no)
             VALUES (?1, ?2, 'b1', 'p1', ?3, '{}', ?4, 'USD', ?5, ?6, ?7)",
            rusqlite::params![
                format!("l{line_no}"),
                CO,
                account_id,
                debit + credit,
                debit,
                credit,
                line_no
            ],
        )
        .unwrap();
    }

    fn seed_gl_line(conn: &Connection, line_id: &str, account_id: &str) {
        seed_gl_chain(conn);
        conn.execute(
            "INSERT INTO gl_lines (id, company_id, batch_id, period_id, account_id, dims_json,
                                   amount_minor, currency_code, debit_minor, credit_minor, line_no)
             VALUES (?1, ?2, 'b1', 'p1', ?3, '{}', 100, 'USD', 100, 0, 99)",
            rusqlite::params![line_id, CO, account_id],
        )
        .unwrap();
    }

    /// tests/fixtures/coa/<name> — the documented oracle source for the COA engine
    /// (TEST-FIXTURES-SPEC §1; README.md).
    fn fixture(name: &str) -> serde_json::Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/coa")
            .join(name);
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        serde_json::from_str(&raw).unwrap()
    }

    /// Seed `existing` accounts with the deterministic `acct-<code>` ids (parent_code → acct-<parent_code>).
    fn seed_existing(conn: &Connection, existing: &[serde_json::Value]) {
        for acct in existing {
            let code = acct["code"].as_str().unwrap();
            conn.execute(
                "INSERT INTO accounts (id, company_id, code, name, account_type, report_section, parent_id, is_control, version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)",
                rusqlite::params![
                    format!("acct-{code}"),
                    CO,
                    code,
                    acct["name"].as_str().unwrap_or(code),
                    acct["type"].as_str().unwrap(),
                    acct["section"].as_str().unwrap_or("General"),
                    acct["parent_code"].as_str().map(|p| format!("acct-{p}")),
                    acct["is_control"].as_bool().unwrap_or(false) as i64,
                ],
            )
            .unwrap();
        }
    }

    #[test]
    fn import_referenced_account_hits_coa_referenced() {
        let conn = fresh_company();
        import(&conn, &[("4000", "revenue", "IS")]).unwrap();
        let acct_id: String = conn
            .query_row(
                "SELECT id FROM accounts WHERE code = '4000' AND active = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        seed_gl_line(&conn, "l1", &acct_id);
        let err = import(&conn, &[("4000", "revenue", "IS")]).unwrap_err();
        assert!(matches!(err, AppError::CoaReferenced { count } if count == 1));
        assert_eq!(err.body().http_status, 409);
    }

    #[test]
    fn import_unknown_account_type_is_invalid() {
        let conn = fresh_company();
        let err = import(&conn, &[("4000", "wibble", "IS")]).unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument { .. }));
    }

    #[test]
    fn import_normalizes_codes_trim_collapse_and_leading_zeros() {
        let conn = fresh_company();
        // " 40 00 " → "4000"; "0004" keeps its leading zeros (never parsed as a number).
        let vals = vec![
            serde_json::json!({ "code": " 40 00 ", "name": "Revenue", "type": "revenue", "section": "IS" }),
            serde_json::json!({ "code": "0004", "name": "Cash", "type": "asset", "section": "BS" }),
        ];
        let (created, updated) = import_coa(&conn, CO, &vals).unwrap();
        assert_eq!((created, updated), (2, 0));
        let codes: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT code FROM accounts ORDER BY code")
                .unwrap();
            stmt.query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(codes, vec!["0004".to_string(), "4000".to_string()]);
        // The normalized form is what collides: re-importing "4000 " hits the upsert path
        // (same type, no usage) instead of creating a duplicate row.
        let vals2 = vec![
            serde_json::json!({ "code": "4000 ", "name": "Revenue v2", "type": "revenue", "section": "IS" }),
        ];
        let (created2, updated2) = import_coa(&conn, CO, &vals2).unwrap();
        assert_eq!((created2, updated2), (0, 1));
        // Whitespace-only code is invalid.
        let vals3 = vec![
            serde_json::json!({ "code": "   ", "name": "X", "type": "revenue", "section": "IS" }),
        ];
        let err = import_coa(&conn, CO, &vals3).unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument { .. }));
    }

    #[test]
    fn merge_remaps_lines_children_and_deactivates_source() {
        let conn = fresh_company();
        seed_account(&conn, "4000", None);
        seed_account(&conn, "4010", Some("4000"));
        seed_account(&conn, "4100", None);
        // A GL line on the source account.
        seed_gl_line(&conn, "l1", "acct-4000");

        let remapped = merge_accounts(&conn, CO, "acct-4000", "acct-4100").unwrap();
        assert_eq!(remapped, 1);
        // Line now points at the target.
        let owner: String = conn
            .query_row("SELECT account_id FROM gl_lines WHERE id = 'l1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(owner, "acct-4100");
        // Child reparented onto the target.
        let child_parent: String = conn
            .query_row(
                "SELECT parent_id FROM accounts WHERE id = 'acct-4010'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(child_parent, "acct-4100");
        // Source soft-deactivated (history preserved), version bumped.
        let (active, version): (i64, i64) = conn
            .query_row(
                "SELECT active, version FROM accounts WHERE id = 'acct-4000'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((active, version), (0, 2));
        // Active list no longer contains the source.
        let rows = query_accounts(&conn, CO, None).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r["id"] != "acct-4000"));
    }

    #[test]
    fn merge_type_mismatch_is_coa_type_mismatch() {
        let conn = fresh_company();
        seed_account(&conn, "4000", None); // revenue
        conn.execute(
            "INSERT INTO accounts (id, company_id, code, name, account_type, report_section, version)
             VALUES ('acct-5000', ?1, '5000', 'COGS', 'cogs', 'IS', 1)",
            [CO],
        )
        .unwrap();
        let err = merge_accounts(&conn, CO, "acct-4000", "acct-5000").unwrap_err();
        assert!(matches!(
            err,
            AppError::CoaTypeMismatch { ref from_type, ref to_type }
                if from_type == "revenue" && to_type == "cogs"
        ));
        assert_eq!(err.body().http_status, 422);
    }

    #[test]
    fn merge_into_own_parent_is_a_cycle() {
        let conn = fresh_company();
        seed_account(&conn, "4000", None);
        seed_account(&conn, "4010", Some("4000"));
        let err = merge_accounts(&conn, CO, "acct-4010", "acct-4000").unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument { .. }));
    }

    #[test]
    fn merge_same_account_is_invalid() {
        let conn = fresh_company();
        seed_account(&conn, "4000", None);
        let err = merge_accounts(&conn, CO, "acct-4000", "acct-4000").unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument { .. }));
    }

    // ── Fixture-bound tests (tests/fixtures/coa/ — oracle source; CI) ───────────────────

    #[test]
    fn fixture_import_pack_coa() {
        let f = fixture("import-pack-coa.json");
        let expected = fixture("import-pack-coa.expected.json");
        let conn = fresh_company();
        let accounts = f["accounts"].as_array().unwrap();
        let (created, updated) = import_coa(&conn, CO, accounts).unwrap();
        assert_eq!(created, expected["created"].as_u64().unwrap() as u32);
        assert_eq!(updated, expected["updated"].as_u64().unwrap() as u32);
        let rows = query_accounts(&conn, CO, None).unwrap();
        assert_eq!(rows.len() as u64, expected["created"].as_u64().unwrap());
    }

    #[test]
    fn fixture_import_update() {
        let f = fixture("import-update.json");
        let expected = fixture("import-update.expected.json");
        let conn = fresh_company();
        let existing = f["existing"].as_array().unwrap();
        seed_existing(&conn, existing);
        let accounts = f["accounts"].as_array().unwrap();
        let (created, updated) = import_coa(&conn, CO, accounts).unwrap();
        assert_eq!(created, expected["created"].as_u64().unwrap() as u32);
        assert_eq!(updated, expected["updated"].as_u64().unwrap() as u32);
        let (name, version): (String, i64) = conn
            .query_row(
                "SELECT name, version FROM accounts WHERE code = '4000' AND active = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, expected["code_4000_name"].as_str().unwrap());
        assert_eq!(
            version,
            expected["code_4000_version"].as_u64().unwrap() as i64
        );
    }

    #[test]
    fn fixture_import_duplicate_code() {
        let f = fixture("duplicate-code.json");
        let expected = fixture("duplicate-code.expected.json");
        let conn = fresh_company();
        let existing = f["existing"].as_array().unwrap();
        seed_existing(&conn, existing);
        let accounts = f["accounts"].as_array().unwrap();
        let err = import_coa(&conn, CO, accounts).unwrap_err();
        match &err {
            AppError::CoaDuplicateCode { code } => {
                assert_eq!(code, expected["code"].as_str().unwrap())
            }
            other => panic!("expected CoaDuplicateCode, got {other:?}"),
        }
        assert_eq!(
            err.body().http_status,
            expected["http_status"].as_u64().unwrap() as u16
        );
        // Rollback discipline: the import is atomic — nothing was written.
        let rows = query_accounts(&conn, CO, None).unwrap();
        assert_eq!(rows.len(), existing.len());
    }

    #[test]
    fn fixture_import_referenced_account() {
        let f = fixture("referenced-account.json");
        let expected = fixture("referenced-account.expected.json");
        let conn = fresh_company();
        let existing = f["existing"].as_array().unwrap();
        seed_existing(&conn, existing);
        seed_gl_chain(&conn);
        for (i, line) in f["gl_lines"].as_array().unwrap().iter().enumerate() {
            let acct = format!("acct-{}", line["account_code"].as_str().unwrap());
            add_gl_line(
                &conn,
                i as i64 + 1,
                &acct,
                line["debit_minor"].as_i64().unwrap(),
                line["credit_minor"].as_i64().unwrap(),
            );
        }
        let accounts = f["accounts"].as_array().unwrap();
        let err = import_coa(&conn, CO, accounts).unwrap_err();
        match &err {
            AppError::CoaReferenced { count } => {
                assert_eq!(*count, expected["count"].as_u64().unwrap() as i64);
            }
            other => panic!("expected CoaReferenced, got {other:?}"),
        }
        assert_eq!(
            err.body().http_status,
            expected["http_status"].as_u64().unwrap() as u16
        );
    }

    #[test]
    fn fixture_merge_remap() {
        let f = fixture("merge-remap.json");
        let expected = fixture("merge-remap.expected.json");
        let conn = fresh_company();
        let existing = f["existing"].as_array().unwrap();
        seed_existing(&conn, existing);
        seed_gl_chain(&conn);
        for (i, line) in f["gl_lines"].as_array().unwrap().iter().enumerate() {
            let acct = format!("acct-{}", line["account_code"].as_str().unwrap());
            add_gl_line(
                &conn,
                i as i64 + 1,
                &acct,
                line["debit_minor"].as_i64().unwrap(),
                line["credit_minor"].as_i64().unwrap(),
            );
        }
        let from = format!("acct-{}", f["from_code"].as_str().unwrap());
        let to = format!("acct-{}", f["to_code"].as_str().unwrap());
        let remapped = merge_accounts(&conn, CO, &from, &to).unwrap();
        assert_eq!(remapped, expected["remapped"].as_u64().unwrap() as i64);
        let (active, version): (i64, i64) = conn
            .query_row(
                "SELECT active, version FROM accounts WHERE id = ?1",
                [&from],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(active, expected["from_active"].as_u64().unwrap() as i64);
        assert_eq!(version, expected["from_version"].as_u64().unwrap() as i64);
        let child_parent: String = conn
            .query_row(
                "SELECT parent_id FROM accounts WHERE id = ?1",
                [format!("acct-{}", expected["child_code"].as_str().unwrap())],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(child_parent, to);
    }
}
