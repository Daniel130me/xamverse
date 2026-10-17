//! Shell library: window bootstrap + the two scaffold commands.
//!
//! The commands below are the smallest honest surface: they report shell
//! state without pretending the engine is embedded. Phase 3 replaces them
//! with the full `engine_<namespace>_<op>` command set from ENGINE_API.md —
//! the SDK's desktop adapter already calls that exact naming scheme, so the
//! swap is additive (old commands removed, engine commands added).

use serde::Serialize;

/// Info about the shell build itself (not the engine — engine status is an
/// engine command, and pretending otherwise would hide integration bugs).
#[derive(Serialize)]
pub struct ShellStatus {
    pub shell_version: String,
    /// Protocol major the shell is written against (must match
    /// xamverse-identity's PROTOCOL_VERSION_MAJOR = 1).
    pub protocol_major: u32,
    /// Whether the engine is embedded — false until Phase 3; the UI uses
    /// this to show an honest "not connected" state instead of guessing.
    pub engine_embedded: bool,
}

/// `engine_status` placeholder kept at the SDK-compatible name so the
/// frontend can call it before Phase 3 lands the real diagnostics command.
/// NOTE(scaffold): intentionally DIFFERENT semantics from the real
/// `engine_diagnostics_status` — flagged here and in ENGINE_API.md.
#[tauri::command]
pub fn shell_status() -> ShellStatus {
    ShellStatus {
        shell_version: env!("CARGO_PKG_VERSION").to_string(),
        protocol_major: 1,
        engine_embedded: false,
    }
}

/// Forward page-level notices to the audit trail later; scaffold no-op that
/// proves the IPC round-trip works end to end.
#[tauri::command]
pub fn shell_ping(nonce: String) -> String {
    format!("pong:{nonce}")
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![shell_status, shell_ping])
        .run(tauri::generate_context!())
        // A shell that cannot start its window has nothing left to do;
        // this is the one acceptable exit-with-error point.
        .expect("error while running tauri application");
}
