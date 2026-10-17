# @xamverse/engine-sdk

TypeScript client for the XamVerse desktop engine. The contract is
[`docs/phase2/ENGINE_API.md`](../../docs/phase2/ENGINE_API.md) — one
`EngineClient` interface, three transports:

| Adapter | Surface | Status |
|---|---|---|
| `createDesktopClient({ invoke, listen })` | full engine surface via Tauri commands (`engine_<ns>_<op>`) | typed, wired — **commands exist once the src-tauri shell implements them (Phase 3)** |
| `createBrowserClient({ baseUrl })` | LAN bridge routes only (auth, me, diagnostics, sync queue, SSE) | **working today** against `xamverse-web` on port 47811 |
| `createMockClient()` | boot surface for vitest/storybook | scaffold scope (auth + diagnostics + scripted events) |

## Usage

```ts
import { createEngineClient } from '@xamverse/engine-sdk';

const client = createEngineClient();            // desktop | browser (auto-detected)
const { session } = await client.auth.login('s1', 'd.ibrahim', 'pw', 'browser');
client.permissions.require(session, 'sync.read');
const status = await client.diagnostics();
```

Inside the Tauri shell, inject the runtime instead of relying on auto-detect:

```ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createDesktopClient } from '@xamverse/engine-sdk';

const client = createDesktopClient({
  invoke,
  listen: (cb) => listen('engine-event', (e) => cb(e.payload)),
});
```

## Design rules

1. **Zero runtime dependencies.** Tauri's `invoke`/`listen` are injected by
   the shell; the browser adapter uses standard `fetch`/`EventSource`.
2. **Zero mapping.** Wire types are the serde JSON shapes (snake_case) of the
   real Rust structs. A renamed engine field fails loudly here instead of
   silently shifting values in the UI.
3. **Browser sandbox.** The browser adapter deliberately implements only the
   bridge routes; every other call throws `unsupported_on_browser_adapter`
   (a browser must not gain peer/keystore powers — `BROWSER_ACCESS.md` §7).
4. **One error type.** Both wire error shapes (engine JSON and the bridge's
   string form) normalize into `EngineError` with a stable `code`
   (catalogue: `ENGINE_API.md` §2).

## Scaffold status

Marked limitations are explicit, not silent:
- `subscribeSince` on the browser adapter warns: the bridge does not accept a
  cold-start replay cursor yet (`BROWSER_ACCESS.md` §6 tracks it).
- The mock adapter covers only the boot surface; the full in-memory engine
  simulation lands with Phase 3.
- `sync.jobs` asserts `schoolId` is non-empty but the bridge scopes by
  session school — the parameter exists to keep call sites transport-agnostic.

## Development

```bash
cd packages/engine-sdk
bun install
bun run typecheck
bun run test
```
