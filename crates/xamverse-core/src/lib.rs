//! The XamVerse engine facade.
//!
//! One [`Engine`] per installation = one encrypted database, one device
//! identity, one peer listener, one durable sync queue. The Tauri shell and
//! the `xamverse-peer` CLI embed the SAME struct, which is what makes the
//! desktop app and headless nodes behaviorally identical.
//!
//! Lifecycle:
//! 1. [`Engine::init`] — acquire single-instance lock, open/create the
//!    keystore + database, load identity, run migrations, register the local
//!    device row, requeue interrupted sync jobs.
//! 2. [`Engine::start`] — start the peer server, the sync job runner and
//!    (optionally) mDNS discovery.
//! 3. [`Engine::stop`] — stop discovery, listener and runner; the database
//!    closes with the struct (WAL checkpoint on drop keeps files tidy).

// Tests read far better with unwrap/expect; the lint stays enforced
// for library code — this exemption is scoped to cfg(test) only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod config;
pub mod error;
pub mod status;

pub use config::EngineConfig;
pub use error::EngineError;
pub use status::EngineStatus;

use std::sync::Arc;
use xamverse_backup::BackupService;
use xamverse_discovery::{Discovery, ManualPeers};
use xamverse_events::{EngineEvent, EventBus, EventKind};
use xamverse_identity::DeviceIdentity;
use xamverse_licensing::{LicenceConfig, LicenceService};
use xamverse_network::{PeerServer, TrustDecision};
use xamverse_security::{AuthConfig, AuthService, Authz};
use xamverse_storage::repos::TrustState;
use xamverse_storage::{Database, DatabaseKey, FileKeyStore, SecureKeyStore};
use xamverse_sync::{AttemptStore, ConflictService, PackageStore, SyncEngine};
use xamverse_updater::{UpdateConfig, UpdaterService};

#[derive(Debug, Clone, serde::Serialize)]
pub struct PeerPing {
    pub rtt_ms: u64,
    pub device_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BootstrapIdentity {
    pub school_id: String,
    pub user_id: String,
    pub username: String,
}

/// Keystore entry names (one DB key per installation).
const DB_KEY_NAME: &str = "database_key";
const LOCK_FILE: &str = "engine.lock";

pub struct Engine {
    pub config: EngineConfig,
    pub db: Arc<Database>,
    pub identity: Arc<DeviceIdentity>,
    pub events: Arc<EventBus>,
    pub auth: Arc<AuthService>,
    pub authz: Arc<Authz>,
    pub sync: Arc<SyncEngine>,
    pub conflicts: Arc<ConflictService>,
    pub attempts: Arc<AttemptStore>,
    pub packages: Arc<PackageStore>,
    pub licences: Arc<LicenceService>,
    pub backups: Arc<BackupService>,
    pub updates: Arc<UpdaterService>,
    pub manual_peers: Arc<ManualPeers>,
    pub(crate) discovery: tokio::sync::Mutex<Option<Discovery>>,
    pub(crate) server: tokio::sync::Mutex<Option<PeerServer>>,
    pub(crate) peer_addr: std::sync::Mutex<Option<std::net::SocketAddr>>,
    pub(crate) runner: tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub(crate) _lock: std::fs::File,
}

impl Engine {
    /// Initialize (idempotent across restarts; single-instance enforced).
    pub fn init(config: EngineConfig) -> Result<Arc<Self>, EngineError> {
        let keystore = Arc::new(FileKeyStore::new(&config.data_dir)?);
        Self::init_with_keystore(config, keystore)
    }

    /// Initialize with a platform-provided secure keystore.
    ///
    /// Desktop hosts use this entry point to keep database and identity keys
    /// in Windows Credential Manager or macOS Keychain. Headless/Linux hosts
    /// intentionally retain [`Self::init`]'s permission-restricted file store.
    pub fn init_with_keystore(
        config: EngineConfig,
        keystore: Arc<dyn SecureKeyStore>,
    ) -> Result<Arc<Self>, EngineError> {
        std::fs::create_dir_all(&config.data_dir)?;

        // Single-instance protection via an exclusive lock held for the
        // engine's lifetime (fs2: flock on unix, LockFileEx on windows).
        let lock_path = config.data_dir.join(LOCK_FILE);
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&lock_path)?;
        fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| EngineError::AlreadyRunning {
            path: lock_path.display().to_string(),
        })?;

        // Keystore → database key → encrypted database.
        let db_key_bytes = keystore.get_or_create(DB_KEY_NAME, 32)?;
        let db_key =
            DatabaseKey::from_hex(&xamverse_storage::keystore::bytes_to_hex(&db_key_bytes))?;
        let (db, migration_report) = Database::open(config.data_dir.join("engine.xamdb"), &db_key)?;
        let db = Arc::new(db);

        // Identity from the same keystore.
        let identity = Arc::new(DeviceIdentity::load_or_create(
            keystore.as_ref(),
            &config.device_name,
            current_platform(),
        )?);

        let events = Arc::new(EventBus::new());
        let auth = Arc::new(AuthService::with_config(db.clone(), AuthConfig::default()));
        let authz = Arc::new(Authz::new(db.clone()));
        let sync = SyncEngine::new(db.clone(), identity.clone(), events.clone());
        let conflicts = Arc::new(ConflictService::new(db.clone(), events.clone()));
        let local = sync.local.clone();
        let attempts = Arc::new(AttemptStore::new(
            db.clone(),
            identity.device_id.clone(),
            events.clone(),
            local.clone(),
        ));
        let packages = Arc::new(PackageStore::new(db.clone(), events.clone(), local));
        let licences = Arc::new(LicenceService::new(
            db.clone(),
            identity.clone(),
            events.clone(),
            LicenceConfig {
                trusted_issuer_pks: config.trusted_issuer_pks.clone(),
            },
        ));
        let backups = Arc::new(BackupService::new(
            db.clone(),
            identity.device_id.clone(),
            events.clone(),
            config.data_dir.join("backups"),
        ));
        let updates = Arc::new(UpdaterService::new(
            db.clone(),
            events.clone(),
            UpdateConfig {
                trusted_release_pks: config.trusted_release_pks.clone(),
                current_version: config.app_version.clone(),
                staging_dir: config.data_dir.join("updates"),
                platform: current_platform().to_string(),
                arch: current_arch().to_string(),
            },
        ));
        let manual_peers = Arc::new(ManualPeers::new(db.clone()));

        // Register the local device + requeue jobs a crash left running.
        sync.local.ensure_local_device()?;
        let requeued = sync.apply.requeue_interrupted_jobs()?;
        if requeued > 0 {
            tracing::info!(requeued, "requeued interrupted sync jobs");
        }
        if !migration_report.applied.is_empty() {
            tracing::info!(applied = ?migration_report.applied, "migrations applied");
        }

        Ok(Arc::new(Self {
            config,
            db,
            identity,
            events,
            auth,
            authz,
            sync,
            conflicts,
            attempts,
            packages,
            licences,
            backups,
            updates,
            manual_peers,
            discovery: tokio::sync::Mutex::new(None),
            server: tokio::sync::Mutex::new(None),
            peer_addr: std::sync::Mutex::new(None),
            runner: tokio::sync::Mutex::new(None),
            _lock: lock,
        }))
    }

    /// Start background services. Safe to call once per process.
    pub async fn start(self: &Arc<Self>) -> Result<(), EngineError> {
        // Peer server with the trust policy from the pairing store.
        let engine = self.clone();
        let trust_policy: xamverse_network::TrustPolicy = Arc::new(move |peer| {
            // Same decision logic as SyncEngine::trust_policy, evaluated
            // through the shared database.
            let conn = engine.db.lock();
            let schools = xamverse_storage::repos::SchoolsRepo::list(&conn).unwrap_or_default();
            for school in schools {
                if let Ok(Some(trust)) = xamverse_storage::repos::TrustRepo::get(
                    &conn,
                    &school.school_id,
                    &peer.card.device_id,
                ) {
                    return match trust.state {
                        TrustState::Trusted => TrustDecision::Allow,
                        TrustState::Pending => TrustDecision::AllowLimited,
                        TrustState::Revoked | TrustState::Blocked => TrustDecision::Reject,
                    };
                }
            }
            TrustDecision::AllowLimited
        });
        let handler: Arc<dyn xamverse_network::PeerHandler> = self.sync.clone();
        let server = PeerServer::start(
            std::net::SocketAddr::from(([0, 0, 0, 0], self.config.peer_port)),
            self.identity.clone(),
            trust_policy,
            handler,
        )
        .await?;
        let bound = server.bind_addr;
        *self.server.lock().await = Some(server);
        *self
            .peer_addr
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(bound);

        // Durable job runner.
        let runner = self.sync.spawn_job_runner();
        *self.runner.lock().await = Some(runner);

        // Optional mDNS.
        if self.config.enable_mdns {
            let advertisement = xamverse_discovery::advertisement_for(
                &self.identity.device_id,
                &self.identity.name,
                &self.identity.fingerprint(),
                self.config.peer_port,
            );
            match Discovery::start(advertisement) {
                Ok(discovery) => *self.discovery.lock().await = Some(discovery),
                Err(err) => {
                    // Multicast blocked is an environment fact, not a failure:
                    // manual peers remain fully functional (spec §11).
                    tracing::warn!(%err, "mDNS unavailable; manual peers only");
                }
            }
        }

        self.events
            .publish(EngineEvent::new(EventKind::JobStatusChanged {
                job_id: "engine".into(),
                status: "started".into(),
            }));
        Ok(())
    }

    /// Graceful shutdown of background services.
    pub async fn stop(&self) {
        if let Some(discovery) = self.discovery.lock().await.take() {
            discovery.stop();
        }
        if let Some(runner) = self.runner.lock().await.take() {
            runner.abort();
        }
        if let Some(server) = self.server.lock().await.take() {
            server.stop().await;
        }
        tracing::info!("engine stopped");
    }

    /// Enroll this installation for a school (local act; replication of
    /// school identity/records happens through sync).
    pub fn enroll_school(
        &self,
        school_id: &str,
        name: &str,
        by_user: &str,
    ) -> Result<(), EngineError> {
        self.db.tx(|conn| {
            xamverse_storage::repos::SchoolsRepo::enroll(conn, school_id, name)?;
            xamverse_security::seed_builtin_roles(conn, school_id)?;
            xamverse_audit::record(
                conn,
                &xamverse_audit::AuditEvent::new("school.enrolled")
                    .with_school(school_id)
                    .with_actor(by_user, &self.identity.device_id)
                    .with_target(name),
            )?;
            Ok(())
        })?;
        Ok(())
    }

    /// Whether this installation still needs its one-time local bootstrap.
    pub fn bootstrap_required(&self) -> Result<bool, EngineError> {
        Ok(!xamverse_storage::repos::SchoolsRepo::has_any(
            &self.db.lock(),
        )?)
    }

    /// Atomically create the first school and owner credential.
    ///
    /// This is intentionally a local composition-root primitive and is never
    /// exposed by the LAN browser bridge. The transaction refuses to run once
    /// any school exists, preventing an unauthenticated second-owner path.
    pub fn bootstrap_installation(
        &self,
        school_name: &str,
        username: &str,
        display_name: &str,
        password: &str,
    ) -> Result<BootstrapIdentity, EngineError> {
        let school_name = validated_bootstrap_text("school name", school_name, 2, 120)?;
        let username = validated_bootstrap_text("username", username, 3, 80)?;
        if !username
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
        {
            return Err(xamverse_storage::StorageError::InvalidValue {
                field: "username",
                reason: "may contain only letters, numbers, dots, underscores, and hyphens".into(),
            }
            .into());
        }
        let display_name = validated_bootstrap_text("display name", display_name, 2, 120)?;
        if !(12..=1024).contains(&password.chars().count()) {
            return Err(xamverse_storage::StorageError::InvalidValue {
                field: "password",
                reason: "must contain between 12 and 1024 characters".into(),
            }
            .into());
        }
        let auth_hash = xamverse_security::hash_password(password)?;
        let school_id = format!("school-{}", uuid::Uuid::now_v7());
        let user_id = format!("user-{}", uuid::Uuid::now_v7());

        self.db.tx(|conn| {
            if xamverse_storage::repos::SchoolsRepo::has_any(conn)? {
                return Err(xamverse_storage::StorageError::InvalidValue {
                    field: "installation bootstrap",
                    reason: "an enrolled school already exists".into(),
                });
            }
            xamverse_storage::repos::SchoolsRepo::enroll(conn, &school_id, &school_name)?;
            xamverse_security::seed_builtin_roles(conn, &school_id)?;
            xamverse_storage::repos::UsersRepo::upsert(
                conn,
                &xamverse_storage::repos::UserRow {
                    user_id: user_id.clone(),
                    school_id: school_id.clone(),
                    username: username.clone(),
                    display_name,
                    status: "active".into(),
                    auth_hash: Some(auth_hash),
                    origin_device_id: Some(self.identity.device_id.clone()),
                    revision: 1,
                    updated_at: xamverse_storage::now_rfc3339(),
                },
            )?;
            let owner_role =
                xamverse_storage::repos::UsersRepo::find_role_by_name(conn, &school_id, "owner")?
                    .ok_or_else(|| xamverse_storage::StorageError::NotFound {
                    entity: "role",
                    id: "owner".into(),
                })?;
            xamverse_storage::repos::UsersRepo::grant_role(
                conn,
                &school_id,
                &user_id,
                &owner_role.role_id,
                Some(&user_id),
            )?;
            xamverse_audit::record(
                conn,
                &xamverse_audit::AuditEvent::new("school.bootstrapped")
                    .with_school(&school_id)
                    .with_actor(&user_id, &self.identity.device_id)
                    .with_target(&school_name),
            )?;
            Ok(())
        })?;

        Ok(BootstrapIdentity {
            school_id,
            user_id,
            username,
        })
    }

    /// Peer diagnostics: connect to a node and time the round trip.
    pub async fn ping_peer(
        &self,
        addr: std::net::SocketAddr,
    ) -> Result<std::time::Duration, EngineError> {
        let ping = self.probe_peer(addr).await?;
        Ok(std::time::Duration::from_millis(ping.rtt_ms))
    }

    /// Ping with the verified remote identity for desktop/API diagnostics.
    pub async fn probe_peer(&self, addr: std::net::SocketAddr) -> Result<PeerPing, EngineError> {
        let started = std::time::Instant::now();
        let mut conn =
            xamverse_network::PeerClient::connect(addr, &self.identity, &self.sync.trust_policy())
                .await?;
        let device_id = conn.peer.card.device_id.clone();
        self.sync.record_peer_address(&device_id, addr);
        let reply = conn
            .request(xamverse_network::Envelope::new(
                "ping",
                serde_json::json!({ "sent_at": xamverse_storage::now_rfc3339() }),
            ))
            .await?;
        if reply.kind != "pong" {
            return Err(EngineError::PeerProtocol(format!(
                "expected pong, got {}",
                reply.kind
            )));
        }
        conn.channel.goodbye().await;
        Ok(PeerPing {
            rtt_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            device_id,
        })
    }

    pub fn platform(&self) -> &'static str {
        current_platform()
    }

    /// The bound peer listener address (ephemeral-port aware). `None` before
    /// `start()` or after `stop()`.
    pub fn peer_addr(&self) -> Option<std::net::SocketAddr> {
        *self
            .peer_addr
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Snapshot peers discovered through mDNS. Returns an empty list when
    /// multicast discovery is disabled or unavailable; manual peers remain
    /// available through [`Self::manual_peers`].
    pub async fn discovered_peers(&self) -> Vec<xamverse_discovery::PeerAdvertisement> {
        self.discovery
            .lock()
            .await
            .as_ref()
            .map(xamverse_discovery::Discovery::known)
            .unwrap_or_default()
    }

    /// Pull replicated objects from a known peer through the engine's
    /// per-peer connection limiter and verified Noise channel.
    pub async fn pull_from_peer(
        &self,
        peer_device_id: &str,
        school_id: &str,
        categories: Vec<String>,
    ) -> Result<xamverse_sync::PullSummary, EngineError> {
        let school_id = school_id.to_string();
        let sync = self.sync.clone();
        let summary = self
            .sync
            .with_peer_connection(peer_device_id, None, move |mut connection| {
                Box::pin(async move {
                    let summary = sync
                        .pull_from(&mut connection, &school_id, &categories)
                        .await?;
                    connection.channel.goodbye().await;
                    Ok(summary)
                })
            })
            .await?;
        Ok(summary)
    }
}

fn validated_bootstrap_text(
    field: &'static str,
    value: &str,
    min_len: usize,
    max_len: usize,
) -> Result<String, EngineError> {
    let value = value.trim();
    if !(min_len..=max_len).contains(&value.chars().count()) {
        return Err(xamverse_storage::StorageError::InvalidValue {
            field,
            reason: format!("must contain between {min_len} and {max_len} characters"),
        }
        .into());
    }
    if value.chars().any(char::is_control) {
        return Err(xamverse_storage::StorageError::InvalidValue {
            field,
            reason: "must not contain control characters".into(),
        }
        .into());
    }
    Ok(value.to_string())
}

impl Drop for Engine {
    fn drop(&mut self) {
        // Keep files tidy (checkpoint WAL) — best effort at shutdown.
        let conn = self.db.lock();
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_creates_database_identity_and_locks() {
        let dir = tempfile::tempdir().unwrap();
        let config = EngineConfig {
            data_dir: dir.path().join("data"),
            device_name: "Lab PC 01".into(),
            enable_mdns: false,
            ..Default::default()
        };
        let engine = Engine::init(config).unwrap();
        assert!(engine.config.data_dir.join("engine.xamdb").exists());
        assert!(!engine.identity.device_id.is_empty());
        assert!(engine.identity.fingerprint().starts_with("XV-"));

        let status = engine.status().unwrap();
        assert_eq!(status.integrity, "ok");
        assert_eq!(status.licence_status, "unactivated");

        // Second engine on the same data dir is refused (single instance).
        let again = Engine::init(EngineConfig {
            data_dir: dir.path().join("data"),
            device_name: "dup".into(),
            enable_mdns: false,
            ..Default::default()
        });
        assert!(matches!(again, Err(EngineError::AlreadyRunning { .. })));
    }

    #[test]
    fn injected_keystore_is_the_engine_identity_source() {
        let dir = tempfile::tempdir().unwrap();
        let keystore = Arc::new(xamverse_storage::MemoryKeyStore::default());
        let expected_id = DeviceIdentity::load_or_create(keystore.as_ref(), "expected", "test")
            .unwrap()
            .device_id;
        let engine = Engine::init_with_keystore(
            EngineConfig {
                data_dir: dir.path().join("data"),
                device_name: "Desktop".into(),
                enable_mdns: false,
                ..Default::default()
            },
            keystore,
        )
        .unwrap();

        assert_eq!(engine.identity.device_id, expected_id);
    }

    #[test]
    fn bootstrap_creates_one_owner_and_cannot_run_twice() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::init(EngineConfig {
            data_dir: dir.path().join("data"),
            enable_mdns: false,
            ..Default::default()
        })
        .unwrap();

        assert!(engine.bootstrap_required().unwrap());
        assert!(engine
            .bootstrap_installation("North School", "principal", "Ada Owner", "too-short")
            .is_err());
        assert!(engine.bootstrap_required().unwrap());
        let owner = engine
            .bootstrap_installation("North School", "principal", "Ada Owner", "strong-pass-1")
            .unwrap();
        assert!(!engine.bootstrap_required().unwrap());
        let (_, session) = engine
            .auth
            .login(
                &owner.school_id,
                &owner.username,
                "strong-pass-1",
                xamverse_security::SessionKind::Desktop,
                None,
                Some(&engine.identity.device_id),
            )
            .unwrap();
        assert!(session
            .permissions
            .contains(&xamverse_security::reserved::USERS_MANAGE.into()));
        assert!(engine
            .bootstrap_installation("Second", "other", "Other Owner", "strong-pass-2")
            .is_err());
    }

    #[tokio::test]
    async fn start_stop_lifecycle_runs_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::init(EngineConfig {
            data_dir: dir.path().join("data"),
            device_name: "Lab PC 02".into(),
            enable_mdns: false, // CI has no multicast
            peer_port: 0,       // OS-assigned in tests
            ..Default::default()
        })
        .unwrap();
        engine.start().await.unwrap();
        let status = engine.status().unwrap();
        assert_eq!(status.schema_version, 1);
        engine.stop().await;
    }

    #[test]
    fn enroll_school_seeds_roles_and_audits() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::init(EngineConfig {
            data_dir: dir.path().join("data"),
            device_name: "Lab PC 03".into(),
            enable_mdns: false,
            ..Default::default()
        })
        .unwrap();
        engine
            .enroll_school("school-1", "Demo School", "owner-1")
            .unwrap();
        let conn = engine.db.lock();
        let roles = xamverse_storage::repos::SchoolsRepo::list(&conn).unwrap();
        assert_eq!(roles.len(), 1);
        let audit = xamverse_audit::query(
            &conn,
            &xamverse_audit::AuditQuery {
                action_prefix: Some("school.".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(audit.len(), 1);
    }
}
