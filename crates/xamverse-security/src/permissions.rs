//! Reserved engine permissions and builtin role seeds.
//!
//! Permissions are plain strings so schools and Phase 3 can define more
//! (`assessments.approve`, `results.release`, ...) without engine changes.
//! The engine only fixes the namespace of *infrastructure* permissions that
//! the engine itself enforces — everything else is data.

/// Infrastructure permissions enforced by the engine itself.
pub mod reserved {
    pub const DEVICES_PAIR: &str = "devices.pair";
    pub const DEVICES_REVOKE: &str = "devices.revoke";
    pub const SYNC_READ: &str = "sync.read";
    pub const SYNC_WRITE: &str = "sync.write";
    pub const SYNC_DISTRIBUTE: &str = "sync.distribute";
    pub const SYNC_COLLECT: &str = "sync.collect";
    pub const SYNC_RESOLVE_CONFLICT: &str = "sync.resolve_conflict";
    pub const LICENCE_MANAGE: &str = "licence.manage";
    pub const UPDATES_MANAGE: &str = "updates.manage";
    pub const BACKUPS_MANAGE: &str = "backups.manage";
    pub const AUDIT_VIEW: &str = "audit.view";
    pub const IDENTITY_MANAGE: &str = "identity.manage";
    pub const SESSIONS_REVOKE: &str = "sessions.revoke";
    pub const USERS_MANAGE: &str = "users.manage";

    /// Every reserved permission (used by the builtin `owner` role).
    pub const ALL: &[&str] = &[
        DEVICES_PAIR,
        DEVICES_REVOKE,
        SYNC_READ,
        SYNC_WRITE,
        SYNC_DISTRIBUTE,
        SYNC_COLLECT,
        SYNC_RESOLVE_CONFLICT,
        LICENCE_MANAGE,
        UPDATES_MANAGE,
        BACKUPS_MANAGE,
        AUDIT_VIEW,
        IDENTITY_MANAGE,
        SESSIONS_REVOKE,
        USERS_MANAGE,
    ];
}

/// Builtin role names. Schools may add custom roles at will.
pub mod builtin_roles {
    pub const OWNER: &str = "owner";
    pub const ADMIN: &str = "admin";
    pub const TEACHER: &str = "teacher";
    pub const STUDENT: &str = "student";
}

/// Permission sets for the builtin roles, seeded per school at enrollment.
/// Teachers deliberately receive no *infrastructure* permissions — exam
/// content flows are Phase 3 domain permissions. This keeps the security
/// boundary boring: infrastructure changes are admin/owner work.
pub fn builtin_role_permissions(role: &str) -> Vec<&'static str> {
    match role {
        builtin_roles::OWNER => reserved::ALL.to_vec(),
        builtin_roles::ADMIN => reserved::ALL
            .iter()
            .copied()
            .filter(|p| *p != reserved::LICENCE_MANAGE) // licensing is owner/finance territory
            .collect(),
        builtin_roles::TEACHER => vec![reserved::SYNC_READ, reserved::SYNC_WRITE],
        builtin_roles::STUDENT => vec![],
        _ => vec![],
    }
}
