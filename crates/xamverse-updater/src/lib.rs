//! Verified update pipeline: signed manifests, offline import, staging,
//! LAN distribution and safety interlocks.
//!
//! Trust model: release manifests are Ed25519-signed by release keys whose
//! public halves are pinned in configuration (like licensing — private keys
//! never ship). Every receiving device re-verifies independently, which is
//! what makes USB sneakernet AND LAN relay distribution equally safe.
//!
//! Safety (spec §24): platform/arch gate, semver downgrade refusal, schema
//! compatibility window, content hash, exam-active interlock callback,
//! backup-before-apply hook, and full update history. Irreversible database
//! migrations are never auto-rolled-back — recovery is restore-from-backup.

// Tests read far better with unwrap/expect; the lint stays enforced
// for library code — this exemption is scoped to cfg(test) only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::Digest as _;
use std::path::PathBuf;
use std::sync::Arc;
use xamverse_events::{EngineEvent, EventBus, EventKind};
use xamverse_identity::verify_signature;
use xamverse_storage::repos::{BlobRepo, UpdateHistoryRepo, UpdateStateRow};
use xamverse_storage::{now_rfc3339, Database, StorageError, StorageResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseManifest {
    /// Semver of the release (downgrades refused).
    pub version: String,
    pub platform: String, // windows | macos | linux
    pub arch: String,     // x86_64 | aarch64
    /// Engine schema compatibility window.
    pub min_schema: i64,
    pub max_schema: i64,
    /// SHA-256 of the artifact this manifest covers.
    pub artifact_sha256: String,
    pub artifact_size: u64,
    pub notes: String,
    pub release_key_id: String,
    /// Ed25519 signature over the manifest sans this field.
    pub signature: String,
}

impl ReleaseManifest {
    // serde over a struct of borrowed fields cannot fail at runtime; the
    // only failure mode is OOM. Allowed explicitly, not silently.
    #[allow(clippy::expect_used)]
    pub fn signing_message(&self) -> Vec<u8> {
        serde_json::to_vec(&UnsignedView {
            version: &self.version,
            platform: &self.platform,
            arch: &self.arch,
            min_schema: self.min_schema,
            max_schema: self.max_schema,
            artifact_sha256: &self.artifact_sha256,
            artifact_size: self.artifact_size,
            notes: &self.notes,
            release_key_id: &self.release_key_id,
        })
        .expect("unsigned view is always serializable")
    }

    pub fn verify(&self, trusted_release_pks: &[String]) -> Result<(), UpdateError> {
        let ok = trusted_release_pks
            .iter()
            .any(|pk| verify_signature(pk, &self.signing_message(), &self.signature));
        if !ok {
            return Err(UpdateError::Invalid(
                "signature not from a trusted release key".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct UnsignedView<'a> {
    version: &'a str,
    platform: &'a str,
    arch: &'a str,
    min_schema: i64,
    max_schema: i64,
    artifact_sha256: &'a str,
    artifact_size: u64,
    notes: &'a str,
    release_key_id: &'a str,
}

#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    #[error("update rejected: {0}")]
    Invalid(String),
    #[error("update is for {found}, this device is {expected}")]
    PlatformMismatch { found: String, expected: String },
    #[error("downgrade refused: installed {installed}, offered {offered}")]
    DowngradeRefused { installed: String, offered: String },
    #[error("update requires schema between {min} and {max}, this engine is at {local}")]
    SchemaIncompatible { min: i64, max: i64, local: i64 },
    #[error("artifact hash mismatch: manifest {manifest}, computed {computed}")]
    HashMismatch { manifest: String, computed: String },
    #[error("apply blocked by safety interlock: {0}")]
    InterlockBlocked(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Configuration injected by the desktop shell / CLI.
#[derive(Debug, Clone)]
pub struct UpdateConfig {
    pub trusted_release_pks: Vec<String>,
    /// Version of the currently installed application.
    pub current_version: String,
    /// Directory where verified artifacts are staged for the shell to apply.
    pub staging_dir: PathBuf,
    pub platform: String,
    pub arch: String,
}

/// Application-provided safety hooks (examination interlock + backup-first).
#[derive(Clone)]
pub struct UpdateInterlocks {
    /// Phase 3 wires this to the exam-session state: an active exam blocks
    /// applying updates (spec §24 "Do not interrupt active examinations").
    pub pre_apply_check: Arc<dyn Fn() -> Result<(), String> + Send + Sync>,
    /// Backup-before-update hook (wired to xamverse-backup by core).
    pub pre_apply_backup: Arc<dyn Fn() -> Result<(), String> + Send + Sync>,
}

impl Default for UpdateInterlocks {
    fn default() -> Self {
        Self {
            pre_apply_check: Arc::new(|| Ok(())),
            pre_apply_backup: Arc::new(|| Ok(())),
        }
    }
}

pub struct UpdaterService {
    db: Arc<Database>,
    events: Arc<EventBus>,
    config: UpdateConfig,
    interlocks: UpdateInterlocks,
}

impl UpdaterService {
    pub fn new(db: Arc<Database>, events: Arc<EventBus>, config: UpdateConfig) -> Self {
        Self {
            db,
            events,
            config,
            interlocks: UpdateInterlocks::default(),
        }
    }

    pub fn with_interlocks(mut self, interlocks: UpdateInterlocks) -> Self {
        self.interlocks = interlocks;
        self
    }

    /// Current engine schema version (compatibility gate input).
    fn local_schema(&self) -> StorageResult<i64> {
        let conn = self.db.lock();
        conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_migrations",
            [],
            |r| r.get(0),
        )
        .map_err(StorageError::from)
    }

    /// Import + verify an update package (from USB or LAN — identical path).
    /// The artifact is stored content-addressed in the blob store so the
    /// device can later serve it to peers (LAN distribution, spec §24).
    pub fn import(&self, manifest_json: &str, artifact: &[u8]) -> Result<String, UpdateError> {
        let manifest: ReleaseManifest = serde_json::from_str(manifest_json)?;
        manifest.verify(&self.config.trusted_release_pks)?;

        // Platform / architecture gate.
        let expected = format!("{}/{}", self.config.platform, self.config.arch);
        let found = format!("{}/{}", manifest.platform, manifest.arch);
        if found != expected {
            return Err(UpdateError::PlatformMismatch { found, expected });
        }

        // Downgrade refusal (semver, not string compare).
        let current = Version::parse(&self.config.current_version)
            .map_err(|e| UpdateError::Invalid(format!("current version unparsable: {e}")))?;
        let offered = Version::parse(&manifest.version)
            .map_err(|e| UpdateError::Invalid(format!("offered version unparsable: {e}")))?;
        if offered <= current {
            return Err(UpdateError::DowngradeRefused {
                installed: current.to_string(),
                offered: offered.to_string(),
            });
        }

        // Schema compatibility window.
        let local = self.local_schema()?;
        if local < manifest.min_schema || local > manifest.max_schema {
            return Err(UpdateError::SchemaIncompatible {
                min: manifest.min_schema,
                max: manifest.max_schema,
                local,
            });
        }

        // Content integrity.
        let computed = sha256_hex(artifact);
        if computed != manifest.artifact_sha256 {
            return Err(UpdateError::HashMismatch {
                manifest: manifest.artifact_sha256.clone(),
                computed,
            });
        }
        if artifact.len() as u64 != manifest.artifact_size {
            return Err(UpdateError::Invalid(
                "artifact size differs from manifest".into(),
            ));
        }

        // Store + record. Import is idempotent on artifact hash.
        let artifact_sha = manifest.artifact_sha256.clone();
        self.db.tx(|conn| {
            BlobRepo::put(conn, &artifact_sha, artifact)?;
            UpdateHistoryRepo::insert(
                conn,
                &UpdateStateRow {
                    update_id: artifact_sha.clone(),
                    version: manifest.version.clone(),
                    platform: manifest.platform.clone(),
                    arch: manifest.arch.clone(),
                    state: "verified".into(),
                    manifest_json: Some(manifest_json.to_string()),
                    note: Some(manifest.notes.clone()),
                    at: now_rfc3339(),
                },
            )?;
            xamverse_audit::record(
                conn,
                &xamverse_audit::AuditEvent::new("updates.imported")
                    .with_target(&manifest.version)
                    .with_detail_json(serde_json::json!({ "sha256": artifact_sha }).to_string()),
            )?;
            Ok(())
        })?;
        self.events
            .publish(EngineEvent::new(EventKind::UpdateAvailable {
                version: manifest.version.clone(),
            }));
        Ok(artifact_sha)
    }

    /// Stage a verified update for the desktop shell to apply (backup first
    /// and exam interlock). The actual binary swap belongs to the Tauri
    /// updater; staging writes the artifact where the shell expects it.
    pub fn stage(&self, update_id: &str) -> Result<PathBuf, UpdateError> {
        // Interlocks FIRST — refuse before touching anything.
        (self.interlocks.pre_apply_check)().map_err(UpdateError::InterlockBlocked)?;
        (self.interlocks.pre_apply_backup)().map_err(UpdateError::InterlockBlocked)?;

        let artifact = {
            let conn = self.db.lock();
            BlobRepo::get(&conn, update_id)?.ok_or(StorageError::NotFound {
                entity: "update artifact",
                id: update_id.to_string(),
            })?
        };
        std::fs::create_dir_all(&self.config.staging_dir)?;
        let staged = self.config.staging_dir.join("xamverse-update.bin");
        std::fs::write(&staged, &artifact)?;
        // Re-verify what we just wrote (paranoia for exam integrity).
        let written = std::fs::read(&staged)?;
        if sha256_hex(&written) != update_id {
            let computed = sha256_hex(&written);
            return Err(UpdateError::HashMismatch {
                manifest: update_id.to_string(),
                computed,
            });
        }
        self.set_state(update_id, "staged", None)?;
        Ok(staged)
    }

    /// Mark an update applied (called by the shell after a successful swap).
    pub fn mark_applied(&self, update_id: &str) -> StorageResult<()> {
        self.set_state(update_id, "applied", None)?;
        let version = self.version_of(update_id)?.unwrap_or_default();
        self.events
            .publish(EngineEvent::new(EventKind::UpdateApplied { version }));
        Ok(())
    }

    /// Reject an update (kept in history for audit).
    pub fn mark_rejected(&self, update_id: &str, reason: &str) -> StorageResult<()> {
        self.set_state(update_id, "rejected", Some(reason))
    }

    pub fn history(&self, limit: i64) -> StorageResult<Vec<UpdateStateRow>> {
        let conn = self.db.lock();
        UpdateHistoryRepo::history(&conn, limit)
    }

    fn set_state(&self, update_id: &str, state: &str, note: Option<&str>) -> StorageResult<()> {
        let conn = self.db.lock();
        UpdateHistoryRepo::set_state(&conn, update_id, state, note)
    }

    fn version_of(&self, update_id: &str) -> StorageResult<Option<String>> {
        Ok(self
            .history(50)?
            .into_iter()
            .find(|row| row.update_id == update_id)
            .map(|row| row.version))
    }
}

fn sha256_hex(data: &[u8]) -> String {
    let digest = sha2::Sha256::digest(data);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer as _, SigningKey};
    use rand::RngCore as _;
    use xamverse_storage::DatabaseKey;

    struct TestReleaseKey {
        signing: SigningKey,
    }

    impl TestReleaseKey {
        fn new() -> Self {
            let mut seed = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut seed);
            Self {
                signing: SigningKey::from_bytes(&seed),
            }
        }
        fn pk(&self) -> String {
            data_encoding::BASE64.encode(self.signing.verifying_key().as_bytes())
        }
        fn sign_manifest(&self, mut manifest: ReleaseManifest) -> ReleaseManifest {
            manifest.signature = data_encoding::BASE64
                .encode(&self.signing.sign(&manifest.signing_message()).to_bytes());
            manifest
        }
    }

    fn service(pk: &str, dir: &tempfile::TempDir) -> (Arc<Database>, UpdaterService) {
        let (db, _) = Database::open(dir.path().join("u.xamdb"), &DatabaseKey::generate()).unwrap();
        let db = Arc::new(db);
        let config = UpdateConfig {
            trusted_release_pks: vec![pk.to_string()],
            current_version: "0.2.0".into(),
            staging_dir: dir.path().join("staging"),
            platform: "linux".into(),
            arch: "x86_64".into(),
        };
        (
            db.clone(),
            UpdaterService::new(db, Arc::new(EventBus::new()), config),
        )
    }

    fn manifest(key: &TestReleaseKey, artifact: &[u8], version: &str, platform: &str) -> String {
        let m = key.sign_manifest(ReleaseManifest {
            version: version.into(),
            platform: platform.into(),
            arch: "x86_64".into(),
            min_schema: 1,
            max_schema: 99,
            artifact_sha256: sha256_hex(artifact),
            artifact_size: artifact.len() as u64,
            notes: "test release".into(),
            release_key_id: "test".into(),
            signature: String::new(),
        });
        serde_json::to_string(&m).unwrap()
    }

    #[test]
    fn import_verify_stage_apply_flow() {
        let key = TestReleaseKey::new();
        let dir = tempfile::tempdir().unwrap();
        let (_db, updater) = service(&key.pk(), &dir);

        let artifact = b"XAMVERSE-UPDATE-PAYLOAD-0.3.0".to_vec();
        let update_id = updater
            .import(&manifest(&key, &artifact, "0.3.0", "linux"), &artifact)
            .unwrap();

        // Staging runs the (default no-op) interlocks and writes the file.
        let staged = updater.stage(&update_id).unwrap();
        assert_eq!(std::fs::read(&staged).unwrap(), artifact);

        updater.mark_applied(&update_id).unwrap();
        let history = updater.history(10).unwrap();
        assert!(history.iter().any(|row| row.state == "applied"));
    }

    #[test]
    fn tampered_artifact_is_refused() {
        let key = TestReleaseKey::new();
        let dir = tempfile::tempdir().unwrap();
        let (_db, updater) = service(&key.pk(), &dir);
        let artifact = b"payload".to_vec();
        let m = manifest(&key, &artifact, "0.3.0", "linux");
        let tampered: Vec<u8> = artifact.iter().chain(b"extra".iter()).copied().collect();
        assert!(matches!(
            updater.import(&m, &tampered),
            Err(UpdateError::HashMismatch { .. })
        ));
    }

    #[test]
    fn forged_manifest_is_refused() {
        let real = TestReleaseKey::new();
        let rogue = TestReleaseKey::new();
        let dir = tempfile::tempdir().unwrap();
        let (_db, updater) = service(&real.pk(), &dir);
        let artifact = b"payload".to_vec();
        let m = manifest(&rogue, &artifact, "0.3.0", "linux");
        assert!(updater.import(&m, &artifact).is_err());
    }

    #[test]
    fn downgrades_and_platform_mismatch_are_refused() {
        let key = TestReleaseKey::new();
        let dir = tempfile::tempdir().unwrap();
        let (_db, updater) = service(&key.pk(), &dir);
        let artifact = b"payload".to_vec();

        assert!(matches!(
            updater.import(&manifest(&key, &artifact, "0.1.0", "linux"), &artifact),
            Err(UpdateError::DowngradeRefused { .. })
        ));
        assert!(matches!(
            updater.import(&manifest(&key, &artifact, "0.3.0", "macos"), &artifact),
            Err(UpdateError::PlatformMismatch { .. })
        ));
    }

    #[test]
    fn exam_active_interlock_blocks_staging() {
        let key = TestReleaseKey::new();
        let dir = tempfile::tempdir().unwrap();
        let (_db, updater) = service(&key.pk(), &dir);
        let updater = updater.with_interlocks(UpdateInterlocks {
            pre_apply_check: Arc::new(|| Err("exam in progress".into())),
            pre_apply_backup: Arc::new(|| Ok(())),
        });

        let artifact = b"payload".to_vec();
        let update_id = updater
            .import(&manifest(&key, &artifact, "0.3.0", "linux"), &artifact)
            .unwrap();
        assert!(matches!(
            updater.stage(&update_id),
            Err(UpdateError::InterlockBlocked(_))
        ));
    }
}
