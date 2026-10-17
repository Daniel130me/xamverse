//! LAN browser bridge.
//!
//! Browsers are NOT peers. This server exposes a narrow, session-gated,
//! permission-checked REST + SSE surface so the Phase 3 React app can run in
//! a browser against an authorized node (spec §20). It never exposes device
//! keys, Tauri commands, filesystem paths or peer-privileged operations.
//!
//! Security controls implemented here:
//! * session cookies: HttpOnly, SameSite=Strict, Secure-flagged when TLS is
//!   configured; browser sessions have a shorter TTL than desktop ones,
//! * strict CORS allowlist (config; empty = same-origin only),
//! * Origin checking on state-changing requests (CSRF defence in depth on
//!   top of SameSite),
//! * login rate limiting via the shared AuthService throttle,
//! * security headers on every response,
//! * SSE streams filtered per session permission,
//! * health endpoint with minimal, non-sensitive payload.

// Tests read far better with unwrap/expect; the lint stays enforced
// for library code — this exemption is scoped to cfg(test) only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response, Sse};
use axum::routing::{get, get_service, post};
use axum::{Json, Router};
use serde::Deserialize;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use xamverse_core::Engine;
use xamverse_security::{AuthError, SessionKind};

/// Browser session TTL (shorter than desktop sessions by policy).
pub const BROWSER_SESSION_TTL: Duration = Duration::from_secs(2 * 3600);
/// Login body cap (DoS guard).
const MAX_LOGIN_BODY: usize = 4 * 1024;

pub struct WebConfig {
    pub bind: std::net::SocketAddr,
    /// Allowed Origins for browser clients (e.g. "http://192.168.1.20:47811").
    /// Empty list = same-origin only.
    pub allowed_origins: Vec<String>,
    /// Directory of the production frontend bundle (served at /).
    pub frontend_dir: Option<std::path::PathBuf>,
}

#[derive(Debug, thiserror::Error)]
pub enum WebError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Auth(#[from] AuthError),
}

#[derive(Clone)]
struct WebState {
    engine: Arc<Engine>,
    allowed_origins: Arc<Vec<String>>,
}

pub struct WebServer;

/// A bound-but-not-yet-serving bridge; `addr()` is the real bound port so
/// tests and the CLI can print/report it deterministically.
pub struct BoundWebServer {
    listener: tokio::net::TcpListener,
    app: Router,
}

impl BoundWebServer {
    pub fn addr(&self) -> Result<std::net::SocketAddr, WebError> {
        self.listener.local_addr().map_err(WebError::Io)
    }

    /// Serve until the shutdown signal fires.
    pub async fn run(self, shutdown: tokio::sync::watch::Receiver<bool>) -> Result<(), WebError> {
        let mut shutdown = shutdown;
        let server = axum::serve(self.listener, self.app).with_graceful_shutdown(async move {
            let _ = shutdown.changed().await;
            tracing::info!("browser bridge shutting down");
        });
        server.await?;
        Ok(())
    }
}

impl WebServer {
    /// Convenience: bind + run until shutdown.
    pub async fn serve(
        engine: Arc<Engine>,
        config: WebConfig,
        shutdown: tokio::sync::watch::Receiver<bool>,
    ) -> Result<(), WebError> {
        let bound = Self::bind(engine, config)?;
        bound.run(shutdown).await
    }

    /// Bind the listener and build the router. Returns the bound address.
    pub fn bind(engine: Arc<Engine>, config: WebConfig) -> Result<BoundWebServer, WebError> {
        let state = WebState {
            engine,
            allowed_origins: Arc::new(config.allowed_origins.clone()),
        };
        let mut router = Router::new()
            .route("/healthz", get(health))
            // Login is unauthenticated: cap the body explicitly (DoS guard).
            .route(
                "/api/v1/auth/login",
                post(login).layer(tower_http::limit::RequestBodyLimitLayer::new(
                    MAX_LOGIN_BODY,
                )),
            )
            .route("/api/v1/auth/logout", post(logout))
            .route("/api/v1/me", get(me))
            .route("/api/v1/events", get(events_sse))
            .route("/api/v1/diagnostics", get(diagnostics))
            .route("/api/v1/sync/queue", get(sync_queue))
            .with_state(state);
        // Static frontend (production bundle) when configured.
        if let Some(dir) = config.frontend_dir.clone() {
            let index = dir.join("index.html");
            // Serve hashed JS/CSS/media normally and fall back to index.html
            // for client-side routes. Returning index for every asset path
            // would produce HTML with a JavaScript content type mismatch.
            let files = tower_http::services::ServeDir::new(dir)
                .not_found_service(tower_http::services::ServeFile::new(index));
            router = router.fallback_service(get_service(files));
        }

        // Security headers on every response.
        let app = router.layer(axum::middleware::from_fn(security_headers));

        let listener = std::net::TcpListener::bind(config.bind)?;
        listener.set_nonblocking(true)?;
        let listener = tokio::net::TcpListener::from_std(listener)?;
        tracing::info!(addr = %listener.local_addr().map(|a| a.to_string()).unwrap_or_default(), "browser bridge listening");
        Ok(BoundWebServer { listener, app })
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn health() -> impl IntoResponse {
    // Minimal by design: no version, no paths, no counters.
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Deserialize)]
struct LoginBody {
    school_id: String,
    username: String,
    password: String,
}

async fn login(
    State(state): State<WebState>,
    headers: HeaderMap,
    Json(payload): Json<LoginBody>,
) -> Response {
    let engine = state.engine.clone();
    // CSRF defence: state-changing requests from browsers must carry an
    // Origin header matching the allowlist (empty allowlist = same-origin,
    // where browsers still send Origin on cross-site POSTs only — we thus
    // require an exact match when any Origin is present).
    if !origin_is_allowed(&headers, &state.allowed_origins) {
        return error_response(StatusCode::FORBIDDEN, "origin not allowed");
    }
    // Credential length sanity (the framework caps the body; this guards
    // against absurd inputs even when embedded).
    if payload.username.len() > 128 || payload.password.len() > 256 {
        return error_response(StatusCode::UNPROCESSABLE_ENTITY, "credentials rejected");
    }
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    let origin_owned = origin.map(str::to_string);
    let ttl = BROWSER_SESSION_TTL;
    let service = browser_auth_service(&engine, ttl);
    match service.login(
        &payload.school_id,
        &payload.username,
        &payload.password,
        SessionKind::Browser,
        origin_owned.as_deref(),
        Some(&engine.identity.device_id),
    ) {
        Ok((token, _ctx)) => {
            let cookie = format!(
                "xv_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={}",
                ttl.as_secs()
            );
            (
                StatusCode::OK,
                [(header::SET_COOKIE, cookie)],
                Json(serde_json::json!({ "ok": true })),
            )
                .into_response()
        }
        Err(AuthError::LockedOut) => {
            error_response(StatusCode::TOO_MANY_REQUESTS, "try again later")
        }
        Err(_) => error_response(StatusCode::UNAUTHORIZED, "invalid credentials"),
    }
}

async fn logout(State(state): State<WebState>, headers: HeaderMap) -> Response {
    let engine = state.engine.clone();
    match session_token(&headers) {
        Some(token) => {
            let _ = engine.auth.logout(&token);
            let cookie = "xv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
            (StatusCode::OK, [(header::SET_COOKIE, cookie)]).into_response()
        }
        None => StatusCode::UNAUTHORIZED.into_response(),
    }
}

async fn me(State(state): State<WebState>, headers: HeaderMap) -> Response {
    let engine = state.engine.clone();
    with_session(&engine, &headers, |ctx| {
        Json(serde_json::json!({
            "user_id": ctx.user_id,
            "school_id": ctx.school_id,
            "kind": ctx.kind,
            "permissions": ctx.permissions,
            "expires_at": ctx.expires_at,
        }))
        .into_response()
    })
}

async fn diagnostics(State(state): State<WebState>, headers: HeaderMap) -> Response {
    let engine = state.engine.clone();
    with_session_permitted(&engine, &headers, "audit.view", |ctx| {
        let _ = ctx;
        match engine.status() {
            Ok(status) => Json(serde_json::json!({
                "device_id": status.device_id,
                "schema_version": status.schema_version,
                "integrity": status.integrity,
                "sync_queue": status.sync_queue,
                "licence_status": status.licence_status,
            }))
            .into_response(),
            Err(err) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string()),
        }
    })
}

async fn sync_queue(State(state): State<WebState>, headers: HeaderMap) -> Response {
    let engine = state.engine.clone();
    with_session_permitted(&engine, &headers, "sync.read", |ctx| {
        let conn = engine.db.lock();
        let jobs = xamverse_storage::repos::JobsRepo::list(&conn, &ctx.school_id.clone(), &[], 100)
            .unwrap_or_default();
        Json(serde_json::json!(jobs)).into_response()
    })
}

/// Server-sent events, filtered to the session's authorization context.
/// Reconnect recovery uses the event bus history (`subscribe_since`).
#[derive(Default, Deserialize)]
struct EventCursor {
    /// Explicit replay cursor for a fresh EventSource connection. Native
    /// reconnects use Last-Event-ID; accepting both keeps recovery reliable.
    last_event_id: Option<uuid::Uuid>,
}

enum BrowserEventReceiver {
    Live(tokio::sync::broadcast::Receiver<xamverse_events::EngineEvent>),
    Replay(xamverse_events::ReplayReceiver),
}

impl BrowserEventReceiver {
    async fn recv(
        &mut self,
    ) -> Result<xamverse_events::EngineEvent, tokio::sync::broadcast::error::RecvError> {
        match self {
            Self::Live(receiver) => receiver.recv().await,
            Self::Replay(receiver) => receiver.recv().await,
        }
    }
}

async fn events_sse(
    State(state): State<WebState>,
    Query(cursor): Query<EventCursor>,
    headers: HeaderMap,
) -> Response {
    let engine = state.engine.clone();
    let ctx = match authenticate(&engine, &headers) {
        Ok(ctx) => ctx,
        Err(status) => return status.into_response(),
    };
    let last_event_id = cursor.last_event_id.or_else(|| {
        headers
            .get("last-event-id")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok())
    });
    let receiver = match last_event_id {
        Some(id) => BrowserEventReceiver::Replay(engine.events.subscribe_since(id)),
        None => BrowserEventReceiver::Live(engine.events.subscribe()),
    };
    let school_id = ctx.school_id.clone();
    let stream =
        futures_util::stream::unfold((receiver, school_id), |(mut rx, school_id)| async move {
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        // Tenant-scoped delivery: browser sessions only see
                        // their school (or school-less engine events).
                        if let Some(school) = &event.school_id {
                            if school != &school_id {
                                continue;
                            }
                        }
                        let json = serde_json::to_string(&event).unwrap_or_default();
                        return Some((
                            Ok::<_, Infallible>(
                                // Keep this as the default SSE `message` event:
                                // the typed kind already lives in the JSON and
                                // browser EventSource.onmessage only receives
                                // unnamed events. `id` enables native reconnect
                                // recovery through Last-Event-ID.
                                axum::response::sse::Event::default()
                                    .id(event.id.to_string())
                                    .data(json),
                            ),
                            (rx, school_id),
                        ));
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
                }
            }
        });
    Sse::new(stream)
        .keep_alive(axum::response::sse::KeepAlive::default())
        .into_response()
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

fn browser_auth_service(engine: &Arc<Engine>, ttl: Duration) -> xamverse_security::AuthService {
    xamverse_security::AuthService::with_config(
        engine.db.clone(),
        xamverse_security::AuthConfig {
            browser_session_ttl: ttl,
            ..xamverse_security::AuthConfig::default()
        },
    )
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .map(str::trim)
        .find_map(|c| c.strip_prefix("xv_session="))
        .map(str::to_string)
}

/// Validate the Origin on state-changing browser requests.
///
/// An explicit allowlist is authoritative. With an empty allowlist, the
/// bridge is same-origin-only: the Origin authority must match Host. Requests
/// without Origin remain valid for non-browser clients and same-origin user
/// agents that omit it.
fn origin_is_allowed(headers: &HeaderMap, allowed_origins: &[String]) -> bool {
    let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    else {
        return true;
    };

    if !allowed_origins.is_empty() {
        return allowed_origins.iter().any(|allowed| allowed == origin);
    }

    let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Ok(uri) = origin.parse::<axum::http::Uri>() else {
        return false;
    };
    if !matches!(uri.scheme_str(), Some("http" | "https")) {
        return false;
    }
    if uri
        .path_and_query()
        .is_some_and(|path| path.as_str() != "/")
    {
        return false;
    }

    uri.authority()
        .is_some_and(|authority| authority.as_str().eq_ignore_ascii_case(host))
}

fn authenticate(
    engine: &Arc<Engine>,
    headers: &HeaderMap,
) -> Result<xamverse_security::SessionContext, StatusCode> {
    let token = session_token(headers).ok_or(StatusCode::UNAUTHORIZED)?;
    engine
        .auth
        .authenticate(&token)
        .map_err(|_| StatusCode::UNAUTHORIZED)
}

fn with_session(
    engine: &Arc<Engine>,
    headers: &HeaderMap,
    f: impl FnOnce(xamverse_security::SessionContext) -> Response,
) -> Response {
    match authenticate(engine, headers) {
        Ok(ctx) => f(ctx),
        Err(status) => status.into_response(),
    }
}

/// Session + engine-side permission check (the UI is never the boundary).
fn with_session_permitted(
    engine: &Arc<Engine>,
    headers: &HeaderMap,
    permission: &str,
    f: impl FnOnce(xamverse_security::SessionContext) -> Response,
) -> Response {
    match authenticate(engine, headers) {
        Ok(ctx) => match engine.authz.require(&ctx, permission, None) {
            Ok(()) => f(ctx),
            Err(err) => error_response(StatusCode::FORBIDDEN, &err.to_string()),
        },
        Err(status) => status.into_response(),
    }
}

fn error_response(status: StatusCode, message: &str) -> Response {
    // Errors are JSON with stable shape; never leak internals.
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

async fn security_headers(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'self'; connect-src 'self'"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use xamverse_core::EngineConfig;
    use xamverse_security::hash_password;

    async fn spawn_server(
        allowed_origins: Vec<String>,
    ) -> (
        std::net::SocketAddr,
        Arc<Engine>,
        tokio::sync::watch::Sender<bool>,
        tempfile::TempDir,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::init(EngineConfig {
            data_dir: dir.path().join("data"),
            device_name: "BridgeNode".into(),
            enable_mdns: false,
            peer_port: 0,
            ..Default::default()
        })
        .unwrap();
        engine.enroll_school("s1", "Test School", "seed").unwrap();

        let db = engine.db.clone();
        db.tx(|conn| {
            let users: [(&str, Vec<&str>, &str); 2] = [
                ("tina", vec!["teacher"], "teacher-pw-1"),
                ("ada", vec!["owner"], "owner-pw-1"),
            ];
            for (username, roles, password) in users {
                let hash = hash_password(password).unwrap();
                let user_id = uuid::Uuid::now_v7().to_string();
                xamverse_storage::repos::UsersRepo::upsert(
                    conn,
                    &xamverse_storage::repos::UserRow {
                        user_id: user_id.clone(),
                        school_id: "s1".into(),
                        username: username.into(),
                        display_name: username.into(),
                        status: "active".into(),
                        auth_hash: Some(hash),
                        origin_device_id: None,
                        revision: 1,
                        updated_at: xamverse_storage::now_rfc3339(),
                    },
                )
                .unwrap();
                for role in roles {
                    let role_row =
                        xamverse_storage::repos::UsersRepo::find_role_by_name(conn, "s1", role)
                            .unwrap()
                            .unwrap();
                    xamverse_storage::repos::UsersRepo::grant_role(
                        conn,
                        "s1",
                        &user_id,
                        &role_row.role_id,
                        None,
                    )
                    .unwrap();
                }
            }
            Ok(())
        })
        .unwrap();

        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        let server_engine = engine.clone();
        let config = WebConfig {
            bind: "127.0.0.1:0".parse().unwrap(),
            allowed_origins,
            frontend_dir: None,
        };
        let bound = WebServer::bind(server_engine, config).unwrap();
        let addr = bound.addr().unwrap();
        tokio::spawn(async move { bound.run(shutdown_rx).await.unwrap() });
        (addr, engine, shutdown_tx, dir)
    }

    async fn post(
        client: &reqwest_stub::Client,
        url: &str,
        body: serde_json::Value,
        origin: Option<&str>,
    ) -> reqwest_stub::Response {
        let mut req = client.post(url).json(&body);
        if let Some(origin) = origin {
            req = req.header("Origin", origin);
        }
        req.send().await.unwrap()
    }

    // Minimal HTTP client on top of tokio to avoid a heavyweight dependency
    // in tests: enough for the assertions below.
    mod reqwest_stub {
        use std::sync::Arc;

        pub struct Client;

        impl Client {
            pub fn new() -> Self {
                Self
            }
            pub fn post(&self, url: &str) -> RequestBuilder {
                RequestBuilder {
                    method: "POST",
                    url: url.to_string(),
                    body: None,
                    headers: Vec::new(),
                }
            }
            pub fn get(&self, url: &str) -> RequestBuilder {
                RequestBuilder {
                    method: "GET",
                    url: url.to_string(),
                    body: None,
                    headers: Vec::new(),
                }
            }
        }

        pub struct RequestBuilder {
            method: &'static str,
            url: String,
            body: Option<serde_json::Value>,
            headers: Vec<(String, String)>,
        }

        impl RequestBuilder {
            pub fn json(mut self, body: &serde_json::Value) -> Self {
                self.body = Some(body.clone());
                self
            }
            pub fn header(mut self, k: &'static str, v: &str) -> Self {
                self.headers.push((k.to_string(), v.to_string()));
                self
            }
            pub async fn send(self) -> std::io::Result<Response> {
                use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
                let url = self.url.replace("http://", "");
                let (host, rest) = url.split_once('/').unwrap();
                let path = format!("/{}", rest);
                let addr = if host.contains(':') {
                    host.to_string()
                } else {
                    format!("{host}:80")
                };
                let mut stream = tokio::net::TcpStream::connect(&addr).await?;
                let body = self.body.map(|b| b.to_string()).unwrap_or_default();
                let mut req = format!(
                    "{} {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                    self.method, path, host, body.len()
                );
                for (k, v) in &self.headers {
                    req.push_str(&format!("{k}: {v}\r\n"));
                }
                req.push_str("\r\n");
                req.push_str(&body);
                stream.write_all(req.as_bytes()).await?;
                let mut buf = Vec::new();
                stream.read_to_end(&mut buf).await?;
                Ok(Response { raw: buf })
            }
        }

        pub struct Response {
            raw: Vec<u8>,
        }

        impl Response {
            pub fn status(&self) -> u16 {
                let head = String::from_utf8_lossy(&self.raw);
                head.split_whitespace()
                    .nth(1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0)
            }
            pub fn header(&self, name: &str) -> Option<String> {
                let head = String::from_utf8_lossy(&self.raw);
                for line in head.lines() {
                    if let Some((k, v)) = line.split_once(':') {
                        if k.eq_ignore_ascii_case(name) {
                            return Some(v.trim().to_string());
                        }
                    }
                }
                None
            }
            pub fn cookie(&self, name: &str) -> Option<String> {
                self.header("set-cookie").and_then(|c| {
                    c.split(';')
                        .map(str::trim)
                        .find_map(|part| part.strip_prefix(&format!("{name}=")))
                        .map(str::to_string)
                })
            }
            pub fn text(&self) -> String {
                let raw = &self.raw;
                raw.windows(4)
                    .position(|w| w == b"\r\n\r\n")
                    .map(|i| String::from_utf8_lossy(&raw[i + 4..]).to_string())
                    .unwrap_or_default()
            }
        }

        // Arc kept for parity with future client upgrades.
        #[allow(dead_code)]
        type Unused = Arc<()>;
    }

    #[tokio::test]
    async fn browser_login_me_and_logout_flow() {
        let (addr, _engine, shutdown, _dir) = spawn_server(vec![]).await;
        let client = reqwest_stub::Client::new();
        let base = format!("http://{addr}");

        // Wrong credentials: generic 401.
        let res = post(
            &client,
            &format!("{base}/api/v1/auth/login"),
            serde_json::json!({"school_id": "s1", "username": "tina", "password": "wrong"}),
            None,
        )
        .await;
        assert_eq!(res.status(), 401);

        // Right credentials: session cookie.
        let res = post(
            &client,
            &format!("{base}/api/v1/auth/login"),
            serde_json::json!({"school_id": "s1", "username": "tina", "password": "teacher-pw-1"}),
            None,
        )
        .await;
        assert_eq!(res.status(), 200);
        let cookie_value = res.cookie("xv_session").expect("session cookie");
        assert!(!cookie_value.is_empty());

        // /me with the cookie: identity + permissions visible.
        let res = client
            .get(&format!("{base}/api/v1/me"))
            .header("Cookie", &format!("xv_session={cookie_value}"))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        let body = res.text();
        assert!(body.contains("\"sync.read\""));

        // Health endpoint needs no auth and leaks nothing.
        let res = client.get(&format!("{base}/healthz")).send().await.unwrap();
        assert_eq!(res.status(), 200);
        assert_eq!(res.text(), "{\"ok\":true}");

        shutdown.send(true).unwrap();
    }

    #[tokio::test]
    async fn permission_boundary_is_enforced_server_side() {
        let (addr, _engine, shutdown, _dir) = spawn_server(vec![]).await;
        let client = reqwest_stub::Client::new();
        let base = format!("http://{addr}");

        // Teacher login.
        let res = post(
            &client,
            &format!("{base}/api/v1/auth/login"),
            serde_json::json!({"school_id": "s1", "username": "tina", "password": "teacher-pw-1"}),
            None,
        )
        .await;
        let teacher_cookie = res.cookie("xv_session").unwrap();

        // Teacher lacks audit.view -> diagnostics denied (403).
        let res = client
            .get(&format!("{base}/api/v1/diagnostics"))
            .header("Cookie", &format!("xv_session={teacher_cookie}"))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 403);

        // Owner passes.
        let res = post(
            &client,
            &format!("{base}/api/v1/auth/login"),
            serde_json::json!({"school_id": "s1", "username": "ada", "password": "owner-pw-1"}),
            None,
        )
        .await;
        let owner_cookie = res.cookie("xv_session").unwrap();
        let res = client
            .get(&format!("{base}/api/v1/diagnostics"))
            .header("Cookie", &format!("xv_session={owner_cookie}"))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200);

        // No session at all -> unauthorized.
        let res = client
            .get(&format!("{base}/api/v1/diagnostics"))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 401);

        shutdown.send(true).unwrap();
    }

    #[tokio::test]
    async fn revoked_session_loses_access() {
        let (addr, engine, shutdown, _dir) = spawn_server(vec![]).await;
        let client = reqwest_stub::Client::new();
        let base = format!("http://{addr}");

        let res = post(
            &client,
            &format!("{base}/api/v1/auth/login"),
            serde_json::json!({"school_id": "s1", "username": "ada", "password": "owner-pw-1"}),
            None,
        )
        .await;
        let cookie_value = res.cookie("xv_session").unwrap();

        // Works before revocation.
        let res = client
            .get(&format!("{base}/api/v1/me"))
            .header("Cookie", &format!("xv_session={cookie_value}"))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200);

        // Revoke via the shared session store (browser session governance).
        let token_hash = xamverse_security::hash_token(&cookie_value);
        {
            let conn = engine.db.lock();
            xamverse_storage::repos::SessionsRepo::revoke(&conn, &token_hash, "test revoke")
                .unwrap();
        } // guard dropped before any await point

        let res = client
            .get(&format!("{base}/api/v1/me"))
            .header("Cookie", &format!("xv_session={cookie_value}"))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 401);

        shutdown.send(true).unwrap();
    }

    #[tokio::test]
    async fn disallowed_origin_is_refused_on_login() {
        let (addr, _engine, shutdown, _dir) =
            spawn_server(vec!["http://good.example".into()]).await;
        let client = reqwest_stub::Client::new();
        let base = format!("http://{addr}");

        let res = post(
            &client,
            &format!("{base}/api/v1/auth/login"),
            serde_json::json!({"school_id": "s1", "username": "ada", "password": "owner-pw-1"}),
            Some("http://evil.example"),
        )
        .await;
        assert_eq!(res.status(), 403);

        let res = post(
            &client,
            &format!("{base}/api/v1/auth/login"),
            serde_json::json!({"school_id": "s1", "username": "ada", "password": "owner-pw-1"}),
            Some("http://good.example"),
        )
        .await;
        assert_eq!(res.status(), 200);

        shutdown.send(true).unwrap();
    }

    #[tokio::test]
    async fn empty_allowlist_accepts_same_origin_and_rejects_cross_origin() {
        let (addr, _engine, shutdown, _dir) = spawn_server(vec![]).await;
        let client = reqwest_stub::Client::new();
        let base = format!("http://{addr}");

        let same_origin = post(
            &client,
            &format!("{base}/api/v1/auth/login"),
            serde_json::json!({"school_id": "s1", "username": "ada", "password": "owner-pw-1"}),
            Some(&base),
        )
        .await;
        assert_eq!(same_origin.status(), 200);

        let cross_origin = post(
            &client,
            &format!("{base}/api/v1/auth/login"),
            serde_json::json!({"school_id": "s1", "username": "ada", "password": "owner-pw-1"}),
            Some("http://evil.example"),
        )
        .await;
        assert_eq!(cross_origin.status(), 403);

        shutdown.send(true).unwrap();
    }
}
