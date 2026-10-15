# ADR-0002 — Single tenant-scoped database (not per-school database files)

Status: accepted (2026-10, Phase 2)

## Context
An installation may hold data for multiple schools. Options:

A. One SQLite file per school; isolation by file path and per-file keys.
B. One database with `school_id` on every tenant row and mandatory scoping in
   the repository layer.

## Decision
**B — single tenant-scoped database.**

Rationale:
* Cross-school queries (a legitimately multi-school installation) are simple
  and correct.
* One migration history, one backup format, one integrity-check surface.
* SQLCipher already gives at-rest encryption; per-school key scopes are
  layered by encrypting school-sealed payloads (packages) with per-school
  content keys.

Isolation is **engine-enforced**, not UI-enforced:
* Every tenant table has a `school_id` column; repository functions take
  `school_id: &str` as a required parameter and filter on it.
* The sync apply pipeline rejects any op whose `school_id` is not enrolled on
  the receiving device *before* parsing deeper payload fields.
* Integration Test F (school isolation) proves cross-school replication is
  refused and nothing is persisted on the unauthorized receiver.

## Consequences
* A missing `WHERE school_id = ?` would be a security bug; mitigated by the
  repository-only-SQL rule (no ad-hoc SQL elsewhere) and tenant-scoped query
  helpers.
* Per-school backup restore is coarser than with option A; school-scoped
  export/import remains possible via record-level filtering in the backup
  scope parameter.
