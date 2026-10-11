# ExamHub — DESIGN_SYSTEM.md

## 1. Design principles
1. Clean, uncluttered enterprise UI that a non-technical school administrator can operate.
2. One restrained primary colour; status colours carry meaning; neutrals do the work.
3. Every primary action produces visible state change; no dead buttons.
4. Decentralization is always visible: screens state which computer's local data is shown.
5. Desktop-first (≥1280px) with responsive behaviour down to tablet widths.

## 2. Colour tokens (CSS variables, light & dark)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--background` | white | near-black | App background |
| `--card` | white | dark card | Cards, tables, dialogs |
| `--primary` | teal ~`oklch(0.55 0.13 170)` (emerald-teal family) | lighter teal | Primary buttons, active nav, focus rings, brand |
| `--secondary` / `--muted` / `--accent` | neutral grays | dark grays | Secondary surfaces |
| `--destructive` | red | red | Destructive actions, errors |
| `--border` / `--input` / `--ring` | gray borders | dark borders | Structure & focus |

Status tones (mapped centrally in `statusTone()` + `StatusBadge`):

| Tone | Meaning | Examples |
|---|---|---|
| success (emerald) | healthy / done / approved | approved, distributed, completed, published, online, healthy |
| warning (amber) | attention / pending | pending_approval, blocked_offline, grace_period, flagged |
| danger (red) | failure / denied | rejected, failed, expired, unauthorized_attempt, offline |
| progress (violet) | in-flight | distributing, transferring, marking, conflict |
| info (sky) | informational | queued, scheduled |
| neutral | dormant | draft, archived, inactive |

Charts use the palette: `#0d9488` (primary data), `#f59e0b`, `#8b5cf6`, `#ef4444`, `#0ea5e9`, `#84cc16`.

**Simulation chrome**: the Device Simulator bar is intentionally violet (`border-violet-400`, `SIMULATION` chip) so demo controls can never be mistaken for product UI.

## 3. Typography
- Font: **Geist Sans** (`--font-geist-sans`), Geist Mono for code/IDs/timers.
- Scale: page titles `text-xl/2xl font-semibold tracking-tight`; section titles `text-sm font-semibold`; body `text-sm`; meta/labels `text-xs`; uppercase micro-labels `text-[10px] tracking-wider uppercase text-muted-foreground`.
- Numeric data is `tabular-nums`; monospace for device IDs, IPs, hashes, timers.

## 4. Spacing & shape
- Radius: `--radius: 0.625rem`; cards/inputs follow shadcn tokens; chips/pills fully rounded.
- Page padding `px-3 lg:px-6`, card interiors `p-4 lg:p-5`, grid gaps `gap-3/gap-4`.
- Sticky header (h-14) + fixed simulator bar; main content bottom-padded to clear it.

## 5. Layout patterns
- **App shell**: collapsible sidebar (w-60 / w-14, groups with uppercase labels, active = primary tint), header (breadcrumbs, LAN chip, notifications with unread count, theme toggle, user menu), content area, simulator bar.
- **PageHeader**: optional breadcrumb trail, icon chip, title, description, right-aligned actions.
- **StatCard**: label (uppercase), large value, sub-line, icon chip in tone colour, optional click-through + keyboard accessible.
- **DataTable**: search, column sort, dropdown filters, pagination footer, row selection with bulk actions, click-through rows, empty states.
- **SectionCard**: titled content block used for dashboard panels and forms.
- **StatusBadge**: dot + label pill for every status across the app.
- **TransferProgress**: mini bar with mock MB/s readout.
- **Dialogs**: confirmation flows (submit exam, release results, revoke, restore) always restate consequences.
- **EmptyState / AccessDenied / Loading**: consistent illustrations of "why" plus next action.

## 6. Components (shadcn/ui, New York style)
button, badge, card, input, textarea, label, checkbox, radio-group, select, switch, tabs, table, dialog, dropdown-menu, separator, progress, scroll-area, avatar, tooltip, sonner toaster (bottom-right, rich colours).

Custom shared primitives live in `src/components/prototype/shared/ui-kit.tsx`: `PageHeader`, `StatCard`, `SectionCard`, `DataTable`, `StatusBadge`, `UserAvatar`, `EmptyState`, `AccessDenied`, `Loading`, `TransferProgress`.

## 7. Interaction rules
- Destructive or irreversible actions (release results, revoke pairing, reset demo, submit exam) require a confirmation dialog that restates the effect.
- Every action raises a sonner toast describing what happened and (where relevant) what will sync.
- Transfers progress on a global 900 ms tick; blocked transfers auto-resume on reconnection.
- Forms validate on submit with inline error lists; errors reference the exact fix.
- Keyboard: all interactive elements are real `<button>`/inputs with focus rings; StatCard exposes `role="button"` + Enter/Space handling.

## 8. Accessibility
- Semantic landmarks: `aside` (nav), `header`, `main`, `nav[aria-label]` breadcrumbs.
- `aria-label`s on icon-only controls (notifications, theme, palette toggles, device/user switchers).
- `aria-current="page"` on the active nav item; `aria-expanded` on dropdown triggers; `aria-pressed` on toggles.
- Colour is never the only signal (badges include text; dots accompany labels).
- Focus-visible rings via the shadcn token; touch targets ≥ 40px on primary controls.
- Dark mode via `next-themes` (class strategy) with the same semantic tokens.

## 9. Responsiveness
- Sidebar hidden below `lg`; a slide-over mobile nav replaces it.
- Stat grids collapse 4 → 2 columns; dashboard panels stack to one column.
- Tables scroll horizontally inside a rounded container.
- The exam palette collapses to a floating button + sheet on small screens.
- The simulator bar wraps; secondary controls hide on narrow screens but remain available via "More…".

## 10. Voice & terminology
- "Computers & Sync" (never "Server Management"); "peer"; "this computer"; "delivered to this computer".
- Plain-language explanations under every technical setting (ports, discovery, encryption).
- Simulation honesty: "simulated", "(mock)", "Phase 1 prototype" labels appear on security/licensing/AI surfaces and in the footer/help.
