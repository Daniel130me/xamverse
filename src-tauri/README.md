# XamVerse desktop shell (src-tauri)

Tauri 2 scaffold of the Windows/macOS/Linux desktop application. **This is a
scaffold**: it builds a real windowed app and proves the packaging pipeline,
but the engine embedding and the real UI bundle are Phase 3 work
(`PHASE2_COMPLETION_REPORT.md` §5.3, §6).

## What exists

- `src/lib.rs` — window bootstrap + `shell_status` / `shell_ping` commands
  (honest shell-state only; no fake engine responses)
- `tauri.conf.json` — dev points at the Next dev server (`localhost:3000`),
  production at the Phase 3 static export (placeholder `scaffold-dist/`)
- `capabilities/default.json` — allow-deny capability list (`core:default`)
- Restrictive CSP; `unsafe-inline` styles only (Tauri/Next injected styles)
- Mirrored lint policy (`unsafe_code = "forbid"`, clippy unwrap/expect warn)
  because an excluded package cannot inherit the workspace lints

## What does NOT exist yet (Phase 3, deliberately not faked)

- `xamverse-core::Engine` embedding + `engine_<namespace>_<op>` command set
  (`ENGINE_API.md` is the contract; the SDK desktop adapter calls it 1:1)
- OS-keychain `SecureKeyStore` injection (`KNOWN_LIMITATIONS.md` §12)
- Static UI export pipeline (`PHASE3_INTEGRATION_GUIDE.md`)
- Installer bundling + code signing (`UPDATES_AND_INSTALLERS.md` §7)
- Icons (bundle.icon is empty; `bun x @tauri-apps/cli icon <png>` generates
  the full set when branding lands)

## Run (requires a desktop toolchain — not a headless container)

```bash
# dev against the Next.js dev server
cd src-tauri && bun x @tauri-apps/cli dev

# scaffold build (no installers)
bun x @tauri-apps/cli build --no-bundle
```

Linux prerequisites: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`.
The `desktop.yml` workflow builds the scaffold on Windows/macOS runners
(dispatch-only, non-blocking until the shell ships).
