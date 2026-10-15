//! `xamverse-peer` — headless engine node and diagnostic CLI.
//!
//! This is the engineering surface required by spec §26: it runs the exact
//! same `Engine` the desktop shell runs (own database, keys, port per data
//! directory), which is what integration tests and school IT use to verify
//! infrastructure without the GUI. Production-sensitive operations
//! (`approve_pairing`, `enroll_school`, collection) take `--user` and are
//! audit-logged like their UI equivalents.

use clap::{Parser, Subcommand};
use std::path::PathBuf;
use xamverse_core::{Engine, EngineConfig};

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
    LicenceImport {
        #[arg(long)]
        file: PathBuf,
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

fn main() {
    let cli = Cli::parse();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| cli.log.clone().into()),
        )
        .init();
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    runtime.block_on(run(cli));
}

async fn run(cli: Cli) {
    let globals = CliRef {
        data_dir: cli.data_dir.clone(),
        log: cli.log.clone(),
    };
    match cli.command {
        Command::Serve { port, name, no_mdns } => {
            let engine = Engine::init(EngineConfig {
                data_dir: cli.data_dir,
                device_name: name,
                peer_port: port,
                enable_mdns: !no_mdns,
                ..Default::default()
            })
            .unwrap_or_else(|e| panic!("engine init failed: {e}"));
            engine.start().await.unwrap_or_else(|e| panic!("engine start failed: {e}"));
            println!(
                "node {} (fingerprint {}) listening on :{} — Ctrl-C to stop",
                engine.identity.device_id,
                engine.identity.fingerprint(),
                engine.config.peer_port
            );
            tokio::signal::ctrl_c().await.expect("ctrl-c handler");
            engine.stop().await;
        }
        Command::Info => {
            let engine = engine_one_shot(&globals);
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
            let engine = engine_one_shot(&globals);
            let request = engine.licences.activation_request(&school);
            std::fs::write(&out, serde_json::to_vec_pretty(&request).unwrap()).unwrap();
            println!("activation request written to {}", out.display());
        }
        Command::LicenceImport { file } => {
            let engine = engine_one_shot(&globals);
            let cert = std::fs::read_to_string(&file).unwrap();
            let status = engine.licences.import_activation(&cert).unwrap();
            println!("licence imported; status: {status:?}");
        }
        Command::EnrollSchool { school_id, name, user } => {
            let engine = engine_one_shot(&globals);
            engine.enroll_school(&school_id, &name, &user).unwrap();
            println!("enrolled {name} ({school_id})");
        }
        Command::PeerPing { address } => {
            let engine = engine_one_shot(&globals);
            let addr: std::net::SocketAddr = address.parse().expect("socket address");
            match engine.ping_peer(addr).await {
                Ok(rtt) => println!("pong from {address} in {rtt:?}"),
                Err(e) => println!("ping failed: {e}"),
            }
        }
        Command::PeerPair { address, school_id, school_name } => {
            let engine = engine_one_shot(&globals);
            let addr: std::net::SocketAddr = address.parse().expect("socket address");
            let pending = engine
                .sync
                .request_pairing(addr, &school_id, &school_name)
                .await
                .unwrap();
            println!(
                "pairing pending with {} (fingerprint {}) — approve on that node",
                pending.responder_device_id, pending.responder_fingerprint
            );
        }
        Command::PeerApprove { school_id, device_id, user } => {
            let engine = engine_one_shot(&globals);
            engine.sync.approve_pairing(&school_id, &device_id, &user).unwrap();
            println!("{device_id} is now trusted for {school_id}");
        }
        Command::Peers { school_id } => {
            let engine = engine_one_shot(&globals);
            let conn = engine.db.lock();
            for trust in xamverse_storage::repos::TrustRepo::list(&conn, &school_id).unwrap() {
                println!("{}\t{}", trust.device_id, trust.state.as_str());
            }
        }
        Command::StorageVerify => {
            let engine = engine_one_shot(&globals);
            println!("integrity: {}", engine.db.integrity_check().unwrap());
            let status = engine.status().unwrap();
            for table in status.tables {
                println!("{}\t{}", table.table, table.rows);
            }
        }
        Command::SyncQueue { limit } => {
            let engine = engine_one_shot(&globals);
            let conn = engine.db.lock();
            for job in xamverse_storage::repos::JobsRepo::list(&conn, "", &[], limit).unwrap() {
                println!(
                    "{}\t{}\t{}\t{:?}\tattempts={}",
                    job.job_id, job.school_id, job.target_device_id, job.status, job.attempts
                );
            }
        }
        Command::SyncPull { device_id, address, school_id } => {
            let engine = engine_one_shot(&globals);
            let addr: std::net::SocketAddr = address.parse().expect("socket address");
            let job_id = engine
                .sync
                .enqueue_job(&school_id, &device_id, xamverse_storage::repos::JobKind::Pull, None)
                .unwrap();
            engine.sync.record_peer_address(&device_id, addr);
            println!("pull job {job_id} queued");
        }
        Command::Diagnostics => {
            let engine = engine_one_shot(&globals);
            println!("{}", serde_json::to_string_pretty(&engine.status().unwrap()).unwrap());
        }
    }
}

/// Borrow view used by one-shot commands after destructuring Cli.
struct CliRef {
    data_dir: PathBuf,
    #[allow(dead_code)]
    log: String,
}

fn engine_one_shot(cli: &CliRef) -> std::sync::Arc<Engine> {
    Engine::init(EngineConfig {
        data_dir: cli.data_dir.clone(),
        enable_mdns: false,
        ..Default::default()
    })
    .unwrap_or_else(|e| panic!("engine init failed: {e}"))
}
