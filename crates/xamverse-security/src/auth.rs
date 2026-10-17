//! Offline authentication and session management.
//!
//! WHY THIS EXISTS
//! ---------------
//! Replaces the Phase 1 demo login selector with a real credential engine:
//! Argon2id password verification, hashed session tokens, expiry, locking,
//! revocation, reauthentication for sensitive operations and login throttling
//! — all functional with zero network connectivity.
//!
//! Security decisions worth noting:
//! * Session tokens are 32 random bytes shown once; only their SHA-256 hash
//!   is stored, so a stolen database cannot hijack live sessions.
//! * Unknown usernames still run an Argon2id verification against a constant
//!   dummy hash to keep timing uniform (no user enumeration via latency).
//! * Credential and error text never distinguishes "no such user" from
//!   "wrong password" in returned errors.
//! * Password changes revoke every live session of that user on this device.

use crate::permissions::builtin_role_permissions;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;
use xamverse_audit::AuditEvent;
use xamverse_storage::repos::{LoginAttemptsRepo, SessionRow, SessionsRepo, UsersRepo};
use xamverse_storage::{now_rfc3339, Database, StorageError};

/// Argon2id parameters (OWASP recommended baseline): 19 MiB memory, 2 passes,
/// parallelism 1. Exposed as constants so tuning is a reviewable decision.
const ARGON_M_COST_KIB: u32 = 19_456;
const ARGON_T_COST: u32 = 2;
const ARGON_P_COST: u32 = 1;

/// One day of failed logins within the window triggers throttling.
const LOCKOUT_MAX_FAILURES: i64 = 5;
const LOCKOUT_WINDOW: Duration = Duration::from_secs(15 * 60);
const LOCKOUT_DURATION: Duration = Duration::from_secs(15 * 60);

/// Default session lifetimes.
const DESKTOP_SESSION_TTL: Duration = Duration::from_secs(12 * 3600);
const BROWSER_SESSION_TTL: Duration = Duration::from_secs(2 * 3600);
/// Sessions older than this require reauthentication for sensitive actions.
const SENSITIVE_MAX_AGE: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub desktop_session_ttl: Duration,
    pub browser_session_ttl: Duration,
    pub sensitive_max_age: Duration,
    pub lockout_max_failures: i64,
    pub lockout_window: Duration,
    pub lockout_duration: Duration,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            desktop_session_ttl: DESKTOP_SESSION_TTL,
            browser_session_ttl: BROWSER_SESSION_TTL,
            sensitive_max_age: SENSITIVE_MAX_AGE,
            lockout_max_failures: LOCKOUT_MAX_FAILURES,
            lockout_window: LOCKOUT_WINDOW,
            lockout_duration: LOCKOUT_DURATION,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    /// Deliberately generic: no user enumeration.
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("account is suspended; contact a school administrator")]
    AccountSuspended,
    #[error("too many failed attempts; try again later")]
    LockedOut,
    #[error("session is locked; unlock to continue")]
    SessionLocked,
    #[error("session is not valid (expired or revoked)")]
    SessionInvalid,
    #[error("session is too old for a sensitive operation; reauthenticate")]
    ReauthenticationRequired,
    #[error("permission denied: {permission}")]
    PermissionDenied { permission: String },
    #[error(transparent)]
    Storage(#[from] StorageError),
}

/// The authenticated context attached to every authorized operation.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionContext {
    /// SHA-256 of the raw token — the storage-level session key.
    pub token_hash: String,
    pub user_id: String,
    pub school_id: String,
    pub kind: SessionKind,
    pub created_at: String,
    pub expires_at: String,
    pub locked: bool,
    /// Effective permissions resolved from the live role tables at
    /// authentication time — permission edits take effect immediately.
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    Desktop,
    Browser,
}

impl SessionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            SessionKind::Desktop => "desktop",
            SessionKind::Browser => "browser",
        }
    }
}

pub struct AuthService {
    db: Arc<Database>,
    config: AuthConfig,
}

impl AuthService {
    pub fn new(db: Arc<Database>) -> Self {
        Self::with_config(db, AuthConfig::default())
    }

    pub fn with_config(db: Arc<Database>, config: AuthConfig) -> Self {
        Self { db, config }
    }

    /// Verify credentials and open a session.
    ///
    /// `device_id` records *which installation* performed the login for the
    /// audit trail; it grants nothing by itself.
    pub fn login(
        &self,
        school_id: &str,
        username: &str,
        password: &str,
        kind: SessionKind,
        origin: Option<&str>,
        actor_device: Option<&str>,
    ) -> Result<(String, SessionContext), AuthError> {
        // Throttle before touching credentials (constant-time characteristics
        // of the fast path don't matter; we fail closed).
        let throttle_key = format!("{school_id}:{username}");
        let now = chrono::Utc::now();
        let window_start = (now - time_delta(self.config.lockout_window)).to_rfc3339();
        {
            let conn = self.db.lock();
            let failures =
                LoginAttemptsRepo::count_failures_since(&conn, &throttle_key, &window_start)?;
            if failures >= self.config.lockout_max_failures {
                self.audit_login(
                    &conn,
                    school_id,
                    username,
                    actor_device,
                    "auth.login.throttled",
                    None,
                );
                return Err(AuthError::LockedOut);
            }
        }

        let user = {
            let conn = self.db.lock();
            UsersRepo::get_by_username(&conn, school_id, username)?
        };

        let Some(user) = user else {
            // Consume comparable time so missing users are indistinguishable.
            let _ = verify_password(password, dummy_phc_hash());
            self.record_attempt(school_id, username, false, actor_device)?;
            return Err(AuthError::InvalidCredentials);
        };

        let Some(auth_hash) = user.auth_hash.clone() else {
            // Account exists but has no local credential provisioned yet.
            let _ = verify_password(password, dummy_phc_hash());
            self.record_attempt(school_id, username, false, actor_device)?;
            return Err(AuthError::InvalidCredentials);
        };

        if !verify_password(password, &auth_hash) {
            self.record_attempt(school_id, username, false, actor_device)?;
            return Err(AuthError::InvalidCredentials);
        }

        if user.status != "active" {
            self.record_attempt(school_id, username, false, actor_device)?;
            return Err(AuthError::AccountSuspended);
        }

        // Success: mint the token, persist only its hash, resolve permissions.
        let token = xamverse_storage::random_bytes(32);
        let token_hex = hex(&token);
        let token_hash = hash_token(&token_hex);
        let ttl = match kind {
            SessionKind::Desktop => self.config.desktop_session_ttl,
            SessionKind::Browser => self.config.browser_session_ttl,
        };
        let created_at = now_rfc3339();
        let expires_at = (now + time_delta(ttl)).to_rfc3339();

        let permissions: Vec<String> = {
            let conn = self.db.lock();
            SessionsRepo::insert(
                &conn,
                &SessionRow {
                    token_hash: token_hash.clone(),
                    user_id: user.user_id.clone(),
                    school_id: school_id.to_string(),
                    kind: kind.as_str().to_string(),
                    origin: origin.map(str::to_string),
                    created_at: created_at.clone(),
                    expires_at: expires_at.clone(),
                    last_active_at: created_at.clone(),
                    locked_at: None,
                    revoked_at: None,
                    revoked_reason: None,
                },
            )?;
            LoginAttemptsRepo::record(&conn, &throttle_key, true)?;
            let perms = UsersRepo::effective_permissions(&conn, school_id, &user.user_id)?;
            self.audit_login(
                &conn,
                school_id,
                username,
                actor_device,
                "auth.login",
                Some(&user.user_id),
            );
            perms.into_iter().collect()
        };

        let ctx = SessionContext {
            token_hash: token_hash.clone(),
            user_id: user.user_id,
            school_id: school_id.to_string(),
            kind,
            created_at,
            expires_at,
            locked: false,
            permissions,
        };
        Ok((token_hex, ctx))
    }

    /// Validate a token and return the live context. Touches activity time.
    pub fn authenticate(&self, token: &str) -> Result<SessionContext, AuthError> {
        let token_hash = hash_token(token);
        let conn = self.db.lock();
        let row = SessionsRepo::get_live(&conn, &token_hash)?.ok_or(AuthError::SessionInvalid)?;
        let user = UsersRepo::get(&conn, &row.school_id, &row.user_id)?;
        // A user suspended *after* login loses access immediately on this node.
        if user.status != "active" {
            drop(conn);
            self.logout(token)?;
            return Err(AuthError::AccountSuspended);
        }
        SessionsRepo::touch(&conn, &token_hash)?;
        let permissions: Vec<String> =
            UsersRepo::effective_permissions(&conn, &row.school_id, &row.user_id)?
                .into_iter()
                .collect();
        Ok(SessionContext {
            token_hash: row.token_hash,
            user_id: row.user_id,
            school_id: row.school_id,
            kind: match row.kind.as_str() {
                "desktop" => SessionKind::Desktop,
                _ => SessionKind::Browser,
            },
            created_at: row.created_at,
            expires_at: row.expires_at,
            locked: row.locked_at.is_some(),
            permissions,
        })
    }

    pub fn lock_session(&self, token: &str) -> Result<(), AuthError> {
        let conn = self.db.lock();
        SessionsRepo::set_locked(&conn, &hash_token(token), true)?;
        Ok(())
    }

    /// Unlock requires the password again (reauthentication on unlock).
    pub fn unlock_session(&self, token: &str, password: &str) -> Result<SessionContext, AuthError> {
        let token_hash = hash_token(token);
        let conn = self.db.lock();
        let row = SessionsRepo::get_live(&conn, &token_hash)?.ok_or(AuthError::SessionInvalid)?;
        let user = UsersRepo::get(&conn, &row.school_id, &row.user_id)?;
        let Some(auth_hash) = user.auth_hash else {
            return Err(AuthError::InvalidCredentials);
        };
        if !verify_password(password, &auth_hash) {
            return Err(AuthError::InvalidCredentials);
        }
        SessionsRepo::set_locked(&conn, &token_hash, false)?;
        let permissions: Vec<String> =
            UsersRepo::effective_permissions(&conn, &row.school_id, &row.user_id)?
                .into_iter()
                .collect();
        Ok(SessionContext {
            token_hash: row.token_hash,
            user_id: row.user_id,
            school_id: row.school_id,
            kind: match row.kind.as_str() {
                "desktop" => SessionKind::Desktop,
                _ => SessionKind::Browser,
            },
            created_at: row.created_at,
            expires_at: row.expires_at,
            locked: false,
            permissions,
        })
    }

    pub fn logout(&self, token: &str) -> Result<(), AuthError> {
        let conn = self.db.lock();
        SessionsRepo::revoke(&conn, &hash_token(token), "logout")?;
        Ok(())
    }

    /// Administrative revocation of every live session for a user on this node.
    pub fn revoke_all_for_user(
        &self,
        school_id: &str,
        user_id: &str,
        reason: &str,
    ) -> Result<u64, AuthError> {
        let conn = self.db.lock();
        let count = SessionsRepo::revoke_all_for_user(&conn, school_id, user_id, reason)?;
        Ok(count)
    }

    /// Change a password: verify the old one, store the new hash, revoke all
    /// sessions for the user, and bump the user revision (so the change can
    /// replicate as a signed credential op via the sync layer).
    pub fn change_password(
        &self,
        school_id: &str,
        user_id: &str,
        old_password: Option<&str>,
        new_password: &str,
        actor_device: Option<&str>,
    ) -> Result<i64, AuthError> {
        if new_password.len() < 8 {
            return Err(AuthError::Storage(StorageError::InvalidValue {
                field: "new password",
                reason: "must be at least 8 characters".into(),
            }));
        }
        let (auth_hash_old, username) = {
            let conn = self.db.lock();
            let user = UsersRepo::get(&conn, school_id, user_id)?;
            (user.auth_hash, user.username)
        };
        if let Some(old) = old_password {
            let Some(hash) = auth_hash_old else {
                return Err(AuthError::InvalidCredentials);
            };
            if !verify_password(old, &hash) {
                self.record_attempt(school_id, &username, false, actor_device)?;
                return Err(AuthError::InvalidCredentials);
            }
        }
        let new_hash = hash_password(new_password)?;
        let revision = self.db.tx(|conn| {
            let revision = UsersRepo::set_auth_hash(conn, school_id, user_id, Some(&new_hash))?;
            SessionsRepo::revoke_all_for_user(conn, school_id, user_id, "password changed")?;
            xamverse_audit::record(
                conn,
                &AuditEvent::new("auth.password_changed")
                    .with_school(school_id)
                    .with_target(user_id),
            )?;
            Ok(revision)
        })?;
        Ok(revision)
    }

    /// Sensitive operations call this to demand a young session.
    pub fn require_fresh(&self, ctx: &SessionContext) -> Result<(), AuthError> {
        let created = chrono::DateTime::parse_from_rfc3339(&ctx.created_at)
            .map_err(|_| AuthError::SessionInvalid)?;
        let age = chrono::Utc::now().signed_duration_since(created);
        if age <= time_delta(self.config.sensitive_max_age) {
            Ok(())
        } else {
            Err(AuthError::ReauthenticationRequired)
        }
    }

    /// Housekeeping (background job): drop expired/revoked session rows and
    /// stale login attempts.
    pub fn housekeeping(&self) -> Result<(u64, u64), AuthError> {
        let cutoff = (chrono::Utc::now() - time_delta(HOUSEKEEPING_WINDOW)).to_rfc3339();
        let conn = self.db.lock();
        let sessions = SessionsRepo::purge_expired(&conn)?;
        let attempts = LoginAttemptsRepo::prune_older_than(&conn, &cutoff)?;
        Ok((sessions, attempts))
    }

    fn record_attempt(
        &self,
        school_id: &str,
        username: &str,
        success: bool,
        actor_device: Option<&str>,
    ) -> Result<(), AuthError> {
        let conn = self.db.lock();
        LoginAttemptsRepo::record(&conn, &format!("{school_id}:{username}"), success)?;
        if !success {
            self.audit_login(
                &conn,
                school_id,
                username,
                actor_device,
                "auth.login.failed",
                None,
            );
        }
        Ok(())
    }

    fn audit_login(
        &self,
        conn: &Connection,
        school_id: &str,
        username: &str,
        actor_device: Option<&str>,
        action: &str,
        user_id: Option<&str>,
    ) {
        // Audit failures must never break authentication.
        let detail = serde_json::json!({
            "username": username,
            "user_id": user_id,
            "device": actor_device,
        })
        .to_string();
        let _ = xamverse_audit::record(
            conn,
            &AuditEvent::new(action)
                .with_school(school_id)
                .with_target(username.to_string())
                .with_detail_json(detail),
        );
    }
}

/// Hash a password with Argon2id under the engine's parameters.
pub fn hash_password(password: &str) -> Result<String, AuthError> {
    let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
    let argon = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(ARGON_M_COST_KIB, ARGON_T_COST, ARGON_P_COST, None).map_err(|e| {
            AuthError::Storage(StorageError::InvalidValue {
                field: "argon2 params",
                reason: e.to_string(),
            })
        })?,
    );
    argon
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| {
            AuthError::Storage(StorageError::InvalidValue {
                field: "password hash",
                reason: e.to_string(),
            })
        })
}

/// Verify a password against a PHC-format Argon2id hash.
fn verify_password(password: &str, phc: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(phc) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// A fixed, random PHC hash used to equalize timing for unknown users. This
/// is a hash of random data generated once — it matches no real password.
fn dummy_phc_hash() -> &'static str {
    use std::sync::OnceLock;
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        hash_password(
            &xamverse_storage::random_bytes(18)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
        )
        .unwrap_or_else(|_| "$argon2id$invalid".to_string())
    })
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Convert a std Duration to chrono's TimeDelta. All configured durations are
/// compile-time constants far below the representable range, so failure is
/// impossible; map it to a storage error rather than a chrono error type.
/// Login attempts older than this are pruned by housekeeping.
const HOUSEKEEPING_WINDOW: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 3600);

fn time_delta(d: std::time::Duration) -> chrono::TimeDelta {
    chrono::TimeDelta::from_std(d).unwrap_or_else(|_| chrono::TimeDelta::seconds(1))
}

/// Seed the builtin roles (with their permission sets) for a school.
/// Called at enrollment; safe to re-run.
pub fn seed_builtin_roles(conn: &Connection, school_id: &str) -> Result<(), StorageError> {
    use xamverse_storage::repos::RoleRow;
    for (role_name, role_id) in [
        ("owner", "role-owner"),
        ("admin", "role-admin"),
        ("teacher", "role-teacher"),
        ("student", "role-student"),
    ] {
        UsersRepo::upsert_role(
            conn,
            &RoleRow {
                role_id: role_id.to_string(),
                school_id: school_id.to_string(),
                name: role_name.to_string(),
                is_builtin: true,
                revision: 1,
            },
        )?;
        let permissions: Vec<String> = builtin_role_permissions(role_name)
            .into_iter()
            .map(String::from)
            .collect();
        UsersRepo::set_role_permissions(conn, school_id, role_id, &permissions)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use xamverse_storage::repos::{SchoolsRepo, UsersRepo};
    use xamverse_storage::DatabaseKey;

    fn setup() -> (tempfile::TempDir, Arc<Database>) {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) =
            Database::open(dir.path().join("auth.xamdb"), &DatabaseKey::generate()).unwrap();
        let db = Arc::new(db);
        db.tx(|conn| {
            SchoolsRepo::enroll(conn, "school-1", "Test School")?;
            seed_builtin_roles(conn, "school-1")?;
            Ok(())
        })
        .unwrap();
        (dir, db)
    }

    fn create_user(db: &Database, username: &str, password: &str, roles: &[&str]) -> String {
        let user_id = uuid::Uuid::now_v7().to_string();
        let hash = hash_password(password).unwrap();
        db.tx(|conn| {
            UsersRepo::upsert(
                conn,
                &xamverse_storage::repos::UserRow {
                    user_id: user_id.clone(),
                    school_id: "school-1".into(),
                    username: username.into(),
                    display_name: username.into(),
                    status: "active".into(),
                    auth_hash: Some(hash),
                    origin_device_id: None,
                    revision: 1,
                    updated_at: now_rfc3339(),
                },
            )?;
            for role in roles {
                let role_row = UsersRepo::find_role_by_name(conn, "school-1", role)
                    .unwrap()
                    .unwrap();
                UsersRepo::grant_role(conn, "school-1", &user_id, &role_row.role_id, None)?;
            }
            Ok(())
        })
        .unwrap();
        user_id
    }

    #[test]
    fn login_logout_and_authenticate_flow() {
        let (_dir, db) = setup();
        let service = AuthService::new(db.clone());
        create_user(&db, "alice", "correct-horse", &["teacher"]);
        let (token, ctx) = service
            .login(
                "school-1",
                "alice",
                "correct-horse",
                SessionKind::Desktop,
                None,
                None,
            )
            .unwrap();
        assert!(ctx.permissions.contains(&"sync.read".to_string()));
        assert!(!ctx.permissions.contains(&"backups.manage".to_string()));

        let authed = service.authenticate(&token).unwrap();
        assert_eq!(authed.user_id, ctx.user_id);

        service.logout(&token).unwrap();
        assert!(matches!(
            service.authenticate(&token),
            Err(AuthError::SessionInvalid)
        ));
    }

    #[test]
    fn wrong_password_and_unknown_user_are_indistinguishable() {
        let (_dir, db) = setup();
        let service = AuthService::new(db.clone());
        create_user(&db, "bob", "right", &["student"]);
        let e1 = service
            .login("school-1", "bob", "wrong", SessionKind::Desktop, None, None)
            .unwrap_err();
        let e2 = service
            .login(
                "school-1",
                "ghost",
                "wrong",
                SessionKind::Desktop,
                None,
                None,
            )
            .unwrap_err();
        assert_eq!(e1.to_string(), e2.to_string());
    }

    #[test]
    fn suspended_users_cannot_login_and_lose_sessions() {
        let (_dir, db) = setup();
        let service = AuthService::new(db.clone());
        let user_id = create_user(&db, "carol", "pw-123456", &["admin"]);
        let (token, _) = service
            .login(
                "school-1",
                "carol",
                "pw-123456",
                SessionKind::Desktop,
                None,
                None,
            )
            .unwrap();

        db.tx(|conn| {
            UsersRepo::set_status(conn, "school-1", &user_id, "suspended")?;
            Ok(())
        })
        .unwrap();
        assert!(matches!(
            service.login(
                "school-1",
                "carol",
                "pw-123456",
                SessionKind::Desktop,
                None,
                None
            ),
            Err(AuthError::AccountSuspended)
        ));
        assert!(matches!(
            service.authenticate(&token),
            Err(AuthError::AccountSuspended)
        ));
    }

    #[test]
    fn lockout_after_repeated_failures() {
        let (_dir, db) = setup();
        let service = AuthService::new(db.clone());
        create_user(&db, "mallory", "never-guess", &["student"]);
        for _ in 0..5 {
            let _ = service.login(
                "school-1",
                "mallory",
                "bad",
                SessionKind::Desktop,
                None,
                None,
            );
        }
        // Even the CORRECT password is now refused: throttle wins.
        assert!(matches!(
            service.login(
                "school-1",
                "mallory",
                "never-guess",
                SessionKind::Desktop,
                None,
                None
            ),
            Err(AuthError::LockedOut)
        ));
    }

    #[test]
    fn password_change_revokes_sessions_and_requires_old_password() {
        let (_dir, db) = setup();
        let service = AuthService::new(db.clone());
        create_user(&db, "dave", "old-password", &["owner"]);
        let (token, _) = service
            .login(
                "school-1",
                "dave",
                "old-password",
                SessionKind::Desktop,
                None,
                None,
            )
            .unwrap();

        // Wrong old password refused.
        assert!(service
            .change_password(
                "school-1",
                &ctx_user(&service, &token),
                Some("nope"),
                "new-password-1",
                None
            )
            .is_err());
        service
            .change_password(
                "school-1",
                &ctx_user(&service, &token),
                Some("old-password"),
                "new-password-1",
                None,
            )
            .unwrap();

        // All sessions revoked by the change.
        assert!(matches!(
            service.authenticate(&token),
            Err(AuthError::SessionInvalid)
        ));
        // New password works.
        let _ = service
            .login(
                "school-1",
                "dave",
                "new-password-1",
                SessionKind::Desktop,
                None,
                None,
            )
            .unwrap();
    }

    fn ctx_user(service: &AuthService, token: &str) -> String {
        service.authenticate(token).unwrap().user_id
    }

    #[test]
    fn reauthentication_required_for_old_sessions() {
        let (_dir, db) = setup();
        let config = AuthConfig {
            sensitive_max_age: Duration::from_secs(0),
            ..AuthConfig::default()
        };
        let service = AuthService::with_config(db.clone(), config);
        create_user(&db, "erin", "pw-123456", &["admin"]);
        let (token, ctx) = service
            .login(
                "school-1",
                "erin",
                "pw-123456",
                SessionKind::Desktop,
                None,
                None,
            )
            .unwrap();
        assert!(matches!(
            service.require_fresh(&ctx),
            Err(AuthError::ReauthenticationRequired)
        ));
        let _ = service.logout(&token);
    }

    #[test]
    fn builtin_roles_seeded_per_school() {
        let (_dir, db) = setup();
        let conn = db.lock();
        let owner = UsersRepo::find_role_by_name(&conn, "school-1", "owner")
            .unwrap()
            .unwrap();
        let perms = UsersRepo::effective_permissions(&conn, "school-1", "nobody").unwrap();
        assert!(perms.is_empty()); // no users yet — but role table exists
        let roles = UsersRepo::list_roles_for_user(&conn, "school-1", "none").unwrap();
        assert!(roles.is_empty());
        assert_eq!(owner.name, "owner");
    }
}
