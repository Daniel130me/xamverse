/**
 * The EngineClient contract — what every adapter must implement.
 *
 * Contract: docs/phase2/ENGINE_API.md. The UI depends ONLY on this client
 * (ARCHITECTURE.md rule), so screens run unchanged on desktop IPC, the LAN
 * browser bridge, or the in-memory mock.
 */
import type {
  ActivationRequest,
  AttemptRow,
  AuditRow,
  BootstrapIdentity,
  ConflictRow,
  EngineEvent,
  EngineStatus,
  JobRow,
  LicenceStatus,
  ManualPeerEntry,
  PackageManifest,
  PairPending,
  PeerAdvertisement,
  PeerTrustState,
  PullSummary,
  Session,
  SyncOp,
} from './types.js';
import { EngineError } from './errors.js';

export type EventUnsubscribe = () => void;

export interface EngineClient {
  readonly transport: 'desktop' | 'browser' | 'mock';

  auth: {
    bootstrapStatus(): Promise<{ required: boolean }>;
    bootstrap(
      schoolName: string,
      username: string,
      displayName: string,
      password: string,
    ): Promise<{ identity: BootstrapIdentity; token: string; session: Session }>;
    login(schoolId: string, username: string, password: string, kind: 'desktop' | 'browser'): Promise<{ token: string; session: Session }>;
    authenticate(token: string): Promise<Session>;
    logout(token: string): Promise<{ ok: true }>;
    lockSession(token: string): Promise<{ ok: true }>;
    unlockSession(token: string, password: string): Promise<Session>;
    changePassword(schoolId: string, userId: string, oldPassword: string | null, next: string): Promise<{ revision: number }>;
  };

  permissions: {
    can(session: Session, permission: string): boolean;
    require(session: Session, permission: string, target?: string): void;
    listReserved(): string[];
  };

  peers: {
    status(): Promise<EngineStatus['schools']>;
    scan(): Promise<PeerAdvertisement[]>;
    addManualPeer(ip: string, port?: number): Promise<ManualPeerEntry>;
    listManualPeers(): Promise<ManualPeerEntry[]>;
    requestPairing(addr: string, schoolId: string, schoolName: string): Promise<PairPending>;
    approvePairing(schoolId: string, deviceId: string, approvedBy: string): Promise<{ ok: true }>;
    revokeDevice(schoolId: string, deviceId: string, revokedBy: string, reason: string): Promise<{ ok: true }>;
    listPeers(schoolId: string): Promise<{ device_id: string; state: PeerTrustState }[]>;
    fingerprint(): Promise<string>;
    pingPeer(addr: string): Promise<{ rtt_ms: number; device_id: string }>;
  };

  sync: {
    createOp(args: {
      schoolId: string;
      category: string;
      objectId: string;
      payloadJson?: string;
      blobSha256?: string;
      tombstone?: boolean;
      targetDeviceIds: string[];
      expectedBaseRevision?: number;
    }): Promise<SyncOp>;
    objects(schoolId: string, category?: string, limit?: number): Promise<unknown[]>;
    jobs(schoolId: string, status?: JobRow['status'], limit?: number): Promise<JobRow[]>;
    retryJob(jobId: string): Promise<{ ok: true }>;
    cancelJob(jobId: string): Promise<{ ok: true }>;
    pull(peerDeviceId: string, schoolId: string, categories?: string[]): Promise<PullSummary>;
  };

  conflicts: {
    list(schoolId: string, status?: ConflictRow['status']): Promise<ConflictRow[]>;
    get(conflictId: string): Promise<ConflictRow>;
    resolve(conflictId: string, resolution: 'accept_incoming' | 'keep_local', resolvedBy: string, note?: string): Promise<{ outcome: unknown }>;
    defer(conflictId: string): Promise<{ ok: true }>;
  };

  packages: {
    importPackage(manifest: PackageManifest, contentJson: string, approvedSignature: string | null, targetDeviceIds: string[]): Promise<SyncOp>;
    studentView(schoolId: string, packageId: string): Promise<unknown>;
    fullView(schoolId: string, packageId: string): Promise<unknown>;
    contentHash(schoolId: string, packageId: string): Promise<string>;
  };

  attempts: {
    startAttempt(schoolId: string, packageId: string, studentRef: string): Promise<AttemptRow>;
    saveAnswer(attemptId: string, kind: string, payload: unknown): Promise<{ seq: number; hash: string }>;
    finalizeAttempt(attemptId: string, integritySignature: string, targetDeviceIds: string[]): Promise<SyncOp>;
    getAttempt(attemptId: string): Promise<AttemptRow>;
    finalizedAttempts(schoolId: string): Promise<AttemptRow[]>;
  };

  licensing: {
    activationRequest(schoolHint: string): Promise<ActivationRequest>;
    importActivation(certJson: string): Promise<LicenceStatus>;
    licenceStatus(): Promise<LicenceStatus>;
    entitlements(): Promise<string[]>;
    featureAvailable(feature: string): Promise<boolean>;
  };

  backups: {
    createBackup(passphrase: string, kind: 'full', schoolScope?: null): Promise<{ path: string }>;
    verifyBackup(path: string, passphrase: string): Promise<unknown>;
    listBackups(): Promise<unknown[]>;
  };

  updates: {
    importUpdate(manifestJson: string, artifact: Uint8Array): Promise<{ updateId: string }>;
    stageUpdate(updateId: string): Promise<{ path: string }>;
    markUpdateApplied(updateId: string): Promise<{ ok: true }>;
    markUpdateRejected(updateId: string, reason: string): Promise<{ ok: true }>;
    updateHistory(limit: number): Promise<unknown[]>;
  };

  audit: {
    query(filter: { schoolId?: string; actorUser?: string; actionPrefix?: string; limit?: number }): Promise<AuditRow[]>;
    verifyChain(): Promise<boolean>;
  };

  diagnostics(): Promise<EngineStatus>;

  events: {
    subscribe(onEvent: (e: EngineEvent) => void): EventUnsubscribe;
    subscribeSince(lastEventId: string, onEvent: (e: EngineEvent) => void): EventUnsubscribe;
    recent(limit: number): Promise<EngineEvent[]>;
  };
}

/** The 14 engine-reserved permission strings (ENGINE_API.md §4). */
export const RESERVED_PERMISSIONS: readonly string[] = [
  'devices.pair',
  'devices.revoke',
  'sync.read',
  'sync.write',
  'sync.distribute',
  'sync.collect',
  'sync.resolve_conflict',
  'licence.manage',
  'updates.manage',
  'backups.manage',
  'audit.view',
  'identity.manage',
  'sessions.revoke',
  'users.manage',
];

/** Shared client-side permission helpers (engine remains the boundary). */
export function can(session: Session, permission: string): boolean {
  return session.permissions.includes(permission);
}

export function requirePermission(session: Session, permission: string, target?: string): void {
  if (!can(session, permission)) {
    throw new EngineError(
      'permission_denied',
      `permission denied: ${permission}${target ? ` (${target})` : ''}`,
      { permission },
    );
  }
}
