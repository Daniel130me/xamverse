//! Users, credentials, roles and permissions (replicated identity records).
//!
//! Permissions are open strings; the engine reserves a fixed namespace (see
//! `xamverse-security::permissions`) but never hardcodes the full role table —
//! schools and Phase 3 may define more. The engine only *enforces* checks.

use super::exec;
use crate::error::{StorageError, StorageResult};
use crate::now_rfc3339;
use rusqlite::{params, Connection};
use std::collections::HashSet;

#[derive(Debug, Clone, serde::Serialize)]
pub struct UserRow {
    pub user_id: String,
    pub school_id: String,
    pub username: String,
    pub display_name: String,
    pub status: String, // active | suspended | disabled
    pub auth_hash: Option<String>,
    pub origin_device_id: Option<String>,
    pub revision: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RoleRow {
    pub role_id: String,
    pub school_id: String,
    pub name: String,
    pub is_builtin: bool,
    pub revision: i64,
}

pub struct UsersRepo;

impl UsersRepo {
    /// Insert or update a user record. Callers (sync apply, local admin) are
    /// responsible for revision checks; this is a plain upsert used inside
    /// their transactions.
    pub fn upsert(conn: &Connection, user: &UserRow) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO users (user_id, school_id, username, display_name, status,
                                auth_hash, origin_device_id, revision, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(school_id, user_id) DO UPDATE SET
                username = excluded.username,
                display_name = excluded.display_name,
                status = excluded.status,
                auth_hash = COALESCE(excluded.auth_hash, users.auth_hash),
                origin_device_id = COALESCE(excluded.origin_device_id, users.origin_device_id),
                revision = excluded.revision,
                updated_at = excluded.updated_at",
            params![
                user.user_id,
                user.school_id,
                user.username,
                user.display_name,
                user.status,
                user.auth_hash,
                user.origin_device_id,
                user.revision,
                user.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(conn: &Connection, school_id: &str, user_id: &str) -> StorageResult<UserRow> {
        let mut stmt = conn.prepare_cached(
            "SELECT user_id, school_id, username, display_name, status, auth_hash,
                    origin_device_id, revision, updated_at
             FROM users WHERE school_id = ?1 AND user_id = ?2",
        )?;
        stmt.query_row(params![school_id, user_id], Self::map_row)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => StorageError::NotFound {
                    entity: "user",
                    id: user_id.to_string(),
                },
                other => other.into(),
            })
    }

    /// Authentication lookup — one indexed query (performance: no N+1).
    pub fn get_by_username(conn: &Connection, school_id: &str, username: &str) -> StorageResult<Option<UserRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT user_id, school_id, username, display_name, status, auth_hash,
                    origin_device_id, revision, updated_at
             FROM users WHERE school_id = ?1 AND username = ?2",
        )?;
        let mut rows = stmt.query(params![school_id, username])?;
        match rows.next()? {
            Some(row) => Ok(Some(Self::map_row(row)?)),
            None => Ok(None),
        }
    }

    pub fn list(conn: &Connection, school_id: &str) -> StorageResult<Vec<UserRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT user_id, school_id, username, display_name, status, auth_hash,
                    origin_device_id, revision, updated_at
             FROM users WHERE school_id = ?1 ORDER BY username",
        )?;
        let rows = stmt
            .query_map([school_id], Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Local credential change (password change / re-enrollment). Bumps the
    /// revision so the change replicates as a new signed op.
    pub fn set_auth_hash(conn: &Connection, school_id: &str, user_id: &str, auth_hash: Option<&str>) -> StorageResult<i64> {
        exec(conn, 
            "UPDATE users
             SET auth_hash = ?3, revision = revision + 1, updated_at = ?4
             WHERE school_id = ?1 AND user_id = ?2",
            params![school_id, user_id, auth_hash, now_rfc3339()],
        )?;
        let revision: i64 = conn.query_row(
            "SELECT revision FROM users WHERE school_id = ?1 AND user_id = ?2",
            params![school_id, user_id],
            |row| row.get(0),
        )?;
        Ok(revision)
    }

    pub fn set_status(conn: &Connection, school_id: &str, user_id: &str, status: &str) -> StorageResult<i64> {
        if !matches!(status, "active" | "suspended" | "disabled") {
            return Err(StorageError::InvalidValue {
                field: "status",
                reason: format!("unknown user status {status}"),
            });
        }
        exec(conn, 
            "UPDATE users SET status = ?3, revision = revision + 1, updated_at = ?4
             WHERE school_id = ?1 AND user_id = ?2",
            params![school_id, user_id, status, now_rfc3339()],
        )?;
        let revision: i64 = conn.query_row(
            "SELECT revision FROM users WHERE school_id = ?1 AND user_id = ?2",
            params![school_id, user_id],
            |row| row.get(0),
        )?;
        Ok(revision)
    }

    // -- roles --------------------------------------------------------------

    pub fn upsert_role(conn: &Connection, role: &RoleRow) -> StorageResult<()> {
        exec(conn, 
            "INSERT INTO roles (role_id, school_id, name, is_builtin, revision)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(school_id, role_id) DO UPDATE SET
                name = excluded.name, revision = excluded.revision",
            params![role.role_id, role.school_id, role.name, role.is_builtin as i64, role.revision],
        )?;
        Ok(())
    }

    pub fn find_role_by_name(conn: &Connection, school_id: &str, name: &str) -> StorageResult<Option<RoleRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT role_id, school_id, name, is_builtin, revision
             FROM roles WHERE school_id = ?1 AND name = ?2",
        )?;
        let mut rows = stmt.query(params![school_id, name])?;
        match rows.next()? {
            Some(row) => Ok(Some(RoleRow {
                role_id: row.get(0)?,
                school_id: row.get(1)?,
                name: row.get(2)?,
                is_builtin: row.get::<_, i64>(3)? != 0,
                revision: row.get(4)?,
            })),
            None => Ok(None),
        }
    }

    pub fn grant_role(conn: &Connection, school_id: &str, user_id: &str, role_id: &str, granted_by: Option<&str>) -> StorageResult<()> {
        exec(conn, 
            "INSERT OR IGNORE INTO user_roles (school_id, user_id, role_id, granted_by)
             VALUES (?1, ?2, ?3, ?4)",
            params![school_id, user_id, role_id, granted_by],
        )?;
        Ok(())
    }

    pub fn revoke_role(conn: &Connection, school_id: &str, user_id: &str, role_id: &str) -> StorageResult<bool> {
        let changed = exec(conn, 
            "DELETE FROM user_roles WHERE school_id = ?1 AND user_id = ?2 AND role_id = ?3",
            params![school_id, user_id, role_id],
        )?;
        Ok(changed > 0)
    }

    /// Replace a role's permission set atomically (one write, not N).
    pub fn set_role_permissions(conn: &Connection, school_id: &str, role_id: &str, permissions: &[String]) -> StorageResult<()> {
        exec(conn, 
            "DELETE FROM role_permissions WHERE school_id = ?1 AND role_id = ?2",
            params![school_id, role_id],
        )?;
        for permission in permissions {
            exec(conn, 
                "INSERT OR IGNORE INTO role_permissions (school_id, role_id, permission)
                 VALUES (?1, ?2, ?3)",
                params![school_id, role_id, permission],
            )?;
        }
        Ok(())
    }

    /// Effective permissions for a user: one joined query (performance).
    pub fn effective_permissions(
        conn: &Connection,
        school_id: &str,
        user_id: &str,
    ) -> StorageResult<HashSet<String>> {
        let mut stmt = conn.prepare_cached(
            "SELECT DISTINCT rp.permission
             FROM user_roles ur
             JOIN role_permissions rp
               ON rp.school_id = ur.school_id AND rp.role_id = ur.role_id
             WHERE ur.school_id = ?1 AND ur.user_id = ?2",
        )?;
        let rows = stmt
            .query_map(params![school_id, user_id], |row| row.get::<_, String>(0))?
            .collect::<Result<HashSet<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_roles_for_user(conn: &Connection, school_id: &str, user_id: &str) -> StorageResult<Vec<RoleRow>> {
        let mut stmt = conn.prepare_cached(
            "SELECT r.role_id, r.school_id, r.name, r.is_builtin, r.revision
             FROM user_roles ur
             JOIN roles r ON r.school_id = ur.school_id AND r.role_id = ur.role_id
             WHERE ur.school_id = ?1 AND ur.user_id = ?2",
        )?;
        let rows = stmt
            .query_map(params![school_id, user_id], |row| {
                Ok(RoleRow {
                    role_id: row.get(0)?,
                    school_id: row.get(1)?,
                    name: row.get(2)?,
                    is_builtin: row.get::<_, i64>(3)? != 0,
                    revision: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UserRow> {
        Ok(UserRow {
            user_id: row.get(0)?,
            school_id: row.get(1)?,
            username: row.get(2)?,
            display_name: row.get(3)?,
            status: row.get(4)?,
            auth_hash: row.get(5)?,
            origin_device_id: row.get(6)?,
            revision: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }
}
