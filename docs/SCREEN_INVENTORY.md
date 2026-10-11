# ExamHub — SCREEN_INVENTORY.md

Every implemented screen with route, audience, features and key interactions. All routes are hash routes under `/` (the preview environment exposes a single page; the prototype uses an internal hash router).

## Standalone (no app shell)

| # | Screen | Route | Users | Main features | Key interactions |
|---|---|---|---|---|---|
| 1 | Welcome / entry hub | `#/` | everyone | Product intro, peer-architecture explainer, six entry cards, scenario hint | Sign in, Register, Join, Import, Restore, Public practice, Open scenario on DEV-017 |
| 2 | Login | `#/login` | everyone | Real email/password form with validation + 11 one-click demo accounts | Sign in, forgot-password (offline recovery note), demo selector, school mismatch errors |
| 3 | Onboarding wizard | `#/onboarding` | new schools | 7 steps: school info → calendar → classes/subjects → admin account → device registration → plan/activation → review; initialization animation | Validation, save & exit (resume later), finish → ready state |
| 4 | Join school flow | `#/onboarding` (mode=join) | new devices | LAN scan, manual IP, invitation code, pairing approval simulation | Scan, connect, send request, approval wait |
| 5 | Restore wizard | `#/onboarding` (mode=restore) | recovering schools | Backup pick, verified summary, restore progress | File select, restore, completion |
| 6 | Import wizard | `#/onboarding` (mode=import) | new schools | CSV/Excel pick, column mapping, duplicate flags | Import with skip report |
| 7 | Public practice hub | `#/practice` | anonymous | Curated public sets + custom builder (subject/level/topic/difficulty/count/timer) | Start practice, guest identity notice |
| 8 | Practice session | `#/practice/session` | anonymous | Full quiz runner with instant feedback, explanations | Answer, next, finish |
| 9 | Practice results | `#/practice/session` (finished) | anonymous | Score, accuracy, full review with correct answers | Retake, create account |
| 10 | Exam chooser | `#/exam` | students | Exams delivered to THIS computer only, eligibility, package metadata | Start / Resume exam |
| 11 | Exam runner | `#/exam` (active) | students | Timer (×1/×10/×60 demo speed), auto-save indicator, online/offline banner, question palette, flagging, all 9 question types, submit confirmation | Answer, navigate, flag, submit, save & exit |
| 12 | Submitted state | `#/exam` (done) | students | Local-saved confirmation, sync status | Back to dashboard |

## Application shell screens (`#/app/...`)

### Dashboards
| # | Screen | Route | Users | Highlights |
|---|---|---|---|---|
| 13 | Administrator dashboard | `/app/dashboard` | proprietor, administrator, support | 8 stat cards, performance line, subject bars, audit feed, needs-attention actions, notifications |
| 14 | Teacher dashboard | `/app/dashboard` | teacher, hod | My questions/drafts/pending/approved, marking queue, classes snapshot, sync shortcuts |
| 15 | Student dashboard | `/app/dashboard` | student | Available exams (device-local), resume banner, released results, trend, topic mastery radar, recommended practice |
| 16 | Exam officer dashboard | `/app/dashboard` | exam_officer | Approvals, calendar, distribution/collection progress, incidents |
| 17 | Invigilator dashboard | `/app/dashboard` | invigilator | Assigned session, attendance, live controls, incident feed |
| 18 | Parent dashboard | `/app/dashboard` | parent | Linked children, released results, recommendations |

### School management
| # | Screen | Route | Users |
|---|---|---|---|
| 19 | School profile | `/app/school/profile` | school.manage |
| 20 | Academic setup (sessions/terms/grading) | `/app/school/academic` | academic.manage |
| 21 | Classes & arms | `/app/school/classes` | academic.manage |
| 22 | Subjects & departments | `/app/school/subjects` | academic.manage |
| 23 | Staff records | `/app/school/staff` | users.manage |
| 24 | Student records (+ detail `#/app/school/students/<id>`) | `/app/school/students` | users.manage |
| 25 | Enrollment & imports (single/bulk/codes) | `/app/school/enrollment` | users.manage |

### Users & access
| # | Screen | Route | Notes |
|---|---|---|---|
| 26 | User accounts | `/app/users` | Search/filter, activate/suspend, detail dialog with sessions & audit, invite |
| 27 | Roles & permissions | `/app/users/roles` | 9 system roles, 30+ permissions matrix, custom role creator |
| 28 | My profile | `/app/account` | Account info, session, personal activity |

### Learning content
| # | Screen | Route | Notes |
|---|---|---|---|
| 29 | Question banks | `/app/questions` | Tabs (all/mine/pending/approved/archived), filters, bulk ops, quick edit dialog with preview & approve/reject |
| 30 | Question editor | `/app/questions/editor` | Full authoring for all 9 types, classification, marks/timing, tags, explanation/rubric, version history |
| 31 | AI question assistant | `/app/ai-assistant` | Provider states (cloud/local/none), generation settings, simulated drafts, accept/regenerate/save |

### Assessments
| # | Screen | Route | Notes |
|---|---|---|---|
| 32 | Assessments list | `/app/assessments` | Status/version/window/creator columns, filters |
| 33 | Creation wizard | `/app/assessments/new` | 6 steps incl. question import, AI-add, sections, schedule, security, review |
| 34 | Assessment detail | `/app/assessments/<id>` | Lifecycle strip, overview, questions, distribution progress, version history, approval requests, submit/approve/distribute/revise actions |
| 35 | Approvals queue | `/app/approvals` | Review checklist, approve/reject/request-changes with notes |

### Examinations
| # | Screen | Route | Notes |
|---|---|---|---|
| 36 | Exam sessions | `/app/exams` | All controlled assessments with live badges and per-assessment stats |
| 37 | Live session monitor | `/app/exams/<id>` | 100-candidate roster, connectivity dots, status badges, invigilator controls, incident logging, progress panels |

### Results
| # | Screen | Route | Notes |
|---|---|---|---|
| 38 | Results hub / collection dashboard | `/app/results` | Per-assessment collection progress, outstanding warnings, verified submissions table (duplicate detection) |
| 39 | Marking queue | `/app/results/marking` | Submitted essays awaiting rubric marking |
| 40 | Marking detail | `/app/results/marking/<attemptId>` | Student answers, auto-mark outcomes, rubric + marks + comments |
| 41 | Moderate & release | `/app/results/publish` | Stats, export/print, release confirmation (audited) |
| 42 | Analytics & reports | `/app/analytics` | Grade distribution, class comparison, topic mastery, intervention list, question performance; student/parent personal variant |

### Computers & Sync
| # | Screen | Route | Notes |
|---|---|---|---|
| 43 | Computers & Sync | `/app/computers` | This-device identity card, fleet table (103 devices) with filters & bulk pair/sync, discovery dialog (scan + manual IP + troubleshooting) |
| 44 | Device detail | `/app/computers/<id>` | Identity/trust, local data counts, transfer history, pair/revoke, simulate connect/disconnect |
| 45 | Sync centre | `/app/sync` | Live transfer queue with progress & retry, sync history, push-data builder, collect-results dialog |
| 46 | Conflicts | `/app/conflicts` | 6 seeded conflict cases, side-by-side versions, suggested resolution, keep A/B/merge/both/defer, before-after audit |

### System
| # | Screen | Route | Notes |
|---|---|---|---|
| 47 | Notifications centre | `/app/notifications` | All/unread filters, 16 notification kinds, action links |
| 48 | Licensing | `/app/licensing` | Plan cards, entitlements, billing, online activation, 5-step offline activation, grace-period state (Little Stars) |
| 49 | Updates | `/app/updates` | Import offline package, release notes, LAN distribution, exam-active safety warning, history |
| 50 | Backups | `/app/backups` | Create/verify/restore, schedule, retention, recovery guidance, backup-vs-sync explanation |
| 51 | Audit logs | `/app/audit` | Filter by action/status/text, 17 action types |
| 52 | Settings | `/app/settings` | Tabs: general, network, security, AI provider, appearance, diagnostics, browser access |
| 53 | Browser access | `/app/settings/browser` | LAN address, QR mockup, session list, revoke |
| 54 | Help & support | `/app/help` | Guided scenario launcher, quick answers, contact support, prototype disclosure |

### Overlay
| # | Screen | Trigger | Notes |
|---|---|---|---|
| 55 | Device Simulator bar | persistent (bottom) | Device/user switching, LAN toggle, this-PC power, scenario presets 1–5, reset demo, storage/last-sync info |
| 56 | Guided scenario drawer | "Guided scenario" button | 30 steps with auto-detected completion, per-step jump (device + user + route) |

## Access-denied & empty states
Every guarded route renders an explicit AccessDenied card (with role label and audit note). Every data table has an empty state explaining the decentralized reason (e.g. "No exams on this computer yet — delivered packages appear automatically").
