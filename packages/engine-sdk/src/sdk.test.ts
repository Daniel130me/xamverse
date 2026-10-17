/**
 * SDK scaffold tests — pin the contract behaviours that must not drift:
 * transport detection, the browser adapter's real bridge routes (with a fake
 * fetch), error normalization for BOTH wire shapes, and the browser
 * sandboxing rule (no peer powers in a browser).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createBrowserClient } from './browser.js';
import { createDesktopClient, type EngineEventLike } from './desktop.js';
import { createMockClient } from './mock.js';
import { createEngineClient, EngineError, normalizeError } from './index.js';

// Minimal fetch mock: records calls, replays canned responses.
function fakeFetch(routes: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    // Relative paths are allowed in the browser adapter (same-origin base);
    // resolve against a mock origin so Node's URL parser accepts them.
    const path = new URL(url, 'http://bridge.test').pathname;
    const hit = routes[path] ?? { status: 404, body: { error: 'not found' } };
    return new Response(JSON.stringify(hit.body), {
      status: hit.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ME_BODY = {
  user_id: 'u-1',
  school_id: 's1',
  kind: 'browser',
  permissions: ['sync.read', 'audit.view'],
  expires_at: '2026-12-31T00:00:00Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transport detection', () => {
  it('picks the browser client outside Tauri', () => {
    const client = createEngineClient({ baseUrl: 'http://x:47811' });
    expect(client.transport).toBe('browser');
  });

  it('picks the desktop client when Tauri invoke is present', () => {
    const globals = globalThis as { __TAURI_INTERNALS__?: unknown };
    globals.__TAURI_INTERNALS__ = { invoke: async () => ({}) };
    try {
      const client = createEngineClient();
      expect(client.transport).toBe('desktop');
    } finally {
      delete globals.__TAURI_INTERNALS__;
    }
  });

  it('never auto-picks the mock (must be explicit)', () => {
    const client = createEngineClient({ baseUrl: 'http://x:47811' });
    expect(client.transport).not.toBe('mock');
  });
});

describe('browser adapter — real bridge routes', () => {
  it('login posts snake_case credentials and builds a session from /me', async () => {
    const { fn, calls } = fakeFetch({
      '/api/v1/auth/login': { status: 200, body: { ok: true } },
      '/api/v1/me': { status: 200, body: ME_BODY },
    });
    const client = createBrowserClient({ fetch: fn });
    const { token, session } = await client.auth.login('s1', 'd.ibrahim', 'pw', 'browser');
    expect(token).toBe('cookie');
    expect(session.user_id).toBe('u-1');
    expect(session.kind).toBe('browser');
    expect(session.permissions).toContain('sync.read');
    // Request shape must match the bridge's LoginBody exactly.
    const login = calls.find((c) => c.url.endsWith('/api/v1/auth/login'));
    expect(JSON.parse(String(login?.init?.body))).toEqual({
      school_id: 's1',
      username: 'd.ibrahim',
      password: 'pw',
    });
    // Cookie session: credentials always included.
    expect(login?.init?.credentials).toBe('include');
  });

  it('surfaces engine status from the diagnostics route', async () => {
    const { fn } = fakeFetch({
      '/api/v1/diagnostics': {
        status: 200,
        body: { device_id: 'd1', licence_status: 'active', integrity: 'ok' },
      },
    });
    const client = createBrowserClient({ fetch: fn });
    const status = await client.diagnostics();
    expect(status.device_id).toBe('d1');
    expect(status.licence_status).toBe('active');
  });

  it('refuses desktop-only operations with a stable code (browser sandbox)', async () => {
    const { fn } = fakeFetch({});
    const client = createBrowserClient({ fetch: fn });
    const err = await client
      .peers.requestPairing('1.2.3.4:47810', 's1', 'S')
      .catch((e: EngineError) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe('unsupported_on_browser_adapter');
    const err2 = await client.attempts.startAttempt('s1', 'p', 'stu').catch((e: EngineError) => e);
    expect((err2 as EngineError).code).toBe('unsupported_on_browser_adapter');
    const bootstrapError = await client.auth.bootstrapStatus().catch((e: EngineError) => e);
    expect((bootstrapError as EngineError).code).toBe('unsupported_on_browser_adapter');
  });

  it('normalizes bridge errors (string shape + status) into the catalogue', async () => {
    const { fn } = fakeFetch({
      '/api/v1/auth/login': { status: 401, body: { error: 'invalid credentials' } },
    });
    const client = createBrowserClient({ fetch: fn });
    const err = await client.auth.login('s1', 'x', 'y', 'browser').catch((e: EngineError) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe('invalid_credentials');
    expect((err as EngineError).status).toBe(401);
  });

  it('normalizes structured engine errors (code object) verbatim', () => {
    const err = normalizeError(403, {
      error: { code: 'permission_denied', permission: 'sync.collect', message: 'nope' },
    });
    expect(err.code).toBe('permission_denied');
    expect(err.permission).toBe('sync.collect');
  });

  it('delivers default SSE messages and carries a cold-start replay cursor', () => {
    const urls: string[] = [];
    const sources: Array<{ onmessage: ((event: MessageEvent<string>) => void) | null }> = [];
    class FakeEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;

      constructor(url: string | URL) {
        urls.push(String(url));
        sources.push(this);
      }

      close() {}
    }

    const client = createBrowserClient({
      baseUrl: 'http://bridge.test:47811',
      EventSource: FakeEventSource as unknown as typeof EventSource,
    });
    const seen: string[] = [];
    const unsubscribe = client.events.subscribeSince('018f-event-cursor', (event) => seen.push(event.id));

    expect(new URL(urls[0] ?? '').searchParams.get('last_event_id')).toBe('018f-event-cursor');
    sources[0]?.onmessage?.({
      data: JSON.stringify({ id: 'next', at: '', type: 'sync_completed', data: {} }),
    } as MessageEvent<string>);
    expect(seen).toEqual(['next']);
    unsubscribe();
  });
});

describe('desktop adapter', () => {
  it('invokes engine_<ns>_<op> with camelCase args', async () => {
    const seen: { cmd: string; args: Record<string, unknown> | undefined }[] = [];
    const client = createDesktopClient({
      invoke: async (cmd, args) => {
        seen.push({ cmd, args });
        if (cmd === 'engine_peers_fingerprint') return 'XV-TEST-TEST-TEST-TEST';
        if (cmd === 'engine_peers_add_manual_peer') return { key: 'm1', addr: '10.0.0.2:47810' };
        return { ok: true };
      },
    });
    await expect(client.peers.fingerprint()).resolves.toBe('XV-TEST-TEST-TEST-TEST');
    await expect(client.peers.addManualPeer('10.0.0.2')).resolves.toEqual({
      key: 'm1',
      addr: '10.0.0.2:47810',
    });
    expect(seen[0]?.cmd).toBe('engine_peers_fingerprint');
    expect(seen[1]).toEqual({
      cmd: 'engine_peers_add_manual_peer',
      args: { ip: '10.0.0.2', port: undefined },
    });
  });

  it('exposes the local-only first-owner bootstrap commands', async () => {
    const seen: { cmd: string; args: Record<string, unknown> | undefined }[] = [];
    const client = createDesktopClient({
      invoke: async (cmd, args) => {
        seen.push({ cmd, args });
        return cmd === 'engine_auth_bootstrap_status' ? { required: true } : {};
      },
    });

    await expect(client.auth.bootstrapStatus()).resolves.toEqual({ required: true });
    await client.auth.bootstrap('North School', 'owner', 'Ada Owner', 'strong-pass-1');
    expect(seen).toEqual([
      { cmd: 'engine_auth_bootstrap_status', args: undefined },
      {
        cmd: 'engine_auth_bootstrap',
        args: {
          schoolName: 'North School',
          username: 'owner',
          displayName: 'Ada Owner',
          password: 'strong-pass-1',
        },
      },
    ]);
  });

  it('unwraps the engine error envelope from the rejected command', async () => {
    const client = createDesktopClient({
      invoke: async () => {
        throw { error: { code: 'permission_denied', permission: 'devices.pair', message: 'denied' } };
      },
    });
    const err = await client.peers.approvePairing('s1', 'd', 'u').catch((e: EngineError) => e);
    expect((err as EngineError).code).toBe('permission_denied');
    expect((err as EngineError).permission).toBe('devices.pair');
  });

  it('fails loudly when the shell did not inject event listening', () => {
    const client = createDesktopClient({ invoke: async () => ({}) });
    expect(() => client.events.subscribe(() => {})).toThrow(/listen/);
  });

  it('replays desktop events without losing events emitted during history loading', async () => {
    let live: ((event: EngineEventLike) => void) | undefined;
    let resolveRecent: ((events: unknown[]) => void) | undefined;
    const recent = new Promise<unknown[]>((resolve) => { resolveRecent = resolve; });
    const client = createDesktopClient({
      invoke: async (cmd) => cmd === 'engine_events_recent' ? recent : {},
      listen: (onEvent) => {
        live = onEvent;
        return () => { live = undefined; };
      },
    });
    const seen: string[] = [];
    const stop = client.events.subscribeSince('001', (event) => seen.push(event.id));
    const event = (id: string) => ({ id, at: '', school_id: null, device_id: null, type: 'sync_completed', data: {} });
    live?.(event('003'));
    await vi.waitFor(() => expect(resolveRecent).toBeDefined());
    resolveRecent?.([event('002'), event('003')]);
    await vi.waitFor(() => expect(seen).toEqual(['002', '003']));
    stop();
  });

  it('cancels a Tauri listener even when registration resolves asynchronously', async () => {
    let resolveUnlisten: ((unlisten: () => void) => void) | undefined;
    let unlistened = false;
    const client = createDesktopClient({
      invoke: async () => ({}),
      listen: () => new Promise((resolve) => { resolveUnlisten = resolve; }),
    });

    const stop = client.events.subscribe(() => {});
    stop();
    resolveUnlisten?.(() => { unlistened = true; });

    await vi.waitFor(() => expect(unlistened).toBe(true));
  });
});

describe('mock adapter', () => {
  it('boots a UI: login → session with reserved permissions → diagnostics', async () => {
    const client = createMockClient();
    const { session } = await client.auth.login('s1', 'admin', 'pw', 'desktop');
    expect(session.permissions).toContain('users.manage');
    await expect(client.diagnostics()).resolves.toMatchObject({ integrity: 'ok', licence_status: 'active' });
  });

  it('replays scripted events and honours subscribeSince cursors', async () => {
    const client = createMockClient({
      events: [
        { id: '1', at: '', school_id: null, device_id: null, type: 'a', data: null },
        { id: '2', at: '', school_id: null, device_id: null, type: 'b', data: null },
      ],
    });
    const seen: string[] = [];
    client.events.subscribe((e) => seen.push(e.id));
    const since: string[] = [];
    client.events.subscribeSince('1', (e) => since.push(e.id));
    expect(seen).toEqual(['1', '2']);
    expect(since).toEqual(['2']);
  });
});
