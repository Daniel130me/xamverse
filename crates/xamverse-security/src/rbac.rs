//! Engine-side authorization checks (RBAC).
//!
//! The UI checking permissions is convenience; THIS is the boundary. Every
//! privileged engine operation resolves the caller's effective permissions
//! from the live role tables and refuses without them. Denials are audited.

use crate::auth::{AuthError, SessionContext};
use rusqlite::Connection;
use xamverse_storage::repos::UsersRepo;
use xamverse_storage::Database;
use std::sync::Arc;

pub struct Authz {
    db: Arc<Database>,
}

impl Authz {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// Live permission check against the current role tables — a permission
    /// revoked by a replicated authorization op applies on the next check.
    pub fn can(&self, ctx: &SessionContext, permission: &str) -> xamverse_storage::StorageResult<bool> {
        let conn = self.db.lock();
        Ok(UsersRepo::effective_permissions(&conn, &ctx.school_id, &ctx.user_id)?
            .contains(permission))
    }

    /// `can` with denial auditing — use in every privileged code path.
    pub fn require(
        &self,
        ctx: &SessionContext,
        permission: &str,
        target: Option<&str>,
    ) -> Result<(), AuthError> {
        let granted = self.can(ctx, permission).map_err(AuthError::Storage)?;
        if granted {
            return Ok(());
        }
        // Denial is a security-relevant event: persist it.
        let conn = self.db.lock();
        let _ = xamverse_audit::record(
            &conn,
            &xamverse_audit::AuditEvent::new("authz.denied")
                .with_school(&ctx.school_id)
                .with_actor(&ctx.user_id, "")
                .with_target(target.unwrap_or(permission).to_string())
                .with_detail_json(serde_json::json!({ "permission": permission }).to_string()),
        );
        Err(AuthError::PermissionDenied {
            permission: permission.to_string(),
        })
    }
}

/// Static helper mirroring `Authz::require` for code paths that already hold
/// a connection inside a transaction (avoids re-locking the database).
pub fn require_with_conn(
    conn: &Connection,
    ctx: &SessionContext,
    permission: &str,
) -> Result<(), AuthError> {
    let granted = UsersRepo::effective_permissions(conn, &ctx.school_id, &ctx.user_id)
        .map_err(AuthError::Storage)?
        .contains(permission);
    if granted {
        return Ok(());
    }
    let _ = xamverse_audit::record(
        conn,
        &xamverse_audit::AuditEvent::new("authz.denied")
            .with_school(&ctx.school_id)
            .with_actor(&ctx.user_id, "")
            .with_detail_json(serde_json::json!({ "permission": permission }).to_string()),
    );
    Err(AuthError::PermissionDenied {
        permission: permission.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::hash_password;
    use xamverse_storage::repos::{SchoolsRepo, UserRow, UsersRepo};
    use xamverse_storage::{now_rfc3339, Database, DatabaseKey};

    fn setup() -> (tempfile::TempDir, Arc<Database>) {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = Database::open(dir.path().join("rbac.xamdb"), &DatabaseKey::generate()).unwrap();
        let db = Arc::new(db);
        db.tx(|conn| {
            SchoolsRepo::enroll(conn, "s1", "School")?;
            crate::auth::seed_builtin_roles(conn, "s1")?;
            Ok(())
        })
        .unwrap();
        (dir, db)
    }

    fn user_with_roles(db: &Database, roles: &[&str]) -> SessionContext {
        let user_id = uuid::Uuid::now_v7().to_string();
        let hash = hash_password("pw-123456").unwrap();
        db.tx(|conn| {
            UsersRepo::upsert(conn, &UserRow {
                user_id: user_id.clone(),
                school_id: "s1".into(),
                username: user_id.clone(),
                display_name: "t".into(),
                status: "active".into(),
                auth_hash: Some(hash),
                origin_device_id: None,
                revision: 1,
                updated_at: now_rfc3339(),
            })?;
            for role in roles {
                let role_row = UsersRepo::find_role_by_name(conn, "s1", role).unwrap().unwrap();
                UsersRepo::grant_role(conn, "s1", &user_id, &role_row.role_id, None)?;
            }
            Ok(())
        })
        .unwrap();
        SessionContext {
            token_hash: "test".into(),
            user_id,
            school_id: "s1".into(),
            kind: crate::auth::SessionKind::Desktop,
            created_at: now_rfc3339(),
            expires_at: now_rfc3339(),
            locked: false,
            permissions: vec![],
        }
    }

    #[test]
    fn student_is_denied_admin_permissions() {
        let (_dir, db) = setup();
        let authz = Authz::new(db.clone());
        let ctx = user_with_roles(&db, &["student"]);
        assert!(!authz.can(&ctx, crate::permissions::reserved::DEVICES_PAIR).unwrap());
        assert!(matches!(
            authz.require(&ctx, crate::permissions::reserved::BACKUPS_MANAGE, None),
            Err(AuthError::PermissionDenied { .. })
        ));
    }

    #[test]
    fn owner_passes_everything_admin_loses_licence() {
        let (_dir, db) = setup();
        let authz = Authz::new(db.clone());
        let owner = user_with_roles(&db, &["owner"]);
        let admin = user_with_roles(&db, &["admin"]);
        for perm in crate::permissions::reserved::ALL {
            assert!(authz.can(&owner, perm).unwrap(), "owner lacks {perm}");
        }
        assert!(!authz.can(&admin, crate::permissions::reserved::LICENCE_MANAGE).unwrap());
        assert!(authz.can(&admin, crate::permissions::reserved::SYNC_COLLECT).unwrap());
    }

    #[test]
    fn permission_revocation_takes_effect_immediately() {
        let (_dir, db) = setup();
        let authz = Authz::new(db.clone());
        let ctx = user_with_roles(&db, &["teacher"]);
        assert!(authz.can(&ctx, crate::permissions::reserved::SYNC_READ).unwrap());

        // Revoke the teacher role; next check denies with no restart.
        db.tx(|conn| {
            let role = UsersRepo::find_role_by_name(conn, "s1", "teacher").unwrap().unwrap();
            UsersRepo::revoke_role(conn, "s1", &ctx.user_id, &role.role_id)?;
            Ok(())
        })
        .unwrap();
        assert!(!authz.can(&ctx, crate::permissions::reserved::SYNC_READ).unwrap());
    }
}
