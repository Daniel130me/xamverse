# Known Limitations — the honest list

This document records everything the Phase 2 engine does **not** do, cannot
yet do, or does with documented risk. Each entry states the current
behaviour, the impact, and the intended resolution where one exists.
Nothing here is speculative — every item was verified against the code (and,
where marked, executed) during this documentation pass.

---

## Build, packaging and distribution

1. **No Windows/macOS binaries were built in this environment.** The engine
   compiles and tests on Linux; the Tauri shell (`src-tauri/`) is an
   independent package excluded from the workspace (needs GUI system
   libraries) and its `.msi`/`.dmg` bundles are CI's job. The workflows
   directory (`.github/workflows/`) **does not exist yet** — the planned CI
   jobs are listed in `TESTING.md` §3, none are running.
2. **No code signing anywhere.** Windows Authenticode and macOS
   Developer ID + notarization steps are documented as the required
   pre-release checklist in `UPDATES_AND_INSTALLERS.md` §7 — none executed.
   Unsigned installers will trigger SmartScreen/Gatekeeper.
3. **No production keys exist.** `trusted_issuer_pks` /
   `trusted_release_pks` are empty by default; dev keys from
   `license-issuer-dev` are for development only (its keypair file is
   flagged `NOTE(non-standard)` in code).

## Networking and discovery

4. **mDNS is blocked on many school APs.** Discovery degrades gracefully to
   `Discovery::without_multicast` + persisted manual peers (a warning, not
   an error), but the UX consequence is real: on those networks someone
   types IP addresses. Also, mDNS advertises on the first detectable local
   address — multi-NIC schools need manual peers (documented in the
   discovery module).
5. **Browser bridge serves plain HTTP.** Port 47811 has no TLS in the
   current build: cookies omit `Secure` and LAN traffic is readable. The
   production plan (local cert provisioning + trust onboarding) is
   documented in `BROWSER_ACCESS.md` §6 but **not implemented**. Biggest
   accepted security gap.
6. **No CSRF token on the web bridge.** Defence-in-depth relies on
   `SameSite=Strict` cookies plus the Origin allowlist check on
   state-changing requests (`xamverse-web/src/lib.rs`). A token-based
   defence is future work (`SECURITY_MODEL.md` §7.4).
7. **Pair-request/peer failures surface as CLI panics.** The handler
   correctly returns structured errors, but `peer-cli` `unwrap()`s several
   call sites, so operators see a Rust panic instead of the message. Three
   verified shapes from the two-peer demo (TESTING.md §4): pairing into an
   un-enrolled school fails on the responder with
   `FOREIGN KEY constraint failed`; `peer-approve` for a device id missing
   from `devices` panics with the same constraint error; and a *requester*
   that receives an error envelope panics with
   `Json(Error("missing field `responder_device_id`"))` because the CLI
   parses the reply payload without checking `reply.kind == "error"`.
8. **Engine-lock vs one-shot commands.** Any `xamverse-peer` command on a
   data dir whose `serve` is running fails with `AlreadyRunning` (the
   single-instance flock working as designed). Operationally this means
   enroll/approve require stopping the node — verified in the demo
   (`TESTING.md` §4). A "control channel" for live nodes is future work.

## Licensing

9. **`licence-request` ↔ `license-issuer-dev issue` file-shape mismatch.**
   The CLI writes the bare `ActivationRequest` JSON;
   `license-issuer-dev issue` expects `{"request": {…}}` (its `RequestFile`
   wrapper). The documented flow fails without manually wrapping the file —
   verified: `request file shape: Error("missing field `request`")`.
   Workaround: wrap manually; proper fix is a one-line change on either
   side.
10. **`licence-import` cannot succeed via the CLI.** The peer CLI builds
    `EngineConfig::default()`, whose `trusted_issuer_pks` is empty, and has
    no flag to add one — every import ends in
    `signature not from a trusted issuer` (verified). The library flow is
    fine (`LICENSING.md` tests pass); the CLI needs an `--issuer-pk` flag.
11. **Delayed revocation / clock rollback.** Offline revocation is
    eventually consistent (ADR-0006), and licence status derives from the
    local clock — an operator with OS access can rewind it
    (`SECURITY_MODEL.md` §4.14). Documented, not solved.

## Storage and replication

12. **FileKeyStore residual risk.** The fallback key file lives on the same
    disk as the database with `0600` permissions: protected from other OS
    users, not from an administrator or full-disk access
    (`keystore.rs` `NOTE(non-standard)`). Production desktop builds must
    inject the OS-keychain implementation (trait ready, wiring belongs to
    the Tauri shell).
13. **Single-writer database concurrency model.** One connection behind a
    mutex; all writes serialize. Correct and simple at school scale, but
    handler bodies run short SQLite transactions directly on async threads
    (`handler.rs` `NOTE(perf)` documents the measured trade-off and the
    `spawn_blocking` alternative). A future multi-core write bottleneck
    would start here.
14. **No multi-node integration test binaries.** The ADRs reference
    "integration Tests A–J"; the current tree has per-crate unit suites
    (76 passing) and the CLI demo, but no dedicated `tests/` integration
    binaries. Cross-node behaviour is exercised by the network tests (real
    TCP) and the §4 demo, not by an automated multi-node suite yet.
15. **Attempt-event chains are per-attempt, not global.** Tamper evidence
    for answers is anchored per attempt (`attempt_events.prev_hash/hash` +
    finalize signature); there is no global chain linking all attempts on a
    device. The audit log is the global chain for administrative acts.
16. **Backup is full-database only.** Scoped backup records a school in the
    header but the archive is the whole DB; record-level scoped
    export/import is a Phase 3 refinement (ADR-0002 consequence).
17. **`stale_revision` receipts lose the payload.** Rejected ops are not
    quarantined like conflicts — the sender learns `stale_revision` and must
    rebase; there is no receiver-side copy of rejected payloads (deliberate:
    they failed gates, but worth knowing when auditing).

## Application layer

18. **The Tauri shell and `engine-sdk` are stubs.** `packages/engine-sdk/src`
    and `src-tauri/src` exist but are **empty** (being written separately) —
    `ENGINE_API.md` is the contract they must implement; the desktop IPC
    adapter cannot be exercised until the shell lands.
19. **No frontend bundle pipeline for the bridge.** The web bridge can serve
    `frontend_dir` but nothing builds the Next.js app into a static bundle
    wired to it yet (Phase 3 work).
20. **AI-assisted question generation is not started.** Per the handoff §5
    it is Phase 3 (cloud provider + local model hook); the engine has no
    primitive for it.

## Code-quality flags found in-tree (non-blocking)

21. **14 compiler warnings in `xamverse-sync`** (mostly unnecessary clones /
    unused imports — `cargo fix` suggestions are available). Cosmetic; the
    suite passes.
22. **`store.rs` carries a stale comment** about receiver-side blob keys
    ("No — the op is inline-manifest + blob ref…") left from debugging; the
    code is correct (blob keyed by `blob_sha256`), the comment is noise.
23. **The `PackageStore::import` blob address is `SHA-256("pkg:<package_id>")`,
    not the content hash.** Content identity is `content_sha256` on the
    package row; the blob address is distinct. Consequence: two packages
    with identical content but different ids occupy two blobs (dedup exists
    only per package content check at import). Behavioural, not a bug — but
    worth knowing for storage planning.
24. **`server: null` history rows.** `update_history` may hold `manifest_json`
    for every state row; `version_of` scans up to 50 rows — fine at current
    volumes, an index would be the first fix if it grows.
