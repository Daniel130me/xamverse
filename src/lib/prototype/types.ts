/**
 * ExamHub — Offline-First Decentralized School Examination Platform
 * Phase 1 Interactive Prototype — Core Type Definitions
 *
 * These types are the conceptual data models for handoff.
 * See DATA_MODELS.md for entity relationship documentation.
 *
 * SIMULATION NOTICE: All data in this prototype is simulated and stored in
 * browser localStorage. Nothing here is production-secure.
 */

// ============================================================
// Identity & Access
// ============================================================

export type Role =
  | 'proprietor'
  | 'administrator'
  | 'exam_officer'
  | 'hod'
  | 'teacher'
  | 'invigilator'
  | 'student'
  | 'parent'
  | 'support';

export type PermissionKey =
  | 'school.manage'
  | 'academic.manage'
  | 'users.manage'
  | 'roles.manage'
  | 'questions.view'
  | 'questions.create'
  | 'questions.approve'
  | 'ai.use'
  | 'assessments.view'
  | 'assessments.create'
  | 'assessments.approve'
  | 'assessments.publish'
  | 'exams.monitor'
  | 'exams.invigilate'
  | 'exams.take'
  | 'results.view_school'
  | 'results.view_own'
  | 'results.mark'
  | 'results.approve_release'
  | 'analytics.view'
  | 'devices.view'
  | 'devices.pair'
  | 'sync.distribute'
  | 'sync.collect'
  | 'sync.run'
  | 'conflicts.resolve'
  | 'licence.manage'
  | 'updates.manage'
  | 'backups.manage'
  | 'settings.manage'
  | 'audit.view';

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  system: boolean; // built-in role, cannot be deleted
  permissions: PermissionKey[];
  memberCount: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  customRoleId?: string;
  schoolId: string;
  status: 'active' | 'suspended' | 'inactive';
  phone?: string;
  classId?: string; // students
  admissionNo?: string; // students
  childrenIds?: string[]; // parents
  subjectIds?: string[]; // teachers
  departmentId?: string;
  avatarHue: number;
  createdAt: string;
  lastLoginAt?: string;
  /** demo quick-login hint */
  demoLabel?: string;
}

export interface UserSession {
  id: string;
  userId: string;
  deviceId: string;
  source: 'desktop' | 'browser';
  ipAddress: string;
  startedAt: string;
  lastActiveAt: string;
  active: boolean;
}

// ============================================================
// School Structure
// ============================================================

export interface School {
  id: string;
  name: string;
  shortName: string;
  type: 'primary' | 'secondary' | 'combined';
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  motto?: string;
  logoHue: number;
  currentSession: string; // "2025/2026"
  currentTerm: 1 | 2 | 3;
  plan: 'starter' | 'standard' | 'campus';
  gradingScheme: GradeBand[];
  announcement?: string;
}

export interface GradeBand {
  grade: string;
  min: number;
  max: number;
  remark: string;
}

export interface ClassRoom {
  id: string;
  name: string; // "SS2 A"
  level: string; // "SS2"
  arm: string; // "A"
  category: 'primary' | 'junior_secondary' | 'senior_secondary';
  classTeacherId?: string;
  capacity: number;
}

export interface Department {
  id: string;
  name: string;
  headId?: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  departmentId: string;
  levelCategory: 'primary' | 'junior_secondary' | 'senior_secondary' | 'all';
}

export interface TopicNode {
  id: string;
  subjectId: string;
  name: string;
  subtopics: string[];
}

export interface AcademicSession {
  id: string;
  name: string; // "2025/2026"
  startDate: string;
  endDate: string;
  status: 'active' | 'completed' | 'planned';
  terms: { term: 1 | 2 | 3; label: string; start: string; end: string; status: 'active' | 'completed' | 'planned' }[];
}

// ============================================================
// Questions
// ============================================================

export type QuestionType =
  | 'single_choice'
  | 'multi_choice'
  | 'true_false'
  | 'short_answer'
  | 'numeric'
  | 'essay'
  | 'matching'
  | 'ordering'
  | 'fill_blank';

export type QuestionStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  schoolId: string;
  subjectId: string;
  level: string; // "SS2"
  topic: string;
  subtopic?: string;
  learningObjective?: string;
  type: QuestionType;
  difficulty: 'easy' | 'medium' | 'hard';
  estimatedTimeSec: number;
  marks: number;
  tags: string[];
  statement: string; // supports **bold**
  options?: QuestionOption[];
  correct: string[]; // option ids or expected text
  acceptMultiple?: boolean; // short answers
  tolerance?: number; // numeric
  pairs?: { left: string; right: string }[]; // matching
  items?: string[]; // ordering (correct order)
  blanks?: { answer: string }[]; // fill_blank
  explanation?: string;
  workedSolution?: string;
  hint?: string;
  status: QuestionStatus;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  source: 'manual' | 'ai' | 'import';
  usageCount: number;
  attachment?: { kind: 'image' | 'table' | 'audio'; label: string } | null;
}

export interface QuestionRevision {
  questionId: string;
  version: number;
  editedBy: string;
  editedAt: string;
  changeSummary: string;
  snapshotStatement: string;
}

// ============================================================
// Assessments
// ============================================================

export type AssessmentType =
  | 'continuous_assessment'
  | 'weekly_test'
  | 'assignment'
  | 'mock_exam'
  | 'entrance_exam'
  | 'end_of_term_exam'
  | 'diagnostic'
  | 'public_practice'
  | 'custom';

export type AssessmentStatus =
  | 'draft'
  | 'pending_approval'
  | 'revision_requested'
  | 'rejected'
  | 'approved'
  | 'scheduled'
  | 'ready_for_distribution'
  | 'distributing'
  | 'distributed'
  | 'active'
  | 'completed'
  | 'marking'
  | 'awaiting_result_approval'
  | 'results_released'
  | 'archived';

export interface AssessmentSection {
  id: string;
  name: string;
  instruction?: string;
  questionIds: string[];
}

export interface Assessment {
  id: string;
  schoolId: string;
  name: string;
  description: string;
  instructions: string;
  subjectId: string;
  classIds: string[]; // eligible classes
  type: AssessmentType;
  access: 'controlled' | 'public';
  startAt: string;
  endAt: string;
  durationMin: number;
  totalMarks: number;
  passMark: number;
  attemptsAllowed: number;
  questionIds: string[];
  sections: AssessmentSection[];
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  status: AssessmentStatus;
  version: number;
  approvedVersion?: number;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionNote?: string;
  createdBy: string;
  createdByName: string;
  createdOnDevice: string;
  createdAt: string;
  updatedAt: string;
  resultVisibility: 'immediate' | 'after_approval' | 'after_release';
  feedbackPolicy: 'none' | 'correct_incorrect' | 'full_solutions';
  submissionMode: 'auto_sync' | 'collected';
  customTypeLabel?: string;
}

export interface AssessmentVersionRecord {
  assessmentId: string;
  version: number;
  editedBy: string;
  editedAt: string;
  changeSummary: string;
  statusAtCreation: AssessmentStatus;
}

// ============================================================
// Exam Delivery & Attempts
// ============================================================

export interface ExamPackage {
  assessmentId: string;
  version: number;
  receivedAt: string;
  fromDeviceId: string;
  /** Sealed question payloads — includes answer keys, hidden from students by the UI. */
  questionPayload: Record<string, Question>;
  totalMarks: number;
  durationMin: number;
}

export type AnswerState = 'answered' | 'flagged' | 'unanswered' | 'skipped';

export interface AnswerRecord {
  questionId: string;
  state: AnswerState;
  selected?: string[];
  text?: string;
  ordering?: string[];
  pairs?: Record<string, string>;
  timeSpentSec?: number;
  /** auto-marking outcome (objective questions) */
  autoCorrect?: boolean;
  autoMarks?: number;
}

export type AttemptStatus =
  | 'in_progress'
  | 'submitted'
  | 'marked'
  | 'awaiting_moderation'
  | 'published'
  | 'interrupted';

export interface ExamAttempt {
  id: string;
  assessmentId: string;
  assessmentVersion: number;
  assessmentName: string;
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  deviceId: string;
  startedAt: string;
  submittedAt?: string;
  durationUsedSec?: number;
  status: AttemptStatus;
  answers: Record<string, AnswerRecord>;
  autoScore: number;
  manualScore: number;
  totalMarks: number;
  percentage?: number;
  syncState: 'local_only' | 'queued' | 'synced';
  syncAttemptCount?: number;
  essayQuestionIds?: string[];
}

export interface SubmissionRecord {
  id: string;
  attemptId: string;
  assessmentId: string;
  studentId: string;
  studentName: string;
  classId: string;
  score: number;
  totalMarks: number;
  receivedFromDeviceId: string;
  receivedAt: string;
  contentHash: string;
  duplicateOf?: string;
  verified: boolean;
}

// ============================================================
// Peers, Sync & Conflicts
// ============================================================

export type PayloadType =
  | 'approval_request'
  | 'approval_decision'
  | 'assessment_package'
  | 'question_bank'
  | 'student_records'
  | 'staff_records'
  | 'submission'
  | 'result_set'
  | 'permissions'
  | 'school_settings'
  | 'update_package'
  | 'conflict_resolution';

export type TransferStatus = 'queued' | 'transferring' | 'completed' | 'failed' | 'blocked_offline' | 'cancelled';

export interface TransferTask {
  id: string;
  fromDeviceId: string;
  toDeviceId: string;
  payloadType: PayloadType;
  payloadId: string;
  payloadLabel: string;
  sizeKb: number;
  status: TransferStatus;
  progress: number; // 0-100
  speedMbps: number;
  initiatedBy: string;
  createdAt: string;
  completedAt?: string;
  retries: number;
  errorNote?: string;
  direction: 'outgoing' | 'incoming';
}

export interface SyncEvent {
  id: string;
  at: string;
  deviceId: string;
  peerDeviceId: string;
  payloadType: PayloadType;
  label: string;
  outcome: 'success' | 'failed' | 'conflict' | 'blocked';
  initiatedBy: string;
  detail?: string;
}

export interface Device {
  id: string; // "DEV-017"
  index: number;
  name: string; // "GF-LAB-PC17"
  ip: string;
  port: number;
  os: 'windows' | 'macos';
  appVersion: string;
  schoolId: string;
  paired: boolean;
  online: boolean;
  lastSeen: string;
  storageUsedMb: number;
  storageTotalMb: number;
  dbHealth: 'healthy' | 'warning' | 'error';
  trusted: boolean;
  note?: string;
}

export type ConflictType =
  | 'question_edited_both_sides'
  | 'assessment_revision_divergence'
  | 'published_edited_after_approval'
  | 'duplicate_submission'
  | 'unauthorized_restricted_payload'
  | 'delete_vs_edit';

export type ConflictStatus = 'open' | 'resolved' | 'deferred';

export interface ConflictCase {
  id: string;
  type: ConflictType;
  title: string;
  description: string;
  affectedRecord: string;
  recordKind: 'question' | 'assessment' | 'submission' | 'restricted';
  deviceAId: string;
  deviceBId: string;
  userA: string;
  userB: string;
  detectedAt: string;
  status: ConflictStatus;
  suggestedResolution: string;
  versionA: { label: string; summary: string; fields: { field: string; value: string }[] };
  versionB: { label: string; summary: string; fields: { field: string; value: string }[] };
  resolution?: {
    choice: 'a' | 'b' | 'merge' | 'both' | 'reject';
    resolvedBy: string;
    resolvedAt: string;
    note: string;
    before: string;
    after: string;
  };
}

// ============================================================
// Notifications, Audit & System
// ============================================================

export type NotificationKind =
  | 'peer_connected'
  | 'peer_disconnected'
  | 'sync_progress'
  | 'assessment_received'
  | 'approval_requested'
  | 'assessment_approved'
  | 'assessment_rejected'
  | 'exam_distributed'
  | 'exam_started'
  | 'exam_completed'
  | 'result_received'
  | 'collection_completed'
  | 'conflict_detected'
  | 'permission_changed'
  | 'licence_expiry'
  | 'update_available';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  at: string;
  read: boolean;
  actionRoute?: string;
  deviceId: string; // which device's centre it belongs to
  actorName?: string;
}

export type AuditAction =
  | 'login'
  | 'logout'
  | 'permission_change'
  | 'device_paired'
  | 'device_revoked'
  | 'assessment_approved'
  | 'assessment_revised'
  | 'question_changed'
  | 'exam_published'
  | 'result_adjusted'
  | 'result_collected'
  | 'sync_event'
  | 'conflict_resolved'
  | 'licence_event'
  | 'update_event'
  | 'backup_restore'
  | 'unauthorized_attempt';

export interface AuditEvent {
  id: string;
  at: string;
  deviceId: string;
  userId: string;
  userName: string;
  action: AuditAction;
  target: string;
  detail: string;
  status: 'success' | 'failure' | 'warning';
}

export interface BackupRecord {
  id: string;
  createdAt: string;
  createdBy: string;
  sizeMb: number;
  kind: 'full' | 'selective';
  scope: string;
  encrypted: boolean;
  verified: boolean;
  location: string;
  status: 'completed' | 'failed' | 'in_progress';
}

export interface BrowserSession {
  id: string;
  userName: string;
  role: Role;
  device: string;
  ip: string;
  startedAt: string;
  active: boolean;
}

export interface LicenceState {
  schoolId: string;
  plan: 'starter' | 'standard' | 'campus';
  status: 'active' | 'grace_period' | 'expired' | 'invalid' | 'revoked' | 'unactivated';
  activatedAt?: string;
  expiresAt?: string;
  activationMode?: 'online' | 'offline';
  productKeyMasked?: string;
  deviceLimit: number;
  devicesUsed: number;
  entitlements: string[];
  billingHistory: { id: string; date: string; amount: string; status: 'paid' | 'pending' | 'failed'; description: string }[];
}

export interface UpdateState {
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string[];
  autoUpdate: boolean;
  importedPackage?: { version: string; importedAt: string; verified: boolean; sizeMb: number };
  distributedTo: string[];
  history: { version: string; at: string; status: 'installed' | 'failed' | 'rolled_back'; note: string }[];
}

/** Approval request for an assessment (lives on the reviewer's device until decided) */
export interface ApprovalRequest {
  id: string;
  assessmentId: string;
  /** version submitted for review — the decision binds to this exact version */
  version: number;
  assessmentName: string;
  subjectId: string;
  requestedBy: string;
  requestedByName: string;
  fromDeviceId: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'revision_requested';
  questionCount: number;
  totalMarks: number;
  note?: string;
  decisionBy?: string;
  decisionAt?: string;
}

export interface DeviceLocalState {
  deviceId: string;
  /** locally-known questions */
  questions: Record<string, Question>;
  /** locally-known assessments */
  assessments: Record<string, Assessment>;
  versions: Record<string, AssessmentVersionRecord[]>;
  /** exam packages delivered to this device */
  examPackages: Record<string, ExamPackage>;
  /** attempts taken ON this device */
  attempts: ExamAttempt[];
  /** submissions collected INTO this device */
  submissions: SubmissionRecord[];
  /** approval requests pending on this device */
  approvalRequests: ApprovalRequest[];
  /** outgoing transfer queue */
  transferQueue: TransferTask[];
  /** local sync history */
  syncHistory: SyncEvent[];
  notifications: AppNotification[];
  auditLog: AuditEvent[];
  backups: BackupRecord[];
  browserSessions: BrowserSession[];
  conflicts: ConflictCase[];
  updateState: UpdateState;
  syncCheckpoint: string;
  lastSyncAt?: string;
}
