//! `xamverse-peer` — headless engine node and diagnostic CLI.
//!
//! This is the engineering surface required by spec §26: it runs the exact
//! same `Engine` the desktop shell runs (own database, keys, port per data
//! directory), which is what integration tests and school IT use to verify
//! infrastructure without the GUI. Production-sensitive operations
//! (`approve_pairing`, `enroll_school`, collection) take `--user` and are
//! audit-logged like their UI equivalents.
//!
//! Error reporting contract: every failure exits non-zero with a single
//! `error:` line (anyhow context chain) — the CLI never panics on operator
//! input, and peer refusals surface as their structured message.

// Tests read far better with unwrap/expect; the lint stays enforced
// for library code — this exemption is scoped to cfg(test) only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};
use xamverse_core::{Engine, EngineConfig};
use xamverse_licensing::ActivationRequestFile;

#[derive(Parser)]
#[command(
    name = "xamverse-peer",
    about = "Run and inspect a XamVerse desktop engine node",
    version
)]
struct Cli {
    /// Per-node data directory (database + keys + backups live here).
    #[arg(long, global = true, default_value = "xamverse-data")]
    data_dir: PathBuf,
    #[arg(long, global = true, default_value = "info")]
    log: String,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run a full node until Ctrl-C (server, sync runner, discovery).
    Serve {
        #[arg(long, default_value_t = xamverse_network::DEFAULT_PEER_PORT)]
        port: u16,
        #[arg(long, default_value = "XamVerse Node")]
        name: String,
        /// Disable mDNS (multicast-blocked networks).
        #[arg(long, default_value_t = false)]
        no_mdns: bool,
    },
    /// Show this node's identity, fingerprint and diagnostics.
    Info,
    /// Print an activation request file for offline licensing.
    LicenceRequest {
        #[arg(long, default_value = "activation-request.json")]
        out: PathBuf,
        #[arg(long, default_value = "")]
        school: String,
    },
    /// Import a signed licence (activation response).
    ///
    /// The engine only trusts issuers configured at startup, so the base64
    /// Ed25519 public key printed by `license-issuer-dev generate-key` must
    /// be passed here (repeatable for key rotation).
    LicenceImport {
        #[arg(long)]
        file: PathBuf,
        /// Trusted issuer public key, base64 (repeatable).
        #[arg(long = "issuer-pk")]
        issuer_pks: Vec<String>,
    },
    /// Enroll this node for a school and seed builtin roles.
    EnrollSchool {
        #[arg(long)]
        school_id: String,
        #[arg(long)]
        name: String,
        #[arg(long, default_value = "cli-owner")]
        user: String,
    },
    /// Connect to a peer and report the round trip + its identity.
    PeerPing {
        /// Address, e.g. 192.168.1.50:47810
        address: String,
    },
    /// Request pairing with a peer (remote must approve).
    PeerPair {
        address: String,
        #[arg(long)]
        school_id: String,
        #[arg(long, default_value = "School")]
        school_name: String,
    },
    /// Approve a pending pairing locally.
    PeerApprove {
        #[arg(long)]
        school_id: String,
        #[arg(long)]
        device_id: String,
        #[arg(long, default_value = "cli-owner")]
        user: String,
    },
    /// List trusted/pending peers per school.
    Peers {
        #[arg(long)]
        school_id: String,
    },
    /// Storage status and integrity verification.
    StorageVerify,
    /// Push/pull status of the durable queue.
    SyncQueue {
        #[arg(long, default_value_t = 50)]
        limit: i64,
    },
    /// Enqueue a pull from a trusted peer.
    SyncPull {
        #[arg(long)]
        device_id: String,
        #[arg(long)]
        address: String,
        #[arg(long)]
        school_id: String,
    },
    /// Diagnostics snapshot (JSON).
    Diagnostics,
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    // Logs to stderr: stdout carries machine-readable command output (JSON,
    // tab-separated rows), so scripts can parse one without the other.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| cli.log.clone().into()),
        )
        .init();
    // Failures before the runtime exists are environment problems, not
    // operator errors — report them through the same single error line.
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(err) => {
            eprintln!("error: tokio runtime unavailable: {err}");
            return std::process::ExitCode::FAILURE;
        }
    };
    match runtime.block_on(run(cli)) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        // `{err:#}` prints the full anyhow context chain on one line:
        // "approve pairing: FOREIGN KEY constraint failed".
        Err(err) => {
            eprintln!("error: {err:#}");
            std::process::ExitCode::FAILURE
        }
    }
}

async fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Serve {
            port,
            name,
            no_mdns,
        } => {
            let engine = Engine::init(EngineConfig {
                data_dir: cli.data_dir,
                device_name: name,
                peer_port: port,
                enable_mdns: !no_mdns,
                ..Default::default()
            })
            .context("engine init failed")?;
            engine.start().await.context("engine start failed")?;
            println!(
                "node {} (fingerprint {}) listening on :{} — Ctrl-C to stop",
                engine.identity.device_id,
                engine.identity.fingerprint(),
                engine.config.peer_port
            );
            tokio::signal::ctrl_c()
                .await
                .context("waiting for Ctrl-C")?;
            engine.stop().await;
        }
        Command::Info => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            println!(
                "{}",
                serde_json::json!({
                    "device_id": engine.identity.device_id,
                    "name": engine.identity.name,
                    "fingerprint": engine.identity.fingerprint(),
                    "platform": engine.platform(),
                    "peer_port": engine.config.peer_port,
                })
            );
        }
        Command::LicenceRequest { out, school } => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            let request = engine.licences.activation_request(&school);
            // The shared interchange envelope (licensing crate) — the same
            // shape `license-issuer-dev issue` reads. One type, both tools,
            // so the file format cannot drift again.
            let file = ActivationRequestFile { request };
            let json = serde_json::to_vec_pretty(&file).context("serialize activation request")?;
            std::fs::write(&out, json)
                .with_context(|| format!("write activation request to {}", out.display()))?;
            println!("activation request written to {}", out.display());
        }
        Command::LicenceImport { file, issuer_pks } => {
            let trusted = validate_issuer_pks(&issuer_pks)?;
            let engine = engine_one_shot(&cli.data_dir, trusted)?;
            let cert = std::fs::read_to_string(&file)
                .with_context(|| format!("read licence file {}", file.display()))?;
            let status = engine
                .licences
                .import_activation(&cert)
                .context("licence rejected by the engine")?;
            println!("licence imported; status: {status:?}");
        }
        Command::EnrollSchool {
            school_id,
            name,
            user,
        } => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            engine
                .enroll_school(&school_id, &name, &user)
                .context("enroll school")?;
            println!("enrolled {name} ({school_id})");
        }
        Command::PeerPing { address } => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            let addr = parse_addr(&address)?;
            let rtt = engine
                .ping_peer(addr)
                .await
                .with_context(|| format!("ping {address} failed"))?;
            println!("pong from {address} in {rtt:?}");
        }
        Command::PeerPair {
            address,
            school_id,
            school_name,
        } => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            let addr = parse_addr(&address)?;
            // Errors from the responder (e.g. school not enrolled there)
            // arrive as structured envelopes and print as their message.
            let pending = engine
                .sync
                .request_pairing(addr, &school_id, &school_name)
                .await
                .context("pairing request refused")?;
            println!(
                "pairing pending with {} (fingerprint {}) — approve on that node",
                pending.responder_device_id, pending.responder_fingerprint
            );
        }
        Command::PeerApprove {
            school_id,
            device_id,
            user,
        } => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            engine
                .sync
                .approve_pairing(&school_id, &device_id, &user)
                .with_context(|| format!("approve {device_id} for {school_id}"))?;
            println!("{device_id} is now trusted for {school_id}");
        }
        Command::Peers { school_id } => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            let conn = engine.db.lock();
            let rows = xamverse_storage::repos::TrustRepo::list(&conn, &school_id)
                .context("list trusted peers")?;
            for trust in rows {
                println!("{}\t{}", trust.device_id, trust.state.as_str());
            }
        }
        Command::StorageVerify => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            let integrity = engine.db.integrity_check().context("integrity check")?;
            println!("integrity: {integrity}");
            let status = engine.status().context("read diagnostics")?;
            for table in status.tables {
                println!("{}\t{}", table.table, table.rows);
            }
        }
        Command::SyncQueue { limit } => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            let conn = engine.db.lock();
            let jobs = xamverse_storage::repos::JobsRepo::list(&conn, "", &[], limit)
                .context("read sync queue")?;
            for job in jobs {
                println!(
                    "{}\t{}\t{}\t{:?}\tattempts={}",
                    job.job_id, job.school_id, job.target_device_id, job.status, job.attempts
                );
            }
        }
        Command::SyncPull {
            device_id,
            address,
            school_id,
        } => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            let addr = parse_addr(&address)?;
            let job_id = engine
                .sync
                .enqueue_job(
                    &school_id,
                    &device_id,
                    xamverse_storage::repos::JobKind::Pull,
                    None,
                )
                .context("enqueue pull job")?;
            engine.sync.record_peer_address(&device_id, addr);
            println!("pull job {job_id} queued");
        }
        Command::Diagnostics => {
            let engine = engine_one_shot(&cli.data_dir, Vec::new())?;
            let status = engine.status().context("read diagnostics")?;
            println!(
                "{}",
                serde_json::to_string_pretty(&status).context("serialize diagnostics")?
            );
        }
    }
    Ok(())
}

/// Start a short-lived engine for one-shot commands.
///
/// `trusted_issuer_pks` is empty everywhere except `licence-import`: trust
/// keys are a licence-import concern, and defaults stay visible at the call
/// site instead of hidden in `EngineConfig::default()`.
fn engine_one_shot(
    data_dir: &Path,
    trusted_issuer_pks: Vec<String>,
) -> Result<std::sync::Arc<Engine>> {
    Engine::init(EngineConfig {
        data_dir: data_dir.to_path_buf(),
        trusted_issuer_pks,
        enable_mdns: false,
        ..Default::default()
    })
    .with_context(|| format!("engine init failed in {}", data_dir.display()))
}

/// Validate issuer keys up front so a typo fails with an actionable message
/// instead of the engine's generic "signature not from a trusted issuer".
fn validate_issuer_pks(pks: &[String]) -> Result<Vec<String>> {
    if pks.is_empty() {
        bail!(
            "no trusted issuer key configured: pass --issuer-pk <base64-ed25519-public-key> \
             (printed by `license-issuer-dev generate-key`)"
        );
    }
    for pk in pks {
        let decoded = data_encoding::BASE64
            .decode(pk.as_bytes())
            .with_context(|| format!("--issuer-pk {pk} is not valid base64"))?;
        if decoded.len() != 32 {
            bail!(
                "--issuer-pk must be a 32-byte Ed25519 public key (got {} bytes)",
                decoded.len()
            );
        }
    }
    Ok(pks.to_vec())
}

fn parse_addr(address: &str) -> Result<std::net::SocketAddr> {
    address
        .parse()
        .with_context(|| format!("invalid address {address:?} (expected ip:port)"))
}
