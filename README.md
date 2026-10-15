# ExamHub — Phase 1 Interactive Prototype

A complete, clickable prototype of an **offline-first, decentralized school examination platform**. Every installation is an autonomous peer computer with its own local records — there is no central server and no permanently designated admin/teacher/student computer. The signed-in user's role decides the interface.

> **Simulation notice**: this is a Phase 1 design prototype. All data is stored in your browser's localStorage. Security, synchronization, licensing, updates and AI are realistic *simulations* — nothing here is production-secure, and no real examinations are conducted.

---

## Running the prototype

The dev server runs on port 3000 (the preview panel shows it automatically; use **Open in New Tab** for the best experience).

```bash
bun run dev     # already running in this environment
bun run lint    # code quality check
```

The entire app is a client-side SPA exposed on `/` with an internal hash router (`#/login`, `#/app/assessments`, `#/exam`, …). Source layout:

```
src/
  app/page.tsx                       # SPA entry + internal router
  lib/
    ui-utils.tsx                     # statuses, formatting, tone mapping (production-safe)
    prototype/
      types.ts                        # conceptual data models (see docs/DATA_MODELS.md)
      world.ts                        # DemoWorld/DeviceLocalState model
      service-contracts.ts            # compiler-checked service interfaces (see docs/INTEGRATION_CONTRACTS.md)
      store.ts                        # Zustand store = mock service layer + sync engine
      seed/                           # deterministic demo world (2 schools, 103 devices…)
  components/
    shared/ui-kit.tsx                 # DataTable, StatCard, StatusBadge, PageHeader… (production-safe)
    prototype/
      shell/AppShell.tsx              # sidebar, header, Device Simulator bar
      screens/*.tsx                   # every module's screens (see docs/SCREEN_INVENTORY.md)
docs/                                # the 10 handoff documents
```

## Demo login

Open `#/login` and click a demo account — no passwords needed:

| Account | Role | Start on | Try this |
|---|---|---|---|
| Mr. Daniel Ibrahim | Teacher (Mathematics) | DEV-017 | Open the seeded math draft → Submit for approval → DEV-043 |
| Mrs. Adaeze Okafor | Administrator | DEV-043 | Approvals → Approve → Distribute to all 100 computers |
| Mr. Tunde Olawale | Administrator (2nd) | DEV-008 | Results → Collect from peers (was never creator/approver) |
| Amina Yusuf | Student | any lab PC (DEV-061+) | Take exams delivered to that computer; works offline |
| Mr. Chukwuemeka Nwosu | Examination Officer | DEV-005 | Calendar, monitoring, collection |
| Mr. Henry Osaze | Invigilator | DEV-090 | Live roster, pause/resume, incident logging |
| Dr. Grace Ade | Head of Department | DEV-022 | Question reviews, analytics |
| Mrs. Kemi Adeleke | Parent | DEV-061 | Child's released results (only where synced!) |
| Dr. Benjamin Adeyemi | Proprietor | DEV-001 | Licence & billing |
| Sam Igbinedion | Technical Support | DEV-001 | Updates, backups, diagnostics |

Multi-school: switch to **DEV-101** (Little Stars) to see strict school isolation and the licence **grace period**.

## Device Simulator (bottom bar)

- **Switch simulated computer** / **Switch demo user** — switching a computer always ends the session (auth is per device).
- **LAN online/offline** — pauses all transfers; exams keep running and saving locally; transfers auto-resume on reconnect.
- **This PC online/offline** — make one peer unreachable (distribution/collection then shows pending + retries).
- **Guided scenario** — the 30-step exam lifecycle story with auto-detected completion; click any step to jump.
- **More… → scenario presets** — jump the world to: ① fresh draft · ② approved · ③ distributed to 100 PCs · ④ collected 97/100 · ⑤ released.
- **Reset demo** — rebuild the seeded world.

## Major routes

```
#/                       Welcome (get started, join, import, restore, practice)
#/login                  Sign-in + demo accounts
#/onboarding             Setup wizard (register / join / import / restore)
#/practice               Public practice (anonymous, instant feedback)
#/exam                   Student exam area (choose → take → submitted)
#/app/dashboard          Role-specific dashboards
#/app/school/*           Profile, academic setup, classes, subjects, staff, students, enrollment
#/app/users              Accounts · /app/users/roles Roles & permissions
#/app/questions          Question banks · /app/questions/editor · /app/ai-assistant
#/app/assessments        List · new wizard · detail · /app/approvals
#/app/exams              Sessions · live monitoring (100 candidates)
#/app/results            Collection · marking queue · moderate & release
#/app/analytics          Performance analytics (school + personal views)
#/app/computers          Fleet + discovery · /app/computers/<id> detail · /app/sync Sync centre
#/app/conflicts          Conflict management (6 seeded cases + live duplicates)
#/app/notifications      Notification centre
#/app/licensing          Plans, online & offline activation, grace period
#/app/updates            Offline update import & LAN distribution
#/app/backups            Backup/restore
#/app/audit              Audit logs · /app/settings (+ browser access) · /app/help
```

## The complete demonstration scenario (100 computers)

1. **DEV-017 / Daniel** — create (or open) the Math mid-term draft → *Submit for approval* → choose DEV-043.
2. **DEV-043 / Adaeze** — *Approvals* → Review → **Approve** (version-locked) → open assessment → **Distribute** → Select all → Start.
3. Watch the transfer queue (some peers are offline → pending; they resume on reconnect).
4. **DEV-063 / Amina** — dashboard shows the exam (only because it was delivered here) → **Start exam** → answer → toggle *LAN offline* → keep answering (saves locally) → submit.
5. **DEV-008 / Tunde** — *Results* → Collect from peers (pull) → duplicates never count twice → missing results stay visible until devices reconnect → release results.
6. **DEV-043 / Adaeze** — Conflicts → resolve side-by-side (try CONF-004 duplicate submission).

Scenario preset ④/⑤ reproduce steps 4–6 instantly if you want the punchline without the build-up.

## Developer notes

- Global tick (900 ms) drives transfers + exam timer: `useDemoStore.getState().tick()`.
- Debug hook: `window.__examhub` (the store) is exposed for support/testing.
- Persistence: localStorage key `examhub-demo-v1`; "Reset demo" rebuilds from `buildWorld()`.
- Storage budget: representative attempts carry full answers; the rest carry summaries (documented in `docs/DATA_MODELS.md`).

## Documentation set

| File | Contents |
|---|---|
| `docs/PRODUCT_OVERVIEW.md` | Product purpose, users, capabilities, principles |
| `docs/SCREEN_INVENTORY.md` | Every screen: route, users, features, interactions |
| `docs/USER_FLOWS.md` | Step-by-step workflows (onboarding → results release) |
| `docs/DESIGN_SYSTEM.md` | Tokens, components, patterns, accessibility |
| `docs/DATA_MODELS.md` | Conceptual entities & invariants |
| `docs/INTEGRATION_CONTRACTS.md` | Service interfaces; Phase 2 vs 3 ownership |
| `docs/STATE_MACHINES.md` | All lifecycle state machines |
| `docs/CODEX_PHASE2_HANDOFF.md` | Desktop engine requirements for Codex |
| `docs/PHASE3_HANDOFF.md` | App agent conversion map |
| `README.md` | This file |
