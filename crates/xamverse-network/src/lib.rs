//! Secure peer networking for the XamVerse engine.
//!
//! Layering: `framing` (versioned envelopes, size caps) → `secure` (Noise XX
//! channel bound to device identity) → `peer` (TCP server/client with trust
//! policy and message dispatch). The sync engine implements `PeerHandler`
//! and supplies the trust policy from the pairing store — this crate never
//! touches the database itself.

// Tests read far better with unwrap/expect; the lint stays enforced
// for library code — this exemption is scoped to cfg(test) only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod framing;
pub mod peer;
pub mod secure;

pub use framing::{Envelope, FrameError};
pub use peer::{
    HandlerFuture, PeerClient, PeerConnection, PeerHandler, PeerServer, PeerServerError,
    TrustDecision, TrustPolicy,
};
pub use secure::{AuthenticatedPeer, ChannelError, HandshakeRole, SecureChannel};

/// Default TCP port for peer connections (matches the Phase 1 prototype).
pub const DEFAULT_PEER_PORT: u16 = 47_810;
/// Default TCP port for the LAN browser bridge.
pub const DEFAULT_BROWSER_PORT: u16 = 47_811;
