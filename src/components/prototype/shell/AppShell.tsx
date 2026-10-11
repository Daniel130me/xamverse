'use client';

/**
 * AppShell — sidebar + header + device simulator bar.
 * Role-aware navigation. Contextual, collapsible, responsive.
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { NAV_GROUPS } from './nav-config';
import { ROLE_LABELS, fmtRelative } from '@/lib/prototype/ui-utils';
import { UserAvatar } from '../shared/ui-kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard, School, CalendarRange, Network, BookOpen, Users, GraduationCap, UserCog, ShieldCheck, Layers,
  Sparkles, FileText, Stamp, MonitorPlay, ClipboardCheck, BarChart3, MonitorSmartphone, RefreshCcw, GitMerge, Bell,
  KeyRound, PackageCheck, DatabaseBackup, ScrollText, Settings, LifeBuoy, PanelLeftClose, PanelLeftOpen, LogOut,
  Lock, UserCircle, ChevronDown, Moon, Sun, Radio, Wifi, WifiOff, Plus, CircleDot, Maximize2, X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, School, CalendarRange, Network, BookOpen, Users, GraduationCap, UserCog, ShieldCheck, Layers,
  Sparkles, FileText, Stamp, MonitorPlay, ClipboardCheck, BarChart3, MonitorSmartphone, RefreshCcw, GitMerge, Bell,
  KeyRound, PackageCheck, DatabaseBackup, ScrollText, Settings, LifeBuoy,
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const store = useDemoStore();
  const { sidebarCollapsed, toggleSidebar, route } = store;
  const user = store.currentUser();
  const device = store.currentDevice();

  // permission filtering — recomputed per render (cheap; store subscription triggers re-render)
  const canSee = (p: string | string[] | undefined) => !p || (Array.isArray(p) ? p.some((x) => store.can(x as never)) : store.can(p as never));
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => canSee(it.permission)),
  })).filter((g) => g.items.length > 0);

  const unread = device ? store.local().notifications.filter((n) => !n.read).length : 0;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex-col border-r bg-sidebar transition-all duration-200 lg:static ${sidebarCollapsed ? 'w-14' : 'w-60'} hidden lg:flex`}
        aria-label="Main navigation"
      >
        <div className="flex h-14 items-center gap-2 border-b px-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground text-sm">E</div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">ExamHub</p>
              <p className="truncate text-[10px] text-muted-foreground">{device?.name}</p>
            </div>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={toggleSidebar} aria-label="Toggle sidebar">
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {groups.map((g) => (
            <div key={g.label}>
              {!sidebarCollapsed && <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>}
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const Icon = ICONS[item.icon] ?? CircleDot;
                  const active = route.path === item.path || (item.path !== '/app/dashboard' && route.path.startsWith(item.path));
                  let badgeCount = 0;
                  if (item.badgeKey) {
                    const local = store.local();
                    if (item.badgeKey === 'approvals') badgeCount = local.approvalRequests.filter((r) => r.status === 'pending').length;
                    if (item.badgeKey === 'conflicts') badgeCount = local.conflicts.filter((c) => c.status === 'open').length;
                    if (item.badgeKey === 'notifications') badgeCount = unread;
                  }
                  return (
                    <li key={item.path}>
                      <button
                        onClick={() => store.navigate(item.path)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/80'}`}
                        title={item.label}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {!sidebarCollapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {!sidebarCollapsed && badgeCount > 0 && (
                          <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{badgeCount}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        {!sidebarCollapsed && (
          <div className="border-t p-3 text-[10px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground/70">Peer computer</p>
            <p>ID {device?.id} · {device?.ip}:{device?.port}</p>
            <p className="mt-1">Every installation is an independent peer. Nothing here is production-secure.</p>
          </div>
        )}
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur lg:px-5">
          {/* mobile nav */}
          <MobileNav />
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1.5">
            <NetworkStatusChip />
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Notifications" onClick={() => store.navigate('/app/notifications')}>
              <Bell className="h-4 w-4" />
              {unread > 0 && <span className="absolute -mt-3 ml-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unread}</span>}
            </Button>
            <ThemeToggle />
            {user && <UserMenu />}
          </div>
        </header>
        <main className="flex-1 px-3 pb-24 pt-4 lg:px-6 lg:pb-20">{children}</main>
        <SimulatorBar />
      </div>
    </div>
  );
}

function Breadcrumbs() {
  const route = useDemoStore((s) => s.route);
  const parts = route.path.split('/').filter(Boolean);
  const label = (p: string) => p.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  if (parts.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground md:flex">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="opacity-40">/</span>}
          <span className={i === parts.length - 1 ? 'font-medium text-foreground' : ''}>{label(p).replace('App', 'Home')}</span>
        </span>
      ))}
    </nav>
  );
}

function NetworkStatusChip() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const lan = store.world.network.lanOnline;
  const online = lan && device?.online;
  return (
    <button
      onClick={() => { store.toggleNetwork(); toast(lan ? 'LAN disconnected (simulated)' : 'LAN reconnected (simulated)', { description: lan ? 'All peer transfers pause until the network is restored.' : 'Peer transfers resume automatically.' }); }}
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors sm:flex ${online ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'}`}
      title="Click to simulate LAN offline / online"
    >
      {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {online ? 'LAN online' : 'LAN offline'}
    </button>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  );
}

function UserMenu() {
  const store = useDemoStore();
  const user = store.currentUser()!;
  const [pwdOpen, setPwdOpen] = React.useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring" aria-label="User menu">
          <UserAvatar name={user.name} hue={user.avatarHue} size="sm" />
          <div className="hidden text-left md:block">
            <p className="max-w-36 truncate text-xs font-medium leading-tight">{user.name}</p>
            <p className="text-[10px] text-muted-foreground">{ROLE_LABELS[user.role]}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
          <p className="mt-1 text-[10px] font-normal text-muted-foreground">{ROLE_LABELS[user.role]} · session on {store.activeDeviceId}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => store.navigate('/app/account')}><UserCircle className="mr-2 h-4 w-4" /> My profile</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPwdOpen(true)}><Lock className="mr-2 h-4 w-4" /> Change password</DropdownMenuItem>
        <DropdownMenuItem onClick={() => { store.lockSession(); toast('Session locked', { description: 'Re-authenticate to unlock.' }); }}><Lock className="mr-2 h-4 w-4" /> Lock session</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => store.logout()} className="text-red-600 focus:text-red-600"><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </DropdownMenu>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [done, setDone] = React.useState(false);
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => onOpenChange(false)}>
          <div className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold">Change password</h2>
            <p className="mt-1 text-xs text-muted-foreground">Demo only — no real credential is stored. Authentication in production is handled by the desktop engine (Phase 2).</p>
            <div className="mt-3 space-y-2">
              <Input placeholder="Current password" type="password" aria-label="Current password" />
              <Input placeholder="New password (min 8 chars)" type="password" aria-label="New password" />
              <Input placeholder="Confirm new password" type="password" aria-label="Confirm password" />
            </div>
            {done && <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Password updated (simulated).</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="sm" onClick={() => { setDone(true); setTimeout(() => { onOpenChange(false); setDone(false); }, 900); }}>Update</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileNav() {
  const store = useDemoStore();
  const [open, setOpen] = React.useState(false);
  const user = store.currentUser();
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => !it.permission || (Array.isArray(it.permission) ? it.permission.some((p) => store.can(p as never)) : store.can(it.permission as never))) })).filter((g) => g.items.length > 0);
  return (
    <div className="lg:hidden">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(true)} aria-label="Open navigation">
        <PanelLeftOpen className="h-4 w-4" />
      </Button>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)}>
          <div className="h-full w-64 overflow-y-auto border-r bg-background p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">ExamHub</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close navigation"><X className="h-4 w-4" /></Button>
            </div>
            {groups.map((g) => (
              <div key={g.label} className="mb-3">
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase text-muted-foreground">{g.label}</p>
                {g.items.map((item) => {
                  const Icon = ICONS[item.icon] ?? CircleDot;
                  return (
                    <button key={item.path} onClick={() => { store.navigate(item.path); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                      <Icon className="h-4 w-4" /> {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
            {user && (
              <Button variant="outline" className="mt-2 w-full" size="sm" onClick={() => { store.logout(); setOpen(false); }}><LogOut className="mr-2 h-4 w-4" /> Sign out</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Device Simulator Bar — the demo control strip
// ============================================================

export function SimulatorBar() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const user = store.currentUser();
  const [expanded, setExpanded] = React.useState(false);
  const gfDevices = Object.values(store.world.devices).filter((d) => d.schoolId === device?.schoolId);

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-violet-400 bg-violet-50/95 backdrop-blur dark:border-violet-700 dark:bg-violet-950/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
        <span className="flex items-center gap-1 rounded bg-violet-600 px-1.5 py-0.5 font-bold text-white"><Radio className="h-3 w-3" /> SIMULATION</span>

        {/* device switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring" aria-label="Switch simulated computer">
              <MonitorSmartphone className="h-3.5 w-3.5 text-violet-600" />
              <span className="font-medium">{device?.name}</span>
              <span className="text-muted-foreground">({store.activeDeviceId})</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
            <DropdownMenuLabel>Switch active simulated computer</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {['DEV-001', 'DEV-005', 'DEV-008', 'DEV-011', 'DEV-017', 'DEV-022', 'DEV-024', 'DEV-026', 'DEV-043', 'DEV-090'].map((id) => (
              <SimDeviceRow key={id} deviceId={id} />
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Lab computers (DEV-061 – DEV-100)</DropdownMenuLabel>
            {gfDevices.filter((d) => d.index >= 61 && d.index <= 70).map((d) => (
              <SimDeviceRow key={d.id} deviceId={d.id} />
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => store.navigate('/app/computers')}>See all 103 computers →</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* user switcher */}
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 hover:bg-accent" aria-label="Switch demo user">
                <UserAvatar name={user.name} hue={user.avatarHue} size="sm" />
                <span className="hidden font-medium sm:inline">{user.name}</span>
                <span className="text-muted-foreground hidden md:inline">· {ROLE_LABELS[user.role]}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Switch demo user (no passwords needed)</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DemoUserRow userId="u-admin" />
              <DemoUserRow userId="u-admin2" />
              <DemoUserRow userId="u-proprietor" />
              <DemoUserRow userId="u-exoff" />
              <DemoUserRow userId="u-teacher-math" />
              <DemoUserRow userId="u-teacher-eng" />
              <DemoUserRow userId="u-hod-grace" />
              <DemoUserRow userId="u-invig" />
              <DemoUserRow userId="stu-amina" />
              <DemoUserRow userId="par-1" />
              <DemoUserRow userId="u-support" />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="rounded-md border border-dashed px-2 py-1 text-muted-foreground">No user signed in on this computer</span>
        )}

        {/* network toggle */}
        <button
          onClick={() => store.toggleNetwork()}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 font-medium ${store.world.network.lanOnline ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' : 'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900 dark:text-red-200'}`}
          aria-pressed={!store.world.network.lanOnline}
        >
          {store.world.network.lanOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          LAN {store.world.network.lanOnline ? 'online' : 'offline'}
        </button>

        {/* device power toggle */}
        <button
          onClick={() => store.setDeviceOnline(store.activeDeviceId, !device?.online)}
          className={`hidden items-center gap-1 rounded-md border px-2 py-1 font-medium sm:flex ${device?.online ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' : 'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900 dark:text-red-200'}`}
        >
          <CircleDot className="h-3.5 w-3.5" />
          This PC {device?.online ? 'online' : 'offline'}
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-6 border-violet-300 px-2 text-[11px] text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:text-violet-300" onClick={() => store.setWalkthroughOpen(true)}>
            <Maximize2 className="mr-1 h-3 w-3" /> Guided scenario
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? 'Hide' : 'More'}…
          </Button>
          <Button
            variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-red-600 hover:text-red-700"
            onClick={() => { if (confirm('Reset the entire demonstration? All simulated changes will be discarded.')) { store.resetDemo(); toast('Demo reset'); } }}
          >
            Reset demo
          </Button>
        </div>

        {expanded && (
          <div className="w-full border-t border-violet-200 pt-2 dark:border-violet-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Load predefined scenario:</span>
              {([
                ['fresh', '1. Fresh start (exam is a draft on DEV-017)'],
                ['approved', '2. Exam approved (ready to distribute)'],
                ['distributed', '3. Distributed to all 100 computers'],
                ['collected', '4. Results collected 97/100 (3 outstanding)'],
                ['released', '5. Results released to students'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => { store.loadScenario(key); toast(`Scenario loaded: ${label}`); }} className="rounded-md border bg-background px-2 py-1 hover:bg-accent">
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Simulator note: each computer keeps its own independent local records. Data only appears on another computer after a simulated transfer completes.
              Storage on this device: {device ? `${(device.storageUsedMb / 1024).toFixed(1)} GB of ${(device.storageTotalMb / 1024).toFixed(0)} GB used` : '—'} · Last sync {fmtRelative(store.local()?.lastSyncAt)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SimDeviceRow({ deviceId }: { deviceId: string }) {
  const store = useDemoStore();
  const d = store.world.devices[deviceId];
  if (!d) return null;
  const active = store.activeDeviceId === deviceId;
  return (
    <DropdownMenuItem onClick={() => { store.switchDevice(deviceId); toast(`Switched to ${d.name} (${deviceId})`, { description: 'Previous session ended — sign in again on this computer.' }); }}>
      <span className="flex w-full items-center justify-between gap-2">
        <span className="truncate">{d.name} <span className="text-muted-foreground">{d.id}</span></span>
        <span className="flex items-center gap-1.5">
          {!d.paired && <span className="rounded bg-amber-100 px-1 text-[9px] text-amber-700 dark:bg-amber-900 dark:text-amber-300">unpaired</span>}
          <span className={`h-2 w-2 rounded-full ${d.online && store.world.network.lanOnline ? 'bg-emerald-500' : 'bg-red-400'}`} />
        </span>
      </span>
      {active && <span className="ml-1 text-violet-600">●</span>}
    </DropdownMenuItem>
  );
}

function DemoUserRow({ userId }: { userId: string }) {
  const store = useDemoStore();
  const u = store.world.users[userId];
  if (!u || u.schoolId !== store.currentDevice().schoolId) return null;
  return (
    <DropdownMenuItem onClick={() => { store.switchUser(userId); toast(`Signed in as ${u.name}`, { description: `${ROLE_LABELS[u.role]} · on ${store.activeDeviceId}` }); }}>
      <span className="flex items-center gap-2">
        <UserAvatar name={u.name} hue={u.avatarHue} size="sm" />
        <span>
          <span className="block text-xs font-medium">{u.name}</span>
          <span className="block text-[10px] text-muted-foreground">{u.demoLabel ?? ROLE_LABELS[u.role]}</span>
        </span>
      </span>
    </DropdownMenuItem>
  );
}
