//! Development licence issuer.
//!
//! SECURITY BOUNDARY: this tool exists so the offline activation workflow
//! can be exercised end-to-end in development and CI. It must NEVER hold or
//! generate production signing keys — production issuance uses an offline,
//! hardware-protected key with its public key configured into the desktop
//! shell's `LicenceConfig`. See LICENSING.md "Issuer separation".
//!
//! Error reporting contract (matches `xamverse-peer`): failures exit
//! non-zero with a single `error:` line — no panics on operator input.

// Tests read far better with unwrap/expect; the lint stays enforced
// for library code — this exemption is scoped to cfg(test) only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use ed25519_dalek::{Signer as _, SigningKey};
use std::path::{Path, PathBuf};
use xamverse_licensing::{ActivationRequestFile, LicenceCertificate};

#[derive(Parser)]
#[command(
    name = "license-issuer-dev",
    about = "Development XamVerse licence issuer (test keys only)"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Generate a throwaway issuer keypair for development.
    GenerateKey {
        /// Output path for the JSON keypair file (0600 on unix).
        #[arg(long, default_value = "issuer-keypair.json")]
        out: PathBuf,
    },
    /// Sign a licence for an activation request.
    Issue {
        /// Activation request file produced by `xamverse-peer licence-request`
        /// (the shared `ActivationRequestFile` envelope from the licensing crate).
        #[arg(long)]
        request: PathBuf,
        /// Issuer keypair file from `generate-key`.
        #[arg(long)]
        key: PathBuf,
        /// Commercial plan.
        #[arg(long, default_value = "standard")]
        plan: String,
        /// Validity window in days from now.
        #[arg(long, default_value_t = 365)]
        days: i64,
        /// Read-only grace period after expiry, in days.
        #[arg(long, default_value_t = 30)]
        grace: u32,
        /// Max activations covered by the school's subscription.
        #[arg(long, default_value_t = 5)]
        device_limit: i64,
        /// Output path for the signed licence (activation response file).
        #[arg(long, default_value = "licence.json")]
        out: PathBuf,
    },
}

/// Key file format (dev only — production keys never live in files like this).
#[derive(serde::Serialize, serde::Deserialize)]
struct IssuerKeypairFile {
    issuer_id: String,
    public_key_b64: String,
    /// NOTE(non-standard): the secret in a FILE is acceptable only because
    /// this is a development tool. Flagged in KNOWN_LIMITATIONS.md.
    secret_seed_hex: String,
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::GenerateKey { out } => generate_key(&out),
        Command::Issue {
            request,
            key,
            plan,
            days,
            grace,
            device_limit,
            out,
        } => issue(&request, &key, &plan, days, grace, device_limit, &out),
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err:#}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn generate_key(out: &Path) -> Result<()> {
    let mut seed = [0u8; 32];
    use rand::RngCore as _;
    rand::thread_rng().fill_bytes(&mut seed);
    let signing = SigningKey::from_bytes(&seed);
    let file = IssuerKeypairFile {
        issuer_id: format!("dev-{}", uuid::Uuid::now_v7()),
        public_key_b64: data_encoding::BASE64.encode(signing.verifying_key().as_bytes()),
        secret_seed_hex: seed.iter().map(|b| format!("{b:02x}")).collect(),
    };
    let json = serde_json::to_vec_pretty(&file).context("serialize issuer keypair")?;
    write_private(out, &json)?;
    println!(
        "issuer keypair written to {}\npublic key (configure into LicenceConfig / --issuer-pk):\n  {}",
        out.display(),
        file.public_key_b64
    );
    Ok(())
}

fn issue(
    request_path: &Path,
    key_path: &Path,
    plan: &str,
    days: i64,
    grace: u32,
    device_limit: i64,
    out: &Path,
) -> Result<()> {
    let request_file: ActivationRequestFile = serde_json::from_slice(
        &std::fs::read(request_path)
            .with_context(|| format!("read request file {}", request_path.display()))?,
    )
    .context("request file shape (expected the ActivationRequestFile envelope written by `xamverse-peer licence-request`)")?;
    let request = request_file.request;
    if !request.verify() {
        bail!("activation request signature invalid — refusing to issue");
    }

    let key_file: IssuerKeypairFile = serde_json::from_slice(
        &std::fs::read(key_path)
            .with_context(|| format!("read key file {}", key_path.display()))?,
    )
    .context("key file shape (expected the IssuerKeypairFile JSON from `generate-key`)")?;
    let mut seed = [0u8; 32];
    for (i, b) in key_file
        .secret_seed_hex
        .as_bytes()
        .chunks(2)
        .take(32)
        .enumerate()
    {
        seed[i] = u8::from_str_radix(std::str::from_utf8(b).context("key file is not hex")?, 16)
            .context("key file is not valid hex")?;
    }
    let signing = SigningKey::from_bytes(&seed);

    let now = chrono::Utc::now();
    let mut cert = LicenceCertificate {
        licence_id: uuid::Uuid::now_v7().to_string(),
        school_id: format!("school-for-{}", request.school_hint),
        plan: plan.to_string(),
        features: vec![
            "exams.create".into(),
            "students.manage".into(),
            "results.manage".into(),
            "data.read".into(),
            "data.export".into(),
            "backup.create".into(),
            "backup.restore".into(),
        ],
        device_id: request.device_id.clone(),
        device_fingerprint: request.device_fingerprint.clone(),
        device_limit,
        issued_at: now.to_rfc3339(),
        not_before: now.to_rfc3339(),
        expires_at: (now + chrono::TimeDelta::try_days(days).context("validity days")?)
            .to_rfc3339(),
        grace_days: grace,
        issuer_id: key_file.issuer_id,
        signature: String::new(),
    };
    cert.signature =
        data_encoding::BASE64.encode(&signing.sign(&cert.signing_message()).to_bytes());

    let json = serde_json::to_vec_pretty(&cert).context("serialize licence")?;
    std::fs::write(out, json).with_context(|| format!("write licence to {}", out.display()))?;
    println!(
        "licence {} issued for device {} (expires {}, grace {grace}d)\nactivation response: {}",
        cert.licence_id,
        request.device_id,
        cert.expires_at,
        out.display()
    );
    Ok(())
}

/// Write a key file with owner-only permissions (0600 on unix).
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write as _;
    let mut file =
        std::fs::File::create(path).with_context(|| format!("create {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .context("restrict key file permissions")?;
    }
    file.write_all(bytes)
        .with_context(|| format!("write {}", path.display()))?;
    file.sync_all().context("sync key file to disk")?;
    Ok(())
}
