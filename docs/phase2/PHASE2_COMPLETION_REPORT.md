# Phase 2 Completion Report — measured state at handoff

This report records what Phase 2 actually delivered, with real numbers from
commands executed in the build environment during this documentation pass
(no claimed-but-unexecuted results): the commit milestone table, per-crate
test counts, environment limitations, open discrepancies, and the concrete
work remaining for the Phase 3 handoff. Details live in the sibling
documents; this file is the executive evidence sheet.

Task ID: DOC-PHASE2 · Date of measurement: 2026-10-15 · Toolchain:
`cargo/rustc 1.99.0` (Linux x86_64 container, no GUI libraries).

---

## 1. Branch note (read first)

The task description names branch `feat/desktopz`. In the current checkout:

* `feat/desktopz` points at `3d964b1` — the **Phase 1 prototype tip** (0
  commits ahead of `main`'s base).
* The **engine work lives on `main`** (14 commits on top of the Phase 1
  history, below). `main...feat/desktopz` → `14 / 0`.

Everything below is measured on `main` @ `4b397da` with a dirty working tree
(see §5). Branch housekeeping (fast-forward or rebasing `feat/desktopz` onto
the engine tip) is an orchestrator decision and was deliberately **not**
performed by this documentation task, which changed only `docs/phase2/` and
`worklog.md`.

## 2. Milestone table

`git log --oneline feat/desktopz` returns the Phase 1 prototype history
ending at `3d964b1 docs: record Task 6 in the worklog` — it contains **no
engine commits**. The engine milestone table therefore comes from
`git log --oneline main` (newest first):

| Commit | Subject |
|---|---|
| `4b397da` | feat(web-bridge): authenticated lan browser server with sessions and sse events |
| `c555938` | feat(cli): headless engine node and diagnostic peer tooling |
| `edf331f` | feat(core): engine facade with lifecycle, single-instance lock and diagnostics |
| `b7eef6c` | feat(backup,updater): encrypted backups and verified update pipeline |
| `10cb7ee` | chore: register license-issuer-dev in the workspace |
| `899008d` | feat(licensing): signed offline activation runtime with device binding |
| `490d890` | feat(sync): durable peer replication, conflict engine and exam data infrastructure |
| `7b2ec25` | feat(discovery): mdns advertisements and persisted manual peer registry |
| `cc011f5` | feat(p2p): noise-encrypted peer transport with device-card authentication |
| `7ba5a61` | feat(security): offline argon2id auth, hashed sessions, rbac and login throttling |
| `335929c` | feat(security): device identity, signed device cards and hash-chained audit log |
| `615a3f0` | feat(storage): encrypted sqlcipher database with migrations and tenant-scoped repositories |
| `4aa18ee` | docs(architecture): define autonomous desktop engine, trust model and ADRs |
| `4527ac1` | *(Phase 1 baseline commit with a UUID subject — see KNOWN_LIMITATIONS.md)* |

All 14 commits are dated 2026-10-15. `docs/phase2/` (ARCHITECTURE.md + six
ADRs + this documentation set) is **untracked working-tree material**, not
yet committed — committing it is left to the orchestrator, as instructed.

## 3. Test evidence (real runs)

### 3.1 Rust — `cargo test --workspace` (exit 0, all green)

| Crate (unit tests) | Passed | Failed | Notable coverage |
|---|---|---|---|
| `xamverse-storage` | 5 | 0 | migration idempotency, wrong-key refusal, key redaction |
| `xamverse-identity` | 6 | 0 | identity stability, fingerprints, card binding + tamper |
| `xamverse-events` | 4 | 0 | pub/sub, replay, bounded history, stable kind names |
| `xamverse-audit` | 4 | 0 | chain verify, query filters, tamper + deletion detection |
| `xamverse-security` | 10 | 0 | Argon2id, lockout, sessions, suspension, RBAC negatives |
| `xamverse-network` | 6 | 0 | TCP frames, oversized refusal, handshake + wrong-identity |
| `xamverse-discovery` | 4 | 0 | TXT roundtrip, manual peers persist + validate |
| `xamverse-sync` | 14 | 0 | op signing, CAS, immutable gates, attempt chain, views |
| `xamverse-licensing` | 6 | 0 | offline activation, tamper, copy refusal, restricted mode |
| `xamverse-backup` | 5 | 0 | roundtrip, wrong passphrase, restore-with-key (~16 s) |
| `xamverse-updater` | 5 | 0 | import→stage→apply, forged manifest, interlock |
| `xamverse-web` | 4 | 0 | cookie session, revocation, origin allowlist, RBAC |
| `xamverse-core` | 3 | 0 | init + single-instance lock, lifecycle, enroll |
| `xamverse-peer` / `license-issuer-dev` | 0 | 0 | binaries (exercised via CLI demo) |
| Doc-tests (all crates) | 0 | 0 | no doc examples yet |
| **Total** | **76** | **0** | |

### 3.2 TypeScript

* `bun run test` (vitest, jsdom): **1 file, 19/19 passed**
  (`src/lib/prototype/__tests__/store.test.ts` — the Phase 1 behavioural
  acceptance gate).
* `bun run typecheck` (`tsc --noEmit`): **exit 0**, clean.

### 3.3 Two-peer CLI demo (verified in this pass, debug build)

`peer-ping` (full Noise XX handshake + card exchange) ≈ 11–14 ms RTT;
enroll → `pair_request`/`pair_pending` → `peer-approve` on both sides →
queued pull completing with `pull complete received=0 duplicates=0
conflicts=0` on empty databases; `AlreadyRunning` correctly blocks one-shot
commands against a serving node. Step-by-step commands and caveats:
`TESTING.md` §4.

## 4. What shipped (one line per area)

* **Storage**: SQLCipher (bundled, vendored OpenSSL), checksum-verified
  forward-only migrations (schema v1, 22 tables), tenant-scoped repos,
  `SecureKeyStore` with documented `0600` file fallback.
* **Identity/security**: Ed25519 + X25519 identities, `XV-XXXX-…`
  fingerprints, signed device cards bound to the Noise handshake hash,
  Argon2id auth with timing equalization + lockout, SHA-256-hashed session
  tokens, live-table RBAC with audited denials, hash-chained audit log.
* **Network/sync**: Noise XX transport (snow) with trust policy, durable
  outbox + backoff runner, signed op-log replication with CAS conflict
  analysis, resumable content-addressed blobs, manifest-diff pulls with
  per-peer checkpoints, collection receipts, conflict service, attempt
  hash-chains, sealed packages with `protected_fields` redaction.
* **Discovery**: mDNS (`_xamverse._tcp.local.`) + persisted manual peers.
* **Licensing/updates/backups**: signed offline activation with device
  binding and restricted mode; signed update manifests with platform/semver/
  schema gates and exam interlocks; `XVBK` Argon2id+XChaCha20 archives with
  layered verification and recovery-key restore.
* **Surfaces**: `xamverse-core` facade (flock single-instance), Axum browser
  bridge (sessions, RBAC, SSE, security headers), `xamverse-peer` CLI,
  `license-issuer-dev`.
* **Docs**: `docs/phase2/` set (ARCHITECTURE + 6 ADRs + 14 documents) — this
  pass verified every document against the code and executed the measurable
  claims.

## 5. Environment limitations and open discrepancies

1. **No Windows/macOS binaries and no code signing.** Linux-only container;
   `src-tauri/` is an excluded package and `.msi`/`.dmg` bundling plus
   Authenticode/Developer-ID signing are CI/release work
   (`UPDATES_AND_INSTALLERS.md` §7 checklist, none executed).
2. **No CI workflows exist.** `.github/workflows/` is absent; the planned
   job matrix is documented in `TESTING.md` §3 as target state.
3. **`packages/engine-sdk/src` and `src-tauri/src` are empty.** The SDK and
   shell must be written against `ENGINE_API.md`; the browser HTTP/SSE
   routes are the only working remote surface today.
4. **Uncommitted working-tree changes** present during measurement (not made
   by this task): `Cargo.lock`, re-export fixes in
   `xamverse-network/src/lib.rs`, `xamverse-security/src/lib.rs`,
   `xamverse-storage/src/repos/mod.rs`, and a `serde` dependency addition in
   `tools/license-issuer-dev/Cargo.toml`. They look like compile-fix
   leftovers from the implementation pass; the orchestrator should review
   and commit them with the engine work.
5. **Branch mismatch**: `feat/desktopz` is stale at the Phase 1 tip while
   the engine work is on `main` (§1).
6. **Licence CLI flow is broken end-to-end**: `licence-request` writes the
   bare request JSON while `license-issuer-dev issue` expects a
   `{"request": …}` wrapper, and `licence-import` cannot succeed because the
   CLI builds `EngineConfig::default()` (empty `trusted_issuer_pks`, no flag
   to add one). Library-level licensing is fully tested; the CLI needs two
   small fixes.
7. **CLI error ergonomics**: peer errors and `AlreadyRunning` surface as
   Rust panics (`unwrap()`); a requester receiving an error envelope parses
   it as a success payload and panics with a misleading JSON error
   (`KNOWN_LIMITATIONS.md` §7).
8. **Browser bridge is HTTP-only** (no TLS yet), has no CSRF token
   (SameSite=Strict + Origin check only), and mDNS is blocked on many school
   APs (manual peers are the fallback). All documented with plans.

## 6. Remaining work for the Phase 3 handoff

Engine-side (small, enumerated):

1. Commit the pending working-tree fixes + this documentation set; reconcile
   the `feat/desktopz` branch pointer.
2. Fix the two licence-CLI issues (§5.6) and convert CLI `unwrap()`s into
   structured error messages; check `reply.kind == "error"` in
   `request_typed` callers of the CLI.
3. Add the CI workflow matrix (`TESTING.md` §3) and a scripted `engine-e2e`
   demo job.
4. Add the multi-node integration test binaries the ADRs reference
   ("Tests A–J") as dedicated `tests/` targets.
5. TLS for the browser bridge per `BROWSER_ACCESS.md` §6 (local cert
   provisioning + trust onboarding), and a CSRF token as defence in depth.

Phase 3 owns (application layer, per `PHASE3_INTEGRATION_GUIDE.md`):

6. `@xamverse/engine-sdk` + the Tauri shell implementing `ENGINE_API.md`
   command-for-command; OS-keychain `SecureKeyStore` injection; update
   interlock wiring (exam-active check + backup-first).
7. All business services and screens (authoring, approvals, marking,
   analytics, practice), domain permissions as data, replication target
   policies, backup scheduling, licence UX, onboarding.
8. Static frontend bundle pipeline for the browser bridge.
9. Keep the 19-case vitest suite green through the `MockClient` → real
   adapter swap (the acceptance gate).

---

## 7. Resolution update (post-measurement pass)

The report above is the measured state at the documentation pass; the
following items from §5/§6 were subsequently fixed and re-verified
(`cargo test --workspace` 80/80, clippy `-D warnings` clean, fmt clean, and
the CLI flows executed for real):

1. **Working-tree fixes committed + branch reconciled** (§5.4, §6.1) — the
   engine tip lives on `feat/desktopz`; local `main` was cleaned of an
   accidental `target/` commit before it could be pushed.
2. **Licence CLI flow fixed end-to-end** (§5.6): shared
   `ActivationRequestFile` envelope in `xamverse-licensing`;
   `licence-import --issuer-pk` with early key validation. Verified:
   request → issue → import prints `status: Active`.
3. **CLI error ergonomics** (§5.7): no more `unwrap()` panics — single
   `error:` line, non-zero exit, peer error envelopes decoded
   (`SyncError::PeerError`), logs on stderr, `peer-ping` failures exit
   non-zero. Regression-pinned by integration Test B and
   `scripts/engine-e2e.sh` step 4.
4. **CI implemented** (§5.2, §6.3): `.github/workflows/ci.yml`
   (rust-test / rust-clippy -D warnings / rust-fmt / ts-check incl. the
   SDK / engine-e2e) + `desktop.yml` dispatch-only shell builds.
5. **`engine-sdk` + Tauri shell scaffolded** (§5.3): the SDK's browser
   adapter works against today's bridge routes (13 tests), the desktop
   adapter targets the `engine_<ns>_<op>` command contract, and `src-tauri`
   builds a real windowed scaffold with honest shell-state commands. Phase
   3 owns the engine embedding, full command set, and installers.
6. **Workspace hygiene**: clippy/fmt gates added and every pre-existing
   warning fixed properly (including real findings: unchecked day-count
   arithmetic on untrusted licences, an unenforced login body cap,
   truncated-archive parsing, thread-spawn failure handling).
