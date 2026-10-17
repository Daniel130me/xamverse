//! Conflict resolution API: list, inspect, and resolve recorded conflicts.
//!
//! Resolution is an *authorized* act (engine checks `sync.resolve_conflict`)
//! and is itself auditable via the audit trail. The chosen outcome:
//! * `AcceptIncoming` — force-apply the quarantined op (signature and trust
//!   were verified when the conflict was recorded),
//! * `KeepLocal` — discard the incoming revision permanently,
//! * `Defer` — leave the conflict open for a later decision.

use crate::op::OpOutcome;
use std::sync::Arc;
use xamverse_events::{EngineEvent, EventBus, EventKind};
pub use xamverse_storage::repos::ConflictStrategy;
use xamverse_storage::repos::{ConflictRow, ConflictStatus, ConflictsRepo, ObjectsRepo, OpsRepo};
use xamverse_storage::{Database, StorageError, StorageResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Resolution {
    AcceptIncoming,
    KeepLocal,
}

pub struct ConflictService {
    db: Arc<Database>,
    events: Arc<EventBus>,
}

impl ConflictService {
    pub fn new(db: Arc<Database>, events: Arc<EventBus>) -> Self {
        Self { db, events }
    }

    pub fn list(
        &self,
        school_id: &str,
        status: Option<ConflictStatus>,
    ) -> StorageResult<Vec<ConflictRow>> {
        let conn = self.db.lock();
        ConflictsRepo::list(&conn, school_id, status)
    }

    pub fn get(&self, conflict_id: &str) -> StorageResult<ConflictRow> {
        let conn = self.db.lock();
        ConflictsRepo::get(&conn, conflict_id)
    }

    /// Apply a resolution. `resolved_by` is the acting user id (audited).
    pub fn resolve(
        &self,
        conflict_id: &str,
        resolution: Resolution,
        resolved_by: &str,
        note: Option<&str>,
    ) -> StorageResult<OpOutcome> {
        let conflict = {
            let conn = self.db.lock();
            ConflictsRepo::get(&conn, conflict_id)?
        };
        if conflict.status != ConflictStatus::Open {
            return Err(StorageError::Constraint(format!(
                "conflict {conflict_id} is already {status}",
                status = conflict.status.as_str()
            )));
        }

        let outcome = match resolution {
            Resolution::KeepLocal => OpOutcome::Rejected {
                reason: "resolved: local revision kept".into(),
            },
            Resolution::AcceptIncoming => {
                // The quarantined op must still be in the log (it was written
                // when the conflict was recorded) — or provided via blob
                // payload. Reload it and force-apply past the CAS check.
                let incoming = {
                    let conn = self.db.lock();
                    OpsRepo::get(&conn, &conflict.incoming_op_id).ok()
                };
                match incoming {
                    Some(row) => {
                        let wire = crate::runner::op_row_to_wire(&row);
                        let pipeline = self.pipeline();
                        pipeline.apply_resolved(&conflict.school_id, &wire)?.outcome
                    }
                    None => {
                        return Err(StorageError::NotFound {
                            entity: "conflict op",
                            id: conflict.incoming_op_id.clone(),
                        })
                    }
                }
            }
        };

        self.db.tx(|conn| {
            ConflictsRepo::resolve(conn, conflict_id, &format!("{resolution:?}"), resolved_by)?;
            xamverse_audit::record(
                conn,
                &xamverse_audit::AuditEvent::new("sync.conflict_resolved")
                    .with_school(&conflict.school_id)
                    .with_actor(resolved_by, "")
                    .with_target(conflict_id)
                    .with_detail_json(
                        serde_json::json!({
                            "resolution": resolution,
                            "note": note,
                            "category": conflict.category,
                            "object_id": conflict.object_id,
                        })
                        .to_string(),
                    ),
            )?;
            Ok(())
        })?;

        self.events.publish(
            EngineEvent::new(EventKind::ConflictResolved {
                conflict_id: conflict_id.to_string(),
                resolution: format!("{resolution:?}"),
            })
            .with_school(&conflict.school_id),
        );
        Ok(outcome)
    }

    pub fn defer(&self, conflict_id: &str) -> StorageResult<()> {
        let conn = self.db.lock();
        ConflictsRepo::defer(&conn, conflict_id)
    }

    fn pipeline(&self) -> crate::apply::ApplyPipeline {
        // A fresh pipeline reuses the shared DB/events; the resolution flow
        // only reads stored rows and never needs an identity context.
        crate::apply::ApplyPipeline::new(self.db.clone(), self.events.clone())
    }

    /// Read-model convenience: current object state for a conflicted object.
    pub fn object_state(
        &self,
        school_id: &str,
        category: &str,
        object_id: &str,
    ) -> StorageResult<Option<xamverse_storage::repos::ObjectRow>> {
        let conn = self.db.lock();
        ObjectsRepo::get(&conn, school_id, category, object_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::op::SyncOpWire;
    use xamverse_storage::repos::SchoolsRepo;
    use xamverse_storage::DatabaseKey;

    fn wire(op_id: &str, revision: i64, base: i64, payload: &str) -> SyncOpWire {
        SyncOpWire {
            op_id: op_id.into(),
            school_id: "s1".into(),
            category: "question_bank".into(),
            object_id: "obj-1".into(),
            revision,
            base_revision: base,
            author_device_id: "dev-a".into(),
            lamport: revision,
            tombstone: false,
            schema_version: 1,
            payload_sha256: {
                use sha2::{Digest, Sha256};
                let mut h = Sha256::new();
                h.update(payload.as_bytes());
                h.finalize().iter().map(|b| format!("{b:02x}")).collect()
            },
            payload_json: Some(payload.into()),
            blob_sha256: None,
            signature: String::new(),
        }
    }

    #[test]
    fn resolution_history_and_events() {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = Database::open(dir.path().join("c.xamdb"), &DatabaseKey::generate()).unwrap();
        let db = Arc::new(db);
        let events = Arc::new(EventBus::new());
        db.tx(|conn| SchoolsRepo::enroll(conn, "s1", "S")).unwrap();

        let conflicts = ConflictService::new(db.clone(), events.clone());
        let conflict_id = {
            // Simulate a recorded conflict (as the apply pipeline would).
            let conn = db.lock();
            let op = wire("op-incoming", 2, 0, r#"{"v":"incoming"}"#);
            ConflictsRepo::insert(
                &conn,
                &ConflictRow {
                    conflict_id: "cf-1".into(),
                    school_id: "s1".into(),
                    category: op.category.clone(),
                    object_id: op.object_id.clone(),
                    kind: "concurrent_update".into(),
                    incoming_op_id: op.op_id.clone(),
                    local_op_id: None,
                    incoming_payload_json: op.payload_json.clone(),
                    strategy: crate::conflict::ConflictStrategy::Manual,
                    status: ConflictStatus::Open,
                    resolution: None,
                    resolved_by: None,
                    detected_at: xamverse_storage::now_rfc3339(),
                    resolved_at: None,
                },
            )
            .unwrap();
            drop(conn);
            // The pipeline needs the op in the log to accept it.
            let conn = db.lock();
            OpsRepo::insert(
                &conn,
                &xamverse_storage::repos::OpRow {
                    op_id: op.op_id.clone(),
                    school_id: op.school_id.clone(),
                    category: op.category.clone(),
                    object_id: op.object_id.clone(),
                    revision: op.revision,
                    base_revision: op.base_revision,
                    author_device_id: op.author_device_id.clone(),
                    lamport: op.lamport,
                    tombstone: false,
                    schema_version: 1,
                    payload_sha256: op.payload_sha256.clone(),
                    payload_json: op.payload_json.clone(),
                    blob_sha256: None,
                    signature: op.signature.clone(),
                    received_from: Some("dev-a".to_string()),
                    received_at: xamverse_storage::now_rfc3339(),
                },
            )
            .unwrap();
            drop(conn);
            "cf-1".to_string()
        };

        // KeepLocal path resolves without applying.
        let outcome = conflicts
            .resolve(
                &conflict_id,
                Resolution::KeepLocal,
                "user-1",
                Some("keep ours"),
            )
            .unwrap();
        assert!(matches!(outcome, OpOutcome::Rejected { .. }));
        let row = conflicts.get(&conflict_id).unwrap();
        assert_eq!(row.status, ConflictStatus::Resolved);
        assert_eq!(row.resolved_by.as_deref(), Some("user-1"));

        // Double resolution refused.
        assert!(conflicts
            .resolve(&conflict_id, Resolution::KeepLocal, "user-1", None)
            .is_err());
    }
}
