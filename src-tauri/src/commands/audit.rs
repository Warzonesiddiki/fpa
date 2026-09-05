//! Audit Trail read commands (F-033 · US-034 · S-070 · API-SPEC §2 `audit.list`).
//!
//! Command:
//! - `audit.list`: `{company_id, filters, page}` → `{events[], chain_status, meta, facets}`
//!   Errors: AUDIT_CHAIN_BREAK (409, only when the *session* is already degraded and a
//!   write is attempted — this read path NEVER errors on a broken chain, see below),
//!   SESSION_LOCKED (401), VALUE_INVALID (422), INTERNAL (500).
//!
//! Invariants:
//! - **Read-only, always.** `audit_events` is append-only (B7 / WIREFRAMES-ANALYTICS S-070:
//!   "No edit/delete control exists in this screen's geometry at all"). This module contains
//!   no INSERT/UPDATE/DELETE against `audit_events`, and reading the log is not itself an
//!   auditable mutation.
//! - **A broken chain must stay readable.** US-034 requires the tamper to be *shown*, not
//!   hidden: the verdict rides the response as `chain_status {verified, broken_at_seq}` so
//!   the auditor can inspect exactly where the chain fails. `AUDIT_CHAIN_BREAK` as an error
//!   is reserved for mutations (`require_session_write`), which is where read-only mode is
//!   enforced (AUTH-SPEC §2.5).
//! - **Company scoping is mandatory.** Chains are per-Company (`company.rs::audited_hash`);
//!   the requested `company_id` must be the unlocked one, otherwise VALUE_INVALID — never a
//!   cross-Company read.
//! - **Verification uses the keychain HMAC key** via `company::verify_company_chain`, i.e.
//!   the same replay the unlock path runs (ADR-011) — one owner, no second implementation.
//! - **Payloads are returned verbatim.** `before_json`/`after_json` are the exact stored
//!   strings that were hashed; re-serializing them would break byte-for-byte verifiability,
//!   so no money is ever parsed, re-rounded or reformatted here (B3/B6).
//! - Pagination is a stable `seq DESC` window (seq is AUTOINCREMENT = chain order); count,
//!   page and facets are read inside one transaction so a concurrent append cannot produce
//!   metadata from two different database states (same discipline as `import.history`).

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::company::{app_data_dir, verify_company_chain};
use crate::commands::session::{SessionState, require_unlocked};
use crate::core::error::{AppError, AppResult};
use crate::storage::db;

/// Rows per page (mirrored by `MOCK_AUDIT_PAGE_SIZE` in the TS dev preview).
pub const AUDIT_PAGE_SIZE: i64 = 50;

/// Toolbar filters (SCREENS-SPEC S-070). Every field is optional narrowing over a real
/// `audit_events` column — nothing here implies a capability the table cannot answer.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct AuditFilters {
    /// Inclusive ISO-8601 lower bound on `created_at` (string compare on RFC3339 UTC).
    pub from: Option<String>,
    /// Inclusive ISO-8601 upper bound on `created_at`.
    pub to: Option<String>,
    pub actor: Option<String>,
    pub action: Option<String>,
    pub object_type: Option<String>,
    pub object_id: Option<String>,
}

/// One immutable audit event as stored (payloads verbatim — see module docs).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditEventRow {
    pub seq: i64,
    pub actor: String,
    pub action: String,
    pub object_type: String,
    pub object_id: String,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub prev_hash: String,
    pub hash: String,
    pub created_at: String,
}

/// Chain verdict as DATA (US-034): a tampered Company is still fully readable.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditChainStatus {
    pub verified: bool,
    pub broken_at_seq: Option<i64>,
    pub event_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditListMeta {
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
    pub total_pages: i64,
}

/// Distinct values present in the Company's chain — the toolbar's actor/action/object selects.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditFacets {
    pub actors: Vec<String>,
    pub actions: Vec<String>,
    pub object_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditListResponse {
    pub events: Vec<AuditEventRow>,
    pub chain_status: AuditChainStatus,
    pub meta: AuditListMeta,
    pub facets: AuditFacets,
}

/// Build the shared `WHERE` fragment + bound parameters for the filter set.
///
/// Parameters are always bound (never interpolated) — an actor/action value coming from the
/// UI can therefore never reach SQL as syntax. `?1` is always `company_id`.
fn filter_clause(filters: &AuditFilters) -> (String, Vec<String>) {
    let mut sql = String::from(" WHERE company_id = ?1");
    let mut params: Vec<String> = Vec::new();
    // (column, comparison operator, value) in a fixed order so the parameter indices are
    // deterministic and match the LIMIT/OFFSET indices computed by the caller.
    let candidates: [(&str, &str, Option<&str>); 6] = [
        ("created_at", ">=", filters.from.as_deref()),
        ("created_at", "<=", filters.to.as_deref()),
        ("actor", "=", filters.actor.as_deref()),
        ("action", "=", filters.action.as_deref()),
        ("object_type", "=", filters.object_type.as_deref()),
        ("object_id", "=", filters.object_id.as_deref()),
    ];
    for (column, op, value) in candidates {
        // A blank string is "no filter", never a literal match on empty text.
        let Some(value) = value.filter(|s| !s.trim().is_empty()) else {
            continue;
        };
        let index = params.len() + 2; // ?1 is company_id
        sql.push_str(&format!(" AND {column} {op} ?{index}"));
        params.push(value.to_string());
    }
    (sql, params)
}

/// Distinct column values across the WHOLE Company chain (not the filtered page): the
/// toolbar must keep offering every value even after a filter narrows the result to none.
fn facet_values(conn: &Connection, company_id: &str, column: &str) -> AppResult<Vec<String>> {
    // `column` is never user input — the three call sites below pass literals.
    let sql = format!(
        "SELECT DISTINCT {column} FROM audit_events WHERE company_id = ?1 ORDER BY {column} ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
    let rows = stmt
        .query_map([company_id], |r| r.get::<_, String>(0))
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    Ok(rows)
}

/// Engine core, transaction-scoped so counts/rows/facets share one snapshot.
pub fn audit_list_internal(
    conn: &Connection,
    company_id: &str,
    filters: &AuditFilters,
    page: i64,
    chain_broken_at: Option<i64>,
) -> AppResult<AuditListResponse> {
    if page < 1 {
        return Err(AppError::invalid("AUDIT_PAGE_INVALID: page starts at 1"));
    }
    let offset = page
        .checked_sub(1)
        .and_then(|p| p.checked_mul(AUDIT_PAGE_SIZE))
        .ok_or_else(|| AppError::invalid("AUDIT_PAGE_INVALID: page is too large"))?;

    let (where_sql, filter_params) = filter_clause(filters);
    let mut bound: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(filter_params.len() + 1);
    bound.push(&company_id);
    for value in &filter_params {
        bound.push(value);
    }

    let total: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM audit_events{where_sql}"),
            bound.as_slice(),
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    let total_pages = if total == 0 {
        0
    } else {
        total
            .checked_add(AUDIT_PAGE_SIZE - 1)
            .ok_or_else(|| AppError::invalid("AUDIT_TOTAL_OVERFLOW"))?
            / AUDIT_PAGE_SIZE
    };

    let limit_index = filter_params.len() + 2;
    let offset_index = filter_params.len() + 3;
    let page_sql = format!(
        "SELECT seq, actor, action, object_type, object_id, before_json, after_json,
                prev_hash, hash, created_at
           FROM audit_events{where_sql}
          ORDER BY seq DESC
          LIMIT ?{limit_index} OFFSET ?{offset_index}"
    );
    let mut page_bound: Vec<&dyn rusqlite::ToSql> = bound.clone();
    page_bound.push(&AUDIT_PAGE_SIZE);
    page_bound.push(&offset);
    let mut stmt = conn.prepare(&page_sql).map_err(AppError::from)?;
    let events = stmt
        .query_map(page_bound.as_slice(), |r| {
            Ok(AuditEventRow {
                seq: r.get(0)?,
                actor: r.get(1)?,
                action: r.get(2)?,
                object_type: r.get(3)?,
                object_id: r.get(4)?,
                before_json: r.get(5)?,
                after_json: r.get(6)?,
                prev_hash: r.get(7)?,
                hash: r.get(8)?,
                created_at: r.get(9)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    let event_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_events WHERE company_id = ?1",
            [company_id],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;

    Ok(AuditListResponse {
        events,
        chain_status: AuditChainStatus {
            verified: chain_broken_at.is_none(),
            broken_at_seq: chain_broken_at,
            event_count,
        },
        meta: AuditListMeta {
            page,
            page_size: AUDIT_PAGE_SIZE,
            total,
            total_pages,
        },
        facets: AuditFacets {
            actors: facet_values(conn, company_id, "actor")?,
            actions: facet_values(conn, company_id, "action")?,
            object_types: facet_values(conn, company_id, "object_type")?,
        },
    })
}

/// `audit.list` — the Company-scoped, read-only Audit Trail page behind S-070.
#[tauri::command(name = "audit.list", rename_all = "snake_case")]
pub fn audit_list(
    app: AppHandle,
    company_id: String,
    filters: Option<AuditFilters>,
    page: i64,
    session: State<'_, SessionState>,
) -> AppResult<serde_json::Value> {
    // Read path: an unlocked session is enough. A degraded (read-only) session must still be
    // able to READ its own chain — that is the whole point of the tamper flow (US-034).
    let active_company_id = require_unlocked(&session)?;
    if company_id != active_company_id {
        return Err(AppError::invalid(
            "AUDIT_COMPANY_MISMATCH: open the requested Company first",
        ));
    }
    let filters = filters.unwrap_or_default();

    let dir = app_data_dir(&app)?;
    let mut conn = db::open_at(&dir)?;
    let tx = conn.transaction().map_err(AppError::from)?;
    // Verify against the keychain HMAC key using the SAME replay the unlock path runs
    // (company::verify_company_chain) — one owner for chain verification (B14).
    let chain_broken_at = verify_company_chain(&tx, &dir, &company_id)?;
    let data = audit_list_internal(&tx, &company_id, &filters, page, chain_broken_at)?;
    tx.commit().map_err(AppError::from)?;

    Ok(serde_json::json!({ "data": data }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert(conn: &Connection, company: &str, actor: &str, action: &str, object_type: &str, created_at: &str) {
        conn.execute(
            "INSERT INTO audit_events
               (company_id, actor, action, object_type, object_id, before_json, after_json,
                prev_hash, hash, created_at)
             VALUES (?1, ?2, ?3, ?4, 'obj-1', NULL, '{\"k\":1}', 'prev', 'hash', ?5)",
            rusqlite::params![company, actor, action, object_type, created_at],
        )
        .unwrap();
    }

    fn fresh() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE audit_events (
                 seq INTEGER PRIMARY KEY AUTOINCREMENT,
                 company_id TEXT NOT NULL,
                 actor TEXT NOT NULL,
                 action TEXT NOT NULL,
                 object_type TEXT NOT NULL,
                 object_id TEXT NOT NULL,
                 before_json TEXT,
                 after_json TEXT,
                 prev_hash TEXT NOT NULL,
                 hash TEXT NOT NULL,
                 created_at TEXT NOT NULL
             );",
        )
        .unwrap();
        insert(&conn, "c1", "owner", "company.create", "company", "2026-01-01T00:00:00Z");
        insert(&conn, "c1", "owner", "import.commit", "import_batch", "2026-02-01T00:00:00Z");
        insert(&conn, "c1", "reviewer", "scenario.approve", "scenario", "2026-03-01T00:00:00Z");
        insert(&conn, "c2", "owner", "company.create", "company", "2026-01-15T00:00:00Z");
        conn
    }

    #[test]
    fn lists_newest_first_and_is_company_scoped() {
        let conn = fresh();
        let out =
            audit_list_internal(&conn, "c1", &AuditFilters::default(), 1, None).unwrap();
        assert_eq!(out.events.len(), 3, "c2's event must never appear");
        assert!(out.events[0].seq > out.events[1].seq, "seq DESC");
        assert_eq!(out.meta.total, 3);
        assert_eq!(out.meta.total_pages, 1);
        assert_eq!(out.chain_status.event_count, 3);
        assert!(out.chain_status.verified);
        assert_eq!(out.chain_status.broken_at_seq, None);
    }

    #[test]
    fn filters_narrow_rows_but_facets_stay_whole_chain() {
        let conn = fresh();
        let filters = AuditFilters {
            actor: Some("reviewer".into()),
            ..Default::default()
        };
        let out = audit_list_internal(&conn, "c1", &filters, 1, None).unwrap();
        assert_eq!(out.events.len(), 1);
        assert_eq!(out.events[0].action, "scenario.approve");
        assert_eq!(out.meta.total, 1);
        // Facets still offer every value in the Company chain so the filter is reversible.
        assert_eq!(out.facets.actors, vec!["owner".to_string(), "reviewer".to_string()]);
        assert!(out.facets.actions.contains(&"import.commit".to_string()));
        assert_eq!(out.chain_status.event_count, 3);
    }

    #[test]
    fn date_range_is_inclusive_on_both_bounds() {
        let conn = fresh();
        let filters = AuditFilters {
            from: Some("2026-02-01T00:00:00Z".into()),
            to: Some("2026-03-01T00:00:00Z".into()),
            ..Default::default()
        };
        let out = audit_list_internal(&conn, "c1", &filters, 1, None).unwrap();
        assert_eq!(out.events.len(), 2);
        let filters_single = AuditFilters {
            from: Some("2026-02-01T00:00:00Z".into()),
            to: Some("2026-02-01T00:00:00Z".into()),
            ..Default::default()
        };
        let single = audit_list_internal(&conn, "c1", &filters_single, 1, None).unwrap();
        assert_eq!(single.events.len(), 1);
    }

    #[test]
    fn blank_filter_strings_are_ignored_not_matched() {
        let conn = fresh();
        let filters = AuditFilters {
            actor: Some("   ".into()),
            action: Some("".into()),
            ..Default::default()
        };
        let out = audit_list_internal(&conn, "c1", &filters, 1, None).unwrap();
        assert_eq!(out.events.len(), 3, "empty filters must not exclude everything");
    }

    #[test]
    fn a_broken_chain_is_reported_as_data_and_stays_readable() {
        let conn = fresh();
        let out = audit_list_internal(&conn, "c1", &AuditFilters::default(), 1, Some(2)).unwrap();
        assert!(!out.chain_status.verified);
        assert_eq!(out.chain_status.broken_at_seq, Some(2));
        assert_eq!(out.events.len(), 3, "tampered chains remain fully readable");
    }

    #[test]
    fn pagination_is_stable_and_page_zero_is_rejected() {
        let conn = fresh();
        for i in 0..60 {
            insert(
                &conn,
                "c1",
                "owner",
                "model.cell.set.v1",
                "cell",
                &format!("2026-04-{:02}T00:00:00Z", (i % 28) + 1),
            );
        }
        let p1 = audit_list_internal(&conn, "c1", &AuditFilters::default(), 1, None).unwrap();
        assert_eq!(p1.events.len(), AUDIT_PAGE_SIZE as usize);
        assert_eq!(p1.meta.total, 63);
        assert_eq!(p1.meta.total_pages, 2);
        let p2 = audit_list_internal(&conn, "c1", &AuditFilters::default(), 2, None).unwrap();
        assert_eq!(p2.events.len(), 13);
        // No overlap between pages (stable seq DESC ordering).
        let p1_last = p1.events.last().unwrap().seq;
        assert!(p2.events[0].seq < p1_last);
        assert!(audit_list_internal(&conn, "c1", &AuditFilters::default(), 0, None).is_err());
    }

    #[test]
    fn payload_strings_are_returned_verbatim() {
        let conn = fresh();
        let out = audit_list_internal(&conn, "c1", &AuditFilters::default(), 1, None).unwrap();
        // Exactly the bytes stored (and hashed) — never re-serialized.
        assert_eq!(out.events[0].after_json.as_deref(), Some("{\"k\":1}"));
        assert_eq!(out.events[0].before_json, None);
    }

    #[test]
    fn empty_company_yields_empty_page_not_an_error() {
        let conn = fresh();
        let out = audit_list_internal(&conn, "c-none", &AuditFilters::default(), 1, None).unwrap();
        assert!(out.events.is_empty());
        assert_eq!(out.meta.total, 0);
        assert_eq!(out.meta.total_pages, 0);
        assert_eq!(out.chain_status.event_count, 0);
        assert!(out.facets.actors.is_empty());
    }

}
