//! Transactional, checksum-verified, forward-only schema migrations.
//!
//! Rules enforced here (see DATABASE.md):
//! * every migration runs inside a transaction — a failed migration leaves
//!   the previous version untouched,
//! * applied migrations are checksummed; drift is a hard error because it
//!   means the database was modified outside the engine,
//! * a database written by a *newer* engine refuses to open (no silent
//!   downgrade), and there is no automatic rollback of applied migrations —
//!   recovery is restore-from-backup or engine upgrade, documented in
//!   BACKUP_AND_RECOVERY.md.

use crate::error::{StorageError, StorageResult};
use rusqlite::Connection;

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub struct MigrationReport {
    /// Versions applied by this call (empty when the database was current).
    pub applied: Vec<i64>,
    pub current_version: i64,
}

/// Core infrastructure schema (Phase 2). Educational domain tables are NOT
/// modelled here — Phase 3 adds them through new migrations and its own
/// repositories (extension point documented in DATABASE.md).
pub static MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "core_infrastructure",
    sql: r#"
-- Generic engine state ------------------------------------------------------
CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Schools (tenants) ---------------------------------------------------------
CREATE TABLE schools (
    school_id     TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    settings_json TEXT NOT NULL DEFAULT '{}',
    enrolled_at   TEXT NOT NULL
);

-- Devices: the local installation (is_local = 1) and every known peer -------
CREATE TABLE devices (
    device_id    TEXT PRIMARY KEY,
    school_id    TEXT REFERENCES schools(school_id),
    name         TEXT NOT NULL,
    platform     TEXT NOT NULL DEFAULT 'unknown',
    signing_pk   TEXT NOT NULL,
    transport_pk TEXT NOT NULL,
    fingerprint  TEXT NOT NULL,
    is_local     INTEGER NOT NULL DEFAULT 0 CHECK (is_local IN (0, 1)),
    last_seen_at TEXT,
    -- a fingerprint must always map to exactly one device identity
    UNIQUE (fingerprint)
);
CREATE INDEX idx_devices_school ON devices(school_id);

-- Pairing / trust state per school ------------------------------------------
CREATE TABLE device_trust (
    school_id   TEXT NOT NULL REFERENCES schools(school_id),
    device_id   TEXT NOT NULL REFERENCES devices(device_id),
    state       TEXT NOT NULL CHECK (state IN ('pending','trusted','revoked','blocked')),
    paired_at   TEXT,
    approved_by TEXT,
    note        TEXT,
    PRIMARY KEY (school_id, device_id)
);

-- Users and credentials (replicated identity records) -----------------------
CREATE TABLE users (
    user_id          TEXT NOT NULL,
    school_id        TEXT NOT NULL REFERENCES schools(school_id),
    username         TEXT NOT NULL,
    display_name     TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','suspended','disabled')),
    auth_hash        TEXT,
    origin_device_id TEXT,
    revision         INTEGER NOT NULL DEFAULT 1,
    updated_at       TEXT NOT NULL,
    PRIMARY KEY (school_id, user_id),
    UNIQUE (school_id, username)
);

CREATE TABLE roles (
    role_id    TEXT NOT NULL,
    school_id  TEXT NOT NULL REFERENCES schools(school_id),
    name       TEXT NOT NULL,
    is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
    revision   INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (school_id, role_id),
    UNIQUE (school_id, name)
);

CREATE TABLE role_permissions (
    school_id  TEXT NOT NULL,
    role_id    TEXT NOT NULL,
    permission TEXT NOT NULL,
    PRIMARY KEY (school_id, role_id, permission)
);

CREATE TABLE user_roles (
    school_id  TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    role_id    TEXT NOT NULL,
    granted_by TEXT,
    PRIMARY KEY (school_id, user_id, role_id)
);

-- Local sessions (never replicated) ------------------------------------------
CREATE TABLE sessions (
    token_hash     TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    school_id      TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('desktop','browser')),
    origin         TEXT,
    created_at     TEXT NOT NULL,
    expires_at     TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    locked_at      TEXT,
    revoked_at     TEXT,
    revoked_reason TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Login rate limiting --------------------------------------------------------
CREATE TABLE login_attempts (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    key     TEXT NOT NULL,
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    at      TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_key ON login_attempts(key, at);

-- Replication: materialized current object state ------------------------------
CREATE TABLE sync_objects (
    school_id        TEXT NOT NULL,
    category         TEXT NOT NULL,
    object_id        TEXT NOT NULL,
    current_revision INTEGER NOT NULL,
    current_op_id    TEXT NOT NULL,
    payload_sha256   TEXT NOT NULL,
    tombstone        INTEGER NOT NULL DEFAULT 0 CHECK (tombstone IN (0, 1)),
    lamport          INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT NOT NULL,
    PRIMARY KEY (school_id, category, object_id)
);
CREATE INDEX idx_objects_lamport ON sync_objects(school_id, lamport);

-- Replication: append-only, signed operation log (idempotent by op_id) -------
CREATE TABLE sync_ops (
    op_id            TEXT PRIMARY KEY,
    school_id        TEXT NOT NULL,
    category         TEXT NOT NULL,
    object_id        TEXT NOT NULL,
    revision         INTEGER NOT NULL,
    base_revision    INTEGER NOT NULL,
    author_device_id TEXT NOT NULL,
    lamport          INTEGER NOT NULL,
    tombstone        INTEGER NOT NULL DEFAULT 0 CHECK (tombstone IN (0, 1)),
    schema_version   INTEGER NOT NULL DEFAULT 1,
    payload_sha256   TEXT NOT NULL,
    payload_json     TEXT,
    blob_sha256      TEXT,
    signature        TEXT NOT NULL,
    received_from    TEXT,
    received_at      TEXT NOT NULL,
    UNIQUE (school_id, category, object_id, revision)
);
CREATE INDEX idx_ops_school_lamport ON sync_ops(school_id, lamport);
CREATE INDEX idx_ops_school_category ON sync_ops(school_id, category, lamport);

-- Replication: durable outbox (survives restarts; retried with backoff) ------
CREATE TABLE sync_jobs (
    job_id          TEXT PRIMARY KEY,
    school_id       TEXT NOT NULL,
    target_device_id TEXT NOT NULL,
    op_id           TEXT,
    kind            TEXT NOT NULL CHECK (kind IN ('push_op','pull','collect')),
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','completed','failed','cancelled')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_jobs_due ON sync_jobs(status, next_attempt_at);
CREATE INDEX idx_jobs_target ON sync_jobs(target_device_id, status);

-- Replication: per-peer per-category checkpoints ------------------------------
CREATE TABLE sync_checkpoints (
    school_id      TEXT NOT NULL,
    peer_device_id TEXT NOT NULL,
    category       TEXT NOT NULL,
    last_lamport   INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (school_id, peer_device_id, category)
);

-- Content-addressed blob store (large payloads / packages / updates) ---------
CREATE TABLE blobs (
    sha256     TEXT PRIMARY KEY,
    size       INTEGER NOT NULL,
    data       BLOB NOT NULL,
    created_at TEXT NOT NULL
);

-- Conflicts and quarantined payloads ------------------------------------------
CREATE TABLE conflicts (
    conflict_id          TEXT PRIMARY KEY,
    school_id            TEXT NOT NULL,
    category             TEXT NOT NULL,
    object_id            TEXT NOT NULL,
    kind                 TEXT NOT NULL,
    incoming_op_id       TEXT NOT NULL,
    local_op_id          TEXT,
    incoming_payload_json TEXT,
    strategy             TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','resolved','deferred')),
    resolution           TEXT,
    resolved_by          TEXT,
    detected_at          TEXT NOT NULL,
    resolved_at          TEXT
);
CREATE INDEX idx_conflicts_school ON conflicts(school_id, status);

-- Sealed assessment packages --------------------------------------------------
CREATE TABLE packages (
    package_id     TEXT PRIMARY KEY,
    school_id      TEXT NOT NULL,
    assessment_id  TEXT NOT NULL,
    version        INTEGER NOT NULL,
    content_sha256 TEXT NOT NULL,
    manifest_json  TEXT NOT NULL,
    approved_by    TEXT,
    approved_signature TEXT,
    blob_sha256    TEXT NOT NULL REFERENCES blobs(sha256),
    received_from  TEXT,
    created_at     TEXT NOT NULL,
    UNIQUE (school_id, assessment_id, version)
);

-- Examination attempts: durable envelope + hash-chained answer events --------
CREATE TABLE attempts (
    attempt_id        TEXT PRIMARY KEY,
    school_id         TEXT NOT NULL,
    package_id        TEXT NOT NULL,
    student_ref       TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'in_progress'
                      CHECK (status IN ('in_progress','finalized')),
    device_id         TEXT NOT NULL,
    started_at        TEXT NOT NULL,
    finalized_at      TEXT,
    finalize_signature TEXT,
    latest_chain_hash TEXT NOT NULL
);
CREATE INDEX idx_attempts_school ON attempts(school_id, status);

CREATE TABLE attempt_events (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id   TEXT NOT NULL REFERENCES attempts(attempt_id),
    kind         TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at  TEXT NOT NULL,
    prev_hash    TEXT NOT NULL,
    hash         TEXT NOT NULL
);
CREATE INDEX idx_attempt_events ON attempt_events(attempt_id, seq);

-- Collection receipts: proof a finalized attempt reached a collector ----------
CREATE TABLE collection_receipts (
    receipt_id          TEXT PRIMARY KEY,
    attempt_id          TEXT NOT NULL,
    school_id           TEXT NOT NULL,
    collector_device_id TEXT NOT NULL,
    source_device_id    TEXT NOT NULL,
    collected_at        TEXT NOT NULL,
    content_sha256      TEXT NOT NULL,
    UNIQUE (attempt_id, collector_device_id)
);

-- Licences --------------------------------------------------------------------
CREATE TABLE licences (
    licence_id        TEXT PRIMARY KEY,
    school_id         TEXT,
    plan              TEXT NOT NULL,
    status            TEXT NOT NULL
                      CHECK (status IN ('unactivated','active','grace_period',
                                        'expired','invalid','revoked','renewal_required')),
    device_id         TEXT NOT NULL,
    device_fingerprint TEXT NOT NULL,
    features_json     TEXT NOT NULL DEFAULT '[]',
    device_limit      INTEGER NOT NULL DEFAULT 1,
    issued_at         TEXT,
    not_before        TEXT,
    expires_at        TEXT,
    grace_until       TEXT,
    activated_at      TEXT,
    activation_mode   TEXT,
    raw_cert          TEXT NOT NULL,
    signature         TEXT NOT NULL,
    imported_at       TEXT NOT NULL
);

-- Audit log (hash-chained, append-only; writes go through xamverse-audit) ----
CREATE TABLE audit_events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    TEXT NOT NULL UNIQUE,
    school_id   TEXT,
    actor_user  TEXT,
    actor_device TEXT,
    action      TEXT NOT NULL,
    target      TEXT,
    detail_json TEXT,
    at          TEXT NOT NULL,
    prev_hash   TEXT NOT NULL,
    hash        TEXT NOT NULL
);

-- Update history ---------------------------------------------------------------
CREATE TABLE update_history (
    update_id     TEXT PRIMARY KEY,
    version       TEXT NOT NULL,
    platform      TEXT NOT NULL,
    arch          TEXT NOT NULL,
    state         TEXT NOT NULL
                  CHECK (state IN ('imported','verified','staged','applied','failed','rejected')),
    manifest_json TEXT,
    note          TEXT,
    at            TEXT NOT NULL
);

-- Backup metadata ---------------------------------------------------------------
CREATE TABLE backups (
    backup_id      TEXT PRIMARY KEY,
    kind           TEXT NOT NULL CHECK (kind IN ('full','scoped')),
    school_scope   TEXT,
    path           TEXT NOT NULL,
    size_bytes     INTEGER NOT NULL,
    sha256         TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    device_id      TEXT NOT NULL,
    verified       INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
    created_at     TEXT NOT NULL,
    retention_until TEXT
);

-- Generic background jobs (licensing rechecks, update staging, ...) ------------
CREATE TABLE background_jobs (
    job_id       TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','completed','failed')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
"#,
}];

/// Apply all pending migrations. Returns what happened.
pub fn run(conn: &mut Connection) -> StorageResult<MigrationReport> {
    // Version bookkeeping table exists outside user migrations.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            checksum   TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )?;

    // Highest version already in the database — refuses opening a database
    // from a *newer* engine (downgrades are never silent).
    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(StorageError::from)?;

    let known_max = MIGRATIONS.iter().map(|m| m.version).max().unwrap_or(0);
    if current > known_max {
        return Err(StorageError::SchemaTooNew { found: current });
    }

    let mut applied = Vec::new();
    for migration in MIGRATIONS {
        let checksum = crate::checksum(migration.sql);
        let already: Option<String> = conn
            .query_row(
                "SELECT checksum FROM _schema_migrations WHERE version = ?1",
                [migration.version],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
            .map_err(StorageError::from)?;

        match already {
            Some(existing) => {
                if existing != checksum {
                    return Err(StorageError::MigrationChecksumDrift {
                        version: migration.version,
                        name: migration.name.to_string(),
                    });
                }
            }
            None => {
                let tx = conn.transaction()?;
                tx.execute_batch(migration.sql)?;
                tx.execute(
                    "INSERT INTO _schema_migrations (version, name, checksum, applied_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        migration.version,
                        migration.name,
                        checksum,
                        crate::now_rfc3339()
                    ],
                )?;
                tx.commit()?;
                applied.push(migration.version);
                tracing::info!(
                    version = migration.version,
                    name = migration.name,
                    "migration applied"
                );
            }
        }
    }

    let final_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(StorageError::from)?;

    Ok(MigrationReport {
        applied,
        current_version: final_version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Database, DatabaseKey};
    use tempfile::tempdir;

    #[test]
    fn migrations_apply_once_and_are_idempotent() {
        let dir = tempdir().unwrap();
        let key = DatabaseKey::generate();
        let path = dir.path().join("t.xamdb");
        let (db, report1) = Database::open(&path, &key).unwrap();
        assert_eq!(report1.applied, vec![1]);
        drop(db); // close the writer before reopening
        let (_, report2) = Database::open(&path, &key).unwrap();
        assert!(report2.applied.is_empty());
        assert_eq!(report2.current_version, 1);
    }

    #[test]
    fn wrong_key_is_detected_not_silent() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("t.xamdb");
        let (db, _) = Database::open(&path, &DatabaseKey::generate()).unwrap();
        drop(db);
        let err = Database::open(&path, &DatabaseKey::generate());
        assert!(matches!(err, Err(StorageError::DatabaseUnreadable)));
    }
}
