//! Encrypted local database for the XamVerse engine.
//!
//! WHY THIS EXISTS
//! ---------------
//! Every installation keeps its own authoritative copy of the data it is
//! allowed to hold. This crate owns everything persistent:
//!
//! * opening and creating SQLCipher-encrypted databases,
//! * transactional schema migrations,
//! * the repositories every other crate uses (the **only** place raw SQL is
//!   allowed in the engine),
//! * the keystore contract for engine secrets.
//!
//! Concurrency model: one writer connection behind a mutex. SQLite in WAL
//! mode serves readers well, but the engine's write volume (sync apply,
//! sessions, audit) is modest; a single serialized writer removes all
//! `SQLITE_BUSY` reasoning from callers while prepared statements are
//! re-created per call (rusqlite caches per connection when needed). Batch
//! writes always go through [`Database::tx`] so they commit atomically.

pub mod error;
pub mod keystore;
pub mod migrations;
pub mod repos;

pub use error::{StorageError, StorageResult};
pub use keystore::{FileKeyStore, MemoryKeyStore, SecureKeyStore};
pub use migrations::{Migration, MigrationReport};
pub use rusqlite::Connection;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// How long a write waits for a competing connection before giving up.
const BUSY_TIMEOUT_MS: u64 = 5_000;

/// `synchronous=NORMAL` with WAL: durable across application crashes, only
/// vulnerable to OS/power loss for the most recent transactions — the right
/// trade-off for a school lab (documented in DATABASE.md).
const SYNCHRONOUS_MODE: &str = "NORMAL";

/// AES-256 key material for SQLCipher.
#[derive(Clone)]
pub struct DatabaseKey {
    bytes: [u8; 32],
}

impl DatabaseKey {
    pub fn generate() -> Self {
        let mut bytes = [0u8; 32];
        // rand's thread RNG is a CSPRNG (ChaCha12-based); fill via rand_core.
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut bytes);
        Self { bytes }
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self { bytes }
    }

    pub fn from_hex(hex: &str) -> StorageResult<Self> {
        let bytes = keystore::hex_to_bytes(hex).ok_or_else(|| StorageError::InvalidValue {
            field: "database key",
            reason: "must be 64 hex characters".into(),
        })?;
        let mut key = [0u8; 32];
        if bytes.len() != 32 {
            return Err(StorageError::InvalidValue {
                field: "database key",
                reason: "must be exactly 32 bytes".into(),
            });
        }
        key.copy_from_slice(&bytes);
        Ok(Self { bytes: key })
    }

    pub fn hex(&self) -> String {
        keystore::bytes_to_hex(&self.bytes)
    }

    /// SQLCipher PRAGMA key literal using hex syntax so arbitrary bytes are
    /// safe without escaping concerns.
    fn pragma_value(&self) -> String {
        format!("x'{}'", self.hex())
    }
}

impl std::fmt::Debug for DatabaseKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never leak key material through Debug/ logs.
        f.write_str("DatabaseKey(REDACTED)")
    }
}

pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Database {
    /// Open (or create) an encrypted database and run migrations.
    pub fn open(path: impl Into<PathBuf>, key: &DatabaseKey) -> StorageResult<(Self, MigrationReport)> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let mut conn = Connection::open(&path)?;

        // Unlock the database. SQLCipher only surfaces key errors on first
        // use, so probe immediately for a fail-fast, explicit error.
        conn.pragma_update(None, "key", &key.pragma_value())?;
        let probe: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| row.get(0))
            .map_err(|e| match e {
                rusqlite::Error::SqliteFailure(err, _)
                    if err.code == rusqlite::ErrorCode::NotADatabase =>
                {
                    StorageError::DatabaseUnreadable
                }
                other => other.into(),
            })?;
        let _ = probe;

        // Durability and concurrency pragmas. journal_mode returns a row, so
        // it is queried rather than pragma_update'd.
        let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
        conn.pragma_update(None, "synchronous", SYNCHRONOUS_MODE)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_millis(BUSY_TIMEOUT_MS))?;

        let report = migrations::run(&mut conn)?;
        tracing::info!(path = %path.display(), schema = report.current_version, "database ready");
        Ok((
            Self {
                conn: Mutex::new(conn),
                path,
            },
            report,
        ))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Access the connection for read queries.
    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Run a closure inside an IMMEDIATE transaction: writes are serialized
    /// at BEGIN, so the engine's read-modify-write replication logic cannot
    /// interleave. Rollback happens on `Err`.
    pub fn tx<T>(&self, f: impl FnOnce(&Connection) -> StorageResult<T>) -> StorageResult<T> {
        let mut guard = self.lock();
        let tx = guard.transaction()?;
        let outcome = f(&tx)?;
        tx.commit()?;
        Ok(outcome)
    }

    /// SQLite integrity verification used by diagnostics and backups.
    pub fn integrity_check(&self) -> StorageResult<String> {
        let guard = self.lock();
        let result: String = guard.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        Ok(result)
    }

    /// Quick-consistency check (cheaper than integrity_check).
    pub fn quick_check(&self) -> StorageResult<String> {
        let guard = self.lock();
        let result: String = guard.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        Ok(result)
    }

    /// User-visible row count summary for diagnostics.
    pub fn table_summary(&self) -> StorageResult<Vec<(String, i64)>> {
        let guard = self.lock();
        let mut stmt = guard.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table'
             AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'
             ORDER BY name",
        )?;
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        let mut out = Vec::with_capacity(tables.len());
        for table in tables {
            // Table names come from sqlite_master, not user input.
            let count: i64 = guard.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |r| r.get(0))?;
            out.push((table, count));
        }
        Ok(out)
    }
}

/// RFC3339 UTC timestamp used consistently for all persisted timestamps.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Cryptographically secure random bytes.
pub fn random_bytes(len: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

/// SHA-256 hex digest — used for migration checksums and content addressing.
pub fn checksum(data: impl AsRef<[u8]>) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(data.as_ref());
    keystore::bytes_to_hex(&digest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn open_creates_parent_directories() {
        let dir = tempdir().unwrap();
        let deep = dir.path().join("a/b/c/engine.xamdb");
        let (db, report) = Database::open(&deep, &DatabaseKey::generate()).unwrap();
        assert_eq!(report.current_version, 1);
        assert!(deep.exists());
        assert_eq!(db.integrity_check().unwrap(), "ok");
    }

    #[test]
    fn debug_never_leaks_key() {
        let key = DatabaseKey::generate();
        assert_eq!(format!("{key:?}"), "DatabaseKey(REDACTED)");
        assert!(!format!("{key:?}").contains(&key.hex()));
    }

    #[test]
    fn table_summary_reports_created_tables() {
        let dir = tempdir().unwrap();
        let (db, _) = Database::open(dir.path().join("s.xamdb"), &DatabaseKey::generate()).unwrap();
        let summary = db.table_summary().unwrap();
        assert!(summary.iter().any(|(t, _)| t == "sync_ops"));
        assert!(summary.iter().all(|(t, _)| !t.starts_with('_')));
    }
}
