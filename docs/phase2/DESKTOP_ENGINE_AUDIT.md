# Desktop Engine Architecture Audit

Audit target: `feat/desktopz` at `8330e68`  
Audit date: 2026-10-17

## Executive finding

The headless Rust engine is a substantial, well-decomposed implementation,
not a mock. Its storage, identity, authentication, authorization, networking,
replication, licensing, backup, update-staging, audit, and diagnostic layers
have automated coverage. This completion pass embeds it in Tauri, exposes the
SDK command surface, forwards events, starts browser access, uses the native OS
keychain, and produces a shared static UI payload for desktop and LAN clients.

The most important architectural decision is sound: `xamverse-core::Engine`
is the single composition root used by headless nodes and intended for Tauri.
Completion should preserve that boundary instead of duplicating services in
the shell.

## Checklist status

| Capability | Status | Evidence / remaining work |
|---|---|---|
| Tauri desktop runtime | Implemented, host validation blocked | One managed engine, lifecycle, IPC, event forwarding and browser bridge are wired. Windows Application Control blocks unsigned Cargo build helpers on this audit host; CI remains the authoritative shell compile gate. |
| Rust native services | Implemented | Thirteen focused crates composed by `xamverse-core::Engine`. |
| Local database and migrations | Implemented | SQLCipher SQLite, versioned migration runner, integrity/status APIs. |
| Local database encryption | Implemented | SQLCipher keys and device identity material use Windows Credential Manager / macOS Keychain in desktop builds. |
| Secure identity and authentication | Implemented | Per-device Ed25519 identity, Argon2id credentials, lockout, sessions, and a desktop-local one-time owner bootstrap. |
| Engine-enforced authorization/RBAC | Implemented | Reserved permissions and audited server-side denial paths. |
| Autonomous peer-to-peer networking | Implemented | Peer server/client and background sync runner use the same engine. |
| Peer discovery | Implemented | mDNS with graceful manual-peer fallback. |
| Manual IP connections | Implemented | Validated, persisted address book and CLI/API paths. |
| Device pairing and trust | Implemented | Pending/trusted/revoked state and tenant-scoped approval. |
| Real-time communication | Implemented | Noise TCP, browser SSE and replay-aware Tauri event forwarding are wired. |
| Reliable synchronization | Implemented, gate pending | Durable jobs, retries, checkpoints and idempotency exist; the CI harness readiness defect was repaired. |
| Data replication | Implemented | Signed oplog replication with real two-engine tests A–D. |
| Conflict detection infrastructure | Implemented | Quarantine, list/get/resolve/defer services and immutable-category gates. |
| Durable examination submission storage | Implemented | Hash-chained attempt events, finalization, receipts and tamper tests. |
| Secure assessment package handling | Implemented | Immutable package records, content hashes and role-specific views. |
| Licensing and offline activation | Partial | Signed device-bound activation works; seat enforcement and revocation remain application/integration work. |
| Background task processing | Implemented | Persistent sync queue and interrupted-job recovery. |
| Browser access infrastructure | Partial | The authenticated REST/SSE server now starts with the app and serves real static assets; production TLS remains open. |
| Native APIs and TypeScript SDK | Implemented, host validation blocked | Full Tauri `engine_*` command surface delegates to the engine with live authorization. The SDK is locally typechecked and tested; CI remains the Tauri compile gate. |
| Windows/macOS installers | Implemented for test artifacts | CI builds MSI/DMG artifacts; public distribution still requires owner signing/notarization credentials and final icons. |
| Online/offline update infrastructure | Partial | Signed offline import/stage/history exists; release feed, installer handoff and rollback integration remain open. |
| Backup and restore infrastructure | Implemented with limitation | Encrypted full-database backup/verify/restore exists; scoped export is full-database. |
| Diagnostics, audit logging and health | Implemented | Hash-chained audit and engine/storage status exist; desktop presentation is unwired. |
| Integration contracts and testing tools | Partial | Contracts, CLI, SDK tests and A–D tests exist; Tests E–J and a green end-to-end CI run remain. |

## Findings repaired in this audit

1. The browser bridge's empty origin allowlist rejected normal same-origin
   browser POSTs. Empty-list mode now compares `Origin` authority with `Host`;
   configured allowlists remain exact-match.
2. SSE events were emitted as named events while the SDK used `onmessage`, so
   browser clients received no engine events. The bridge now emits default
   message events with SSE IDs, and supports replay through both
   `Last-Event-ID` and `last_event_id`.
3. Root TypeScript compilation crossed into the independently managed SDK
   before its dependencies were installed. The root project now excludes the
   SDK; CI retains the SDK's own typecheck and tests.
4. The CLI's redirected readiness line was block-buffered, causing the
   engine-e2e harness to time out at startup. `serve` now flushes its readiness
   record explicitly.
5. The production build used Unix-only `cp`. A checked, cross-platform Node
   copier now assembles Next's standalone assets on Windows and Unix.
6. React 19 lint findings were resolved without effect-driven mirrored state.
   This also fixed custom-role selection, which previously looked up newly
   created roles only in the built-in collection.
7. Test documentation now reflects the existing `tests/integration` A–D
   suite instead of claiming that no integration target exists.
8. Multi-word SDK operations used camelCase command names while Tauri
   registered snake_case Rust names. Command construction now normalizes at
   one boundary and regression coverage exercises a multi-word call.
9. Tauri listener registration is asynchronous. The SDK now safely handles
   cancellation before registration completes and begins event replay only
   after the live listener is attached, closing the replay race.
10. Job retry/cancel and conflict resolve/defer commands now verify the
    referenced row belongs to the active session's school. Sensitive device,
    licence, backup and update commands require a fresh session.
11. Fresh installations previously had no production path to create their
    first credential. A desktop-only transaction now creates the first school
    and owner, grants the builtin owner role, audits the act, signs the owner
    in, and permanently refuses a second bootstrap.
12. The fallback file keystore imported Unix permissions APIs on every target,
    preventing the otherwise portable engine from compiling on Windows. The
    import and permission operations are now consistently Unix-gated.

## Verification evidence

- Graphify structural extraction: 2,278 nodes and 6,334 code relationships
  across 173 code files. The generated scratch graph was not committed.
- Local: root typecheck passed; lint passed; prototype tests 19/19 passed;
  production Next static export and desktop asset assembly passed.
- Local: engine SDK typecheck passed; SDK tests 17/17 passed.
- Local Windows: the full Rust workspace passes `cargo check`; strict Clippy
  passes for every target; `cargo test` compiles every test binary. Windows
  Application Control then blocks execution of unsigned Cargo-produced test
  binaries (`os error 4551`), so local Rust test execution is not claimed.
- Local Windows: all Tauri dependencies resolved and were locked in
  `src-tauri/Cargo.lock`. The same Application Control policy blocks unsigned
  dependency build helpers before the shell can compile, including from an
  isolated Cargo cache. This is a host-policy gate, not a successful native
  shell build.
- GitHub Actions run `39025705593` at the audited SHA: Rust workspace tests,
  strict Clippy, and rustfmt passed. The root typecheck and engine-e2e jobs
  failed for the project-boundary and readiness issues repaired above.
- Rust 1.91.1, MSVC Build Tools, Windows SDK, and Perl are installed on this
  Windows host. The workspace native compile is green; Tauri validation must
  complete in CI or on a host that permits unsigned Cargo build helpers.

## Remaining production gates

1. Complete a green Tauri compile/installer build and the two-peer CI run on CI
   or a Windows host without the local Application Control restriction.
2. Add TLS provisioning/trust onboarding for LAN browser access.
3. Supply release signing/notarization credentials and final application icons.
4. Implement integration Tests E–J, update installer handoff/rollback, and
   backup disaster-recovery exercises on physical Windows/macOS devices.

## Maintainability and security check

The changes in this audit keep ownership at existing boundaries, use bounded
or existence-only queries, avoid hard-coded deployment assumptions, add
regression coverage for protocol behavior, and use explicit failure paths. The carousel lint
suppression is the only exceptional annotation: it documents a standard
external-store initialization that the generic lint rule cannot distinguish
from derived React state. No security control was moved into the UI.
