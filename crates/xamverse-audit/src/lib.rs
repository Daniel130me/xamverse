//! Tamper-evident audit log.
//!
//! WHY THIS EXISTS
//! ---------------
//! Authentication events, permission changes, pairings, licence changes and
//! conflict resolutions must leave an immutable trail that a school can
//! inspect and that tampering (row edits, deletions, reordering) breaks
//! detectably. Each row commits to `SHA-256(prev_hash | fields)`, forming a
//! chain over append order — the same technique as the per-attempt event
//! chains in storage.

// Tests read far better with unwrap/expect; the lint stays enforced
// for library code — this exemption is scoped to cfg(test) only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use xamverse_storage::StorageResult;

/// Who did what, to what, when. Written inside the caller's transaction so
/// audit rows commit atomically with the change they describe.
#[derive(Debug, Clone)]
pub struct AuditEvent {
    pub event_id: String,
    pub school_id: Option<String>,
    pub actor_user: Option<String>,
    pub actor_device: Option<String>,
    pub action: String,
    pub target: Option<String>,
    pub detail_json: Option<String>,
}

impl AuditEvent {
    pub fn new(action: impl Into<String>) -> Self {
        Self {
            event_id: uuid::Uuid::now_v7().to_string(),
            school_id: None,
            actor_user: None,
            actor_device: None,
            action: action.into(),
            target: None,
            detail_json: None,
        }
    }

    pub fn with_school(mut self, school_id: impl Into<String>) -> Self {
        self.school_id = Some(school_id.into());
        self
    }

    pub fn with_actor(mut self, user: impl Into<String>, device: impl Into<String>) -> Self {
        self.actor_user = Some(user.into());
        self.actor_device = Some(device.into());
        self
    }

    pub fn with_target(mut self, target: impl Into<String>) -> Self {
        self.target = Some(target.into());
        self
    }

    pub fn with_detail_json(mut self, detail_json: impl Into<String>) -> Self {
        self.detail_json = Some(detail_json.into());
        self
    }
}

/// A stored audit row (read model).
#[derive(Debug, Clone, serde::Serialize)]
pub struct AuditRow {
    pub seq: i64,
    pub event_id: String,
    pub school_id: Option<String>,
    pub actor_user: Option<String>,
    pub actor_device: Option<String>,
    pub action: String,
    pub target: Option<String>,
    pub detail_json: Option<String>,
    pub at: String,
}

/// Append an event to the chain. Returns the stored row (with its hash, the
/// new chain head). Call inside the same transaction as the change being
/// audited so the trail is atomic with the action.
pub fn record(conn: &Connection, event: &AuditEvent) -> StorageResult<AuditRow> {
    let at = xamverse_storage::now_rfc3339();
    let prev_hash: String = conn
        .query_row(
            "SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| String::new()); // empty = genesis
    let hash = chain_hash(ChainInput::of(&prev_hash, event, &at));
    conn.execute(
        "INSERT INTO audit_events
            (event_id, school_id, actor_user, actor_device, action, target,
             detail_json, at, prev_hash, hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            event.event_id,
            event.school_id,
            event.actor_user,
            event.actor_device,
            event.action,
            event.target,
            event.detail_json,
            at,
            prev_hash,
            hash,
        ],
    )?;
    Ok(AuditRow {
        seq: conn.last_insert_rowid(),
        event_id: event.event_id.clone(),
        school_id: event.school_id.clone(),
        actor_user: event.actor_user.clone(),
        actor_device: event.actor_device.clone(),
        action: event.action.clone(),
        target: event.target.clone(),
        detail_json: event.detail_json.clone(),
        at,
    })
}

/// Re-compute the entire chain and report whether it is intact.
/// Tampering with any field of any row, deleting a row, or reordering rows
/// breaks verification (audit + storage tests exercise this).
pub fn verify_chain(conn: &Connection) -> StorageResult<bool> {
    let mut stmt = conn.prepare(
        "SELECT seq, event_id, school_id, actor_user, actor_device, action, target,
                detail_json, at, prev_hash, hash
         FROM audit_events ORDER BY seq",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
            ))
        })?
        .collect::<Result<Vec<_>, rusqlite::Error>>()?;

    let mut prev = String::new();
    for (
        event_id,
        school_id,
        actor_user,
        actor_device,
        action,
        target,
        detail,
        at,
        stored_prev,
        stored_hash,
    ) in rows
    {
        if stored_prev != prev {
            return Ok(false);
        }
        let expected = chain_hash(ChainInput {
            prev_hash: &prev,
            event_id: &event_id,
            school_id: school_id.as_deref(),
            actor_user: actor_user.as_deref(),
            actor_device: actor_device.as_deref(),
            action: &action,
            target: target.as_deref(),
            detail_json: detail.as_deref(),
            at: &at,
        });
        if expected != stored_hash {
            return Ok(false);
        }
        prev = stored_hash;
    }
    Ok(true)
}

/// Query filters for reading the audit trail.
#[derive(Debug, Default, Clone)]
pub struct AuditQuery {
    pub school_id: Option<String>,
    pub actor_user: Option<String>,
    pub action_prefix: Option<String>,
    pub limit: i64,
}

/// Read rows newest-first under the given filters.
pub fn query(conn: &Connection, filter: &AuditQuery) -> StorageResult<Vec<AuditRow>> {
    let mut sql = String::from(
        "SELECT seq, event_id, school_id, actor_user, actor_device, action, target,
                detail_json, at
         FROM audit_events WHERE 1 = 1",
    );
    let mut bind: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(school) = &filter.school_id {
        sql.push_str(&format!(" AND school_id = ?{}", bind.len() + 1));
        bind.push(Box::new(school.clone()));
    }
    if let Some(user) = &filter.actor_user {
        sql.push_str(&format!(" AND actor_user = ?{}", bind.len() + 1));
        bind.push(Box::new(user.clone()));
    }
    if let Some(prefix) = &filter.action_prefix {
        sql.push_str(&format!(" AND action LIKE ?{} || '%'", bind.len() + 1));
        bind.push(Box::new(prefix.clone()));
    }
    let limit = if filter.limit > 0 { filter.limit } else { 200 };
    sql.push_str(&format!(" ORDER BY seq DESC LIMIT {limit}"));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(bind.iter().map(|b| b.as_ref())),
            |row| {
                Ok(AuditRow {
                    seq: row.get(0)?,
                    event_id: row.get(1)?,
                    school_id: row.get(2)?,
                    actor_user: row.get(3)?,
                    actor_device: row.get(4)?,
                    action: row.get(5)?,
                    target: row.get(6)?,
                    detail_json: row.get(7)?,
                    at: row.get(8)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, rusqlite::Error>>()?;
    Ok(rows)
}

/// Everything the audit hash covers, grouped so `chain_hash` takes one
/// argument instead of nine (clippy::too_many_arguments) and call sites
/// cannot accidentally swap two same-typed fields.
struct ChainInput<'a> {
    prev_hash: &'a str,
    event_id: &'a str,
    school_id: Option<&'a str>,
    actor_user: Option<&'a str>,
    actor_device: Option<&'a str>,
    action: &'a str,
    target: Option<&'a str>,
    detail_json: Option<&'a str>,
    at: &'a str,
}

impl<'a> ChainInput<'a> {
    /// Collect the fields of a freshly-timestamped event.
    fn of(prev_hash: &'a str, event: &'a AuditEvent, at: &'a str) -> Self {
        Self {
            prev_hash,
            event_id: &event.event_id,
            school_id: event.school_id.as_deref(),
            actor_user: event.actor_user.as_deref(),
            actor_device: event.actor_device.as_deref(),
            action: &event.action,
            target: event.target.as_deref(),
            detail_json: event.detail_json.as_deref(),
            at,
        }
    }
}

fn chain_hash(input: ChainInput<'_>) -> String {
    let ChainInput {
        prev_hash,
        event_id,
        school_id,
        actor_user,
        actor_device,
        action,
        target,
        detail_json,
        at,
    } = input;
    let mut hasher = Sha256::new();
    hasher.update(prev_hash.as_bytes());
    hasher.update(b"|");
    hasher.update(event_id.as_bytes());
    hasher.update(b"|");
    hasher.update(school_id.unwrap_or("").as_bytes());
    hasher.update(b"|");
    hasher.update(actor_user.unwrap_or("").as_bytes());
    hasher.update(b"|");
    hasher.update(actor_device.unwrap_or("").as_bytes());
    hasher.update(b"|");
    hasher.update(action.as_bytes());
    hasher.update(b"|");
    hasher.update(target.unwrap_or("").as_bytes());
    hasher.update(b"|");
    hasher.update(detail_json.unwrap_or("").as_bytes());
    hasher.update(b"|");
    hasher.update(at.as_bytes());
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use xamverse_storage::{Database, DatabaseKey};

    fn db() -> (tempfile::TempDir, Database) {
        let dir = tempdir().unwrap();
        let (db, _) =
            Database::open(dir.path().join("audit.xamdb"), &DatabaseKey::generate()).unwrap();
        (dir, db)
    }

    #[test]
    fn chain_records_and_verifies() {
        let (_dir, db) = db();
        let conn = db.lock();
        for i in 0..5 {
            record(
                &conn,
                &AuditEvent::new(format!("auth.login:{i}")).with_school("school-1"),
            )
            .unwrap();
        }
        assert!(verify_chain(&conn).unwrap());
    }

    #[test]
    fn tampering_breaks_verification() {
        let (_dir, db) = db();
        let conn = db.lock();
        record(&conn, &AuditEvent::new("auth.login")).unwrap();
        record(&conn, &AuditEvent::new("auth.logout")).unwrap();

        // Simulate a database-level edit (what a DB-file attacker would do).
        conn.execute(
            "UPDATE audit_events SET action = 'forged.action' WHERE seq = 1",
            [],
        )
        .unwrap();
        assert!(!verify_chain(&conn).unwrap());
    }

    #[test]
    fn deletion_breaks_verification() {
        let (_dir, db) = db();
        let conn = db.lock();
        record(&conn, &AuditEvent::new("a")).unwrap();
        record(&conn, &AuditEvent::new("b")).unwrap();
        record(&conn, &AuditEvent::new("c")).unwrap();
        conn.execute("DELETE FROM audit_events WHERE seq = 2", [])
            .unwrap();
        assert!(!verify_chain(&conn).unwrap());
    }

    #[test]
    fn query_filters_apply() {
        let (_dir, db) = db();
        let conn = db.lock();
        record(&conn, &AuditEvent::new("auth.login").with_school("s1")).unwrap();
        record(&conn, &AuditEvent::new("devices.pair").with_school("s1")).unwrap();
        record(&conn, &AuditEvent::new("auth.login").with_school("s2")).unwrap();

        let rows = query(
            &conn,
            &AuditQuery {
                school_id: Some("s1".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        let rows = query(
            &conn,
            &AuditQuery {
                action_prefix: Some("auth.".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        let rows = query(&conn, &AuditQuery::default()).unwrap();
        assert_eq!(rows.len(), 3);
    }
}
