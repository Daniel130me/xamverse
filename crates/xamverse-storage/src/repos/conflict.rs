//! Conflict records: detected replication conflicts and their resolution
//! history. Conflicts are *data* — queryable, resolvable, auditable.

use super::exec;
use crate::error::{StorageError, StorageResult};
use crate::now_rfc3339;
use rusqlite::{params, Connection};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictStrategy {
    PreserveBoth,
    Reject,
    Quarantine,
    Manual,
}

impl ConflictStrategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            ConflictStrategy::PreserveBoth => "preserve_both",
            ConflictStrategy::Reject => "reject",
            ConflictStrategy::Quarantine => "quarantine",
            ConflictStrategy::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictStatus {
    Open,
    Resolved,
    Deferred,
}

impl ConflictStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ConflictStatus::Open => "open",
            ConflictStatus::Resolved => "resolved",
            ConflictStatus::Deferred => "deferred",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConflictRow {
    pub conflict_id: String,
    pub school_id: String,
    pub category: String,
    pub object_id: String,
    /// Machine-readable kind: concurrent_update | update_vs_delete |
    /// divergent_revision | immutable_violation | conflicting_submission |
    /// unauthorized_restricted_payload | schema_unsupported | duplicate_submission
    pub kind: String,
    pub incoming_op_id: String,
    pub local_op_id: Option<String>,
    /// Quarantined payload kept for side-by-side inspection; never applied.
    pub incoming_payload_json: Option<String>,
    pub strategy: ConflictStrategy,
    pub status: ConflictStatus,
    pub resolution: Option<String>,
    pub resolved_by: Option<String>,
    pub detected_at: String,
    pub resolved_at: Option<String>,
}

pub struct ConflictsRepo;

impl ConflictsRepo {
    pub fn insert(conn: &Connection, conflict: &ConflictRow) -> StorageResult<()> {
        exec(
            conn,
            "INSERT INTO conflicts
                (conflict_id, school_id, category, object_id, kind, incoming_op_id,
                 local_op_id, incoming_payload_json, strategy, status, detected_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                conflict.conflict_id,
                conflict.school_id,
                conflict.category,
                conflict.object_id,
                conflict.kind,
                conflict.incoming_op_id,
                conflict.local_op_id,
                conflict.incoming_payload_json,
                conflict.strategy.as_str(),
                conflict.status.as_str(),
                conflict.detected_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, conflict_id: &str) -> StorageResult<ConflictRow> {
        let mut stmt = conn.prepare_cached(&format!("{} WHERE conflict_id = ?1", Self::SELECT))?;
        stmt.query_row([conflict_id], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "conflict",
                    id: conflict_id.to_string(),
                },
                other => other.into(),
            })
    }

    pub fn list(
        conn: &Connection,
        school_id: &str,
        status: Option<ConflictStatus>,
    ) -> StorageResult<Vec<ConflictRow>> {
        let sql = match status {
            Some(_) => format!(
                "{} WHERE school_id = ?1 AND status = ?2 ORDER BY detected_at DESC",
                Self::SELECT
            ),
            None => format!(
                "{} WHERE school_id = ?1 ORDER BY detected_at DESC",
                Self::SELECT
            ),
        };
        let mut stmt = conn.prepare(&sql)?;
        // The Some/None split mirrors the two SQL shapes; matching keeps the
        // parameter binding total (no Option unwrap) at zero cost.
        let rows = match status {
            Some(s) => stmt
                .query_map(params![school_id, s.as_str()], Self::map_row)?
                .collect::<Result<Vec<_>, _>>()?,
            None => stmt
                .query_map([school_id], Self::map_row)?
                .collect::<Result<Vec<_>, _>>()?,
        };
        Ok(rows)
    }

    /// Record a resolution and close the conflict. Resolution history is the
    /// row itself plus the audit trail written by the caller.
    pub fn resolve(
        conn: &Connection,
        conflict_id: &str,
        resolution: &str,
        resolved_by: &str,
    ) -> StorageResult<()> {
        let changed = exec(
            conn,
            "UPDATE conflicts
             SET status = 'resolved', resolution = ?2, resolved_by = ?3, resolved_at = ?4
             WHERE conflict_id = ?1 AND status = 'open'",
            params![conflict_id, resolution, resolved_by, now_rfc3339()],
        )?;
        if changed == 0 {
            return Err(StorageError::NotFound {
                entity: "open conflict",
                id: conflict_id.to_string(),
            });
        }
        Ok(())
    }

    pub fn defer(conn: &Connection, conflict_id: &str) -> StorageResult<()> {
        let changed = exec(
            conn,
            "UPDATE conflicts SET status = 'deferred' WHERE conflict_id = ?1 AND status = 'open'",
            params![conflict_id],
        )?;
        if changed == 0 {
            return Err(StorageError::NotFound {
                entity: "open conflict",
                id: conflict_id.to_string(),
            });
        }
        Ok(())
    }

    const SELECT: &'static str = "SELECT conflict_id, school_id, category, object_id, kind,
                 incoming_op_id, local_op_id, incoming_payload_json, strategy, status,
                 resolution, resolved_by, detected_at, resolved_at
          FROM conflicts";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConflictRow> {
        let strategy = match row.get::<_, String>(8)?.as_str() {
            "preserve_both" => ConflictStrategy::PreserveBoth,
            "reject" => ConflictStrategy::Reject,
            "quarantine" => ConflictStrategy::Quarantine,
            "manual" => ConflictStrategy::Manual,
            other => {
                return Err(rusqlite::Error::ToSqlConversionFailure(Box::<
                    dyn std::error::Error + Send + Sync,
                >::from(
                    format!(
                    "unknown conflict strategy {other}"
                )
                )))
            }
        };
        let status = match row.get::<_, String>(9)?.as_str() {
            "open" => ConflictStatus::Open,
            "resolved" => ConflictStatus::Resolved,
            "deferred" => ConflictStatus::Deferred,
            other => {
                return Err(rusqlite::Error::ToSqlConversionFailure(Box::<
                    dyn std::error::Error + Send + Sync,
                >::from(
                    format!(
                    "unknown conflict status {other}"
                )
                )))
            }
        };
        Ok(ConflictRow {
            conflict_id: row.get(0)?,
            school_id: row.get(1)?,
            category: row.get(2)?,
            object_id: row.get(3)?,
            kind: row.get(4)?,
            incoming_op_id: row.get(5)?,
            local_op_id: row.get(6)?,
            incoming_payload_json: row.get(7)?,
            strategy,
            status,
            resolution: row.get(10)?,
            resolved_by: row.get(11)?,
            detected_at: row.get(12)?,
            resolved_at: row.get(13)?,
        })
    }
}
