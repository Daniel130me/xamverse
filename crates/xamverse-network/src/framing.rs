//! Framed messages over the secure channel.
//!
//! Wire format (per app message):
//! `u32 BE ciphertext_len | ciphertext` where ciphertext is one Noise
//! transport message carrying the JSON envelope. Noise caps a message at
//! 65_535 bytes including its 16-byte tag, so the app payload cap below
//! guarantees one frame == one Noise message — no reassembly ambiguity.
//! Large content (packages, updates) travels as content-addressed blob
//! chunks of at most [`MAX_BLOB_CHUNK`], never as giant frames.

use serde::{Deserialize, Serialize};

/// Maximum plaintext bytes per app message: 65_535 minus the 16-byte AEAD tag.
pub const MAX_APP_PAYLOAD: usize = 65_519;

/// Default blob chunk size (must be < MAX_APP_PAYLOAD after JSON overhead).
pub const MAX_BLOB_CHUNK: usize = 60_000;

/// Guard against runaway frames from a hostile peer (defence in depth on top
/// of the Noise message-size ceiling).
pub const MAX_CIPHERTEXT_FRAME: usize = 65_535 + 4;

/// Message kinds exchanged between peers. The envelope is versioned; kinds
/// are additive and unknown kinds MUST produce an `error` reply, never a
/// silent no-op.
pub mod kinds {
    pub const HELLO: &str = "hello";
    pub const PING: &str = "ping";
    pub const PONG: &str = "pong";
    pub const ERROR: &str = "error";
    pub const GOODBYE: &str = "goodbye";
    // Sync protocol kinds live in xamverse-sync (manifest/ops/acks/blobs).
}

/// Versioned JSON envelope for every peer message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    /// Protocol version of the sender (mirrors DeviceCard; checked on hello).
    pub v: u32,
    /// Unique message id (uuid v7) — correlates responses, aids tracing.
    pub id: String,
    pub kind: String,
    /// Kind-specific JSON payload. Typed at the sync/service layer.
    pub payload: serde_json::Value,
}

impl Envelope {
    pub fn new(kind: impl Into<String>, payload: serde_json::Value) -> Self {
        Self {
            v: xamverse_identity::PROTOCOL_VERSION_MAJOR,
            id: uuid::Uuid::now_v7().to_string(),
            kind: kind.into(),
            payload,
        }
    }

    /// Structured error reply referencing the message that caused it.
    pub fn error_reply(&self, code: &str, detail: &str) -> Self {
        Self::new(
            kinds::ERROR,
            serde_json::json!({
                "code": code,
                "detail": detail,
                "in_reply_to": self.id,
                "received_kind": self.kind,
            }),
        )
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("peer sent an oversized frame ({0} bytes)")]
    Oversized(usize),
    #[error("payload does not fit in a single Noise message; use blob chunking")]
    PayloadTooLarge,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// Read exactly one length-prefixed Noise message from the stream.
pub async fn read_noise_frame(
    stream: &mut (impl tokio::io::AsyncRead + Unpin + Send),
) -> Result<Vec<u8>, FrameError> {
    use tokio::io::AsyncReadExt as _;
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_CIPHERTEXT_FRAME {
        return Err(FrameError::Oversized(len));
    }
    let mut ciphertext = vec![0u8; len];
    stream.read_exact(&mut ciphertext).await?;
    Ok(ciphertext)
}

/// Write one ciphertext frame with its length prefix.
pub async fn write_noise_frame(
    stream: &mut (impl tokio::io::AsyncWrite + Unpin + Send),
    ciphertext: &[u8],
) -> Result<(), FrameError> {
    use tokio::io::AsyncWriteExt as _;
    if ciphertext.len() > MAX_CIPHERTEXT_FRAME - 4 {
        return Err(FrameError::Oversized(ciphertext.len()));
    }
    stream
        .write_all(&(ciphertext.len() as u32).to_be_bytes())
        .await?;
    stream.write_all(ciphertext).await?;
    stream.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frames_roundtrip_over_tcp() {
        let (mut a, mut b) = tokio::io::duplex(1024);
        let writer = tokio::spawn(async move {
            write_noise_frame(&mut a, b"hello-frame").await.unwrap();
        });
        let frame = read_noise_frame(&mut b).await.unwrap();
        writer.await.unwrap();
        assert_eq!(frame, b"hello-frame");
    }

    #[tokio::test]
    async fn oversized_frame_is_rejected() {
        let (mut a, mut b) = tokio::io::duplex(64);
        use tokio::io::AsyncWriteExt as _;
        // Announce a frame far beyond the cap, then read on the other side.
        a.write_all(&(MAX_CIPHERTEXT_FRAME as u32 + 100).to_be_bytes())
            .await
            .unwrap();
        drop(a); // close so read_exact can't hang if the guard were missing
        let err = read_noise_frame(&mut b).await.unwrap_err();
        assert!(matches!(err, FrameError::Oversized(_)));
    }

    #[test]
    fn envelope_error_reply_references_original() {
        let msg = Envelope::new(kinds::PING, serde_json::json!({}));
        let reply = msg.error_reply("unknown_kind", "no handler");
        assert_eq!(reply.kind, kinds::ERROR);
        assert_eq!(reply.payload["in_reply_to"], msg.id.clone());
    }
}
