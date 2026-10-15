/**
 * Service contracts — the compiler-checked boundary between the UI layer and
 * the (simulated) backend, grouped exactly as documented in
 * docs/INTEGRATION_CONTRACTS.md.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The single Zustand store in `./store` implements every business operation
 * as a *simulation* (tick-driven transfers, seeded world, hash auth…). Phase 2
 * (desktop engine) and Phase 3 (production app) replace those internals, but
 * the UI must keep depending only on the operation signatures.
 *
 * Each export below is a structural `Pick` of the concrete store, so the
 * contracts can NEVER drift from the implementation — the compiler regenerates
 * them on every change. A Phase 2/3 engine implementation that satisfies
 * these interfaces can be swapped in without touching a single screen.
 *
 * LAYERING RULE (enforced below by _assertNoUncontractedActions):
 * every business action on the store must appear in at least one service
 * contract. Prototype-only demo controls are explicitly allow-listed under
 * `DemoControlService` / `UiInfrastructure` so they can be stripped or
 * build-flagged in production.
 */
import type { DemoStore } from './store';

// ----- Session & identity -------------------------------------------------

/** Login, session lifecycle and identity switching (per-device auth). */
export type AuthService = Pick<
  DemoStore,
  'login' | 'logout' | 'lockSession' | 'unlockSession' | 'switchDevice' | 'switchUser'
>;

/** Read-model selectors the UI uses to render the current context. */
export type ReadModelService = Pick<
  DemoStore,
  'currentUser' | 'currentDevice' | 'local' | 'can' | 'roleDef'
>;

// ----- School & people ----------------------------------------------------

/** School identity and academic structure administration. */
export type SchoolService = Pick<DemoStore, 'updateSchoolProfile' | 'createClass'>;

/** Account administration and browser-session governance. */
export type UserService = Pick<DemoStore, 'setUserStatus' | 'revokeBrowserSession'>;

// ----- Learning content ---------------------------------------------------

/** Question authoring (version bumping, local bank writes). */
export type QuestionBankService = Pick<DemoStore, 'saveQuestion' | 'deleteQuestion'>;

// ----- Assessments & lifecycle -------------------------------------------

/** Assessment CRUD, approval workflow, distribution and release. */
export type AssessmentService = Pick<
  DemoStore,
  'saveAssessment' | 'submitAssessmentForApproval' | 'decideApproval' | 'distributeAssessment' | 'publishResults'
>;

/** Controlled exam taking: start, answer, navigate, flag, submit. */
export type ExamAttemptService = Pick<
  DemoStore,
  'startAttempt' | 'saveAnswer' | 'nextQuestion' | 'gotoQuestion' | 'toggleFlag' | 'submitAttempt' | 'exitExam'
>;

/** Marking and moderation of collected results. */
export type ResultsService = Pick<DemoStore, 'collectResults' | 'gradeEssay' | 'publishResults'>;

// ----- Peer networking ----------------------------------------------------

/** LAN discovery and trust management. */
export type PeerDiscoveryService = Pick<DemoStore, 'scanNetwork' | 'pairDevice' | 'unpairDevice'>;

/** Transfer queue operations and the sync engine's network controls. */
export type SyncService = Pick<
  DemoStore,
  'retryTransfer' | 'cancelTransfer' | 'syncWithPeers' | 'tick' | 'toggleNetwork' | 'setDeviceOnline'
>;

/** Side-by-side conflict resolution. */
export type ConflictService = Pick<DemoStore, 'resolveConflict' | 'deferConflict'>;

// ----- Platform services --------------------------------------------------

export type NotificationService = Pick<DemoStore, 'markNotificationsRead' | 'pushNotification'>;

export type AuditService = Pick<DemoStore, 'audit'>;

export type BackupService = Pick<DemoStore, 'createBackup' | 'restoreBackup'>;

export type UpdateService = Pick<DemoStore, 'importUpdatePackage' | 'distributeUpdate'>;

export type LicensingService = Pick<DemoStore, 'activateLicenceOnline' | 'importActivationFile'>;

// ----- Practice (anonymous, guest-scoped) ---------------------------------

export type PracticeService = Pick<
  DemoStore,
  'startPractice' | 'savePracticeAnswer' | 'gotoPracticeQuestion' | 'finishPractice' | 'exitPractice'
>;

// ----- Prototype-only surfaces (never part of the production contract) ----

/**
 * Demo controls: reset/scenario jumps, simulator + walkthrough toggles, the
 * exam timer's demo time-acceleration, and the SPA hash-router plumbing.
 * In production these are either replaced by real navigation or stripped /
 * gated behind a build flag (see CODEX_PHASE2_HANDOFF.md §5).
 */
export type DemoControlService = Pick<
  DemoStore,
  'resetDemo' | 'loadScenario' | 'setSimulatorOpen' | 'setWalkthroughOpen' | 'setExamTimeScale' | 'toggleSidebar'
>;

export interface UiInfrastructure {
  navigate: DemoStore['navigate'];
  syncFromHash: DemoStore['syncFromHash'];
}

// ---------------------------------------------------------------------------
// Coverage assertion — the compiler enforces the layering rule.
// ---------------------------------------------------------------------------

type ContractedKeys =
  | keyof AuthService | keyof ReadModelService
  | keyof SchoolService | keyof UserService
  | keyof QuestionBankService
  | keyof AssessmentService | keyof ExamAttemptService | keyof ResultsService
  | keyof PeerDiscoveryService | keyof SyncService | keyof ConflictService
  | keyof NotificationService | keyof AuditService
  | keyof BackupService | keyof UpdateService | keyof LicensingService
  | keyof PracticeService
  | keyof DemoControlService | keyof UiInfrastructure;

/** Observable state held by the store (data, not operations). */
export type StateKeys =
  | 'world' | 'activeDeviceId' | 'session' | 'route'
  | 'activeExam' | 'practice' | 'simulatorOpen' | 'walkthroughOpen'
  | 'sidebarCollapsed' | 'hydrated';

/** Store actions that appear in no service contract. Must stay `never`. */
export type UncontractedActions = Exclude<keyof DemoStore, ContractedKeys | StateKeys>;

type AssertNever<T> = [T] extends [never] ? true : never;
const _assertNoUncontractedActions: AssertNever<UncontractedActions> = true;
void _assertNoUncontractedActions;
