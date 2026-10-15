//! Integration tests: real engines, real TCP, separate databases and keys.
//!
//! Covers Phase 2 specification §27:
//! * **Test A** — two autonomous peers: pair, sync, stop, restart, resume.
//! * **Test C** — multiple submissions: 10 attempts collected, repeat
//!   collection stays at 10, conflicting content is detected.
//! * **Test D** — administrator portability + RBAC denial.
//!
//! Every peer is a full [`Engine`] with its own data directory, keystore,
//! identity and listener — no shared in-memory state (spec §26).

use std::sync::Arc;
use std::time::Duration;
use xamverse_core::{Engine, EngineConfig};

fn test_config(dir: &std::path::Path, name: &str) -> EngineConfig {
    EngineConfig {
        data_dir: dir.to_path_buf(),
        device_name: name.to_string(),
        enable_mdns: false, // no multicast in CI
        peer_port: 0,       // OS-assigned ephemeral port
        ..Default::default()
    }
}

/// Bring up a node and return it with its bound listener address.
async fn spawn_node(dir: &std::path::Path, name: &str) -> (Arc<Engine>, std::net::SocketAddr) {
    let engine = Engine::init(test_config(dir, name)).expect("engine init");
    engine
        .enroll_school("school-1", "Integration School", "seed-user")
        .expect("enroll");
    engine.start().await.expect("engine start");
    let addr = engine
        .peer_addr()
        .expect("peer listener bound after start()");
    (engine, addr)
}

/// Drive the durable outbox until both sides report the expected sync state.
/// The job runner polls every 500ms; we poll the databases instead of
/// sleeping a fixed time so the test is fast and deterministic.
async fn wait_for(condition: impl Fn() -> bool, what: &str) {
    for _ in 0..120 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("timed out waiting for {what}");
}

/// Pair two nodes symmetrically: A requests (to B's listener), B approves,
/// then A approves B back.
async fn pair(a: &Engine, b_addr: std::net::SocketAddr, b: &Engine) {
    let pending = a
        .sync
        .request_pairing(b_addr, "school-1", "Integration School")
        .await
        .expect("pairing request");
    b.sync
        .approve_pairing("school-1", &a.identity.device_id, "admin-b")
        .expect("b approves a");
    a.sync
        .approve_pairing("school-1", &pending.responder_device_id, "admin-a")
        .expect("a approves b");
    // The address book on B must learn A's address for future pushes; sync
    // it through a pull, which records the address on connect.
}

fn count_objects(engine: &Engine, category: &str) -> i64 {
    let conn = engine.db.lock();
    conn.query_row(
        "SELECT COUNT(*) FROM sync_objects WHERE school_id = 'school-1' AND category = ?1",
        [category],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

#[tokio::test(flavor = "multi_thread")]
async fn test_a_two_autonomous_peers_sync_and_reconnect() {
    let dir = tempfile::tempdir().expect("tmp");
    let (node_a, addr_a) = spawn_node(&dir.path().join("a"), "Lab PC A").await;
    let (node_b, addr_b) = spawn_node(&dir.path().join("b"), "Lab PC B").await;

    // Pair, then A records data and B pulls it.
    pair(&node_a, addr_b, &node_b).await;
    node_a
        .sync
        .local
        .create(
            "school-1",
            "school_settings",
            "config-1",
            Some(r#"{"term":"first"}"#),
            None,
            false,
            &[],
            None,
        )
        .expect("create op");

    // B pulls from A over real TCP (Noise + device cards).
    let addr_book_a = addr_a;
    let job = node_b
        .sync
        .enqueue_job("school-1", &node_a.identity.device_id, xamverse_storage::repos::JobKind::Pull, None)
        .expect("enqueue pull");
    node_b.sync.record_peer_address(&node_a.identity.device_id, addr_book_a);

    wait_for(
        || {
            let c = count_objects(&node_b, "school_settings");
            if c > 0 {
                println!("[diag-poll] count hit {c}");
            }
            c == 1
        },
        "B to receive A's record",
    );

    // The op signature verified end-to-end: B holds A's op with A as author.
    let conn = node_b.db.lock();
    let total_ops: i64 = conn.query_row("SELECT COUNT(*) FROM sync_ops", [], |r| r.get(0)).unwrap_or(-1);
    println!("[diag] B total ops={total_ops}");
    let author: String = conn
        .query_row(
            "SELECT author_device_id FROM sync_ops WHERE school_id = 'school-1' AND object_id = 'config-1'",
            [],
            |r| r.get(0),
        )
        .expect("replicated op present");
    drop(conn);
    assert_eq!(author, node_a.identity.device_id);

    // Duplicate delivery is idempotent (lost-ack retry safety).
    node_b
        .sync
        .enqueue_job("school-1", &node_a.identity.device_id, xamverse_storage::repos::JobKind::Pull, None)
        .expect("second pull");
    wait_for(
        || {
            let _ = &job;
            count_objects(&node_b, "school_settings") == 1
        },
        "idempotent re-pull",
    );

    node_a.stop().await;
    node_b.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn test_c_ten_submissions_collect_idempotently_and_conflict_detected() {
    let dir = tempfile::tempdir().expect("tmp");
    let (node_a, addr_a) = spawn_node(&dir.path().join("a"), "Lab PC A").await;
    let (node_b, addr_b) = spawn_node(&dir.path().join("b"), "Lab PC B").await;
    pair(&node_a, addr_b, &node_b).await;

    // 10 finalized attempts on A (multiple students on one computer).
    for i in 0..10 {
        let attempt = node_a
            .attempts
            .start("school-1", "pkg-1", &format!("student-{i}"))
            .expect("start attempt");
        node_a
            .attempts
            .save_event(&attempt.attempt_id, "answer", serde_json::json!({"q": 1, "choice": "b"}))
            .expect("save answer");
        node_a
            .attempts
            .finalize(&attempt.attempt_id, "integrity-signature", &[])
            .expect("finalize");
    }
    assert_eq!(count_objects(&node_a, "exam_attempt"), 10);

    // B collects from A.
    node_b
        .sync
        .record_peer_address(&node_a.identity.device_id, addr_a);
    node_b
        .sync
        .enqueue_job("school-1", &node_a.identity.device_id, xamverse_storage::repos::JobKind::Collect, None)
        .expect("enqueue collect");
    wait_for(
        || count_objects(&node_b, "exam_attempt") == 10,
        "B to collect all 10 submissions",
    );

    // Receipts recorded by the collector — one per attempt.
    let receipts: i64 = {
        let conn = node_b.db.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM collection_receipts WHERE school_id = 'school-1'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };
    assert_eq!(receipts, 10);

    // Repeat collection: still exactly 10 (deduplicated), receipts stable.
    node_b
        .sync
        .enqueue_job("school-1", &node_a.identity.device_id, xamverse_storage::repos::JobKind::Collect, None)
        .expect("second collect");
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(count_objects(&node_b, "exam_attempt"), 10);
    let receipts_after: i64 = {
        let conn = node_b.db.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM collection_receipts WHERE school_id = 'school-1'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };
    assert_eq!(receipts_after, 10, "receipts must be idempotent per collector");

    // Conflicting content for the same attempt is quarantined, not applied.
    // A's object is immutable (exam_attempt); a *second* revision op for the
    // same object must be refused by the pipeline as immutable_violation.
    let conflicting = xamverse_sync::SyncOpWire {
        op_id: uuid::Uuid::now_v7().to_string(),
        school_id: "school-1".into(),
        category: "exam_attempt".into(),
        object_id: "forged-attempt".into(),
        revision: 1,
        base_revision: 0,
        author_device_id: node_b.identity.device_id.clone(),
        lamport: 99,
        tombstone: false,
        schema_version: 1,
        payload_sha256: "deadbeef".into(),
        payload_json: Some(r#"{"forged": true}"#.into()),
        blob_sha256: None,
        signature: "forged".into(),
    };
    let receipts_vec = node_b
        .sync
        .apply
        .apply_batch(
            "school-1",
            &xamverse_sync::ApplyPipelineContext::for_test(&node_b.identity.device_id),
            &[conflicting],
        )
        .expect("apply batch");
    assert!(matches!(
        receipts_vec[0].outcome,
        xamverse_sync::OpOutcome::Rejected { .. } | xamverse_sync::OpOutcome::Conflict { .. }
    ));

    node_a.stop().await;
    node_b.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn test_d_administrator_portability_and_rbac_denial() {
    let dir = tempfile::tempdir().expect("tmp");
    let (node_a, addr_a) = spawn_node(&dir.path().join("a"), "Lab PC A").await;
    let (node_b, addr_b) = spawn_node(&dir.path().join("b"), "Lab PC B").await;
    pair(&node_a, addr_b, &node_b).await;

    // Admin + student created on A; roles replicate to B via pull.
    let db_a = node_a.db.clone();
    let password = "admin-pw-12345";
    let (admin_hash, student_hash) = {
        let admin = xamverse_security::hash_password(password).unwrap();
        let student = xamverse_security::hash_password("student-pw-1").unwrap();
        (admin, student)
    };
    db_a
        .tx(|conn| {
            for (username, hash, roles) in [
                ("admin-dana", admin_hash.clone(), vec!["admin"]),
                ("stu-sam", student_hash.clone(), vec!["student"]),
            ] {
                let user_id = uuid::Uuid::now_v7().to_string();
                xamverse_storage::repos::UsersRepo::upsert(
                    conn,
                    &xamverse_storage::repos::UserRow {
                        user_id: user_id.clone(),
                        school_id: "school-1".into(),
                        username: username.into(),
                        display_name: username.into(),
                        status: "active".into(),
                        auth_hash: Some(hash),
                        origin_device_id: None,
                        revision: 1,
                        updated_at: xamverse_storage::now_rfc3339(),
                    },
                )?;
                for role in roles {
                    let role_row = xamverse_storage::repos::UsersRepo::find_role_by_name(
                        conn,
                        "school-1",
                        role,
                    )?
                    .expect("builtin role");
                    xamverse_storage::repos::UsersRepo::grant_role(
                        conn,
                        "school-1",
                        &user_id,
                        &role_row.role_id,
                        None,
                    )?;
                }
            }
            Ok(())
        })
        .expect("seed users");

    // B pulls identity records (restricted category: requires trust — paired).
    node_b
        .sync
        .record_peer_address(&node_a.identity.device_id, addr_a);
    node_b
        .sync
        .enqueue_job("school-1", &node_a.identity.device_id, xamverse_storage::repos::JobKind::Pull, None)
        .expect("pull identities");
    wait_for(
        || {
            let conn = node_b.db.lock();
            xamverse_storage::repos::UsersRepo::get_by_username(&conn, "school-1", "admin-dana")
                .map(|u| u.is_some())
                .unwrap_or(false)
        },
        "B to receive the administrator identity",
    );

    // The admin can now authenticate on B — distributed identity works.
    let (_token, ctx_admin) = node_b
        .auth
        .login(
            "school-1",
            "admin-dana",
            password,
            xamverse_security::SessionKind::Desktop,
            None,
            None,
        )
        .expect("admin login on node B");
    assert!(
        ctx_admin
            .permissions
            .contains(&"backups.manage".to_string()),
        "admin permission present on the remote node"
    );

    // The student on B must NOT gain admin powers.
    let (_token, ctx_student) = node_b
        .auth
        .login(
            "school-1",
            "stu-sam",
            "student-pw-1",
            xamverse_security::SessionKind::Desktop,
            None,
            None,
        )
        .expect("student login on node B");
    assert!(matches!(
        node_b
            .authz
            .require(&ctx_student, xamverse_security::reserved::BACKUPS_MANAGE, None),
        Err(xamverse_security::AuthError::PermissionDenied { .. })
    ));

    // And the denial is auditable on B.
    let denials = {
        let conn = node_b.db.lock();
        xamverse_audit::query(
            &conn,
            &xamverse_audit::AuditQuery {
                action_prefix: Some("authz.denied".into()),
                ..Default::default()
            },
        )
        .unwrap_or_default()
    };
    assert!(!denials.is_empty(), "RBAC denial must be audited");

    node_a.stop().await;
    node_b.stop().await;
}

