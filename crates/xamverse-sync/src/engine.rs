//! The sync engine: peer message handler, job runner, pairing and pull/push.
//!
//! There is no master node here: every engine runs the same handler, so any
//! peer may push to us, and we may pull or push to any peer. Transfer
//! success is always defined by *applied receipts*, never bytes sent.

use crate::apply::ApplyPipeline;
use crate::local::LocalOps;
use crate::messages::*;
use crate::SyncError;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use xamverse_events::{EngineEvent, EventBus, EventKind};
use xamverse_identity::DeviceIdentity;
use xamverse_network::{PeerClient, PeerConnection, TrustDecision, TrustPolicy};
use xamverse_storage::repos::{DevicesRepo, TrustRepo, TrustState};
use xamverse_storage::{now_rfc3339, Database, StorageResult};

/// How often the job runner scans the durable outbox.
pub(crate) const JOB_POLL_INTERVAL: Duration = Duration::from_millis(500);
/// Retry backoff: 2s, 4s, 8s ... capped at 5 minutes (with jitter).
pub(crate) const RETRY_BASE: Duration = Duration::from_secs(2);
pub(crate) const RETRY_CAP: Duration = Duration::from_secs(300);
pub(crate) const MAX_RETRIES: i64 = 8;
/// Manifest page size: keeps every envelope well under the frame cap.
pub(crate) const MANIFEST_PAGE: i64 = 500;
/// Guard for blob negotiation rounds per job.
pub(crate) const MAX_BLOB_ROUNDS: usize = 16;

pub struct SyncEngine {
    pub db: Arc<Database>,
    pub identity: Arc<DeviceIdentity>,
    pub events: Arc<EventBus>,
    pub local: Arc<LocalOps>,
    pub apply: Arc<ApplyPipeline>,
    /// Serializes outbound connections to one target (bounded concurrency;
    /// a 100-node lab must not open 100 simultaneous sockets per node).
    /// A std Mutex is correct here: the lock guards only a tiny map access
    /// and is never held across an await point.
    target_locks: std::sync::Mutex<HashMap<String, Arc<tokio::sync::Semaphore>>>,
}

impl SyncEngine {
    pub fn new(
        db: Arc<Database>,
        identity: Arc<DeviceIdentity>,
        events: Arc<EventBus>,
    ) -> Arc<Self> {
        let local = Arc::new(LocalOps::new(db.clone(), identity.clone(), events.clone()));
        let apply = Arc::new(ApplyPipeline::new(db.clone(), events.clone()));
        Arc::new(Self {
            db,
            identity,
            events,
            local,
            apply,
            target_locks: std::sync::Mutex::new(HashMap::new()),
        })
    }

    // -- trust policy -------------------------------------------------------

    /// The trust policy installed in the network layer: trusted → full
    /// access; pending → pairing-limited; anything else → reject.
    pub fn trust_policy(&self) -> TrustPolicy {
        let db = self.db.clone();
        Arc::new(move |peer: &xamverse_network::AuthenticatedPeer| {
            let conn = db.lock();
            // Which school is this device paired for? A device may be known
            // for multiple schools; any trusted school grants full transport
            // access — per-school authorization still applies per op.
            let schools = xamverse_storage::repos::SchoolsRepo::list(&conn).unwrap_or_default();
            for school in schools {
                if let Ok(Some(trust)) =
                    TrustRepo::get(&conn, &school.school_id, &peer.card.device_id)
                {
                    match trust.state {
                        TrustState::Trusted => return TrustDecision::Allow,
                        TrustState::Pending => return TrustDecision::AllowLimited,
                        TrustState::Revoked | TrustState::Blocked => return TrustDecision::Reject,
                    }
                }
            }
            // Unknown device: allowed ONLY as limited (pairing handshake);
            // the message handler restricts unknown peers to pairing/ping.
            TrustDecision::AllowLimited
        })
    }

    // -- peer address directory ---------------------------------------------

    pub fn record_peer_address(&self, device_id: &str, addr: std::net::SocketAddr) {
        let conn = self.db.lock();
        let _ = xamverse_storage::repos::KvRepo::set(
            &conn,
            &format!("peer.addr.{device_id}"),
            &addr.to_string(),
        );
    }

    pub fn lookup_peer_address(&self, device_id: &str) -> Option<std::net::SocketAddr> {
        let conn = self.db.lock();
        xamverse_storage::repos::KvRepo::get(&conn, &format!("peer.addr.{device_id}"))
            .ok()
            .flatten()
            .and_then(|raw| raw.parse().ok())
    }

    // -- pairing -------------------------------------------------------------

    /// Initiate pairing with a remote node. The remote records us as
    /// `pending`; an authorized user there must approve (and vice versa on
    /// our side via [`approve_pairing`]). IP knowledge alone grants nothing.
    pub async fn request_pairing(
        &self,
        addr: std::net::SocketAddr,
        school_id: &str,
        school_name: &str,
    ) -> Result<PairPending, SyncError> {
        let mut conn = PeerClient::connect(addr, &self.identity, &self.trust_policy()).await?;
        self.record_peer_address(&conn.peer.card.device_id, addr);

        let request = PairRequest {
            school_id: school_id.to_string(),
            school_name: school_name.to_string(),
            requester_device_id: self.identity.device_id.clone(),
            requester_name: self.identity.name.clone(),
            requester_fingerprint: self.identity.fingerprint(),
        };
        // request_typed (not a raw conn.request) so a structured error reply
        // from the responder surfaces as SyncError::PeerError instead of a
        // misleading JSON "missing field" parse failure.
        let pending: PairPending = self
            .request_typed(&mut conn, "pair_request", &request)
            .await?;
        // Remember the responder as pending on our side too.
        self.register_remote_device(&conn.peer.card)?;
        let db = self.db.clone();
        let device_id = pending.responder_device_id.clone();
        let school = school_id.to_string();
        db.tx(|c| {
            TrustRepo::set(
                c,
                &school,
                &device_id,
                TrustState::Pending,
                None,
                Some("pair requested"),
            )
        })?;
        self.events.publish(
            EngineEvent::new(EventKind::DevicePaired {
                device_id: conn.peer.card.device_id.clone(),
                school_id: school_id.to_string(),
            })
            .with_school(school_id),
        );
        conn.channel.goodbye().await;
        Ok(pending)
    }

    /// Approve a pending pairing (engine-enforced; UI only calls this).
    pub fn approve_pairing(
        &self,
        school_id: &str,
        device_id: &str,
        approved_by: &str,
    ) -> StorageResult<()> {
        self.db.tx(|conn| {
            TrustRepo::set(
                conn,
                school_id,
                device_id,
                TrustState::Trusted,
                Some(approved_by),
                None,
            )?;
            xamverse_audit::record(
                conn,
                &xamverse_audit::AuditEvent::new("devices.paired")
                    .with_school(school_id)
                    .with_actor(approved_by, &self.identity.device_id)
                    .with_target(device_id),
            )?;
            Ok(())
        })?;
        self.events.publish(
            EngineEvent::new(EventKind::DevicePaired {
                device_id: device_id.to_string(),
                school_id: school_id.to_string(),
            })
            .with_school(school_id)
            .with_device(device_id),
        );
        Ok(())
    }

    /// Revoke trust; the device loses restricted and sync access everywhere
    /// this decision has replicated to.
    pub fn revoke_device(
        &self,
        school_id: &str,
        device_id: &str,
        revoked_by: &str,
        reason: &str,
    ) -> StorageResult<()> {
        self.db.tx(|conn| {
            TrustRepo::set(
                conn,
                school_id,
                device_id,
                TrustState::Revoked,
                Some(revoked_by),
                Some(reason),
            )?;
            xamverse_audit::record(
                conn,
                &xamverse_audit::AuditEvent::new("devices.revoked")
                    .with_school(school_id)
                    .with_actor(revoked_by, &self.identity.device_id)
                    .with_target(device_id),
            )?;
            Ok(())
        })?;
        self.events.publish(
            EngineEvent::new(EventKind::DeviceRevoked {
                device_id: device_id.to_string(),
                school_id: school_id.to_string(),
            })
            .with_school(school_id)
            .with_device(device_id),
        );
        Ok(())
    }

    /// Store a remote device row from its verified card (idempotent).
    pub fn register_remote_device(
        &self,
        card: &xamverse_identity::DeviceCard,
    ) -> StorageResult<()> {
        let row = xamverse_storage::repos::DeviceRow {
            device_id: card.device_id.clone(),
            school_id: None,
            name: card.name.clone(),
            platform: card.platform.clone(),
            signing_pk: card.signing_pk.clone(),
            transport_pk: card.transport_pk.clone(),
            fingerprint: {
                // Recompute so a forged card cannot poison the fingerprint.
                xamverse_identity::DeviceIdentity::fingerprint_of(
                    &card.signing_pk,
                    &card.transport_pk,
                )
            },
            is_local: false,
            last_seen_at: Some(now_rfc3339()),
        };
        let conn = self.db.lock();
        DevicesRepo::upsert(&conn, &row)
    }

    // -- connection helpers ---------------------------------------------------

    fn semaphore_for(&self, device_id: &str) -> Arc<tokio::sync::Semaphore> {
        let mut locks = self
            .target_locks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        locks
            .entry(device_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Semaphore::new(1)))
            .clone()
    }

    /// Connect and run `f` with the connection (consumed; `f` is responsible
    /// for the goodbye). Limits concurrency to one connection per target.
    pub async fn with_peer_connection<T>(
        &self,
        device_id: &str,
        addr_override: Option<std::net::SocketAddr>,
        f: impl FnOnce(
            PeerConnection,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<T, SyncError>> + Send>,
        >,
    ) -> Result<T, SyncError> {
        let semaphore = self.semaphore_for(device_id);
        let permit = semaphore.acquire().await;
        let addr = addr_override
            .or_else(|| self.lookup_peer_address(device_id))
            .ok_or_else(|| SyncError::NoAddress(device_id.to_string()))?;
        let conn = PeerClient::connect(addr, &self.identity, &self.trust_policy()).await?;
        self.record_peer_address(&conn.peer.card.device_id, addr);
        // Learn the remote's device row from its verified card.
        self.register_remote_device(&conn.peer.card)?;
        drop(permit);
        f(conn).await
    }
}
