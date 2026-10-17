/**
 * Browser adapter — HTTP + SSE against the `xamverse-web` bridge
 * (default http://<host>:47811), cookie-authenticated.
 *
 * Complete ONLY for the routes the bridge serves today (ENGINE_API.md §11):
 * auth.login / auth.logout / auth.authenticate / diagnostics / sync.jobs /
 * events.subscribe. Everything else throws `unsupported_on_browser_adapter`
 * — a browser must never gain peer or keystore powers (BROWSER_ACCESS.md §7).
 *
 * Security notes carried over from the bridge itself: SameSite=Strict
 * cookies, Origin-checked state changes; TLS is a documented, not-yet-built
 * bridge feature (KNOWN_LIMITATIONS.md §5).
 */
import type { EngineClient, EventUnsubscribe } from './client.js';
import { RESERVED_PERMISSIONS } from './client.js';
import { EngineError, normalizeError } from './errors.js';
import type {
  AuditRow,
  EngineEvent,
  EngineStatus,
  JobRow,
  PeerAdvertisement,
  Session,
} from './types.js';

/** Shape of GET /api/v1/me (the bridge's view of the session). */
interface MeResponse {
  user_id: string;
  school_id: string;
  kind: string;
  permissions: string[];
  expires_at: string;
}

export interface BrowserClientOptions {
  /** e.g. http://192.168.1.24:47811 — defaults to the current origin. */
  baseUrl?: string;
  /** Injectable fetch (tests). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Injectable EventSource (tests). Defaults to globalThis.EventSource. */
  EventSource?: typeof EventSource;
}

export function createBrowserClient(options: BrowserClientOptions = {}): EngineClient {
  const base = (options.baseUrl ?? '').replace(/\/$/, '');
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const EventSourceImpl = options.EventSource ?? globalThis.EventSource;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        // SameSite=Strict cookie session — no token handling in JS on purpose.
        credentials: 'include',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new EngineError('network', `bridge unreachable: ${String(err)}`, { status: 0 });
    }
    if (!res.ok) {
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // non-JSON error body — normalizeError handles it
      }
      throw normalizeError(res.status, parsed);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Guard used by every call whose engine command has no browser route. */
  function unsupported(op: string): never {
    throw new EngineError(
      'unsupported_on_browser_adapter',
      `${op} is desktop-only: the browser bridge deliberately exposes no peer/keystore surface`,
    );
  }

  const client: EngineClient = {
    transport: 'browser',

    auth: {
      bootstrapStatus: async () => unsupported('auth.bootstrapStatus'),
      bootstrap: async () => unsupported('auth.bootstrap'),
      async login(schoolId, username, password) {
        // 200 sets the http-only session cookie; the bridge returns {ok:true}.
        await request<{ ok: true }>('POST', '/api/v1/auth/login', {
          school_id: schoolId,
          username,
          password,
        });
        const me = await request<MeResponse>('GET', '/api/v1/me');
        const session: Session = {
          token_hash: 'cookie', // the cookie IS the credential; no token in JS
          user_id: me.user_id,
          school_id: me.school_id,
          kind: 'browser',
          created_at: '',
          expires_at: me.expires_at,
          locked: false,
          permissions: me.permissions,
        };
        return { token: 'cookie', session };
      },
      async authenticate() {
        const me = await request<MeResponse>('GET', '/api/v1/me');
        return {
          token_hash: 'cookie',
          user_id: me.user_id,
          school_id: me.school_id,
          kind: 'browser',
          created_at: '',
          expires_at: me.expires_at,
          locked: false,
          permissions: me.permissions,
        };
      },
      async logout() {
        return request<{ ok: true }>('POST', '/api/v1/auth/logout');
      },
      lockSession: async () => unsupported('auth.lockSession'),
      unlockSession: async () => unsupported('auth.unlockSession'),
      changePassword: async () => unsupported('auth.changePassword'),
    },

    permissions: {
      can: (session, permission) => session.permissions.includes(permission),
      require: (session, permission, target) => {
        if (!session.permissions.includes(permission)) {
          throw new EngineError('permission_denied', `permission denied: ${permission}${target ? ` (${target})` : ''}`, {
            permission,
          });
        }
      },
      listReserved: () => [...RESERVED_PERMISSIONS],
    },

    peers: {
      status: async () => unsupported('peers.status'),
      scan: async () => unsupported('peers.scan'),
      addManualPeer: async () => unsupported('peers.addManualPeer'),
      listManualPeers: async () => unsupported('peers.listManualPeers'),
      requestPairing: async () => unsupported('peers.requestPairing'),
      approvePairing: async () => unsupported('peers.approvePairing'),
      revokeDevice: async () => unsupported('peers.revokeDevice'),
      listPeers: async () => unsupported('peers.listPeers'),
      fingerprint: async () => unsupported('peers.fingerprint'),
      pingPeer: async () => unsupported('peers.pingPeer'),
    },

    sync: {
      createOp: async () => unsupported('sync.createOp'),
      objects: async () => unsupported('sync.objects'),
      async jobs(schoolId) {
        // Bridge scopes to the session's school; schoolId asserted for clarity.
        const jobs = await request<JobRow[]>('GET', '/api/v1/sync/queue');
        if (schoolId === '') throw new EngineError('invalid_value', 'schoolId is required');
        return jobs;
      },
      retryJob: async () => unsupported('sync.retryJob'),
      cancelJob: async () => unsupported('sync.cancelJob'),
      pull: async () => unsupported('sync.pull'),
    },

    conflicts: {
      list: async () => unsupported('conflicts.list'),
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
      finalizedAttempts: async () => unsupported('attempts.finalizedAttempts'),
    },

    licensing: {
      activationRequest: async () => unsupported('licensing.activationRequest'),
      importActivation: async () => unsupported('licensing.importActivation'),
      licenceStatus: async () => unsupported('licensing.licenceStatus'),
      entitlements: async () => unsupported('licensing.entitlements'),
      featureAvailable: async () => unsupported('licensing.featureAvailable'),
    },

    backups: {
      createBackup: async () => unsupported('backups.createBackup'),
      verifyBackup: async () => unsupported('backups.verifyBackup'),
      listBackups: async () => unsupported('backups.listBackups'),
    },

    updates: {
      importUpdate: async () => unsupported('updates.importUpdate'),
      stageUpdate: async () => unsupported('updates.stageUpdate'),
      markUpdateApplied: async () => unsupported('updates.markUpdateApplied'),
      markUpdateRejected: async () => unsupported('updates.markUpdateRejected'),
      updateHistory: async () => unsupported('updates.updateHistory'),
    },

    audit: {
      query: async () => unsupported('audit.query'),
      verifyChain: async () => unsupported('audit.verifyChain'),
    },

    async diagnostics() {
      // The bridge route returns the full EngineStatus (requires audit.view).
      return request<EngineStatus>('GET', '/api/v1/diagnostics');
    },

    events: {
      subscribe(onEvent) {
        return openSse(EventSourceImpl, `${base}/api/v1/events`, onEvent);
      },
      subscribeSince(lastEventId, onEvent) {
        // The bridge replays from lastEventId via the Last-Event-ID convention.
        return openSse(EventSourceImpl, `${base}/api/v1/events`, onEvent, { lastEventId });
      },
      recent: async () => unsupported('events.recent'),
    },
  };

  return client;
}

function openSse(
  EventSourceImpl: typeof EventSource,
  url: string,
  onEvent: (e: EngineEvent) => void,
  opts: { lastEventId?: string } = {},
): EventUnsubscribe {
  if (!EventSourceImpl) {
    throw new EngineError('network', 'EventSource is not available in this environment');
  }
  // Native reconnects send Last-Event-ID automatically. A cold connection
  // cannot set that header through EventSource, so the bridge also accepts an
  // equivalent query parameter.
  const eventUrl = new URL(url, globalThis.location?.origin ?? 'http://localhost');
  if (opts.lastEventId) eventUrl.searchParams.set('last_event_id', opts.lastEventId);
  const source = new EventSourceImpl(eventUrl.toString(), { withCredentials: true });
  source.onmessage = (ev: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(ev.data) as EngineEvent);
    } catch {
      // Ignore malformed frames; the bridge is trusted but defensive.
    }
  };
  return () => source.close();
}

// Re-exported for adapters/tests that need the advertisement type shape.
export type { PeerAdvertisement, AuditRow };
