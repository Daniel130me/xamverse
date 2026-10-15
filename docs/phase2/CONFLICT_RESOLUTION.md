# Conflict Resolution — kinds, strategies and resolution paths

This document defines what a conflict is in the XamVerse engine, the complete
table of conflict kinds produced by the apply pipeline, how per-category
strategies select outcomes, the three resolution paths
(`AcceptIncoming` / `KeepLocal` / defer), why the Lamport clock rather than
wall-clock timestamps orders causality, and the exam invariants the pipeline
is required to uphold. Sources: `crates/xamverse-sync/src/{apply,conflict,
category,local}.rs`, ADR-0004.

---

## 1. Conflicts are data, not exceptions

A conflict is a **row** in the `conflicts` table (see `DATABASE.md`), created
transactionally by the apply pipeline at the moment of detection. It carries
the incoming op id, the local op it collided with, the incoming payload (for
side-by-side display), the strategy that applied and an
`open | resolved | deferred` status. Nothing is ever silently overwritten:
ADR-0004 rejects timestamp-based last-write-wins because it destroys
concurrent edits, which is unacceptable for examination data.

Consequences of that choice, per the ADR:

* conflicts are queryable, resolvable and auditable;
* sync stays incremental and idempotent — safe retries after lost acks;
* Phase 3 can register deeper per-category validators without touching the
  generic pipeline.

## 2. Conflict kinds

All kinds produced by `ApplyPipeline::apply_one` (exact strings persisted in
`conflicts.kind`):

| Kind | Detected when | Default strategy | Meaning |
|---|---|---|---|
| `schema_unsupported` | op's category is not in the registry | `Quarantine` | future/unknown category — quarantined, never a silent no-op (spec §12) |
| `unauthorized_restricted_payload` | restricted category from a sender that is not fully trusted | `Quarantine` | security quarantine; also emits a `security.alert` event |
| `divergent_revision` | op `revision == current_revision` but `payload_sha256` differs | category default (`Manual`, `Quarantine` or `Reject`) | two devices produced different content for the same revision |
| `stale_revision` | op `revision < current_revision` | *(not a conflict)* | rejected: `Rejected { stale_revision: object already advanced past this op }` |
| `immutable_violation` | immutable category receiving `revision > 1` (object already exists) | `Reject` | exam snapshots/finalized submissions never change |
| `update_vs_delete` | op's tombstone flag differs from the object's current tombstone | category default | concurrent update and delete |
| `concurrent_update` | non-immutable op whose `base_revision` ≠ current revision | category default (`Reject`-strategy categories are rejected instead) | classic concurrent edit — CAS base mismatch |
| `invalid_signature` / `payload_hash_mismatch` / `unknown_author` | signature gate failures | *(not conflicts)* | rejected outright with an actionable reason; never persisted as object state |

The distinction matters: **conflicts are preserved with full incoming
payload** so a human can decide; **rejections** are terminal receipts telling
the sender why nothing was kept (e.g. `unknown_author: request
device_identity sync for this author first`).

## 3. Per-category strategies

`ConflictStrategy` (from the storage repos, re-exported by the sync crate):

| Strategy | Apply-time behaviour | Resolution availability |
|---|---|---|
| `Manual` | record open conflict; object state unchanged | `AcceptIncoming` or `KeepLocal` by an authorized user |
| `Quarantine` | record conflict; payload preserved for inspection | same as Manual, plus audit review workflow |
| `Reject` | refuse the op outright (`Rejected` receipt) | not resolvable — the sender must rebase and re-create |

Category defaults (from `category.rs`):

| Category group | Default strategy | Rationale |
|---|---|---|
| restricted (identity/permissions/staff/student records) | `Quarantine` | provenance violations must be inspectable, not dropped |
| immutable (`assessment_package`, `exam_attempt`, `submission`) | `Reject` | there is no "merging" a finalized exam snapshot |
| standard (everything else) | `Manual` | school decides; side-by-side UI (Phase 1 pattern) |

## 4. Resolution paths

`ConflictService` (engine-enforced, audited; the UI only calls it):

```rust
pub enum Resolution { AcceptIncoming, KeepLocal }

pub fn resolve(&self, conflict_id: &str, resolution: Resolution,
               resolved_by: &str, note: Option<&str>) -> StorageResult<OpOutcome>;
pub fn defer(&self, conflict_id: &str) -> StorageResult<()>;
```

| Path | What happens | Receipt semantics |
|---|---|---|
| `AcceptIncoming` | the quarantined op is re-loaded from the log and **force-applied** past the CAS check via `ApplyPipeline::apply_resolved` (signature and trust were verified when the conflict was recorded; the waiver is auditable through the conflict row) | `Applied` (or `Duplicate` if already applied) |
| `KeepLocal` | the incoming revision is discarded permanently; local object state untouched | `Rejected { "resolved: local revision kept" }` |
| `defer` | status → `deferred`; the conflict stays listed for a later decision | none |

Guard rails:

* Resolution requires an open conflict (double resolution is refused —
  tested), the acting user id is stored (`resolved_by`) and the resolution is
  written to the audit chain (`sync.conflict_resolved` with resolution, note,
  category, object id) plus a `conflict.resolved` event.
* Permission-wise, callers must hold the reserved `sync.resolve_conflict`
  permission (`Authz::require`, denial audited) — this is the engine's
  boundary, not the UI's.
* `AcceptIncoming` re-walks the log insert + object state update
  transactionally, so the materialized state and the op log can never drift
  from the recorded decision.

## 5. Lamport clock vs wall clock — rationale

Each school's clock on each node is a `kv` counter (`lamport.<school_id>`):

* **Create:** `next = local + 1`, stamped into the op, committed atomically
  with the op.
* **Observe:** applying a remote op with `lamport > local` advances the local
  clock to that value.
* **Ordering:** manifests and op indexes order by `(school_id, lamport)`
  (`idx_ops_school_lamport`); checkpoints are Lamport watermarks.

Why not wall clocks:

* School PCs have no internet; RTC batteries die; someone sets the wrong
  year. Any rule where "newer timestamp wins" silently destroys one side of
  a concurrent edit based on **broken** information.
* Lamport clocks capture exactly what matters — causal precedence ("did I
  create my change before seeing yours?") — with no infrastructure and no
  trust assumption about anyone's clock.
* Wall-clock timestamps are still recorded (`created_at`, `received_at`,
  `detected_at`) for human display and audit windows; they are simply never
  an input to conflict decisions.
* Ties are fine: equal Lamport values from concurrent devices produce
  `concurrent_update`/`divergent_revision` conflicts by the CAS rules, and a
  human or category policy resolves them — the clock only provides partial
  order, correctness comes from CAS + signatures.

Exam **timers** are a separate concern (monotonic engine timing per the
Phase 1 handoff); they also never use wall clocks as authority.

## 6. Exam invariants (what the pipeline must guarantee)

1. **Packages are immutable snapshots.** `assessment_package` accepts only
   revision 1; a second revision anywhere (local `create` or remote apply)
   fails (`immutable_violation` conflict remotely, `AlreadyExists` locally).
   Approval signatures bind to `content_sha256`, so the graded artifact is
   bit-identical to the approved one.
2. **Finalized attempts are immutable.** `exam_attempt` / `submission`
   behave identically; `AttemptStore::finalize` refuses a second finalize and
   refuses to finalize a broken event chain.
3. **A conflicting submission becomes a conflict record, never an
   overwrite.** Two devices claiming content for the same attempt object
   produce `divergent_revision`/`concurrent_update` conflicts preserved with
   both payloads — the invigilator/collector sees both, decides once, and the
   decision is audited.
4. **Duplicate submissions are idempotent.** The same attempt re-delivered
   (retry, multiple collectors) lands as `Duplicate` — a new record is never
   created (per-attempt `op_id` + `UNIQUE(school_id, category, object_id,
   revision)`); collection receipts are unique per
   `(attempt_id, collector_device_id)`.
5. **Restricted records cannot enter from untrusted senders.**
   `student_records`, `staff_records`, `role_permissions`,
   `device_identity` from a non-trusted transport peer are quarantined as
   `unauthorized_restricted_payload` with a `security.alert`.
6. **Cross-tenant data never lands.** The tenant gates run before payload
   parsing; a sender cannot smuggle another school inside a batch
   (`school_mismatch`).
7. **Unknown shapes are quarantined, not dropped.** Unknown categories
   (`schema_unsupported`) and malformed payloads surface as data a human can
   inspect — the Phase 1 prototype's "conflict side-by-side" workflow remains
   valid.
8. **Resolution is a privileged, audited act.** Only `sync.resolve_conflict`
   holders resolve; every decision is in the hash-chained audit log with the
   resolver's identity and note.
