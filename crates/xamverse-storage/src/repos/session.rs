//! Local sessions and login rate limiting. Sessions never replicate — they
//! are per-device runtime state. Only SHA-256 token *hashes* are stored, so
//! a stolen database cannot be used to hijack live sessions.

use super::exec;
use crate::error::StorageResult;
use crate::now_rfc3339;
use rusqlite::{params, Connection};

#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionRow {
    pub token_hash: String,
    pub user_id: String,
    pub school_id: String,
    pub kind: String, // desktop | browser
    pub origin: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    pub last_active_at: String,
    pub locked_at: Option<String>,
    pub revoked_at: Option<String>,
    pub revoked_reason: Option<String>,
}

pub struct SessionsRepo;

impl SessionsRepo {
    pub fn insert(conn: &Connection, session: &SessionRow) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO sessions (token_hash, user_id, school_id, kind, origin,
                                   created_at, expires_at, last_active_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session.token_hash,
                session.user_id,
                session.school_id,
                session.kind,
                session.origin,
                session.created_at,
                session.expires_at,
                session.last_active_at,
            ],
        )?;
        Ok(())
    }

    /// Returns the session only if it is live: not expired, not revoked.
    /// A locked session is returned so callers can require unlock.
    pub fn get_live(conn: &Connection, token_hash: &str) -> StorageResult<Option<SessionRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT token_hash, user_id, school_id, kind, origin, created_at,
                    expires_at, last_active_at, locked_at, revoked_at, revoked_reason
             FROM sessions
             WHERE token_hash = ?1
               AND expires_at > ?2
               AND revoked_at IS NULL",
        )?;
        let mut rows = stmt.query(params![token_hash, now_rfc3339()])?;
        match rows.next()? {
            Some(row) => Ok(Some(Self::map_row(row)?)),
            None => Ok(None),
        }
    }

    pub fn touch(conn: &Connection, token_hash: &str) -> StorageResult<()> {
        exec(conn, 
            "UPDATE sessions SET last_active_at = ?2 WHERE token_hash = ?1",
            params![token_hash, now_rfc3339()],
        )?;
        Ok(())
    }

    pub fn set_locked(conn: &Connection, token_hash: &str, locked: bool) -> StorageResult<()> {
        exec(conn, 
            "UPDATE sessions SET locked_at = ?2 WHERE token_hash = ?1",
            params![token_hash, if locked { Some(now_rfc3339()) } else { None }],
        )?;
        Ok(())
    }

    pub fn revoke(conn: &Connection, token_hash: &str, reason: &str) -> StorageResult<bool> {
        let changed = exec(conn, 
            "UPDATE sessions SET revoked_at = ?2, revoked_reason = ?3
             WHERE token_hash = ?1 AND revoked_at IS NULL",
            params![token_hash, now_rfc3339(), reason],
        )?;
        Ok(changed > 0)
    }

    /// Credential hygiene: changing a password kills every live session for
    /// the user (all devices of this installation).
    pub fn revoke_all_for_user(conn: &Connection, school_id: &str, user_id: &str, reason: &str) -> StorageResult<u64> {
        let changed = exec(conn, 
            "UPDATE sessions SET revoked_at = ?3, revoked_reason = ?4
             WHERE school_id = ?1 AND user_id = ?2 AND revoked_at IS NULL",
            params![school_id, user_id, now_rfc3339(), reason],
        )?;
        Ok(changed as u64)
    }

    pub fn purge_expired(conn: &Connection) -> StorageResult<u64> {
        let changed = exec(conn, 
            "DELETE FROM sessions WHERE expires_at <= ?1 OR revoked_at IS NOT NULL",
            params![now_rfc3339()],
        )?;
        Ok(changed as u64)
    }

    /// Active browser sessions for the governance screen.
    pub fn list_active(conn: &Connection, school_id: &str) -> StorageResult<Vec<SessionRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT token_hash, user_id, school_id, kind, origin, created_at,
                    expires_at, last_active_at, locked_at, revoked_at, revoked_reason
             FROM sessions
             WHERE school_id = ?1 AND revoked_at IS NULL AND expires_at > ?2
             ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map(params![school_id, now_rfc3339()], Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
        Ok(SessionRow {
            token_hash: row.get(0)?,
            user_id: row.get(1)?,
            school_id: row.get(2)?,
            kind: row.get(3)?,
            origin: row.get(4)?,
            created_at: row.get(5)?,
            expires_at: row.get(6)?,
            last_active_at: row.get(7)?,
            locked_at: row.get(8)?,
            revoked_at: row.get(9)?,
            revoked_reason: row.get(10)?,
        })
    }
}

/// Login attempt tracking for brute-force throttling.
pub struct LoginAttemptsRepo;

impl LoginAttemptsRepo {
    pub fn record(conn: &Connection, key: &str, success: bool) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO login_attempts (key, success, at) VALUES (?1, ?2, ?3)",
            params![key, success as i64, now_rfc3339()],
        )?;
        Ok(())
    }

    /// Failed attempts for `key` since the given RFC3339 timestamp.
    pub fn count_failures_since(conn: &Connection, key: &str, since_rfc3339: &str) -> StorageResult<i64> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM login_attempts
             WHERE key = ?1 AND success = 0 AND at >= ?2",
            params![key, since_rfc3339],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Retention: prune attempts older than the given timestamp.
    pub fn prune_older_than(conn: &Connection, cutoff_rfc3339: &str) -> StorageResult<u64> {
        let changed = exec(conn, 
            "DELETE FROM login_attempts WHERE at < ?1",
            params![cutoff_rfc3339],
        )?;
        Ok(changed as u64)
    }
}
