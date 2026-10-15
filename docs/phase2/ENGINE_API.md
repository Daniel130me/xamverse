# Engine API — the TypeScript-facing contract for Phase 3

This document is the complete TypeScript-facing API of the XamVerse engine:
the `EngineClient` namespaces (`auth`, `permissions`, `peers`, `sync`,
`conflicts`, `packages`, `attempts`, `licensing`, `updates`, `backups`,
`audit`, `diagnostics`, `events`), the three adapters (desktop IPC via Tauri
invoke, browser HTTP/SSE against `http://<ip>:47811`, and an in-memory mock),
error shapes, and the protocol version. Request/response examples are JSON
shapes derived from the real Rust serde types (cited per namespace). The
`@xamverse/engine-sdk` package implements this contract; its Tauri adapter
requires the `src-tauri` shell (being built separately — the contract here
is what that shell must expose, command-for-command).

---

## 1. Adapters

```ts
// one EngineClient, three transports — identical call signatures
type EngineClient =
  | DesktopIpcClient   // Tauri 2 webview: invoke("engine_<namespace>_<op>", args)
  | BrowserHttpClient  // LAN browser: fetch("http://<ip>:47811/api/v1/…") + SSE
  | MockClient;        // in-memory fake for vitest/storybook (mirrors Phase 1 store)
```

| Adapter | Transport | Availability |
|---|---|---|
| `desktop` | `@tauri-apps/api` `invoke` — one Tauri command per namespace/op, 1:1 with engine subsystems (`ENGINE_API` ↔ `src-tauri/src/commands`) | full surface |
| `browser` | HTTP + SSE to the `xamverse-web` bridge on port **47811** | the bridge routes only (§10) — auth, me, events, diagnostics, sync queue; everything else stays desktop |
| `mock` | in-memory implementation of this contract | used by the Phase 1 vitest suite and storybook |

Rule from `ARCHITECTURE.md`: the UI depends only on this client, never on
`invoke` or `fetch` directly, so screens run unchanged on all three.

Protocol version: engines advertise `PROTOCOL_VERSION_MAJOR = 1`,
`MINOR = 0` (from `xamverse-identity`). The SDK sends `v: 1` in every peer
conversation and refuses majors other than `1`. Minor bumps are additive.

## 2. Error shapes

Rust errors are serde-serializable discriminated unions. The canonical JSON
error on every adapter:

```json
{ "error": {
    "code": "permission_denied",        // stable machine code
    "permission": "sync.collect",       // present for permission_denied
    "message": "permission denied: sync.collect" } }
```

Code catalogue (from the real error enums — `AuthError`, `SyncError`,
`StorageError`, `LicenceError`, `BackupError`, `UpdateError`, `EngineError`):

| Code | Source | Meaning |
|---|---|---|
| `invalid_credentials` | auth | deliberately generic — no user enumeration |
| `account_suspended` / `locked_out` / `session_locked` / `session_invalid` / `reauthentication_required` | auth | session lifecycle |
| `permission_denied` | authz | RBAC refusal (denial audited engine-side) |
| `not_found` / `invalid_value` / `already_exists` / `constraint` | storage | repo-level failures |
| `schema_too_new` / `migration_checksum_drift` / `database_unreadable` | storage | migration/encryption gates |
| `no_address` / `peer_error` / `channel_*` / `network` | sync/network | connectivity + structured peer errors (`code`,`detail` carried) |
| `blob_hash_mismatch` | sync | content-addressed transfer failure |
| `device_mismatch` / `not_yet_valid` / `expired` / `invalid` | licensing | licence verification |
| `bad_magic` / `authentication_failed` / `content_hash_mismatch` / `integrity_check_failed` / `format_too_new` | backup | archive layers |
| `platform_mismatch` / `downgrade_refused` / `schema_incompatible` / `hash_mismatch` / `interlock_blocked` | updater | update gates |
| `already_running` | core | single-instance lock |

Browser-adapter note: the web bridge serializes errors as
`{ "error": "<message>" }` with the HTTP status carrying the class
(401/403/422/429/500); the SDK normalizes both shapes to the catalogue above.

## 3. `client.auth`

Backed by `xamverse-security::AuthService` (§3 params in
`SECURITY_MODEL.md`). Tokens are shown **once**; the SDK keeps them in
memory (desktop) or lets the cookie do the work (browser).

```ts
login(schoolId: string, username: string, password: string, kind: "desktop" | "browser")
  → { token: string, session: Session }
authenticate(token: string)                       → Session
logout(token: string)                             → { ok: true }
lockSession(token: string)                        → { ok: true }
unlockSession(token: string, password: string)    → Session
changePassword(schoolId: string, userId: string, old: string | null, next: string)
  → { revision: number }        // revokes all of the user's sessions on this node
revokeAllForUser(schoolId: string, userId: string, reason: string)
  → { revoked: number }
requireFresh(session: Session)                    → void   // throws reauthentication_required

// Session (serde shape of SessionContext)
// { "token_hash": "…", "user_id": "…", "school_id": "…", "kind": "desktop",
//   "created_at": "RFC3339", "expires_at": "RFC3339", "locked": false,
//   "permissions": ["sync.read", "sync.write"] }
```

Login request/response (browser route `POST /api/v1/auth/login`):

```json
// request
{ "school_id": "s1", "username": "d.ibrahim", "password": "••••••••" }
// response (desktop adapter returns the token; browser sets the cookie)
{ "ok": true }
// failure → 401 { "error": "invalid credentials" }  |  429 { "error": "try again later" }
```

## 4. `client.permissions`

Backed by `Authz` + `UsersRepo` (live role tables — revocation applies on
the next check, no restart).

```ts
can(session: Session, permission: string)                  → boolean
require(session: Session, permission: string, target?: string)  → void  // throws permission_denied
listReserved()  → string[]   // the 14 engine-reserved permissions
listBuiltinRoles(schoolId: string) → RoleRow[]   // owner/admin/teacher/student + custom
grantRole(schoolId, userId, roleId, grantedBy) / revokeRole(...)
effectivePermissions(schoolId: string, userId: string) → string[]
```

Reserved namespace (engine-enforced; everything else is school data):
`devices.pair`, `devices.revoke`, `sync.read`, `sync.write`,
`sync.distribute`, `sync.collect`, `sync.resolve_conflict`, `licence.manage`,
`updates.manage`, `backups.manage`, `audit.view`, `identity.manage`,
`sessions.revoke`, `users.manage`.

## 5. `client.peers`

Backed by `SyncEngine` (pairing, trust) + `Discovery` + `ManualPeers`.

```ts
status()                                  → EngineStatus["schools"]  // trusted_peers per school
scan()                                    → PeerAdvertisement[]      // mDNS, when enabled
addManualPeer(ip: string, port?: number)  → PeerAdvertisement        // kv-persisted
listManualPeers()                         → PeerAdvertisement[]
requestPairing(addr: string, schoolId: string, schoolName: string) → PairPending
approvePairing(schoolId: string, deviceId: string, approvedBy: string) → { ok: true }
revokeDevice(schoolId: string, deviceId: string, revokedBy: string, reason: string) → { ok: true }
listPeers(schoolId: string) → { device_id: string, state: "pending" | "trusted"
                               | "revoked" | "blocked" }[]
fingerprint()                             → string   // this device's XV-XXXX-…
pingPeer(addr: string)                    → { rtt_ms: number, device_id: string }
```

```json
// PeerAdvertisement (mDNS TXT: di/nm/fp/pv)
{ "device_id": "018f…", "name": "Lab PC 07", "fingerprint": "XV-7KQ2M-B4RTF-W9XJ2-P3DNC",
  "protocol_major": 1, "port": 47810, "addresses": ["192.168.1.24"] }
// PairPending
{ "responder_device_id": "018e…", "responder_name": "Lab-A",
  "responder_fingerprint": "XV-BS42-5CI4-45HD-H6FJ" }
```

Pairing is the two-human ritual: the UI shows both fingerprints; approval
requires `devices.pair`; revocation requires `devices.revoke` (both audited).

## 6. `client.sync`

Backed by `LocalOps`, `JobsRepo`, `ApplyPipeline`, `pull_from`.

```ts
// Local write — creates the signed op + durable outbox jobs in one transaction
createOp(args: {
  schoolId: string; category: string; objectId: string;
  payloadJson?: string; blobSha256?: string; tombstone?: boolean;
  targetDeviceIds: string[]; expectedBaseRevision?: number;
}) → SyncOp   // full signed wire op; revision assigned by CAS

objects(schoolId: string, category?: string, limit?: number) → ObjectRow[]
jobs(schoolId: string, status?: JobStatus, limit?: number)   → JobRow[]
retryJob(jobId: string) / cancelJob(jobId: string)           → { ok: true }
pull(peerDeviceId: string, schoolId: string, categories?: string[]) → PullSummary
// PullSummary = { "applied": n, "duplicates": n, "conflicts": n }
```

```json
// SyncOp (SyncOpWire — canonical signed shape; the SDK never mutates it)
{ "op_id": "018f6a…", "school_id": "s1", "category": "question_bank",
  "object_id": "q-17", "revision": 3, "base_revision": 2,
  "author_device_id": "018e…", "lamport": 4211, "tombstone": false,
  "schema_version": 1, "payload_sha256": "9f2c…",
  "payload_json": "{\"stem\":\"…\"}",
  "signature": "dW5zaWduZWQ…" }
// JobRow
{ "job_id": "018f…", "school_id": "s1", "target_device_id": "018e…",
  "op_id": "018f6a…", "kind": "push_op", "status": "queued",
  "attempts": 0, "next_attempt_at": "RFC3339", "last_error": null,
  "created_at": "RFC3339", "updated_at": "RFC3339" }
```

Categories are the registry in `SYNC_ENGINE.md` §1; unknown categories are
refused locally (`invalid_value`) rather than sent.

## 7. `client.conflicts`

Backed by `ConflictService` (§4 of `CONFLICT_RESOLUTION.md`).

```ts
list(schoolId: string, status?: "open" | "resolved" | "deferred") → ConflictRow[]
get(conflictId: string)   → ConflictRow
resolve(conflictId: string, resolution: "accept_incoming" | "keep_local",
        resolvedBy: string, note?: string) → { outcome: OpOutcome }
defer(conflictId: string) → { ok: true }
objectState(schoolId, category, objectId) → ObjectRow | null
```

```json
// ConflictRow — incoming_payload_json feeds the side-by-side view
{ "conflict_id": "018f…", "school_id": "s1", "category": "question_bank",
  "object_id": "q-17", "kind": "concurrent_update",
  "incoming_op_id": "018f…", "local_op_id": "018e…",
  "incoming_payload_json": "{\"stem\":\"incoming\"}",
  "strategy": "manual", "status": "open",
  "resolution": null, "resolved_by": null,
  "detected_at": "RFC3339", "resolved_at": null }
```

## 8. `client.packages` and `client.attempts`

Backed by `PackageStore` / `AttemptStore` (`xamverse-sync::store`).

```ts
// packages
importPackage(manifest: PackageManifest, contentJson: string,
              approvedSignature: string | null, targetDeviceIds: string[]) → SyncOp
studentView(schoolId: string, packageId: string)  → unknown  // protected_fields stripped
fullView(schoolId: string, packageId: string)     → unknown  // REQUIRES an engine-side
                                                  // permission check by the caller
contentHash(schoolId: string, packageId: string)  → string

// PackageManifest
// { "package_id": "…", "school_id": "s1", "assessment_id": "…", "version": 1,
//   "schema_version": 1, "protected_fields": ["/answer_key", "/questions/1/marking"],
//   "approved_by": "admin-1" }

// attempts
startAttempt(schoolId: string, packageId: string, studentRef: string) → AttemptRow
saveAnswer(attemptId: string, kind: string, payload: unknown)
  → { seq: number, hash: string }        // hash-chained; "saved" == committed
finalizeAttempt(attemptId: string, integritySignature: string,
                targetDeviceIds: string[]) → SyncOp   // immutable exam_attempt op
getAttempt(attemptId: string) → AttemptRow
finalizedAttempts(schoolId: string) → AttemptRow[]
```

```json
// AttemptRow
{ "attempt_id": "018f…", "school_id": "s1", "package_id": "pkg-1",
  "student_ref": "student-42", "status": "in_progress", "device_id": "018e…",
  "started_at": "RFC3339", "finalized_at": null,
  "finalize_signature": null, "latest_chain_hash": "…" }
```

Guard rails the SDK enforces client-side (engine still the boundary):
`fullView` refuses unless the session holds a marking permission; student
surfaces only ever call `studentView`.

## 9. `client.licensing`, `client.updates`, `client.backups`

```ts
// licensing (LicenceService)
activationRequest(schoolHint: string)           → ActivationRequest   // save to file
importActivation(certJson: string)              → LicenceStatus       // verifies + persists
licenceStatus()                                 → LicenceStatus       // computed, never cached
entitlements()                                  → string[]
featureAvailable(feature: string)               → boolean
displaySummary() → { licence_id, plan, status, expires_at, device_limit,
                     product_key_masked } | null
markRevoked(reason: string)                     → { ok: true }

// updates (UpdaterService)
importUpdate(manifestJson: string, artifact: Uint8Array) → { updateId: string }
stageUpdate(updateId: string)   → { path: string }   // interlocks run first
markUpdateApplied(updateId: string) / markUpdateRejected(updateId: string, reason: string)
updateHistory(limit: number)    → UpdateStateRow[]   // imported→verified→staged→applied

// backups (BackupService)
createBackup(passphrase: string, kind: "full", schoolScope?: null) → { path: string }
verifyBackup(path: string, passphrase: string) → ArchiveHeader
restoreBackup(path: string, passphrase: string, databaseKeyHex: string,
              targetDir: string) → { path: string }   // recovery-key procedure
listBackups() → BackupRow[]
pruneBackups(keep: number) → { pruned: number }
```

## 10. `client.audit`, `client.diagnostics`, `client.events`

```ts
// audit (hash-chained; writes are engine-internal)
query(filter: { schoolId?: string; actorUser?: string;
                actionPrefix?: string; limit?: number }) → AuditRow[]
verifyChain() → boolean      // recompute the whole chain

// AuditRow
// { "seq": 42, "event_id": "018f…", "school_id": "s1", "actor_user": "…",
//   "actor_device": "…", "action": "devices.paired", "target": "018e…",
//   "detail_json": "…", "at": "RFC3339" }

// diagnostics (Engine::status())
diagnostics() → EngineStatus
// { device_id, device_name, fingerprint, platform, app_version, data_dir,
//   schema_version, integrity: "ok", peer_port, mdns_enabled, licence_status,
//   schools: [{ school_id, name, users, trusted_peers }],
//   tables: [{ table, rows }], sync_queue: { queued, failed, completed },
//   recent_events: ["sync.completed", …] }

// events (EventBus; desktop: Tauri emit; browser: SSE /api/v1/events)
subscribe(onEvent: (e: EngineEvent) => void): () => void          // live only
subscribeSince(lastEventId: string, onEvent: (e: EngineEvent) => void): () => void
recent(limit: number) → EngineEvent[]
```

Event JSON shape (`{ type, data }` tagged union + context):

```json
{ "id": "018f…", "at": "2026-10-15T17:00:00Z",
  "school_id": "s1", "device_id": "018e…",
  "type": "transfer_progress", "data": { "job_id": "018f…", "done": 262144, "total": 1048576 } }
```

Kind catalogue (stable `kind_name` strings): `peer.discovered`,
`peer.connected`, `peer.disconnected`, `device.paired`, `device.revoked`,
`sync.requested`, `sync.started`, `sync.progress`, `sync.paused`,
`sync.resumed`, `sync.completed`, `sync.failed`, `conflict.detected`,
`conflict.resolved`, `package.received`, `submission.received`,
`collection.progress`, `licence.status_changed`, `update.available`,
`update.applied`, `backup.completed`, `security.alert`, `job.status_changed`.

## 11. Browser adapter surface (exact, current build)

The browser adapter is **complete for these routes only** (`xamverse-web`),
and the SDK maps them to the same namespace calls:

| SDK call | HTTP |
|---|---|
| `auth.login` | `POST /api/v1/auth/login` (cookie session) |
| `auth.logout` | `POST /api/v1/auth/logout` |
| `auth.authenticate` | `GET /api/v1/me` |
| `events.subscribe` | `GET /api/v1/events` (SSE, tenant-filtered) |
| `diagnostics()` | `GET /api/v1/diagnostics` (requires `audit.view`) |
| `sync.jobs` | `GET /api/v1/sync/queue` (requires `sync.read`) |
| — | `GET /healthz` |

Everything else throws `unsupported_on_browser_adapter` — a browser must not
gain peer/keystore powers (`BROWSER_ACCESS.md` §7).

## 12. Phase 3 working examples

### 12.1 Login and bootstrap

```ts
import { createEngineClient } from "@xamverse/engine-sdk";

const client = createEngineClient();          // picks desktop | browser | mock
const { token, session } = await client.auth.login("s1", "d.ibrahim", process.env.PW!, "desktop");
await client.permissions.require(session, "sync.write");        // audited if denied
console.log(session.permissions, await client.diagnostics().then(d => d.licence_status));
```

### 12.2 Scan and pair a peer

```ts
const ads = (await client.peers.scan())
  .concat(await client.peers.listManualPeers());                // manual fallback first-class
const target = ads.find(a => a.fingerprint === "XV-BS42-5CI4-45HD-H6FJ");
const pending = await client.peers.requestPairing(
  `${target!.addresses[0]}:${target!.port}`, "s1", "Greenfield Academy");
// … operator compares fingerprints on BOTH screens, then approves (devices.pair):
await client.peers.approvePairing("s1", pending.responder_device_id, session.user_id);
```

### 12.3 Push an assessment package (approve → distribute)

```ts
const content = JSON.stringify(assessment);     // sealed upstream by the approval flow
const op = await client.packages.importPackage(
  { package_id: pkgId, school_id: "s1", assessment_id: assess.id, version: 1,
    schema_version: 1,
    protected_fields: ["/answer_key", ...questionMarkingPointers],
    approved_by: approverId },
  content, approvalSignature, trustedPeerIds);  // immutable op + outbox jobs

// progress arrives as events — no polling:
client.events.subscribe((e) => {
  if (e.type === "transfer_progress") render(e.data);
  if (e.type === "package.received") toast(`${e.data.package_id} arrived on ${e.device_id}`);
  if (e.type === "sync.failed") retryOrEscalate(e.data);
});
```

### 12.4 Exam day: attempt → finalize → collect results

```ts
// On the lab device (student session):
const attempt = await client.attempts.startAttempt("s1", pkgId, studentRef);
await client.attempts.saveAnswer(attempt.attempt_id, "answer", { q: 1, a: "b" });
await client.attempts.saveAnswer(attempt.attempt_id, "flag", { q: 3, on: true });
const op = await client.attempts.finalizeAttempt(          // hash chain verified, then
  attempt.attempt_id, deviceIntegritySignature, collectorIds);  // immutable op + push jobs

// On any authorized collector (sync.collect):
const summary = await client.sync.pull(peerDeviceId, "s1", ["exam_attempt", "submission", "result_set"]);
const receipts = await client.audit.query({ actionPrefix: "attempts.", schoolId: "s1", limit: 100 });
// collection receipts are durable per (attempt_id, collector_device_id) — idempotent re-collect
```

### 12.5 Subscribe with reconnect recovery

```ts
let lastId = localStorage.getItem("xv_last_event") ?? "";
const stop = client.events.subscribeSince(lastId, (e) => {   // replays missed events first
  lastId = e.id; localStorage.setItem("xv_last_event", lastId);
  route(e);                                                  // switch on e.type
});
```
