//! Repositories — the only place in the engine allowed to execute SQL.
//!
//! Conventions:
//! * Every tenant-scoped function takes `school_id` explicitly and filters on
//!   it (ADR-0002: tenant isolation is enforced by the engine, not the UI).
//! * Rows are plain serde-friendly structs so crates above can serialize them
//!   into APIs without re-mapping.
//! * Functions take `&Connection` and never own transactions; callers decide
//!   transaction boundaries via `Database::tx` (batching = fewer commits =
//!   performance).

mod backup;
mod conflict;
mod exams;
mod identity;
mod licence;
mod session;
mod sync;
mod users;

pub use backup::{BackupsRepo, BackgroundJobRow, BackgroundJobsRepo, UpdateHistoryRepo, UpdateStateRow};
pub use conflict::{ConflictRow, ConflictsRepo, ConflictStatus, ConflictStrategy};
pub use exams::{
    AttemptEventRow, AttemptRow, AttemptsRepo, CollectionReceiptRow, CollectionReceiptsRepo,
    PackageRow, PackagesRepo,
};
pub use identity::{DeviceRow, DevicesRepo, TrustRepo, TrustState};
pub use licence::LicencesRepo;
pub use session::{LoginAttemptsRepo, SessionRow, SessionsRepo};
pub use sync::{
    BlobRepo, CheckpointsRepo, JobKind, JobRow, JobStatus, JobsRepo, ObjectRow, ObjectSummary,
    ObjectsRepo, OpRow, OpsRepo,
};
pub use users::{RoleRow, UserRow, UsersRepo};

use crate::error::StorageError;
use crate::StorageResult;
use rusqlite::Connection;

/// Execute a write statement with statement caching (rusqlite only caches
/// via prepare_cached; this keeps call sites one line while retaining the
/// performance benefit).
pub(crate) fn exec(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> StorageResult<usize> {
    let mut stmt = conn.prepare_cached(sql)?;
    Ok(stmt.execute(params)?)
}

// ---------------------------------------------------------------------------
// kv — small engine state (lamport clocks, install id, feature flags)
// ---------------------------------------------------------------------------

pub struct KvRepo;

impl KvRepo {
    pub fn get(conn: &Connection, key: &str) -> StorageResult<Option<String>> {
        let mut stmt = conn.prepare_cached("SELECT value FROM kv WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn set(conn: &Connection, key: &str, value: &str) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    pub fn delete(conn: &Connection, key: &str) -> StorageResult<bool> {
        let changed = exec(conn, "DELETE FROM kv WHERE key = ?1", [key])?;
        Ok(changed > 0)
    }
}

// ---------------------------------------------------------------------------
// schools — tenant registry
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct SchoolRow {
    pub school_id: String,
    pub name: String,
    pub settings_json: String,
    pub enrolled_at: String,
}

pub struct SchoolsRepo;

impl SchoolsRepo {
    pub fn enroll(conn: &Connection, school_id: &str, name: &str) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO schools (school_id, name, enrolled_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(school_id) DO NOTHING",
            rusqlite::params![school_id, name, crate::now_rfc3339()],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, school_id: &str) -> StorageResult<SchoolRow> {
        let mut stmt = conn.prepare_cached(
            "SELECT school_id, name, settings_json, enrolled_at
             FROM schools WHERE school_id = ?1",
        )?;
        stmt.query_row([school_id], |row| {
            Ok(SchoolRow {
                school_id: row.get(0)?,
                name: row.get(1)?,
                settings_json: row.get(2)?,
                enrolled_at: row.get(3)?,
            })
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                entity: "school",
                id: school_id.to_string(),
            },
            other => other.into(),
        })
    }

    pub fn exists(conn: &Connection, school_id: &str) -> StorageResult<bool> {
        let mut stmt = conn.prepare_cached("SELECT 1 FROM schools WHERE school_id = ?1")?;
        Ok(stmt.exists([school_id])?)
    }

    pub fn list(conn: &Connection) -> StorageResult<Vec<SchoolRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT school_id, name, settings_json, enrolled_at FROM schools ORDER BY enrolled_at",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SchoolRow {
                    school_id: row.get(0)?,
                    name: row.get(1)?,
                    settings_json: row.get(2)?,
                    enrolled_at: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn update_settings(conn: &Connection, school_id: &str, settings_json: &str) -> StorageResult<()> {
        let changed = exec(conn, 
            "UPDATE schools SET settings_json = ?2 WHERE school_id = ?1",
            rusqlite::params![school_id, settings_json],
        )?;
        if changed == 0 {
            return Err(StorageError::NotFound { entity: "school", id: school_id.to_string() });
        }
        Ok(())
    }
}
