'use client';

/**
 * DemoDock — discreet floating control for evaluating the prototype.
 * Collapsed to a small pill by default so the app reads like the real product.
 * Expands into a compact panel for switching user/role, computer, network
 * state, scenario presets and the guided walkthrough.
 * Overlays are portaled to <body> to avoid the header's backdrop-filter
 * containing-block trap.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useDemoStore } from '@/lib/prototype/store';
import { ROLE_LABELS } from '@/lib/prototype/ui-utils';
import { UserAvatar } from '../shared/ui-kit';
import { Button } from '@/components/ui/button';
import {
  FlaskConical, X, UserRound, MonitorSmartphone, Wifi, WifiOff, CircleDot,
  RotateCcw, Play, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';

const DEMO_USER_IDS = ['u-admin', 'u-admin2', 'u-proprietor', 'u-exoff', 'u-teacher-math', 'u-teacher-eng', 'u-hod-grace', 'u-invig', 'stu-amina', 'par-1', 'u-support'];
const DEMO_DEVICE_IDS = ['DEV-001', 'DEV-005', 'DEV-008', 'DEV-011', 'DEV-017', 'DEV-022', 'DEV-024', 'DEV-026', 'DEV-043', 'DEV-090'];
const SCENARIOS: { key: 'fresh' | 'approved' | 'distributed' | 'collected' | 'released'; label: string; desc: string }[] = [
  { key: 'fresh', label: '1 · Fresh start', desc: 'Mid-term exam is a draft on DEV-017' },
  { key: 'approved', label: '2 · Approved', desc: 'Exam approved, ready to distribute' },
  { key: 'distributed', label: '3 · Distributed', desc: 'Package reached all 100 computers' },
  { key: 'collected', label: '4 · Collected 97/100', desc: '3 results still outstanding' },
  { key: 'released', label: '5 · Released', desc: 'Students and parents can see results' },
];

function SectionTitle({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3 w-3" /> {children}
    </p>
  );
}

export function DemoDock() {
  const store = useDemoStore();
  const [open, setOpen] = React.useState(false);
  const device = store.currentDevice();
  const user = store.currentUser();
  const lan = store.world.network.lanOnline;
  const schoolUsers = DEMO_USER_IDS.map((id) => store.world.users[id]).filter((u) => u && u.schoolId === device?.schoolId);
  const labDevices = Object.values(store.world.devices).filter((d) => d.schoolId === device?.schoolId && d.index >= 61 && d.index <= 63);

  const switchToUser = (id: string) => {
    const u = store.world.users[id];
    if (!u) return;
    const hadSession = !!store.session;
    store.switchUser(id);
    if (!hadSession) store.navigate('/app/dashboard');
    setOpen(false);
    toast.success(`Now testing: ${u.name}`, { description: `${ROLE_LABELS[u.role]} · on ${store.activeDeviceId}` });
  };

  const switchToDevice = (id: string) => {
    const d = store.world.devices[id];
    if (!d) return;
    store.switchDevice(id);
    setOpen(false);
    toast(`Switched computer: ${d.name} (${id})`, { description: 'Sessions are per-computer — sign in again on it.' });
  };

  return (
    <>
      {/* collapsed trigger */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex h-9 items-center gap-1.5 rounded-full border border-violet-300/80 bg-violet-100/85 px-3 text-xs font-semibold text-violet-800 shadow-lg backdrop-blur transition-opacity hover:opacity-100 dark:border-violet-700 dark:bg-violet-950/85 dark:text-violet-200"
          aria-label="Open demo controls"
          title="Demo: switch user / role, computer, network, scenario"
        >
          <FlaskConical className="h-3.5 w-3.5" /> Demo
        </button>
      )}

      {/* expanded panel (portaled to body) */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="fixed bottom-4 right-4 z-40 max-h-[85vh] w-80 overflow-y-auto rounded-xl border bg-card shadow-2xl" role="dialog" aria-label="Demo controls">
            <div className="sticky top-0 flex items-center justify-between border-b bg-card/95 px-3.5 py-2.5 backdrop-blur">
              <p className="flex items-center gap-1.5 text-sm font-semibold"><FlaskConical className="h-4 w-4 text-violet-500" /> Demo controls</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close demo controls"><X className="h-4 w-4" /></Button>
            </div>

            <div className="space-y-4 p-3.5">
              {/* user / role switcher */}
              <section>
                <SectionTitle icon={UserRound}>Switch user · role</SectionTitle>
                <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border p-1">
                  {schoolUsers.map((u) => {
                    const active = store.session?.userId === u.id;
                    return (
                      <button
                        key={u.id}
                        onClick={() => switchToUser(u.id)}
                        className={`flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm transition-colors hover:bg-accent ${active ? 'bg-primary/10' : ''}`}
                      >
                        <UserAvatar name={u.name} hue={u.avatarHue} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium leading-tight">{u.name}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">{u.demoLabel ?? ROLE_LABELS[u.role]}</span>
                        </span>
                        {active && <span className="mr-1 text-[10px] font-semibold text-primary">active</span>}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* device switcher */}
              <section>
                <SectionTitle icon={MonitorSmartphone}>Simulated computer</SectionTitle>
                <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-lg border p-1">
                  {DEMO_DEVICE_IDS.map((id) => {
                    const d = store.world.devices[id];
                    if (!d) return null;
                    const active = store.activeDeviceId === id;
                    return (
                      <button key={id} onClick={() => switchToDevice(id)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent ${active ? 'bg-primary/10' : ''}`}>
                        <span className="truncate font-medium">{d.name} <span className="font-normal text-muted-foreground">{id}</span></span>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.online && lan ? 'bg-emerald-500' : 'bg-red-400'}`} />
                      </button>
                    );
                  })}
                  {labDevices.map((d) => (
                    <button key={d.id} onClick={() => switchToDevice(d.id)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent ${store.activeDeviceId === d.id ? 'bg-primary/10' : ''}`}>
                      <span className="truncate font-medium">{d.name} <span className="font-normal text-muted-foreground">{d.id}</span></span>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.online && lan ? 'bg-emerald-500' : 'bg-red-400'}`} />
                    </button>
                  ))}
                </div>
              </section>

              {/* network */}
              <section>
                <SectionTitle icon={lan ? Wifi : WifiOff}>Network</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" className="h-8 justify-start text-xs" onClick={() => { const was = lan; store.toggleNetwork(); toast(was ? 'LAN disconnected (simulated)' : 'LAN reconnected (simulated)'); }}>
                    {lan ? <WifiOff className="mr-1 h-3.5 w-3.5" /> : <Wifi className="mr-1 h-3.5 w-3.5" />} LAN {lan ? 'online' : 'offline'}
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 justify-start text-xs" onClick={() => { const was = !!device?.online; store.setDeviceOnline(store.activeDeviceId, !was); }}>
                    <CircleDot className="mr-1 h-3.5 w-3.5" /> PC {device?.online ? 'online' : 'offline'}
                  </Button>
                </div>
              </section>

              {/* scenario presets */}
              <section>
                <SectionTitle icon={Play}>Jump to scenario</SectionTitle>
                <div className="space-y-1">
                  {SCENARIOS.map((s) => (
                    <button key={s.key} onClick={() => { store.loadScenario(s.key); toast(`Scenario loaded: ${s.label}`, { description: s.desc }); }} className="flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent">
                      <span className="font-medium">{s.label}</span>
                      <span className="truncate text-[10px] text-muted-foreground">{s.desc}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* actions */}
              <section className="space-y-2">
                {store.session && (
                  <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => { store.setWalkthroughOpen(true); setOpen(false); }}>
                    <Play className="mr-1.5 h-3.5 w-3.5" /> Guided walkthrough (30 steps)
                  </Button>
                )}
                <Button
                  variant="outline" size="sm"
                  className="w-full border-red-200 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950"
                  onClick={() => { if (confirm('Reset the entire demonstration? All simulated changes will be discarded.')) { store.resetDemo(); setOpen(false); toast('Demo reset'); } }}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset demo
                </Button>
                <p className="text-center text-[10px] leading-relaxed text-muted-foreground">Simulation only — transfers, timing and AI are simulated locally.</p>
              </section>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
