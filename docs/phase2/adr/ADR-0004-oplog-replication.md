# ADR-0004 — Operation-log replication with CAS revisions; no last-write-wins

Status: accepted (2026-10, Phase 2)

## Context
Schools run many computers that modify data concurrently and go offline
freely. Timestamp-based last-write-wins silently destroys concurrent edits —
unacceptable for examination data.

## Decision
Replicate an **operation log**, not table snapshots:

* `SyncOp { op_id (ULID/uuidv7), school_id, category, object_id, revision,
  base_revision, author_device_id, lamport, payload_sha256, payload,
  tombstone, signature }`.
* `revision` is a per-object monotonic counter owned by the object's replica;
  `base_revision` is the revision the author saw (a compare-and-swap tag).
* A **Lamport clock** orders causally; device wall-clocks are informational
  only and never decide conflicts.
* Apply pipeline detects: duplicates (same `op_id`), equal-content rewrites
  (same `payload_sha256`), concurrent edits (`base_revision` stale),
  update-vs-delete, divergent same-revision content, missing parents, and
  immutable-category violations. Each maps to a per-category strategy:
  preserve-both, quarantine, reject, or manual resolution — with resolution
  history retained.
* Exam invariants are category policies: `assessment_package` accepts only
  revision 1 (immutable snapshot); finalized `submission`/`exam_attempt` ops
  are immutable; conflicting content for the same attempt becomes a conflict
  record, never a silent overwrite.

## Consequences
* Conflicts are *data* (queryable, resolvable, auditable), not exceptions.
* Sync is naturally incremental and idempotent — safe retries after lost
  acks.
* Phase 3 registers deeper per-category validators without touching the
  engine's generic pipeline.
