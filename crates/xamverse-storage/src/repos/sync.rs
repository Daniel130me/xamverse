//! Sync persistence: operation log, materialized objects, durable outbox,
//! per-peer checkpoints and the content-addressed blob store.

use super::exec;
use crate::error::{StorageError, StorageResult};
use crate::now_rfc3339;
use rusqlite::{params, types::Value as SqlValue, Connection};

/// A signed operation in the append-only log.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpRow {
    pub op_id: String,
    pub school_id: String,
    pub category: String,
    pub object_id: String,
    pub revision: i64,
    pub base_revision: i64,
    pub author_device_id: String,
    pub lamport: i64,
    pub tombstone: bool,
    pub schema_version: i64,
    pub payload_sha256: String,
    /// Inline payload JSON when small enough; mutually exclusive with blob ref.
    pub payload_json: Option<String>,
    /// Reference into the blob store for payloads above the inline threshold.
    pub blob_sha256: Option<String>,
    pub signature: String,
    pub received_from: Option<String>,
    pub received_at: String,
}

/// Materialized current state of one logical object.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ObjectRow {
    pub school_id: String,
    pub category: String,
    pub object_id: String,
    pub current_revision: i64,
    pub current_op_id: String,
    pub payload_sha256: String,
    pub tombstone: bool,
    pub lamport: i64,
    pub updated_at: String,
}

/// Compact object summary used to build sync manifests.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ObjectSummary {
    pub category: String,
    pub object_id: String,
    pub revision: i64,
    /// The op id that produced the current revision (manifests reference it).
    pub op_id: String,
    pub payload_sha256: String,
    pub tombstone: bool,
    pub lamport: i64,
}

pub struct OpsRepo;

impl OpsRepo {
    /// Append an op to the log. Returns `false` when the op already exists
    /// (idempotency by primary key — repeated deliveries are free).
    pub fn insert(conn: &Connection, op: &OpRow) -> StorageResult<bool> {
        let changed = exec(conn, 
            "INSERT OR IGNORE INTO sync_ops
             (op_id, school_id, category, object_id, revision, base_revision,
              author_device_id, lamport, tombstone, schema_version, payload_sha256,
              payload_json, blob_sha256, signature, received_from, received_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                op.op_id,
                op.school_id,
                op.category,
                op.object_id,
                op.revision,
                op.base_revision,
                op.author_device_id,
                op.lamport,
                op.tombstone as i64,
                op.schema_version,
                op.payload_sha256,
                op.payload_json,
                op.blob_sha256,
                op.signature,
                op.received_from,
                op.received_at,
            ],
        )?;
        Ok(changed > 0)
    }

    pub fn exists(conn: &Connection, op_id: &str) -> StorageResult<bool> {
        let mut stmt = conn.prepare_cached("SELECT 1 FROM sync_ops WHERE op_id = ?1")?;
        Ok(stmt.exists([op_id])?)
    }

    pub fn get(conn: &Connection, op_id: &str) -> StorageResult<OpRow> {
        let mut stmt = conn.prepare_cached(
            "SELECT op_id, school_id, category, object_id, revision, base_revision,
                    author_device_id, lamport, tombstone, schema_version, payload_sha256,
                    payload_json, blob_sha256, signature, received_from, received_at
             FROM sync_ops WHERE op_id = ?1",
        )?;
        stmt.query_row([op_id], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "sync_op",
                    id: op_id.to_string(),
                },
                other => other.into(),
            })
    }

    pub fn get_many(conn: &Connection, op_ids: &[String]) -> StorageResult<Vec<OpRow>> {
        if op_ids.is_empty() {
            return Ok(Vec::new());
        }
        // Batch fetch with one IN(...) query (performance: avoid N+1).
        let placeholders = vec!["?"; op_ids.len()].join(",");
        let sql = format!(
            "SELECT op_id, school_id, category, object_id, revision, base_revision,
                    author_device_id, lamport, tombstone, schema_version, payload_sha256,
                    payload_json, blob_sha256, signature, received_from, received_at
             FROM sync_ops WHERE op_id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql)?;
        let params: Vec<SqlValue> = op_ids.iter().map(|id| SqlValue::Text(id.clone())).collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params), Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Ops newer than the given lamport watermark, oldest first — the payload
    /// of a manifest response. One indexed range scan.
    pub fn since_lamport(
        conn: &Connection,
        school_id: &str,
        categories: &[String],
        since_lamport: i64,
        limit: i64,
    ) -> StorageResult<Vec<OpRow>> {
        let (sql, bind_categories) = if categories.is_empty() {
            (
                "SELECT op_id, school_id, category, object_id, revision, base_revision,
                        author_device_id, lamport, tombstone, schema_version, payload_sha256,
                        payload_json, blob_sha256, signature, received_from, received_at
                 FROM sync_ops WHERE school_id = ?1 AND lamport > ?2
                 ORDER BY lamport LIMIT ?3"
                    .to_string(),
                false,
            )
        } else {
            let placeholders = vec!["?"; categories.len()].join(",");
            (
                format!(
                    "SELECT op_id, school_id, category, object_id, revision, base_revision,
                            author_device_id, lamport, tombstone, schema_version, payload_sha256,
                            payload_json, blob_sha256, signature, received_from, received_at
                     FROM sync_ops WHERE school_id = ?1 AND lamport > ?2 AND category IN ({placeholders})
                     ORDER BY lamport LIMIT ?3"
                ),
                true,
            )
        };
        let mut stmt = conn.prepare(&sql)?;
        let mut bind: Vec<SqlValue> = vec![
            SqlValue::Text(school_id.to_string()),
            SqlValue::Integer(since_lamport),
        ];
        if bind_categories {
            bind.extend(categories.iter().map(|c| SqlValue::Text(c.clone())));
        }
        bind.push(SqlValue::Integer(limit));
        let rows = stmt
            .query_map(rusqlite::params_from_iter(bind), Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OpRow> {
        Ok(OpRow {
            op_id: row.get(0)?,
            school_id: row.get(1)?,
            category: row.get(2)?,
            object_id: row.get(3)?,
            revision: row.get(4)?,
            base_revision: row.get(5)?,
            author_device_id: row.get(6)?,
            lamport: row.get(7)?,
            tombstone: row.get::<_, i64>(8)? != 0,
            schema_version: row.get(9)?,
            payload_sha256: row.get(10)?,
            payload_json: row.get(11)?,
            blob_sha256: row.get(12)?,
            signature: row.get(13)?,
            received_from: row.get(14)?,
            received_at: row.get(15)?,
        })
    }
}

pub struct ObjectsRepo;

impl ObjectsRepo {
    /// Upsert the materialized object state. The caller (apply pipeline) has
    /// already decided this op is newer; the guarded update below is the last
    /// line of defence against races within the same transaction.
    pub fn apply_op_state(conn: &Connection, op: &OpRow) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO sync_objects
                (school_id, category, object_id, current_revision, current_op_id,
                 payload_sha256, tombstone, lamport, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(school_id, category, object_id) DO UPDATE SET
                current_revision = excluded.current_revision,
                current_op_id = excluded.current_op_id,
                payload_sha256 = excluded.payload_sha256,
                tombstone = excluded.tombstone,
                lamport = excluded.lamport,
                updated_at = excluded.updated_at
             WHERE excluded.current_revision > sync_objects.current_revision",
            params![
                op.school_id,
                op.category,
                op.object_id,
                op.revision,
                op.op_id,
                op.payload_sha256,
                op.tombstone as i64,
                op.lamport,
                now_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get(
        conn: &Connection,
        school_id: &str,
        category: &str,
        object_id: &str,
    ) -> StorageResult<Option<ObjectRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT school_id, category, object_id, current_revision, current_op_id,
                    payload_sha256, tombstone, lamport, updated_at
             FROM sync_objects WHERE school_id = ?1 AND category = ?2 AND object_id = ?3",
        )?;
        let mut rows = stmt.query(params![school_id, category, object_id])?;
        match rows.next()? {
            Some(row) => Ok(Some(ObjectRow {
                school_id: row.get(0)?,
                category: row.get(1)?,
                object_id: row.get(2)?,
                current_revision: row.get(3)?,
                current_op_id: row.get(4)?,
                payload_sha256: row.get(5)?,
                tombstone: row.get::<_, i64>(6)? != 0,
                lamport: row.get(7)?,
                updated_at: row.get(8)?,
            })),
            None => Ok(None),
        }
    }

    /// Summaries for manifest exchange: everything the local node has in the
    /// given categories above the peer's watermark.
    pub fn summaries(
        conn: &Connection,
        school_id: &str,
        categories: &[String],
        since_lamport: i64,
        limit: i64,
    ) -> StorageResult<Vec<ObjectSummary>> {
        let (sql, bind_categories) = if categories.is_empty() {
            (
                "SELECT category, object_id, current_revision, current_op_id, payload_sha256, tombstone, lamport
                 FROM sync_objects WHERE school_id = ?1 AND lamport > ?2
                 ORDER BY lamport LIMIT ?3"
                    .to_string(),
                false,
            )
        } else {
            let placeholders = vec!["?"; categories.len()].join(",");
            (
                format!(
                    "SELECT category, object_id, current_revision, current_op_id, payload_sha256, tombstone, lamport
                     FROM sync_objects WHERE school_id = ?1 AND lamport > ?2 AND category IN ({placeholders})
                     ORDER BY lamport LIMIT ?3"
                ),
                true,
            )
        };
        let mut stmt = conn.prepare(&sql)?;
        let mut bind: Vec<SqlValue> = vec![
            SqlValue::Text(school_id.to_string()),
            SqlValue::Integer(since_lamport),
        ];
        if bind_categories {
            bind.extend(categories.iter().map(|c| SqlValue::Text(c.clone())));
        }
        bind.push(SqlValue::Integer(limit));
        let rows = stmt
            .query_map(rusqlite::params_from_iter(bind), |row| {
                Ok(ObjectSummary {
                    category: row.get(0)?,
                    object_id: row.get(1)?,
                    revision: row.get(2)?,
                    op_id: row.get(3)?,
                    payload_sha256: row.get(4)?,
                    tombstone: row.get::<_, i64>(5)? != 0,
                    lamport: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    PushOp,
    Pull,
    Collect,
}

impl JobKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobKind::PushOp => "push_op",
            JobKind::Pull => "pull",
            JobKind::Collect => "collect",
        }
    }
    pub fn from_str(raw: &str) -> StorageResult<Self> {
        match raw {
            "push_op" => Ok(JobKind::PushOp),
            "pull" => Ok(JobKind::Pull),
            "collect" => Ok(JobKind::Collect),
            other => Err(StorageError::InvalidValue {
                field: "job kind",
                reason: format!("unknown kind {other}"),
            }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Queued => "queued",
            JobStatus::Running => "running",
            JobStatus::Completed => "completed",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct JobRow {
    pub job_id: String,
    pub school_id: String,
    pub target_device_id: String,
    pub op_id: Option<String>,
    pub kind: JobKind,
    pub status: JobStatus,
    pub attempts: i64,
    pub next_attempt_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct JobsRepo;

impl JobsRepo {
    pub fn insert(conn: &Connection, job: &JobRow) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO sync_jobs (job_id, school_id, target_device_id, op_id, kind,
                                    status, attempts, next_attempt_at, last_error,
                                    created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                job.job_id,
                job.school_id,
                job.target_device_id,
                job.op_id,
                job.kind.as_str(),
                job.status.as_str(),
                job.attempts,
                job.next_attempt_at,
                job.last_error,
                job.created_at,
                job.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, job_id: &str) -> StorageResult<JobRow> {
        let mut stmt = conn.prepare_cached(Self::SELECT)?;
        stmt.query_row([job_id], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "sync_job",
                    id: job_id.to_string(),
                },
                other => other.into(),
            })
    }

    pub fn list(
        conn: &Connection,
        school_id: &str,
        statuses: &[JobStatus],
        limit: i64,
    ) -> StorageResult<Vec<JobRow>> {
        let mut sql = format!(
            "{} WHERE school_id = ?1", Self::SELECT
        );
        if !statuses.is_empty() {
            let placeholders = vec!["?"; statuses.len()].join(",");
            sql.push_str(&format!(" AND status IN ({placeholders})"));
        }
        sql.push_str(" ORDER BY created_at DESC LIMIT ");
        sql.push_str(&limit.to_string());
        let mut stmt = conn.prepare(&sql)?;
        let mut bind: Vec<SqlValue> = vec![SqlValue::Text(school_id.to_string())];
        bind.extend(statuses.iter().map(|s| SqlValue::Text(s.as_str().to_string())));
        let rows = stmt
            .query_map(rusqlite::params_from_iter(bind), Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Jobs whose retry deadline has passed. Persisted across restarts.
    pub fn due(conn: &Connection, now_rfc3339: &str, limit: i64) -> StorageResult<Vec<JobRow>> {
        let sql = format!(
            "{} WHERE status IN ('queued','failed')
               AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)
             ORDER BY COALESCE(next_attempt_at, created_at) LIMIT ?2",
            Self::SELECT
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![now_rfc3339, limit], Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn mark_status(conn: &Connection, job_id: &str, status: JobStatus, error: Option<&str>) -> StorageResult<()> {
        exec(conn, 
            "UPDATE sync_jobs SET status = ?2, last_error = ?3, updated_at = ?4 WHERE job_id = ?1",
            params![job_id, status.as_str(), error, now_rfc3339()],
        )?;
        Ok(())
    }

    /// Record a failed attempt and schedule the retry with backoff.
    pub fn record_failure(conn: &Connection, job_id: &str, error: &str, next_attempt_at: &str) -> StorageResult<()> {
        exec(conn, 
            "UPDATE sync_jobs
             SET status = 'failed', attempts = attempts + 1, last_error = ?2,
                 next_attempt_at = ?3, updated_at = ?4
             WHERE job_id = ?1",
            params![job_id, error, next_attempt_at, now_rfc3339()],
        )?;
        Ok(())
    }

    /// Reset failed jobs towards a target so reconnection triggers a retry
    /// storm-free immediate pass.
    pub fn reset_for_target(conn: &Connection, target_device_id: &str) -> StorageResult<u64> {
        let changed = exec(conn,
            "UPDATE sync_jobs SET status = 'queued', next_attempt_at = NULL, updated_at = ?2
             WHERE target_device_id = ?1 AND status IN ('failed','running')",
            params![target_device_id, now_rfc3339()],
        )?;
        Ok(changed as u64)
    }

    /// Requeue every stuck `running` job — used at engine startup after a
    /// crash or unclean shutdown (the queue is durable, the executor is not).
    pub fn reset_running(conn: &Connection) -> StorageResult<u64> {
        let changed = exec(conn,
            "UPDATE sync_jobs SET status = 'queued', next_attempt_at = NULL, updated_at = ?1
             WHERE status = 'running'",
            params![now_rfc3339()],
        )?;
        Ok(changed as u64)
    }

    pub fn cancel(conn: &Connection, job_id: &str) -> StorageResult<bool> {
        let changed = exec(conn, 
            "UPDATE sync_jobs SET status = 'cancelled', updated_at = ?2
             WHERE job_id = ?1 AND status IN ('queued','failed','running')",
            params![job_id, now_rfc3339()],
        )?;
        Ok(changed > 0)
    }

    const SELECT: &'static str = "SELECT job_id, school_id, target_device_id, op_id, kind,
                 status, attempts, next_attempt_at, last_error, created_at, updated_at
          FROM sync_jobs";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<JobRow> {
        Ok(JobRow {
            job_id: row.get(0)?,
            school_id: row.get(1)?,
            target_device_id: row.get(2)?,
            op_id: row.get(3)?,
            kind: JobKind::from_str(&row.get::<_, String>(4)?)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
            status: match row.get::<_, String>(5)?.as_str() {
                "queued" => JobStatus::Queued,
                "running" => JobStatus::Running,
                "completed" => JobStatus::Completed,
                "failed" => JobStatus::Failed,
                "cancelled" => JobStatus::Cancelled,
                other => {
                    return Err(rusqlite::Error::ToSqlConversionFailure(Box::<dyn std::error::Error + Send + Sync>::from(
                        format!("unknown job status {other}"),
                    )))
                }
            },
            attempts: row.get(6)?,
            next_attempt_at: row.get(7)?,
            last_error: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    }
}

pub struct CheckpointsRepo;

impl CheckpointsRepo {
    pub fn get(
        conn: &Connection,
        school_id: &str,
        peer_device_id: &str,
        category: &str,
    ) -> StorageResult<i64> {
        let mut stmt = conn.prepare_cached(
            "SELECT last_lamport FROM sync_checkpoints
             WHERE school_id = ?1 AND peer_device_id = ?2 AND category = ?3",
        )?;
        Ok(stmt
            .query_row(params![school_id, peer_device_id, category], |row| row.get(0))
            .unwrap_or(0))
    }

    pub fn set(
        conn: &Connection,
        school_id: &str,
        peer_device_id: &str,
        category: &str,
        last_lamport: i64,
    ) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO sync_checkpoints (school_id, peer_device_id, category, last_lamport, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(school_id, peer_device_id, category) DO UPDATE SET
                last_lamport = MAX(sync_checkpoints.last_lamport, excluded.last_lamport),
                updated_at = excluded.updated_at",
            params![school_id, peer_device_id, category, last_lamport, now_rfc3339()],
        )?;
        Ok(())
    }

    pub fn for_peer(conn: &Connection, school_id: &str, peer_device_id: &str) -> StorageResult<Vec<(String, i64)>> {
        let mut stmt = conn.prepare_cached(
            "SELECT category, last_lamport FROM sync_checkpoints
             WHERE school_id = ?1 AND peer_device_id = ?2",
        )?;
        let rows = stmt
            .query_map(params![school_id, peer_device_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

pub struct BlobRepo;

impl BlobRepo {
    /// Content-addressed insert: identical content is stored once (duplicate
    /// detection at the storage layer, idempotent replication).
    pub fn put(conn: &Connection, sha256: &str, data: &[u8]) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO blobs (sha256, size, data, created_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(sha256) DO NOTHING",
            params![sha256, data.len() as i64, data, now_rfc3339()],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, sha256: &str) -> StorageResult<Option<Vec<u8>>> {
        let mut stmt = conn.prepare_cached("SELECT data FROM blobs WHERE sha256 = ?1")?;
        let mut rows = stmt.query([sha256])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn has(conn: &Connection, sha256: &str) -> StorageResult<bool> {
        let mut stmt = conn.prepare_cached("SELECT 1 FROM blobs WHERE sha256 = ?1")?;
        Ok(stmt.exists([sha256])?)
    }

    pub fn size(conn: &Connection, sha256: &str) -> StorageResult<Option<i64>> {
        let mut stmt = conn.prepare_cached("SELECT size FROM blobs WHERE sha256 = ?1")?;
        Ok(stmt.query_row([sha256], |row| row.get(0)).ok())
    }
}
