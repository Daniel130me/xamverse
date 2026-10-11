# ExamHub — STATE_MACHINES.md

State machines implemented in the prototype. Guards and side effects are enforced in `src/lib/prototype/store.ts`; UI reflects states via `StatusBadge` and the lifecycle strip on the assessment detail page.

## 1. Assessment

```
draft ──submit──▶ pending_approval ──approve──▶ approved
  ▲                    │                            │
  │                    ├─reject──▶ rejected ──edit──┘ (new draft revision)
  │                    └─request changes──▶ revision_requested ──edit+resubmit──▶ pending_approval
  └──edit (any time; approved copies stay intact)◀──┘
approved ──distribute──▶ distributing ──all transfers settled──▶ distributed
distributed ──window opens──▶ active ──window closes / all submitted──▶ completed
completed ──submissions collected──▶ marking ──marking done──▶ awaiting_result_approval
awaiting_result_approval ──release──▶ results_released ──(term end)──▶ archived
```

Rules:
- Approval binds to `version` (`approvedVersion`). Any edit after approval bumps `version` and returns the record to `draft` **without touching** the approved copy (the version history records both).
- Only `approved` (or later) assessments may be distributed.
- Distribution requires the distributor to hold `sync.distribute` permission.

## 2. Approval request
`pending → approved | rejected | revision_requested` (terminal once decided; the decision transfers back to the originating device and mutates the *assessment* machine there).

## 3. Exam session (delivery state per device)
```
(nothing) ──package transfer completes──▶ package_stored ──window open + eligible + attempt available──▶ openable
package_stored ──peer unpaired/revoked──▶ retained (already-delivered packages remain usable offline)
```

## 4. Exam attempt
```
in_progress ──submit (user)──▶ submitted ──essays marked──▶ marked ──moderation──▶ awaiting_moderation?──▶ published
in_progress ──time expires──▶ submitted (auto, flagged "time expired")
in_progress ──app closed / crash──▶ in_progress (persisted; resumable on same device)
in_progress ──connection lost──▶ in_progress (offline; answers save locally; sync_state stays local_only)
```
Side effects on submit: objective answers auto-marked; transfer tasks enqueue to authorized collectors (DEV-005/008/043); audit event written.

## 5. Result submission
```
attempt(submitted|marked) ──transfer completes on collector──▶ recorded(verified)
recorded ──same attemptId/contentHash arrives again──▶ duplicate (duplicateOf set; conflict raised; never counted twice)
recorded ──collector releases results──▶ published (attempt status follows)
```
Missing results stay visible as "outstanding" until every expected candidate's submission is recorded.

## 6. Sync job (TransferTask)
```
queued ──peer reachable──▶ transferring ──progress 100──▶ completed (payload applied + notifications + sync history)
queued/transferring ──peer offline / LAN down──▶ blocked_offline ──auto on reconnect──▶ queued
transferring ──error──▶ failed ──manual retry / auto-resume──▶ queued (retries++)
any ──user cancel──▶ cancelled
```
Payload application (`applyPayload`) is transactional per task and may spawn a conflict instead of applying.

## 7. Conflict
`open → resolved (choice: a|b|merge|both|reject) | deferred`
Resolved conflicts keep a before/after record and an audit event; deferred conflicts resurface on the next sync round.

## 8. Device
```
unpaired ──pair──▶ paired+trusted ──revoke──▶ unpaired
online ⇄ offline (user action or simulated failure; lastSeen updates)
dbHealth: healthy ⇄ warning ⇄ error (storage pressure)
```
A device has **no permanent role** — session presence (`currentUserRole`) is transient information only.

## 9. Licence
```
unactivated ──activate online / import activation file──▶ active ──expiry──▶ grace_period ──grace ends──▶ expired
active ──invalid key──▶ invalid ; active ──violation──▶ revoked
grace_period/expired → read-only + export allowed; records never destroyed; renewal → active
```

## 10. Update installation
```
current ──import package──▶ imported+verified ──apply (blocked while exam active; backup first)──▶ installed
installed ──failure──▶ failed ──recovery guidance──▶ rolled_back
verified package ──distribute to peers──▶ per-peer TransferTask(update_package) → installed remotely
```

## 11. Question
`draft → pending_review → approved | rejected ; any → archived ; edits bump version`
Approval requires `questions.approve` permission; usage counters increment when included in an assessment.

## 12. Session
```
signed_out ──login──▶ active ⇄ locked (re-auth) ──logout/device switch/expiry──▶ signed_out
```
Device switching always ends the session; browser sessions are separate entities with revoke.
