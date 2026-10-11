# ExamHub — DATA_MODELS.md

Conceptual entities and relationships for handoff. These are **not** final production schemas — Phase 2/3 will refine them into real database tables. TypeScript definitions live in `src/lib/prototype/types.ts`; the world builder that instantiates them is `src/lib/prototype/seed/world-builder.ts`.

## Entity map

```
School 1─* ClassRoom, Subject, Department, AcademicSession, GradeBand(school-embedded)
User *─1 School, Role(Definition)
User (student) *─1 ClassRoom
User (parent) *─* User(children)
Question *─1 Subject(+topic, level) ; Question *─* Assessment (via Assessment.questionIds)
Assessment 1─* AssessmentVersionRecord ; Assessment 1─1 ApprovalRequest(*)
Device 1─1 DeviceLocalState  (the heart of the simulation)
DeviceLocalState 1─* Question(copies), Assessment(copies), ExamPackage, ExamAttempt(local), SubmissionRecord(collected), ApprovalRequest(in), TransferTask(queue), SyncEvent, AppNotification, AuditEvent, BackupRecord, BrowserSession, ConflictCase
ExamAttempt 1─* AnswerRecord ; ExamAttempt *─1 Device(taken on)
SubmissionRecord *─1 ExamAttempt (attemptId, contentHash)
TransferTask *─1 Device(from), Device(to) ; payloadType + payloadId
ConflictCase 2─* Device(A/B) ; ConflictCase *─1 record
```

## Entities

### School
`id, name, shortName, type(primary|secondary|combined), address, city, state, phone, email, motto, logoHue, currentSession, currentTerm, plan, gradingScheme: GradeBand[], announcement`
Multi-school: devices and users belong to exactly one school; UI strictly filters by `schoolId`.

### User & access
- `User: id, name, email, role(9 roles), customRoleId?, schoolId, status(active|suspended|inactive), classId?, admissionNo?, childrenIds?, subjectIds?, departmentId?, avatarHue, createdAt, lastLoginAt`
- `RoleDefinition: id, name, description, system, permissions: PermissionKey[30+], memberCount`
- `UserSession: id, userId, deviceId, source(desktop|browser), ip, startedAt, lastActiveAt, active`

### Academic structure
- `ClassRoom: id, name, level, arm, category, classTeacherId?, capacity`
- `Department: id, name, headId?`
- `Subject: id, name, code, departmentId, levelCategory`
- `TopicNode: id, subjectId, name, subtopics[]`
- `AcademicSession: id, name, startDate, endDate, status, terms[{term, label, start, end, status}]`
- `GradeBand: grade, min, max, remark`

### Questions
`Question: id, schoolId, subjectId, level, topic, subtopic?, learningObjective?, type(9 types), difficulty, estimatedTimeSec, marks, tags[], statement, options?[{id,text}], correct[], acceptMultiple?, tolerance?, pairs?, items?, blanks?, explanation?, workedSolution?, hint?, status(draft|pending_review|approved|rejected|archived), createdBy/Name, createdAt/updatedAt, version, source(manual|ai|import), usageCount, attachment?`
`QuestionRevision` (conceptual): questionId, version, editedBy/At, changeSummary, snapshot.

### Assessments
`Assessment: id, schoolId, name, description, instructions, subjectId, classIds[], type(9 types), access(controlled|public), startAt, endAt, durationMin, totalMarks, passMark, attemptsAllowed, questionIds[], sections[{id,name,instruction,questionIds}], randomizeQuestions/Options, status(15 states), version, approvedVersion?, approvedBy/Name/At?, rejectionNote?, createdBy/Name, createdOnDevice, createdAt/updatedAt, resultVisibility, feedbackPolicy, submissionMode`
`AssessmentVersionRecord: assessmentId, version, editedBy/At, changeSummary, statusAtCreation`

### Delivery & attempts
- `ExamPackage (per device): assessmentId, version, receivedAt, fromDeviceId, questionPayload (sealed question copies incl. answer keys), totalMarks, durationMin`
- `ExamAttempt: id, assessmentId, assessmentVersion, assessmentName, studentId/Name, classId/Name, deviceId, startedAt, submittedAt?, durationUsedSec?, status(in_progress|submitted|marked|awaiting_moderation|published|interrupted), answers{questionId→AnswerRecord}, autoScore, manualScore, totalMarks, percentage?, syncState(local_only|queued|synced), essayQuestionIds[]`
- `AnswerRecord: questionId, state(answered|flagged|unanswered|skipped), selected?, text?, ordering?, pairs?, timeSpentSec?, autoCorrect?, autoMarks?`
- `SubmissionRecord: id, attemptId, assessmentId, studentId/Name, classId, score, totalMarks, receivedFromDeviceId, receivedAt, contentHash, duplicateOf?, verified`
- `ApprovalRequest: id, assessmentId, version, assessmentName, subjectId, requestedBy/Name, fromDeviceId, requestedAt, status(pending|approved|rejected|revision_requested), note?, decisionBy/At?, questionCount, totalMarks`

### Devices & sync
- `Device: id(DEV-nnn), index, name, ip, port, os, appVersion, schoolId, paired, online, lastSeen, storageUsedMb/TotalMb, dbHealth, trusted, note?` — **no permanent role field**; any session data is transient.
- `TransferTask: id, fromDeviceId, toDeviceId, payloadType(12 types), payloadId, payloadLabel, sizeKb, status(queued|transferring|completed|failed|blocked_offline|cancelled), progress, speedMbps, initiatedBy, createdAt, completedAt?, retries, errorNote?, direction(outgoing|incoming)`
- `SyncEvent: id, at, deviceId, peerDeviceId, payloadType, label, outcome(success|failed|conflict|blocked), initiatedBy, detail?`

### Conflicts
`ConflictCase: id, type(6 types), title, description, affectedRecord, recordKind, deviceAId, deviceBId, userA, userB, detectedAt, status(open|resolved|deferred), suggestedResolution, versionA/versionB {label, summary, fields[{field,value}]}, resolution? {choice(a|b|merge|both|reject), resolvedBy/At, note, before, after}`

### System
- `AppNotification: id, kind(16 kinds), title, body, at, read, actionRoute?, deviceId, actorName?`
- `AuditEvent: id, at, deviceId, userId/Name, action(17 actions), target, detail, status(success|failure|warning)`
- `BackupRecord: id, createdAt, createdBy, sizeMb, kind(full|selective), scope, encrypted, verified, location, status`
- `BrowserSession: id, userName, role, device, ip, startedAt, active`
- `LicenceState (per school): plan, status(active|grace_period|expired|invalid|revoked|unactivated), activatedAt?, expiresAt?, activationMode?, productKeyMasked?, deviceLimit, devicesUsed, entitlements[], billingHistory[]`
- `UpdateState (per device): currentVersion, availableVersion?, releaseNotes[], autoUpdate, importedPackage?, distributedTo[], history[]`

## Key invariants
1. Records exist **per device** (`DeviceLocalState`); nothing propagates without a completed `TransferTask`.
2. `approvedVersion` is immutable once set; edits create a new `version` with `status='draft'`.
3. `SubmissionRecord.contentHash` deduplicates attempts across devices; duplicates get `duplicateOf` and are excluded from counts.
4. Restricted payloads require a paired+trusted peer with matching authorization; violations create `unauthorized_restricted_payload` conflicts.
5. Published attempts and approved packages are never silently overwritten (conflicts instead).
