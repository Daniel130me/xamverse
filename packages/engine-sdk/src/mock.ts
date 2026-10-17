/**
 * In-memory mock client — the third adapter (ENGINE_API.md §1).
 *
 * Scope (scaffold): implements the small surface the prototype's vitest
 * suite and storybook need to boot a UI without an engine — auth, session
 * checks, diagnostics and a scripted event feed. Everything else throws
 * `not_implemented_in_scaffold` with a pointer to the real Phase 3 work
 * (the full mock mirrors the Phase 1 simulated service layer).
 *
 * NOTE(scaffold): Phase 3 replaces this file's internals with a faithful
 * in-memory engine simulation; the interface does not move.
 */
import type { EngineClient } from './client.js';
import { RESERVED_PERMISSIONS } from './client.js';
import { EngineError } from './errors.js';
import type { EngineEvent, EngineStatus, Session } from './types.js';

export interface MockClientOptions {
  /** Optional canned diagnostics (e.g. licence_status for UI states). */
  status?: Partial<EngineStatus>;
  /** Optional scripted events served by recent()/subscribe(). */
  events?: EngineEvent[];
}

export function createMockClient(options: MockClientOptions = {}): EngineClient {
  let session: Session | null = null;

  function requireSession(): Session {
    if (!session) throw new EngineError('session_invalid', 'mock: not signed in');
    return session;
  }

  function unsupported(op: string): never {
    throw new EngineError(
      'not_implemented_in_scaffold',
      `mock: ${op} is not implemented in the scaffold (Phase 3 wires the full in-memory engine)`,
    );
  }

  const scripted: EngineEvent[] = options.events ?? [];

  const client: EngineClient = {
    transport: 'mock',

    auth: {
      bootstrapStatus: async () => ({ required: false }),
      bootstrap: async () => unsupported('auth.bootstrap'),
      async login(schoolId, username, _password, kind) {
        session = {
          token_hash: 'mock-token',
          user_id: username,
          school_id: schoolId,
          kind,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          locked: false,
          permissions: [...RESERVED_PERMISSIONS],
        };
        return { token: 'mock-token', session };
      },
      async authenticate(token) {
        if (session && token === 'mock-token') return session;
        throw new EngineError('session_invalid', 'mock: unknown token');
      },
      async logout() {
        session = null;
        return { ok: true };
      },
      lockSession: async () => unsupported('auth.lockSession'),
      unlockSession: (_token, _password) => unsupported('auth.unlockSession'),
      changePassword: async () => unsupported('auth.changePassword'),
    },

    permissions: {
      can: (s, permission) => s.permissions.includes(permission),
      require: (s, permission, target) => {
        if (!s.permissions.includes(permission)) {
          throw new EngineError('permission_denied', `permission denied: ${permission}${target ? ` (${target})` : ''}`, {
            permission,
          });
        }
      },
      listReserved: () => [...RESERVED_PERMISSIONS],
    },

    peers: {
      status: async () => [],
      scan: async () => [],
      addManualPeer: async () => unsupported('peers.addManualPeer'),
      listManualPeers: async () => [],
      requestPairing: async () => unsupported('peers.requestPairing'),
      approvePairing: async () => unsupported('peers.approvePairing'),
      revokeDevice: async () => unsupported('peers.revokeDevice'),
      listPeers: async () => [],
      fingerprint: async () => 'XV-MOCK-MOCK-MOCK-MOCK',
      pingPeer: async () => unsupported('peers.pingPeer'),
    },

    sync: {
      createOp: async () => unsupported('sync.createOp'),
      objects: async () => [],
      jobs: async () => [],
      retryJob: async () => unsupported('sync.retryJob'),
      cancelJob: async () => unsupported('sync.cancelJob'),
      pull: async () => unsupported('sync.pull'),
    },

    conflicts: {
      list: async () => [],
      get: async () => unsupported('conflicts.get'),
      resolve: async () => unsupported('conflicts.resolve'),
      defer: async () => unsupported('conflicts.defer'),
    },

    packages: {
      importPackage: async () => unsupported('packages.importPackage'),
      studentView: async () => unsupported('packages.studentView'),
      fullView: async () => unsupported('packages.fullView'),
      contentHash: async () => unsupported('packages.contentHash'),
    },

    attempts: {
      startAttempt: async () => unsupported('attempts.startAttempt'),
      saveAnswer: async () => unsupported('attempts.saveAnswer'),
      finalizeAttempt: async () => unsupported('attempts.finalizeAttempt'),
      getAttempt: async () => unsupported('attempts.getAttempt'),
      finalizedAttempts: async () => [],
    },

    licensing: {
      activationRequest: async () => unsupported('licensing.activationRequest'),
      importActivation: async () => unsupported('licensing.importActivation'),
      licenceStatus: async () => unsupported('licensing.licenceStatus'),
      entitlements: async () => [],
      featureAvailable: async () => false,
    },

    backups: {
      createBackup: async () => unsupported('backups.createBackup'),
      verifyBackup: async () => unsupported('backups.verifyBackup'),
      listBackups: async () => [],
    },

    updates: {
      importUpdate: async () => unsupported('updates.importUpdate'),
      stageUpdate: async () => unsupported('updates.stageUpdate'),
      markUpdateApplied: async () => unsupported('updates.markApplied'),
      markUpdateRejected: async () => unsupported('updates.markRejected'),
      updateHistory: async () => [],
    },

    audit: {
      query: async () => [],
      verifyChain: async () => true,
    },

    async diagnostics() {
      requireSession();
      return {
        device_id: 'mock-device',
        device_name: 'Mock Device',
        fingerprint: 'XV-MOCK-MOCK-MOCK-MOCK',
        platform: 'mock',
        app_version: '0.0.0-mock',
        data_dir: ':memory:',
        schema_version: 1,
        integrity: 'ok',
        peer_port: 0,
        mdns_enabled: false,
        licence_status: 'active',
        schools: [],
        tables: [],
        sync_queue: { queued: 0, failed: 0, completed: 0 },
        recent_events: [],
        ...options.status,
      };
    },

    events: {
      subscribe(onEvent) {
        // Replay scripted events synchronously, then stay silent.
        for (const e of scripted) onEvent(e);
        return () => {};
      },
      subscribeSince(lastEventId, onEvent) {
        const idx = scripted.findIndex((e) => e.id === lastEventId);
        for (const e of idx >= 0 ? scripted.slice(idx + 1) : scripted) onEvent(e);
        return () => {};
      },
      async recent(limit) {
        return scripted.slice(-limit);
      },
    },
  };

  return client;
}
