# Browser Access — the LAN browser bridge

This document describes how a plain browser on the school LAN uses a XamVerse
node through `xamverse-web`: the session model, engine-side RBAC
enforcement, the SSE event stream, the origin allowlist, the TLS strategy for
production (a documented plan — the current build serves HTTP, a known
limitation), and the list of things a browser session can **never** do.
Source: `crates/xamverse-web/src/lib.rs` (Axum), `xamverse-security` session
machinery.

---

## 1. Positioning

Browsers are **not peers**. The bridge exposes a narrow, session-gated,
permission-checked REST + SSE surface (port **47811**) so the Phase 3 React
app can run in a browser against an authorized node (spec §20) — including
on machines where installing the desktop app is not possible. The endpoint
set is deliberately small; everything else stays desktop-IPC or peer-protocol
territory.

Current routes:

| Route | Method | Auth | Permission | Purpose |
|---|---|---|---|---|
| `/healthz` | GET | none | — | minimal `{ "ok": true }` — no version, no paths, no counters |
| `/api/v1/auth/login` | POST | none (rate-limited) | — | open a browser session |
| `/api/v1/auth/logout` | POST | cookie | — | revoke the session, clear cookie |
| `/api/v1/me` | GET | cookie | — | session context: user, school, kind, permissions, expiry |
| `/api/v1/events` | GET (SSE) | cookie | session-scoped filter | live engine events |
| `/api/v1/diagnostics` | GET | cookie | `audit.view` | schema/integrity/sync queue/licence snapshot |
| `/api/v1/sync/queue` | GET | cookie | `sync.read` | durable outbox listing (tenant-scoped) |
| `/*` (fallback) | GET | none | — | serves the static frontend bundle when `frontend_dir` is configured |

## 2. Session model

* Login is the **same** `AuthService.login` the desktop uses, with
  `SessionKind::Browser` — so Argon2id verification, lockout
  (5 failures / 15 min), suspension checks and audit rows are identical.
* The 32-byte random token is returned **once** and set as a cookie:

```text
Set-Cookie: xv_session=<token>; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200
```

  `Secure` is appended when TLS is configured (not in the current build —
  §5). Only `SHA-256(token)` is stored (`sessions.token_hash`), so a stolen
  database cannot hijack live sessions.
* Browser TTL is **2 hours** (shorter than the desktop's 12 h by policy),
  enforced through an `AuthConfig { browser_session_ttl, ..Default }`
  instance in the bridge.
* `authenticate()` on every request re-resolves the live session and user;
  suspended users are logged out on the spot; permission lists are resolved
  from the live role tables.
* Session governance: admins can list/revoke sessions (reserved
  `sessions.revoke` permission; `AuthService::revoke_all_for_user`); logout
  revokes exactly the presented token.

Login body hardening: 4 KiB body cap (`MAX_LOGIN_BODY`), username ≤ 128 and
password ≤ 256 bytes, generic `401 invalid credentials` (no user
enumeration), `429` on throttle.

## 3. RBAC enforcement — the engine is the boundary

Every privileged route wraps its handler in `with_session_permitted(engine,
headers, permission, handler)`:

```rust
// xamverse-security/src/rbac.rs — the check every bridge route uses
pub fn require(&self, ctx: &SessionContext, permission: &str, target: Option<&str>)
    -> Result<(), AuthError>   // denial is persisted as authz.denied in the audit chain
```

* `/api/v1/diagnostics` requires `audit.view`; `/api/v1/sync/queue`
  requires `sync.read` and is additionally filtered by the session's
  `school_id`.
* Frontend permission checks are convenience only — the engine refuses
  without the permission regardless of what the UI shows.
* Permission strings are plain data; schools can add custom roles (the
  builtin seeds: owner / admin / teacher / student, see `SECURITY_MODEL.md`
  §3).

## 4. SSE event stream

`GET /api/v1/events` upgrades to a Server-Sent Events stream fed by the
engine's `EventBus`:

* Events are the typed `EngineEvent`s (`peer.connected`, `sync.progress`,
  `conflict.detected`, `security.alert`, … — full catalogue in
  `ENGINE_API.md` §events).
* **Tenant-scoped delivery**: events carrying a `school_id` different from
  the session's are dropped before serialization — a browser session only
  ever sees its school (or school-less engine events).
* Each event is emitted with `event: <kind_name>` and the full JSON as data,
  with keep-alive comments to survive proxies.
* Reconnect recovery: clients that track the last event `id` can resubscribe
  via the bus history (`subscribe_since`, bounded at 1000 events) — the
  same resumability primitive the desktop shell uses.
* Payloads are notifications, not transport: events cap at ~8 KiB and large
  state lives in the database behind the REST routes.

## 5. CSRF, origins and headers

* **Origin allowlist**: `WebConfig.allowed_origins` (e.g.
  `http://192.168.1.20:47811`); an **empty list means same-origin only**.
  State-changing requests carrying an `Origin` header not on the list are
  `403 origin not allowed`.
* **CSRF posture**: the current build has **no CSRF token**. Defence is
  layered: `SameSite=Strict` cookies (cross-site requests carry no cookie)
  plus the Origin check above. This is a documented residual risk in
  `SECURITY_MODEL.md` §7 and `KNOWN_LIMITATIONS.md`.
* **Security headers on every response** (middleware):
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`,
  `Content-Security-Policy: default-src 'self'; connect-src 'self'`.
* Error responses are a stable JSON shape `{ "error": "…" }` and never leak
  internals.

## 6. TLS strategy for production (documented plan)

**Known limitation first: the current build serves plain HTTP** on
`http://<ip>:47811`. Cookies omit `Secure`, and a LAN eavesdropper can read
sessions and payloads. This is tracked in `KNOWN_LIMITATIONS.md`. The
agreed plan for the production desktop build:

1. **Local certificate provisioning at first run.** The engine generates (or
   the school imports) a self-signed certificate for
   `xamverse-<device-id>.local` bound to the device identity; the bridge
   switches to Axum's TLS listener; cookies gain `Secure`.
2. **Trust onboarding, not silent trust.** The desktop pairing screen shows
   the SHA-256 fingerprint of the bridge certificate next to the device
   fingerprint (`XV-…`); browser users on first visit perform the same
   "compare fingerprints" ritual used for peers, and the school can
   distribute the root cert via MDM or the installer (Windows
   `certutil -addstore`, macOS Keychain) where managed.
3. **mDNS-assisted naming.** The bridge advertises itself so
   `https://xamverse-<id>.local:47811` resolves consistently, reducing
   name-mismatch warnings.
4. **No public CA dependency.** Devices are air-gapped; ACME is out of
   scope. The device's own Noise identity remains the *peer* trust anchor;
   the TLS layer protects browser traffic only and is deliberately separate
   from peer trust (ADR-0003).
5. **Interlock**: the desktop shell refuses to enable remote browser access
   until TLS is configured (build flag / config gate), keeping dev-mode HTTP
   explicit rather than accidental.

Until this ships, treat browser sessions as **cleartext on a trusted
switched LAN** and prefer the desktop app for administrative work.

## 7. What browser sessions can never do

The bridge surface makes these structurally unreachable from a browser —
not merely "not yet implemented":

1. **Read or export device private keys** (signing seed, transport secret,
   DB key) — no route touches the keystore; keys never leave the device.
2. **Speak the peer protocol or open Noise channels** — browsers are not
   peers; the engine's peer surface exists only on :47810.
3. **Invoke Tauri commands or native shell capabilities** — a browser tab
   has no IPC bridge; only the desktop webview does.
4. **Access the filesystem** — no paths are exposed anywhere in the API;
   backups/updates are desktop-shell operations.
5. **Perform peer-privileged operations** (pairing approval, device
   revocation, raw op push/pull initiation) — these are engine APIs exposed
   to authenticated desktop sessions with the right permissions; the bridge
   grants read/diagnostic surfaces only in Phase 2.
6. **See another school's data or events** — every query and the SSE stream
   are tenant-filtered by the session's `school_id`.
7. **Escalate by tampering with the cookie** — the token exists only as a
   SHA-256 hash server-side; forging requires a live valid token.
8. **Outlive governance** — sessions are listed, lockable and revocable by
   administrators, and die at the 2-hour TTL regardless.
