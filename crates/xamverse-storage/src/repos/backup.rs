//! Backup metadata, update history and generic background jobs.

use super::exec;
use crate::error::{StorageError, StorageResult};
use crate::now_rfc3339;
use rusqlite::{params, Connection};

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackupRow {
    pub backup_id: String,
    pub kind: String, // full | scoped
    pub school_scope: Option<String>,
    pub path: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub schema_version: i64,
    pub device_id: String,
    pub verified: bool,
    pub created_at: String,
    pub retention_until: Option<String>,
}

pub struct BackupsRepo;

impl BackupsRepo {
    pub fn insert(conn: &Connection, backup: &BackupRow) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO backups (backup_id, kind, school_scope, path, size_bytes, sha256,
                                  schema_version, device_id, verified, created_at, retention_until)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                backup.backup_id,
                backup.kind,
                backup.school_scope,
                backup.path,
                backup.size_bytes,
                backup.sha256,
                backup.schema_version,
                backup.device_id,
                backup.verified as i64,
                backup.created_at,
                backup.retention_until,
            ],
        )?;
        Ok(())
    }

    pub fn list(conn: &Connection) -> StorageResult<Vec<BackupRow>> {
        let mut stmt = conn.prepare_cached(&format!(
            "{} ORDER BY created_at DESC",
            Self::SELECT
        ))?;
        let rows = stmt
            .query_map([], Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get(conn: &Connection, backup_id: &str) -> StorageResult<BackupRow> {
        let mut stmt = conn.prepare_cached(&format!("{} WHERE backup_id = ?1", Self::SELECT))?;
        stmt.query_row([backup_id], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "backup",
                    id: backup_id.to_string(),
                },
                other => other.into(),
            })
    }

    pub fn mark_verified(conn: &Connection, backup_id: &str) -> StorageResult<()> {
        exec(conn, 
            "UPDATE backups SET verified = 1 WHERE backup_id = ?1",
            [backup_id],
        )?;
        Ok(())
    }

    /// Retention enforcement: delete the oldest rows beyond `keep`.
    pub fn prune_beyond(conn: &Connection, keep: i64) -> StorageResult<u64> {
        let changed = exec(conn, 
            "DELETE FROM backups WHERE backup_id NOT IN (
                SELECT backup_id FROM backups ORDER BY created_at DESC LIMIT ?1
             )",
            [keep],
        )?;
        Ok(changed as u64)
    }

    const SELECT: &'static str = "SELECT backup_id, kind, school_scope, path, size_bytes,
                 sha256, schema_version, device_id, verified, created_at, retention_until
          FROM backups";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BackupRow> {
        Ok(BackupRow {
            backup_id: row.get(0)?,
            kind: row.get(1)?,
            school_scope: row.get(2)?,
            path: row.get(3)?,
            size_bytes: row.get(4)?,
            sha256: row.get(5)?,
            schema_version: row.get(6)?,
            device_id: row.get(7)?,
            verified: row.get::<_, i64>(8)? != 0,
            created_at: row.get(9)?,
            retention_until: row.get(10)?,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UpdateStateRow {
    pub update_id: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub state: String, // imported | verified | staged | applied | failed | rejected
    pub manifest_json: Option<String>,
    pub note: Option<String>,
    pub at: String,
}

pub struct UpdateHistoryRepo;

impl UpdateHistoryRepo {
    pub fn insert(conn: &Connection, row: &UpdateStateRow) -> StorageResult<()> {
        exec(conn, 
            "INSERT OR REPLACE INTO update_history
                (update_id, version, platform, arch, state, manifest_json, note, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                row.update_id,
                row.version,
                row.platform,
                row.arch,
                row.state,
                row.manifest_json,
                row.note,
                row.at,
            ],
        )?;
        Ok(())
    }

    pub fn set_state(conn: &Connection, update_id: &str, state: &str, note: Option<&str>) -> StorageResult<()> {
        let changed = exec(conn, 
            "UPDATE update_history SET state = ?2, note = ?3, at = ?4 WHERE update_id = ?1",
            params![update_id, state, note, now_rfc3339()],
        )?;
        if changed == 0 {
            return Err(StorageError::NotFound {
                entity: "update",
                id: update_id.to_string(),
            });
        }
        Ok(())
    }

    pub fn history(conn: &Connection, limit: i64) -> StorageResult<Vec<UpdateStateRow>> {
        let mut stmt = conn.prepare_cached(&format!(
            "{} ORDER BY at DESC LIMIT {}",
            Self::SELECT,
            limit
        ))?;
        let rows = stmt
            .query_map([], Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn latest(conn: &Connection) -> StorageResult<Option<UpdateStateRow>> {
        let mut stmt = conn.prepare_cached(&format!(
            "{} ORDER BY at DESC LIMIT 1",
            Self::SELECT
        ))?;
        let mut rows = stmt.query([])?;
        match rows.next()? {
            Some(row) => Ok(Some(Self::map_row(row)?)),
            None => Ok(None),
        }
    }

    const SELECT: &'static str = "SELECT update_id, version, platform, arch, state,
                 manifest_json, note, at
          FROM update_history";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UpdateStateRow> {
        Ok(UpdateStateRow {
            update_id: row.get(0)?,
            version: row.get(1)?,
            platform: row.get(2)?,
            arch: row.get(3)?,
            state: row.get(4)?,
            manifest_json: row.get(5)?,
            note: row.get(6)?,
            at: row.get(7)?,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackgroundJobRow {
    pub job_id: String,
    pub kind: String,
    pub payload_json: String,
    pub status: String, // queued | running | completed | failed
    pub attempts: i64,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct BackgroundJobsRepo;

impl BackgroundJobsRepo {
    pub fn enqueue(conn: &Connection, job_id: &str, kind: &str, payload_json: &str) -> StorageResult<()> {
        let now = now_rfc3339();
        exec(conn, 
            "INSERT INTO background_jobs (job_id, kind, payload_json, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'queued', ?4, ?4)",
            params![job_id, kind, payload_json, now],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, job_id: &str) -> StorageResult<BackgroundJobRow> {
        let mut stmt = conn.prepare_cached(&format!("{} WHERE job_id = ?1", Self::SELECT))?;
        stmt.query_row([job_id], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "background_job",
                    id: job_id.to_string(),
                },
                other => other.into(),
            })
    }

    pub fn list_by_kind(conn: &Connection, kind: &str) -> StorageResult<Vec<BackgroundJobRow>> {
        let mut stmt = conn.prepare_cached(&format!(
            "{} WHERE kind = ?1 ORDER BY created_at DESC",
            Self::SELECT
        ))?;
        let rows = stmt
            .query_map([kind], Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn complete(conn: &Connection, job_id: &str) -> StorageResult<()> {
        exec(conn, 
            "UPDATE background_jobs SET status = 'completed', updated_at = ?2 WHERE job_id = ?1",
            params![job_id, now_rfc3339()],
        )?;
        Ok(())
    }

    pub fn fail(conn: &Connection, job_id: &str, error: &str) -> StorageResult<()> {
        exec(conn, 
            "UPDATE background_jobs
             SET status = 'failed', attempts = attempts + 1, last_error = ?2, updated_at = ?3
             WHERE job_id = ?1",
            params![job_id, error, now_rfc3339()],
        )?;
        Ok(())
    }

    const SELECT: &'static str = "SELECT job_id, kind, payload_json, status, attempts,
                 last_error, created_at, updated_at
          FROM background_jobs";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BackgroundJobRow> {
        Ok(BackgroundJobRow {
            job_id: row.get(0)?,
            kind: row.get(1)?,
            payload_json: row.get(2)?,
            status: row.get(3)?,
            attempts: row.get(4)?,
            last_error: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }
}
