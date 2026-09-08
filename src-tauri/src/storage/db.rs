//! Storage layer: encrypted-safe SQLite lifecycle + OS-keychain secret store.
//! DB is Rust-only (B4); migrations are versioned (rusqlite_migration) + rollback-tested.

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};
use std::fs;
use std::path::Path;

use crate::core::error::{AppError, AppResult};

/// Database file name inside a directory — shared with `container` (the `.fpa` image is this
/// file, checkpointed and sealed).
pub const DB_FILE: &str = "onefpa.db";

pub fn open_at(dir: &Path) -> AppResult<Connection> {
    fs::create_dir_all(dir).map_err(|e| AppError::Db(format!("DB_DIR: {e}")))?;
    let mut conn =
        Connection::open(dir.join(DB_FILE)).map_err(|e| AppError::Db(format!("DB_OPEN: {e}")))?;
    init(&mut conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> AppResult<Connection> {
    let mut conn =
        Connection::open_in_memory().map_err(|e| AppError::Db(format!("DB_OPEN: {e}")))?;
    init(&mut conn)?;
    Ok(conn)
}

fn init(conn: &mut Connection) -> AppResult<()> {
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| AppError::Db(e.to_string()))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| AppError::Db(e.to_string()))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| AppError::Db(e.to_string()))?;
    migrate(conn)?;
    // integrity gate on open (silent failure is forbidden — DATABASE-SCHEMA §11.1)
    let ok: bool = conn
        .query_row("PRAGMA integrity_check", [], |r| {
            let val: String = r.get(0)?;
            Ok(val == "ok")
        })
        .map_err(AppError::from)?;
    if !ok {
        return Err(AppError::Db(
            "INTEGRITY_CHECK_FAILED: run recovery mode (DR-RECOVERY-RUNBOOK §3.1)".to_string(),
        ));
    }
    Ok(())
}

fn migrate(conn: &mut Connection) -> AppResult<()> {
    migrations()
        .to_latest(conn)
        .map_err(|e| AppError::Db(format!("MIGRATION: {e}")))
}

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/001_initial.sql")),
        M::up(include_str!("../../migrations/002_packs_description.sql"))
            .down("ALTER TABLE packs DROP COLUMN description;"),
        M::up(include_str!(
            "../../migrations/003_fiscal_year_archived_at.sql"
        ))
        .down("ALTER TABLE fiscal_years DROP COLUMN archived_at;"),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_applies_and_schema_is_complete() {
        let conn = open_in_memory().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 56, "DATABASE-SCHEMA.md claims 56 tables");
    }

    #[test]
    fn migration_forward_rollback_roundtrip() {
        // DATABASE-SCHEMA §11: every migration must survive a down→up cycle.
        let mut conn = open_in_memory().unwrap();
        migrations()
            .to_version(&mut conn, 1)
            .map_err(|e| panic!("rollback to v1 failed: {e}"))
            .unwrap();
        let has_description: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('packs') WHERE name='description'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_description, 0, "002.down must drop packs.description");
        migrations()
            .to_latest(&mut conn)
            .map_err(|e| panic!("re-apply to latest failed: {e}"))
            .unwrap();
        let has_description: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('packs') WHERE name='description'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            has_description, 1,
            "re-apply must restore packs.description"
        );
    }

    #[test]
    fn migrated_v1_schema_equals_fresh_schema() {
        // DATABASE-SCHEMA §11: a v1 database migrated to latest must be structurally
        // IDENTICAL to a fresh install — a user who upgrades must never hold a different
        // schema than a new user. Catches lossy down-migrations (a down that drops an index
        // or narrows a type makes the down→up cycle drift from the fresh path) and
        // hand-edit divergence between the paths. The comparison is the full sqlite_master
        // dump (type, name, tbl_name, sql) — tables, indexes, views, triggers.
        let mut migrated = Connection::open_in_memory().unwrap();
        migrations()
            .to_version(&mut migrated, 1)
            .map_err(|e| panic!("rollback to v1 failed: {e}"))
            .unwrap();
        migrations()
            .to_latest(&mut migrated)
            .map_err(|e| panic!("migrate v1→latest failed: {e}"))
            .unwrap();

        let fresh = open_in_memory().unwrap();

        let dump = |conn: &Connection| -> Vec<(String, String, String, String)> {
            let mut stmt = conn
                .prepare(
                    "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master
                     ORDER BY type, name",
                )
                .unwrap();
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            rows
        };

        let a = dump(&migrated);
        let b = dump(&fresh);
        assert_eq!(a.len(), b.len(), "object count differs: migrated vs fresh");
        for (m, f) in a.iter().zip(b.iter()) {
            assert_eq!(
                m, f,
                "sqlite_master object {} differs between migrated and fresh",
                m.1
            );
        }
    }

    #[test]
    fn money_columns_are_never_real() {
        let conn = open_in_memory().unwrap();
        let real: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND sql LIKE '%REAL%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(real, 0, "no REAL money columns (I1)");
    }

    #[test]
    fn foreign_key_contract_is_clean() {
        let conn = open_in_memory().unwrap();
        let bad: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap();
        assert_eq!(bad, 0);
    }

    #[test]
    fn currency_scales_are_seeded_exact() {
        let conn = open_in_memory().unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM currency_scales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 10);
        let jpy: i64 = conn
            .query_row(
                "SELECT scale FROM currency_scales WHERE code='JPY'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(jpy, 0);
        let kwd: i64 = conn
            .query_row(
                "SELECT scale FROM currency_scales WHERE code='KWD'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kwd, 3);
    }
}
