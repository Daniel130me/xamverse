//! Engine configuration. Every value is explicit — no magic defaults buried
//! in call sites; the defaults here are the documented product defaults.

use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// Per-installation data directory (database, keys, backups, updates).
    pub data_dir: PathBuf,
    /// Human-readable device name shown during pairing.
    pub device_name: String,
    /// Peer TCP port (Phase 1 prototype default 47810).
    pub peer_port: u16,
    /// Browser bridge port (47811). Reserved here; served by xamverse-web.
    pub browser_port: u16,
    /// mDNS advertisement/browsing; disable on multicast-blocked networks
    /// (manual peers remain fully functional).
    pub enable_mdns: bool,
    /// Trusted licence issuer public keys (base64 Ed25519).
    pub trusted_issuer_pks: Vec<String>,
    /// Trusted update release public keys (base64 Ed25519).
    pub trusted_release_pks: Vec<String>,
    /// Installed application version (update gating).
    pub app_version: String,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            data_dir: PathBuf::from("xamverse-data"),
            device_name: "XamVerse Device".to_string(),
            peer_port: xamverse_network::DEFAULT_PEER_PORT,
            browser_port: xamverse_network::DEFAULT_BROWSER_PORT,
            enable_mdns: true,
            trusted_issuer_pks: Vec::new(),
            trusted_release_pks: Vec::new(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}
