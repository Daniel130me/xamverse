//! Peer-to-peer replication engine.
//!
//! Layering: `category` (policies) → `op` (signed operations) → `local`
//! (create/sign/enqueue) → `apply` (receiver pipeline + conflicts) →
//! `messages` (wire schemas) → `engine` (state, pairing, connections) →
//! `runner` (durable job execution, blobs, pull) → `handler` (dispatch).
//!
//! Guarantees implemented here (see SYNC_ENGINE.md):
//! * idempotent apply by op id — retries after lost acks never duplicate,
//! * transfer success == durable receipt, never bytes sent,
//! * resumable content-addressed blob transfers with hash verification,
//! * per-category conflict policies — no unconditional last-write-wins,
//! * no permanent collector roles — any trusted peer may be collected from.

pub mod apply;
pub mod category;
pub mod conflict;
pub mod engine;
pub mod handler;
pub mod local;
pub mod messages;
pub mod op;
pub mod runner;
pub mod store;

pub use apply::ApplyPipeline;
pub use conflict::{ConflictService, Resolution};
pub use engine::SyncEngine;
pub use local::{LocalOps, MAX_INLINE_PAYLOAD};
pub use messages::*;
pub use op::{OpOutcome, OpReceipt, SyncOpWire};
pub use runner::{backoff, PullSummary};
pub use store::{AttemptEnvelope, AttemptStore, PackageManifest, PackageStore};

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error(transparent)]
    Storage(#[from] xamverse_storage::StorageError),
    #[error(transparent)]
    Network(#[from] xamverse_network::PeerServerError),
    #[error(transparent)]
    Channel(#[from] xamverse_network::ChannelError),
    #[error("peer replied with error {code}: {detail}")]
    PeerError { code: String, detail: String },
    #[error("no address known for device {0}; discover or add a manual peer")]
    NoAddress(String),
    #[error("blob {0} hash mismatch after transfer")]
    BlobHashMismatch(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

// Keep engine-level constants importable where they are used.
pub(crate) use engine::{JOB_POLL_INTERVAL, MANIFEST_PAGE, MAX_BLOB_ROUNDS, MAX_RETRIES};
