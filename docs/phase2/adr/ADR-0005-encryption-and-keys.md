# ADR-0005 — SQLCipher at rest; OS-keychain-first key storage with honest fallback

Status: accepted (2026-10, Phase 2)

## Context
Exam records, credentials and packages must be encrypted at rest. Keys must
live somewhere. Windows/macOS offer secure storages (DPAPI/Keychain); generic
Linux and CI containers do not.

## Decision
* Whole-database encryption via **SQLCipher** (rusqlite
  `bundled-sqlcipher-vendored-openssl`) — audited, widely deployed, no system
  dependency.
* The database key is 32 random bytes created at first init. Storage strategy:
  1. **OS keychain adapter** (preferred on Windows DPAPI / macOS Keychain —
     wired by the desktop shell; trait provided).
  2. **Key file fallback** with `0600` permissions inside the app data
     directory (`db.key`, hex).
* `// NOTE(non-standard):` the file fallback stores the key on the same disk
  as the database. This is a *documented residual risk* (see
  SECURITY_MODEL.md "Database file theft") that production installs avoid via
  the OS keychain. It is never presented as full protection, and never
  silently enabled where a keychain is available.

## Consequences
* Backup archives additionally use a passphrase-derived key (Argon2id) + AEAD,
  so stolen backups without the passphrase are useless even if the DB key
  leaked.
* CI and tests pass keys explicitly; nothing derives keys from magic strings.
