# Security Model — trust boundaries, threat model and residual risk

This document states what the engine protects, against whom, and — equally
important — what it does **not** protect against. It contains the key
hierarchy, the Argon2id and session-token parameters, the FileKeyStore
residual-risk note, the offline revocation gap (ADR-0006), and an explicit
"not unhackable" limitations section. The threat-model table is the reference
for reviewers: every mitigation names the crate and mechanism that implements
it, and the test that pins it.

---

## 1. Assets and trust boundaries

Assets, in decreasing order of sensitivity:

1. Device private material — Ed25519 signing seed, X25519 transport secret,
   SQLCipher database key (`SecureKeyStore`).
2. The SQLCipher database — credentials (Argon2id hashes), sessions, exam
   packages, attempts and their event chains, sync log, audit log.
3. Exam package content — especially answer keys (`protected_fields`).
4. The durability of replication history — signed ops, receipts,
   checkpoints, collection receipts.
5. The audit trail — hash-chained, append-only.
6. Session tokens (browser + desktop) while live.
7. Licence and update trust anchors — pinned issuer/release public keys.

Trust boundaries (also drawn in `ARCHITECTURE.md` §4):

| Boundary | Inside | Enforced by |
|---|---|---|
| T0 — the device | keystore, database, engine process | SQLCipher at rest; FileKeyStore/OS keychain; single-instance lock; OS user separation |
| T1 — authenticated transport | Noise XX channels bound to device cards | `xamverse-network` (snow, card↔handshake-hash binding) |
| T2 — engine authorization | trust store + RBAC + tenant scoping | `xamverse-sync` apply gates, `xamverse-security` Authz, ADR-0002 scoping |
| LAN / internet | everything else | deny by default: unknown devices get pairing/ping only |
| Browser | session-scoped REST/SSE subset | `xamverse-web` (see `BROWSER_ACCESS.md`) |

Prime directive (`ARCHITECTURE.md` §1): knowing an IP authorizes nothing;
privilege comes from authenticated users and signed authorization events,
never from which machine a person uses.

## 2. Key hierarchy

```text
Device identity (per installation)                     — SecureKeyStore
├── Ed25519 signing keypair   signs ops, device cards, activation requests
├── X25519 static keypair     Noise XX transport identity
└── device_id                 uuid from 16 keystore bytes (stable)
fingerprint  = "XV-" + base32(SHA-256(signing_pk || transport_pk))[..10]
               → "XV-XXXX-XXXX-XXXX-XXXX", humans compare during pairing
Database key (per installation)   32 random bytes → SQLCipher PRAGMA key
Backup passphrase (per archive)   Argon2id(64 MiB, t=3) → XChaCha20-Poly1305
Session tokens                    32 random bytes, shown once,
                                  stored only as SHA-256(token)
Issuer keys (offline, external)   Ed25519; public halves pinned in config
Release keys (offline, external)  Ed25519; public halves pinned in config
User credentials                  Argon2id m=19456 KiB, t=2, p=1 (PHC strings)
```

Private material never leaves the device, is never committed to Git, and key
seeds are zeroized on drop. `DatabaseKey`'s `Debug` impl redacts itself; a
test asserts the hex never appears in formatted output.

## 3. Authentication parameters (exact, reviewable constants)

| Parameter | Value | Where |
|---|---|---|
| Argon2id memory | 19 456 KiB (19 MiB, OWASP baseline) | `xamverse-security/src/auth.rs` `ARGON_M_COST_KIB` |
| Argon2id passes / parallelism | t=2, p=1 | `ARGON_T_COST`, `ARGON_P_COST` |
| Unknown-user timing equalization | verification against a fixed dummy PHC hash; identical error text for "no such user" and "wrong password" | `login()` + `dummy_phc_hash()` |
| Login lockout | 5 failures / 15 min window → 15 min lockout, key `"<school_id>:<username>"` | `LOCKOUT_*` consts, `login_attempts` table |
| Desktop session TTL | 12 h | `DESKTOP_SESSION_TTL` |
| Browser session TTL | 2 h | `BROWSER_SESSION_TTL` (mirrored in `xamverse-web`) |
| Sensitive-operation window | reauthentication required if session older than 5 min (`require_fresh`) | `SENSITIVE_MAX_AGE` |
| Password change | verifies old password, revokes **all** the user's sessions on the node, bumps user revision so it can replicate | `change_password` |
| Initial owner bootstrap | desktop-local only, one transaction, disabled once any school exists, 12-character minimum | `Engine::bootstrap_installation` |
| Post-login suspension | `authenticate()` re-reads the user row; a suspended user is logged out immediately on this node | `authenticate()` |
| Permission checks | resolved from the live role tables on every check; denial audited (`authz.denied`) | `xamverse-security/src/rbac.rs` |

Builtin role seeds (per school, at enrollment): `owner` = all 14 reserved
permissions; `admin` = all except `licence.manage`; `teacher` =
`sync.read`, `sync.write` only; `student` = none. Reserved permission
namespace: `devices.pair`, `devices.revoke`, `sync.read`, `sync.write`,
`sync.distribute`, `sync.collect`, `sync.resolve_conflict`, `licence.manage`,
`updates.manage`, `backups.manage`, `audit.view`, `identity.manage`,
`sessions.revoke`, `users.manage`.

## 4. Threat model

Format per row: **threat → assumptions / assets / trust boundary →
mitigation (crate:mechanism) → residual risk → relevant test**. "Local
access" means an unprivileged OS account on the machine; "admin access"
means OS administrator.

### 4.1 Malicious student with local access

* **Assumptions/assets:** student runs as a normal OS user on an exam PC;
  wants answers or to alter their attempt. Boundary T0.
* **Mitigation:** SQLCipher DB unreadable without the DB key, which lives in
  the user-protected keystore, not the DB; package content stored as blob,
  served to student UIs only through `PackageStore::student_view`, which
  strips `protected_fields` (JSON Pointers) before any client sees content;
  answers live in the hash-chained `attempt_events` — tampering breaks
  `verify_chain` and **finalize refuses**; sessions expire and lock.
  (`xamverse-storage`, `xamverse-sync::store`.)
* **Residual risk:** a student with OS *administrator* rights is out of scope
  of this row (see §4.11); a student who reads the screen or photographs it
  is not a computer problem.
* **Test:** `package_student_view_strips_protected_fields`;
  `tampered_attempt_chain_cannot_finalize`.

### 4.2 Unauthorized LAN computer (not paired)

* **Assets:** everything on the peer port; boundary T1/T2.
* **Mitigation:** IP knowledge grants nothing. Noise XX authenticates both
  statics; the device card is verified and bound to the handshake hash; the
  trust policy maps unknown devices to `AllowLimited` → only `pair_request`,
  `ping`, `blob_put`/`blob_status` (content-hash-checked writes); every other
  kind returns the structured "device is not fully trusted" error; ops from
  unknown authors are rejected (`unknown_author`).
  (`xamverse-network::peer`, `xamverse-sync::{engine,handler,apply}`.)
* **Residual risk:** blob slots can be filled by pending devices (bounded by
  hash-verifiable content only); pairing requests create `pending` rows —
  noisy but harmless, and audited.
* **Test:** `handshake_and_card_exchange_succeeds`,
  `card_from_wrong_identity_is_rejected`; handler trust-gate coverage.

### 4.3 Stolen paired computer

* **Assets:** DB, identity keys, trust state. Boundary T0 fully lost.
* **Mitigation:** at-rest encryption raises the bar but is defeated with the
  keystore present; the real containment is **revocation**:
  `SyncEngine::revoke_device` sets `revoked`, audited `devices.revoked`,
  and the trust policy `Reject`s revoked devices at connect time on every
  node that has the decision; the device itself can be excluded from future
  distribution because push targets are explicit. Accounts remain safe:
  stealing the device does not yield user passwords (Argon2id) and live
  session tokens are hashes.
* **Residual risk:** offline revocation is eventually consistent (ADR-0006,
  §5 below); data already replicated onto the stolen disk is readable given
  admin access to the OS account that holds the key file.
* **Test:** `revoke_device` behaviour is exercised in integration flows;
  trust-policy mapping unit-covered.

### 4.4 Compromised peer (a node turned malicious while paired)

* **Assets:** can inject/relay ops under its own identity. Boundary T1/T2.
* **Mitigation:** ops are signed by their **author** device and verified
  against the author's locally-known key — a relay cannot forge another
  device's ops; restricted categories require a trusted *transport* sender,
  but payload integrity and authorship still bind to the author; tenant gates
  run before parsing; CAS rules make rewriting history produce conflicts,
  not overwrites; conflicts and rejections are preserved as evidence.
* **Residual risk:** a compromised *trusted* author device can sign garbage
  that passes gates — trust in a device is a school decision; mitigate by
  revoking it and resolving conflicts.
* **Test:** apply pipeline unit tests (signature, tenant, CAS); Test F
  (school isolation).

### 4.5 Tampered exam package

* **Assets:** package integrity. Boundary T2.
* **Mitigation:** packages are content-addressed (`content_sha256`),
  immutable (revision 1 only), and travel as blobs that are hash-verified on
  completion — a corrupted transfer is deleted, never committed; approval
  signatures (`approved_signature`) bind an approver to the exact content
  hash; re-import of identical content is refused; receivers apply the
  manifest op only after the blob exists.
  (`xamverse-sync::store`, `xamverse-sync::handler::receive_blob_chunk`.)
* **Residual risk:** signature verification of `approved_signature` is
  recorded, not yet enforced as a gate at import (the approver's key trust
  web is Phase 3 territory) — see `KNOWN_LIMITATIONS.md`.
* **Test:** `package_student_view_strips_protected_fields`; blob hash
  mismatch path in `receive_blob_chunk`.

### 4.6 Forged approval (fake "the admin approved this")

* **Assets:** authorization events. Boundary T2.
* **Mitigation:** approvals are not vibes — pairing approval writes
  `device_trust.approved_by` + audit `devices.paired` by an authenticated
  user; content approvals carry `approved_by` + `approved_signature`
  persisted on the package row; every administrative act lands in the
  hash-chained audit log; permission denial is audited too.
* **Residual risk:** approval *signatures* verify against keys the engine
  records but the chain of "who may approve what" is Phase 3 RBAC data; a
  compromised `owner` account is a full trust compromise (see §4.8).
* **Test:** audit rows asserted in core/auth tests; conflict resolution audit
  test.

### 4.7 Replayed / duplicate submission

* **Assets:** result integrity. Boundary T2.
* **Mitigation:** idempotency by `op_id` and by
  `(school_id, category, object_id, revision)` uniqueness; identical content
  at the same revision is `Duplicate`; finalized attempts are immutable;
  collection receipts unique per `(attempt_id, collector_device_id)`.
* **Residual risk:** none known for exact duplicates; *near*-duplicates with
  different content become conflicts (visible, audited) rather than silent
  merges.
* **Test:** idempotency branches in apply pipeline tests; local.rs
  sequential-revision tests.

### 4.8 Account impersonation (offline)

* **Assets:** user identities. Boundary T2.
* **Mitigation:** Argon2id (§3) with timing equalization; credential records
  replicate as signed ops (ADR-0006) so a node authenticates a user **iff**
  it holds that user's credential record; suspensions take effect on the
  next check (`authenticate` re-reads status); password changes revoke all
  local sessions.
* **Residual risk:** a node that never received the credential/suspension op
  still behaves on stale data until sync (ADR-0006 §"offline revocation
  gap"); brute force is throttled per `(school, username)` but not per IP on
  the browser bridge beyond the shared throttle.
* **Test:** `student_is_denied_admin_permissions`,
  `permission_revocation_takes_effect_immediately`; auth suite (10 tests).

### 4.9 Revoked admin offline

* **Assets:** administrative authority. Boundary T2.
* **Mitigation:** same as 4.8 — revocation replicates as a signed op; the
  revoking device can also stop trusting devices and push targets.
* **Residual risk:** **the fundamental offline revocation gap** (ADR-0006): a
  node that has not yet received the revocation may accept sessions the
  school would now deny. Mitigations: short session TTLs, revocation fan-out
  on every connection (identity/permission categories are checkpoints in
  pulls), per-op signature + trust re-checks. Full elimination requires
  connectivity; any offline-first system shares this.
* **Test:** RBAC negative tests; ADR-0006 consequences.

### 4.10 Database theft (file copied from disk/backup share)

* **Assets:** everything at rest. Boundary T0 broken.
* **Mitigation:** SQLCipher AES-256 with a 32-byte CSPRNG key; wrong key is
  detected immediately, not silently; backup archives are separately
  passphrase-encrypted (Argon2id 64 MiB + XChaCha20-Poly1305) so a stolen
  `.xvbk` without the passphrase is useless **even if** the DB key leaked;
  session tokens stored only as SHA-256.
* **Residual risk:** on headless deployments using `FileKeyStore`, the DB key sits in
  `data_dir/database_key.key` (0600, directory 0700) — **same-disk key + DB
  defeats at-rest encryption for an OS administrator** (see §6). The Tauri
  desktop runtime injects `PlatformKeyStore` (Windows Credential Manager or
  macOS Keychain); it does not use this fallback.
* **Test:** `wrong_key_is_detected_not_silent`; backup
  `wrong_passphrase_is_refused_safely`.

### 4.11 Key extraction (admin/user reading keystore or memory)

* **Assets:** device private keys, DB key. Boundary T0 broken.
* **Mitigation:** keys are 32-byte CSPRNG values in the keystore; seeds
  zeroized on drop; key material redacted in Debug; the Tauri shell uses the
  operating-system credential store (per-user binding) so another OS user
  cannot read them.
* **Residual risk:** against an OS administrator with the process running,
  memory inspection wins — true of every desktop engine; documented, not
  hidden. Forensics (audit chain, op signatures) still proves *what*
  happened.
* **Test:** `debug_never_leaks_key`; zeroize usage in identity crate.

### 4.12 Tampered licence

* **Assets:** licensing trust anchor. Boundary T2.
* **Mitigation:** certificates are Ed25519-signed by issuers whose public
  keys are pinned in `LicenceConfig`; verification includes device binding
  (`DeviceMismatch` on copy) and temporal windows; stored raw cert is
  re-verified — a tampered stored row computes `Invalid`; display summary
  masks the product key.
* **Residual risk:** clock rollback (§4.14); the *keystore+DB* on the same
  machine are trusted to hold the row.
* **Test:** `tampered_certificate_is_invalid`, `licence_copying_to_another_
  device_fails`, `untrusted_issuer_is_rejected`.

### 4.13 Malicious update

* **Assets:** code execution on the fleet. Boundary T2 (import/stage).
* **Mitigation:** manifests Ed25519-signed by pinned release keys; platform/
  arch gate; semver downgrade refusal; schema window gate; SHA-256 artifact
  hash + size check; staged artifact re-verified after write; exam-active
  interlock + backup-first hooks run **before** staging; full history
  retained; every receiving device re-verifies independently so USB and LAN
  distribution are equally safe.
* **Residual risk:** compromise of a release key is total for the fleet that
  pins it (offline HSM custody is the operational answer); the Tauri shell
  performs the final swap, so its integrity is installer territory
  (`UPDATES_AND_INSTALLERS.md`).
* **Test:** `tampered_artifact_is_refused`, `forged_manifest_is_refused`,
  `downgrades_and_platform_mismatch_are_refused`,
  `exam_active_interlock_blocks_staging`.

### 4.14 Clock rollback (licence or update windows)

* **Assets:** temporal gates. Boundary T0.
* **Mitigation:** honest disclosure — **rollback exposure is real**: licence
  status is computed from the local clock (`status_of`), and backups/audit
  timestamps come from it too.
* **Partial mitigations present:** update manifests pin `min_schema /
  max_schema` (not just time) and refusals are semver-based, so rollback
  cannot resurrect an older *binary* through the updater; audit chains make
  timestamp surgery tamper-evident; licence `not_before` blocks premature
  activation.
* **Residual risk:** an admin with OS access can wind the clock back to keep
  an expired licence "active". Accepted for Phase 2; a monotonic counter or
  signed time envelopes is future work (recorded in `KNOWN_LIMITATIONS.md`).
* **Test:** `expired_licence_restricts_but_preserves_recovery` covers the
  expiry path semantics; rollback itself is untested by design (documented
  gap).

### 4.15 Browser session hijack

* **Assets:** live browser sessions. Boundary "Browser".
* **Mitigation:** session cookie is `HttpOnly; SameSite=Strict` (Secure added
  when TLS is configured); tokens stored only as SHA-256 server-side;
  2-hour TTL; CORS allowlist + Origin check on state-changing requests;
  security headers (`nosniff`, `X-Frame-Options: DENY`, `no-referrer`, CSP
  `default-src 'self'`); login rate limiting via the shared throttle;
  admin-listable and revocable sessions.
* **Residual risk:** without TLS on the current build (documented plan,
  `BROWSER_ACCESS.md`), a LAN eavesdropper can read cookies and traffic —
  the single biggest accepted gap; no CSRF token, defence relies on
  SameSite=Strict + Origin check.
* **Test:** web bridge suite (4 tests: login/session/origin/headers).

### 4.16 Cross-school access

* **Assets:** tenant separation. Boundary T2.
* **Mitigation:** apply gates (0/1) refuse un-enrolled or mismatched schools
  before payload parsing; every repo query takes `school_id`; manifests are
  tenant-gated on the serving side too (`school_not_enrolled`); browser SSE
  is filtered to the session's school; Test F proves nothing is persisted on
  an unauthorized receiver.
* **Residual risk:** relies on repo discipline (no ad-hoc SQL outside the
  storage crate) — a code-review invariant, not a runtime wall.
* **Test:** integration Test F (school isolation).

### 4.17 Corrupted transfer (bit rot, truncation, hostile peer)

* **Assets:** replication integrity. Boundary T1.
* **Mitigation:** per-op payload hash signed by the author; blob chunks
  appended at exact offsets, size-capped, and the assembled content is
  SHA-256-verified before acknowledgement — mismatch deletes the partial
  blob and the sender restarts; frame-size caps reject absurd lengths before
  allocation.
* **Residual risk:** a *signed* corrupted payload (author signed bad bytes)
  passes integrity by definition — conflicts/quarantine are the backstop.
* **Test:** `frames_roundtrip_over_tcp`, `oversized_frame_is_rejected`;
  receive_blob_chunk mismatch path.

### 4.18 Stolen backup archive

* **Assets:** full data snapshot. Boundary T0/T1 (whatever carried it).
* **Mitigation:** archive is `XVBK` + Argon2id(64 MiB, t=3, 16-byte salt) →
  XChaCha20-Poly1305 over (authenticated header + DB bytes); wrong
  passphrase or a flipped bit is `AuthenticationFailed`; the inner DB hash
  catches what AEAD cannot (see `BACKUP_AND_RECOVERY.md`).
* **Residual risk:** a weak passphrase defeats the KDF's cost only
  partially; the **database key is not in the archive** (keys never leave
  the device), so restore needs the recovery-key procedure — losing both the
  passphrase and the DB key means losing the backup.
* **Test:** `create_verify_roundtrip`, `corrupted_archive_is_refused`,
  `restore_with_key_verifies_integrity`, `schema_too_new_backup_is_rejected`.

## 5. Offline revocation gap (ADR-0006) — statement

> A node that has not yet received a signed revocation op may still accept a
> session, pairing or payload that the school would now deny.

This is fundamental to offline-first systems and is **documented, not
solved**. Mitigations in place: (a) revocations propagate as ordinary signed
ops with the same retry machinery; (b) pulls include identity/permission
categories via checkpoints so reconnection converges; (c) trust is
re-evaluated per connection and per restricted op; (d) session TTLs bound
the damage window (12 h desktop / 2 h browser). Schools should treat
"revoke + physically collect the device" as the combined procedure.

## 6. FileKeyStore residual risk (ADR-0005 note, verbatim intent)

`crates/xamverse-storage/src/keystore.rs`, flagged `// NOTE(non-standard):
residual risk` in code: the fallback key file lives on the same disk as the
database with `0600` permissions (directory `0700`). This protects the key
from other *users* on the machine but **not** from a local administrator or
full-disk access. The production desktop shell injects an OS credential-store
implementation of `SecureKeyStore` (Windows Credential Manager or macOS
Keychain). The fallback exists so headless nodes (labs, CI, Linux) remain
fully functional; it is never silently preferred by the desktop runtime.

## 7. Not unhackable — explicit limitations

1. **No protection against OS-level compromise.** Malware or an
   administrator on the machine can read the DB (with the keystore), inject
   UI, or screen-scrape. The engine's boundary is the engine process, not
   the OS.
2. **Offline revocation is eventually consistent** (§5).
3. **Browser bridge currently runs HTTP** on the LAN — TLS provisioning is a
   documented plan, not implemented (`BROWSER_ACCESS.md`); cookies and
   payloads are readable by a LAN eavesdropper until then.
4. **No CSRF token** on the web bridge; defence-in-depth relies on
   `SameSite=Strict` cookies plus an Origin allowlist check on
   state-changing requests.
5. **Clock rollback** can extend licence validity on a machine whose operator
   controls the clock (§4.14).
6. **Trusted-key compromise** (issuer or release signing keys) breaks
   licensing/update trust for every device pinning them; custody of those
   keys is an organizational control, not code.
7. **A malicious paired author device** can sign valid garbage; containment
   is revocation + human conflict resolution.
8. **Physical access** to a powered-on, unlocked machine defeats most
   software controls; the exam-session interlocks and audit trails exist to
   make misuse attributable.
9. **Denial of service** is not solved: any LAN host can open TCP connections
   and handshake; the per-connection cost is bounded but unauthenticated
   load is not rate-limited at the socket level.
10. **Quantum** — Ed25519/X25519/ChaCha20 are classical; no post-quantum
    agility in the Noise handshake yet.

The engine's honest claim: it is an **offline-first, tamper-evident,
deny-by-default** system for hostile-ish school LANs with full transparency
(attribution via signatures + hash-chained audit), not a fortification
against nation-state attackers or local OS administrators.
