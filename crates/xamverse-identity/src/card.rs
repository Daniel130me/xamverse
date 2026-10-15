//! Device cards — the portable, signed identity document exchanged on every
//! peer connection and embedded in every replicated operation's provenance.

use crate::{verify_signature, DeviceIdentity};
use serde::{Deserialize, Serialize};

/// Wire protocol version. Majors are incompatible (refuse connection);
/// minors are additive (interoperate). Bump when message schemas change.
pub const PROTOCOL_VERSION_MAJOR: u32 = 1;
pub const PROTOCOL_VERSION_MINOR: u32 = 0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
pub struct ProtocolVersion {
    pub major: u32,
    pub minor: u32,
}

impl ProtocolVersion {
    pub const CURRENT: Self = Self {
        major: PROTOCOL_VERSION_MAJOR,
        minor: PROTOCOL_VERSION_MINOR,
    };

    pub fn is_compatible_with(&self, other: &Self) -> bool {
        self.major == other.major
    }
}

/// What is signed: every field of the card except the signature itself.
/// Struct field order IS the canonical serialization order (serde emits
/// fields in declaration order), so both peers sign identical bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCard {
    pub device_id: String,
    pub name: String,
    pub platform: String,
    pub protocol_version: ProtocolVersion,
    /// base64 Ed25519 public key — the signing identity.
    pub signing_pk: String,
    /// base64 X25519 public key — matches the Noise static key actually used.
    pub transport_pk: String,
    /// Optional binding to the Noise handshake hash (hex). When present, the
    /// card is valid only inside that handshake — prevents replay of a
    /// captured card onto a different connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handshake_hash_hex: Option<String>,
    /// base64 Ed25519 signature over the card without this field.
    pub signature: String,
}

impl DeviceCard {
    /// Create and sign a card, optionally bound to a Noise handshake hash.
    pub fn sign(identity: &DeviceIdentity, handshake_hash_hex: Option<String>) -> Self {
        let unsigned = Self {
            device_id: identity.device_id.clone(),
            name: identity.name.clone(),
            platform: identity.platform.clone(),
            protocol_version: ProtocolVersion::CURRENT,
            signing_pk: identity.signing.public_b64(),
            transport_pk: identity.transport.public_b64(),
            handshake_hash_hex,
            signature: String::new(),
        };
        let message = unsigned.signing_message();
        Self {
            signature: identity.sign(&message),
            ..unsigned
        }
    }

    /// Canonical bytes that are signed: JSON with the signature omitted.
    pub fn signing_message(&self) -> Vec<u8> {
        serde_json::to_vec(&UnsignedView {
            device_id: &self.device_id,
            name: &self.name,
            platform: &self.platform,
            protocol_version: &self.protocol_version,
            signing_pk: &self.signing_pk,
            transport_pk: &self.transport_pk,
            handshake_hash_hex: &self.handshake_hash_hex,
        })
        .expect("unsigned view is always serializable")
    }

    /// Full verification: signature by the claimed signing key, and (when the
    /// card binds a handshake hash) that the hash matches this connection.
    pub fn verify(&self, expected_handshake_hash_hex: Option<&str>) -> bool {
        if !verify_signature(&self.signing_pk, &self.signing_message(), &self.signature) {
            return false;
        }
        match (&self.handshake_hash_hex, expected_handshake_hash_hex) {
            (Some(claimed), Some(expected)) => {
                constant_time_eq(claimed.as_bytes(), expected.as_bytes())
            }
            (Some(_), None) => false, // bound card presented outside its handshake
            (None, _) => true,
        }
    }
}

/// Field-borrowing mirror of [`DeviceCard`] used to produce the exact signed
/// bytes without cloning the card.
#[derive(Serialize)]
struct UnsignedView<'a> {
    device_id: &'a str,
    name: &'a str,
    platform: &'a str,
    protocol_version: &'a ProtocolVersion,
    signing_pk: &'a str,
    transport_pk: &'a str,
    handshake_hash_hex: &'a Option<String>,
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;
        use xamverse_storage::MemoryKeyStore;

    fn test_identity() -> DeviceIdentity {
        let keystore = MemoryKeyStore::default();
        DeviceIdentity::load_or_create(&keystore, "Lab PC 02", "linux").unwrap()
    }

    #[test]
    fn card_roundtrip_verifies() {
        let identity = test_identity();
        let card = DeviceCard::sign(&identity, Some("aabb".into()));
        assert!(card.verify(Some("aabb")));
        assert!(!card.verify(Some("ffff"))); // wrong handshake binding
        assert!(!card.verify(None)); // bound card outside handshake
    }

    #[test]
    fn tampered_card_is_rejected() {
        let identity = test_identity();
        let mut card = DeviceCard::sign(&identity, None);
        card.device_id = "evil-device".into();
        assert!(!card.verify(None));
    }

    #[test]
    fn protocol_major_mismatch_is_incompatible() {
        assert!(ProtocolVersion { major: 1, minor: 3 }.is_compatible_with(&ProtocolVersion { major: 1, minor: 0 }));
        assert!(!ProtocolVersion { major: 2, minor: 0 }.is_compatible_with(&ProtocolVersion::CURRENT));
    }
}
