//! Offline authentication, sessions and RBAC for the XamVerse engine.
//!
//! Layering: `permissions` (constants) → `auth` (credentials/sessions) →
//! `rbac` (enforcement helpers). Everything above the storage layer; no
//! networking here — the web bridge and Tauri shell call into this crate.

// Tests read far better with unwrap/expect; the lint stays enforced
// for library code — this exemption is scoped to cfg(test) only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod auth;
pub mod permissions;
pub mod rbac;

pub use auth::{
    hash_password, hash_token, AuthConfig, AuthError, AuthService, SessionContext, SessionKind,
};
pub use permissions::{builtin_role_permissions, builtin_roles, reserved};
pub use rbac::{require_with_conn, Authz};

/// Convenience re-export: seeding builtin roles for a freshly enrolled school.
pub use auth::seed_builtin_roles;
