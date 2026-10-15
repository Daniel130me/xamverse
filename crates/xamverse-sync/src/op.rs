//! The replicated operation: structure, canonical signing, verification.
//!
//! A [`SyncOpWire`] is what travels on the wire; `xamverse_storage::OpRow`
//! is what lands in the log. The canonical signing form is the serde JSON of
//! [`OpSigningView`] — struct field order is fixed, so both sides sign and
//! verify identical bytes without a separate canonicalization pass.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use xamverse_identity::verify_signature;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOpWire {
    pub op_id: String,
    pub school_id: String,
    pub category: String,
    pub object_id: String,
    pub revision: i64,
    /// Revision the author based this change on (CAS tag; 0 = create).
    pub base_revision: i64,
    pub author_device_id: String,
    pub lamport: i64,
    pub tombstone: bool,
    pub schema_version: i64,
    pub payload_sha256: String,
    /// Inline JSON payload when small; otherwise the blob reference below.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob_sha256: Option<String>,
    pub signature: String,
}

impl SyncOpWire {
    /// Canonical bytes covered by the author's signature.
    pub fn signing_message(&self) -> Vec<u8> {
        serde_json::to_vec(&OpSigningView {
            op_id: &self.op_id,
            school_id: &self.school_id,
            category: &self.category,
            object_id: &self.object_id,
            revision: self.revision,
            base_revision: self.base_revision,
            author_device_id: &self.author_device_id,
            lamport: self.lamport,
            tombstone: self.tombstone,
            schema_version: self.schema_version,
            payload_sha256: &self.payload_sha256,
            payload_json: &self.payload_json,
            blob_sha256: &self.blob_sha256,
        })
        .expect("signing view is always serializable")
    }

    /// Verify the signature against a known author signing key.
    pub fn verify_signature(&self, author_signing_pk_b64: &str) -> bool {
        verify_signature(author_signing_pk_b64, &self.signing_message(), &self.signature)
    }

    /// Recompute the payload hash — detects payload/signature mismatch.
    /// Inline payloads hash their own bytes; blob-only ops hash the content
    /// address. Ops may carry BOTH (e.g. package manifest inline + content
    /// blob reference) — the hash then covers the inline payload while the
    /// blob's own integrity is content-addressed.
    pub fn verify_payload_hash(&self, inline_payload: Option<&str>) -> bool {
        match (&self.payload_json, &self.blob_sha256) {
            (Some(_), _) => match inline_payload {
                Some(payload) => {
                    let mut hasher = Sha256::new();
                    hasher.update(payload.as_bytes());
                    let hex: String =
                        hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
                    constant_eq(hex.as_bytes(), self.payload_sha256.as_bytes())
                }
                None => false,
            },
            (None, Some(blob_ref)) => constant_eq(blob_ref.as_bytes(), self.payload_sha256.as_bytes()),
            (None, None) => false,
        }
    }
}

/// Borrowing mirror producing the exact signed bytes.
#[derive(Serialize)]
struct OpSigningView<'a> {
    op_id: &'a str,
    school_id: &'a str,
    category: &'a str,
    object_id: &'a str,
    revision: i64,
    base_revision: i64,
    author_device_id: &'a str,
    lamport: i64,
    tombstone: bool,
    schema_version: i64,
    payload_sha256: &'a str,
    payload_json: &'a Option<String>,
    blob_sha256: &'a Option<String>,
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Per-operation receipt returned by the receiver (durable — it is persisted
/// on the sender side as job history and audited).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OpOutcome {
    Applied,
    Duplicate,
    Conflict { conflict_id: String },
    Rejected { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpReceipt {
    pub op_id: String,
    pub outcome: OpOutcome,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_op() -> SyncOpWire {
        SyncOpWire {
            op_id: uuid::Uuid::now_v7().to_string(),
            school_id: "s1".into(),
            category: "question_bank".into(),
            object_id: "obj-1".into(),
            revision: 1,
            base_revision: 0,
            author_device_id: "dev-a".into(),
            lamport: 1,
            tombstone: false,
            schema_version: 1,
            payload_sha256: "abc".into(),
            payload_json: Some(r#"{"k":1}"#.into()),
            blob_sha256: None,
            signature: String::new(),
        }
    }

    #[test]
    fn payload_hash_matches_inline_payload() {
        let mut op = sample_op();
        assert!(!op.verify_payload_hash(Some(r#"{"k":2}"#)));
        // Recompute correctly:
        let mut hasher = Sha256::new();
        hasher.update(op.payload_json.as_ref().unwrap().as_bytes());
        op.payload_sha256 = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        assert!(op.verify_payload_hash(op.payload_json.as_deref()));
    }

    #[test]
    fn blob_ops_hash_the_reference() {
        let mut op = sample_op();
        op.payload_json = None;
        op.blob_sha256 = Some("deadbeef".into());
        op.payload_sha256 = "deadbeef".into();
        assert!(op.verify_payload_hash(None));
        op.payload_sha256 = "0000".into();
        assert!(!op.verify_payload_hash(None));
    }
}
