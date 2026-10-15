# ADR-0006 — Distributed identity via signed replication; offline revocation is eventually consistent

Status: accepted (2026-10, Phase 2)

## Context
A teacher created on Computer 17 must log in on Computers 18–20 without
internet; Computer 21 that never received the account must not pretend to know
better. Suspensions, role revocations and device revocations must propagate
the same way.

## Decision
Identity, roles, permissions and suspensions replicate as **signed
authorization operations** over the same op-log as every other record
(categories `device_identity`, `role_permissions`, `student_records`,
`staff_records`). Authentication on a node is possible *iff* that node holds
the credential record (the Argon2id hash travels inside the signed op payload,
re-sealed by the receiving node). Every auth-relevant op is signed by an
authorizer device, so nodes can verify provenance even offline.

* Revocation: a signed revocation op propagates like any record. A node that
  has not yet received it may still accept a session that the school would now
  deny — **this is documented as the fundamental offline revocation gap**
  (SECURITY_MODEL.md). Mitigations: short session TTLs for privileged roles,
  revocation fan-out on every connection (manifests include the
  `device_identity`/`role_permissions` checkpoints), and per-operation
  signature + trust re-checks.
* Sensitive administrative authority is therefore always bound to
  (a) verified user credentials, (b) signed role/permission records, and
  (c) a trusted device — never to "an admin claims to be logged in".

## Consequences
* No central identity service; enrollment is an authorized local operation
  that enqueues replication to policy-selected peers.
* Security Test D (administrator portability) and the RBAC negative tests pin
  this behaviour.
