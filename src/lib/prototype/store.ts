/**
 * Demo Store — single Zustand store holding the simulated world,
 * the active device/user session, and all simulated operations.
 *
 * PERSISTENCE: world + session persist to localStorage (key examhub-demo-v1).
 * Everything is simulated data — never production-secure.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AnswerRecord, AppNotification, Assessment, AuditAction, AuditEvent, ConflictCase, Device,
  DeviceLocalState, ExamAttempt, ExamPackage, PermissionKey, Question, RoleDefinition, School, SubmissionRecord,
  TransferTask, User,
} from './types';
import type { ActiveSession, DemoWorld } from './world';
import { buildWorld } from './seed/world-builder';

const WORLD_VERSION = 3;

// ------------------------------------------------------------
// Router (hash based, SPA internal)
// ------------------------------------------------------------

export interface RouteState {
  path: string; // e.g. "/app/dashboard"
  params: Record<string, string>;
}

function parseHash(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

// ------------------------------------------------------------
// Store types
// ------------------------------------------------------------

interface PracticeSessionState {
  config: { subjectId: string; level: string; topic: string; difficulty: string; count: number; timed: boolean; durationMin: number };
  questionIds: string[];
  answers: Record<string, AnswerRecord>;
  currentIndex: number;
  startedAt: string;
  finishedAt?: string;
  guestName: string;
}

interface ExamSessionState {
  attemptId: string;
  questionOrder: string[];
  currentIndex: number;
  remainingSec: number;
  lastSavedAt?: string;
  timeScale: number; // demo time acceleration
}

interface DemoStore {
  // ----- core state -----
  world: DemoWorld;
  activeDeviceId: string;
  session: ActiveSession | null;
  route: RouteState;
  activeExam: ExamSessionState | null;
  practice: PracticeSessionState | null;
  simulatorOpen: boolean;
  walkthroughOpen: boolean;
  sidebarCollapsed: boolean;
  hydrated: boolean;

  // ----- session / navigation -----
  navigate: (path: string, params?: Record<string, string>) => void;
  syncFromHash: () => void;
  login: (userId: string) => void;
  logout: () => void;
  lockSession: () => void;
  unlockSession: (userId: string) => void;
  switchDevice: (deviceId: string) => void;
  switchUser: (userId: string) => void;
  setSimulatorOpen: (open: boolean) => void;
  setWalkthroughOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // ----- selectors (functions) -----
  currentUser: () => User | null;
  currentDevice: () => Device;
  local: () => DeviceLocalState;
  can: (permission: PermissionKey) => boolean;
  roleDef: () => RoleDefinition | undefined;

  // ----- data mutations (all local-device scoped unless noted) -----
  saveQuestion: (q: Question, opts?: { silent?: boolean; note?: string }) => void;
  deleteQuestion: (id: string) => void;
  saveAssessment: (a: Assessment, summary?: string) => void;
  submitAssessmentForApproval: (assessmentId: string, targetDeviceId: string) => void;
  decideApproval: (requestId: string, decision: 'approved' | 'rejected' | 'revision_requested', note?: string) => void;
  distributeAssessment: (assessmentId: string, targetDeviceIds: string[]) => number;
  collectResults: (assessmentId: string, peerIds: string[]) => void;
  retryTransfer: (transferId: string) => void;
  cancelTransfer: (transferId: string) => void;
  syncWithPeers: (targetIds: string[], payloadTypes: string[]) => void;
  pairDevice: (deviceId: string) => void;
  unpairDevice: (deviceId: string) => void;
  scanNetwork: () => { discovered: Device[] };
  resolveConflict: (conflictId: string, choice: 'a' | 'b' | 'merge' | 'both' | 'reject', note: string) => void;
  deferConflict: (conflictId: string) => void;

  // ----- school & people administration (service layer) -----
  updateSchoolProfile: (schoolId: string, patch: Partial<School>) => void;
  createClass: (schoolId: string, name: string) => string;
  setUserStatus: (userId: string, status: User['status']) => void;
  revokeBrowserSession: (sessionId: string) => void;

  // ----- exam flow -----
  startAttempt: (assessmentId: string, studentId: string) => string | null;
  saveAnswer: (questionId: string, patch: Partial<AnswerRecord>) => void;
  nextQuestion: (dir: 1 | -1) => void;
  gotoQuestion: (index: number) => void;
  toggleFlag: (questionId: string) => void;
  submitAttempt: (auto?: boolean) => void;
  exitExam: () => void;
  setExamTimeScale: (scale: number) => void;
  gradeEssay: (attemptId: string, questionId: string, marks: number, comment: string) => void;
  publishResults: (assessmentId: string) => void;

  // ----- practice -----
  startPractice: (config: PracticeSessionState['config'], questionIds: string[]) => void;
  savePracticeAnswer: (questionId: string, patch: Partial<AnswerRecord>) => void;
  gotoPracticeQuestion: (index: number) => void;
  finishPractice: () => void;
  exitPractice: () => void;

  // ----- system -----
  tick: () => void; // advances transfers + exam timer
  toggleNetwork: () => void;
  setDeviceOnline: (deviceId: string, online: boolean) => void;
  markNotificationsRead: (ids?: string[]) => void;
  pushNotification: (deviceId: string | '*', n: Omit<AppNotification, 'id' | 'at' | 'read' | 'deviceId'>) => void;
  audit: (action: AuditAction, target: string, detail: string, status?: 'success' | 'failure' | 'warning', deviceIds?: string[]) => void;
  createBackup: (kind: 'full' | 'selective', scope: string) => void;
  restoreBackup: (backupId: string) => void;
  importUpdatePackage: () => void;
  distributeUpdate: (targetIds: string[]) => void;
  activateLicenceOnline: () => void;
  importActivationFile: () => void;
  resetDemo: () => void;
  loadScenario: (name: 'fresh' | 'approved' | 'distributed' | 'collected' | 'released') => void;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

let idCounter = 100;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

const nowIso = () => new Date().toISOString();

const ROLE_TO_DEF: Record<string, string> = {
  proprietor: 'role-proprietor',
  administrator: 'role-admin',
  exam_officer: 'role-exoff',
  hod: 'role-hod',
  teacher: 'role-teacher',
  invigilator: 'role-invigilator',
  student: 'role-student',
  parent: 'role-parent',
  support: 'role-support',
};

const AUTO_COLLECTORS = ['DEV-005', 'DEV-008', 'DEV-043'];

function cloneLocal(l: DeviceLocalState): DeviceLocalState {
  return JSON.parse(JSON.stringify(l)) as DeviceLocalState;
}

function notify(store: DemoStore, deviceId: string | '*', n: Omit<AppNotification, 'id' | 'at' | 'read' | 'deviceId'>) {
  const { world } = store;
  const targets = deviceId === '*' ? Object.keys(world.locals) : [deviceId];
  targets.forEach((tid) => {
    const local = world.locals[tid];
    if (!local) return;
    local.notifications.unshift({ id: uid('ntf'), at: nowIso(), read: false, deviceId: tid, ...n });
    if (local.notifications.length > 60) local.notifications.length = 60;
  });
}

// ------------------------------------------------------------
// Transfer completion — applies payloads to the receiving device
// ------------------------------------------------------------

function applyPayload(world: DemoWorld, task: TransferTask) {
  const target = world.locals[task.toDeviceId];
  const source = world.locals[task.fromDeviceId];
  if (!target) return;
  switch (task.payloadType) {
    case 'approval_request': {
      const req = source?.approvalRequests.find((r) => r.id === task.payloadId);
      if (req && !target.approvalRequests.some((r) => r.id === req.id)) {
        target.approvalRequests.push(JSON.parse(JSON.stringify(req)));
        // The reviewer needs the assessment content itself to review it —
        // deliver a read-only copy of the submitted version alongside the request.
        const srcA = source?.assessments[req.assessmentId];
        if (srcA && !target.assessments[req.assessmentId]) {
          target.assessments[req.assessmentId] = JSON.parse(JSON.stringify(srcA));
        }
      }
      notify({ world } as DemoStore, task.toDeviceId, {
        kind: 'approval_requested',
        title: 'Approval requested',
        body: `${req?.requestedByName ?? 'A teacher'} submitted "${req?.assessmentName}" (v${req?.version}) for approval.`,
        actionRoute: '/app/approvals',
        actorName: req?.requestedByName,
      });
      break;
    }
    case 'approval_decision': {
      // payloadId = requestId; decision data embedded in errorNote-free fields
      const req = source?.approvalRequests.find((r) => r.id === task.payloadId);
      const assessment = target.assessments[req?.assessmentId ?? ''];
      if (req && assessment) {
        if (req.status === 'approved') {
          assessment.status = 'approved';
          assessment.approvedVersion = req.version;
          assessment.approvedBy = req.decisionBy ?? 'reviewer';
          assessment.approvedByName = req.decisionBy ?? 'Reviewer';
          assessment.approvedAt = nowIso();
          assessment.updatedAt = nowIso();
        } else if (req.status === 'rejected') {
          assessment.status = 'rejected';
          assessment.rejectionNote = req.note;
        } else {
          assessment.status = 'revision_requested';
          assessment.rejectionNote = req.note;
        }
        assessment.updatedAt = nowIso();
        notify({ world } as DemoStore, task.toDeviceId, {
          kind: req.status === 'approved' ? 'assessment_approved' : 'assessment_rejected',
          title: req.status === 'approved' ? 'Assessment approved' : `Assessment ${req.status.replace('_', ' ')}`,
          body: `"${assessment.name}" v${req.version} — ${req.status === 'approved' ? 'approved and ready for distribution.' : req.note || ''}`,
          actionRoute: '/app/assessments',
          actorName: req.decisionBy,
        });
      }
      break;
    }
    case 'assessment_package': {
      const src = source?.assessments[task.payloadId];
      if (src) {
        const copy: Assessment = JSON.parse(JSON.stringify(src));
        copy.status = src.status === 'approved' || src.status === 'distributed' || src.status === 'active' || src.status === 'completed' ? src.status : 'approved';
        target.assessments[copy.id] = copy;
        // Sealed payload comes from the DISTRIBUTING device's question bank
        // (receivers may not hold the full bank — that's the point of the package).
        const questions = { ...(source?.questions ?? {}), ...target.questions };
        const payload: ExamPackage['questionPayload'] = {};
        copy.questionIds.forEach((qid) => {
          const q = questions[qid];
          if (q) payload[qid] = JSON.parse(JSON.stringify(q));
        });
        target.examPackages[copy.id] = {
          assessmentId: copy.id,
          version: copy.version,
          receivedAt: nowIso(),
          fromDeviceId: task.fromDeviceId,
          questionPayload: payload,
          totalMarks: copy.totalMarks,
          durationMin: copy.durationMin,
        };
        notify({ world } as DemoStore, task.toDeviceId, {
          kind: 'exam_distributed',
          title: 'Exam package received',
          body: `"${copy.name}" v${copy.version} is now available on this computer.`,
          actionRoute: '/app/assessments',
        });
      }
      break;
    }
    case 'question_bank': {
      Object.entries(source?.questions ?? {}).forEach(([qid, q]) => {
        if (!target.questions[qid] || target.questions[qid].updatedAt < q.updatedAt) {
          target.questions[qid] = JSON.parse(JSON.stringify(q));
        }
      });
      break;
    }
    case 'submission': {
      const attempt = source?.attempts.find((a) => a.id === task.payloadId);
      if (attempt && attempt.status !== 'in_progress') {
        const hash = `sha256:${attempt.id}-${attempt.studentId}`;
        const existing = target.submissions.find((s) => s.attemptId === attempt.id || s.contentHash === hash);
        if (existing) {
          existing.duplicateOf = existing.id;
          target.conflicts.unshift({
            id: uid('CONF'), type: 'duplicate_submission',
            title: `Duplicate result submission — ${attempt.studentName}`,
            description: `Submission for "${attempt.assessmentName}" was received twice with identical content hash. Recognised as the same submission — it must not be counted twice.`,
            affectedRecord: `${attempt.id} / ${attempt.studentName}`, recordKind: 'submission',
            deviceAId: task.fromDeviceId, deviceBId: task.toDeviceId,
            userA: attempt.studentName, userB: 'Sync engine',
            detectedAt: nowIso(), status: 'open',
            suggestedResolution: 'Keep one submission; mark the second as a duplicate of the first.',
            versionA: { label: 'Submission A — direct', summary: 'First received copy.', fields: [{ field: 'Attempt', value: attempt.id }, { field: 'Hash', value: hash.slice(0, 24) + '…' }] },
            versionB: { label: 'Submission B — replica', summary: 'Second copy with identical hash.', fields: [{ field: 'Attempt', value: attempt.id }, { field: 'Hash', value: hash.slice(0, 24) + '… (identical)' }] },
          });
          notify({ world } as DemoStore, task.toDeviceId, {
            kind: 'conflict_detected', title: 'Duplicate submission detected',
            body: `${attempt.studentName}'s submission arrived twice with the same hash. Kept once.`,
            actionRoute: '/app/conflicts',
          });
        } else {
          const sub: SubmissionRecord = {
            id: uid('SUB'), attemptId: attempt.id, assessmentId: attempt.assessmentId,
            studentId: attempt.studentId, studentName: attempt.studentName, classId: attempt.classId,
            score: attempt.autoScore + attempt.manualScore, totalMarks: attempt.totalMarks,
            receivedFromDeviceId: task.fromDeviceId, receivedAt: nowIso(), contentHash: hash, verified: true,
          };
          target.submissions.unshift(sub);
          attempt.syncState = 'synced';
          // The collector receives the full attempt record (answers) so essays
          // can be marked and moderation can review responses remotely.
          if (!target.attempts.some((a) => a.id === attempt.id)) {
            target.attempts.push(JSON.parse(JSON.stringify(attempt)));
          }
          notify({ world } as DemoStore, task.toDeviceId, {
            kind: 'result_received', title: 'Result submission received',
            body: `${attempt.studentName} — ${attempt.assessmentName} (${attempt.autoScore}/${attempt.totalMarks}).`,
            actionRoute: '/app/results',
          });
        }
      }
      break;
    }
    default:
      // student_records, staff_records, permissions, school_settings etc. — simulate success
      break;
  }
  const evt = {
    id: uid('syn'), at: nowIso(), deviceId: task.toDeviceId, peerDeviceId: task.fromDeviceId,
    payloadType: task.payloadType, label: `Received ${task.payloadLabel} from ${task.fromDeviceId}`,
    outcome: 'success' as const, initiatedBy: task.initiatedBy,
  };
  target.syncHistory.unshift(evt);
  if (target.syncHistory.length > 80) target.syncHistory.length = 80;
  const srcLocal = world.locals[task.fromDeviceId];
  if (srcLocal) {
    srcLocal.syncHistory.unshift({
      ...evt, id: uid('syn'), deviceId: task.fromDeviceId, peerDeviceId: task.toDeviceId,
      label: `Delivered ${task.payloadLabel} to ${task.toDeviceId}`,
    });
  }
}

// ------------------------------------------------------------
// Store
// ------------------------------------------------------------

const initialWorld = () => buildWorld();

export const useDemoStore = create<DemoStore>()(
  persist(
    (set, get) => ({
      world: initialWorld(),
      activeDeviceId: 'DEV-017',
      session: null,
      route: { path: '/', params: {} },
      activeExam: null,
      practice: null,
      simulatorOpen: false,
      walkthroughOpen: false,
      sidebarCollapsed: false,
      hydrated: false,

      // ---------------- navigation ----------------
      navigate: (path, params) => {
        // Auto-extract detail ids from paths like /app/assessments/ASSESS-123
        const merged = { ...(params ?? {}) };
        const segs = path.split('/').filter(Boolean);
        if (segs.length >= 3 && segs[0] === 'app' && !merged.id) {
          merged.id = segs[segs.length - 1];
        }
        const p = { path, params: merged };
        set({ route: p });
        if (typeof window !== 'undefined') {
          window.location.hash = path;
        }
        window.scrollTo(0, 0);
      },
      syncFromHash: () => {
        const path = parseHash();
        const parts = path.split('/').filter(Boolean);
        const params: Record<string, string> = {};
        if (parts[0] === 'app' && parts.length >= 3) {
          params.module = parts[1];
          params.id = parts[parts.length - 1];
        }
        set({ route: { path, params } });
      },
      login: (userId) => {
        const { world, activeDeviceId } = get();
        const user = world.users[userId];
        if (!user) return;
        const session: ActiveSession = {
          userId, deviceId: activeDeviceId, startedAt: nowIso(), locked: false, source: 'desktop',
        };
        user.lastLoginAt = nowIso();
        get().audit('login', `session:${activeDeviceId}`, `${user.name} signed in on ${activeDeviceId}`, 'success', [activeDeviceId]);
        set({ session });
      },
      logout: () => {
        const { session, activeDeviceId } = get();
        if (session) {
          const user = get().world.users[session.userId];
          if (user) get().audit('logout', `session:${activeDeviceId}`, `${user.name} signed out`, 'success', [activeDeviceId]);
        }
        set({ session: null, activeExam: null });
        get().navigate('/');
      },
      lockSession: () => {
        const { session } = get();
        if (session) set({ session: { ...session, locked: true } });
      },
      unlockSession: (userId) => {
        const { session } = get();
        if (session && session.userId === userId) set({ session: { ...session, locked: false } });
      },
      switchDevice: (deviceId) => {
        const { world, session } = get();
        const device = world.devices[deviceId];
        if (!device) return;
        // Session ends when the computer changes (auth is per-device, per-user)
        set({ activeDeviceId: deviceId, session: null, activeExam: null });
        if (session) {
          get().navigate('/');
        }
      },
      switchUser: (userId) => {
        get().login(userId);
      },

      setSimulatorOpen: (open) => set({ simulatorOpen: open }),
      setWalkthroughOpen: (open) => set({ walkthroughOpen: open }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

      // ---------------- selectors ----------------
      currentUser: () => {
        const { world, session } = get();
        return session ? world.users[session.userId] ?? null : null;
      },
      currentDevice: () => {
        const { world, activeDeviceId } = get();
        return world.devices[activeDeviceId];
      },
      local: () => {
        const { world, activeDeviceId } = get();
        return world.locals[activeDeviceId];
      },
      roleDef: () => {
        const user = get().currentUser();
        if (!user) return undefined;
        const defId = ROLE_TO_DEF[user.role];
        return get().world.roleDefinitions.find((r) => r.id === defId);
      },
      can: (permission) => {
        const user = get().currentUser();
        if (!user) return false;
        const def = get().roleDef();
        if (def) return def.permissions.includes(permission);
        return false;
      },

      // ---------------- questions ----------------
      saveQuestion: (q, opts) => {
        const local = get().local();
        const existing = local.questions[q.id];
        const updated: Question = {
          ...q,
          version: existing ? existing.version + 1 : 1,
          updatedAt: nowIso(),
        };
        local.questions[q.id] = updated;
        const note = opts?.note ? ` — ${opts.note}` : '';
        get().audit('question_changed', q.id, `${existing ? 'Updated' : 'Created'} question "${q.statement.slice(0, 48)}…" (v${updated.version})${note}`, 'success');
        if (!opts?.silent) {
          notify({ world: get().world } as DemoStore, get().activeDeviceId, {
            kind: 'sync_progress', title: existing ? 'Question updated' : 'Question saved',
            body: `"${q.statement.slice(0, 60)}…" saved locally on ${get().activeDeviceId}. Use Computers & Sync to share it.`,
            actionRoute: '/app/questions',
          });
        }
        set({ world: { ...get().world } });
      },
      deleteQuestion: (id) => {
        const local = get().local();
        delete local.questions[id];
        get().audit('question_changed', id, 'Question deleted locally', 'success');
        set({ world: { ...get().world } });
      },

      // ---------------- school & people administration ----------------
      updateSchoolProfile: (schoolId, patch) => {
        const { world, session } = get();
        const school = world.schools[schoolId];
        if (!school) return;
        world.schools[schoolId] = { ...school, ...patch };
        const user = session ? world.users[session.userId] : null;
        get().audit('question_changed', schoolId, `School profile updated by ${user?.name ?? 'a user'}`, 'success');
        set({ world: { ...get().world } });
      },
      createClass: (schoolId, name) => {
        const { world } = get();
        const id = `cls-new-${Date.now()}`;
        const parts = name.trim().split(' ');
        world.classes[id] = {
          id, name: name.trim(),
          level: parts[0], arm: parts[1] ?? 'A',
          category: 'senior_secondary', capacity: 30,
        };
        set({ world: { ...get().world } });
        return id;
      },
      setUserStatus: (userId, status) => {
        const { world } = get();
        const u = world.users[userId];
        if (!u) return;
        world.users[userId] = { ...u, status };
        set({ world: { ...get().world } });
      },
      revokeBrowserSession: (sessionId) => {
        const b = get().local().browserSessions.find((x) => x.id === sessionId);
        if (!b) return;
        b.active = false;
        get().audit('unauthorized_attempt', sessionId, `Browser session revoked on ${get().activeDeviceId}`, 'warning');
        set({ world: { ...get().world } });
      },

      // ---------------- assessments ----------------
      saveAssessment: (a, summary) => {
        const local = get().local();
        const existing = local.assessments[a.id];
        let next: Assessment = { ...a, updatedAt: nowIso() };
        if (existing) {
          // If editing an approved/locked assessment, create a NEW DRAFT REVISION.
          if (existing.approvedVersion && existing.version === existing.approvedVersion && (existing.status === 'approved' || existing.status === 'distributed' || existing.status === 'active')) {
            next = {
              ...next,
              version: existing.version + 1,
              status: 'draft',
              approvedVersion: existing.approvedVersion,
              approvedBy: existing.approvedBy,
              approvedByName: existing.approvedByName,
              approvedAt: existing.approvedAt,
            };
            notify({ world: get().world } as DemoStore, get().activeDeviceId, {
              kind: 'assessment_received', title: 'New revision created',
              body: `"${existing.name}" was previously approved at v${existing.approvedVersion}. Your edits were saved as new draft v${next.version} — the approved version remains unchanged.`,
              actionRoute: '/app/assessments',
            });
          }
          next.version = Math.max(next.version, existing.version);
        }
        local.assessments[next.id] = next;
        const versions = local.versions[next.id] ?? [];
        versions.push({
          assessmentId: next.id, version: next.version, editedBy: get().currentUser()?.name ?? 'Unknown',
          editedAt: nowIso(), changeSummary: summary ?? 'Saved changes', statusAtCreation: next.status,
        });
        local.versions[next.id] = versions;
        set({ world: { ...get().world } });
      },
      submitAssessmentForApproval: (assessmentId, targetDeviceId) => {
        const { activeDeviceId, world } = get();
        const local = world.locals[activeDeviceId];
        const a = local.assessments[assessmentId];
        if (!a) return;
        a.status = 'pending_approval';
        a.updatedAt = nowIso();
        const req = {
          id: uid('APR'), assessmentId, version: a.version, assessmentName: a.name, subjectId: a.subjectId,
          requestedBy: a.createdBy, requestedByName: a.createdByName,
          fromDeviceId: activeDeviceId, requestedAt: nowIso(), status: 'pending' as const,
          questionCount: a.questionIds.length, totalMarks: a.totalMarks,
        };
        local.approvalRequests.push(req);
        // outgoing transfer of the approval request
        local.transferQueue.push({
          id: uid('xfr'), fromDeviceId: activeDeviceId, toDeviceId: targetDeviceId,
          payloadType: 'approval_request', payloadId: req.id, payloadLabel: `Approval request — ${a.name}`,
          sizeKb: 24, status: world.devices[targetDeviceId]?.online && world.network.lanOnline ? 'queued' : 'blocked_offline',
          progress: 0, speedMbps: 0, initiatedBy: a.createdByName, createdAt: nowIso(), retries: 0, direction: 'outgoing',
        });
        get().audit('assessment_revised', assessmentId, `Submitted "${a.name}" v${a.version} for approval → ${targetDeviceId}`, 'success', [activeDeviceId, targetDeviceId]);
        set({ world: { ...get().world } });
      },
      decideApproval: (requestId, decision, note) => {
        const { activeDeviceId, world, session } = get();
        const local = world.locals[activeDeviceId];
        const req = local.approvalRequests.find((r) => r.id === requestId);
        if (!req) return;
        const user = get().currentUser();
        req.status = decision;
        req.note = note;
        req.decisionBy = user?.name ?? 'Reviewer';
        req.decisionAt = nowIso();
        const a = local.assessments[req.assessmentId];
        if (a) {
          if (decision === 'approved') {
            a.status = 'approved';
            a.approvedVersion = req.version;
            a.approvedBy = user?.id;
            a.approvedByName = user?.name;
            a.approvedAt = nowIso();
          } else if (decision === 'rejected') {
            a.status = 'rejected';
            a.rejectionNote = note;
          } else {
            a.status = 'revision_requested';
            a.rejectionNote = note;
          }
          a.updatedAt = nowIso();
        }
        // send the decision back to the originating device
        local.transferQueue.push({
          id: uid('xfr'), fromDeviceId: activeDeviceId, toDeviceId: req.fromDeviceId,
          payloadType: 'approval_decision', payloadId: req.id, payloadLabel: `Approval decision — ${req.assessmentName}`,
          sizeKb: 8, status: world.devices[req.fromDeviceId]?.online && world.network.lanOnline ? 'queued' : 'blocked_offline',
          progress: 0, speedMbps: 0, initiatedBy: user?.name ?? 'Reviewer', createdAt: nowIso(), retries: 0, direction: 'outgoing',
        });
        get().audit('assessment_approved', req.assessmentId, `${user?.name} ${decision} "${req.assessmentName}" v${req.version}`, decision === 'rejected' ? 'warning' : 'success');
        set({ world: { ...get().world } });
      },
      distributeAssessment: (assessmentId, targetDeviceIds) => {
        const { activeDeviceId, world, session } = get();
        const local = world.locals[activeDeviceId];
        const a = local.assessments[assessmentId];
        if (!a) return 0;
        const user = get().currentUser();
        if (a.status === 'approved') {
          a.status = 'distributing';
          a.updatedAt = nowIso();
        }
        let queuedCount = 0;
        targetDeviceIds.forEach((tid) => {
          const device = world.devices[tid];
          if (!device) return;
          const reachable = device.online && world.network.lanOnline;
          local.transferQueue.push({
            id: uid('xfr'), fromDeviceId: activeDeviceId, toDeviceId: tid,
            payloadType: 'assessment_package', payloadId: assessmentId,
            payloadLabel: `Exam package — ${a.name} v${a.approvedVersion ?? a.version}`,
            sizeKb: 340 + (assessmentId.length * 7) % 120, status: reachable ? 'queued' : 'blocked_offline',
            progress: 0, speedMbps: 0, initiatedBy: user?.name ?? 'Distributor', createdAt: nowIso(), retries: 0, direction: 'outgoing',
          });
          queuedCount++;
        });
        get().audit('exam_published', assessmentId, `${user?.name} started distribution of "${a.name}" to ${targetDeviceIds.length} computers`, 'success');
        set({ world: { ...get().world } });
        return queuedCount;
      },
      collectResults: (assessmentId, peerIds) => {
        const { activeDeviceId, world, session } = get();
        const local = world.locals[activeDeviceId];
        const user = get().currentUser();
        peerIds.forEach((pid) => {
          const peer = world.devices[pid];
          const peerLocal = world.locals[pid];
          if (!peer || !peerLocal) return;
          const attempts = peerLocal.attempts.filter((at) => at.assessmentId === assessmentId && at.status !== 'in_progress');
          if (attempts.length === 0) return;
          const reachable = peer.online && world.network.lanOnline;
          // one transfer per peer carrying the peer's submissions for this assessment
          local.transferQueue.push({
            id: uid('xfr'), fromDeviceId: pid, toDeviceId: activeDeviceId,
            payloadType: 'submission', payloadId: attempts[0].id, payloadLabel: `Result collection — ${attempts.length} submission(s) from ${peer.name}`,
            sizeKb: 40 * attempts.length, status: reachable ? 'queued' : 'blocked_offline',
            progress: 0, speedMbps: 0, initiatedBy: user?.name ?? 'Collector', createdAt: nowIso(), retries: 0, direction: 'incoming',
            errorNote: reachable ? undefined : 'Peer unreachable — will retry when device reconnects.',
          });
        });
        get().audit('result_collected', assessmentId, `${user?.name} initiated result collection from ${peerIds.length} peers`, 'success');
        set({ world: { ...get().world } });
      },
      retryTransfer: (transferId) => {
        const { activeDeviceId, world } = get();
        const local = world.locals[activeDeviceId];
        const t = local.transferQueue.find((x) => x.id === transferId);
        if (!t) return;
        const target = world.devices[t.toDeviceId];
        const reachable = target?.online && world.network.lanOnline;
        t.status = reachable ? 'queued' : 'blocked_offline';
        t.progress = 0;
        t.retries += 1;
        t.errorNote = reachable ? undefined : 'Peer unreachable — transfer will resume automatically when it reconnects.';
        set({ world: { ...get().world } });
      },
      cancelTransfer: (transferId) => {
        const { activeDeviceId, world } = get();
        const local = world.locals[activeDeviceId];
        const t = local.transferQueue.find((x) => x.id === transferId);
        if (t) t.status = 'cancelled';
        set({ world: { ...get().world } });
      },
      syncWithPeers: (targetIds, payloadTypes) => {
        const { activeDeviceId, world, session } = get();
        const local = world.locals[activeDeviceId];
        const user = get().currentUser();
        let count = 0;
        targetIds.forEach((tid) => {
          payloadTypes.forEach((pt) => {
            const payloadLabel =
              pt === 'question_bank' ? 'Question bank (approved items)' :
              pt === 'student_records' ? 'Student records (authorised subset)' :
              pt === 'staff_records' ? 'Staff records' :
              pt === 'school_settings' ? 'School settings' :
              pt === 'permissions' ? 'Permissions & identity records' : 'School data';
            local.transferQueue.push({
              id: uid('xfr'), fromDeviceId: activeDeviceId, toDeviceId: tid,
              payloadType: pt as TransferTask['payloadType'], payloadId: pt, payloadLabel,
              sizeKb: 120 + Math.floor(Math.random() * 900),
              status: world.devices[tid]?.online && world.network.lanOnline ? 'queued' : 'blocked_offline',
              progress: 0, speedMbps: 0, initiatedBy: user?.name ?? 'User', createdAt: nowIso(), retries: 0, direction: 'outgoing',
            });
            count++;
          });
        });
        get().audit('sync_event', activeDeviceId, `${user?.name} queued ${count} sync task(s) to ${targetIds.length} peer(s)`, 'success');
        set({ world: { ...get().world } });
      },
      pairDevice: (deviceId) => {
        const { world, activeDeviceId, session } = get();
        const d = world.devices[deviceId];
        if (!d) return;
        d.paired = true;
        d.trusted = true;
        const user = get().currentUser();
        get().audit('device_paired', deviceId, `${user?.name ?? 'User'} paired ${d.name} (${deviceId}) from ${activeDeviceId}`, 'success', [activeDeviceId, deviceId]);
        notify({ world: get().world } as DemoStore, deviceId, {
          kind: 'peer_connected', title: 'Paired with school network',
          body: `This computer was paired by ${user?.name ?? 'an administrator'}. Data can now be synchronised.`,
        });
        set({ world: { ...get().world } });
      },
      unpairDevice: (deviceId) => {
        const { world, session } = get();
        const d = world.devices[deviceId];
        if (!d) return;
        d.paired = false;
        d.trusted = false;
        const user = get().currentUser();
        get().audit('device_revoked', deviceId, `${user?.name ?? 'User'} revoked pairing for ${d.name}`, 'warning');
        set({ world: { ...get().world } });
      },
      scanNetwork: () => {
        const { world, activeDeviceId } = get();
        const current = world.devices[activeDeviceId];
        const discovered = Object.values(world.devices).filter(
          (d) => d.id !== activeDeviceId && d.schoolId === current.schoolId && d.online && world.network.lanOnline
        );
        return { discovered };
      },
      resolveConflict: (conflictId, choice, note) => {
        const { activeDeviceId, world, session } = get();
        const local = world.locals[activeDeviceId];
        const c = local.conflicts.find((x) => x.id === conflictId);
        if (!c) return;
        const user = get().currentUser();
        c.status = 'resolved';
        c.resolution = {
          choice, resolvedBy: user?.name ?? 'User', resolvedAt: nowIso(), note,
          before: choice === 'a' ? c.versionA.summary : choice === 'b' ? c.versionB.summary : 'Mixed state',
          after: choice === 'a' ? c.versionA.summary : choice === 'b' ? c.versionB.summary : 'Merged result recorded.',
        };
        // apply side effects
        if (c.type === 'question_edited_both_sides' || c.type === 'delete_vs_edit') {
          if (choice === 'a') {
            if (c.type === 'delete_vs_edit') { /* deletion stays: record removed */ }
          } else if (choice === 'b') {
            // keep edited version on both devices
            const qA = Object.values(world.locals[c.deviceBId]?.questions ?? {}).find((q) => c.affectedRecord.includes(q.id));
            if (qA) world.locals[c.deviceAId].questions[qA.id] = JSON.parse(JSON.stringify(qA));
          }
        }
        get().audit('conflict_resolved', conflictId, `${user?.name} resolved "${c.title}" (${choice}) — ${note}`, 'success', [c.deviceAId, c.deviceBId]);
        set({ world: { ...get().world } });
      },
      deferConflict: (conflictId) => {
        const local = get().local();
        const c = local.conflicts.find((x) => x.id === conflictId);
        if (c) c.status = 'deferred';
        set({ world: { ...get().world } });
      },

      // ---------------- exam flow ----------------
      startAttempt: (assessmentId, studentId) => {
        const { activeDeviceId, world, session } = get();
        const local = world.locals[activeDeviceId];
        const a = local.assessments[assessmentId];
        const pkg = local.examPackages[assessmentId];
        const student = world.users[studentId];
        if (!a || !student) return null;
        // eligibility checks
        if (!pkg) return 'NOT_DELIVERED';
        if (student.classId && !a.classIds.includes(student.classId)) return 'NOT_ELIGIBLE';
        const existing = local.attempts.find((at) => at.assessmentId === assessmentId && at.studentId === studentId && at.status !== 'published');
        if (existing) {
          // resume
          set({
            activeExam: {
              attemptId: existing.id,
              questionOrder: a.questionIds,
              currentIndex: 0,
              remainingSec: Math.max(60, (a.durationMin * 60) - (existing.durationUsedSec ?? 0)),
              timeScale: 1,
            },
          });
          return existing.id;
        }
        const attemptId = uid('ATT');
        const attempt: ExamAttempt = {
          id: attemptId, assessmentId, assessmentVersion: pkg.version, assessmentName: a.name,
          studentId, studentName: student.name, classId: student.classId ?? '',
          className: student.classId ? (world.classes[student.classId]?.name ?? '') : '',
          deviceId: activeDeviceId, startedAt: nowIso(), status: 'in_progress',
          answers: {}, autoScore: 0, manualScore: 0, totalMarks: a.totalMarks, syncState: 'local_only',
          essayQuestionIds: a.questionIds.filter((qid) => {
            const q = local.questions[qid] ?? pkg?.questionPayload?.[qid];
            return q?.type === 'essay';
          }),
        };
        local.attempts.push(attempt);
        get().audit('exam_published', assessmentId, `${student.name} started "${a.name}" on ${activeDeviceId}`, 'success', [activeDeviceId]);
        set({
          world: { ...get().world },
          activeExam: {
            attemptId, questionOrder: a.questionIds, currentIndex: 0,
            remainingSec: a.durationMin * 60, timeScale: 1,
          },
        });
        return attemptId;
      },
      saveAnswer: (questionId, patch) => {
        const { activeDeviceId, world, activeExam } = get();
        if (!activeExam) return;
        const local = world.locals[activeDeviceId];
        const attempt = local.attempts.find((a) => a.id === activeExam.attemptId);
        if (!attempt || attempt.status !== 'in_progress') return;
        const existing = attempt.answers[questionId];
        const merged: AnswerRecord = {
          ...existing,
          questionId,
          state: existing?.state ?? 'answered',
          ...patch,
        };
        if (merged.selected && merged.selected.length === 0 && !merged.text && !merged.ordering && !merged.pairs) {
          merged.state = 'unanswered';
        }
        attempt.answers[questionId] = merged;
        set({ world: { ...get().world }, activeExam: { ...activeExam, lastSavedAt: nowIso() } });
      },
      nextQuestion: (dir) => {
        const { activeExam, world } = get();
        if (!activeExam) return;
        const max = activeExam.questionOrder.length;
        const idx = Math.min(max - 1, Math.max(0, activeExam.currentIndex + dir));
        set({ activeExam: { ...activeExam, currentIndex: idx } });
        void world;
      },
      gotoQuestion: (index) => {
        const { activeExam } = get();
        if (!activeExam) return;
        set({ activeExam: { ...activeExam, currentIndex: index } });
      },
      toggleFlag: (questionId) => {
        const { activeDeviceId, world, activeExam } = get();
        if (!activeExam) return;
        const local = world.locals[activeDeviceId];
        const attempt = local.attempts.find((a) => a.id === activeExam.attemptId);
        if (!attempt) return;
        const rec = attempt.answers[questionId];
        if (rec?.state === 'flagged') {
          attempt.answers[questionId] = { ...rec, state: rec.selected || rec.text ? 'answered' : 'unanswered' };
        } else {
          attempt.answers[questionId] = { ...rec, questionId, state: 'flagged' };
        }
        set({ world: { ...get().world } });
      },
      submitAttempt: (auto) => {
        const { activeDeviceId, world, activeExam, session } = get();
        if (!activeExam) return;
        const local = world.locals[activeDeviceId];
        const attempt = local.attempts.find((a) => a.id === activeExam.attemptId);
        if (!attempt) return;
        // auto-mark objective answers
        let autoScore = 0;
        const essayIds: string[] = [];
        const a = local.assessments[attempt.assessmentId];
        const pkg = local.examPackages[attempt.assessmentId];
        const qSource = (qid: string): Question | undefined => local.questions[qid] ?? pkg?.questionPayload?.[qid];
        a?.questionIds.forEach((qid) => {
          const q = qSource(qid);
          const rec = attempt.answers[qid];
          if (!q) return;
          if (q.type === 'essay') {
            essayIds.push(qid);
            return;
          }
          let ok = false;
          let marks = 0;
          if (rec) {
            if (q.type === 'single_choice' || q.type === 'true_false') {
              ok = !!rec.selected && rec.selected.length === 1 && q.correct.includes(rec.selected[0]);
              marks = ok ? q.marks : 0;
            } else if (q.type === 'multi_choice') {
              const sel = rec.selected ?? [];
              const correct = q.correct;
              const allCorrect = sel.every((s) => correct.includes(s)) && sel.length === correct.length;
              ok = allCorrect;
              marks = allCorrect ? q.marks : sel.filter((s) => correct.includes(s)).length > 0 ? Math.max(0, Math.floor(q.marks / 2)) : 0;
            } else if (q.type === 'short_answer') {
              const text = (rec.text ?? '').trim().toLowerCase();
              ok = q.correct.some((c) => c.trim().toLowerCase() === text);
              marks = ok ? q.marks : 0;
            } else if (q.type === 'numeric') {
              const num = parseFloat(rec.text ?? '');
              const corr = parseFloat(q.correct[0]);
              ok = !isNaN(num) && !isNaN(corr) && Math.abs(num - corr) <= (q.tolerance ?? 0.001);
              marks = ok ? q.marks : 0;
            } else if (q.type === 'fill_blank') {
              ok = (q.blanks ?? []).every((b, i) => {
                const inp = rec.text?.split('||')[i]?.trim().toLowerCase();
                return inp && inp === b.answer.toLowerCase();
              });
              marks = ok ? q.marks : 0;
            } else if (q.type === 'matching') {
              ok = (q.pairs ?? []).every((p) => rec.pairs?.[p.left] === p.right);
              marks = ok ? q.marks : 0;
            } else if (q.type === 'ordering') {
              ok = !!rec.ordering && rec.ordering.join('|') === (q.items ?? []).join('|');
              marks = ok ? q.marks : 0;
            }
            rec.autoCorrect = ok;
            rec.autoMarks = marks;
          }
          autoScore += marks;
        });
        attempt.autoScore = autoScore;
        attempt.manualScore = 0;
        attempt.status = essayIds.length > 0 ? 'submitted' : 'marked';
        attempt.submittedAt = nowIso();
        attempt.percentage = Math.round(((autoScore) / attempt.totalMarks) * 1000) / 10;
        // queue submission transfers to authorised collectors
        AUTO_COLLECTORS.forEach((cid) => {
          const dev = world.devices[cid];
          if (!dev || !dev.paired) return;
          local.transferQueue.push({
            id: uid('xfr'), fromDeviceId: activeDeviceId, toDeviceId: cid,
            payloadType: 'submission', payloadId: attempt.id,
            payloadLabel: `Submission — ${attempt.studentName} (${attempt.assessmentName})`,
            sizeKb: 48, status: dev.online && world.network.lanOnline ? 'queued' : 'blocked_offline',
            progress: 0, speedMbps: 0, initiatedBy: attempt.studentName, createdAt: nowIso(), retries: 0, direction: 'outgoing',
          });
        });
        get().audit('exam_published', attempt.assessmentId, `${attempt.studentName} ${auto ? "completed (time expired)" : 'submitted'} "${attempt.assessmentName}"`, 'success', [activeDeviceId]);
        set({ world: { ...get().world }, activeExam: { ...activeExam, remainingSec: 0 } });
      },
      exitExam: () => set({ activeExam: null }),
      setExamTimeScale: (scale) => {
        const { activeExam } = get();
        if (activeExam) set({ activeExam: { ...activeExam, timeScale: scale } });
      },
      gradeEssay: (attemptId, questionId, marks, comment) => {
        const { activeDeviceId, world } = get();
        const local = world.locals[activeDeviceId];
        const attempt = local.attempts.find((a) => a.id === attemptId);
        if (!attempt) return;
        const rec = attempt.answers[questionId] ?? { questionId, state: 'answered' as const };
        rec.autoMarks = marks;
        rec.autoCorrect = marks > 0;
        if (comment) rec.text = (rec.text ?? '') + `\n[ Examiner: ${comment} ]`;
        const essayIds = attempt.essayQuestionIds ?? [];
        const allGraded = essayIds.every((qid) => attempt.answers[qid]?.autoMarks !== undefined);
        attempt.manualScore = essayIds.reduce((sum, qid) => sum + (attempt.answers[qid]?.autoMarks ?? 0), 0);
        if (allGraded) attempt.status = 'marked';
        attempt.percentage = Math.round(((attempt.autoScore + attempt.manualScore) / attempt.totalMarks) * 1000) / 10;
        get().audit('result_adjusted', attemptId, `Essay marked: ${marks} marks for question ${questionId} — ${attempt.studentName}`, 'success');
        set({ world: { ...get().world } });
      },
      publishResults: (assessmentId) => {
        const { activeDeviceId, world, session } = get();
        const local = world.locals[activeDeviceId];
        const a = local.assessments[assessmentId];
        if (!a) return;
        a.status = 'results_released';
        a.updatedAt = nowIso();
        // publish attempts on this device
        local.attempts.filter((at) => at.assessmentId === assessmentId && at.status === 'marked').forEach((at) => {
          at.status = 'published';
        });
        const user = get().currentUser();
        get().audit('result_adjusted', assessmentId, `${user?.name} released results for "${a.name}"`, 'success');
        set({ world: { ...get().world } });
      },

      // ---------------- practice ----------------
      startPractice: (config, questionIds) => {
        set({
          practice: {
            config, questionIds, answers: {}, currentIndex: 0, startedAt: nowIso(),
            guestName: `Guest-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          },
        });
      },
      savePracticeAnswer: (questionId, patch) => {
        const { practice } = get();
        if (!practice) return;
        const existing = practice.answers[questionId];
        practice.answers[questionId] = { ...existing, questionId, state: existing?.state ?? 'answered', ...patch };
        set({ practice: { ...practice } });
      },
      gotoPracticeQuestion: (index) => {
        const { practice } = get();
        if (!practice) return;
        const max = practice.questionIds.length - 1;
        set({ practice: { ...practice, currentIndex: Math.min(max, Math.max(0, index)) } });
      },
      finishPractice: () => {
        const { practice } = get();
        if (practice) set({ practice: { ...practice, finishedAt: nowIso() } });
      },
      exitPractice: () => set({ practice: null }),

      // ---------------- system ----------------
      tick: () => {
        const { world, activeExam, activeDeviceId } = get();
        let changed = false;
        // 1) advance transfers on ALL devices
        Object.values(world.locals).forEach((local) => {
          local.transferQueue.forEach((t) => {
            if (t.status === 'queued') {
              const target = world.devices[t.toDeviceId];
              if (!target?.online || !world.network.lanOnline) {
                t.status = 'blocked_offline';
                t.errorNote = 'Peer unreachable — transfer paused.';
                changed = true;
                return;
              }
              t.status = 'transferring';
              t.speedMbps = 4 + Math.random() * 22;
              changed = true;
            } else if (t.status === 'transferring') {
              const target = world.devices[t.toDeviceId];
              if (!target?.online || !world.network.lanOnline) {
                t.status = 'blocked_offline';
                t.errorNote = 'Connection lost during transfer.';
                changed = true;
                return;
              }
              t.progress = Math.min(100, t.progress + 7 + Math.random() * 16);
              changed = true;
              if (t.progress >= 100) {
                t.status = 'completed';
                t.completedAt = nowIso();
                applyPayload(world, t);
                // distribution progress: update source assessment
                if (t.payloadType === 'assessment_package') {
                  const srcLocal = world.locals[t.fromDeviceId];
                  const srcA = srcLocal?.assessments[t.payloadId];
                  if (srcA && srcA.status === 'distributing') {
                    const all = srcLocal.transferQueue.filter((x) => x.payloadId === t.payloadId && x.payloadType === 'assessment_package');
                    const done = all.filter((x) => x.status === 'completed').length;
                    const failed = all.filter((x) => x.status === 'failed').length;
                    const pending = all.filter((x) => x.status === 'blocked_offline').length;
                    if (done + failed + pending === all.length && all.length > 0) {
                      srcA.status = 'distributed';
                    }
                  }
                }
                if (t.payloadType === 'submission' && t.direction === 'incoming') {
                  // collection completion: assess whether any more tasks remain
                  const srcLocal = world.locals[t.fromDeviceId];
                  const srcA = srcLocal?.assessments[t.payloadId];
                  void srcA;
                }
              }
            } else if (t.status === 'blocked_offline') {
              const target = world.devices[t.toDeviceId];
              if (target?.online && world.network.lanOnline) {
                t.status = 'queued'; // auto-resume
                t.errorNote = undefined;
                changed = true;
              }
            }
          });
          // trim completed transfers beyond 120
          if (local.transferQueue.length > 120) {
            local.transferQueue = local.transferQueue.filter((t) => t.status !== 'completed').concat(local.transferQueue.filter((t) => t.status === 'completed').slice(-40));
          }
        });
        // 2) exam timer
        if (activeExam && activeExam.remainingSec > 0) {
          const dec = activeExam.timeScale;
          const next = Math.max(0, activeExam.remainingSec - dec);
          set({ activeExam: { ...activeExam, remainingSec: next } });
          if (next === 0) {
            get().submitAttempt(true);
            return;
          }
        }
        if (changed) set({ world: { ...world } });
        void activeDeviceId;
      },
      toggleNetwork: () => {
        const { world } = get();
        world.network.lanOnline = !world.network.lanOnline;
        set({ world: { ...get().world } });
      },
      setDeviceOnline: (deviceId, online) => {
        const { world } = get();
        const d = world.devices[deviceId];
        if (!d) return;
        d.online = online;
        d.lastSeen = online ? nowIso() : d.lastSeen;
        notify({ world: get().world } as DemoStore, deviceId, {
          kind: online ? 'peer_connected' : 'peer_disconnected',
          title: online ? 'Device connected' : 'Device disconnected',
          body: `${d.name} (${deviceId}) is now ${online ? 'reachable on the LAN' : 'offline'}.`,
        });
        set({ world: { ...get().world } });
      },
      markNotificationsRead: (ids) => {
        const local = get().local();
        local.notifications.forEach((n) => {
          if (!ids || ids.includes(n.id)) n.read = true;
        });
        set({ world: { ...get().world } });
      },
      pushNotification: (deviceId, n) => {
        notify({ world: get().world } as DemoStore, deviceId, n);
        set({ world: { ...get().world } });
      },
      audit: (action, target, detail, status = 'success', deviceIds) => {
        const { world, session, activeDeviceId } = get();
        const user = session ? world.users[session.userId] : null;
        const targets = deviceIds && deviceIds.length ? deviceIds : [activeDeviceId];
        targets.forEach((tid) => {
          const local = world.locals[tid];
          if (!local) return;
          local.auditLog.unshift({
            id: uid('aud'), at: nowIso(), deviceId: tid, userId: user?.id ?? 'system',
            userName: user?.name ?? 'System', action, target, detail, status,
          });
          if (local.auditLog.length > 120) local.auditLog.length = 120;
        });
      },
      createBackup: (kind, scope) => {
        const { activeDeviceId, session } = get();
        const local = get().world.locals[activeDeviceId];
        const user = session ? get().world.users[session.userId] : null;
        local.backups.unshift({
          id: uid('bkp'), createdAt: nowIso(), createdBy: user?.name ?? 'Manual',
          sizeMb: kind === 'full' ? 420 : 90, kind, scope, encrypted: true, verified: true,
          location: `D:\\ExamHubBackups\\${activeDeviceId}`, status: 'completed',
        });
        get().audit('backup_restore', 'backup', `${kind === 'full' ? 'Full' : 'Selective'} backup created (${scope})`, 'success');
        set({ world: { ...get().world } });
      },
      restoreBackup: (backupId) => {
        const { activeDeviceId } = get();
        get().audit('backup_restore', backupId, `Restore wizard completed on ${activeDeviceId} — records verified`, 'warning');
        set({ world: { ...get().world } });
      },
      importUpdatePackage: () => {
        const { activeDeviceId } = get();
        const local = get().local();
        local.updateState.importedPackage = { version: '1.4.1', importedAt: nowIso(), verified: true, sizeMb: 186 };
        local.updateState.availableVersion = '1.4.1';
        local.updateState.releaseNotes = [
          'Faster peer discovery on large LANs (100+ devices).',
          'Result collection retries now resume automatically after reconnection.',
          'Fixed essay marking rubric display for long responses.',
          'New local AI provider option for question generation (no internet required).',
        ];
        get().audit('update_event', '1.4.1', `Verified update package imported on ${activeDeviceId}`, 'success');
        set({ world: { ...get().world } });
      },
      distributeUpdate: (targetIds) => {
        const { activeDeviceId, session } = get();
        const local = get().local();
        const user = session ? get().world.users[session.userId] : null;
        targetIds.forEach((tid) => {
          const dev = get().world.devices[tid];
          local.transferQueue.push({
            id: uid('xfr'), fromDeviceId: activeDeviceId, toDeviceId: tid,
            payloadType: 'update_package', payloadId: '1.4.1', payloadLabel: 'App update 1.4.1',
            sizeKb: 190464, status: dev?.online && get().world.network.lanOnline ? 'queued' : 'blocked_offline',
            progress: 0, speedMbps: 0, initiatedBy: user?.name ?? 'User', createdAt: nowIso(), retries: 0, direction: 'outgoing',
          });
        });
        get().audit('update_event', '1.4.1', `Distributing update 1.4.1 to ${targetIds.length} peers`, 'success');
        set({ world: { ...get().world } });
      },
      activateLicenceOnline: () => {
        const { world } = get();
        // activate Greenfield licence (simulated online check)
        void world;
      },
      importActivationFile: () => {},
      resetDemo: () => {
        const world = initialWorld();
        set({
          world, activeDeviceId: 'DEV-017', session: null, activeExam: null, practice: null,
          route: { path: '/', params: {} }, simulatorOpen: false, walkthroughOpen: false,
        });
        if (typeof window !== 'undefined') window.location.hash = '/';
      },
      loadScenario: (name) => {
        // Scenario jumps mutate the seeded world to a defined story point.
        const world = initialWorld();
        const locals = world.locals;
        const MATH = 'ASSESS-MATH-SS2-MIDTERM';
        const labPool = Array.from({ length: 40 }, (_, i) => `DEV-${String(61 + i).padStart(3, '0')}`);
        const ss2 = Object.values(world.users).filter((u) => u.role === 'student' && u.classId?.startsWith('cls-ss2'));

        const copyMathTo = (devId: string, status: Assessment['status']) => {
          const src = locals['DEV-043'].assessments[MATH];
          if (!src) return;
          const copy = JSON.parse(JSON.stringify(src)) as Assessment;
          copy.status = status;
          locals[devId].assessments[MATH] = copy;
          const qp: Record<string, Question> = {};
          copy.questionIds.forEach((qid) => {
            const q = locals['DEV-043'].questions[qid];
            if (q) qp[qid] = JSON.parse(JSON.stringify(q));
          });
          locals[devId].examPackages[MATH] = {
            assessmentId: MATH, version: 1, receivedAt: nowIso(), fromDeviceId: 'DEV-043',
            questionPayload: qp, totalMarks: copy.totalMarks, durationMin: copy.durationMin,
          };
        };

        if (name === 'fresh') {
          // nothing extra
        } else if (name === 'approved') {
          // Math exam approved on DEV-043, teacher notified, not yet distributed
          const src = locals['DEV-017'].assessments[MATH];
          locals['DEV-043'].assessments[MATH] = JSON.parse(JSON.stringify(src));
          locals['DEV-043'].assessments[MATH].status = 'approved';
          locals['DEV-043'].assessments[MATH].approvedVersion = 1;
          locals['DEV-043'].assessments[MATH].approvedBy = 'u-admin';
          locals['DEV-043'].assessments[MATH].approvedByName = 'Mrs. Adaeze Okafor';
          locals['DEV-017'].assessments[MATH].status = 'approved';
          locals['DEV-017'].assessments[MATH].approvedVersion = 1;
        } else if (name === 'distributed') {
          locals['DEV-043'].assessments[MATH] = { ...(locals['DEV-017'].assessments[MATH]), status: 'approved', approvedVersion: 1, approvedBy: 'u-admin', approvedByName: 'Mrs. Adaeze Okafor' };
          Object.values(world.devices).filter((d) => d.schoolId === 'sch-greenfield' && d.id !== 'DEV-043').forEach((d) => copyMathTo(d.id, 'distributed'));
          world.scenario.distributionDone = true;
          locals['DEV-043'].assessments[MATH].status = 'distributed';
        } else if (name === 'collected' || name === 'released') {
          // full distribution + all attempts + collection on DEV-008 (97/100)
          locals['DEV-043'].assessments[MATH] = { ...(locals['DEV-017'].assessments[MATH]), status: 'approved', approvedVersion: 1, approvedBy: 'u-admin', approvedByName: 'Mrs. Adaeze Okafor' };
          Object.values(world.devices).filter((d) => d.schoolId === 'sch-greenfield' && d.id !== 'DEV-043').forEach((d) => copyMathTo(d.id, 'distributed'));
          locals['DEV-043'].assessments[MATH].status = 'marking';
          world.scenario.distributionDone = true;
          // give every SS2 student a submitted attempt spread over devices
          const mathQs = locals['DEV-043'].assessments[MATH].questionIds;
          ss2.forEach((stu, ix) => {
            const devId = labPool[ix % labPool.length];
            const attempt: ExamAttempt = {
              id: `ATT-MATH-${String(ix + 1).padStart(3, '0')}`,
              assessmentId: MATH, assessmentVersion: 1, assessmentName: 'SS2 Mathematics — Mid-Term Examination',
              studentId: stu.id, studentName: stu.name, classId: stu.classId ?? '',
              className: world.classes[stu.classId ?? '']?.name ?? '', deviceId: devId,
              startedAt: nowIso(), submittedAt: nowIso(), status: ix < 8 ? 'marked' : 'submitted',
              answers: {}, autoScore: 8 + ((ix * 7) % 16), manualScore: 0, totalMarks: 25,
              percentage: 0, syncState: 'synced', essayQuestionIds: mathQs.slice(-1),
            };
            attempt.percentage = Math.round(((attempt.autoScore + attempt.manualScore) / 25) * 1000) / 10;
            locals[devId].attempts.push(attempt);
            const sub: SubmissionRecord = {
              id: `SUB-MATH-${String(ix + 1).padStart(3, '0')}`, attemptId: attempt.id, assessmentId: MATH,
              studentId: stu.id, studentName: stu.name, classId: stu.classId ?? '',
              score: attempt.autoScore, totalMarks: 25, receivedFromDeviceId: devId,
              receivedAt: nowIso(), contentHash: `sha256:${attempt.id}`, verified: true,
            };
            locals['DEV-008'].submissions.push(sub);
          });
          // exactly 3 outstanding results: one candidate each on DEV-071, DEV-089, DEV-096
          const outstandingDevices = ['DEV-071', 'DEV-089', 'DEV-096'];
          outstandingDevices.forEach((dev) => {
            const idx = locals['DEV-008'].submissions.findIndex((s) => s.assessmentId === MATH && s.receivedFromDeviceId === dev);
            if (idx >= 0) locals['DEV-008'].submissions.splice(idx, 1);
          });
          world.scenario.collectionDone = false;
          if (name === 'released') {
            locals['DEV-043'].assessments[MATH].status = 'results_released';
            world.scenario.collectionDone = true;
            locals['DEV-008'].submissions.forEach((s) => {
              const att = Object.values(locals).flatMap((l) => l.attempts).find((a) => a.id === s.attemptId);
              if (att) att.status = 'published';
            });
          }
        }
        set({ world, activeDeviceId: 'DEV-017', session: null, activeExam: null });
        if (typeof window !== 'undefined') window.location.hash = '/';
      },
    }),
    {
      name: 'examhub-demo-v1',
      version: WORLD_VERSION,
      partialize: (state) => ({
        world: state.world,
        activeDeviceId: state.activeDeviceId,
        session: state.session,
        activeExam: state.activeExam,
        practice: state.practice,
        booted: true,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hydrated = true;
          state.syncFromHash();
        }
      },
    }
  )
);

// start hash listener
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    useDemoStore.getState().syncFromHash();
  });
}
