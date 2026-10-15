//! Licence certificates and verification.
//!
//! The issuer's Ed25519 private key NEVER ships with the app — only public
//! verification keys are configured into the engine (see `LicenceConfig`).
//! The canonical signing form is the serde JSON of the certificate with the
//! signature field excluded (struct order is the canonical order).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use xamverse_identity::verify_signature;

/// Commercial plans (mirrors the Phase 1 prototype's licence model).
pub const PLANS: &[&str] = &["starter", "standard", "campus"];

/// Days before expiry when the status flips to "near expiry" for UIs.
pub const NEAR_EXPIRY_DAYS: i64 = 14;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LicenceCertificate {
    pub licence_id: String,
    pub school_id: String,
    /// One of `PLANS`.
    pub plan: String,
    /// Entitlement strings, e.g. "exams.create", "ai.generate".
    pub features: Vec<String>,
    /// Device binding: the licence only activates on this installation.
    pub device_id: String,
    pub device_fingerprint: String,
    /// Max seats (device allowance rule); enforced by Phase 3 onboarding.
    pub device_limit: i64,
    pub issued_at: String,
    pub not_before: String,
    pub expires_at: String,
    /// Read-only grace window (days) after expiry.
    pub grace_days: u32,
    pub issuer_id: String,
    /// base64 Ed25519 signature over the certificate sans this field.
    pub signature: String,
}

impl LicenceCertificate {
    /// Canonical bytes covered by the issuer signature.
    pub fn signing_message(&self) -> Vec<u8> {
        serde_json::to_vec(&UnsignedView {
            licence_id: &self.licence_id,
            school_id: &self.school_id,
            plan: &self.plan,
            features: &self.features,
            device_id: &self.device_id,
            device_fingerprint: &self.device_fingerprint,
            device_limit: self.device_limit,
            issued_at: &self.issued_at,
            not_before: &self.not_before,
            expires_at: &self.expires_at,
            grace_days: self.grace_days,
            issuer_id: &self.issuer_id,
        })
        .expect("unsigned view is always serializable")
    }

    /// Cryptographic + device-binding verification only (no clock math).
    pub fn verify_binding(&self, trusted_issuer_pks: &[String], local_device_id: &str, local_fingerprint: &str) -> Result<(), LicenceError> {
        if !PLANS.contains(&self.plan.as_str()) {
            return Err(LicenceError::Invalid(format!("unknown plan {}", self.plan)));
        }
        let signed_ok = trusted_issuer_pks
            .iter()
            .any(|pk| verify_signature(pk, &self.signing_message(), &self.signature));
        if !signed_ok {
            return Err(LicenceError::Invalid("signature not from a trusted issuer".into()));
        }
        if self.device_id != local_device_id || self.device_fingerprint != local_fingerprint {
            // Copy protection: a licence is bound to its installation.
            return Err(LicenceError::DeviceMismatch);
        }
        Ok(())
    }

    /// Full verification: binding + temporal window. Used at import time,
    /// where an already fully-expired licence is refused outright.
    pub fn verify(&self, trusted_issuer_pks: &[String], local_device_id: &str, local_fingerprint: &str) -> Result<(), LicenceError> {
        self.verify_binding(trusted_issuer_pks, local_device_id, local_fingerprint)?;
        let now = chrono::Utc::now();
        let not_before = chrono::DateTime::parse_from_rfc3339(&self.not_before)
            .map_err(|_| LicenceError::Invalid("not_before is not RFC3339".into()))?;
        let expires_at = chrono::DateTime::parse_from_rfc3339(&self.expires_at)
            .map_err(|_| LicenceError::Invalid("expires_at is not RFC3339".into()))?;
        if now < not_before {
            return Err(LicenceError::NotYetValid);
        }
        if now > expires_at + chrono::TimeDelta::try_days(i64::from(self.grace_days)).unwrap() {
            return Err(LicenceError::Expired);
        }
        Ok(())
    }

    /// Human-verifiable binding summary (shown in the UI during activation).
    pub fn binding_summary(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.device_id.as_bytes());
        hasher.update(b"|");
        hasher.update(self.expires_at.as_bytes());
        let digest = hasher.finalize();
        format!("LIC-{}", &digest.iter().take(4).map(|b| format!("{b:02X}")).collect::<String>())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LicenceError {
    #[error("licence is invalid: {0}")]
    Invalid(String),
    #[error("licence is bound to a different device installation")]
    DeviceMismatch,
    #[error("licence is not valid yet (not_before in the future)")]
    NotYetValid,
    #[error("licence and grace period have expired")]
    Expired,
    #[error(transparent)]
    Storage(#[from] xamverse_storage::StorageError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Borrowing mirror for canonical signing.
#[derive(Serialize)]
struct UnsignedView<'a> {
    licence_id: &'a str,
    school_id: &'a str,
    plan: &'a str,
    features: &'a Vec<String>,
    device_id: &'a str,
    device_fingerprint: &'a str,
    device_limit: i64,
    issued_at: &'a str,
    not_before: &'a str,
    expires_at: &'a str,
    grace_days: u32,
    issuer_id: &'a str,
}

/// Offline activation request generated by an unactivated installation.
/// The school moves this file (USB/paper) to an internet-connected machine
/// where an authorized issuer signs a licence for it. The request carries
/// the device's signing public key so the issuer can verify provenance;
/// fabricating a request only yields a licence useless off the target
/// device, so this is not a security hole.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivationRequest {
    pub device_id: String,
    pub device_fingerprint: String,
    pub device_name: String,
    pub school_hint: String,
    pub generated_at: String,
    /// base64 Ed25519 public key of the requesting device.
    pub device_public_key: String,
    /// Ed25519 signature by the device signing key over the request fields.
    pub device_signature: String,
}

impl ActivationRequest {
    pub fn create(identity: &xamverse_identity::DeviceIdentity, school_hint: &str) -> Self {
        let unsigned = Self {
            device_id: identity.device_id.clone(),
            device_fingerprint: identity.fingerprint(),
            device_name: identity.name.clone(),
            school_hint: school_hint.to_string(),
            generated_at: xamverse_storage::now_rfc3339(),
            device_public_key: identity.signing.public_b64(),
            device_signature: String::new(),
        };
        let mut signed = unsigned;
        signed.device_signature = identity.sign(&signed.signing_message());
        signed
    }

    /// Canonical bytes covered by the device signature.
    pub fn signing_message(&self) -> Vec<u8> {
        serde_json::to_vec(&RequestView {
            device_id: &self.device_id,
            device_fingerprint: &self.device_fingerprint,
            device_name: &self.device_name,
            school_hint: &self.school_hint,
            generated_at: &self.generated_at,
            device_public_key: &self.device_public_key,
        })
        .expect("request view is always serializable")
    }

    /// The issuer tool verifies the request before honouring it.
    pub fn verify(&self) -> bool {
        xamverse_identity::verify_signature(
            &self.device_public_key,
            &self.signing_message(),
            &self.device_signature,
        )
    }
}

/// Borrowing mirror for canonical request signing.
#[derive(Serialize)]
struct RequestView<'a> {
    device_id: &'a str,
    device_fingerprint: &'a str,
    device_name: &'a str,
    school_hint: &'a str,
    generated_at: &'a str,
    device_public_key: &'a str,
}
