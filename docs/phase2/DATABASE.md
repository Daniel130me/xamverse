# Database — SQLCipher storage, schema and persistence guarantees

This document describes the engine's single encrypted SQLite database: what
tables exist (schema version 1, read from
`crates/xamverse-storage/src/migrations.rs`), how SQLCipher encryption is
applied, the migration strategy (transactional, checksum-verified,
forward-only), how tenant isolation is enforced (ADR-0002), the durability
trade-offs of WAL + `synchronous=NORMAL`, and the role of the sync metadata
tables in replication. It is the reference for anyone writing a query,
reviewing a migration or reasoning about crash safety.

---

## 1. One database per installation

Every XamVerse installation (desktop app or headless `xamverse-peer` node)
owns exactly one database file, `engine.xamdb`, inside its data directory,
opened through `Database::open(path, &key)`:

```rust
// crates/xamverse-storage/src/lib.rs
pub fn open(path: impl Into<PathBuf>, key: &DatabaseKey)
    -> StorageResult<(Self, MigrationReport)>
```

The same struct serves both hosts of the engine. There is no server process,
no shared cluster database and no "master copy": each node's database is the
authoritative store for the data that node holds, and replication (see
`SYNC_ENGINE.md`) reconciles nodes. This is ADR-0001's crate decomposition
applied to storage: `xamverse-storage` is the only crate allowed to execute
SQL; every other crate goes through its repositories.

Concurrency model: one writer connection behind a `Mutex`. WAL mode serves
readers well, but engine write volume (sync apply, sessions, audit) is
modest; a single serialized writer removes all `SQLITE_BUSY` reasoning from
callers. Batch writes go through `Database::tx`, which wraps a closure in an
IMMEDIATE transaction and rolls back on `Err`:

```rust
pub fn tx<T>(&self, f: impl FnOnce(&Connection) -> StorageResult<T>) -> StorageResult<T>
```

## 2. Encryption (SQLCipher)

SQLCipher is compiled in via rusqlite's `bundled-sqlcipher-vendored-openssl`
feature — audited, no system dependency (ADR-0005).

* The database key is **32 random bytes** (`DatabaseKey::generate()`), created
  on first init by `xamverse-core` and stored in the `SecureKeyStore` under
  the name `database_key`.
* The key is applied with hex literal syntax — `PRAGMA key = x'...'` — so
  arbitrary bytes are safe without escaping concerns.
* SQLCipher only surfaces key errors on first use, so `Database::open`
  **probes immediately** (`SELECT COUNT(*) FROM sqlite_master`) and maps a
  `NotADatabase` failure to the explicit `StorageError::DatabaseUnreadable` —
  a wrong key fails fast, never silently (pinned by the
  `wrong_key_is_detected_not_silent` test).
* `DatabaseKey` redacts itself in `Debug` output (`DatabaseKey(REDACTED)`); a
  test asserts the hex never leaks through logs.
* Key storage: OS keychain adapter preferred on desktop builds (DPAPI /
  Keychain, wired by the shell via the `SecureKeyStore` trait);
  `FileKeyStore` (`db.key`, hex, `0600`, directory `0700` on unix) is the
  portable fallback. The fallback's residual risk is documented in
  `SECURITY_MODEL.md` §"Database file theft" and flagged in code with
  `// NOTE(non-standard):`.

Durability pragmas set at open:

| Pragma | Value | Why |
|---|---|---|
| `journal_mode` | `WAL` | concurrent readers during sync apply |
| `synchronous` | `NORMAL` | durable across app crashes; see §7 trade-off |
| `foreign_keys` | `ON` | tenant/referential integrity enforced by SQLite |
| `busy_timeout` | 5000 ms | bounded waits if any second connection appears |

## 3. Schema — version 1 (`core_infrastructure`)

Phase 2 ships exactly one migration, `version 1, name "core_infrastructure"`.
Educational domain tables are deliberately **not** modelled here; Phase 3
adds them as new migrations plus its own repositories (the documented
extension point). The tables:

### Engine state

| Table | Purpose | Key columns |
|---|---|---|
| `kv` | generic engine state (Lamport clocks `lamport.<school>`, peer address directory `peer.addr.<device>`, install metadata) | `key` PK, `value` |
| `schools` | tenant registry | `school_id` PK, `name`, `settings_json`, `enrolled_at` |
| `background_jobs` | generic deferred work (licensing rechecks, update staging) | `job_id` PK, `kind`, `status`, `attempts` |

### Devices, trust and identity

| Table | Purpose | Notes |
|---|---|---|
| `devices` | local installation (`is_local = 1`) + every known peer | `signing_pk`, `transport_pk`, `fingerprint`; `UNIQUE(fingerprint)` — a fingerprint maps to exactly one device identity |
| `device_trust` | pairing state per school | `state IN ('pending','trusted','revoked','blocked')`, `approved_by`, PK `(school_id, device_id)` |

### Users, roles, sessions

| Table | Purpose | Notes |
|---|---|---|
| `users` | replicated identity records | PK `(school_id, user_id)`, `UNIQUE(school_id, username)`, `auth_hash` (Argon2id PHC string), `revision` for CAS replication |
| `roles` / `role_permissions` / `user_roles` | RBAC data, seeded per school at enrollment | PKs are `(school_id, …)` composites |
| `sessions` | **local only, never replicated** | PK `token_hash` (SHA-256 of the raw token), `kind IN ('desktop','browser')`, `expires_at`, `locked_at`, `revoked_at` |
| `login_attempts` | login throttle counters | key `"<school_id>:<username>"`, indexed `(key, at)` |

### Replication (explained further in §6)

| Table | Purpose |
|---|---|
| `sync_ops` | append-only, signed operation log; `op_id` PK; `UNIQUE(school_id, category, object_id, revision)` makes CAS conflicts expressible |
| `sync_objects` | materialized current state per object: `current_revision`, `current_op_id`, `payload_sha256`, `tombstone`, `lamport` |
| `sync_jobs` | durable outbox: `kind IN ('push_op','pull','collect')`, `status`, `attempts`, `next_attempt_at` |
| `sync_checkpoints` | per-peer per-category Lamport watermarks, PK `(school_id, peer_device_id, category)`; the pseudo-category `*` is the all-categories watermark |
| `blobs` | content-addressed store: `sha256` PK, `size`, `data BLOB` |
| `conflicts` | quarantined conflicts: `kind`, `incoming_op_id`, `local_op_id`, `incoming_payload_json`, `strategy`, `status IN ('open','resolved','deferred')` |

### Examination data

| Table | Purpose | Notes |
|---|---|---|
| `packages` | sealed assessment packages | `content_sha256`, `manifest_json`, `approved_signature`, `blob_sha256 REFERENCES blobs`; `UNIQUE(school_id, assessment_id, version)` |
| `attempts` | attempt envelope | `status IN ('in_progress','finalized')`, `finalize_signature`, `latest_chain_hash` |
| `attempt_events` | per-attempt hash-chained answer events | `seq` PK, `prev_hash`, `hash` |
| `collection_receipts` | proof a finalized attempt reached a collector | `UNIQUE(attempt_id, collector_device_id)` |

### Platform services

| Table | Purpose |
|---|---|
| `licences` | raw certificate + parsed fields; `status IN ('unactivated','active','grace_period','expired','invalid','revoked','renewal_required')` |
| `audit_events` | hash-chained append-only audit log (writes go through `xamverse-audit`, never raw SQL elsewhere) |
| `update_history` | update pipeline states `imported → verified → staged → applied` (+ `failed`, `rejected`) |
| `backups` | backup metadata: path, size, `sha256` of the archive, `schema_version`, `verified` flag |

Indexes worth knowing: `idx_ops_school_lamport` and
`idx_ops_school_category` (manifest queries), `idx_objects_lamport`
(watermark scans), `idx_jobs_due (status, next_attempt_at)` (the 500 ms job
runner poll), `idx_jobs_target`, `idx_conflicts_school (school_id, status)`,
`idx_sessions_user`, `idx_login_attempts_key`, `idx_devices_school`,
`idx_attempts_school`, `idx_attempt_events (attempt_id, seq)`.

## 4. Migration strategy

Enforced by `crates/xamverse-storage/src/migrations.rs` (its module comment
is the contract):

1. **Transactional.** Each migration runs inside a transaction together with
   its `_schema_migrations` bookkeeping row. A failed migration leaves the
   previous version untouched.
2. **Checksum-verified.** The SHA-256 of each migration's SQL is stored in
   `_schema_migrations` and re-verified on every open. Drift is the hard
   error `StorageError::MigrationChecksumDrift` — it means the database was
   modified outside the engine, and the engine refuses to start.
3. **Forward-only.** There is no automatic rollback of applied migrations.
   Recovery from a bad upgrade is restore-from-backup or engine upgrade —
   see `BACKUP_AND_RECOVERY.md` and the updater's schema window gate.
4. **No silent downgrades.** A database written by a *newer* engine
   (`current > known_max`) refuses to open with
   `StorageError::SchemaTooNew { found }`.
5. **Idempotent.** Re-opening a current database applies nothing
   (`MigrationReport.applied` empty) — pinned by the
   `migrations_apply_once_and_are_idempotent` test.

`_schema_migrations` itself is created outside the numbered migrations so the
bookkeeping table never depends on migration content.

## 5. Tenant isolation (ADR-0002)

An installation may legitimately hold data for several schools. The decision
was a **single tenant-scoped database**, not one file per school:

* Every tenant table carries `school_id`; composite primary keys start with
  it (`users`, `roles`, `device_trust`, `sync_objects`, `sync_checkpoints`,
  `conflicts`, `packages`, `attempts`, `collection_receipts`).
* Every repository function takes `school_id: &str` as a required parameter
  and filters on it — there is no unscoped tenant read in the repo layer.
* The sync apply pipeline rejects any op whose `school_id` is not enrolled on
  the receiving device **before** deeper payload parsing (apply step 1,
  "tenant gate"), and additionally refuses ops that claim a different tenant
  than the batch they arrived in (`school_mismatch`). Integration Test F
  proves cross-school replication is refused and nothing is persisted on the
  unauthorized receiver.
* Per-school key scoping is layered where it matters most: exam package
  content is sealed as content-addressed blobs with per-school manifests, and
  `student_view` strips `protected_fields` (JSON Pointers) before any
  student-visible surface sees content.

The consequence documented in the ADR: a missing `WHERE school_id = ?` would
be a security bug, which is mitigated by the repository-only-SQL rule (no
ad-hoc SQL outside `xamverse-storage`; `xamverse-core`'s two `COUNT(*)`
helpers use engine-constant table names only).

## 6. Sync metadata tables explained

These five tables are the replication machinery; `SYNC_ENGINE.md` describes
the flows, this section fixes the vocabulary.

* **`sync_ops`** — the log of *what happened*, append-only and idempotent by
  `op_id`. Rows keep the original author signature, `received_from` (the
  transport peer, which may be a relay) and `received_at`. Inline payloads
  live in `payload_json`; large content is referenced via `blob_sha256`.
* **`sync_objects`** — the log of *where each object is now*: current
  revision, the op that produced it, its content hash, tombstone flag and
  Lamport position. Manifests are built from this table's summaries; apply's
  CAS analysis reads it.
* **`sync_jobs`** — the durable outbox. `LocalOps::create` enqueues one
  `push_op` job per target in the same transaction as the op itself, so a
  crash after commit still leaves the replication debt recorded. Status flow:
  `queued → running → completed` with `failed` (after `MAX_RETRIES = 8`
  attempts) or `cancelled`; `running` rows found at startup are requeued
  (`requeue_interrupted_jobs`, called by `Engine::init`).
* **`sync_checkpoints`** — how far a pull from a given peer has advanced per
  category (`last_lamport`). The literal category `'*'` is used for
  all-categories pulls. Checkpoints only advance after a manifest page's ops
  are applied, so a crash loses no data — the next pull re-fetches from the
  watermark.
* **`blobs`** — content-addressed payload store used by packages, update
  artifacts and any op payload over `MAX_INLINE_PAYLOAD` (256 KiB). Blob
  writes are appended at exactly the receiver-reported offset and hash-
  verified on completion; a mismatch deletes the partial content (see
  `SYNC_ENGINE.md` §"Blob transfer").

The `kv` table participates too: `lamport.<school_id>` is the per-school
Lamport clock (advanced inside the same transaction that inserts an op) and
`peer.addr.<device_id>` is the last-known socket address for outbound
connections.

## 7. Persistence guarantees and the `synchronous=NORMAL` trade-off

What is guaranteed:

* **Atomicity** — every multi-step change (op insert + object state + Lamport
  advance + outbox rows; audit rows with the change they describe) commits in
  one transaction or not at all.
* **Durability across application crashes** — with WAL + `synchronous=NORMAL`,
  committed transactions survive process kill; the WAL is replayed on next
  open.
* **Tamper evidence** — audit log and attempt-event chains recompute hashes
  over the stored rows; `verify_chain` detects edits, deletions and
  reordering.
* **Crash recovery of the queue** — `running` jobs are requeued at init; push
  retries re-read the op from `sync_ops`, so a lost ack just means a retry
  that lands as `Duplicate`.

The documented trade-off: `synchronous=FULL` would also protect the most
recent transactions against **OS / power loss**, at a per-commit fsync cost.
The engine chose `NORMAL` because a school lab loses power far more often
than it loses disks mid-commit, and any data not yet replicated is recovered
by (a) the outbox on this node and (b) re-pull from peers that already hold
the ops. Exams themselves are additionally protected by the per-attempt
event chain: an interrupted exam resumes from committed events, and
`AttemptStore::finalize` refuses to finalize a broken chain.

`Engine::drop` runs `PRAGMA wal_checkpoint(TRUNCATE)` best-effort so the data
directory stays tidy between runs; `BackupService::create` runs the same
checkpoint **before** copying the file, because recent commits can otherwise
live only in `engine.xamdb-wal` (a bug caught by the restore test during
development).

Diagnostics surfaces: `Database::integrity_check`, `quick_check` and
`table_summary` power `xamverse-peer storage-verify`, `xamverse-peer
diagnostics` and the web bridge's `/api/v1/diagnostics` endpoint (which
additionally requires an `audit.view` session).
