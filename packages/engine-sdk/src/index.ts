/**
 * @xamverse/engine-sdk — public entry point.
 *
 * One EngineClient, three transports (ENGINE_API.md §1):
 *   createEngineClient()  — auto-detects desktop vs browser
 *   createDesktopClient() — Tauri invoke (full surface, needs the shell)
 *   createBrowserClient() — LAN bridge HTTP/SSE (bridge routes only)
 *   createMockClient()    — in-memory (vitest/storybook)
 */
import { createBrowserClient } from './browser.js';
import { createDesktopClient, type DesktopClientOptions, type TauriInvoke } from './desktop.js';
import type { MockClientOptions } from './mock.js';
import type { BrowserClientOptions } from './browser.js';
import type { EngineClient } from './client.js';

export { EngineError, ENGINE_ERROR_CODES, SCAFFOLD_CODES, normalizeError } from './errors.js';
export {
  RESERVED_PERMISSIONS,
  can as canPermission,
  requirePermission,
  type EngineClient,
  type EventUnsubscribe,
} from './client.js';
export * from './types.js';
export { createBrowserClient, type BrowserClientOptions } from './browser.js';
export { createDesktopClient, type DesktopClientOptions, type TauriInvoke } from './desktop.js';
export { createMockClient, type MockClientOptions } from './mock.js';

export interface AutoDetectOptions extends BrowserClientOptions, DesktopClientOptions {
  mock?: MockClientOptions;
}

/**
 * Pick the transport from the runtime: inside a Tauri webview
 * `window.__TAURI_INTERNALS__` exists; otherwise use the browser bridge.
 * The mock is always explicit — a silent mock in production would hide a
 * broken detection, so it is never auto-picked.
 */
export function createEngineClient(options?: Partial<AutoDetectOptions>): EngineClient {
  const globals = globalThis as { __TAURI_INTERNALS__?: unknown; __TAURI__?: { invoke?: TauriInvoke } };
  const invoke =
    (globals.__TAURI_INTERNALS__ as { invoke?: TauriInvoke } | undefined)?.invoke ??
    globals.__TAURI__?.invoke;
  if (invoke) {
    return createDesktopClient({
      invoke,
      listen: options?.listen,
      onListenError: options?.onListenError,
    } as DesktopClientOptions);
  }
  return createBrowserClient(options ?? {});
}
