//! Engine-level error type.

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("another engine instance is already running (lock: {path})")]
    AlreadyRunning { path: String },
    #[error("peer protocol violation: {0}")]
    PeerProtocol(String),
    #[error(transparent)]
    Storage(#[from] xamverse_storage::StorageError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Network(#[from] xamverse_network::PeerServerError),
    #[error(transparent)]
    Sync(#[from] xamverse_sync::SyncError),
    #[error(transparent)]
    Licensing(#[from] xamverse_licensing::LicenceError),
    #[error(transparent)]
    Backup(#[from] xamverse_backup::BackupError),
    #[error(transparent)]
    Updates(#[from] xamverse_updater::UpdateError),
    #[error(transparent)]
    Auth(#[from] xamverse_security::AuthError),
}
