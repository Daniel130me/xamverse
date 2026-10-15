# ADR-0001 — Cargo workspace crate decomposition

Status: accepted (2026-10, Phase 2)

## Context
The engine spans storage, identity, security, networking, sync, licensing,
backup, updates, a web bridge and a facade. One crate would couple everything
and make partial testing impossible; a microservice split would violate the
"one autonomous desktop node" model.

## Decision
One Cargo workspace, thirteen library crates plus two tool binaries
(`xamverse-peer`, `license-issuer-dev`). Dependencies flow strictly:

`events`, `storage` → `identity`, `audit`, `security`, `network`,
`discovery` → `sync`, `licensing`, `backup`, `updater`, `web` → `core` → tools.

The Tauri shell (`src-tauri/`) is excluded from the workspace because it needs
GUI system libraries absent on headless build machines; dedicated CI jobs
build and bundle it.

## Consequences
* Every crate compiles and tests independently; CI can gate per-crate.
* The engine is embeddable as a library (Tauri) *and* runnable headless (CLI)
  from the same code — a hard requirement for Tests A–J.
* Version bumps of internal crates are one-line changes in the workspace
  dependency table.
