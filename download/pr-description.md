## Phase 1 handoff hardening — XamVerse interactive prototype

Implements the repository-maintenance brief: preserves and improves the existing prototype (no rebuilds), enforces the service-layer architecture for the Phase 2 desktop engine, separates prototype simulations from reusable production UI, and adds the missing verification infrastructure.

### What changed (6 commits)

**1. `fix: resolve all type errors across data layer, store and screens`**
`tsc --noEmit` now passes clean (it previously failed with ~20 errors). Added the missing `ApprovalRequest` model, repaired broken import paths, audit-tuple arity, duplicate object keys in answer-merge logic, a stale `onboarded` persist key, and various screen-level type defects.

**2. `refactor(store): route all screen mutations through service-layer actions`**
Five screens were calling `useDemoStore.setState({ world })` directly, violating the documented boundary ("UI components never touch simulation internals directly"). Added `updateSchoolProfile`, `createClass`, `setUserStatus`, `revokeBrowserSession`, `gotoPracticeQuestion` store actions and converted all call sites. No screen reaches into simulation internals any more.

**3. `feat(services): add compiler-checked service contracts for engine handoff`**
New `src/lib/prototype/service-contracts.ts` groups the store's action surface into the service interfaces from `docs/INTEGRATION_CONTRACTS.md` (Auth, School, User, QuestionBank, Assessment, ExamAttempt, Results, PeerDiscovery, Sync, Conflict, Notification, Audit, Backup, Update, Licensing, Practice). Contracts are structural `Pick`s of the store, so they can never drift. A compile-time assertion (`UncontractedActions = never`) forces every future business action to join a service; demo-only controls are quarantined.

**4. `refactor(ui): extract production-safe UI kit from the prototype layer`**
`ui-kit.tsx` → `src/components/shared/ui-kit.tsx` and `ui-utils.tsx` → `src/lib/ui-utils.tsx` — zero simulation imports, reusable by Phase 3 production screens as-is. `src/components/prototype/**` now contains only the simulation (blueprint screens, shell, demo dock).

**5. `test(store): add vitest suite pinning the simulated service layer's behaviour`**
19 tests covering: seeded world integrity, per-device isolation, per-device auth + RBAC, version-locked approvals, the submit→review→approve peer roundtrip, distribution with offline blocking + auto-resume, all-9-type auto-marking, collector routing, hash-based duplicate detection (97→98, never double-counted), transfer retry/cancel, conflict audit trail, practice flow and admin actions. This is the acceptance gate any Phase 2/3 engine implementation must pass to be drop-in compatible.

**6. `docs: refresh handoff set for service contracts, tests and layering`**
INTEGRATION_CONTRACTS / CODEX_PHASE2_HANDOFF / PHASE3_HANDOFF / READMEs updated for the new architecture, commands and layout; sandbox artifacts gitignored.

### Verification
- `bun run typecheck` — clean
- `bun run lint` — clean
- `bun run test` — 19/19 passing
- `bun run build` — production build succeeds
- E2E (headless browser): login → teacher dashboard → 6 routes, school-profile save and user-status toggle through the new service actions — **0 console errors**
- Prototype remains a standalone, executable, clickable reference application (verified running)

### Handoff docs
Phase 2 and Phase 3 handoff documents are updated and accurate: engine teams get compiler-checked interfaces plus a behavioural test suite; the prototype stays the standalone UX reference.
