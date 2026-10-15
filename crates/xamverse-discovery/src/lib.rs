//! LAN peer discovery.
//!
//! WHY THIS EXISTS
//! ---------------
//! Schools must be able to find peers without a directory service, but many
//! school Wi-Fi APs block multicast. The design therefore treats mDNS as an
//! *optimization* and manual IP entries as a first-class, persisted source
//! (spec §11). Both feed the same [`PeerAdvertisement`] stream that the core
//! engine turns into connectable peer records.
//!
//! mDNS details: service type `_xamverse._tcp.local.`, TXT properties carry
//! the device identity so a resolved service is actionable without an extra
//! round trip. Duplicate advertisements for one device id are deduplicated.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

/// mDNS service type advertised and browsed by every node.
pub const SERVICE_TYPE: &str = "_xamverse._tcp.local.";

/// A discovered (or manually registered) peer advertisement.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PeerAdvertisement {
    pub device_id: String,
    pub name: String,
    pub fingerprint: String,
    pub protocol_major: u32,
    /// Peer TCP port (the engine API, not the browser bridge).
    pub port: u16,
    /// Advertised addresses (IPv4/IPv6). May be empty for manual entries
    /// that only specify one address.
    pub addresses: Vec<IpAddr>,
}

impl PeerAdvertisement {
    pub fn connect_addrs(&self) -> Vec<std::net::SocketAddr> {
        self.addresses
            .iter()
            .map(|ip| std::net::SocketAddr::new(*ip, self.port))
            .collect()
    }

    /// Rebuild from mDNS TXT properties (defensive: all fields required).
    pub fn from_txt(
        txt: &HashMap<String, String>,
        port: u16,
        addresses: Vec<IpAddr>,
    ) -> Option<Self> {
        let device_id = txt.get("di")?.clone();
        let name = txt.get("nm").cloned().unwrap_or_default();
        let fingerprint = txt.get("fp")?.clone();
        let protocol_major: u32 = txt.get("pv").and_then(|v| v.parse().ok()).unwrap_or(1);
        Some(Self {
            device_id,
            name,
            fingerprint,
            protocol_major,
            port,
            addresses,
        })
    }

    pub fn to_txt(&self) -> HashMap<String, String> {
        HashMap::from([
            ("di".to_string(), self.device_id.clone()),
            ("nm".to_string(), self.name.clone()),
            ("fp".to_string(), self.fingerprint.clone()),
            ("pv".to_string(), self.protocol_major.to_string()),
        ])
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DiscoveryError {
    #[error("mDNS daemon failed: {0}")]
    Mdns(String),
    #[error(transparent)]
    Storage(#[from] xamverse_storage::StorageError),
    #[error("invalid peer address: {0}")]
    InvalidAddress(String),
}

/// Live discovery state: what we advertise and what we have seen.
pub struct Discovery {
    my_advertisement: PeerAdvertisement,
    daemon: Option<mdns_sd::ServiceDaemon>,
    seen: Arc<Mutex<HashMap<String, PeerAdvertisement>>>,
    found_tx: broadcast::Sender<PeerAdvertisement>,
    browse_guard: Mutex<Option<mdns_sd::Receiver<mdns_sd::ServiceEvent>>>,
}

impl Discovery {
    /// Start mDNS advertisement + browsing. Multicast is optional at runtime:
    /// when the network blocks it (common on school Wi-Fi), callers use
    /// [`Discovery::without_multicast`] plus manual peers instead.
    pub fn start(advertise: PeerAdvertisement) -> Result<Self, DiscoveryError> {
        let daemon = mdns_sd::ServiceDaemon::new()
            .map_err(|e| DiscoveryError::Mdns(e.to_string()))?;

        let instance = format!("{}.{}", advertise.device_id, SERVICE_TYPE);
        let host = format!("xamverse-{}.local.", &advertise.device_id[..8.min(advertise.device_id.len())]);
        // Advertise on the first detectable local address; multi-NIC schools
        // can add manual peers — a documented limitation (KNOWN_LIMITATIONS.md).
        let primary_ip = advertise
            .addresses
            .first()
            .copied()
            .unwrap_or(IpAddr::from([0, 0, 0, 0]));
        let service = mdns_sd::ServiceInfo::new(
            SERVICE_TYPE,
            &instance,
            &host,
            primary_ip,
            advertise.port,
            Some(advertise.to_txt()),
        )
        .map_err(|e| DiscoveryError::Mdns(e.to_string()))?
        .enable_addr_auto();
        daemon
            .register(service)
            .map_err(|e| DiscoveryError::Mdns(e.to_string()))?;

        let (found_tx, _) = broadcast::channel(256);
        let seen: Arc<Mutex<HashMap<String, PeerAdvertisement>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Browse in a dedicated thread: mdns-sd delivers on a std channel.
        let receiver = daemon
            .browse(SERVICE_TYPE)
            .map_err(|e| DiscoveryError::Mdns(e.to_string()))?;
        let seen_for_thread = seen.clone();
        let tx_for_thread = found_tx.clone();
        std::thread::Builder::new()
            .name("xamverse-mdns-browse".into())
            .spawn(move || {
                while let Ok(event) = receiver.recv() {
                    if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
                        let props: HashMap<String, String> = info
                            .get_properties()
                            .iter()
                            .map(|kv| (kv.key().to_string(), kv.val_str().to_string()))
                            .collect();
                        let addresses: Vec<IpAddr> = info.get_addresses().iter().copied().collect();
                        if let Some(ad) = PeerAdvertisement::from_txt(&props, info.get_port(), addresses) {
                            let is_new = seen_for_thread
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner)
                                .insert(ad.device_id.clone(), ad.clone())
                                .is_none();
                            if is_new {
                                // Broadcast errors only mean no subscribers.
                                let _ = tx_for_thread.send(ad);
                            }
                        }
                    }
                }
            })
            .expect("browse thread spawns");

        Ok(Self {
            my_advertisement: advertise,
            daemon: Some(daemon),
            seen,
            found_tx,
            browse_guard: Mutex::new(None),
        })
    }

    /// No-multicast mode for restricted networks and CI environments.
    pub fn without_multicast(advertise: PeerAdvertisement) -> Self {
        let (found_tx, _) = broadcast::channel(256);
        Self {
            my_advertisement: advertise,
            daemon: None,
            seen: Arc::new(Mutex::new(HashMap::new())),
            found_tx,
            browse_guard: Mutex::new(None),
        }
    }

    pub fn my_advertisement(&self) -> &PeerAdvertisement {
        &self.my_advertisement
    }

    /// Subscribe to newly discovered peers.
    pub fn subscribe(&self) -> broadcast::Receiver<PeerAdvertisement> {
        self.found_tx.subscribe()
    }

    /// Snapshot of every peer seen this session (deduplicated by device id).
    pub fn known(&self) -> Vec<PeerAdvertisement> {
        self.seen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .cloned()
            .collect()
    }

    /// Shut down mDNS advertisement/browsing.
    pub fn stop(&self) {
        if let Some(daemon) = &self.daemon {
            let _ = daemon.stop_browse(SERVICE_TYPE);
            let _ = daemon.unregister(format!(
                "{}.{}",
                self.my_advertisement.device_id, SERVICE_TYPE
            ).as_str());
        }
    }

    /// Best-effort local address detection for advertisement. Falls back to
    /// loopback when no route exists (headless offline machines).
    pub fn detect_local_addresses() -> Vec<IpAddr> {
        // The connect trick does not send packets; it makes the OS pick the
        // outbound interface for a default route. Fully offline nodes fall
        // back to loopback and rely on manual peers.
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if socket.connect("8.8.8.8:80").is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    return vec![addr.ip()];
                }
            }
        }
        vec![IpAddr::from([127, 0, 0, 1])]
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Persisted manual peer addresses (kv-backed). First-class per spec §11:
/// "Manual connection must remain fully supported because some school
/// networks block multicast discovery."
pub struct ManualPeers {
    db: Arc<xamverse_storage::Database>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct ManualEntry {
    key: String,
    addr: String,
}

const KV_KEY: &str = "discovery.manual_peers";

impl ManualPeers {
    pub fn new(db: Arc<xamverse_storage::Database>) -> Self {
        Self { db }
    }

    pub fn add(&self, addr: &str) -> Result<String, DiscoveryError> {
        // Validate eagerly: parseable socket address or fail now.
        let parsed: std::net::SocketAddr = addr
            .parse()
            .map_err(|_| DiscoveryError::InvalidAddress(addr.to_string()))?;
        let key = uuid::Uuid::now_v7().to_string();
        self.db.tx(|conn| {
            let mut entries = self.load(conn)?;
            entries.push(ManualEntry {
                key: key.clone(),
                addr: parsed.to_string(),
            });
            Self::save(conn, &entries)
        })?;
        Ok(key)
    }

    pub fn list(&self) -> Result<Vec<ManualEntry>, DiscoveryError> {
        let conn = self.db.lock();
        Ok(self.load(&conn)?)
    }

    pub fn remove(&self, key: &str) -> Result<bool, DiscoveryError> {
        let removed = self.db.tx(|conn| {
            let mut entries = self.load(conn)?;
            let before = entries.len();
            entries.retain(|e| e.key != key);
            Self::save(conn, &entries)?;
            Ok(entries.len() < before)
        })?;
        Ok(removed)
    }

    fn load(&self, conn: &xamverse_storage::Connection) -> xamverse_storage::StorageResult<Vec<ManualEntry>> {
        let raw = xamverse_storage::repos::KvRepo::get(conn, KV_KEY)?
            .unwrap_or_else(|| "[]".to_string());
        Ok(serde_json::from_str(&raw)?)
    }

    fn save(conn: &xamverse_storage::Connection, entries: &[ManualEntry]) -> xamverse_storage::StorageResult<()> {
        xamverse_storage::repos::KvRepo::set(conn, KV_KEY, &serde_json::to_string(entries)?)?;
        Ok(())
    }
}

/// Default advertisement for an engine node.
pub fn advertisement_for(
    device_id: &str,
    name: &str,
    fingerprint: &str,
    port: u16,
) -> PeerAdvertisement {
    PeerAdvertisement {
        device_id: device_id.to_string(),
        name: name.to_string(),
        fingerprint: fingerprint.to_string(),
        protocol_major: xamverse_identity::PROTOCOL_VERSION_MAJOR,
        port,
        addresses: Discovery::detect_local_addresses(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertisement_txt_roundtrip() {
        let ad = PeerAdvertisement {
            device_id: "dev-123".into(),
            name: "Lab PC 03".into(),
            fingerprint: "XV-AAAA-BBBB-CCCC-DDDD".into(),
            protocol_major: 1,
            port: 47810,
            addresses: vec![IpAddr::from([192, 168, 1, 20])],
        };
        let txt = ad.to_txt();
        let restored = PeerAdvertisement::from_txt(&txt, ad.port, ad.addresses.clone()).unwrap();
        assert_eq!(ad, restored);
    }

    #[test]
    fn txt_missing_identity_is_rejected() {
        let txt = HashMap::from([("nm".to_string(), "no id".to_string())]);
        assert!(PeerAdvertisement::from_txt(&txt, 47810, vec![]).is_none());
    }

    #[test]
    fn connect_addrs_use_the_peer_port() {
        let ad = PeerAdvertisement {
            device_id: "d".into(),
            name: "n".into(),
            fingerprint: "f".into(),
            protocol_major: 1,
            port: 47810,
            addresses: vec![IpAddr::from([10, 0, 0, 5])],
        };
        assert_eq!(
            ad.connect_addrs(),
            vec![std::net::SocketAddr::from(([10, 0, 0, 5], 47810))]
        );
    }

    #[test]
    fn manual_peers_persist_and_validate() {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = xamverse_storage::Database::open(
            dir.path().join("d.xamdb"),
            &xamverse_storage::DatabaseKey::generate(),
        )
        .unwrap();
        let db = Arc::new(db);
        let manual = ManualPeers::new(db.clone());

        let key = manual.add("192.168.1.50:47810").unwrap();
        assert_eq!(manual.list().unwrap().len(), 1);

        assert!(manual.add("not-an-address").is_err());
        assert!(manual.add("192.168.1.51:47810").is_ok());

        assert!(manual.remove(&key).unwrap());
        assert!(!manual.remove(&key).unwrap());
        assert_eq!(manual.list().unwrap().len(), 1);
    }
}
