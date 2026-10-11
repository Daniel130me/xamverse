# ExamHub — PRODUCT_OVERVIEW.md

## What the product is

ExamHub is a **decentralized, offline-first school examination and assessment platform** for primary schools, secondary schools, examination centres and educational institutions that cannot rely on dependable internet connectivity. It ships as an installable desktop application (Windows and macOS in Phase 2) and additionally serves a read-adjacent browser experience through any installed desktop peer on the same local network.

The product's defining idea is that **there is no central school server and no permanently designated admin/teacher/student computer**. Every installed desktop application is an autonomous *peer*: it owns a local database, works alone when isolated, discovers neighbouring peers on the LAN, exchanges authorized data with them, and retains whatever it has received even after the sender disappears. The currently authenticated user — not the machine — determines which interface and capabilities appear.

## Who uses it

| Role | What they do in ExamHub |
|---|---|
| Proprietor / Owner | School oversight, licence & billing management |
| Administrator | Day-to-day operations: users, approvals, distribution, collection, conflicts, settings |
| Examination Officer | Exam calendar, approvals, distribution, live monitoring, collection |
| Head of Department | Reviews departmental questions & assessments, marks, analytics |
| Teacher | Question authoring, AI-assisted drafting, assessment creation, essay marking |
| Invigilator | Live session supervision, candidate controls, incident logging |
| Student | Takes controlled exams & public practice, views own released results |
| Parent / Guardian | Views linked children's released results and recommendations |
| Technical Support Admin | Devices, updates, backups, diagnostics |

## Core capabilities

- **School self-onboarding**: guided wizard covering school identity, academic calendar, classes, subjects, administrator account, device naming and plan selection. Supports registering a new school, joining an existing school via peer pairing, importing CSV/Excel data, and restoring from an encrypted backup.
- **Multi-school isolation**: one installation can hold several schools; identities, users, devices and records are strictly separated (demo: Greenfield Academy vs Little Stars Primary).
- **People & academics**: staff and student records, classes and arms, subjects, departments, sessions/terms, grading schemes, enrollment imports, promotion/transfer, registration codes, parent associations.
- **Role-based access control**: 9 built-in roles plus custom roles with 30+ granular permissions; navigation, screens and even data payloads are permission-scoped. Access-denied states are explicit and audited.
- **Question banks**: nine question types (single choice, multiple response, true/false, short answer, numeric, essay, matching, ordering, fill-in-the-blank) with topics, difficulty, marks, timing, tags, explanations, worked solutions, hints, media placeholders, versioning, review workflow and usage history.
- **AI question assistant**: generate drafts from typed instructions, lesson notes or an uploaded document; regenerate, edit, accept into drafts; explicit availability states for cloud AI (needs internet) and local AI (offline).
- **Assessment lifecycle**: draft → pending approval → approved → distributing → distributed → active → completed → marking → awaiting result approval → results released → archived, with **version-locked approvals** (an approval binds to one exact version; edits create a new draft revision and never mutate the approved copy).
- **Controlled examination delivery**: approved packages are sealed locally on each peer; students only see exams delivered to *their* computer. Timers, question palette, flagging, auto-save, offline continuation, resumption, time-expiry auto-submit.
- **Public practice**: anonymous, guest-identity practice with instant feedback and a clear retention policy, never merged into academic records.
- **Peer-to-peer sync**: discovery, pairing/trust, manual IP, selective payload sync (question banks, records, packages, submissions), per-transfer progress, retries, blocked-offline auto-resume.
- **Conflict management**: six conflict classes with side-by-side comparison, suggested resolutions, keep/merge/both/defer decisions and full audit trails. Duplicate submissions are recognized by content hash and never double-counted.
- **Results & marking**: collection dashboards, auto-marking of objective answers, rubric-based essay marking, moderation, release, exports, printable score sheets.
- **Analytics**: school, class, subject, topic and student level performance with charts and intervention lists.
- **Licensing**: online and offline activation flows, device limits, entitlements, grace-period/read-only expiry behaviour (records are never destroyed).
- **Updates**: offline package import, verification, LAN distribution, safety interlocks during live exams.
- **Backups**: scheduled and manual local backups (clearly distinct from sync), verification, restore wizard, recovery guidance.
- **Audit & health**: comprehensive local audit logs, diagnostics, browser session management.

## Essential architectural principles

1. **Peers, not clients.** Any authorized peer may distribute approved exams or collect results. A computer participating in an exam never depends permanently on another computer.
2. **Sessions are temporary.** A computer is technical infrastructure; a user is a person with permissions; a session joins the two until sign-out or device switch.
3. **Local-first truth.** Data is written to the local database first and replicated only through authorized, observable transfers. Two computers may legitimately hold different states.
4. **Explicit authorization everywhere.** Restricted payloads (student records, staff records, permissions) are only accepted from paired, trusted peers; violations are quarantined and audited.
5. **Version-locked approvals.** Approval events bind to a specific assessment version.
6. **Offline licences degrade gracefully** — read-only, export allowed, nothing destroyed.
7. **Simulation honesty.** The prototype labels every simulated mechanism (security, sync, AI, licensing) as such; nothing is presented as production-secure.

See also: `DATA_MODELS.md`, `INTEGRATION_CONTRACTS.md`, `STATE_MACHINES.md`, `USER_FLOWS.md`.
