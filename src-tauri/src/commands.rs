//! Tauri IPC boundary for the engine SDK.
//!
//! Commands contain no business logic. They validate input, authenticate the
//! active desktop session, enforce live RBAC, then delegate to the engine.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{net::SocketAddr, path::Path, str::FromStr, sync::Arc};
use xamverse_core::Engine;
use xamverse_security::{reserved, SessionContext, SessionKind};
use xamverse_storage::repos::{ConflictStatus, JobStatus, JobsRepo, ObjectsRepo, TrustRepo};
use xamverse_sync::{PackageManifest, Resolution};

pub struct DesktopState {
    pub engine: Arc<Engine>,
    /// Raw tokens live only in process memory; the database stores their hash.
    active_token: tokio::sync::RwLock<Option<String>>,
}

impl DesktopState {
    pub fn new(engine: Arc<Engine>) -> Self {
        Self {
            engine,
            active_token: tokio::sync::RwLock::new(None),
        }
    }

    async fn session(&self) -> CommandResult<SessionContext> {
        let token = self
            .active_token
            .read()
            .await
            .clone()
            .ok_or_else(|| CommandError::code("session_invalid", "sign in is required"))?;
        let session = self
            .engine
            .auth
            .authenticate(&token)
            .map_err(CommandError::auth)?;
        if session.locked {
            return Err(CommandError::code("session_locked", "session is locked"));
        }
        Ok(session)
    }

    async fn require(
        &self,
        permission: &str,
        target: Option<&str>,
    ) -> CommandResult<SessionContext> {
        let session = self.session().await?;
        self.engine
            .authz
            .require(&session, permission, target)
            .map_err(CommandError::auth)?;
        Ok(session)
    }

    async fn require_fresh(
        &self,
        permission: &str,
        target: Option<&str>,
    ) -> CommandResult<SessionContext> {
        let session = self.require(permission, target).await?;
        self.engine
            .auth
            .require_fresh(&session)
            .map_err(CommandError::auth)?;
        Ok(session)
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug, Serialize)]
pub struct CommandError {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    permission: Option<String>,
    message: String,
}

impl CommandError {
    fn code(code: &str, message: impl Into<String>) -> Self {
        Self {
            error: ErrorBody {
                code: code.into(),
                permission: None,
                message: message.into(),
            },
        }
    }

    fn engine(error: impl std::fmt::Display) -> Self {
        Self::code("engine_error", error.to_string())
    }

    fn invalid(field: &str, message: impl std::fmt::Display) -> Self {
        Self::code("invalid_value", format!("{field}: {message}"))
    }

    fn auth(error: xamverse_security::AuthError) -> Self {
        use xamverse_security::AuthError;
        let (code, permission) = match &error {
            AuthError::InvalidCredentials => ("invalid_credentials", None),
            AuthError::AccountSuspended => ("account_suspended", None),
            AuthError::LockedOut => ("locked_out", None),
            AuthError::SessionLocked => ("session_locked", None),
            AuthError::SessionInvalid => ("session_invalid", None),
            AuthError::ReauthenticationRequired => ("reauthentication_required", None),
            AuthError::PermissionDenied { permission } => {
                ("permission_denied", Some(permission.clone()))
            }
            AuthError::Storage(_) => ("storage", None),
        };
        Self {
            error: ErrorBody {
                code: code.into(),
                permission,
                message: error.to_string(),
            },
        }
    }
}

fn same_school(session: &SessionContext, school_id: &str) -> CommandResult<()> {
    if session.school_id == school_id {
        Ok(())
    } else {
        Err(CommandError::code(
            "permission_denied",
            "the active session does not belong to the requested school",
        ))
    }
}

fn ok() -> Value {
    json!({ "ok": true })
}

#[tauri::command]
pub async fn engine_auth_bootstrap_status(
    state: tauri::State<'_, DesktopState>,
) -> CommandResult<Value> {
    Ok(json!({
        "required": state.engine.bootstrap_required().map_err(CommandError::engine)?
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_auth_bootstrap(
    state: tauri::State<'_, DesktopState>,
    school_name: String,
    username: String,
    display_name: String,
    password: String,
) -> CommandResult<Value> {
    let identity = state
        .engine
        .bootstrap_installation(&school_name, &username, &display_name, &password)
        .map_err(CommandError::engine)?;
    let (token, session) = state
        .engine
        .auth
        .login(
            &identity.school_id,
            &identity.username,
            &password,
            SessionKind::Desktop,
            None,
            Some(&state.engine.identity.device_id),
        )
        .map_err(CommandError::auth)?;
    *state.active_token.write().await = Some(token.clone());
    Ok(json!({ "identity": identity, "token": token, "session": session }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_auth_login(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    username: String,
    password: String,
    kind: String,
) -> CommandResult<Value> {
    let kind = match kind.as_str() {
        "desktop" => SessionKind::Desktop,
        "browser" => SessionKind::Browser,
        _ => return Err(CommandError::invalid("kind", "expected desktop or browser")),
    };
    let (token, session) = state
        .engine
        .auth
        .login(
            &school_id,
            &username,
            &password,
            kind,
            None,
            Some(&state.engine.identity.device_id),
        )
        .map_err(CommandError::auth)?;
    *state.active_token.write().await = Some(token.clone());
    Ok(json!({ "token": token, "session": session }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_auth_authenticate(
    state: tauri::State<'_, DesktopState>,
    token: String,
) -> CommandResult<SessionContext> {
    let session = state
        .engine
        .auth
        .authenticate(&token)
        .map_err(CommandError::auth)?;
    *state.active_token.write().await = Some(token);
    Ok(session)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_auth_logout(
    state: tauri::State<'_, DesktopState>,
    token: String,
) -> CommandResult<Value> {
    state
        .engine
        .auth
        .logout(&token)
        .map_err(CommandError::auth)?;
    let mut active = state.active_token.write().await;
    if active.as_deref() == Some(token.as_str()) {
        *active = None;
    }
    Ok(ok())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_auth_lock_session(
    state: tauri::State<'_, DesktopState>,
    token: String,
) -> CommandResult<Value> {
    state
        .engine
        .auth
        .lock_session(&token)
        .map_err(CommandError::auth)?;
    Ok(ok())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_auth_unlock_session(
    state: tauri::State<'_, DesktopState>,
    token: String,
    password: String,
) -> CommandResult<SessionContext> {
    let session = state
        .engine
        .auth
        .unlock_session(&token, &password)
        .map_err(CommandError::auth)?;
    *state.active_token.write().await = Some(token);
    Ok(session)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_auth_change_password(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    user_id: String,
    old: Option<String>,
    next: String,
) -> CommandResult<Value> {
    let session = state.session().await?;
    same_school(&session, &school_id)?;
    if session.user_id != user_id {
        state
            .engine
            .authz
            .require(&session, reserved::USERS_MANAGE, Some(&user_id))
            .map_err(CommandError::auth)?;
        state
            .engine
            .auth
            .require_fresh(&session)
            .map_err(CommandError::auth)?;
    } else if old.is_none() {
        return Err(CommandError::code(
            "reauthentication_required",
            "the current password is required",
        ));
    }
    let revision = state
        .engine
        .auth
        .change_password(
            &school_id,
            &user_id,
            old.as_deref(),
            &next,
            Some(&state.engine.identity.device_id),
        )
        .map_err(CommandError::auth)?;
    Ok(json!({ "revision": revision }))
}

#[tauri::command]
pub async fn engine_peers_status(state: tauri::State<'_, DesktopState>) -> CommandResult<Value> {
    state.require(reserved::SYNC_READ, None).await?;
    let status = state.engine.status().map_err(CommandError::engine)?;
    serde_json::to_value(status.schools).map_err(CommandError::engine)
}

#[tauri::command]
pub async fn engine_peers_scan(state: tauri::State<'_, DesktopState>) -> CommandResult<Value> {
    state.require(reserved::SYNC_READ, None).await?;
    serde_json::to_value(state.engine.discovered_peers().await).map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_peers_add_manual_peer(
    state: tauri::State<'_, DesktopState>,
    ip: String,
    port: Option<u16>,
) -> CommandResult<Value> {
    state.require(reserved::DEVICES_PAIR, None).await?;
    let ip = std::net::IpAddr::from_str(&ip).map_err(|error| CommandError::invalid("ip", error))?;
    let addr = SocketAddr::new(
        ip,
        port.unwrap_or(xamverse_core::config::EngineConfig::default().peer_port),
    );
    let key = state
        .engine
        .manual_peers
        .add(&addr.to_string())
        .map_err(CommandError::engine)?;
    Ok(json!({ "key": key, "addr": addr }))
}

#[tauri::command]
pub async fn engine_peers_list_manual_peers(
    state: tauri::State<'_, DesktopState>,
) -> CommandResult<Value> {
    state.require(reserved::SYNC_READ, None).await?;
    serde_json::to_value(
        state
            .engine
            .manual_peers
            .list()
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_peers_request_pairing(
    state: tauri::State<'_, DesktopState>,
    addr: String,
    school_id: String,
    school_name: String,
) -> CommandResult<Value> {
    let session = state
        .require_fresh(reserved::DEVICES_PAIR, Some(&addr))
        .await?;
    same_school(&session, &school_id)?;
    let addr = addr
        .parse()
        .map_err(|error| CommandError::invalid("addr", error))?;
    let pending = state
        .engine
        .sync
        .request_pairing(addr, &school_id, &school_name)
        .await
        .map_err(CommandError::engine)?;
    serde_json::to_value(pending).map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_peers_approve_pairing(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    device_id: String,
    approved_by: String,
) -> CommandResult<Value> {
    let session = state
        .require_fresh(reserved::DEVICES_PAIR, Some(&device_id))
        .await?;
    same_school(&session, &school_id)?;
    if session.user_id != approved_by {
        return Err(CommandError::code(
            "permission_denied",
            "approvedBy must be the active user",
        ));
    }
    state
        .engine
        .sync
        .approve_pairing(&school_id, &device_id, &approved_by)
        .map_err(CommandError::engine)?;
    Ok(ok())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_peers_revoke_device(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    device_id: String,
    revoked_by: String,
    reason: String,
) -> CommandResult<Value> {
    let session = state
        .require_fresh(reserved::DEVICES_REVOKE, Some(&device_id))
        .await?;
    same_school(&session, &school_id)?;
    if session.user_id != revoked_by {
        return Err(CommandError::code(
            "permission_denied",
            "revokedBy must be the active user",
        ));
    }
    state
        .engine
        .sync
        .revoke_device(&school_id, &device_id, &revoked_by, &reason)
        .map_err(CommandError::engine)?;
    Ok(ok())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_peers_list_peers(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
) -> CommandResult<Value> {
    let session = state.require(reserved::SYNC_READ, None).await?;
    same_school(&session, &school_id)?;
    let rows =
        TrustRepo::list(&state.engine.db.lock(), &school_id).map_err(CommandError::engine)?;
    serde_json::to_value(rows).map_err(CommandError::engine)
}

#[tauri::command]
pub async fn engine_peers_fingerprint(
    state: tauri::State<'_, DesktopState>,
) -> CommandResult<String> {
    state.session().await?;
    Ok(state.engine.identity.fingerprint())
}

#[tauri::command]
pub async fn engine_peers_ping_peer(
    state: tauri::State<'_, DesktopState>,
    addr: String,
) -> CommandResult<Value> {
    state.require(reserved::SYNC_READ, Some(&addr)).await?;
    let addr = addr
        .parse()
        .map_err(|error| CommandError::invalid("addr", error))?;
    serde_json::to_value(
        state
            .engine
            .probe_peer(addr)
            .await
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_sync_create_op(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    category: String,
    object_id: String,
    payload_json: Option<String>,
    blob_sha256: Option<String>,
    tombstone: bool,
    target_device_ids: Vec<String>,
    expected_base_revision: Option<i64>,
) -> CommandResult<Value> {
    let session = state
        .require(reserved::SYNC_WRITE, Some(&object_id))
        .await?;
    same_school(&session, &school_id)?;
    let op = state
        .engine
        .sync
        .local
        .create(
            &school_id,
            &category,
            &object_id,
            payload_json.as_deref(),
            blob_sha256.as_deref(),
            tombstone,
            &target_device_ids,
            expected_base_revision,
        )
        .map_err(CommandError::engine)?;
    serde_json::to_value(op).map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_sync_objects(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    category: Option<String>,
    limit: Option<i64>,
) -> CommandResult<Value> {
    let session = state.require(reserved::SYNC_READ, None).await?;
    same_school(&session, &school_id)?;
    let categories: Vec<String> = category.into_iter().collect();
    let rows = ObjectsRepo::summaries(
        &state.engine.db.lock(),
        &school_id,
        &categories,
        -1,
        limit.unwrap_or(200).clamp(1, 1000),
    )
    .map_err(CommandError::engine)?;
    serde_json::to_value(rows).map_err(CommandError::engine)
}

fn parse_job_status(status: Option<String>) -> CommandResult<Vec<JobStatus>> {
    status
        .map(|value| match value.as_str() {
            "queued" => Ok(JobStatus::Queued),
            "running" => Ok(JobStatus::Running),
            "completed" => Ok(JobStatus::Completed),
            "failed" => Ok(JobStatus::Failed),
            "cancelled" => Ok(JobStatus::Cancelled),
            _ => Err(CommandError::invalid("status", value)),
        })
        .transpose()
        .map(|value| value.into_iter().collect())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_sync_jobs(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    status: Option<String>,
    limit: Option<i64>,
) -> CommandResult<Value> {
    let session = state.require(reserved::SYNC_READ, None).await?;
    same_school(&session, &school_id)?;
    let statuses = parse_job_status(status)?;
    let rows = JobsRepo::list(
        &state.engine.db.lock(),
        &school_id,
        &statuses,
        limit.unwrap_or(200).clamp(1, 1000),
    )
    .map_err(CommandError::engine)?;
    serde_json::to_value(rows).map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_sync_retry_job(
    state: tauri::State<'_, DesktopState>,
    job_id: String,
) -> CommandResult<Value> {
    let session = state.require(reserved::SYNC_WRITE, Some(&job_id)).await?;
    let job = JobsRepo::get(&state.engine.db.lock(), &job_id).map_err(CommandError::engine)?;
    same_school(&session, &job.school_id)?;
    JobsRepo::mark_status(&state.engine.db.lock(), &job_id, JobStatus::Queued, None)
        .map_err(CommandError::engine)?;
    Ok(ok())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_sync_cancel_job(
    state: tauri::State<'_, DesktopState>,
    job_id: String,
) -> CommandResult<Value> {
    let session = state.require(reserved::SYNC_WRITE, Some(&job_id)).await?;
    let job = JobsRepo::get(&state.engine.db.lock(), &job_id).map_err(CommandError::engine)?;
    same_school(&session, &job.school_id)?;
    if !JobsRepo::cancel(&state.engine.db.lock(), &job_id).map_err(CommandError::engine)? {
        return Err(CommandError::code("constraint", "job is not cancellable"));
    }
    Ok(ok())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_sync_pull(
    state: tauri::State<'_, DesktopState>,
    peer_device_id: String,
    school_id: String,
    categories: Option<Vec<String>>,
) -> CommandResult<Value> {
    let session = state
        .require(reserved::SYNC_COLLECT, Some(&peer_device_id))
        .await?;
    same_school(&session, &school_id)?;
    serde_json::to_value(
        state
            .engine
            .pull_from_peer(&peer_device_id, &school_id, categories.unwrap_or_default())
            .await
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

fn parse_conflict_status(status: Option<String>) -> CommandResult<Option<ConflictStatus>> {
    status
        .map(|value| match value.as_str() {
            "open" => Ok(ConflictStatus::Open),
            "resolved" => Ok(ConflictStatus::Resolved),
            "deferred" => Ok(ConflictStatus::Deferred),
            _ => Err(CommandError::invalid("status", value)),
        })
        .transpose()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_conflicts_list(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    status: Option<String>,
) -> CommandResult<Value> {
    let session = state.require(reserved::SYNC_READ, None).await?;
    same_school(&session, &school_id)?;
    serde_json::to_value(
        state
            .engine
            .conflicts
            .list(&school_id, parse_conflict_status(status)?)
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_conflicts_get(
    state: tauri::State<'_, DesktopState>,
    conflict_id: String,
) -> CommandResult<Value> {
    let session = state
        .require(reserved::SYNC_READ, Some(&conflict_id))
        .await?;
    let row = state
        .engine
        .conflicts
        .get(&conflict_id)
        .map_err(CommandError::engine)?;
    same_school(&session, &row.school_id)?;
    serde_json::to_value(row).map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_conflicts_resolve(
    state: tauri::State<'_, DesktopState>,
    conflict_id: String,
    resolution: String,
    resolved_by: String,
    note: Option<String>,
) -> CommandResult<Value> {
    let session = state
        .require(reserved::SYNC_RESOLVE_CONFLICT, Some(&conflict_id))
        .await?;
    let conflict = state
        .engine
        .conflicts
        .get(&conflict_id)
        .map_err(CommandError::engine)?;
    same_school(&session, &conflict.school_id)?;
    if session.user_id != resolved_by {
        return Err(CommandError::code(
            "permission_denied",
            "resolvedBy must be the active user",
        ));
    }
    let resolution = match resolution.as_str() {
        "accept_incoming" => Resolution::AcceptIncoming,
        "keep_local" => Resolution::KeepLocal,
        _ => return Err(CommandError::invalid("resolution", resolution)),
    };
    let outcome = state
        .engine
        .conflicts
        .resolve(&conflict_id, resolution, &resolved_by, note.as_deref())
        .map_err(CommandError::engine)?;
    Ok(json!({ "outcome": outcome }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_conflicts_defer(
    state: tauri::State<'_, DesktopState>,
    conflict_id: String,
) -> CommandResult<Value> {
    let session = state
        .require(reserved::SYNC_RESOLVE_CONFLICT, Some(&conflict_id))
        .await?;
    let conflict = state
        .engine
        .conflicts
        .get(&conflict_id)
        .map_err(CommandError::engine)?;
    same_school(&session, &conflict.school_id)?;
    state
        .engine
        .conflicts
        .defer(&conflict_id)
        .map_err(CommandError::engine)?;
    Ok(ok())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_packages_import_package(
    state: tauri::State<'_, DesktopState>,
    manifest: PackageManifest,
    content_json: String,
    approved_signature: Option<String>,
    target_device_ids: Vec<String>,
) -> CommandResult<Value> {
    let session = state
        .require(reserved::SYNC_DISTRIBUTE, Some(&manifest.package_id))
        .await?;
    same_school(&session, &manifest.school_id)?;
    serde_json::to_value(
        state
            .engine
            .packages
            .import(
                &manifest,
                &content_json,
                approved_signature.as_deref(),
                &target_device_ids,
            )
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_packages_student_view(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    package_id: String,
) -> CommandResult<Value> {
    let session = state.session().await?;
    same_school(&session, &school_id)?;
    state
        .engine
        .packages
        .student_view(&school_id, &package_id)
        .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_packages_full_view(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    package_id: String,
) -> CommandResult<Value> {
    let session = state
        .require(reserved::SYNC_READ, Some(&package_id))
        .await?;
    same_school(&session, &school_id)?;
    state
        .engine
        .packages
        .full_view(&school_id, &package_id)
        .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_packages_content_hash(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    package_id: String,
) -> CommandResult<String> {
    let session = state.session().await?;
    same_school(&session, &school_id)?;
    state
        .engine
        .packages
        .content_hash(&school_id, &package_id)
        .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_attempts_start_attempt(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
    package_id: String,
    student_ref: String,
) -> CommandResult<Value> {
    let session = state.session().await?;
    same_school(&session, &school_id)?;
    if session.user_id != student_ref
        && !state
            .engine
            .authz
            .can(&session, reserved::SYNC_WRITE)
            .map_err(CommandError::engine)?
    {
        return Err(CommandError::code(
            "permission_denied",
            "studentRef must identify the active user",
        ));
    }
    serde_json::to_value(
        state
            .engine
            .attempts
            .start(&school_id, &package_id, &student_ref)
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

async fn authorize_attempt(
    state: &DesktopState,
    attempt_id: &str,
) -> CommandResult<SessionContext> {
    let session = state.session().await?;
    let attempt = state
        .engine
        .attempts
        .get(attempt_id)
        .map_err(CommandError::engine)?;
    same_school(&session, &attempt.school_id)?;
    if session.user_id != attempt.student_ref
        && !state
            .engine
            .authz
            .can(&session, reserved::SYNC_READ)
            .map_err(CommandError::engine)?
    {
        return Err(CommandError::code(
            "permission_denied",
            "attempt belongs to another user",
        ));
    }
    Ok(session)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_attempts_save_answer(
    state: tauri::State<'_, DesktopState>,
    attempt_id: String,
    kind: String,
    payload: Value,
) -> CommandResult<Value> {
    authorize_attempt(&state, &attempt_id).await?;
    let event = state
        .engine
        .attempts
        .save_event(&attempt_id, &kind, payload)
        .map_err(CommandError::engine)?;
    Ok(json!({ "seq": event.seq, "hash": event.hash }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_attempts_finalize_attempt(
    state: tauri::State<'_, DesktopState>,
    attempt_id: String,
    integrity_signature: String,
    target_device_ids: Vec<String>,
) -> CommandResult<Value> {
    authorize_attempt(&state, &attempt_id).await?;
    serde_json::to_value(
        state
            .engine
            .attempts
            .finalize(&attempt_id, &integrity_signature, &target_device_ids)
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_attempts_get_attempt(
    state: tauri::State<'_, DesktopState>,
    attempt_id: String,
) -> CommandResult<Value> {
    authorize_attempt(&state, &attempt_id).await?;
    serde_json::to_value(
        state
            .engine
            .attempts
            .get(&attempt_id)
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_attempts_finalized_attempts(
    state: tauri::State<'_, DesktopState>,
    school_id: String,
) -> CommandResult<Value> {
    let session = state.require(reserved::SYNC_COLLECT, None).await?;
    same_school(&session, &school_id)?;
    serde_json::to_value(
        state
            .engine
            .attempts
            .finalized(&school_id)
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_licensing_activation_request(
    state: tauri::State<'_, DesktopState>,
    school_hint: String,
) -> CommandResult<Value> {
    serde_json::to_value(state.engine.licences.activation_request(&school_hint))
        .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_licensing_import_activation(
    state: tauri::State<'_, DesktopState>,
    cert_json: String,
) -> CommandResult<Value> {
    state.require_fresh(reserved::LICENCE_MANAGE, None).await?;
    serde_json::to_value(
        state
            .engine
            .licences
            .import_activation(&cert_json)
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command]
pub async fn engine_licensing_status(
    state: tauri::State<'_, DesktopState>,
) -> CommandResult<Value> {
    serde_json::to_value(state.engine.licences.status()).map_err(CommandError::engine)
}

#[tauri::command]
pub async fn engine_licensing_entitlements(
    state: tauri::State<'_, DesktopState>,
) -> CommandResult<Vec<String>> {
    Ok(state.engine.licences.entitlements())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_licensing_feature_available(
    state: tauri::State<'_, DesktopState>,
    feature: String,
) -> CommandResult<bool> {
    Ok(state.engine.licences.feature_available(&feature))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_backups_create(
    state: tauri::State<'_, DesktopState>,
    passphrase: String,
    kind: String,
    school_scope: Option<String>,
) -> CommandResult<Value> {
    let session = state.require_fresh(reserved::BACKUPS_MANAGE, None).await?;
    if let Some(school) = &school_scope {
        same_school(&session, school)?;
    }
    let path = match (kind.as_str(), school_scope.as_deref()) {
        ("full", None) => state.engine.backups.create_full(&passphrase),
        ("scoped", Some(school)) => state.engine.backups.create_scoped(&passphrase, school),
        _ => {
            return Err(CommandError::invalid(
                "kind",
                "use full, or scoped with schoolScope",
            ))
        }
    }
    .map_err(CommandError::engine)?;
    Ok(json!({ "path": path }))
}

#[tauri::command]
pub async fn engine_backups_verify(
    state: tauri::State<'_, DesktopState>,
    path: String,
    passphrase: String,
) -> CommandResult<Value> {
    state.require(reserved::BACKUPS_MANAGE, Some(&path)).await?;
    serde_json::to_value(
        state
            .engine
            .backups
            .verify(Path::new(&path), &passphrase)
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command]
pub async fn engine_backups_list(state: tauri::State<'_, DesktopState>) -> CommandResult<Value> {
    state.require(reserved::BACKUPS_MANAGE, None).await?;
    serde_json::to_value(state.engine.backups.list().map_err(CommandError::engine)?)
        .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_updates_import_update(
    state: tauri::State<'_, DesktopState>,
    manifest_json: String,
    artifact: Vec<u8>,
) -> CommandResult<Value> {
    state.require_fresh(reserved::UPDATES_MANAGE, None).await?;
    let update_id = state
        .engine
        .updates
        .import(&manifest_json, &artifact)
        .map_err(CommandError::engine)?;
    Ok(json!({ "updateId": update_id }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_updates_stage(
    state: tauri::State<'_, DesktopState>,
    update_id: String,
) -> CommandResult<Value> {
    state
        .require_fresh(reserved::UPDATES_MANAGE, Some(&update_id))
        .await?;
    let path = state
        .engine
        .updates
        .stage(&update_id)
        .map_err(CommandError::engine)?;
    Ok(json!({ "path": path }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_updates_mark_applied(
    state: tauri::State<'_, DesktopState>,
    update_id: String,
) -> CommandResult<Value> {
    state
        .require(reserved::UPDATES_MANAGE, Some(&update_id))
        .await?;
    state
        .engine
        .updates
        .mark_applied(&update_id)
        .map_err(CommandError::engine)?;
    Ok(ok())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_updates_mark_rejected(
    state: tauri::State<'_, DesktopState>,
    update_id: String,
    reason: String,
) -> CommandResult<Value> {
    state
        .require(reserved::UPDATES_MANAGE, Some(&update_id))
        .await?;
    state
        .engine
        .updates
        .mark_rejected(&update_id, &reason)
        .map_err(CommandError::engine)?;
    Ok(ok())
}

#[tauri::command]
pub async fn engine_updates_history(
    state: tauri::State<'_, DesktopState>,
    limit: Option<i64>,
) -> CommandResult<Value> {
    state.require(reserved::UPDATES_MANAGE, None).await?;
    serde_json::to_value(
        state
            .engine
            .updates
            .history(limit.unwrap_or(100).clamp(1, 1000))
            .map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditFilter {
    school_id: Option<String>,
    actor_user: Option<String>,
    action_prefix: Option<String>,
    limit: Option<i64>,
}

#[tauri::command]
pub async fn engine_audit_query(
    state: tauri::State<'_, DesktopState>,
    filter: AuditFilter,
) -> CommandResult<Value> {
    let session = state.require(reserved::AUDIT_VIEW, None).await?;
    if let Some(school) = &filter.school_id {
        same_school(&session, school)?;
    }
    let query = xamverse_audit::AuditQuery {
        school_id: filter.school_id.or_else(|| Some(session.school_id)),
        actor_user: filter.actor_user,
        action_prefix: filter.action_prefix,
        limit: filter.limit.unwrap_or(200).clamp(1, 1000),
    };
    serde_json::to_value(
        xamverse_audit::query(&state.engine.db.lock(), &query).map_err(CommandError::engine)?,
    )
    .map_err(CommandError::engine)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn engine_audit_verify_chain(
    state: tauri::State<'_, DesktopState>,
) -> CommandResult<bool> {
    state.require(reserved::AUDIT_VIEW, None).await?;
    xamverse_audit::verify_chain(&state.engine.db.lock()).map_err(CommandError::engine)
}

#[tauri::command]
pub async fn engine_diagnostics_status(
    state: tauri::State<'_, DesktopState>,
) -> CommandResult<Value> {
    serde_json::to_value(state.engine.status().map_err(CommandError::engine)?)
        .map_err(CommandError::engine)
}

#[tauri::command]
pub async fn engine_events_recent(
    state: tauri::State<'_, DesktopState>,
    limit: Option<usize>,
) -> CommandResult<Value> {
    state.session().await?;
    serde_json::to_value(
        state
            .engine
            .events
            .recent(limit.unwrap_or(100).clamp(1, 1000)),
    )
    .map_err(CommandError::engine)
}
