//! Noise XX secure channel.
//!
//! Handshake (snow `Noise_XX_25519_ChaChaPoly_BLAKE2s`, 1.5 RTT):
//! 1. initiator -> e
//! 2. responder -> e, ee, s, es   (responder static authenticated)
//! 3. initiator -> s, se          (initiator static authenticated)
//!
//! Both sides then exchange a signed [`DeviceCard`] *inside* the encrypted
//! transport. The card is bound to the Noise handshake hash, so a captured
//! card cannot be replayed on another connection, and the remote's claimed
//! Ed25519 identity is proven to own the X25519 static key the Noise
//! handshake just authenticated.

use crate::framing::{read_noise_frame, write_noise_frame};
use serde::{Deserialize, Serialize};
use snow::{Builder, HandshakeState, TransportState};

use data_encoding;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncWrite};
use xamverse_identity::{DeviceCard, DeviceIdentity, ProtocolVersion};

/// Cipher suite: X25519 key agreement, ChaCha20-Poly1305 AEAD, BLAKE2s hash.
pub const NOISE_PARAMS: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";

#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("noise handshake failed: {0}")]
    Handshake(#[from] snow::Error),
    #[error(transparent)]
    Frame(#[from] crate::framing::FrameError),
    #[error("remote device card is invalid or not signed by the claimed identity")]
    InvalidDeviceCard,
    #[error("remote device card signature does not own the transport key used in the handshake")]
    IdentityTransportMismatch,
    #[error("remote protocol version {remote} is incompatible with {local}")]
    ProtocolMismatch { remote: String, local: String },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Authenticated remote peer produced by the handshake.
#[derive(Debug, Clone)]
pub struct AuthenticatedPeer {
    pub card: DeviceCard,
    /// SHA-256 hex of the Noise handshake hash — the channel binding id.
    pub channel_binding: String,
}

/// Role marker for the handshake order.
#[derive(Debug, Clone, Copy)]
pub enum HandshakeRole {
    Initiator,
    Responder,
}

/// A Noise-encrypted, framed message channel over any byte stream.
pub struct SecureChannel<S> {
    stream: S,
    transport: TransportState,
    binding: String,
}

impl<S: AsyncRead + AsyncWrite + Unpin + Send> SecureChannel<S> {
    /// Run the Noise XX handshake as the given role. Returns the channel plus
    /// the *remote static key* (base64) — needed to bind the device card to
    /// the actual handshake key.
    pub async fn handshake(mut stream: S, role: HandshakeRole, transport_secret: [u8; 32]) -> Result<(Self, String), ChannelError> {
        let params: snow::params::NoiseParams = NOISE_PARAMS.parse().expect("static params");
        let builder: Builder<'_> = Builder::new(params);
        let mut hs: HandshakeState = match role {
            HandshakeRole::Initiator => builder.local_private_key(&transport_secret).build_initiator()?,
            HandshakeRole::Responder => builder.local_private_key(&transport_secret).build_responder()?,
        };

        // XX: exactly three handshake rounds; the initiator writes on rounds
        // 0 and 2, the responder on round 1. Tracked explicitly because snow
        // does not expose the next-message role on HandshakeState.
        let initiator = matches!(role, HandshakeRole::Initiator);
        for round in 0..3u8 {
            let i_write = initiator == (round % 2 == 0);
            if i_write {
                let mut buf = vec![0u8; 65535];
                let len = hs.write_message(&[], &mut buf)?;
                write_noise_frame(&mut stream, &buf[..len]).await?;
            } else {
                let ciphertext = read_noise_frame(&mut stream).await?;
                let mut buf = vec![0u8; 65535];
                let len = hs.read_message(&ciphertext, &mut buf)?;
                debug_assert_eq!(len, 0, "handshake messages carry no payload");
            }
        }

        let binding = hex(hs.get_handshake_hash());
        let remote_static_b64 = data_encoding::BASE64.encode(hs.get_remote_static().expect("XX authenticates both statics"));
        let transport = hs.into_transport_mode()?;
        Ok((Self { stream, transport, binding }, remote_static_b64))
    }

    pub fn channel_binding(&self) -> &str {
        &self.binding
    }

    /// Exchange device cards and verify them. Returns the authenticated peer.
    ///
    /// `expected_transport_pk_b64` is the remote Noise static key observed in
    /// the handshake; the presented card MUST claim the same transport key,
    /// preventing an attacker with a valid signing key from presenting
    /// someone else's transport identity.
    pub async fn exchange_device_cards(
        &mut self,
        identity: &DeviceIdentity,
        expected_transport_pk_b64: &str,
    ) -> Result<AuthenticatedPeer, ChannelError> {
        // 1. Send our card, bound to this handshake.
        let my_card = DeviceCard::sign(identity, Some(self.binding.clone()));
        self.send_msg(&my_card).await?;

        // 2. Receive theirs.
        let their_card: DeviceCard = self.recv_msg().await?;

        // 3. Verify card integrity, handshake binding, and key ownership.
        if !their_card.verify(Some(&self.binding)) {
            return Err(ChannelError::InvalidDeviceCard);
        }
        if their_card.transport_pk != expected_transport_pk_b64 {
            return Err(ChannelError::IdentityTransportMismatch);
        }
        if !their_card
            .protocol_version
            .is_compatible_with(&ProtocolVersion::CURRENT)
        {
            return Err(ChannelError::ProtocolMismatch {
                remote: format!("{}.{}", their_card.protocol_version.major, their_card.protocol_version.minor),
                local: format!("{}", ProtocolVersion::CURRENT.major),
            });
        }
        Ok(AuthenticatedPeer {
            card: their_card,
            channel_binding: self.binding.clone(),
        })
    }

    /// Send a serializable message (one Noise message, size-capped).
    pub async fn send_msg<T: Serialize>(&mut self, msg: &T) -> Result<(), ChannelError> {
        let payload = serde_json::to_vec(msg)?;
        if payload.len() > crate::framing::MAX_APP_PAYLOAD {
            return Err(ChannelError::Frame(crate::framing::FrameError::PayloadTooLarge));
        }
        let mut ciphertext = vec![0u8; payload.len() + 16];
        let len = self.transport.write_message(&payload, &mut ciphertext)?;
        ciphertext.truncate(len);
        write_noise_frame(&mut self.stream, &ciphertext).await?;
        Ok(())
    }

    /// Receive and deserialize one message.
    pub async fn recv_msg<T: for<'de> Deserialize<'de>>(&mut self) -> Result<T, ChannelError> {
        let ciphertext = read_noise_frame(&mut self.stream).await?;
        let mut plaintext = vec![0u8; ciphertext.len()];
        let len = self.transport.read_message(&ciphertext, &mut plaintext)?;
        plaintext.truncate(len);
        Ok(serde_json::from_slice(&plaintext)?)
    }

    /// Graceful goodbye then shutdown (best-effort).
    pub async fn goodbye(mut self) {
        let _ = self
            .send_msg(&crate::framing::Envelope::new(
                crate::framing::kinds::GOODBYE,
                serde_json::json!({}),
            ))
            .await;
        use tokio::io::AsyncWriteExt as _;
        let _ = self.stream.shutdown().await;
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Helper for tests and callers that need an Arc-ed identity.
pub type SharedIdentity = Arc<DeviceIdentity>;

#[cfg(test)]
mod tests {
    use super::*;
    use xamverse_storage::MemoryKeyStore;

    async fn tcp_pair() -> (tokio::net::TcpStream, tokio::net::TcpStream) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let client = tokio::spawn(async move { tokio::net::TcpStream::connect(addr).await.unwrap() });
        let (server, _) = listener.accept().await.unwrap();
        (client.await.unwrap(), server)
    }

    fn identity(name: &str) -> DeviceIdentity {
        let keystore = MemoryKeyStore::default();
        DeviceIdentity::load_or_create(&keystore, name, "linux").unwrap()
    }

    #[tokio::test]
    async fn handshake_and_card_exchange_succeeds() {
        let a = identity("PeerA");
        let b = identity("PeerB");
        let (client, server) = tcp_pair().await;

        let ia = a.transport.secret_bytes();
        let ib = b.transport.secret_bytes();
        let (client_res, server_res) = tokio::join!(
            async {
                let (mut ch, remote_static) = SecureChannel::handshake(client, HandshakeRole::Initiator, ia).await?;
                let peer = ch.exchange_device_cards(&a, &remote_static).await?;
                Ok::<_, ChannelError>(peer)
            },
            async {
                let (mut ch, remote_static) = SecureChannel::handshake(server, HandshakeRole::Responder, ib).await?;
                let peer = ch.exchange_device_cards(&b, &remote_static).await?;
                Ok::<_, ChannelError>(peer)
            }
        );
        let peer_of_a = client_res.unwrap();
        let peer_of_b = server_res.unwrap();
        assert_eq!(peer_of_a.card.device_id, b.device_id);
        assert_eq!(peer_of_b.card.device_id, a.device_id);
        assert_eq!(peer_of_a.channel_binding, peer_of_b.channel_binding);
    }

    #[tokio::test]
    async fn messages_flow_both_ways() {
        let a = identity("PeerA");
        let b = identity("PeerB");
        let (client, server) = tcp_pair().await;
        let ia = a.transport.secret_bytes();
        let ib = b.transport.secret_bytes();

        let (client_res, server_res) = tokio::join!(
            async {
                let (mut ch, rs) = SecureChannel::handshake(client, HandshakeRole::Initiator, ia).await?;
                ch.exchange_device_cards(&a, &rs).await?;
                ch.send_msg(&crate::framing::Envelope::new("ping", serde_json::json!({"n": 1}))).await?;
                let pong: crate::framing::Envelope = ch.recv_msg().await?;
                Ok::<_, ChannelError>(pong)
            },
            async {
                let (mut ch, rs) = SecureChannel::handshake(server, HandshakeRole::Responder, ib).await?;
                ch.exchange_device_cards(&b, &rs).await?;
                let ping: crate::framing::Envelope = ch.recv_msg().await?;
                ch.send_msg(&crate::framing::Envelope::new("pong", ping.payload)).await?;
                Ok::<_, ChannelError>(())
            }
        );
        server_res.unwrap();
        let pong = client_res.unwrap();
        assert_eq!(pong.kind, "pong");
        assert_eq!(pong.payload["n"], 1);
    }

    #[tokio::test]
    async fn card_from_wrong_identity_is_rejected() {
        let victim = identity("Victim");
        let attacker = identity("Attacker");
        let third = identity("ThirdParty");
        let (client, server) = tcp_pair().await;

        // The responder completes the Noise handshake with its own transport
        // key but presents a card signed by a *third* identity. The initiator
        // must refuse: the card's transport key does not own the handshake.
        let (init_res, resp_res) = tokio::join!(
            async {
                let (mut ch, rs) =
                    SecureChannel::handshake(client, HandshakeRole::Initiator, victim.transport.secret_bytes()).await?;
                ch.exchange_device_cards(&victim, &rs).await
            },
            async {
                let (mut ch, _) =
                    SecureChannel::handshake(server, HandshakeRole::Responder, attacker.transport.secret_bytes()).await?;
                ch.send_msg(&DeviceCard::sign(&third, Some(ch.channel_binding().to_string())))
                    .await?;
                // Block until the initiator drops the connection.
                let _ = ch.recv_msg::<DeviceCard>().await;
                Ok::<_, ChannelError>(())
            }
        );
        assert!(
            matches!(init_res, Err(ChannelError::IdentityTransportMismatch)),
            "expected identity/transport mismatch, got {init_res:?}"
        );
        let _ = resp_res;
    }
}
