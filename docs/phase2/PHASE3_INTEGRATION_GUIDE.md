# Phase 3 Integration Guide — from clone to packaged desktop app

This guide walks the Phase 3 team through every step of building the
educational application on top of the Phase 2 engine: running the engine,
initializing the database, authenticating, pairing peers, storing records,
syncing, subscribing to events, using the SDK, building business services,
persisting attempts, collecting results, enforcing permissions, serving the
frontend to browsers, activating licences and packaging the desktop app. It
maps the Phase 1 prototype mocks to their engine replacements (from
`CODEX_PHASE2_HANDOFF.md` §5) and states clearly what Phase 3 owns. Code
examples use real signatures; anything that does not exist yet is labelled.

---

## 0. What Phase 3 owns (and Phase 2 deliberately does not)

Phase 2 delivered the **desktop infrastructure engine**. Phase 3 builds the
**application**:

* question authoring UI, assessment workflows, approval/distribution UX,
  marking, analytics, public practice, role management UI, AI UX (Phase 1
  handoff §7);
* domain permissions beyond the engine's reserved namespace
  (`assessments.approve`, `results.release`, … — plain data, no engine
  change);
* per-category payload validators and the replication target policies ("who
  receives what") on top of `LocalOps::create`'s explicit target lists;
* the Tauri shell (`src-tauri/`) wiring commands + events to the SDK, the
  exam-active update interlock, backup scheduling, licence UX;
* the production frontend bundle served by the bridge (`BROWSER_ACCESS.md`)
  or the Tauri asset resolver.

The engine contract you build against: `ENGINE_API.md` (namespaces),
`SYNC_ENGINE.md` (flows), `CONFLICT_RESOLUTION.md` (policies),
`DATABASE.md` (where your data lives), `BROWSER_ACCESS.md` (browser mode).

## 1. Clone and run the engine

```bash
git clone https://github.com/Daniel130me/xamverse && cd xamverse
# NOTE: in the current checkout the engine work lives on `main`; the local
# `feat/desktopz` branch still points at the Phase 1 baseline (branch
# housekeeping is an orchestrator task — see PHASE2_COMPLETION_REPORT.md).
cargo test --workspace             # 76 unit tests must pass (TESTING.md)
cargo run -p xamverse-peer -- serve --port 47810 --name "Lab PC 01"
```

`xamverse-peer serve` runs the exact `Engine` the desktop shell runs: single-
instance lock (`engine.lock`), keystore → SQLCipher DB (`engine.xamdb`) →
migrations → device identity → job runner → peer server → optional mDNS.
Ctrl-C stops gracefully. `--no-mdns` for multicast-blocked networks (manual
peers remain fully functional).

## 2. Initialize the database (what `init` did for you)

`Engine::init(config)` performs, in order: data dir creation → exclusive
flock → `FileKeyStore` (key files directly in `data_dir`, `0600`) → 32-byte
database key (`database_key`) → `Database::open` (SQLCipher probe, WAL,
synchronous=NORMAL, foreign_keys ON) → migrations (version 1,
checksummed) → `DeviceIdentity::load_or_create` → subsystem construction →
`ensure_local_device` → `requeue_interrupted_jobs`. You rarely touch this;
from TypeScript it surfaces as `client.diagnostics()` (schema_version,
integrity, table counts).

```rust
// what the shell/CLI does — EngineConfig is the only knob surface
EngineConfig {
    data_dir, device_name,
    peer_port: 47810, browser_port: 47811, enable_mdns: true,
    trusted_issuer_pks, trusted_release_pks,   // production keys pinned here
    app_version,
}
```

## 3. Enroll a school and authenticate

```bash
xamverse-peer --data-dir ./data enroll-school --school-id s1 --name "Greenfield Academy" --user owner-1
```

`enroll_school` seeds the builtin roles (owner/admin/teacher/student with
their reserved-permission sets) and audits `school.enrolled`. Then create
real users (Phase 3 owns the UX; the engine primitive is `UsersRepo::upsert`
+ `grant_role` + `hash_password`, exposed through your user-management
service) and log in:

```ts
const { token, session } = await client.auth.login("s1", "d.ibrahim", pw, "desktop");
```

Notes: lockout is 5 failures / 15 min; unknown users and wrong passwords are
indistinguishable; sensitive operations demand `requireFresh` (5 min).

## 4. Pair peers (the two-human ritual)

```bash
# on B, after BOTH nodes enrolled the school (see TESTING.md demo + caveat):
xamverse-peer --data-dir ./data-b peer-pair 192.168.1.24:47810 --school-id s1 --school-name "Greenfield Academy"
# on A (stop serve first — one-shot commands need the engine lock):
xamverse-peer --data-dir ./data peer-approve --school-id s1 --device-id <B-device-id> --user owner-1
```

Or via the SDK (`client.peers.*`, `ENGINE_API.md` §5). Requirements the
pipeline enforces: the school must be enrolled on **both** nodes (trust rows
are tenant-scoped); approval requires `devices.pair`; fingerprints are
recomputed from verified cards, never trusted from the wire. Pairing
requests from unknown devices always land as `pending`, never `trusted`.

## 5. Store records and sync

Every replicated write is a signed op with explicit targets:

```ts
const op = await client.sync.createOp({
  schoolId: "s1", category: "question_bank", objectId: qid,
  payloadJson: JSON.stringify(question),      // ≤ 256 KiB inline; larger → blob
  targetDeviceIds: trustedPeerIds,            // replication policy is YOURS
});
// durable outbox picks it up within 500 ms; retries are automatic with backoff
await client.sync.jobs("s1", "queued");       // observe the queue
```

Pull (catch-up or collection) is manifest-diff based:
`client.sync.pull(peerId, "s1")` — idempotent, checkpointed, safe to re-run.
What "success" means: **receipts**, not bytes (`SYNC_ENGINE.md` §9).

## 6. Subscribe to events

```ts
const stop = client.events.subscribeSince(lastId, (e) => {
  switch (e.type) {
    case "transfer_progress":  /* update UI */ break;
    case "conflict.detected":  /* surface side-by-side */ break;
    case "security.alert":     /* quarantine banners */ break;
  }
});
```

Desktop: Tauri `emit` of the same typed events. Browser: SSE
(`/api/v1/events`, tenant-filtered). History replay covers UI reconnects
(1000-event buffer).

## 7. Use the SDK as the only boundary

Build business services against `createEngineClient()` only — never call
`invoke`/`fetch` directly (the Phase 1 pattern generalized):

```ts
// src/services/assessments.ts — mirrors the Phase 1 contract shape
export type AssessmentService = {
  saveAssessment(input: AssessmentInput): Promise<{ id: string; version: number }>;
  submitForApproval(id: string, targetDeviceId: string): Promise<SyncOp>;
  decide(requestId: string, decision: "approve" | "reject", note?: string): Promise<SyncOp>;
  distribute(id: string, targets: string[]): Promise<SyncOp>;   // immutable package op
};
```

Keep the compiler-checked contract discipline from Phase 1
(`service-contracts.ts`): every store action must appear in a contract; the
`MockClient` implements the same interface so the 19-case vitest suite keeps
passing during the swap (`CODEX_PHASE2_HANDOFF.md` acceptance rule).

## 8. Persist attempts (exam integrity is already engine-side)

```ts
const attempt = await client.attempts.startAttempt("s1", pkgId, studentRef);
await client.attempts.saveAnswer(attempt.attempt_id, "answer", { q: 7, a: "c" });
await client.attempts.saveAnswer(attempt.attempt_id, "flag",   { q: 2, on: true });
const op = await client.attempts.finalizeAttempt(
  attempt.attempt_id, await signChainHead(attempt.attempt_id), collectorIds);
```

Guarantees you inherit: every save is committed (hash-chained `seq`, `hash`);
finalize refuses a broken chain or a second finalize; the finalized envelope
(attempt + full event chain) replicates as one immutable `exam_attempt` op.
Auto-save freely — "saved" means durable.

## 9. Collect results (no hardcoded collectors)

Collection is a **pull** by anyone holding `sync.collect`, targeting any
reachable trusted peer:

```ts
await client.permissions.require(session, "sync.collect");
const summary = await client.sync.pull(peerId, "s1",
  ["exam_attempt", "submission", "result_set"]);   // RESULT_CATEGORIES
// collection receipts are recorded automatically, idempotent per collector
const done = await client.attempts.finalizedAttempts("s1");
```

The Phase 1 "collect with hash dedup" behaviour maps to receipt uniqueness +
op idempotency; duplicate deliveries return as `Duplicate`, never new rows.

## 10. Enforce permissions everywhere (engine-side)

Frontend checks are convenience; the engine refuses regardless:

* every privileged call goes through `Authz::require` — denial is audited
  (`authz.denied`) and returns `permission_denied`;
* permissions resolve from **live** role tables — revoking a role takes
  effect on the next check, no re-login;
* add domain permissions as data (`role_permissions` rows); only the 14
  reserved strings are engine-fixed (`SECURITY_MODEL.md` §3);
* browser surfaces get the same checks in the bridge
  (`with_session_permitted`).

## 11. Serve the frontend to browsers

```rust
// in the shell/CLI (WebConfig):
WebServer::serve(engine, WebConfig {
    bind: "0.0.0.0:47811".parse()?,
    allowed_origins: vec!["http://192.168.1.24:47811".into()],  // empty = same-origin
    frontend_dir: Some("frontend-dist".into()),                 // static bundle
}, shutdown_rx).await?;
```

Build the Next.js app as a static bundle into `frontend-dist`
(`BROWSER_ACCESS.md` documents the routes, cookies, headers and the TLS
plan; HTTP-only is the current known limitation). Users get the same UI at
`http://<node-ip>:47811` with session + RBAC enforced engine-side.

## 12. Licence the installation

```bash
xamverse-peer --data-dir ./data licence-request --out activation-request.json --school "Greenfield Academy"
license-issuer-dev generate-key --out issuer-key.json            # DEV keys only
license-issuer-dev issue --request activation-request.json --key issuer-key.json \
    --plan standard --days 365 --grace 30 --out licence.json
xamverse-peer --data-dir ./data licence-import --file licence.json
```

Pin the issuer **public** key in `EngineConfig.trusted_issuer_pks` for
production. UI maps to `client.licensing.*`; restricted mode keeps
`data.read / data.export / backup.create / backup.restore` alive at expiry
(`LICENSING.md`). Current CLI friction: the request-file wrapper mismatch
and the missing issuer-PK flag on `licence-import` — `KNOWN_LIMITATIONS.md`.

## 13. Package the desktop app (Tauri 2)

1. `src-tauri/` (independent package, excluded from the workspace): commands
   map 1:1 to engine namespaces (`ENGINE_API.md` §1); events forward
   `EventBus` → `emit`; wire `UpdateInterlocks` (exam-active check +
   backup-first) and the OS-keychain `SecureKeyStore` implementation.
2. Embed the frontend bundle via the Tauri asset resolver; the SDK's
   desktop adapter (`invoke("engine_<ns>_<op>")`) talks to those commands.
3. `tauri bundler` → `.msi` / `.dmg`; installer checklist (ACLs, firewall
   rules, TLS trust onboarding, key pinning) and the **required code-signing
   steps** are in `UPDATES_AND_INSTALLERS.md` §6–7 — not yet executed in
   this environment.

## 14. Phase 1 mock → engine mapping (handoff §5, verified against the code)

| Prototype mock | Engine replacement | Where |
|---|---|---|
| `tick()` transfer engine (progress increments) | durable outbox + job runner + real Noise transport; progress via `sync.progress` events | `sync_jobs`, `runner.rs`, `engine.rs` |
| `buildWorld()` seeded localStorage world | real DB + onboarding: `enroll_school` + your user/academic services | `xamverse-storage`, Phase 3 |
| localStorage persistence (`examhub-demo-v1`) | SQLCipher `engine.xamdb` + keystore | `xamverse-storage` |
| demo login selector / password acceptance | Argon2id auth, hashed sessions, lockout | `xamverse-security` |
| licence simulation (buttons flip states) | signed certificates + state machine | `xamverse-licensing` |
| update package simulation | signed manifest pipeline + interlocks | `xamverse-updater` |
| AI generation with predefined outputs | **Phase 3** (cloud provider + local model hook) — no engine primitive | — |
| Device Simulator (device/user/network switching) | **keep as demo tool**, gate behind a build flag; multi-node behaviour is real via `xamverse-peer` nodes | — |

Also mapping the §5 acceptance rule: an engine implementation satisfying
`service-contracts.ts` + the vitest suite is drop-in compatible — that suite
(19 tests) is the acceptance gate to keep green while you swap.
