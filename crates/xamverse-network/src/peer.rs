//! TCP peer server and client.
//!
//! Every XamVerse node runs the same server: accept connections, run the
//! Noise handshake, verify the remote device card, consult the **trust
//! policy** (pairing store), then dispatch messages to the engine handler.
//! Any node may be client or server for any exchange — no fixed roles.

use crate::framing::{kinds, Envelope};
use crate::secure::{AuthenticatedPeer, HandshakeRole, SecureChannel};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use xamverse_identity::DeviceIdentity;

/// Verdict returned by the trust policy for a connecting device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrustDecision {
    /// Full peer access (paired and trusted).
    Allow,
    /// Handshake completes but only limited exchange is allowed (e.g. the
    /// pairing-request dance). The engine restricts message kinds.
    AllowLimited,
    /// Refuse the connection outright.
    Reject,
}

/// Synchronous trust lookup — SQLite-backed and indexed; called once per
/// connection, not per message.
pub type TrustPolicy = Arc<dyn Fn(&AuthenticatedPeer) -> TrustDecision + Send + Sync>;

/// Object-safe handler for a single authorized message.
pub type HandlerFuture = Pin<Box<dyn Future<Output = Option<Envelope>> + Send>>;

/// The engine's message handling surface. Implemented by the sync engine.
pub trait PeerHandler: Send + Sync + 'static {
    fn handle(&self, peer: &AuthenticatedPeer, trusted: TrustDecision, msg: Envelope) -> HandlerFuture;
}

#[derive(Debug, thiserror::Error)]
pub enum PeerServerError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Channel(#[from] crate::secure::ChannelError),
}

/// Long-running peer listener. `stop()` triggers graceful shutdown.
pub struct PeerServer {
    pub bind_addr: std::net::SocketAddr,
    stop_tx: watch::Sender<bool>,
    join: tokio::task::JoinHandle<()>,
}

impl PeerServer {
    /// Bind and start accepting. The accept loop never returns errors to the
    /// caller — per-connection failures are logged and the loop continues,
    /// which is what a school lab demands (one bad client must not kill the
    /// node's listener).
    pub async fn start(
        addr: std::net::SocketAddr,
        identity: Arc<DeviceIdentity>,
        trust_policy: TrustPolicy,
        handler: Arc<dyn PeerHandler>,
    ) -> Result<Self, PeerServerError> {
        let listener = TcpListener::bind(addr).await?;
        let bind_addr = listener.local_addr()?;
        let (stop_tx, stop_rx) = watch::channel(false);

        let join = tokio::spawn(async move {
            let mut stop_rx = stop_rx;
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            tracing::info!(%bind_addr, "peer server stopping");
                            break;
                        }
                    }
                    accepted = listener.accept() => {
                        match accepted {
                            Ok((stream, peer_addr)) => {
                                let identity = identity.clone();
                                let trust_policy = trust_policy.clone();
                                let handler = handler.clone();
                                tokio::spawn(async move {
                                    if let Err(err) =
                                        serve_connection(stream, peer_addr, identity, trust_policy, handler).await
                                    {
                                        // Expected noise: refused peers, handshakes from
                                        // non-XamVerse scanners, abrupt disconnects.
                                        tracing::debug!(%peer_addr, %err, "connection ended");
                                    }
                                });
                            }
                            Err(err) => {
                                tracing::warn!(%err, "accept failed; continuing");
                                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                            }
                        }
                    }
                }
            }
        });

        Ok(Self {
            bind_addr,
            stop_tx,
            join,
        })
    }

    pub async fn stop(self) {
        let _ = self.stop_tx.send(true);
        let _ = self.join.await;
    }
}

/// One connection's lifecycle: handshake → card exchange → trust check →
/// message loop with per-message dispatch and structured errors.
async fn serve_connection(
    stream: TcpStream,
    peer_addr: std::net::SocketAddr,
    identity: Arc<DeviceIdentity>,
    trust_policy: TrustPolicy,
    handler: Arc<dyn PeerHandler>,
) -> Result<(), PeerServerError> {
    let (channel, remote_static) =
        SecureChannel::handshake(stream, HandshakeRole::Responder, identity.transport.secret_bytes()).await?;
    let mut channel = channel;
    let peer = channel.exchange_device_cards(&identity, &remote_static).await?;

    let decision = trust_policy(&peer);
    if decision == TrustDecision::Reject {
        // Fail closed: tell the peer why, then drop.
        channel
            .send_msg(&Envelope::new(
                kinds::ERROR,
                serde_json::json!({ "code": "device_not_trusted", "detail": "pairing required" }),
            ))
            .await?;
        channel.goodbye().await;
        return Ok(());
    }

    tracing::info!(%peer_addr, device = %peer.card.device_id, "peer connected");

    loop {
        let msg: Envelope = match channel.recv_msg().await {
            Ok(msg) => msg,
            Err(crate::secure::ChannelError::Frame(crate::framing::FrameError::Io(_)))
            | Err(crate::secure::ChannelError::Io(_)) => {
                tracing::debug!(device = %peer.card.device_id, "peer stream closed");
                return Ok(());
            }
            Err(err) => {
                tracing::warn!(device = %peer.card.device_id, %err, "frame error; closing");
                return Ok(());
            }
        };

        if msg.kind == kinds::GOODBYE {
            channel.goodbye().await;
            return Ok(());
        }

        let reply = handler.handle(&peer, decision, msg).await;
        if let Some(reply) = reply {
            channel.send_msg(&reply).await?;
        }
    }
}

/// Outbound connection to a peer address.
pub struct PeerClient;

impl PeerClient {
    /// Connect, authenticate and verify the remote per `trust_policy`.
    pub async fn connect(
        addr: std::net::SocketAddr,
        identity: &DeviceIdentity,
        trust_policy: &TrustPolicy,
    ) -> Result<PeerConnection, PeerServerError> {
        let stream = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            TcpStream::connect(addr),
        )
        .await
        .map_err(|_| PeerServerError::Io(std::io::Error::new(std::io::ErrorKind::TimedOut, "connect timeout")))??;

        let (channel, remote_static) =
            SecureChannel::handshake(stream, HandshakeRole::Initiator, identity.transport.secret_bytes()).await?;
        let mut channel = channel;
        let peer = channel.exchange_device_cards(identity, &remote_static).await?;
        let decision = trust_policy(&peer);
        if decision == TrustDecision::Reject {
            channel.goodbye().await;
            return Err(PeerServerError::Channel(crate::secure::ChannelError::InvalidDeviceCard));
        }
        Ok(PeerConnection {
            channel,
            peer,
            decision,
        })
    }
}

/// An established, mutually authenticated outbound connection.
pub struct PeerConnection {
    pub channel: SecureChannel<TcpStream>,
    pub peer: AuthenticatedPeer,
    pub decision: TrustDecision,
}

impl PeerConnection {
    pub async fn request(&mut self, msg: Envelope) -> Result<Envelope, PeerServerError> {
        self.channel.send_msg(&msg).await?;
        Ok(self.channel.recv_msg().await?)
    }
}
