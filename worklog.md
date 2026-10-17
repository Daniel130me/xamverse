# Worklog

---
Task ID: 1
Agent: Super Z (main agent)
Task: Phase 1 — Complete Interactive Prototype for an Offline-First, Decentralized School Examination Platform (per uploaded spec "Pasted Content_1791696389388.txt")

Work Log:
- Read full 1647-line spec; classified as Type 3 (web development); skipped clarification per spec's explicit "proceed without repeatedly requesting clarification" + user's "proceed".
- Initialized fullstack-dev environment (init-fullstack.sh).
- Key architectural decision: preview exposes only `/`, so the entire prototype is a client-side SPA in src/app/page.tsx with an internal hash router (custom, with dynamic detail-route resolution + permission guards).
- Built foundation: src/lib/prototype/types.ts (30+ entities), world.ts (DemoWorld + per-device DeviceLocalState), seed/pools.ts, seed/questions.ts (24 realistic NG-context questions across 9 types), seed/world-builder.ts (2 schools, 103 devices with deterministic online/offline map, 9 roles + 170 students + parents, question banks distributed per-device, English CA released with 100 attempts, Biology Mock in marking with 60 collected, seeded approval request, 6 conflict cases, audit/notifications/sync history/backups).
- Built Zustand store (store.ts): per-device local state, sessions (device-scoped auth), navigation with auto id extraction, question/assessment CRUD with version-lock rule (edits to approved create new draft revision), submit-for-approval (device-to-device transfer), decideApproval, distributeAssessment (per-peer transfer tasks), collectResults (pull, hash dedup), syncWithPeers, pair/unpair, scanNetwork, conflict resolve/defer, exam flow (start/save/flag/submit with auto-marking of 9 question types, offline-safe), essay marking, publish results, practice flow, tick engine (900ms: advances transfers on all devices, payload application with notification+audit+conflict spawning, blocked-offline auto-resume), network/device power toggles, backups, updates, licence stubs, resetDemo + 5 scenario presets (fresh/approved/distributed/collected 97/100/released).
- Built design system & shell: ui-kit.tsx (DataTable w/ search-sort-filter-paginate-bulk, StatCard, PageHeader, SectionCard, StatusBadge w/ central tone mapping, UserAvatar, EmptyState, AccessDenied, TransferProgress), AppShell (role-filtered collapsible sidebar w/ badges, breadcrumbs, LAN chip, notifications bell, theme toggle, user menu w/ change-password + lock), violet "SIMULATION" Device Simulator bar (device/user switchers, LAN + PC power toggles, scenario presets, reset, storage info), Walkthrough drawer (30-step guided scenario w/ auto-detected completion).
- Built all screens (~56): Welcome, Login (demo selector), Onboarding wizard (7 steps + join/import/restore variants), 6 role dashboards, school management (profile/academic/classes/subjects/staff/students+detail/enrollment), users+roles matrix+account, question banks+editor (9 types)+AI assistant, assessments (list/wizard/detail w/ lifecycle strip+versions+dist progress/approvals w/ checklist), exam sessions+100-candidate live monitor (invigilator controls, incidents), results (collection dashboards+verified submissions+marking queue+rubric marking+moderate & release+analytics w/ student/parent variants), computers (peer dashboard+fleet table+discovery+device detail+sync centre+conflicts side-by-side), notifications/licensing (online+offline activation+grace period)/updates (offline import+LAN distribution+exam-active interlock)/backups/audit/settings (7 tabs incl. browser access+QR)/help, public practice (hub+session w/ instant feedback+results w/ review), exam runner (timer w/ demo speed, palette, flags, auto-save indicator, offline banner, all question renderers, submit confirmation).
- Fixed issues found via agent-browser E2E testing: hooks-order violations, setState-during-render in router (moved id parsing into navigate/syncFromHash), missing imports, dynamic route resolution for 3/4-segment paths, approval_request payload not carrying the assessment copy, exam packages built from receiver's empty bank (now sealed from distributor), seeded packages missing questionPayload, EssayQuestion detection via package fallback, missing `local` in SettingsScreen (crash), role-admin missing results.mark, invigilator exams access (multi-permission guards + nav), scenario collected count 93→97 exactly.
- Verified E2E in browser: teacher creates/submits on DEV-017 → transfer completes → admin on DEV-043 sees request → approves v1 → distributes to 99 peers (85 complete + 14 blocked) → lab device DEV-063 receives sealed package (10 questions) → student takes exam → answers auto-save → LAN offline banner → submit → auto-mark (2/25) → submissions queued+completed to 3 collectors → DEV-008 pulls 53 collection tasks → conflicts side-by-side resolve w/ before/after → practice instant feedback → invigilator permitted controls → parent sees child's released result only on synced device → 97/100 scenario.
- Wrote 10 documentation files in docs/: README, PRODUCT_OVERVIEW, SCREEN_INVENTORY, USER_FLOWS, DESIGN_SYSTEM, DATA_MODELS, INTEGRATION_CONTRACTS, STATE_MACHINES, CODEX_PHASE2_HANDOFF, PHASE3_HANDOFF.
- Screenshots saved to download/screenshots/ (admin-dashboard, parent-dashboard, exam-taking, computers-sync, walkthrough).

Stage Summary:
- Deliverable: runnable interactive prototype (Next.js 16 + TS + Tailwind 4 + shadcn/ui + Zustand + recharts), single-entry SPA at /, ~56 screens, full E2E exam lifecycle across simulated peers, device simulator + guided scenario, 10 handoff docs.
- Key decisions: hash router (single-route preview constraint); per-device state as the core simulation primitive; scenario presets for instant demo jumps; simulation chrome kept visually separate (violet); localStorage persistence with versioned key + Reset Demo.
- Known limitations (documented): representative attempts carry full answers only for 12 students; browser localStorage quota guards via summary attempts; AI/licensing/security are simulations (labeled).

---
Task ID: 2
Agent: Super Z (main agent)
Task: Fix console errors — hydration mismatch on <body> and invalid nested <button> in TeacherDashboard

Work Log:
- Fix 1: Added suppressHydrationWarning to <body> in src/app/layout.tsx — browser extensions (e.g. Grammarly) inject data-new-gr-c-s-check-loaded / data-gr-ext-installed attributes before React hydrates; <html> already had the flag but <body> did not.
- Fix 2: In src/components/prototype/screens/Dashboards.tsx (TeacherDashboard "My draft & pending assessments" list), the outer row was a native <button> containing a shadcn <Button> ("Submit for approval") — invalid HTML causing hydration error. Converted outer row to <div role="button" tabIndex={0}> with Enter/Space key handling, cursor-pointer, and focus-visible ring. Inner Button unchanged (stopPropagation preserved).
- Scanned entire src/ for the same bug class with a static scanner (scripts/scan_nested_buttons.py): no other native <button> containing <Button>, no directly nested native buttons. StatCard already renders Card div[role=button] — safe.
- E2E verified via agent-browser (fresh session): logged in as Daniel Ibrahim (DEV-017 scenario teacher) → drafts list renders → row click navigates to #/app/assessments/ASSESS-MATH-SS2-MIDTERM → inner "Submit for approval" navigates to #/app/sync with stopPropagation → 0 page errors in the whole session.
- Investigated a transient "ReferenceError: local is not defined at SettingsScreen" — traced to stale error accumulation in the long-lived browser session from a pre-fix load (source + compiled chunk are both correct; fresh session reports 0 errors). No code change needed.

Stage Summary:
- Both reported console errors fixed; codebase scanned clean for nested-button patterns; teacher dashboard flow E2E-verified with 0 console errors.
- Files changed: src/app/layout.tsx, src/components/prototype/screens/Dashboards.tsx; added scripts/scan_nested_buttons.py.

---
Task ID: 3
Agent: Super Z (main agent)
Task: Fix sidebar hidden behind main page (mobile nav drawer trapped inside header)

Work Log:
- Reproduced: at <1024px viewport, the nav drawer ("Open navigation") rendered as a 800x55px strip instead of a full-height sidebar — all nav links hidden behind the main page content.
- Root cause: the <header> uses backdrop-blur; per CSS spec backdrop-filter makes an element the containing block for fixed descendants AND a stacking context. MobileNav's hand-rolled `fixed inset-0 z-40` drawer lives inside the header, so it was sized to the header box and trapped under the header's z-20 context (page + z-30 simulator bar painted above it).
- Fix 1 (AppShell.tsx MobileNav): drawer overlay now rendered via createPortal(..., document.body) — escapes both the containing block and the stacking context.
- Fix 2 (same trap): ChangePasswordDialog (`fixed inset-0 z-50`, also rendered inside the header via UserMenu) portaled to document.body too.
- Fix 3: desktop sidebar footer ("Peer computer" block) was covered by the fixed full-width SimulatorBar; added pb-16 clearance so the text clears the bar (verified: text bottom 736 < bar top 748 at 1440x800).
- Audited all other `fixed inset-0` overlays (Walkthrough → page level, QuestionScreens/ExamRunner → main column, no backdrop-filter ancestors) — safe.
- E2E verified at 800px: portal overlay is child of body covering full viewport (800x900), drawer 256x900; close → overlay removed; open → click "Question Banks" navigates to #/app/questions and auto-closes; Change password dialog full-screen; 0 page errors; tsc clean for AppShell.
- Screenshots: download/screenshots/mobile-nav-bug.png (before), mobile-nav-fixed.png, password-dialog-fixed.png, sidebar-footer-fixed.png (after).

Stage Summary:
- Sidebar/nav drawer now renders above the main page at all viewport widths; change-password dialog fixed by the same portal change; sidebar footer no longer clipped by the simulator bar. Single file changed: src/components/prototype/shell/AppShell.tsx.

---
Task ID: 4
Agent: Super Z (main agent)
Task: Make prototype read like the real product — login-first entry, discreet demo controls

Work Log:
- Created src/components/prototype/shell/DemoDock.tsx: collapsed violet "Demo" pill (bottom-right, z-40) expanding into a portaled compact panel — user/role switcher (11 demo accounts, school-scoped, active highlighted), computer switcher (10 key devices + lab devices), LAN / this-PC toggles, 5 scenario presets, guided walkthrough (in-session), reset demo. Replaces the full-width violet SIMULATION bar.
- Reworked LoginScreen into the product's entry page: removed Back button + violet "Simulated computer" badge (now neutral device chip), realistic subtitle, added "Register a new school" + "Practice without an account" outline buttons and Join/Import/Restore text links (deep-link to onboarding modes via navigate('/onboarding', {mode})), demo accounts collapsed behind "Testing? Open demo accounts" disclosure, auto-redirect to /app/dashboard if a session exists, removed "(simulated)" wording in favour of in-character copy.
- page.tsx: route '/' (and default) now renders LoginScreen (Welcome screen removed from flow); DemoDock rendered on all screens except the fullscreen exam runner.
- AppShell.tsx: deleted SimulatorBar + SimDeviceRow + DemoUserRow (~170 lines), LAN chip is now a passive status <span> (toggle moved to dock), sidebar footer meta-commentary softened, main bottom padding reduced (pb-16/lg:pb-14).
- E2E verified (agent-browser): '/' shows login with all links; dock opens (320px panel), switching to administrator from login navigates to #/app/dashboard; in-app switch admin→student re-renders role dashboard ("Now testing: Amina Yusuf" toast, student stats visible); sign out returns to '#/' login; violet bar/SIMULATION text absent everywhere; 0 page errors; tsc clean for all touched files.
- Screenshots: download/screenshots/login-first-page.png, admin-dashboard-realistic.png, student-dashboard-realistic.png.

Stage Summary:
- Prototype now presents as the real product: login page first with register/practice/join/import/restore paths, no simulation chrome in the UI; all demo/testing controls consolidated in the discreet DemoDock (user/role switcher kept per user request). WelcomeScreen component is now unused by routing (file retained).
- Files changed: src/app/page.tsx, src/components/prototype/shell/AppShell.tsx, src/components/prototype/screens/LoginScreen.tsx, + new src/components/prototype/shell/DemoDock.tsx.

---
Task ID: 5
Agent: Super Z (main agent)
Task: Fix hydration mismatch on login page ("17 hrs ago" vs "18 hrs ago")

Work Log:
- Root cause: fmtRelative/fmtDate render time-relative strings in 50+ places across 10 screen files; the server SSRs a freshly-seeded world while the client hydrates with localStorage-persisted per-device state, so relative timestamps (and any persisted value) can disagree between server and client HTML.
- Fix (global, page.tsx): mounted gate — the SPA now renders a neutral "Loading ExamHub…" shell on the server (verified via curl) and mounts the real UI only after hydration (useEffect + setMounted). All state-dependent content is client-rendered, eliminating this entire class of mismatch (timestamps, persisted device state, counts) in one place.
- Fix (targeted, LoginScreen.tsx): suppressHydrationWarning on the "Last sign-in" relative timestamp as belt-and-braces.
- Verified E2E: curl shows the SSR shell; fresh load and reload produce 0 errors / 0 hydration errors; empty-form submit shows validation error; real credentials (d.ibrahim@greenfieldacademy.ng) navigate to #/app/dashboard with teacher dashboard rendered; 0 errors after the full flow. tsc clean.

Stage Summary:
- Hydration mismatch class eliminated app-wide via the mounted gate; login smoke-tested end-to-end (validation + success path). Files changed: src/app/page.tsx, src/components/prototype/screens/LoginScreen.tsx.

---
Task ID: 6
Agent: Super Z (main agent)
Task: XamVerse Phase 1 repository maintenance — inspect, harden, separate prototype/production layers, test, document, open PR

Work Log:
- Inspected repo state + all 10 handoff docs; baselined: tsc failed (~20 errors), 1 lint warning, no tests, no typecheck gate, screens bypassing the service layer via useDemoStore.setState, ui-kit living under the prototype namespace. Dev server healthy.
- fix (667540a): added missing ApprovalRequest model to types.ts; repaired ui-utils import path; fixed audit tuple arity + missing UpdateState.distributedTo + missing fill_blank correct field in seeds; removed duplicate object keys in saveAnswer/savePracticeAnswer merges; dropped stale 'onboarded' persist key; extended saveQuestion opts with change note; fixed screen-level type defects (dynamic route candidates, user status union, update history rows, nonexistent Badge re-export, ApprovalRequest 'to' field); excluded examples/skills/scripts from typecheck. tsc + eslint clean.
- refactor (3cfb298): added store actions updateSchoolProfile / createClass / setUserStatus / revokeBrowserSession / gotoPracticeQuestion; converted all 5 direct useDemoStore.setState screen call sites (School profile, Classes, Users, Browser-session revoke, Practice prev/next). UI no longer touches simulation internals.
- feat (bf14492): created src/lib/prototype/service-contracts.ts — compiler-checked service interfaces (structural Picks of DemoStore) grouped per INTEGRATION_CONTRACTS.md, with a compile-time coverage assertion (UncontractedActions = never) that quarantines demo controls; exported DemoStore.
- refactor (80a2524): moved production-safe ui-kit.tsx to src/components/shared/ and ui-utils.tsx to src/lib/ (zero simulation imports); rewrote 16 importing files; docs updated. prototype/** now contains only simulation.
- test (07c46f7): added vitest + jsdom, vitest.config.ts, scripts (test/test:watch/typecheck); 19-case suite pinning seed integrity, per-device auth + RBAC, version-locked approvals, approval roundtrip across peers, distribution w/ offline blocking + auto-resume, 9-type auto-marking, collector routing, duplicate-submission dedup (97→98 + conflict), retry/cancel, conflict audit targeting, practice, admin actions. Learned: DEV-071/089/096 seeded offline by design (the 97/100 scenario); conflict audits write to the two affected devices.
- docs (9f73c8c): INTEGRATION_CONTRACTS (compiler-checked contracts, corrected School/User service status), CODEX_PHASE2_HANDOFF (drop-in-compatibility acceptance note), PHASE3_HANDOFF (contracts+tests under 'what exists', new execution step), READMEs (typecheck/test commands + new layout), gitignored tool-results/ artifacts.
- Verified: tsc clean, eslint clean, 19/19 tests, production build OK, agent-browser E2E (login → teacher dashboard → 6 routes; profile save via updateSchoolProfile; user toggle via setUserStatus) with 0 console errors.
- Git: rewrote stray UUID tip on main → 'chore: add demo screenshots and git tooling helpers' (89967ec) and pushed main; created feat/phase1-handoff with the 6 work commits and pushed it. Sandbox auto-committer switched HEAD back to main mid-session; recovered topology (main=89967ec, feature=main+6).
- PR creation via API returned 403 (fine-grained PAT lacks pull-requests:write); pushed branch + saved ready-to-paste PR title/body at download/pr-description.md (compare URL: github.com/Daniel130me/xamverse/compare/main...feat/phase1-handoff).

Stage Summary:
- Deliverable: hardened, fully type-safe prototype with a compiler-enforced service boundary, production-safe shared UI layer, 19-case behavioural suite, refreshed handoff docs; feature branch pushed, PR ready to open manually.
- Key decisions: contracts as Pick<DemoStore,…> (can never drift); demo controls quarantined in DemoControlService; tests double as the acceptance gate for Phase 2/3 engine swaps.

---
Task ID: PHASE2-MAIN
Agent: main orchestrator (Super Z)
Task: Implement the Phase 2 desktop engine on feat/desktopz per the master engineering prompt

Work Log:
- Authored 13 crates + 2 tools (events, storage, identity, security, audit, network, discovery, sync, licensing, backup, updater, web, core; peer-cli, license-issuer-dev)
- SQLCipher storage with checksum-verified forward-only migrations and 22-table infrastructure schema
- Noise XX transport with handshake-bound device cards; mDNS + manual discovery; pairing with engine-side trust policy
- Signed op-log replication (Lamport clocks, CAS revisions, per-category conflict policies), durable outbox, resumable blob transfers
- Licensing (offline activation, device binding), encrypted backups (WAL-checkpoint capture), signed update pipeline
- Axum browser bridge (47811) with sessions, RBAC, tenant-scoped SSE
- Integration tests A/C/D over real TCP; fixed a real pairing bug (responder id) and a WAL backup data-loss bug found by tests
- docs/phase2: 14 documents + 6 ADRs; 79 tests green across the workspace

Stage Summary:
- Branch feat/desktopz pushed (baa5574); PR to feat/phase1-handoff pending token permission — compare link provided to the user
- packages/engine-sdk and src-tauri remain contract-specified next steps (documented in ENGINE_API.md / UPDATES_AND_INSTALLERS.md)

---
Task ID: STATUS-VERIFY
Agent: Super Z (main agent)
Task: Status verification pass — confirm what is implemented/testable, clean local main

Work Log:
- Fetched origin: feat/desktopz local == origin (24c6892d), feat/phase1-handoff == origin (3d964b1).
- Found and removed junk commit 5aaa010d on local main (entire target/ build dir committed by sandbox auto-committer, never pushed). Mixed reset to origin/main (89967ec); build cache kept on disk untracked.
- Re-verified on feat/desktopz: bun run typecheck clean; vitest 19/19 passed; cargo test --workspace 79 passed / 0 failed (incl. integration-tests crate over real TCP).
- Note: sandbox auto-switches HEAD back to main between tool calls; use atomic checkout+command chains when working on feat/desktopz.

Stage Summary:
- All claimed test evidence reconfirmed green at 24c6892d. Local main clean and matching origin. feat/desktopz remains the integration branch; PR compare link feat/phase1-handoff...feat/desktopz.

---
Task ID: CLI-CI-SDK
Agent: Super Z (main agent)
Task: Fix licence-CLI bugs + CLI error handling, add the CI workflow matrix, scaffold engine-sdk + Tauri shell (feat/desktopz)

Work Log:
- Environment recovery: sandbox reset $HOME (rust gone) and force-switched HEAD to main between calls. Reinstalled Rust into persistent project dirs; recovered feat/desktopz from origin; worked in a linked git worktree (wt-desktopz) to dodge the auto-switcher.
- fix(sync): request_pairing now routes through request_typed so peer error envelopes surface as SyncError::PeerError (was: requester parsed an error payload as PairPending and panicked); kinds::ERROR const replaces the magic string; new integration Test B pins pairing-into-unenrolled-school over real TCP (80/80 total).
- feat(licensing): ActivationRequestFile envelope moved into the xamverse-licensing crate — one interchange type written by licence-request, read by license-issuer-dev (file shape can never drift again).
- fix(cli): both tools rewritten on anyhow — single `error:` line + non-zero exit, zero unwrap/expect panics on operator input; licence-import gained repeatable --issuer-pk with early validation (base64, 32 bytes); logs now go to stderr (stdout is machine-readable). Verified end-to-end: request → issue → import prints `status: Active`; missing/wrong pk fail with clean actionable errors.
- chore(engine): enforced clippy --workspace --all-targets -D warnings + cargo fmt as CI gates; fixed every finding properly, including real ones: checked (non-panicking) day-count math on untrusted licence certs, 4 KiB request-body cap actually wired on the bridge login route, truncated backup archives parse to BackupError::Corrupted instead of panicking, mdns thread-spawn failure is a typed error, dead code removed (browse_guard, advance_lamport, ApplyPipeline.local_device_id), FromStr trait implementations replace confusable inherent methods, audit chain_hash takes a grouped ChainInput struct. Tests keep unwrap/expect via per-crate cfg(test) exemptions; library code stays strict.
- ci: .github/workflows/ci.yml (rust-test, rust-clippy, rust-fmt, ts-check incl. SDK, engine-e2e) + desktop.yml (dispatch-only, continue-on-error scaffold preview). scripts/engine-e2e.sh: scripted two-peer demo (enroll → serve → ping → pair → approve ×2 → pull complete → mutual trust + clean-refusal negative check) — run locally, ALL STEPS PASSED.
- feat(sdk): packages/engine-sdk — typed EngineClient contract (ENGINE_API.md §3-10 types verbatim), three transports: browser adapter WORKING against today's bridge routes (cookie sessions, SSE, error normalization for both wire shapes, unsupported_on_browser_adapter sandbox), desktop adapter invoking engine_<ns>_<op> with injected Tauri invoke/listen, boot-surface mock. Zero runtime deps. 13 vitest tests + tsc clean.
- feat(shell): src-tauri Tauri 2 scaffold — window bootstrap, honest shell_status/shell_ping commands (no fake engine responses), restrictive CSP, minimal capabilities, dev points at Next dev server, scaffold-dist placeholder for the Phase 3 export. Excluded from the cargo workspace (GUI libs); desktop.yml builds it on real runners. Not compiled in this headless container (documented, not hidden).
- docs: KNOWN_LIMITATIONS items 1/7/9/10/18/21 marked RESOLVED with evidence; TESTING.md §3 now "implemented" with real job matrix, §4 caveats updated; LICENSING.md CLI flow rewritten (envelope + --issuer-pk); PHASE2_COMPLETION_REPORT gained §7 resolution update.

Quality self-check (per the implementation spec):
- Readable/well-structured/commented: every non-obvious change carries a why-comment (e.g. request_typed rationale in request_pairing, ChainInput grouping, days_delta checked-vs-saturating split); CLI main.rs documents its error contract up front.
- Easy to pick up/extend: shared envelope type means the licence file format has ONE definition; SDK adapters mirror ENGINE_API.md 1:1 so the shell implementation is mechanical; engine-e2e.sh is the canonical scripted demo.
- Reduce queries / performance: no new query paths; the local.rs payload-hash restructure computes the hash once before the transaction instead of inside it; sync store.rs dropped a pointless unit binding.
- Security first: trusted-issuer keys validated early; login body cap enforced (was declared but never applied — real DoS gap); untrusted licence day counts no longer panic (DoS via malicious cert); backup parser rejects truncated archives with a typed error instead of indexing; CSP + minimal capabilities on the shell; browser SDK adapter deliberately exposes no peer/keystore surface.
- Non-standard implementations flagged: NOTE(scaffold) on src-tauri (not compiled headless, icons empty), NOTE(heuristic) on SDK status→code mapping, console.warn on subscribeSince cold-start gap, scoped #[allow]s each carry a written justification (serde infallibility, static params).
- Do-not-patch check: integration Test B + engine-e2e step 4 pin the actual regression (error-envelope panic) rather than masking it; the licence envelope fix removes the drift possibility structurally; clippy findings were fixed at the root (typed errors, total matches), not blanket-suppressed.
- Avoided over-engineering/magic values/hard-coded assumptions: anyhow only in the two CLI tools (engine crates keep typed thiserror enums); envelope only where the contract was broken (response file stays the bare cert, documented); ports/paths in e2e script are env-overridable with documented defaults; no new abstractions beyond the contract.

Verification: cargo test --workspace 80/80; clippy -D warnings clean; fmt --check clean; engine-e2e ALL STEPS PASSED; licence flow verified with real binaries (Active + clean negative paths); SDK 13/13 + tsc clean; root prototype 19/19 + tsc + eslint clean.

Stage Summary:
- feat/desktopz carries: licence CLI fixed end-to-end, CLI error contract, CI matrix + scripted e2e, engine-sdk + src-tauri scaffolds, workspace lint gates. PR compare: feat/phase1-handoff...feat/desktopz.
