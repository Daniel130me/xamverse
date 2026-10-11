# ExamHub — INTEGRATION_CONTRACTS.md

Proposed service boundaries for Phase 2 (desktop engine — "Codex") and Phase 3 (application development agent). The prototype implements every operation as a mock in `src/lib/prototype/store.ts`; UI components never touch simulation internals directly — they call these store actions, which mirrors a service layer.

## Service interfaces

### AuthService (mock implemented)
| Operation | Notes | Phase 2 native? |
|---|---|---|
| `login(userId, deviceId)` | verifies against local records, creates session | ✅ local DB + credential hash |
| `logout() / lockSession() / unlockSession()` | session lifecycle | ✅ |
| `switchDevice(deviceId)` | ends session (auth is per device) | ✅ |
| `changePassword()` | simulated | ✅ + recovery codes |
| `verifyLocalAuthCache()` | offline sign-in support | ✅ |

### SchoolService / UserService (mock implemented)
`updateSchoolProfile`, `createClass`, `createSubject`, `inviteUser`, `setUserStatus`, `resetPassword`, `createCustomRole`, `updateRolePermissions`, `enrollStudents(bulk)`, `promoteStudent`, `transferStudent`, `generateRegCode`.
Requires: local DB; permission verification (`users.manage`, `roles.manage`); audit writes.

### QuestionBankService (mock implemented)
`saveQuestion (upsert + version++)`, `deleteQuestion`, `submitForReview`, `approve/reject`, `archive`, `duplicate`, `importQuestions(file)`, `exportQuestions`.
AI generation is **separate**: `AiAssistantService.generate(config, source) → QuestionDraft[]`, `regenerateOne`. Cloud AI needs connectivity; local model is engine-owned (Phase 2 must expose a local inference hook).

### AssessmentService (mock implemented)
`saveAssessment` (creates new draft revision if approved), `submitForApproval(assessmentId, targetDeviceId)`, `decideApproval(requestId, decision, note)`, `distributeAssessment(assessmentId, targetDeviceIds)`, `publishResults(assessmentId)`.
Requires: peer networking (`approval_request`, `approval_decision`, `assessment_package` payloads), version locking, sealed packages (Phase 2: signed + encrypted).

### ExamAttemptService (mock implemented)
`startAttempt(assessmentId, studentId)` (eligibility: package present, class eligible, attempt limits), `saveAnswer`, `flagQuestion`, `submitAttempt(auto?)` (auto-mark objective), `resumeAttempt`, `expireTimer`.
Requires: local DB writes per keystroke-batch, monotonic local clock handling, package decryption (Phase 2).

### ResultsService (mock implemented)
`collectResults(assessmentId, peerIds)` (pull), `receiveSubmission(payload)` (push; hash-dedup + conflict on duplicate), `gradeEssay(attemptId, questionId, marks, comment)`, `releaseResults(assessmentId)`, `exportSheets(format)`.
Requires: peer networking (`submission` payload), permission verification (`sync.collect`), audit.

### PeerDiscoveryService / DevicePairingService (mock implemented)
`scanNetwork() → Device[]`, `connectManual(ip)`, `pairDevice(id)`, `unpairDevice(id)`, `getFingerprint()`.
Phase 2 owns: multicast/mDNS or UDP broadcast discovery, TCP listener (`port 47810+`), noise/ed25519 identity keys, trust store, firewall guidance.

### SyncService (mock implemented — the tick engine)
`enqueue(payloadType, payloadId, targets[])`, `tick()` (advance transfers), `retry(transferId)`, `cancel(transferId)`, `syncWithPeers(targets, payloadTypes)`.
Phase 2 owns: real transfer protocol, resumable chunks, checksums, conflict detection at apply-time, checkpointing (`syncCheckpoint`, `lastSyncAt`).

### ConflictService (mock implemented)
`detect(payload application)` (invoked by SyncService), `resolve(id, choice, note)`, `defer(id)`.
Rules: duplicate submissions merge; published/approved records never silently overwritten; unauthorized payloads quarantined.

### LicensingService (mock implemented)
`activateOnline(key)`, `generateActivationRequest() → file`, `importActivationFile(file)`, `validate()`, `deviceLimitCheck()`.
Phase 2 owns: signed licence files, offline validity windows, hardware binding, grace-period enforcement (read-only + export mode).

### UpdateService (mock implemented)
`importOfflinePackage(file)`, `verify()`, `distribute(targets)`, `apply()` (blocked while exams active; backs up first), `history()`.

### BackupService (mock implemented)
`createBackup(kind, scope)`, `verifyBackup`, `exportBackup`, `restoreWizard`, `schedule`, `storageUsage()`.
Distinct from sync: backups protect one device; sync replicates across peers.

### NotificationService (mock implemented)
`push(deviceId|'*', notification)` (16 kinds), `markRead(ids?)`. Phase 3 should add real-time in-app delivery over the peer channel.

### AuditService (mock implemented)
`audit(action, target, detail, status, deviceIds[])` — 17 action types; local append-only log with filters and export.

### AnalyticsService (mock: computed on the fly)
`schoolSummary`, `classComparison`, `topicMastery`, `questionPerformance`, `studentTrend(studentId)`, `interventionList(threshold)`.

## Phase 2 (engine) vs Phase 3 (application) responsibilities

| Concern | Phase 2 — Codex (desktop engine) | Phase 3 — App agent |
|---|---|---|
| Local DB (SQLite + encryption at rest) | ✅ owns schema, migrations, sealed tables | consumes via repositories |
| Peer networking, discovery, transfers, trust | ✅ owns protocol & keys | calls SyncService interfaces |
| Authentication, sessions, device binding | ✅ owns credential store | calls AuthService |
| Encryption, signing (packages, licences, updates) | ✅ owns | consumes guarantees |
| Licensing runtime | ✅ owns validation + grace mode | UI surfaces states |
| Browser serving (`http://ip:47811`) | ✅ owns static serving + session bridge | same UI in browser mode |
| Installer, auto-update runtime, backups | ✅ owns | triggers via Update/BackupService |
| Business logic: questions, assessments, attempts, marking, analytics | consumes | ✅ owns |
| All screens, navigation, forms, validation | consumes | ✅ owns |
| AI orchestration (cloud + local model calls) | provides local runtime | ✅ owns UX & prompts |

## Mocks Codex must replace
Every action body in `src/lib/prototype/store.ts` (transfer simulation via `tick()`, seeded world via `buildWorld()`, hash-based auth, licence/update simulations). The UI must keep depending only on the action signatures above so implementations can swap without UI rewrites. Persisted localStorage (`examhub-demo-v1`) is demo-only.
