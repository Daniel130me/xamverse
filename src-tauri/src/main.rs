//! XamVerse desktop shell — Tauri 2 scaffold.
//!
//! SCAFFOLD SCOPE (see src-tauri/Cargo.toml header and
//! PHASE2_COMPLETION_REPORT §5.3): a buildable, windowed shell that proves
//! the packaging pipeline. It does NOT embed the engine yet — Phase 3 does
//! that via `xamverse-core::Engine::init` (see PHASE3_INTEGRATION_GUIDE.md),
//! with the command surface from ENGINE_API.md and the OS-keychain
//! SecureKeyStore injection.
//!
//! The frontend is the Next.js app: dev mode points at the dev server
//! (devUrl), production at the static export produced by the Phase 3 bundle
//! pipeline (frontendDist placeholder until then).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xamverse_shell_lib::run();
}
