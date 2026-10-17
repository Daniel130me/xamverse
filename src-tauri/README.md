# XamVerse desktop runtime

The Tauri 2 application embeds the same `xamverse-core::Engine` used by the
headless peer CLI. A single process owns the encrypted database, peer listener,
sync runner, LAN browser bridge and desktop IPC boundary.

## Security and lifecycle

- Database and device secrets are stored in Windows Credential Manager or
  macOS Keychain through `PlatformKeyStore`.
- Privileged IPC commands authenticate the active desktop token and resolve
  RBAC from the live database on every call. UI permission checks are never
  treated as authorization.
- A fresh installation can create its first school and owner through the
  local-only `auth.bootstrap` command. The operation is atomic and is disabled
  permanently as soon as any school exists; it is not exposed over the LAN.
- Pairing, revocation, licence import, backup creation and update import/stage
  require a recently authenticated session in addition to their permission.
- Engine events are forwarded on `engine-event`; the SDK replays recent history
  before switching to the live stream and removes duplicates across the race.
- The browser bridge starts on port `47811` and serves the same static frontend
  embedded in the desktop package. Peer traffic remains on port `47810`.
- Application exit signals the browser bridge and stops peer/discovery/sync
  services before the process closes.

## Build

Prerequisites: Node.js, Rust, platform C++ build tools, and the Tauri platform
dependencies.

```bash
npm install
npm run desktop:prepare
cd src-tauri
npx @tauri-apps/cli build --bundles msi   # Windows
npx @tauri-apps/cli build --bundles dmg   # macOS
```

The installer workflow also builds and uploads MSI and DMG artifacts. Public
release installers still require the repository owner's Windows signing and
Apple Developer/notarization credentials; unsigned artifacts are intended only
for controlled development testing.

## Production key configuration

Issuer and update signing public keys are compiled from comma-separated build
environment variables:

- `XAMVERSE_ISSUER_PUBLIC_KEYS`
- `XAMVERSE_RELEASE_PUBLIC_KEYS`

Empty values intentionally leave activation/update imports unable to trust a
production issuer. Never embed private signing keys in the application.

## Known deployment gate

LAN browser access is currently HTTP-only. It is appropriate for an isolated
test LAN, but production browser deployment requires the documented TLS
certificate provisioning and trust-onboarding flow. This is not hidden or
weakened with a permissive certificate workaround.
