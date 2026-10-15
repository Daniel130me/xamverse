# ExamHub — PHASE3_HANDOFF.md

Handoff for the application development agent (Phase 3). Phase 1 delivered a complete, interactive UX/UI blueprint with mock services; Phase 3 converts it into production functionality on top of the Phase 2 desktop engine.

## 1. What exists and must be preserved
- **All screens & navigation** (`src/components/prototype/screens/*`, `src/components/prototype/shell/*`) — layouts, states, copy and interaction patterns are the agreed UX reference.
- **Design system** (`docs/DESIGN_SYSTEM.md`, `src/components/shared/ui-kit.tsx` — production-safe, reusable as-is) — tokens, components, patterns.
- **Type definitions** (`src/lib/prototype/types.ts`) — conceptual models for all entities.
- **Service boundaries** (`src/lib/prototype/service-contracts.ts` — compiler-checked interfaces per `docs/INTEGRATION_CONTRACTS.md`; implemented today by `store.ts`).
- **Behavioural tests** (`src/lib/prototype/__tests__/store.test.ts`) — 19 vitest cases pinning the state machines, dedup, RBAC and sync semantics; the acceptance suite for any engine swap.
- **Seed scenarios** (`src/lib/prototype/seed/*`) — as fixtures for tests and demos.

## 2. Conversion map: mock → production

| Module | Prototype mock | Production requirement (Phase 3) |
|---|---|---|
| Auth | `login(userId)` demo selector, no real credentials | Real auth against the engine's local store; offline cache; password recovery via authorized peer; session lock/expiry |
| School & academics | Mutating `world` object directly | Repositories backed by the engine DB; migration of seeded fixtures to real onboarding data |
| Users & roles | In-memory permission matrix | Enforce permissions engine-side; keep UI guards as first line; add invitation flows by pairing code |
| Question banks | Direct store writes | Engine persistence; rich-text/equation editor upgrade (the prototype uses placeholders); real media attachments |
| AI assistant | Predefined generated outputs | Cloud provider integration (internet-gated) + local model via the engine; streaming, cost/usage display, curriculum alignment data |
| Assessments | Version objects in store | Version-chain persistence; sealed package generation with signed validity windows; eligibility policy engine |
| Exam runner | Local timers + auto-mark in store | Engine-decrypted package views, authoritative timer, secure auto-mark, resumption tokens, invigilator resume codes |
| Results & marking | Hash-dedup in `applyPayload` | Server-grade dedup, moderation workflows, mark schemes, export generators (XLSX/PDF), printable sheets |
| Analytics | Recharts over local attempts | Aggregation queries over the engine DB; multi-device consolidation-aware (a computer only analyses what it holds + replicas it is authorized to pull) |
| Computers & Sync | Simulated transfers | Real SyncService; keep all progress/retry/conflict UI as-is |
| Conflicts | Seeded cases + live duplicate case | Real detection events from the engine; keep the resolution UX verbatim |
| Licensing | State-flipping buttons | Licence UI states driven by `LicensingService.status()`; offline activation file handling with real files |
| Updates | Fake package import | Real package pipeline; keep the exam-active interlock banner |
| Backups | Fake create/restore | Engine BackupService; keep backup-vs-sync explanation copy |
| Notifications | Store pushes | Engine event bus → real-time in-app delivery; keep the 16 kinds |
| Audit | Local array | Append-only engine log with query/export; keep filters |
| Practice | Same store, guest name | Anonymous guest store with TTL purge; account linking after identity verification |

## 3. Screens/workflows with the highest fidelity bar
1. **Exam runner** (`ExamRunner.tsx`) — must support all 9 question types against engine-decrypted packages, authoritative timers, offline continuation, resumption. The prototype's renderer (`QuestionRenderer`) is the specification.
2. **Assessment approval & distribution** — the version-locking rule is a hard business requirement; keep the lifecycle strip, per-computer distribution progress and the "new revision on edit of approved" behaviour.
3. **Computers & Sync + Sync Centre** — the fleet table, transfer queue with progress/speeds/retries and collect dialog are the operational heart; keep them real-time.
4. **Conflicts** — side-by-side resolution with before/after audit is a differentiator; do not simplify.
5. **Dashboards** — role-specific cards already encode the right information scent; connect them to real aggregates.

## 4. Suggested Phase 3 execution order
1. Swap AuthService + session plumbing; remove demo selector behind a build flag.
2. Wire Question banks + Assessment wizard/detail to real repositories.
3. Implement the exam runner against sealed packages; harden timers and auto-save batching.
4. Wire Sync/Discovery/Collection UI to the engine's transfer events (the store's `tick()` becomes an event subscriber).
5. Results, marking, moderation, exports; analytics queries.
6. Licensing, updates, backups, browser-access features.
7. Conflict engine integration; notifications bus; audit queries.
8. Promote the remaining screen-level simulations (subject creation, invitations, password resets, custom roles, enrollment imports) into `SchoolService`/`UserService` store actions per `INTEGRATION_CONTRACTS.md`.
9. Accessibility & responsive polish pass; localisation hooks (`next-intl` is installed).

## 5. Acceptance inheritance
All 28 acceptance criteria in the Phase 1 brief apply, plus: no UI rewrite of prototype screens should be required when swapping mocks — if a UI change is forced by the engine, document the deviation in the PR referencing this file.
