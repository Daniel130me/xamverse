/**
 * Desktop adapter — one Tauri command per namespace/op, 1:1 with the engine
 * subsystems (contract: docs/phase2/ENGINE_API.md; the command surface the
 * src-tauri shell must expose is exactly `engine_<namespace>_<op>`).
 *
 * The SDK takes `invoke` as an injected function instead of importing
 * `@tauri-apps/api` directly: the SDK stays dependency-free and testable,
 * and the shell owns its Tauri runtime version. Event forwarding is
 * injected the same way (`listen`) because Tauri events live outside the
 * command surface.
 */
import type { EngineClient, EventUnsubscribe } from './client.js';
import { RESERVED_PERMISSIONS } from './client.js';
import { EngineError } from './errors.js';

export type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface DesktopClientOptions {
  /** The shell passes `invoke` from `@tauri-apps/api/core`. */
  invoke: TauriInvoke;
  /**
   * The shell forwards engine events (Tauri emit on the `engine-event`
   * channel) — inject `listen` from `@tauri-apps/api/event` here. Without
   * it, `events.subscribe` fails loudly: a desktop build without event
   * forwarding is a broken shell, not a recoverable state.
   */
  listen?: (onEvent: (e: EngineEventLike) => void) => EventUnsubscribe;
}

export interface EngineEventLike {
  id: string;
  at: string;
  school_id: string | null;
  device_id: string | null;
  type: string;
  data: unknown;
}

export function createDesktopClient(options: DesktopClientOptions): EngineClient {
  const { invoke } = options;

  /** Call `engine_<ns>_<op>` and normalize the engine's error envelope. */
  async function call<T>(ns: string, op: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return (await invoke(`engine_${ns}_${op}`, args)) as T;
    } catch (err) {
      throw unwrapError(err, `engine_${ns}_${op}`);
    }
  }

  function unwrapError(err: unknown, command: string): EngineError {
    // Tauri commands that return Result<T, E> reject with the serialized E —
    // the engine error JSON shape from ENGINE_API.md §2.
    const body = err as { error?: { code?: string; permission?: string; message?: string } };
    if (body && typeof body === 'object' && typeof body.error === 'object' && body.error !== null) {
      return new EngineError(body.error.code ?? 'network', body.error.message ?? command, {
        permission: body.error.permission,
      });
    }
    return new EngineError('network', `${command} failed: ${String(err)}`);
  }

  const client: EngineClient = {
    transport: 'desktop',

    auth: {
      login: (schoolId, username, password, kind) =>
        call('auth', 'login', { schoolId, username, password, kind }),
      authenticate: (token) => call('auth', 'authenticate', { token }),
      logout: (token) => call('auth', 'logout', { token }),
      lockSession: (token) => call('auth', 'lockSession', { token }),
      unlockSession: (token, password) => call('auth', 'unlockSession', { token, password }),
      changePassword: (schoolId, userId, oldPassword, next) =>
        call('auth', 'changePassword', { schoolId, userId, old: oldPassword, next }),
    },

    permissions: {
      can: (session, permission) => session.permissions.includes(permission),
      require: (session, permission, target) => {
        if (!session.permissions.includes(permission)) {
          throw new EngineError(
            'permission_denied',
            `permission denied: ${permission}${target ? ` (${target})` : ''}`,
            { permission },
          );
        }
      },
      listReserved: () => [...RESERVED_PERMISSIONS],
    },

    peers: {
      status: () => call('peers', 'status'),
      scan: () => call('peers', 'scan'),
      addManualPeer: (ip, port) => call('peers', 'addManualPeer', { ip, port }),
      listManualPeers: () => call('peers', 'listManualPeers'),
      requestPairing: (addr, schoolId, schoolName) =>
        call('peers', 'requestPairing', { addr, schoolId, schoolName }),
      approvePairing: (schoolId, deviceId, approvedBy) =>
        call('peers', 'approvePairing', { schoolId, deviceId, approvedBy }),
      revokeDevice: (schoolId, deviceId, revokedBy, reason) =>
        call('peers', 'revokeDevice', { schoolId, deviceId, revokedBy, reason }),
      listPeers: (schoolId) => call('peers', 'listPeers', { schoolId }),
      fingerprint: () => call('peers', 'fingerprint'),
      pingPeer: (addr) => call('peers', 'pingPeer', { addr }),
    },

    sync: {
      createOp: (args) =>
        call('sync', 'createOp', {
          schoolId: args.schoolId,
          category: args.category,
          objectId: args.objectId,
          payloadJson: args.payloadJson,
          blobSha256: args.blobSha256,
          tombstone: args.tombstone ?? false,
          targetDeviceIds: args.targetDeviceIds,
          expectedBaseRevision: args.expectedBaseRevision,
        }),
      objects: (schoolId, category, limit) => call('sync', 'objects', { schoolId, category, limit }),
      jobs: (schoolId, status, limit) => call('sync', 'jobs', { schoolId, status, limit }),
      retryJob: (jobId) => call('sync', 'retryJob', { jobId }),
      cancelJob: (jobId) => call('sync', 'cancelJob', { jobId }),
      pull: (peerDeviceId, schoolId, categories) =>
        call('sync', 'pull', { peerDeviceId, schoolId, categories }),
    },

    conflicts: {
      list: (schoolId, status) => call('conflicts', 'list', { schoolId, status }),
      get: (conflictId) => call('conflicts', 'get', { conflictId }),
      resolve: (conflictId, resolution, resolvedBy, note) =>
        call('conflicts', 'resolve', { conflictId, resolution, resolvedBy, note }),
      defer: (conflictId) => call('conflicts', 'defer', { conflictId }),
    },

    packages: {
      importPackage: (manifest, contentJson, approvedSignature, targetDeviceIds) =>
        call('packages', 'importPackage', { manifest, contentJson, approvedSignature, targetDeviceIds }),
      studentView: (schoolId, packageId) => call('packages', 'studentView', { schoolId, packageId }),
      fullView: (schoolId, packageId) => call('packages', 'fullView', { schoolId, packageId }),
      contentHash: (schoolId, packageId) => call('packages', 'contentHash', { schoolId, packageId }),
    },

    attempts: {
      startAttempt: (schoolId, packageId, studentRef) =>
        call('attempts', 'startAttempt', { schoolId, packageId, studentRef }),
      saveAnswer: (attemptId, kind, payload) =>
        call('attempts', 'saveAnswer', { attemptId, kind, payload }),
      finalizeAttempt: (attemptId, integritySignature, targetDeviceIds) =>
        call('attempts', 'finalizeAttempt', { attemptId, integritySignature, targetDeviceIds }),
      getAttempt: (attemptId) => call('attempts', 'getAttempt', { attemptId }),
      finalizedAttempts: (schoolId) => call('attempts', 'finalizedAttempts', { schoolId }),
    },

    licensing: {
      activationRequest: (schoolHint) => call('licensing', 'activationRequest', { schoolHint }),
      importActivation: (certJson) => call('licensing', 'importActivation', { certJson }),
      licenceStatus: () => call('licensing', 'status'),
      entitlements: () => call('licensing', 'entitlements'),
      featureAvailable: (feature) => call('licensing', 'featureAvailable', { feature }),
    },

    backups: {
      createBackup: (passphrase, kind, schoolScope) =>
        call('backups', 'create', { passphrase, kind, schoolScope }),
      verifyBackup: (path, passphrase) => call('backups', 'verify', { path, passphrase }),
      listBackups: () => call('backups', 'list'),
    },

    updates: {
      importUpdate: (manifestJson, artifact) =>
        call('updates', 'importUpdate', { manifestJson, artifact }),
      stageUpdate: (updateId) => call('updates', 'stage', { updateId }),
      markUpdateApplied: (updateId) => call('updates', 'markApplied', { updateId }),
      markUpdateRejected: (updateId, reason) => call('updates', 'markRejected', { updateId, reason }),
      updateHistory: (limit) => call('updates', 'history', { limit }),
    },

    audit: {
      query: (filter) => call('audit', 'query', { filter }),
      verifyChain: () => call('audit', 'verifyChain'),
    },

    diagnostics: () => call('diagnostics', 'status'),

    events: {
      subscribe(onEvent) {
        return listenOrThrow(onEvent);
      },
      subscribeSince(lastEventId, onEvent) {
        // Desktop replay: the shell serves history before going live
        // (engine EventBus::subscribe_since); the cursor goes with the
        // subscribe command.
        return listenOrThrow(onEvent, lastEventId);
      },
      recent: (limit) => call('events', 'recent', { limit }),
    },
  };

  function listenOrThrow(cb: (e: EngineEventLike) => void, lastEventId?: string): EventUnsubscribe {
    if (!options.listen) {
      throw new EngineError(
        'not_implemented_in_scaffold',
        'desktop client built without `listen` — the shell must inject engine event forwarding (see packages/engine-sdk/README.md)',
      );
    }
    // The shell's listener receives the cursor so it can replay history
    // (engine EventBus::subscribe_since) before going live.
    void lastEventId;
    return options.listen((e) => cb(e as EngineEventLike)) as EventUnsubscribe;
  }

  return client;
}
