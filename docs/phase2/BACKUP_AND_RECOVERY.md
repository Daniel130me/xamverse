# Backup and Recovery — archive format, verification, restore and limits

This document specifies `xamverse-backup`: the encrypted archive format
(`XVBK`), the layered verification performed before any restore is declared
successful, the restore + recovery-key procedure (and why the database key
is *not* in the archive), the WAL checkpoint that makes the archive complete,
retention, and the honest limitations — above all, **lost key = lost
backup**. Source: `crates/xamverse-backup/src/lib.rs`.

---

## 1. Why backup is separate from sync

Synchronization is not backup (spec §22): replication protects against a
peer disappearing, not against "all copies of this school's data are gone or
corrupt". `BackupService` produces **passphrase-encrypted, AEAD-authenticated
archives of the local database** that restore into a clean environment with
integrity verified at every layer. A backup also travels off-device (USB,
safe) without exposing data — a stolen `.xvbk` is useless without the
passphrase even if the database key leaked (`SECURITY_MODEL.md` §4.18).

## 2. Archive format

Deliberately boring, per the module doc:

```text
offset  size        field
0       4           magic  "XVBK"
4       4           format_version (u32 BE, currently 1)
8       16          salt (Argon2id)
24      24          nonce (XChaCha20-Poly1305)
48      4           ciphertext_len (u32 BE)
52      n           ciphertext = AEAD( header_json \n || db_bytes , AAD = "XVBK" )
```

* KDF: **Argon2id**, m = 64 MiB, t = 3, p = 1, 16-byte random salt → 32-byte
  key. Backup is rare; strength matters more than latency (`KDF_*` consts).
* AEAD: **XChaCha20-Poly1305** with the magic bytes as additional
  authenticated data, so headers of another format cannot be spliced in.
* The JSON **header is inside the AEAD**, so metadata is authenticated too:

```json
{ "created_at": "…", "device_id": "…", "schema_version": 1,
  "db_sha256": "…", "db_len": 123456, "kind": "full" | "scoped",
  "school_scope": null }
```

* `create_full(passphrase)` and `create_scoped(passphrase, school_id)`
  produce the same format; scope is recorded in the header (record-level
  school-scoped export/import remains a Phase 3 refinement on top, per
  ADR-0002).
* The archive path is `backups/xamverse-<uuidv7>.xvbk`; a `backups` metadata
  row (size, archive SHA-256, schema version, `verified`) and an audit event
  `backup.created` are written, and `backup.completed` is published.

## 3. The WAL checkpoint detail

`create()` runs `PRAGMA wal_checkpoint(TRUNCATE)` **before** reading the
database file:

> Without this, recent commits can live only in `engine.xamdb-wal` and the
> backup would silently miss them (caught by the restore test during
> development).

This matters because the engine runs WAL journaling with
`synchronous=NORMAL` (`DATABASE.md` §7): the main database file alone is not
guaranteed to contain the latest committed transactions. The checkpoint
forces every WAL frame into the main file and truncates the WAL, so the
copied file is a complete, consistent snapshot. `Engine::drop` runs the same
checkpoint at shutdown to keep the data directory tidy.

## 4. Verification layers

`verify(archive, passphrase)` runs before any restore and is usable on its
own (an admin can validate media without touching a target machine):

| Layer | Check | Failure |
|---|---|---|
| 1 | magic `XVBK` + declared length sanity | `BadMagic` |
| 2 | format version ≤ supported | `FormatTooNew { found, supported }` |
| 3 | AEAD tag (wrong passphrase, truncation, bit flip) | `AuthenticationFailed` |
| 4 | declared `db_len` matches plaintext length | `ContentHashMismatch` |
| 5 | inner `SHA-256(db_bytes)` == header `db_sha256` (bit-rot/tamper beyond AEAD's scope, e.g. re-encrypted archives) | `ContentHashMismatch` |
| 6 | header `schema_version` ≤ engine's max migration | `SchemaTooNew` |

`restore()` adds layer 7 by construction, and `restore_with_key` adds layer
8:

| Layer | Check | Failure |
|---|---|---|
| 7 | the restored copy **opens as a valid SQLCipher database** (wrong key ⇒ `DatabaseUnreadable` mapped to `AuthenticationFailed`) | `AuthenticationFailed` |
| 8 | `PRAGMA integrity_check == "ok"` on the restored copy | `IntegrityCheckFailed(check)` |

## 5. Restore and the recovery-key procedure

**The database key is never in the archive.** Keys never leave the device
(ADR-0005): the archived DB is SQLCipher-encrypted with the *original*
installation's 32-byte database key, while the archive itself is encrypted
with the passphrase. Therefore a cross-device restore needs both secrets —
this is the documented **recovery key procedure**:

1. Create the archive: `BackupService::create_full(passphrase)` (or the UI's
   backup screen). Record the passphrase per the school's own procedure.
2. Secure the **recovery key**: the installation's database key hex
   (`data_dir/database_key.key`, the `0600` keystore file, or its
   OS-keychain equivalent). The school stores this **offline, separately
   from the archive** — e.g. printed in the school safe. Desktop shells
   should expose "show recovery key" behind a sensitive reauthentication
   (`AuthService::require_fresh`).
3. On the replacement machine: `restore_with_key(archive, passphrase,
   database_key_hex, target_dir)` —
   verify (layers 1–6) → write `restored.xamdb` → open it with the supplied
   key (layers 7–8) → the engine then adopts the directory (the identity
   keys are *not* restored; the new installation pairs anew and pulls or is
   pushed the post-backup ops — see §7).

```rust
pub fn restore_with_key(&self, archive_path: &Path, passphrase: &str,
    database_key_hex: &str, target_dir: &Path) -> Result<PathBuf, BackupError>;
```

Same-device recovery (bad update, corrupted DB) uses the identical path:
restore the archive with the *same* machine's database key.

## 6. Retention

`prune(keep)` deletes archives beyond the newest `keep` (metadata rows via
`BackupsRepo::prune_beyond`; files are managed with the rows). Scheduling
(scheduled backups, retention windows) is a desktop-shell/Phase 3 concern —
the engine provides the primitive and the metadata (`retention_until` column
is present for policy use). Every backup creation and restore is auditable
in the hash-chained audit log.

## 7. What a backup does and does not contain

Contained: the complete database — schools, users + Argon2id hashes, roles,
device/trust rows, the full signed op log and object state, packages and
blobs, attempts + event chains, receipts, conflicts, licences, audit log,
update history, kv (Lamport clocks, peer addresses).

Not contained (by design):

* **Device private keys** — the new installation generates a fresh identity;
  the school re-pairs it. (Restoring keys wholesale would clone the device
  identity — deliberately avoided.)
* **Live sessions** — session rows restore but their tokens belong to the
  old machine's memory; `authenticate` treats them as data, and housekeeping
  purges them.
* **Post-backup operations** — anything committed after the archive needs
  replication: the replacement node enrolls for the school, pairs with any
  current node, and pulls (checkpoints are per-peer, so a fresh node starts
  from zero and converges).

## 8. Limitations (honest list)

1. **Lost key = lost backup.** The design is symmetric and unforgiving:
   without *both* the passphrase (AEAD) and the database key (SQLCipher) the
   archive is unrecoverable — by anyone, including us. The recovery-key
   procedure in §5 exists precisely so this is a stored-secrets problem, not
   a cryptography problem.
2. **Full-database granularity.** A backup is the whole DB file; restoring a
   single school or object means restoring everything and letting sync
   redistribute (ADR-0002 consequence; scoped export is a Phase 3
   refinement).
3. **No online/streaming backup.** `create` is a point-in-time file copy
   under the engine's single-writer model; huge databases cost a checkpoint
   + read + Argon2id (64 MiB) — fine for school-scale data, not a
   continuous-protection solution.
4. **Restore does not migrate schema forward.** A backup newer than the
   engine refuses (`SchemaTooNew`); restoring an *older* schema is fine —
   migrations bring it forward on first open. There is no rollback of newer
   schemas onto older engines (DATABASE.md §4).
5. **Backup files inherit filesystem security.** The archive is
   ciphertext-strong but the file lives wherever the shell puts it; an OS
   administrator can delete or ransom backups — off-device copies are part
   of the school procedure, not the engine.
6. **Passphrase strength is human-dependent.** Argon2id at 64 MiB/t=3 raises
   offline-guessing costs, but a four-digit passphrase still falls; the
   engine cannot fix choice.
