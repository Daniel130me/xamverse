//! Sync message payloads (request/response schemas on the wire).
//!
//! Everything is versioned JSON inside the transport envelope; each type
//! below documents the invariant it must uphold.

use crate::op::{OpReceipt, SyncOpWire};
use serde::{Deserialize, Serialize};
use xamverse_storage::repos::ObjectSummary;

/// Receiver → sender: which objects does the peer have above a watermark?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestRequest {
    pub school_id: String,
    /// Empty list = all categories the receiver is enrolled for.
    pub categories: Vec<String>,
    /// Sender replies with objects whose lamport > this value.
    pub since_lamport: i64,
    pub limit: i64,
}

/// Sender → receiver: manifest of available objects.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub school_id: String,
    pub summaries: Vec<ObjectSummary>,
    /// Highest lamport covered by this manifest (for checkpoint advance).
    pub max_lamport: i64,
    pub truncated: bool,
}

/// Receiver → sender: fetch specific ops (from a manifest diff).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsGet {
    pub school_id: String,
    pub op_ids: Vec<String>,
}

/// Sender → receiver: signed ops to apply.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsPush {
    pub school_id: String,
    pub ops: Vec<SyncOpWire>,
}

/// Receiver → sender: durable per-op outcomes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsAck {
    pub receipts: Vec<OpReceipt>,
}

/// Receiver → sender: continue a blob transfer from `offset`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobGet {
    pub sha256: String,
    pub offset: i64,
    /// Requested slice length (sender may return less on the final chunk).
    pub length: i64,
}

/// Sender → receiver: one slice of content-addressed data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobChunk {
    pub sha256: String,
    pub offset: i64,
    /// Total size of the complete blob so the receiver knows when to stop.
    pub total_size: i64,
    pub data_b64: String,
    pub eof: bool,
}

/// Receiver → sender: how many bytes of a blob are already stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobStatus {
    pub sha256: String,
}

/// Sender → receiver: current stored length of a blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobStatusReply {
    pub sha256: String,
    pub stored_bytes: i64,
    /// Sender-side total (0 when the sender does not have it either).
    pub total_size: i64,
}

/// Initiator → remote: start the pairing dance (see `engine::pair_with`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairRequest {
    pub school_id: String,
    pub school_name: String,
    pub requester_device_id: String,
    pub requester_name: String,
    pub requester_fingerprint: String,
}

/// Remote → initiator: pairing recorded as `pending` awaiting human approval.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairPending {
    pub responder_device_id: String,
    pub responder_name: String,
    pub responder_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ping {
    pub sent_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pong {
    pub sent_at: String,
    pub responded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_reply_to: Option<String>,
}
