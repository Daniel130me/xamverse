use std::sync::Arc;
use xamverse_core::{Engine, EngineConfig};
use xamverse_storage::repos::JobKind;

async fn spawn_node(dir: &std::path::Path, name: &str) -> (Arc<Engine>, std::net::SocketAddr) {
    let engine = Engine::init(EngineConfig {
        data_dir: dir.to_path_buf(),
        device_name: name.to_string(),
        enable_mdns: false,
        peer_port: 0,
        ..Default::default()
    }).expect("engine init");
    engine.enroll_school("s1", "S", "seed-user").expect("enroll");
    engine.start().await.expect("engine start");
    let addr = engine.peer_addr().expect("bound");
    (engine, addr)
}

async fn pair(a: &Engine, b_addr: std::net::SocketAddr, b: &Engine) {
    let pending = a.sync.request_pairing(b_addr, "s1", "S").await.expect("pairing request");
    b.sync.approve_pairing("s1", &a.identity.device_id, "admin-b").expect("b approves a");
    a.sync.approve_pairing("s1", &pending.responder_device_id, "admin-a").expect("a approves b");
}

#[tokio::main]
async fn main() {
    let dir = std::env::temp_dir().join(format!("xv-replica-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let (node_a, _addr_a) = spawn_node(&dir.join("a"), "Lab PC A").await;
    let (node_b, addr_b) = spawn_node(&dir.join("b"), "Lab PC B").await;
    pair(&node_a, addr_b, &node_b).await;
    println!("[replica] paired");
    {
        let conn = node_a.db.lock();
        let trust: Vec<(String, String, String)> = conn
            .prepare("SELECT school_id, device_id, state FROM device_trust")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        println!("[replica] A trust: {trust:?}");
        println!("[replica] B id: {}", node_b.identity.device_id);
        let devices: Vec<(String, bool)> = conn
            .prepare("SELECT device_id, is_local FROM devices")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        println!("[replica] A devices: {devices:?}");
    }

    node_a.sync.local.create("s1", "school_settings", "config-1", Some(r#"{"term":"first"}"#), None, false, &[], None).expect("create op");
    let addr_book_a = node_a.peer_addr().unwrap();
    node_b.sync.enqueue_job("s1", &node_a.identity.device_id, JobKind::Pull, None).expect("enqueue");
    node_b.sync.record_peer_address(&node_a.identity.device_id, addr_book_a);

    for i in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let conn = node_b.db.lock();
        let objects: i64 = conn.query_row("SELECT COUNT(*) FROM sync_objects WHERE school_id='school-1' AND category='school_settings'", [], |r| r.get(0)).unwrap();
        let jobs = xamverse_storage::repos::JobsRepo::list(&conn, "s1", &[], 10).unwrap();
        drop(conn);
        println!("t={i} objects={objects} jobs={:?}", jobs.iter().map(|j| (j.status.as_str(), j.last_error.clone().unwrap_or_default())).collect::<Vec<_>>());
        if objects == 1 { println!("REPLICA SYNCED"); return; }
    }
    println!("REPLICA FAILED");
}
