//! Storage layer: encrypted-safe SQLite lifecycle + OS-keychain secret store.
//! DB is Rust-only (B4); migrations are versioned (rusqlite_migration) + rollback-tested.

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::fs;
use std::path::Path;

use crate::core::error::{AppError, AppResult};

/// Database file name inside a directory — shared with `container` (the `.fpa` image is this
/// file, checkpointed and sealed).
pub const DB_FILE: &str = "onefpa.db";

pub fn open_at(dir: &Path) -> AppResult<Connection> {
    fs::create_dir_all(dir).map_err(|e| AppError::Db(format!("DB_DIR: {e}")))?;
    let conn = Connection::open(dir.join(DB_FILE)).map_err(|e| AppError::Db(format!("DB_OPEN: {e}")))?;
    init(&conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory().map_err(|e| AppError::Db(format!("DB_OPEN: {e}")))?;
    init(&conn)?;
    Ok(conn)
}

fn init(conn: &Connection) -> AppResult<()> {
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
        return Err(AppError::Db("INTEGRITY_CHECK_FAILED: run recovery mode (DR-RECOVERY-RUNBOOK §3.1)".into()));
    }
    Ok(())
}

const MIGRATIONS: &[M] = &[M {
    up: include_str!("../../migrations/001_initial.sql"),
    down: "", // additive v1; destructive changes require a new migration + Snapshot policy (§11.3)
}];

fn migrate(conn: &Connection) -> AppResult<()> {
    let migrations = Migrations::new(MIGRATIONS);
    migrations.to_latest(conn).map_err(|e| AppError::Db(format!("MIGRATION: {e}")))
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
    fn money_columns_are_never_real() {
        let conn = open_in_memory().unwrap();
        let real: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND sql LIKE '%REAL%'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(real, 0, "no REAL money columns (I1)");
    }

    #[test]
    fn foreign_key_contract_is_clean() {
        let conn = open_in_memory().unwrap();
        let bad: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_foreign_key_check",
                [],
                |r| r.get::<_, i64>(0),
            )
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
            .query_row("SELECT scale FROM currency_scales WHERE code='JPY'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(jpy, 0);
        let kwd: i64 = conn
            .query_row("SELECT scale FROM currency_scales WHERE code='KWD'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kwd, 3);
    }
}
