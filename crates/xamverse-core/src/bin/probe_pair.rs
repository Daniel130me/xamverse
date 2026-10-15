use std::sync::Arc;
use xamverse_core::{Engine, EngineConfig};

#[tokio::main]
async fn main() {
    let dir = std::env::temp_dir().join(format!("xv-pair2-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let a = Engine::init(EngineConfig { data_dir: dir.join("a"), device_name: "A".into(), enable_mdns: false, peer_port: 0, ..Default::default() }).unwrap();
    a.enroll_school("school-1", "S", "seed").unwrap();
    let b = Engine::init(EngineConfig { data_dir: dir.join("b"), device_name: "B".into(), enable_mdns: false, peer_port: 0, ..Default::default() }).unwrap();
    b.enroll_school("school-1", "S", "seed").unwrap();
    let (a, b) = (Arc::new(a), Arc::new(b));
    a.start().await.unwrap();
    b.start().await.unwrap();
    let b_addr = b.peer_addr().unwrap();
    println!("B at {b_addr}");

    // Exactly like the failing test: A requests pairing FROM B.
    let pending = a.sync.request_pairing(b_addr, "school-1", "S").await;
    match &pending {
        Ok(p) => println!("pending responder={}", p.responder_device_id),
        Err(e) => println!("request failed: {e}"),
    }
    {
        let conn = b.db.lock();
        let rows: Vec<String> = conn
            .prepare("SELECT device_id FROM devices WHERE is_local = 0")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        println!("B remote devices: {rows:?}");
        println!("A device id: {}", a.identity.device_id);
    }
    let res = b.sync.approve_pairing("school-1", &a.identity.device_id, "admin-b");
    println!("b approves a: {:?}", res.map(|_| "ok").map_err(|e| e.to_string()));
}
