# Testing — commands, suites, demo runs and evidence policy

This document explains how to run every test in the repository: per-crate
Rust unit/integration tests, the TypeScript suite, the security-relevant
tests, the planned CI jobs, how to run the two-peer demo with the
`xamverse-peer` CLI (verified commands, including the caveats discovered
while writing this document), and the measured-test-evidence policy (real
numbers from real runs; no claimed-but-unexecuted tests).

---

## 1. Rust — the engine workspace

Most unit tests are `#[cfg(test)]` modules inside their crates. The dedicated
`tests/integration` workspace member adds four cross-engine tests (A–D);
`cargo test --workspace` runs both layers plus doc-tests.

```bash
cargo test --workspace                  # everything, 80 tests
cargo test -p xamverse-sync             # one crate (replication core)
cargo test -p xamverse-security -- --nocapture   # watch auth flows
cargo test --workspace --release        # SQLCipher-heavy suites are faster here
```

**Measured counts** (real run in this environment, `cargo 1.99.0`, all
passing, 0 failed — see `PHASE2_COMPLETION_REPORT.md` for the raw context):

| Crate | Tests | What the suite actually covers |
|---|---|---|
| `xamverse-storage` | 5 | migration idempotency, wrong-key detection, parent-dir creation, key redaction in Debug, table summary |
| `xamverse-identity` | 6 | stable identity across reloads, fingerprint format, sign/verify + tamper rejection, card binding roundtrip, tampered card, protocol major mismatch |
| `xamverse-events` | 4 | pub/sub, `subscribe_since` replay, bounded history, stable event kind serialization |
| `xamverse-audit` | 4 | append + chain verify, query filters, tamper detection |
| `xamverse-security` | 10 | Argon2id roundtrip, generic errors, lockout, session lifecycle, suspension, RBAC negatives, immediate permission revocation, owner/admin splits |
| `xamverse-network` | 6 | frame roundtrip over TCP, oversized rejection, handshake + card exchange, bidirectional messages, wrong-identity rejection |
| `xamverse-discovery` | 4 | TXT property encode/decode roundtrip, missing-identity TXT rejection, connect addresses use the peer port, manual peers persist and validate |
| `xamverse-sync` | 14 | op signing/payload hash, sequential revisions, stale base refusal, immutable refusal, outbox fan-out, apply-pipeline gates (duplicate/conflict/reject), attempt chain lifecycle + tamper refusal, package views, conflict resolution + double-resolve refusal |
| `xamverse-licensing` | 6 | full offline activation cycle, tampered cert, cross-device copy refusal, untrusted issuer, expiry semantics, restricted-mode mapping |
| `xamverse-backup` | 5 | create/verify roundtrip, wrong passphrase, corrupted archive, restore-with-key integrity, schema-too-new refusal (slowest suite: ~16 s — Argon2id 64 MiB) |
| `xamverse-updater` | 5 | import→stage→apply flow, tampered artifact, forged manifest, downgrade/platform refusal, exam interlock |
| `xamverse-web` | 4 | login/logout/me cookie flow, revoked-session access loss, origin allowlist refusal on login, server-side permission boundary |
| `xamverse-core` | 3 | init (db+identity+lock), start/stop lifecycle, enroll-school seeding + audit |
| `xamverse-peer` (CLI) | 0 | binary crate; exercised by the demo below |
| `license-issuer-dev` | 0 | dev tool; exercised by the licence flow in `LICENSING.md` |

Security-relevant tests to know by name (grep targets):

```bash
cargo test -p xamverse-security permission        # RBAC boundaries
cargo test -p xamverse-network card_from_wrong_identity_is_rejected
cargo test -p xamverse-sync tampered_attempt_chain_cannot_finalize
cargo test -p xamverse-storage wrong_key_is_detected_not_silent
cargo test -p xamverse-backup wrong_passphrase_is_refused_safely
cargo test -p xamverse-licensing licence_copying_to_another_device_fails
cargo test -p xamverse-updater forged_manifest_is_refused
```

Note on the "integration Tests A–J" referenced by ADRs/ARCHITECTURE:
`tests/integration` currently implements A–D over real TCP with independent
engine instances. E–J remain open and are tracked in `KNOWN_LIMITATIONS.md`.

## 2. TypeScript — prototype suite and type gates

```bash
bun install                       # or npm/pnpm — bun is the sandbox default
bun run typecheck                 # tsc --noEmit over app + prototype + contracts
bun run lint                      # eslint
bun run test                      # vitest (jsdom) — the behavioural pin
bun run test:watch
```

Measured here: `typecheck` exit 0; vitest **1 file, 19/19 tests passed**
(`src/lib/prototype/__tests__/store.test.ts` — seed integrity, per-device
auth + RBAC, version-locked approvals, approval roundtrip, distribution with
offline blocking + auto-resume, 9-type auto-marking, collector routing,
duplicate-submission dedup, retry/cancel, conflict audit targeting,
practice, admin actions). During the Phase 3 engine swap this suite is the
acceptance gate (`CODEX_PHASE2_HANDOFF.md` §5): keep it green against the
`MockClient`, then re-point adapters.

## 3. CI jobs (implemented)

`.github/workflows/ci.yml` runs this matrix on every push/PR (names per
ADR-0001's per-crate-gating requirement; measured gates match the commands
below). The desktop bundling jobs live in `.github/workflows/desktop.yml`
and are dispatch-only + non-blocking until the shell ships.

| Job | Runs | Gate |
|---|---|---|
| `rust-test` | `cargo test --workspace` on linux (SQLCipher vendored build) | 80 tests green (A–D incl. Test B) |
| `rust-clippy` | `cargo clippy --workspace --all-targets -- -D warnings` | zero findings (library code strict; tests exempt per crate) |
| `rust-fmt` | `cargo fmt --check` | formatted |
| `ts-check` | `bun run typecheck && bun run lint && bun run test` + the same for `packages/engine-sdk` | 19/19 prototype + 13/13 SDK |
| `desktop-windows` / `desktop-macos` | build `src-tauri` + `tauri bundler` → `.msi` / `.dmg` artifacts | bundles build (excluded from the normal workspace by design) |
| `engine-e2e` | `scripts/engine-e2e.sh` (the §4 demo, scripted) | ping → enroll → pair → approve ×2 → pull complete → mutual trust, plus the clean-refusal negative check |

The Tauri shell is excluded from the workspace because it needs GUI system
libraries absent on headless machines (`Cargo.toml` `exclude`, ADR-0001) —
that is why the desktop jobs are separate.

## 4. Two-peer demo with `xamverse-peer` (verified commands)

Build once, then run two nodes on one machine (or two machines on a LAN):

```bash
cargo build --release -p xamverse-peer

# Terminal A — node A serves on 47810 (first run creates data/, keys, identity)
./target/release/xamverse-peer --data-dir ./nodeA serve --port 47810 --name "Lab-A" --no-mdns
#   → "node <uuid> (fingerprint XV-XXXX-…) listening on :47810"

# Terminal B (one-shot commands against node B's data dir)
./target/release/xamverse-peer --data-dir ./nodeB info                 # identity + fingerprint
./target/release/xamverse-peer --data-dir ./nodeB peer-ping 127.0.0.1:47810
#   → "pong from 127.0.0.1:47810 in 1.2ms"          (Noise XX + cards already ran)

# Enroll the school on BOTH nodes, then pair   (order matters — see caveats)
./target/release/xamverse-peer --data-dir ./nodeA enroll-school --school-id s1 --name "Demo School" --user owner-1
./target/release/xamverse-peer --data-dir ./nodeB enroll-school --school-id s1 --name "Demo School" --user owner-1
./target/release/xamverse-peer --data-dir ./nodeB peer-pair 127.0.0.1:47810 --school-id s1 --school-name "Demo School"
#   → "pairing pending with <A-device-id> (fingerprint XV-…) — approve on that node"

# Approval is a one-shot command: it needs the engine lock, so stop node A first
# (Ctrl-C in Terminal A), approve, then re-serve:
./target/release/xamverse-peer --data-dir ./nodeA peer-approve --school-id s1 --device-id <B-device-id> --user owner-1
./target/release/xamverse-peer --data-dir ./nodeA serve --port 47810 --name "Lab-A" --no-mdns

# Approve on B's side too (B is not serving; one-shot works directly)
./target/release/xamverse-peer --data-dir ./nodeB peer-approve --school-id s1 --device-id <A-device-id> --user owner-1

# Queue a pull on B targeting A — the job runs while B serves
./target/release/xamverse-peer --data-dir ./nodeB sync-pull --device-id <A-device-id> --address 127.0.0.1:47810 --school-id s1
./target/release/xamverse-peer --data-dir ./nodeB serve --port 47820 --name "Lab-B" --no-mdns
#   → node A log: "peer connected …"; node B log: "pull complete received=0 duplicates=0 conflicts=0"

# Inspection / diagnostics
./target/release/xamverse-peer --data-dir ./nodeA peers --school-id s1     # device_id<TAB>state
./target/release/xamverse-peer --data-dir ./nodeB sync-queue              # durable outbox rows
./target/release/xamverse-peer --data-dir ./nodeB storage-verify          # integrity + per-table counts
./target/release/xamverse-peer --data-dir ./nodeB diagnostics             # full JSON snapshot
```

Demonstrated end-to-end in this environment (this documentation pass, debug
build): `peer-ping` RTT ≈ 11–14 ms including the full Noise handshake + card
exchange; enroll on both nodes; pairing → `pair_pending`; approval on both
sides; a queued pull completing as `pull complete received=0 duplicates=0
conflicts=0` (empty databases — the correct result); `AlreadyRunning`
behaviour for one-shot commands against a serving node.

### Demo caveats (real behaviour, verified here)

1. **Both nodes must enroll the school before pairing.** Trust rows are
   tenant-scoped (`device_trust` FK on `schools`); pairing into an
   un-enrolled school fails on the responder with a `FOREIGN KEY constraint
   failed`, and the requester now sees that as a clean structured error:
   `error: pairing request refused: peer replied with error request_failed:
   FOREIGN KEY constraint failed` (exited non-zero — verified by
   `scripts/engine-e2e.sh` step 4).
2. **One-shot commands cannot run while the same data dir is serving**
   (`engine.lock` → `EngineError::AlreadyRunning`). Enroll/approve require
   stopping the node first (or a second operator on a different machine).
3. **`sync-pull` only executes while serving** — the job runner lives in
   `serve`; one-shot commands merely queue the job. Retries follow the
   standard backoff, so a pull queued before the peer was approved succeeds
   on a later attempt without operator action.
4. ~~**Pair-request/peer errors surface as CLI panics**~~ **Resolved** (see
   `KNOWN_LIMITATIONS.md` §7): the CLI prints one `error:` line and exits
   non-zero; peer error envelopes decode to their message. Two practical
   notes for scripts that automate the CLI: logs go to **stderr** (stdout is
   machine-readable output only), and the scripted demo in
   `scripts/engine-e2e.sh` is the maintained version of the manual sequence
   above — use it as the canonical reference for ordering (enroll before
   serving, capture ids while nodes are stopped).

## 5. Measured-test-evidence policy

1. **Report numbers only from runs you executed.** Every count in §1 came
   from `cargo test --workspace` in the environment that produced this
   document; if you cannot run it, say so instead of copying numbers.
2. **A test name is a contract.** When docs reference a test (e.g.
   `wrong_key_is_detected_not_silent`), it must exist and pass; renaming or
   deleting one requires a doc change in the same commit.
3. **No aspirational claims in tables.** CI jobs listed in §3 are marked as
   planned because the workflows directory does not exist; docs never
   present unimplemented gates as passing.
4. **Failures are findings.** The licence-flow CLI breakage discovered
   during this documentation pass was recorded in `KNOWN_LIMITATIONS.md`
   rather than hidden — the same policy applies to any future failing run.
5. **Environment facts are part of the evidence.** Windows/macOS binaries
   and bundling are CI's job (not built here); the demo caveats in §4 are
   environment-verified behaviour, including the awkward steps — they stay
   in the docs until the CLI smooths them.
