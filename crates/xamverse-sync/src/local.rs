//! Creating local operations and advancing the Lamport clock.
//!
//! Every local change that must replicate goes through [`LocalOps::create`]:
//! it assigns the per-object revision (CAS against the materialized object),
//! stamps the Lamport clock, signs the op with the device identity, appends
//! it to the log and enqueues push jobs per the replication policy.
//! Wall-clock timestamps are deliberately NOT part of conflict decisions.

use crate::op::SyncOpWire;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use xamverse_events::{EngineEvent, EventBus, EventKind};
use xamverse_identity::DeviceIdentity;
use xamverse_storage::repos::{
    DevicesRepo, JobsRepo, KvRepo, ObjectRow, ObjectsRepo, OpRow, OpsRepo,
};
use xamverse_storage::{now_rfc3339, Database, StorageError, StorageResult};

/// kv key prefix for the per-school Lamport clock.
const LAMPORT_KEY_PREFIX: &str = "lamport.";

/// Inline payload cap: anything larger rides the blob protocol.
pub const MAX_INLINE_PAYLOAD: usize = 256 * 1024;

pub struct LocalOps {
    db: Arc<Database>,
    identity: Arc<DeviceIdentity>,
    events: Arc<EventBus>,
}

impl LocalOps {
    pub fn new(db: Arc<Database>, identity: Arc<DeviceIdentity>, events: Arc<EventBus>) -> Self {
        Self {
            db,
            identity,
            events,
        }
    }

    /// Current Lamport clock for a school (0 when unseen).
    pub fn lamport(&self, school_id: &str) -> StorageResult<i64> {
        let conn = self.db.lock();
        Ok(
            KvRepo::get(&conn, &format!("{LAMPORT_KEY_PREFIX}{school_id}"))?
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
        )
    }

    /// Create, sign, persist and enqueue a local change.
    ///
    /// `object_id` is the logical record id; revision is assigned here. When
    /// `base_revision` is `None` the caller declares "based on whatever the
    /// local replica holds now" — the honest default for local edits.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        school_id: &str,
        category: &str,
        object_id: &str,
        payload_json: Option<&str>,
        blob_sha256: Option<&str>,
        tombstone: bool,
        target_device_ids: &[String],
        expected_base_revision: Option<i64>,
    ) -> StorageResult<SyncOpWire> {
        let policy =
            crate::category::policy_for(category).ok_or_else(|| StorageError::InvalidValue {
                field: "category",
                reason: format!("unknown category {category}"),
            })?;

        if payload_json.is_none() && blob_sha256.is_none() {
            return Err(StorageError::InvalidValue {
                field: "payload",
                reason: "one of payload_json or blob_sha256 is required".into(),
            });
        }
        if let Some(payload) = payload_json {
            if payload.len() > MAX_INLINE_PAYLOAD {
                return Err(StorageError::InvalidValue {
                    field: "payload",
                    reason: format!(
                        "inline payload exceeds {} bytes; use a blob",
                        MAX_INLINE_PAYLOAD
                    ),
                });
            }
        }

        // The one-of guard above guarantees one of the two sources; make
        // that total here instead of unwrapping inside the transaction.
        let payload_sha256 = match (payload_json, blob_sha256) {
            (Some(payload), _) => {
                let mut hasher = Sha256::new();
                hasher.update(payload.as_bytes());
                hasher
                    .finalize()
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect()
            }
            (None, Some(sha)) => sha.to_string(),
            (None, None) => {
                return Err(StorageError::InvalidValue {
                    field: "payload",
                    reason: "one of payload_json or blob_sha256 is required".into(),
                })
            }
        };

        let op_id = uuid::Uuid::now_v7().to_string();

        // Single transaction: revision assignment, signing input, log insert
        // and outbox enqueue commit together — no half-created ops.
        let wire = self.db.tx(|conn| {
            let object = ObjectsRepo::get(conn, school_id, category, object_id)?;
            if policy.immutable && object.is_some() {
                return Err(StorageError::AlreadyExists {
                    entity: "immutable object",
                    id: format!("{category}/{object_id}"),
                });
            }
            let current = object.as_ref().map(|o| o.current_revision).unwrap_or(0);
            let base = expected_base_revision.unwrap_or(current);
            if base != current {
                return Err(StorageError::Constraint(format!(
                    "stale base revision: object is at {current}, op is based on {base}"
                )));
            }
            let revision = current + 1;
            let lamport = self.advance_lamport_local(conn, school_id)?;

            let unsigned = SyncOpWire {
                op_id: op_id.clone(),
                school_id: school_id.to_string(),
                category: category.to_string(),
                object_id: object_id.to_string(),
                revision,
                base_revision: base,
                author_device_id: self.identity.device_id.clone(),
                lamport,
                tombstone,
                schema_version: 1,
                payload_sha256,
                payload_json: payload_json.map(str::to_string),
                blob_sha256: blob_sha256.map(str::to_string),
                signature: String::new(),
            };
            let mut signed = unsigned;
            signed.signature = self.identity.signing.sign(&signed.signing_message());

            OpsRepo::insert(
                conn,
                &OpRow {
                    op_id: signed.op_id.clone(),
                    school_id: school_id.to_string(),
                    category: category.to_string(),
                    object_id: object_id.to_string(),
                    revision,
                    base_revision: base,
                    author_device_id: self.identity.device_id.clone(),
                    lamport,
                    tombstone,
                    schema_version: 1,
                    payload_sha256: signed.payload_sha256.clone(),
                    payload_json: signed.payload_json.clone(),
                    blob_sha256: signed.blob_sha256.clone(),
                    signature: signed.signature.clone(),
                    received_from: None,
                    received_at: now_rfc3339(),
                },
            )?;
            ObjectsRepo::apply_op_state(
                conn,
                &OpRow {
                    op_id: signed.op_id.clone(),
                    school_id: school_id.to_string(),
                    category: category.to_string(),
                    object_id: object_id.to_string(),
                    revision,
                    base_revision: base,
                    author_device_id: self.identity.device_id.clone(),
                    lamport,
                    tombstone,
                    schema_version: 1,
                    payload_sha256: signed.payload_sha256.clone(),
                    payload_json: signed.payload_json.clone(),
                    blob_sha256: signed.blob_sha256.clone(),
                    signature: signed.signature.clone(),
                    received_from: None,
                    received_at: now_rfc3339(),
                },
            )?;

            // Durable outbox: one push job per target (replication policy is
            // caller-controlled; "all trusted peers" is a core-level helper).
            let now = now_rfc3339();
            for target in target_device_ids {
                JobsRepo::insert(
                    conn,
                    &xamverse_storage::repos::JobRow {
                        job_id: uuid::Uuid::now_v7().to_string(),
                        school_id: school_id.to_string(),
                        target_device_id: target.clone(),
                        op_id: Some(signed.op_id.clone()),
                        kind: xamverse_storage::repos::JobKind::PushOp,
                        status: xamverse_storage::repos::JobStatus::Queued,
                        attempts: 0,
                        next_attempt_at: Some(now.clone()),
                        last_error: None,
                        created_at: now.clone(),
                        updated_at: now.clone(),
                    },
                )?;
            }
            Ok(signed)
        })?;

        self.events.publish(
            EngineEvent::new(EventKind::SyncRequested {
                job_id: op_id.clone(),
            })
            .with_school(school_id)
            .with_device(self.identity.device_id.clone()),
        );
        Ok(wire)
    }

    /// Local clock advance shares the transaction with the op insert.
    fn advance_lamport_local(
        &self,
        conn: &rusqlite::Connection,
        school_id: &str,
    ) -> StorageResult<i64> {
        let key = format!("{LAMPORT_KEY_PREFIX}{school_id}");
        let current: i64 = KvRepo::get(conn, &key)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let next = current + 1;
        KvRepo::set(conn, &key, &next.to_string())?;
        Ok(next)
    }

    /// Register the local device row (idempotent; called at engine start).
    pub fn ensure_local_device(&self) -> StorageResult<()> {
        let row = xamverse_storage::repos::DeviceRow {
            device_id: self.identity.device_id.clone(),
            school_id: None,
            name: self.identity.name.clone(),
            platform: self.identity.platform.clone(),
            signing_pk: self.identity.signing.public_b64(),
            transport_pk: self.identity.transport.public_b64(),
            fingerprint: self.identity.fingerprint(),
            is_local: true,
            last_seen_at: Some(now_rfc3339()),
        };
        let conn = self.db.lock();
        DevicesRepo::upsert(&conn, &row)
    }

    /// Materialized object read for higher layers (views, collection).
    pub fn object(
        &self,
        school_id: &str,
        category: &str,
        object_id: &str,
    ) -> StorageResult<Option<ObjectRow>> {
        let conn = self.db.lock();
        ObjectsRepo::get(&conn, school_id, category, object_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use xamverse_storage::repos::SchoolsRepo;
    use xamverse_storage::{DatabaseKey, MemoryKeyStore};

    fn setup() -> (
        tempfile::TempDir,
        Arc<Database>,
        Arc<DeviceIdentity>,
        Arc<EventBus>,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = Database::open(dir.path().join("s.xamdb"), &DatabaseKey::generate()).unwrap();
        let db = Arc::new(db);
        db.tx(|conn| SchoolsRepo::enroll(conn, "s1", "School One"))
            .unwrap();
        let keystore = MemoryKeyStore::default();
        let identity =
            Arc::new(DeviceIdentity::load_or_create(&keystore, "NodeA", "linux").unwrap());
        let events = Arc::new(EventBus::new());
        (dir, db, identity, events)
    }

    #[test]
    fn create_signs_and_versions_sequentially() {
        let (_d, db, identity, events) = setup();
        let local = LocalOps::new(db.clone(), identity.clone(), events);

        let op1 = local
            .create(
                "s1",
                "question_bank",
                "q1",
                Some(r#"{"v":1}"#),
                None,
                false,
                &[],
                None,
            )
            .unwrap();
        let op2 = local
            .create(
                "s1",
                "question_bank",
                "q1",
                Some(r#"{"v":2}"#),
                None,
                false,
                &[],
                None,
            )
            .unwrap();
        assert_eq!(op1.revision, 1);
        assert_eq!(op2.revision, 2);
        assert_eq!(op2.base_revision, 1);
        // Signature verifies against the author's public key.
        assert!(op2.verify_signature(&identity.signing.public_b64()));

        let obj = local.object("s1", "question_bank", "q1").unwrap().unwrap();
        assert_eq!(obj.current_revision, 2);
        assert_eq!(obj.current_op_id, op2.op_id);
    }

    #[test]
    fn stale_base_revision_is_refused() {
        let (_d, db, identity, events) = setup();
        let local = LocalOps::new(db.clone(), identity.clone(), events);
        local
            .create(
                "s1",
                "question_bank",
                "q2",
                Some(r#"{}"#),
                None,
                false,
                &[],
                None,
            )
            .unwrap();
        // Author claims base 0 while object is at revision 1.
        let err = local.create(
            "s1",
            "question_bank",
            "q2",
            Some(r#"{}"#),
            None,
            false,
            &[],
            Some(0),
        );
        assert!(matches!(err, Err(StorageError::Constraint(_))));
    }

    #[test]
    fn immutable_category_rejects_second_revision() {
        let (_d, db, identity, events) = setup();
        let local = LocalOps::new(db.clone(), identity.clone(), events);
        local
            .create(
                "s1",
                "exam_attempt",
                "att-1",
                Some(r#"{}"#),
                None,
                false,
                &[],
                None,
            )
            .unwrap();
        let err = local.create(
            "s1",
            "exam_attempt",
            "att-1",
            Some(r#"{}"#),
            None,
            false,
            &[],
            None,
        );
        assert!(matches!(err, Err(StorageError::AlreadyExists { .. })));
    }

    #[test]
    fn outbox_jobs_created_per_target() {
        let (_d, db, identity, events) = setup();
        let local = LocalOps::new(db.clone(), identity.clone(), events);
        let targets = vec!["dev-b".to_string(), "dev-c".to_string()];
        local
            .create(
                "s1",
                "school_settings",
                "cfg",
                Some(r#"{}"#),
                None,
                false,
                &targets,
                None,
            )
            .unwrap();
        let conn = db.lock();
        let jobs = JobsRepo::list(&conn, "s1", &[], 100).unwrap();
        assert_eq!(jobs.len(), 2);
        assert!(jobs
            .iter()
            .all(|j| j.kind == xamverse_storage::repos::JobKind::PushOp));
    }
}
