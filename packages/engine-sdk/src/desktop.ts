/**
 * Desktop adapter — one Tauri command per namespace/op, 1:1 with the engine
 * subsystems (contract: docs/phase2/ENGINE_API.md; the command surface
 * exposed by src-tauri is exactly `engine_<namespace>_<op>`).
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
  listen?: (
    onEvent: (e: EngineEventLike) => void,
  ) => EventUnsubscribe | Promise<EventUnsubscribe>;
  /** Receives asynchronous Tauri listener-registration failures. */
  onListenError?: (error: unknown) => void;
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
    const command = `engine_${toSnakeCase(ns)}_${toSnakeCase(op)}`;
    try {
      return (await invoke(command, args)) as T;
    } catch (err) {
      throw unwrapError(err, command);
    }
  }

  function toSnakeCase(value: string): string {
    return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
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
      bootstrapStatus: () => call('auth', 'bootstrapStatus'),
      bootstrap: (schoolName, username, displayName, password) =>
        call('auth', 'bootstrap', { schoolName, username, displayName, password }),
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
    if (!lastEventId) {
      return attachListener((event) => cb(event));
    }

    // Attach live first, buffer while history loads, then emit both streams
    // in UUIDv7 order with id de-duplication. This closes the race between
    // fetching history and subscribing to Tauri's live event channel.
    let replaying = true;
    let cancelled = false;
    const buffered: EngineEventLike[] = [];
    const unsubscribe = attachListener(
      (event) => {
        if (replaying) buffered.push(event);
        else cb(event);
      },
      () => {
        // Fetch history only after the live listener is registered. Events
        // arriving after registration are buffered, closing both sides of
        // the replay/live hand-off race.
        void call<EngineEventLike[]>('events', 'recent', { limit: 1000 })
          .then((recent) => {
            if (cancelled) return;
            const seen = new Set<string>();
            const missed = [...recent, ...buffered]
              .filter((event) => event.id > lastEventId)
              .sort((left, right) => left.id.localeCompare(right.id));
            for (const event of missed) {
              if (!seen.has(event.id)) {
                seen.add(event.id);
                cb(event);
              }
            }
          })
          .catch((error) => options.onListenError?.(error))
          .finally(() => {
            replaying = false;
          });
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }

  /**
   * Normalize Tauri's asynchronous `listen()` registration into the SDK's
   * synchronous cancellation handle. Cancellation before registration
   * completes is remembered and applied as soon as the unlisten function is
   * available, so navigation cannot leak listeners.
   */
  function attachListener(
    onEvent: (event: EngineEventLike) => void,
    onReady?: () => void,
  ): EventUnsubscribe {
    if (!options.listen) {
      throw new EngineError(
        'not_implemented_in_scaffold',
        'desktop client built without `listen` — inject Tauri engine-event forwarding',
      );
    }

    let cancelled = false;
    let unlisten: EventUnsubscribe | undefined;
    Promise.resolve(options.listen(onEvent)).then(
      (registeredUnlisten) => {
        if (cancelled) registeredUnlisten();
        else {
          unlisten = registeredUnlisten;
          onReady?.();
        }
      },
      (error) => options.onListenError?.(error),
    );
    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = undefined;
    };
  }

  return client;
}
