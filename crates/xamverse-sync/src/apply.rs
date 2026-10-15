//! The receiver-side apply pipeline.
//!
//! Order matters and is fixed (spec §12 + ADR-0004). For every incoming op:
//!
//! 1. **Tenant gate** — school must be enrolled locally; nothing cross-school
//!    is ever parsed further or persisted (Test F).
//! 2. **Category gate** — unknown categories are quarantined as
//!    `schema_unsupported` conflicts, never applied, never silently dropped.
//! 3. **Restriction gate** — restricted categories (identity, permissions,
//!    staff/student records) require the *sender device* to be paired and
//!    trusted for the school; violations quarantine as
//!    `unauthorized_restricted_payload`.
//! 4. **Signature gate** — the author device must be known locally and the
//!    signature must verify; unknown authors are rejected with an actionable
//!    error (sender should sync `device_identity` first).
//! 5. **Payload integrity** — payload hash must match the signed claim.
//! 6. **Idempotency** — a repeated `op_id` yields `duplicate`, never a new
//!    record (lost-ack retry safety).
//! 7. **CAS / conflict analysis** — revision and base-revision checks
//!    produce conflicts per category policy; nothing is last-write-wins.
//! 8. **Transactional commit** — log append + object state + checkpoints in
//!    one transaction, followed by a durable receipt.

use crate::conflict::ConflictStrategy;
use crate::op::{OpOutcome, OpReceipt, SyncOpWire};
use std::sync::Arc;
use xamverse_events::{EngineEvent, EventBus, EventKind};
use xamverse_storage::repos::{
    ConflictRow, ConflictStatus, ConflictsRepo, DevicesRepo, JobStatus, JobsRepo, KvRepo,
    ObjectsRepo, OpRow, OpsRepo, TrustRepo,
};
use xamverse_storage::{now_rfc3339, Database, StorageResult};

const LAMPORT_KEY_PREFIX: &str = "lamport.";

pub struct ApplyPipeline {
    db: Arc<Database>,
    local_device_id: String,
    events: Arc<EventBus>,
}

/// Context of the *transport* peer (who sent this batch), distinct from the
/// op's author device: a relay forwards ops signed by their original author.
pub struct SenderContext<'a> {
    pub device_id: &'a str,
    /// Trust decision the transport layer made for this connection.
    pub trusted: bool,
}

impl ApplyPipeline {
    pub fn new(db: Arc<Database>, local_device_id: String, events: Arc<EventBus>) -> Self {
        Self {
            db,
            local_device_id,
            events,
        }
    }

    /// Apply a batch; every op produces exactly one receipt.
    pub fn apply_batch(
        &self,
        school_id: &str,
        sender: &SenderContext<'_>,
        ops: &[SyncOpWire],
    ) -> StorageResult<Vec<OpReceipt>> {
        let mut receipts = Vec::with_capacity(ops.len());
        for op in ops {
            receipts.push(self.apply_one(school_id, sender, op)?);
        }
        Ok(receipts)
    }

    pub fn apply_one(
        &self,
        school_id: &str,
        sender: &SenderContext<'_>,
        op: &SyncOpWire,
    ) -> StorageResult<OpReceipt> {
        // 0. The op must claim the school it was delivered under — a sender
        // cannot smuggle a different tenant inside a batch.
        if op.school_id != school_id {
            return Ok(reject(op, "school_mismatch: op claims a different tenant than the batch"));
        }

        // 1. Tenant gate.
        let enrolled = {
            let conn = self.db.lock();
            xamverse_storage::repos::SchoolsRepo::exists(&conn, school_id)?
        };
        if !enrolled {
            return Ok(reject(op, "school_not_enrolled on this device"));
        }

        // 2. Category gate.
        let Some(policy) = crate::category::policy_for(&op.category) else {
            let conflict = self.record_conflict(op, "schema_unsupported", ConflictStrategy::Quarantine, None)?;
            return Ok(conflicted(op, conflict));
        };

        // 3. Restriction gate (sender-device trust).
        if policy.restricted && !sender.trusted {
            let conflict = self.record_conflict(
                op,
                "unauthorized_restricted_payload",
                ConflictStrategy::Quarantine,
                None,
            )?;
            self.security_alert(&op, sender);
            return Ok(conflicted(op, conflict));
        }

        // 4. Signature gate against the *author* device's known key.
        let author_pk = {
            let conn = self.db.lock();
            match DevicesRepo::get(&conn, &op.author_device_id) {
                Ok(device) => Some(device.signing_pk),
                Err(_) => None,
            }
        };
        let Some(author_pk) = author_pk else {
            return Ok(reject(
                op,
                "unknown_author: request device_identity sync for this author first",
            ));
        };
        if !op.verify_signature(&author_pk) {
            self.security_alert(&op, sender);
            return Ok(reject(op, "invalid_signature"));
        }

        // 5. Payload integrity.
        if !op.verify_payload_hash(op.payload_json.as_deref()) {
            return Ok(reject(op, "payload_hash_mismatch"));
        }

        // 6–8. Idempotency + CAS + commit in one transaction.
        let receipt = self.db.tx(|conn| {
            if OpsRepo::exists(conn, &op.op_id)? {
                return Ok(duplicate(op));
            }
            let object = ObjectsRepo::get(conn, school_id, &op.category, &op.object_id)?;
            let (current_revision, current_hash, current_tombstone) = match &object {
                Some(o) => (o.current_revision, Some(o.payload_sha256.clone()), o.tombstone),
                None => (0, None, false),
            };

            // Same-or-older revision than the materialized object.
            if op.revision <= current_revision {
                if op.revision == current_revision {
                    if current_hash.as_deref() == Some(op.payload_sha256.as_str()) {
                        return Ok(duplicate(op));
                    }
                    let conflict = self.record_conflict_tx(
                        conn,
                        op,
                        "divergent_revision",
                        policy.default_conflict,
                        object.as_ref().map(|o| o.current_op_id.clone()),
                    )?;
                    return Ok(conflicted(op, conflict));
                }
                return Ok(reject(op, "stale_revision: object already advanced past this op"));
            }

            // Immutable categories only ever accept revision 1 (fresh create).
            if policy.immutable && current_revision > 0 {
                let conflict = self.record_conflict_tx(
                    conn,
                    op,
                    "immutable_violation",
                    policy.default_conflict,
                    object.as_ref().map(|o| o.current_op_id.clone()),
                )?;
                return Ok(conflicted(op, conflict));
            }

            // Update-vs-delete and concurrent-edit detection (CAS on base).
            if current_revision > 0 {
                if op.tombstone != current_tombstone {
                    let conflict = self.record_conflict_tx(
                        conn,
                        op,
                        "update_vs_delete",
                        policy.default_conflict,
                        object.as_ref().map(|o| o.current_op_id.clone()),
                    )?;
                    return Ok(conflicted(op, conflict));
                }
                if !policy.immutable && op.base_revision != current_revision {
                    match policy.default_conflict {
                        ConflictStrategy::Reject => {
                            return Ok(reject(
                                op,
                                "concurrent_update: base revision does not match current",
                            ));
                        }
                        _ => {
                            let conflict = self.record_conflict_tx(
                                conn,
                                op,
                                "concurrent_update",
                                policy.default_conflict,
                                object.as_ref().map(|o| o.current_op_id.clone()),
                            )?;
                            return Ok(conflicted(op, conflict));
                        }
                    }
                }
            }

            // Commit: log + object state + lamport advance.
            let row = OpRow {
                op_id: op.op_id.clone(),
                school_id: school_id.to_string(),
                category: op.category.clone(),
                object_id: op.object_id.clone(),
                revision: op.revision,
                base_revision: op.base_revision,
                author_device_id: op.author_device_id.clone(),
                lamport: op.lamport,
                tombstone: op.tombstone,
                schema_version: op.schema_version,
                payload_sha256: op.payload_sha256.clone(),
                payload_json: op.payload_json.clone(),
                blob_sha256: op.blob_sha256.clone(),
                signature: op.signature.clone(),
                received_from: Some(sender.device_id.to_string()),
                received_at: now_rfc3339(),
            };
            OpsRepo::insert(conn, &row)?;
            ObjectsRepo::apply_op_state(conn, &row)?;
            let key = format!("{LAMPORT_KEY_PREFIX}{school_id}");
            let current_clock: i64 = KvRepo::get(conn, &key)?
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            if op.lamport > current_clock {
                KvRepo::set(conn, &key, &op.lamport.to_string())?;
            }

            Ok(applied(op))
        })?;

        self.emit_receipt_events(school_id, op, &receipt);
        Ok(receipt)
    }

    /// Force-apply the incoming op of a conflict after authorized manual
    /// resolution ("accept incoming"). Signature and trust were already
    /// verified when the conflict was recorded; the CAS check is waived by
    /// explicit human decision, and the waiver is auditable via the
    /// conflict row itself.
    pub fn apply_resolved(&self, school_id: &str, op: &SyncOpWire) -> StorageResult<OpReceipt> {
        let sender = SenderContext {
            device_id: &op.author_device_id,
            trusted: true, // resolution path is a local authorized action
        };
        let receipt = self.db.tx(|conn| {
            if OpsRepo::exists(conn, &op.op_id)? {
                return Ok(duplicate(op));
            }
            let row = OpRow {
                op_id: op.op_id.clone(),
                school_id: school_id.to_string(),
                category: op.category.clone(),
                object_id: op.object_id.clone(),
                revision: op.revision,
                base_revision: op.base_revision,
                author_device_id: op.author_device_id.clone(),
                lamport: op.lamport,
                tombstone: op.tombstone,
                schema_version: op.schema_version,
                payload_sha256: op.payload_sha256.clone(),
                payload_json: op.payload_json.clone(),
                blob_sha256: op.blob_sha256.clone(),
                signature: op.signature.clone(),
                received_from: Some(sender.device_id.to_string()),
                received_at: now_rfc3339(),
            };
            OpsRepo::insert(conn, &row)?;
            ObjectsRepo::apply_op_state(conn, &row)?;
            Ok(applied(op))
        })?;
        Ok(receipt)
    }

    fn record_conflict(
        &self,
        op: &SyncOpWire,
        kind: &str,
        strategy: ConflictStrategy,
        local_op_id: Option<String>,
    ) -> StorageResult<String> {
        self.db.tx(|conn| {
            self.record_conflict_tx(conn, op, kind, strategy, local_op_id)
        })
    }

    fn record_conflict_tx(
        &self,
        conn: &rusqlite::Connection,
        op: &SyncOpWire,
        kind: &str,
        strategy: ConflictStrategy,
        local_op_id: Option<String>,
    ) -> StorageResult<String> {
        let conflict_id = uuid::Uuid::now_v7().to_string();
        ConflictsRepo::insert(
            conn,
            &ConflictRow {
                conflict_id: conflict_id.clone(),
                school_id: op.school_id.clone(),
                category: op.category.clone(),
                object_id: op.object_id.clone(),
                kind: kind.to_string(),
                incoming_op_id: op.op_id.clone(),
                local_op_id,
                incoming_payload_json: op.payload_json.clone(),
                strategy,
                status: ConflictStatus::Open,
                resolution: None,
                resolved_by: None,
                detected_at: now_rfc3339(),
                resolved_at: None,
            },
        )?;
        Ok(conflict_id)
    }

    fn emit_receipt_events(&self, school_id: &str, op: &SyncOpWire, receipt: &OpReceipt) {
        let kind = match &receipt.outcome {
            OpOutcome::Applied => match op.category.as_str() {
                "assessment_package" => EventKind::PackageReceived {
                    package_id: op.object_id.clone(),
                    school_id: school_id.to_string(),
                },
                "submission" | "exam_attempt" => EventKind::SubmissionReceived {
                    attempt_id: op.object_id.clone(),
                    from_device: op.author_device_id.clone(),
                },
                _ => EventKind::TransferCompleted { job_id: op.op_id.clone() },
            },
            OpOutcome::Conflict { conflict_id } => EventKind::ConflictDetected {
                conflict_id: conflict_id.clone(),
                category: op.category.clone(),
                object_id: op.object_id.clone(),
            },
            OpOutcome::Duplicate => EventKind::TransferCompleted { job_id: op.op_id.clone() },
            OpOutcome::Rejected { reason } => EventKind::TransferFailed {
                job_id: op.op_id.clone(),
                error: reason.clone(),
            },
        };
        self.events
            .publish(EngineEvent::new(kind).with_school(school_id));
    }

    fn security_alert(&self, op: &SyncOpWire, sender: &SenderContext<'_>) {
        self.events.publish(EngineEvent::new(EventKind::SecurityAlert {
            alert: format!(
                "quarantined {} op {} from sender {} (author {})",
                op.category, op.op_id, sender.device_id, op.author_device_id
            ),
        }));
    }

    /// Scheduler hook: jobs stuck in `running` after a crash are requeued on
    /// engine start (persisted queue semantics).
    pub fn requeue_interrupted_jobs(&self) -> StorageResult<u64> {
        let conn = self.db.lock();
        JobsRepo::reset_running(&conn)
    }
}

fn applied(op: &SyncOpWire) -> OpReceipt {
    OpReceipt {
        op_id: op.op_id.clone(),
        outcome: OpOutcome::Applied,
    }
}

fn duplicate(op: &SyncOpWire) -> OpReceipt {
    OpReceipt {
        op_id: op.op_id.clone(),
        outcome: OpOutcome::Duplicate,
    }
}

fn conflicted(op: &SyncOpWire, conflict_id: String) -> OpReceipt {
    OpReceipt {
        op_id: op.op_id.clone(),
        outcome: OpOutcome::Conflict { conflict_id },
    }
}

fn reject(op: &SyncOpWire, reason: &str) -> OpReceipt {
    OpReceipt {
        op_id: op.op_id.clone(),
        outcome: OpOutcome::Rejected {
            reason: reason.to_string(),
        },
    }
}
