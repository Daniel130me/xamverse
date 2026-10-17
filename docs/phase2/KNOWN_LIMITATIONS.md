# Known Limitations — the honest list

This document records everything the Phase 2 engine does **not** do, cannot
yet do, or does with documented risk. Each entry states the current
behaviour, the impact, and the intended resolution where one exists.
Nothing here is speculative — every item was verified against the code (and,
where marked, executed) during this documentation pass.

> Resolution log: items marked **RESOLVED** were fixed and re-verified after
> the documentation pass (see the resolution notes on each item); they stay
> listed so the history of known risks remains auditable.

---

## Build, packaging and distribution

1. **No Windows/macOS binaries were built in this environment.** The engine
   compiles and tests on Linux; the Tauri shell (`src-tauri/`) is an
   independent package excluded from the workspace (needs GUI system
   libraries) and its `.msi`/`.dmg` bundles are CI's job. ~~The workflows
   directory does not exist yet~~ **RESOLVED (partially):** `ci.yml` now runs
   the `TESTING.md` §3 Linux matrix (rust-test / rust-clippy -D warnings /
   rust-fmt / ts-check incl. the engine SDK / engine-e2e two-peer demo) on
   every push; `desktop.yml` builds the shell on Windows/macOS runners
   (dispatch-only, non-blocking until the shell ships). Actual
   `.msi`/`.dmg` bundling remains open (item 2).
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
7. **Pair-request/peer failures surface as CLI panics.** ~~The handler
   correctly returns structured errors, but `peer-cli` `unwrap()`s several
   call sites~~ **RESOLVED.** Both CLI tools now report a single
   `error: …` line and exit non-zero on every failure (anyhow context
   chains, no panics on operator input); `request_pairing` is routed
   through the typed reply helper so peer error envelopes surface as
   `SyncError::PeerError` instead of a JSON parse panic; `peer-ping`
   failure exits non-zero. Pinned by integration **Test B** and by the
   negative check in `scripts/engine-e2e.sh` step 4 (verified:
   `pairing request refused: peer replied with error request_failed:
   FOREIGN KEY constraint failed`). Related: the CLI now writes logs to
   stderr, keeping stdout machine-readable (Unix convention, previously
   mixed).
8. **Engine-lock vs one-shot commands.** Any `xamverse-peer` command on a
   data dir whose `serve` is running fails with `AlreadyRunning` (the
   single-instance flock working as designed). Operationally this means
   enroll/approve require stopping the node — verified in the demo
   (`TESTING.md` §4). A "control channel" for live nodes is future work.

## Licensing

9. **`licence-request` ↔ `license-issuer-dev issue` file-shape mismatch.**
   **RESOLVED.** The interchange envelope `ActivationRequestFile`
   (`{"request": {…}}`) now lives in the `xamverse-licensing` crate and is
   written by `licence-request` and read by the issuer tool — one shared
   type, so the file shape cannot drift again. Verified end-to-end with the
   debug binaries: request → issue → import → `status: Active`.
10. **`licence-import` cannot succeed via the CLI.** **RESOLVED.**
    `licence-import` takes a repeatable `--issuer-pk <base64-ed25519-pk>`
    flag (validated up front: base64, 32 bytes — a typo now fails with an
    actionable message instead of the generic trust error). Verified:
    import with the issuer key prints `licence imported; status: Active`;
    missing/malformed keys fail with clean errors and exit 1.
11. **Delayed revocation / clock rollback.** Offline revocation is
    eventually consistent (ADR-0006), and licence status derives from the
    local clock — an operator with OS access can rewind it
    (`SECURITY_MODEL.md` §4.14). Documented, not solved.

## Storage and replication

12. **FileKeyStore residual risk on headless deployments.** The fallback key file lives on the same
    disk as the database with `0600` permissions: protected from other OS
    users, not from an administrator or full-disk access
    (`keystore.rs` `NOTE(non-standard)`). **RESOLVED for the desktop shell:**
    `src-tauri` injects `PlatformKeyStore`, backed by Windows Credential
    Manager or macOS Keychain and namespaced per canonical data directory.
    The non-standard fallback remains for explicitly headless/CI/Linux uses.
13. **Single-writer database concurrency model.** One connection behind a
    mutex; all writes serialize. Correct and simple at school scale, but
    handler bodies run short SQLite transactions directly on async threads
    (`handler.rs` `NOTE(perf)` documents the measured trade-off and the
    `spawn_blocking` alternative). A future multi-core write bottleneck
    would start here.
14. **Multi-node integration coverage is incomplete.** **PARTIALLY
    RESOLVED.** `tests/integration` now implements automated Tests A–D with
    independent data directories and real TCP/Noise connections: autonomous
    sync/reconnect, structured pairing refusal, idempotent submission
    collection/conflict rejection, and distributed administrator identity
    with an audited RBAC denial. Tests E–J from the original architecture
    checklist remain to be implemented.
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

18. **The Tauri shell and `engine-sdk` were stubs.** ~~Both are empty~~
    **RESOLVED.** `packages/engine-sdk` provides the typed
    `EngineClient` with three transports: the browser adapter works against
    bridge routes, the desktop adapter invokes the complete
    `engine_<ns>_<op>` command surface, and a boot-surface mock backs
    vitest/storybook. `src-tauri` embeds the engine, owns its lifecycle,
    publishes engine events, and enforces live session/RBAC checks in native
    commands. Seventeen SDK tests pin the adapters, including local-only
    bootstrap, race-free event replay, and asynchronous Tauri listener cleanup.
19. **No frontend bundle pipeline for the bridge.** **RESOLVED.**
    `npm run desktop:prepare` produces a Next.js static export and copies it
    into the Tauri resources. The embedded browser bridge and the desktop
    window therefore serve the same versioned frontend assets.
20. **AI-assisted question generation is not started.** Per the handoff §5
    it is Phase 3 (cloud provider + local model hook); the engine has no
    primitive for it.

## Code-quality flags found in-tree (non-blocking)

21. **Compiler warnings across the workspace.** ~~14 in `xamverse-sync`~~
    **RESOLVED.** The workspace now passes `cargo clippy --workspace
    --all-targets -- -D warnings` and `cargo fmt --all -- --check` (the new
    CI gates). Mechanical fixes were applied via `cargo fix`; genuine
    findings were fixed properly — unchecked `try_days` on untrusted
    licence day counts (now checked/saturating), an unenforced login body
    cap in the web bridge (now a 4 KiB request-body limit), a truncated
    archive parse path (now `BackupError::Corrupted`), thread-spawn failure
    now a typed error, dead fields/methods removed. Test code keeps
    unwrap/expect via a per-crate `cfg(test)` exemption; library code stays
    strict. Integration-test helpers use a scoped `cfg_attr(not(test))`
    allow (the crate's real output is its test target).
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
