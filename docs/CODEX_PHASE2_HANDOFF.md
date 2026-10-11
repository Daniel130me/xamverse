# ExamHub — CODEX_PHASE2_HANDOFF.md

Handoff for the desktop-infrastructure agent ("Codex"). Scope reminder: **Codex builds the engine, not the application** — no business frontend, no examination management backend. This document states what the engine must provide so the Phase 1 UI can run unchanged against real services.

## 1. Required desktop engine capabilities
1. **Runtime**: Tauri 2 app shell for Windows (primary) and macOS; the React frontend from Phase 1 is embedded and kept framework-independent of Tauri APIs behind the service interfaces in `INTEGRATION_CONTRACTS.md`.
2. **Local database**: SQLite (per device) with encryption at rest (SQLCipher or equivalent), migrations, sealed tables for exam packages (encrypted rows containing question payloads incl. answer keys) and attempts.
3. **Peer networking**: TCP listener (prototype default port 47810), LAN discovery via multicast/UDP broadcast with manual-IP fallback, connection testing, per-peer identity keys (ed25519 fingerprint shown in UI), trust store for pairings, revocation.
4. **Transfer protocol**: resumable, checksummed transfers for the 12 payload types; queue persistence across restarts; blocked transfers auto-resume on peer reconnection; progress events streamed to the UI (speed, progress, status).
5. **Security**: TLS or noise-encrypted peer channels; payload signing; restricted payloads (student_records, staff_records, permissions) only accepted from paired+trusted peers — violations are quarantined and surfaced as `unauthorized_restricted_payload` conflicts.
6. **Authentication & authorization boundaries**: local credential store (per school), offline auth cache, session lock/expiry, re-authentication for sensitive ops. The engine enforces permission checks server-side (engine-side) for payload acceptance; the UI checks are convenience only.
7. **Licensing runtime**: signed licence files, online activation endpoint client, offline activation request/response file flow, device limits, hardware binding, grace-period enforcement (read-only + export), expiry states exactly as in `STATE_MACHINES.md §9`.
8. **Browser serving**: when a peer is online it serves the same frontend at `http://<ip>:47811` for browser sessions (limited storage, no native networking), with session list/revoke and feature-availability flags.
9. **Installer & updates**: signed installers; offline update package import/verify/distribute/apply with backup-first and exam-active interlock; update history and rollback.
10. **Backups**: encrypted local backups (scheduled + manual), verification, export/import, restore API.

## 2. Proposed native API contracts (Tauri commands — shape only)
```
auth:            login(user, secret) -> Session | Err; lock(); unlock(); logout(); change_password()
school:          get_school(); update_school(profile); list_classes(); create_class(); ...
users:           list_users(); invite_user(); set_status(); reset_password(); audit_for(user)
questions:       upsert_question(q) -> version; review(id, decision, note); import(file)
assessments:     upsert_assessment(a) -> version; submit_for_approval(id, targetDevice); decide(requestId, decision, note); distribute(id, targets[]) -> TransferJob[]
attempts:        start(assessmentId, studentId) -> Attempt; save_answer(attemptId, answer); submit(attemptId, auto?)
sync:            enqueue(payload, targets[]); list_queue(); retry(id); cancel(id); events(since)
discovery:       scan() -> Peer[]; connect_manual(ip); pair(peerId); unpair(peerId); fingerprint()
conflicts:       list(); resolve(id, choice, note); defer(id)
licensing:       activate_online(key); activation_request() -> file; import_activation(file); status()
updates:         import_package(file); distribute(targets[]); apply(); history()
backups:         create(kind, scope); list(); export(id, dest); restore(id)
notifications:   push(n); list(); mark_read(ids)
audit:           query(filters); export()
```
All commands return typed results; the UI store actions map 1:1 onto them (see store.ts action names).

## 3. Required peer-to-peer behavior
- Any peer may initiate an authorized transfer; there is no master. Distributors must verify the target's authorization before sending restricted payloads.
- Result collection is pull-capable (`collect`) and push-capable (auto-sync on submit) — both must exist.
- Duplicate detection by content hash at apply time; duplicates become `duplicate_submission` conflicts, never new records.
- Peers retain received data after the sender disconnects; queue retries are automatic with exponential backoff.
- Clock skew: rely on engine monotonic timing for exam timers; record server-authoritative timestamps where available; never trust client clocks for exam windows without the offline authorization envelope.

## 4. Local storage requirements
- Per-device DB schema mirroring `DATA_MODELS.md`.
- Sealed exam packages: delivered packages must be unreadable outside the engine (student UI receives decrypted views via IPC only).
- Sync checkpoints (`syncCheckpoint`, `lastSyncAt`) and transfer queue persistence.
- Backups: full + selective scopes, verified, encrypted, retention policy.

## 5. Simulated prototype functionality Codex must replace
| Prototype mock | Replace with |
|---|---|
| `tick()` transfer engine (progress increments) | real transfer protocol + events |
| `buildWorld()` seeded localStorage world | real DB + onboarding |
| localStorage persistence (`examhub-demo-v1`) | SQLite + keychain |
| demo login selector / password acceptance | real auth + recovery |
| licence simulation (buttons flip states) | signed licence runtime |
| update package simulation | signed package pipeline |
| AI generation with predefined outputs | cloud provider + local model hook |
| Device Simulator (device/user/network switching) | **keep** — it is a demo tool, separable from production components; gate behind a build flag |

## 6. Technical assumptions needing validation
1. LAN discovery works on typical school Wi-Fi APs (multicast often blocked → manual IP fallback must be first-class).
2. 100 simultaneous package transfers (≈350 KB each) complete in seconds on 100 Mbit+ LANs; chunking strategy for larger media.
3. SQLite + SQLCipher performance on low-end school PCs with ~170 users × multiple attempts per term.
4. Windows firewall UX: first-run prompt handling and documented port rules (TCP 47810, browser 47811).
5. Time authority for exam windows on machines with no internet (offline authorization envelope issued with the package; validity window signed at approval time).
6. Browser-session security boundary (what a browser guest may do) — must never grant peer-level networking.

## 7. Out of scope for Codex
Question authoring UI, assessment workflows, marking, analytics, public practice, role management UI, AI UX — these belong to Phase 3 on top of the services above.
