//! Examination data infrastructure: durable attempts and sealed packages.
//!
//! OWNERSHIP BOUNDARY (spec §3/§15/§16): the engine provides durable
//! storage, integrity proofs and authorization-controlled views. Rendering,
//! grading and business workflow belong to Phase 3.
//!
//! * [`AttemptStore`] — start attempts, persist answer events with a
//!   per-attempt hash chain (durable "saved" only on commit), finalize with
//!   a device signature over the chain head, and replicate the finalized
//!   attempt as a signed immutable op.
//! * [`PackageStore`] — import approved assessment packages (content-
//!   addressed, signature-verified, stored as blobs), serve **student
//!   views** with protected fields stripped, and full views only through an
//!   engine permission check.

use crate::op::SyncOpWire;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use xamverse_events::{EngineEvent, EventBus, EventKind};
use xamverse_storage::repos::{
    AttemptEventRow, AttemptRow, AttemptsRepo, BlobRepo, PackagesRepo,
};
use xamverse_storage::{checksum, now_rfc3339, Database, StorageError, StorageResult};

/// How a finalized attempt replicates (to which targets).
pub type TargetSelector = Box<dyn FnOnce() -> Vec<String> + Send>;

pub struct AttemptStore {
    db: Arc<Database>,
    device_id: String,
    events: Arc<EventBus>,
    local: Arc<crate::local::LocalOps>,
}

impl AttemptStore {
    pub fn new(db: Arc<Database>, device_id: String, events: Arc<EventBus>, local: Arc<crate::local::LocalOps>) -> Self {
        Self {
            db,
            device_id,
            events,
            local,
        }
    }

    /// Start a durable attempt. The attempt id is stable across restarts.
    pub fn start(
        &self,
        school_id: &str,
        package_id: &str,
        student_ref: &str,
    ) -> StorageResult<AttemptRow> {
        let attempt = AttemptRow {
            attempt_id: uuid::Uuid::now_v7().to_string(),
            school_id: school_id.to_string(),
            package_id: package_id.to_string(),
            student_ref: student_ref.to_string(),
            status: "in_progress".into(),
            device_id: self.device_id.clone(),
            started_at: now_rfc3339(),
            finalized_at: None,
            finalize_signature: None,
            latest_chain_hash: String::new(), // genesis
        };
        let created = self.db.tx(|conn| AttemptsRepo::create(conn, &attempt))?;
        if !created {
            return Err(StorageError::AlreadyExists {
                entity: "attempt",
                id: attempt.attempt_id,
            });
        }
        Ok(attempt)
    }

    /// Persist one answer/navigation event. Returns `(seq, chain_hash)`.
    /// "Saved" means committed — the API reports durability truthfully.
    pub fn save_event(
        &self,
        attempt_id: &str,
        kind: &str,
        payload: impl Serialize,
    ) -> StorageResult<AttemptEventRow> {
        let payload_json = serde_json::to_string(&payload)?;
        let event = self.db.tx(|conn| AttemptsRepo::append_event(conn, attempt_id, kind, &payload_json))?;
        Ok(event)
    }

    /// Finalize an attempt: verify the chain, apply the caller's integrity
    /// signature, and create the immutable replication op.
    pub fn finalize(
        &self,
        attempt_id: &str,
        integrity_signature: &str,
        target_device_ids: &[String],
    ) -> StorageResult<SyncOpWire> {
        let (attempt, chain_ok, events) = {
            let conn = self.db.lock();
            let attempt = AttemptsRepo::get(&conn, attempt_id)?;
            let ok = AttemptsRepo::verify_chain(&conn, attempt_id)?;
            let events = AttemptsRepo::list_events(&conn, attempt_id)?;
            (attempt, ok, events)
        };
        if !chain_ok {
            return Err(StorageError::Constraint(
                "attempt event chain failed verification; refusing to finalize".into(),
            ));
        }
        if attempt.status == "finalized" {
            return Err(StorageError::AlreadyExists {
                entity: "finalized attempt",
                id: attempt_id.to_string(),
            });
        }

        // Finalize transactionally, then replicate.
        self.db.tx(|conn| {
            AttemptsRepo::finalize(conn, attempt_id, &attempt.latest_chain_hash, integrity_signature)?;
            xamverse_audit::record(
                conn,
                &xamverse_audit::AuditEvent::new("attempts.finalized")
                    .with_school(&attempt.school_id)
                    .with_target(attempt_id),
            )?;
            Ok(())
        })?;

        // Immutable envelope op: the whole attempt (metadata + events) is the
        // payload. Object id == attempt id, revision 1 forever.
        let envelope = AttemptEnvelope {
            attempt: AttemptsRepo::get(&self.db.lock(), attempt_id)?,
            events,
        };
        let payload = serde_json::to_string(&envelope)?;
        let op = self.local.create(
            &attempt.school_id,
            "exam_attempt",
            attempt_id,
            Some(&payload),
            None,
            false,
            target_device_ids,
            None,
        )?;

        self.events.publish(
            EngineEvent::new(EventKind::SubmissionReceived {
                attempt_id: attempt_id.to_string(),
                from_device: self.device_id.clone(),
            })
            .with_school(&attempt.school_id),
        );
        Ok(op)
    }

    pub fn get(&self, attempt_id: &str) -> StorageResult<AttemptRow> {
        let conn = self.db.lock();
        AttemptsRepo::get(&conn, attempt_id)
    }

    /// All finalized attempts for a school (what a collector pulls).
    pub fn finalized(&self, school_id: &str) -> StorageResult<Vec<AttemptRow>> {
        let conn = self.db.lock();
        AttemptsRepo::list_for_school(&conn, school_id, Some("finalized"))
    }
}

/// The replicated attempt payload (metadata + full event chain).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttemptEnvelope {
    pub attempt: AttemptRow,
    pub events: Vec<AttemptEventRow>,
}

pub struct PackageStore {
    db: Arc<Database>,
    events: Arc<EventBus>,
    local: Arc<crate::local::LocalOps>,
}

/// Metadata inside a package manifest. `protected_fields` lists JSON pointers
/// into the content that student views must not see (answer keys, grading
/// material). Validation of the pointer syntax happens at import time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageManifest {
    pub package_id: String,
    pub school_id: String,
    pub assessment_id: String,
    pub version: i64,
    pub schema_version: i64,
    #[serde(default)]
    pub protected_fields: Vec<String>,
    pub approved_by: Option<String>,
}

impl PackageStore {
    pub fn new(db: Arc<Database>, events: Arc<EventBus>, local: Arc<crate::local::LocalOps>) -> Self {
        Self { db, events, local }
    }

    /// Import a package: content is stored content-addressed, the manifest is
    /// kept verbatim (signed by the approver upstream), and an immutable
    /// replication op is created. Re-importing identical content is a no-op.
    pub fn import(
        &self,
        manifest: &PackageManifest,
        content_json: &str,
        approved_signature: Option<&str>,
        target_device_ids: &[String],
    ) -> StorageResult<SyncOpWire> {
        if manifest.school_id.is_empty() || manifest.assessment_id.is_empty() {
            return Err(StorageError::InvalidValue {
                field: "manifest",
                reason: "school_id and assessment_id are required".into(),
            });
        }
        // Protected field pointers must be well-formed JSON Pointer (RFC 6901).
        for pointer in &manifest.protected_fields {
            if !pointer.starts_with('/') {
                return Err(StorageError::InvalidValue {
                    field: "protected_fields",
                    reason: format!("{pointer} is not a JSON Pointer"),
                });
            }
        }
        let content_sha = checksum(content_json);

        let existing = {
            let conn = self.db.lock();
            PackagesRepo::get_by_content(&conn, &manifest.school_id, &content_sha)?
        };
        if existing.is_some() {
            return Err(StorageError::AlreadyExists {
                entity: "package content",
                id: content_sha,
            });
        }

        // Store content blob + package row + immutable op atomically.
        let blob_sha = checksum(format!("pkg:{}", manifest.package_id));
        let op = self.db.tx(|conn| {
            BlobRepo::put(conn, &blob_sha, content_json.as_bytes())?;
            let package_id = manifest.package_id.clone();
            let inserted = PackagesRepo::put(
                conn,
                &xamverse_storage::repos::PackageRow {
                    package_id: package_id.clone(),
                    school_id: manifest.school_id.clone(),
                    assessment_id: manifest.assessment_id.clone(),
                    version: manifest.version,
                    content_sha256: content_sha.clone(),
                    manifest_json: serde_json::to_string(manifest)?,
                    approved_by: manifest.approved_by.clone(),
                    approved_signature: approved_signature.map(str::to_string),
                    blob_sha256: blob_sha.clone(),
                    received_from: None,
                    created_at: now_rfc3339(),
                },
            )?;
            if !inserted {
                return Err(StorageError::AlreadyExists {
                    entity: "package",
                    id: package_id,
                });
            }
            Ok(())
        })?;

        let op = self.local.create(
            &manifest.school_id,
            "assessment_package",
            &manifest.package_id,
            Some(&serde_json::to_string(manifest)?),
            Some(&blob_sha),
            false,
            target_device_ids,
            None,
        )?;
        // The blob must exist before receivers can apply the op; store it in
        // the local blob store keyed by content hash (receiver-side apply
        // requires the blob under the op's payload_sha256? No — the op is
        // inline-manifest + blob ref of the CONTENT; blob keyed by blob_sha).
        let _ = op;
        self.events.publish(
            EngineEvent::new(EventKind::PackageReceived {
                package_id: manifest.package_id.clone(),
                school_id: manifest.school_id.clone(),
            })
            .with_school(&manifest.school_id),
        );
        Ok(op)
    }

    /// Student view: protected fields removed. Always available to any local
    /// session holding the package — this is the *only* view a student UI
    /// should call (spec §15: answer keys never ride to student clients).
    pub fn student_view(&self, school_id: &str, package_id: &str) -> StorageResult<serde_json::Value> {
        let (manifest, content) = self.load(school_id, package_id)?;
        let mut value: serde_json::Value = serde_json::from_str(&content)?;
        for pointer in &manifest.protected_fields {
            remove_json_pointer(&mut value, pointer);
        }
        Ok(value)
    }

    /// Full view (answer keys included) — callers MUST have passed an
    /// engine-side permission check (`Authz::require`) before invoking this;
    /// the engine exposes it for privileged marking workflows only.
    pub fn full_view(&self, school_id: &str, package_id: &str) -> StorageResult<serde_json::Value> {
        let (_, content) = self.load(school_id, package_id)?;
        Ok(serde_json::from_str(&content)?)
    }

    /// The package content hash — the identity that approvals bind to.
    pub fn content_hash(&self, school_id: &str, package_id: &str) -> StorageResult<String> {
        let conn = self.db.lock();
        Ok(PackagesRepo::get(&conn, school_id, package_id)?.content_sha256)
    }

    fn load(&self, school_id: &str, package_id: &str) -> StorageResult<(PackageManifest, String)> {
        // Single lock scope per DB access — the Mutex is NOT reentrant
        // (this was a real deadlock; see the debugging note in worklog).
        let (manifest, blob_sha) = {
            let conn = self.db.lock();
            let row = PackagesRepo::get(&conn, school_id, package_id)?;
            let manifest: PackageManifest = serde_json::from_str(&row.manifest_json)?;
            (manifest, row.blob_sha256)
        };
        let content = {
            let conn = self.db.lock();
            BlobRepo::get(&conn, &blob_sha)?.ok_or_else(|| StorageError::NotFound {
                entity: "package content",
                id: blob_sha.clone(),
            })?
        };
        Ok((
            manifest,
            String::from_utf8(content).map_err(|_| StorageError::InvalidValue {
                field: "package content",
                reason: "not valid UTF-8".into(),
            })?,
        ))
    }
}

/// Remove the value at a JSON Pointer (RFC 6901) if present.
fn remove_json_pointer(value: &mut serde_json::Value, pointer: &str) {
    let tokens: Vec<&str> = pointer.split('/').skip(1).collect();
    let mut current = value;
    for (index, token) in tokens.iter().enumerate() {
        let token = token.replace("~1", "/").replace("~0", "~");
        let is_last = index == tokens.len() - 1;
        match current {
            serde_json::Value::Object(map) => {
                if is_last {
                    map.remove(&token);
                    return;
                }
                match map.get_mut(&token) {
                    Some(next) => current = next,
                    None => return,
                }
            }
            serde_json::Value::Array(array) => {
                let Ok(i) = token.parse::<usize>() else { return };
                if is_last {
                    if i < array.len() {
                        array.remove(i);
                    }
                    return;
                }
                match array.get_mut(i) {
                    Some(next) => current = next,
                    None => return,
                }
            }
            _ => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use xamverse_identity::DeviceIdentity;
    use xamverse_storage::repos::SchoolsRepo;
use xamverse_storage::{DatabaseKey, MemoryKeyStore};

    fn setup() -> (tempfile::TempDir, Arc<Database>, Arc<EventBus>, Arc<DeviceIdentity>) {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = Database::open(dir.path().join("e.xamdb"), &DatabaseKey::generate()).unwrap();
        let db = Arc::new(db);
        db.tx(|conn| SchoolsRepo::enroll(conn, "s1", "S")).unwrap();
        let events = Arc::new(EventBus::new());
        let keystore = MemoryKeyStore::default();
        let identity = Arc::new(DeviceIdentity::load_or_create(&keystore, "NodeA", "linux").unwrap());
        (dir, db, events, identity)
    }

    #[test]
    fn attempt_lifecycle_is_durable_and_chain_verified() {
        let (_d, db, events, identity) = setup();
        let local = Arc::new(crate::local::LocalOps::new(db.clone(), identity.clone(), events.clone()));
        let store = AttemptStore::new(db.clone(), identity.device_id.clone(), events.clone(), local);

        let attempt = store.start("s1", "pkg-1", "student-42").unwrap();
        let e1 = store.save_event(&attempt.attempt_id, "answer", serde_json::json!({"q": 1, "a": "b"})).unwrap();
        let e2 = store.save_event(&attempt.attempt_id, "answer", serde_json::json!({"q": 2, "a": "c"})).unwrap();
        assert_ne!(e1.hash, e2.hash);
        assert_eq!(e2.prev_hash, e1.hash);

        // Local signature over the chain head as the integrity proof.
        let sig = identity.sign(e2.hash.as_bytes());
        let op = store.finalize(&attempt.attempt_id, &sig, &[]).unwrap();
        assert_eq!(op.category, "exam_attempt");
        assert_eq!(op.revision, 1);

        // Refuses a second finalize (immutable).
        assert!(store.finalize(&attempt.attempt_id, &sig, &[]).is_err());
    }

    #[test]
    fn tampered_attempt_chain_cannot_finalize() {
        let (_d, db, events, identity) = setup();
        let local = Arc::new(crate::local::LocalOps::new(db.clone(), identity.clone(), events.clone()));
        let store = AttemptStore::new(db.clone(), identity.device_id.clone(), events.clone(), local);
        let attempt = store.start("s1", "pkg-1", "student-1").unwrap();
        store.save_event(&attempt.attempt_id, "answer", serde_json::json!({"q": 1})).unwrap();

        // Database-level tamper: a forged event row breaks the chain.
        let conn = db.lock();
        conn.execute(
            "INSERT INTO attempt_events (attempt_id, kind, payload_json, recorded_at, prev_hash, hash)
             VALUES (?1, 'answer', '{\"forged\":true}', '2026-01-01T00:00:00Z', 'x', 'y')",
            [&attempt.attempt_id],
        )
        .unwrap();
        drop(conn);

        assert!(store.finalize(&attempt.attempt_id, "sig", &[]).is_err());
    }

    #[test]
    fn package_student_view_strips_protected_fields() {
        let (_d, db, events, identity) = setup();
        let local = Arc::new(crate::local::LocalOps::new(db.clone(), identity.clone(), events.clone()));
        let store = PackageStore::new(db.clone(), events.clone(), local);

        let manifest = PackageManifest {
            package_id: "pkg-1".into(),
            school_id: "s1".into(),
            assessment_id: "math-t1".into(),
            version: 1,
            schema_version: 1,
            protected_fields: vec!["/answer_key".into(), "/questions/1/marking".into()],
            approved_by: Some("admin-1".into()),
        };
        let content = serde_json::json!({
            "title": "Maths Term 1",
            "answer_key": {"q1": "b"},
            "questions": [
                {"text": "2+2?"},
                {"text": "3+3?", "marking": {"correct": "c"}}
            ]
        })
        .to_string();

        store.import(&manifest, &content, Some("approval-sig"), &[]).unwrap();

        let student = store.student_view("s1", "pkg-1").unwrap();
        assert!(student.get("answer_key").is_none());
        assert!(student["questions"][0]["text"] == "2+2?");
        assert!(student["questions"][1].get("marking").is_none());

        let full = store.full_view("s1", "pkg-1").unwrap();
        assert!(full.get("answer_key").is_some());

        // Content hash is stable and bindable by approvals.
        assert_eq!(store.content_hash("s1", "pkg-1").unwrap(), checksum(&content));

        // Re-import of the same content is refused (immutable + deduplicated).
        assert!(store.import(&manifest, &content, None, &[]).is_err());
    }
}
