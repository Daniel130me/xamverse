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

pub mod config;
pub mod error;
pub mod status;

pub use config::EngineConfig;
pub use error::EngineError;
pub use status::EngineStatus;

use fs2::FileExt as _;
use std::sync::Arc;
use xamverse_backup::BackupService;
use xamverse_discovery::{Discovery, ManualPeers};
use xamverse_events::{EventBus, EngineEvent, EventKind};
use xamverse_identity::DeviceIdentity;
use xamverse_licensing::{LicenceConfig, LicenceService};
use xamverse_network::{PeerServer, TrustDecision};
use xamverse_security::{AuthConfig, AuthService, Authz};
use xamverse_storage::repos::TrustState;
use xamverse_storage::{Database, DatabaseKey, FileKeyStore, SecureKeyStore as _};
use xamverse_sync::{AttemptStore, ConflictService, PackageStore, SyncEngine};
use xamverse_updater::{UpdateConfig, UpdaterService};

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
        let keystore = FileKeyStore::new(&config.data_dir)?;
        let db_key_bytes = keystore.get_or_create(DB_KEY_NAME, 32)?;
        let db_key = DatabaseKey::from_hex(&xamverse_storage::keystore::bytes_to_hex(&db_key_bytes))?;
        let (db, migration_report) = Database::open(config.data_dir.join("engine.xamdb"), &db_key)?;
        let db = Arc::new(db);

        // Identity from the same keystore.
        let identity = Arc::new(DeviceIdentity::load_or_create(
            &keystore,
            &config.device_name,
            current_platform(),
        )?);

        let events = Arc::new(EventBus::new());
        let auth = Arc::new(AuthService::with_config(
            db.clone(),
            AuthConfig::default(),
        ));
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
                if let Ok(Some(trust)) =
                    xamverse_storage::repos::TrustRepo::get(&conn, &school.school_id, &peer.card.device_id)
                {
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
        *self.peer_addr.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(bound);

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

        self.events.publish(EngineEvent::new(EventKind::JobStatusChanged {
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
    pub fn enroll_school(&self, school_id: &str, name: &str, by_user: &str) -> Result<(), EngineError> {
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

    /// Peer diagnostics: connect to a node and time the round trip.
    pub async fn ping_peer(&self, addr: std::net::SocketAddr) -> Result<std::time::Duration, EngineError> {
        let started = std::time::Instant::now();
        let mut conn = xamverse_network::PeerClient::connect(
            addr,
            &self.identity,
            &self.sync.trust_policy(),
        )
        .await?;
        self.sync.record_peer_address(&conn.peer.card.device_id, addr);
        let reply = conn
            .request(xamverse_network::Envelope::new(
                "ping",
                serde_json::json!({ "sent_at": xamverse_storage::now_rfc3339() }),
            ))
            .await?;
        if reply.kind != "pong" {
            return Err(EngineError::PeerProtocol(format!("expected pong, got {}", reply.kind)));
        }
        conn.channel.goodbye().await;
        Ok(started.elapsed())
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
        engine.enroll_school("school-1", "Demo School", "owner-1").unwrap();
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
