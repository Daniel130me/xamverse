//! Examination data infrastructure: sealed packages, attempts with
//! hash-chained events, and collection receipts.
//!
//! Boundary reminder: the engine stores *envelopes* and verifies integrity
//! and authorization. Question rendering, grading and business rules belong
//! to Phase 3.

use super::exec;
use crate::error::{StorageError, StorageResult};
use crate::{checksum, now_rfc3339};
use rusqlite::{params, Connection};

#[derive(Debug, Clone, serde::Serialize)]
pub struct PackageRow {
    pub package_id: String,
    pub school_id: String,
    pub assessment_id: String,
    pub version: i64,
    pub content_sha256: String,
    pub manifest_json: String,
    pub approved_by: Option<String>,
    pub approved_signature: Option<String>,
    pub blob_sha256: String,
    pub received_from: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AttemptRow {
    pub attempt_id: String,
    pub school_id: String,
    pub package_id: String,
    pub student_ref: String,
    pub status: String, // in_progress | finalized
    pub device_id: String,
    pub started_at: String,
    pub finalized_at: Option<String>,
    pub finalize_signature: Option<String>,
    pub latest_chain_hash: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AttemptEventRow {
    pub seq: i64,
    pub attempt_id: String,
    pub kind: String,
    pub payload_json: String,
    pub recorded_at: String,
    pub prev_hash: String,
    pub hash: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CollectionReceiptRow {
    pub receipt_id: String,
    pub attempt_id: String,
    pub school_id: String,
    pub collector_device_id: String,
    pub source_device_id: String,
    pub collected_at: String,
    pub content_sha256: String,
}

pub struct PackagesRepo;

impl PackagesRepo {
    pub fn put(conn: &Connection, package: &PackageRow) -> StorageResult<bool> {
        let changed = exec(conn, 
            "INSERT OR IGNORE INTO packages
                (package_id, school_id, assessment_id, version, content_sha256,
                 manifest_json, approved_by, approved_signature, blob_sha256,
                 received_from, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                package.package_id,
                package.school_id,
                package.assessment_id,
                package.version,
                package.content_sha256,
                package.manifest_json,
                package.approved_by,
                package.approved_signature,
                package.blob_sha256,
                package.received_from,
                package.created_at,
            ],
        )?;
        Ok(changed > 0)
    }

    pub fn get(conn: &Connection, school_id: &str, package_id: &str) -> StorageResult<PackageRow> {
        let mut stmt = conn.prepare_cached(&format!(
            "{} WHERE school_id = ?1 AND package_id = ?2",
            Self::SELECT
        ))?;
        stmt.query_row(params![school_id, package_id], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "package",
                    id: package_id.to_string(),
                },
                other => other.into(),
            })
    }

    pub fn get_by_content(conn: &Connection, school_id: &str, content_sha256: &str) -> StorageResult<Option<PackageRow>> {
        let mut stmt = conn.prepare_cached(&format!(
            "{} WHERE school_id = ?1 AND content_sha256 = ?2",
            Self::SELECT
        ))?;
        let mut rows = stmt.query(params![school_id, content_sha256])?;
        match rows.next()? {
            Some(row) => Ok(Some(Self::map_row(row)?)),
            None => Ok(None),
        }
    }

    pub fn latest_for_assessment(conn: &Connection, school_id: &str, assessment_id: &str) -> StorageResult<Option<PackageRow>> {
        let mut stmt = conn.prepare_cached(&format!(
            "{} WHERE school_id = ?1 AND assessment_id = ?2
             ORDER BY version DESC LIMIT 1",
            Self::SELECT
        ))?;
        let mut rows = stmt.query(params![school_id, assessment_id])?;
        match rows.next()? {
            Some(row) => Ok(Some(Self::map_row(row)?)),
            None => Ok(None),
        }
    }

    pub fn list(conn: &Connection, school_id: &str) -> StorageResult<Vec<PackageRow>> {
        let mut stmt = conn.prepare_cached(&format!(
            "{} WHERE school_id = ?1 ORDER BY created_at DESC",
            Self::SELECT
        ))?;
        let rows = stmt
            .query_map([school_id], Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    const SELECT: &'static str = "SELECT package_id, school_id, assessment_id, version,
                 content_sha256, manifest_json, approved_by, approved_signature,
                 blob_sha256, received_from, created_at
          FROM packages";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PackageRow> {
        Ok(PackageRow {
            package_id: row.get(0)?,
            school_id: row.get(1)?,
            assessment_id: row.get(2)?,
            version: row.get(3)?,
            content_sha256: row.get(4)?,
            manifest_json: row.get(5)?,
            approved_by: row.get(6)?,
            approved_signature: row.get(7)?,
            blob_sha256: row.get(8)?,
            received_from: row.get(9)?,
            created_at: row.get(10)?,
        })
    }
}

pub struct AttemptsRepo;

impl AttemptsRepo {
    pub fn create(conn: &Connection, attempt: &AttemptRow) -> StorageResult<bool> {
        let changed = exec(conn, 
            "INSERT OR IGNORE INTO attempts
                (attempt_id, school_id, package_id, student_ref, status, device_id,
                 started_at, finalized_at, finalize_signature, latest_chain_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                attempt.attempt_id,
                attempt.school_id,
                attempt.package_id,
                attempt.student_ref,
                attempt.status,
                attempt.device_id,
                attempt.started_at,
                attempt.finalized_at,
                attempt.finalize_signature,
                attempt.latest_chain_hash,
            ],
        )?;
        Ok(changed > 0)
    }

    pub fn get(conn: &Connection, attempt_id: &str) -> StorageResult<AttemptRow> {
        let mut stmt = conn.prepare_cached(&format!("{} WHERE attempt_id = ?1", Self::SELECT))?;
        stmt.query_row([attempt_id], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "attempt",
                    id: attempt_id.to_string(),
                },
                other => other.into(),
            })
    }

    pub fn list_for_school(
        conn: &Connection,
        school_id: &str,
        status: Option<&str>,
    ) -> StorageResult<Vec<AttemptRow>> {
        let (sql, use_status) = match status {
            Some(_) => (
                format!("{} WHERE school_id = ?1 AND status = ?2", Self::SELECT),
                true,
            ),
            None => (format!("{} WHERE school_id = ?1", Self::SELECT), false),
        };
        let mut stmt = conn.prepare(&sql)?;
        let rows = if use_status {
            stmt.query_map(params![school_id, status], Self::map_row)?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map([school_id], Self::map_row)?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(rows)
    }

    /// Append an answer/navigation/flag event and advance the per-attempt
    /// hash chain. Returns the new chain head. The caller wraps this in the
    /// attempt transaction so "saved" means "durable".
    pub fn append_event(
        conn: &Connection,
        attempt_id: &str,
        kind: &str,
        payload_json: &str,
    ) -> StorageResult<AttemptEventRow> {
        let prev_hash: String = conn
            .query_row(
                "SELECT latest_chain_hash FROM attempts WHERE attempt_id = ?1",
                [attempt_id],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "attempt",
                    id: attempt_id.to_string(),
                },
                other => other.into(),
            })?;
        let recorded_at = now_rfc3339();
        // Chain: hash = SHA-256(prev_hash | kind | recorded_at | payload)
        let hash = checksum(format!("{prev_hash}|{kind}|{recorded_at}|{payload_json}"));
        exec(conn, 
            "INSERT INTO attempt_events (attempt_id, kind, payload_json, recorded_at, prev_hash, hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![attempt_id, kind, payload_json, recorded_at, prev_hash, hash],
        )?;
        exec(conn, 
            "UPDATE attempts SET latest_chain_hash = ?2 WHERE attempt_id = ?1",
            params![attempt_id, hash],
        )?;
        Ok(AttemptEventRow {
            seq: conn.last_insert_rowid(),
            attempt_id: attempt_id.to_string(),
            kind: kind.to_string(),
            payload_json: payload_json.to_string(),
            recorded_at,
            prev_hash,
            hash,
        })
    }

    pub fn finalize(
        conn: &Connection,
        attempt_id: &str,
        chain_hash: &str,
        signature: &str,
    ) -> StorageResult<()> {
        let changed = exec(conn, 
            "UPDATE attempts
             SET status = 'finalized', finalized_at = ?2, finalize_signature = ?3,
                 latest_chain_hash = ?4
             WHERE attempt_id = ?1 AND status = 'in_progress'",
            params![attempt_id, now_rfc3339(), signature, chain_hash],
        )?;
        if changed == 0 {
            // Either unknown attempt or already finalized (idempotent no-op).
            let status: Option<String> = conn
                .query_row(
                    "SELECT status FROM attempts WHERE attempt_id = ?1",
                    [attempt_id],
                    |row| row.get(0),
                )
                .ok();
            return match status.as_deref() {
                Some("finalized") => Ok(()),
                _ => Err(StorageError::NotFound {
                    entity: "attempt",
                    id: attempt_id.to_string(),
                }),
            };
        }
        Ok(())
    }

    pub fn list_events(conn: &Connection, attempt_id: &str) -> StorageResult<Vec<AttemptEventRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT seq, attempt_id, kind, payload_json, recorded_at, prev_hash, hash
             FROM attempt_events WHERE attempt_id = ?1 ORDER BY seq",
        )?;
        let rows = stmt
            .query_map([attempt_id], |row| {
                Ok(AttemptEventRow {
                    seq: row.get(0)?,
                    attempt_id: row.get(1)?,
                    kind: row.get(2)?,
                    payload_json: row.get(3)?,
                    recorded_at: row.get(4)?,
                    prev_hash: row.get(5)?,
                    hash: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Verify the whole event chain of an attempt (integrity proof).
    pub fn verify_chain(conn: &Connection, attempt_id: &str) -> StorageResult<bool> {
        let events = Self::list_events(conn, attempt_id)?;
        let mut prev = String::new();
        for event in &events {
            let expected = checksum(format!("{}|{}|{}|{}", prev, event.kind, event.recorded_at, event.payload_json));
            if expected != event.hash || (!prev.is_empty() && prev != event.prev_hash) {
                return Ok(false);
            }
            prev = event.hash.clone();
        }
        let head: Option<String> = conn
            .query_row(
                "SELECT latest_chain_hash FROM attempts WHERE attempt_id = ?1",
                [attempt_id],
                |row| row.get(0),
            )
            .ok();
        Ok(head.as_deref() == Some(prev.as_str()) || (head.is_none() && events.is_empty()))
    }

    const SELECT: &'static str = "SELECT attempt_id, school_id, package_id, student_ref,
                 status, device_id, started_at, finalized_at, finalize_signature,
                 latest_chain_hash
          FROM attempts";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttemptRow> {
        Ok(AttemptRow {
            attempt_id: row.get(0)?,
            school_id: row.get(1)?,
            package_id: row.get(2)?,
            student_ref: row.get(3)?,
            status: row.get(4)?,
            device_id: row.get(5)?,
            started_at: row.get(6)?,
            finalized_at: row.get(7)?,
            finalize_signature: row.get(8)?,
            latest_chain_hash: row.get(9)?,
        })
    }
}

pub struct CollectionReceiptsRepo;

impl CollectionReceiptsRepo {
    /// Insert a receipt. Returns `false` when the collector already has this
    /// attempt — repeated collection is idempotent by design.
    pub fn put(conn: &Connection, receipt: &CollectionReceiptRow) -> StorageResult<bool> {
        let changed = exec(conn, 
            "INSERT OR IGNORE INTO collection_receipts
                (receipt_id, attempt_id, school_id, collector_device_id,
                 source_device_id, collected_at, content_sha256)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                receipt.receipt_id,
                receipt.attempt_id,
                receipt.school_id,
                receipt.collector_device_id,
                receipt.source_device_id,
                receipt.collected_at,
                receipt.content_sha256,
            ],
        )?;
        Ok(changed > 0)
    }

    pub fn for_attempt(conn: &Connection, attempt_id: &str) -> StorageResult<Vec<CollectionReceiptRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT receipt_id, attempt_id, school_id, collector_device_id,
                    source_device_id, collected_at, content_sha256
             FROM collection_receipts WHERE attempt_id = ?1",
        )?;
        let rows = stmt
            .query_map([attempt_id], Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn count_for_attempt(conn: &Connection, attempt_id: &str) -> StorageResult<i64> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM collection_receipts WHERE attempt_id = ?1",
            [attempt_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CollectionReceiptRow> {
        Ok(CollectionReceiptRow {
            receipt_id: row.get(0)?,
            attempt_id: row.get(1)?,
            school_id: row.get(2)?,
            collector_device_id: row.get(3)?,
            source_device_id: row.get(4)?,
            collected_at: row.get(5)?,
            content_sha256: row.get(6)?,
        })
    }
}
