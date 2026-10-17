//! Cryptographic device identity.
//!
//! WHY THIS EXISTS
//! ---------------
//! Every installation is an equal peer that must prove who it is without any
//! PKI, certificate authority or internet connection. The design:
//!
//! * **Ed25519 signing keypair** — the durable identity. Signs operations,
//!   device cards and activation requests.
//! * **X25519 static keypair** — the Noise transport identity. Separate from
//!   the signing key so transport crypto and long-term identity have
//!   independent lifecycles.
//! * **Fingerprint** — SHA-256 over both public keys, base32-formatted as
//!   `XV-XXXX-XXXX-XXXX-XXXX`. Humans compare this during pairing; machines
//!   compare signatures.
//! * **Device card** — the portable identity document exchanged on every
//!   connection, signed by the signing key so a peer can verify the claimed
//!   identity owns both keys.
//!
//! Secrets live in the [`SecureKeyStore`] (OS keychain preferred; see the
//! keystore module's documented fallback). Seeds are zeroized on drop.

// Tests read far better with unwrap/expect; the lint stays enforced
// for library code — this exemption is scoped to cfg(test) only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

mod card;

pub use card::{DeviceCard, ProtocolVersion, PROTOCOL_VERSION_MAJOR, PROTOCOL_VERSION_MINOR};

use data_encoding::BASE32_NOPAD;
use ed25519_dalek::{Signer as _, SigningKey};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use x25519_dalek::{PublicKey as XPublicKey, StaticSecret as XStaticSecret};
use xamverse_storage::{SecureKeyStore, StorageError, StorageResult};
use zeroize::Zeroizing;

/// Names under which identity material is stored in the keystore.
pub mod key_names {
    pub const SIGNING_SEED: &str = "device_signing_seed";
    pub const TRANSPORT_SECRET: &str = "device_transport_secret";
    pub const DEVICE_ID: &str = "device_id";
}

/// Ed25519 signing keypair wrapper.
pub struct SigningKeyPair {
    signing: SigningKey,
}

impl SigningKeyPair {
    pub fn generate() -> Self {
        let mut seed = Zeroizing::new([0u8; 32]);
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut *seed);
        Self::from_seed(*seed)
    }

    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self {
            signing: SigningKey::from_bytes(&seed),
        }
    }

    pub fn public_b64(&self) -> String {
        data_encoding::BASE64.encode(self.signing.verifying_key().as_bytes())
    }

    pub fn sign(&self, message: &[u8]) -> String {
        data_encoding::BASE64.encode(&self.signing.sign(message).to_bytes())
    }

    /// Expose the raw seed only for keystore persistence (zeroized buffer).
    pub fn seed_bytes(&self) -> [u8; 32] {
        *self.signing.as_bytes()
    }
}

/// X25519 static keypair wrapper for the Noise transport.
pub struct TransportKeyPair {
    secret: Mutex<XStaticSecret>,
}

impl TransportKeyPair {
    pub fn generate() -> Self {
        let mut secret_bytes = Zeroizing::new([0u8; 32]);
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut *secret_bytes);
        Self::from_secret(*secret_bytes)
    }

    pub fn from_secret(secret: [u8; 32]) -> Self {
        Self {
            secret: Mutex::new(XStaticSecret::from(secret)),
        }
    }

    pub fn public_b64(&self) -> String {
        let secret = self
            .secret
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        data_encoding::BASE64.encode(XPublicKey::from(&*secret).as_bytes())
    }

    /// Raw secret for handing to the Noise handshake (consumed once per
    /// connection; the keypair itself stays alive for the engine lifetime).
    pub fn secret_bytes(&self) -> [u8; 32] {
        let secret = self
            .secret
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        secret.to_bytes()
    }
}

/// The complete identity of one installation.
pub struct DeviceIdentity {
    pub device_id: String,
    pub name: String,
    pub platform: String,
    pub signing: SigningKeyPair,
    pub transport: TransportKeyPair,
}

impl DeviceIdentity {
    /// Load the identity from the keystore, creating it on first boot.
    ///
    /// The device id is a UUID built from 16 random keystore bytes so it is
    /// stable across restarts and independent of any central allocator.
    pub fn load_or_create(
        keystore: &dyn SecureKeyStore,
        name: &str,
        platform: &str,
    ) -> StorageResult<Self> {
        let signing_seed = keystore.get_or_create(key_names::SIGNING_SEED, 32)?;
        let transport_secret = keystore.get_or_create(key_names::TRANSPORT_SECRET, 32)?;
        let device_id_bytes = keystore.get_or_create(key_names::DEVICE_ID, 16)?;

        if signing_seed.len() != 32 || transport_secret.len() != 32 || device_id_bytes.len() != 16 {
            return Err(StorageError::InvalidValue {
                field: "keystore",
                reason: "identity material has unexpected length".into(),
            });
        }

        let mut seed = [0u8; 32];
        seed.copy_from_slice(&signing_seed);
        let mut secret = [0u8; 32];
        secret.copy_from_slice(&transport_secret);
        let mut id = [0u8; 16];
        id.copy_from_slice(&device_id_bytes);

        Ok(Self {
            device_id: uuid::Builder::from_random_bytes(id).into_uuid().to_string(),
            name: name.to_string(),
            platform: platform.to_string(),
            signing: SigningKeyPair::from_seed(seed),
            transport: TransportKeyPair::from_secret(secret),
        })
    }

    /// Human-comparable fingerprint, e.g. `XV-7KQ2M-B4RTF-W9XJ2-P3DNC`.
    pub fn fingerprint(&self) -> String {
        Self::fingerprint_of(&self.signing.public_b64(), &self.transport.public_b64())
    }

    pub fn fingerprint_of(signing_pk_b64: &str, transport_pk_b64: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(signing_pk_b64.as_bytes());
        hasher.update(b"|");
        hasher.update(transport_pk_b64.as_bytes());
        let digest = hasher.finalize();
        // 10 bytes = 80 bits = 16 base32 chars — enough entropy to make
        // collision or forgery attempts evident in a visual comparison.
        let encoded = BASE32_NOPAD.encode(&digest[..10]);
        let chars: Vec<char> = encoded.chars().collect();
        let groups: Vec<String> = chars.chunks(4).map(|c| c.iter().collect()).collect();
        format!("XV-{}", groups.join("-"))
    }

    /// Sign an arbitrary engine message with the device signing key.
    pub fn sign(&self, message: &[u8]) -> String {
        self.signing.sign(message)
    }
}

/// Verify an Ed25519 signature (base64) against a base64 public key.
pub fn verify_signature(signing_pk_b64: &str, message: &[u8], signature_b64: &str) -> bool {
    use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
    let Ok(pk_bytes) = data_encoding::BASE64.decode(signing_pk_b64.as_bytes()) else {
        return false;
    };
    let Ok(pk_arr) = <[u8; 32]>::try_from(pk_bytes) else {
        return false;
    };
    let Ok(pk) = VerifyingKey::from_bytes(&pk_arr) else {
        return false;
    };
    let Ok(sig_bytes) = data_encoding::BASE64.decode(signature_b64.as_bytes()) else {
        return false;
    };
    let Ok(sig) = Signature::from_slice(&sig_bytes) else {
        return false;
    };
    pk.verify(message, &sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use xamverse_storage::MemoryKeyStore;

    #[test]
    fn identity_is_stable_across_reloads() {
        let keystore = MemoryKeyStore::default();
        let first = DeviceIdentity::load_or_create(&keystore, "Lab PC 01", "windows").unwrap();
        let second = DeviceIdentity::load_or_create(&keystore, "Lab PC 01", "windows").unwrap();
        assert_eq!(first.device_id, second.device_id);
        assert_eq!(first.signing.public_b64(), second.signing.public_b64());
        assert_eq!(first.transport.public_b64(), second.transport.public_b64());
    }

    #[test]
    fn fingerprint_format_is_stable_and_grouped() {
        let fp = DeviceIdentity::fingerprint_of("aaa", "bbb");
        assert!(fp.starts_with("XV-"));
        let groups: Vec<&str> = fp.trim_start_matches("XV-").split('-').collect();
        assert_eq!(groups.len(), 4);
        assert!(groups.iter().all(|g| g.len() == 4));
        assert_ne!(fp, DeviceIdentity::fingerprint_of("aaa", "ccc"));
    }

    #[test]
    fn signatures_verify_and_reject_tampering() {
        let identity = DeviceIdentity {
            device_id: "dev-1".into(),
            name: "n".into(),
            platform: "linux".into(),
            signing: SigningKeyPair::generate(),
            transport: TransportKeyPair::generate(),
        };
        let msg = b"hello engine";
        let sig = identity.sign(msg);
        assert!(verify_signature(&identity.signing.public_b64(), msg, &sig));
        assert!(!verify_signature(
            &identity.signing.public_b64(),
            b"tampered",
            &sig
        ));
    }
}
