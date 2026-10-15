//! Storage error type shared by the database layer and all repositories.

use rusqlite;

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("database is corrupt or the encryption key is wrong")]
    DatabaseUnreadable,

    #[error("database was written by a newer engine (schema v{found}); upgrade the engine or restore a compatible backup")]
    SchemaTooNew { found: i64 },

    #[error("migration checksum drift on v{version} ({name}); the database was modified after deployment")]
    MigrationChecksumDrift { version: i64, name: String },

    #[error("record not found: {entity}:{id}")]
    NotFound { entity: &'static str, id: String },

    #[error("record already exists: {entity}:{id}")]
    AlreadyExists { entity: &'static str, id: String },

    #[error("constraint violated: {0}")]
    Constraint(String),

    #[error("invalid value for {field}: {reason}")]
    InvalidValue { field: &'static str, reason: String },

    #[error(transparent)]
    Sql(#[from] rusqlite::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type StorageResult<T> = Result<T, StorageError>;
