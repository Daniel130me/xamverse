'use client';

/** System screens — notifications, licensing, updates, backups, audit, settings, help, browser access */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { PageHeader, StatCard, SectionCard, StatusBadge, DataTable, EmptyState, TransferProgress } from '../shared/ui-kit';
import { fmtDateTime, fmtRelative, ROLE_LABELS } from '@/lib/prototype/ui-utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Bell, KeyRound, PackageCheck, DatabaseBackup, ScrollText, Settings as SettingsIcon, LifeBuoy,
  CheckCircle2, XCircle, AlertTriangle, Download, Upload, RefreshCcw, QrCode, MonitorSmartphone,
  Globe, HardDrive, Save, BookOpen, MessageSquare, ShieldCheck, CircleDot, Wifi, Printer,
  Clock, Trash2, GraduationCap,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================
// Notifications centre
// ============================================================

export function NotificationsScreen() {
  const store = useDemoStore();
  const local = store.local();
  const [filter, setFilter] = React.useState<'all' | 'unread'>('all');
  const notifications = local.notifications.filter((n) => filter === 'all' || !n.read);
  return (
    <div>
      <PageHeader
        title="Notifications"
        description={`Events delivered to this computer (${store.activeDeviceId}). Each peer has its own centre.`}
        icon={<Bell className="h-5 w-5" />}
        actions={<Button size="sm" variant="outline" onClick={() => { store.markNotificationsRead(); toast('All marked as read'); }}>Mark all read</Button>}
      />
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>All ({local.notifications.length})</Button>
        <Button size="sm" variant={filter === 'unread' ? 'default' : 'outline'} onClick={() => setFilter('unread')}>Unread ({local.notifications.filter((n) => !n.read).length})</Button>
      </div>
      {notifications.length === 0 ? (
        <EmptyState title="Nothing here" description="Peer connections, sync progress, approvals and results appear in this centre." icon={<Bell className="h-6 w-6" />} />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => { store.markNotificationsRead([n.id]); if (n.actionRoute) store.navigate(n.actionRoute); }}
              className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-accent ${!n.read ? 'border-primary/30 bg-primary/5' : ''}`}
            >
              <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${n.kind.includes('reject') || n.kind.includes('conflict') ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : n.kind.includes('approved') || n.kind.includes('received') || n.kind.includes('connected') ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'}`}>
                {n.kind.includes('conflict') ? <AlertTriangle className="h-4 w-4" /> : n.kind.includes('approved') || n.kind.includes('received') ? <CheckCircle2 className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${n.read ? 'text-muted-foreground' : 'font-semibold'}`}>{n.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{fmtRelative(n.at)}{n.actionRoute ? ' · click to open' : ''}</p>
              </div>
              {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Licensing
// ============================================================

export function LicensingScreen() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const school = store.world.schools[device.schoolId];
  const [mode, setMode] = React.useState<'info' | 'online' | 'offline'>('info');
  const [offlineStep, setOfflineStep] = React.useState(0);
  const [keyInput, setKeyInput] = React.useState('');
  const [activating, setActivating] = React.useState(false);
  const peers = Object.values(store.world.devices).filter((d) => d.schoolId === school.id);

  // Little Stars is in grace period — show expired-state demo there
  const isLittleStars = school.id === 'sch-littlestars';
  const licence = {
    plan: school.plan,
    status: isLittleStars ? 'grace_period' : 'active',
    activatedAt: isLittleStars ? '2025-09-01' : '2025-12-15',
    expiresAt: isLittleStars ? '2026-10-05' : '2026-12-15',
    deviceLimit: school.plan === 'campus' ? 150 : school.plan === 'standard' ? 40 : 10,
    devicesUsed: peers.length,
    key: 'EHCM-4F2A-91KD-77QX-3PLM',
  };

  const plans = [
    { id: 'starter', name: 'Starter', price: '₦120,000 / yr', devices: 10, students: '150 students', features: ['Core exams & sync', 'Question banks', 'Community support'] },
    { id: 'standard', name: 'Standard', price: '₦260,000 / yr', devices: 40, students: '800 students', features: ['Everything in Starter', 'AI assistant', 'Advanced analytics', 'Email support'] },
    { id: 'campus', name: 'Campus', price: '₦540,000 / yr', devices: 150, students: 'Unlimited', features: ['Everything in Standard', 'Multi-school', 'Priority offline renewal', 'Dedicated support'] },
  ];

  return (
    <div>
      <PageHeader
        title="Licensing & subscription"
        description="Entitlements, activation and device limits for this school. Offline licences have defined validity and may require renewal."
        icon={<KeyRound className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setMode('online')}><Globe className="mr-1.5 h-4 w-4" /> Activate online</Button>
            <Button size="sm" variant="outline" onClick={() => setMode('offline')}><HardDrive className="mr-1.5 h-4 w-4" /> Offline activation</Button>
          </>
        }
      />

      {mode === 'info' && (
        <>
          <div className="mb-4 grid gap-3 lg:grid-cols-4">
            <StatCard label="Plan" value={licence.plan.toUpperCase()} sub={`product key ${licence.key.slice(0, 9)}••••`} icon={<KeyRound className="h-4 w-4" />} />
            <StatCard label="Status" value={licence.status === 'active' ? 'Active' : 'Grace period'} sub={`expires ${licence.expiresAt}`} tone={licence.status === 'active' ? 'success' : 'warning'} icon={<ShieldCheck className="h-4 w-4" />} />
            <StatCard label="Devices" value={`${licence.devicesUsed}/${licence.deviceLimit}`} sub="registered installations" />
            <StatCard label="Renewal" value={isLittleStars ? 'Overdue' : 'In 65 days'} sub={isLittleStars ? 'read-only mode applies at expiry' : 'reminder enabled'} tone={isLittleStars ? 'warning' : 'info'} />
          </div>

          {isLittleStars && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> This school is in its grace period (expired 05 Oct 2026)</p>
              <p className="mt-1 text-xs">Design principle: an expired subscription never destroys school records. This installation has switched to read-only with export allowed until a renewed licence is imported. Nothing is lost.</p>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard title="Feature entitlements" className="lg:col-span-1">
              <div className="space-y-1.5 text-sm">
                {[
                  ['Controlled examinations', true], ['Peer sync & distribution', true],
                  ['AI question assistant', licence.plan !== 'starter'],
                  ['Advanced analytics', licence.plan !== 'starter'],
                  ['Multi-school management', licence.plan === 'campus'],
                  ['Offline licence renewal file', true],
                ].map(([f, ok]) => (
                  <div key={f as string} className="flex items-center justify-between border-b pb-1.5">
                    <span>{f}</span>
                    {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
                  </div>
                ))}
              </div>
            </SectionCard>
            <SectionCard title="Billing history" className="lg:col-span-2">
              <DataTable
                rows={[
                  { id: 'inv-2026', date: '15 Dec 2025', amount: '₦540,000', status: 'paid', description: 'Campus plan — annual' },
                  { id: 'inv-2025', date: '10 Dec 2024', amount: '₦540,000', status: 'paid', description: 'Campus plan — annual' },
                  { id: 'inv-2027', date: '15 Dec 2026', amount: '₦540,000', status: 'pending', description: 'Campus plan — renewal (upcoming)' },
                ]}
                rowKey={(r) => r.id}
                searchable={false}
                pageSize={5}
                columns={[
                  { key: 'date', header: 'Date', render: (r) => <span>{r.date}</span> },
                  { key: 'description', header: 'Description', render: (r) => r.description },
                  { key: 'amount', header: 'Amount', render: (r) => <strong>{r.amount}</strong> },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                ]}
              />
            </SectionCard>
          </div>

          <div className="mt-4">
            <SectionCard title="Compare plans">
              <div className="grid gap-3 sm:grid-cols-3">
                {plans.map((p) => (
                  <div key={p.id} className={`rounded-xl border p-4 ${p.id === school.plan ? 'border-primary ring-1 ring-primary/20' : ''}`}>
                    <div className="flex items-center justify-between">
                      <p className="font-bold">{p.name}</p>
                      {p.id === school.plan && <Badge>Current</Badge>}
                    </div>
                    <p className="mt-1 text-lg font-bold text-primary">{p.price}</p>
                    <p className="text-xs text-muted-foreground">{p.devices} computers · {p.students}</p>
                    <ul className="mt-2 space-y-1">
                      {p.features.map((f) => <li key={f} className="flex items-center gap-1 text-xs"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> {f}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </>
      )}

      {mode === 'online' && (
        <SectionCard title="Online activation" description="Requires internet once. The licence server verifies your product key (simulated).">
          <div className="max-w-md space-y-3">
            <div><Label>Product key</Label><Input className="mt-1 font-mono" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="EHXX-XXXX-XXXX-XXXX-XXXX" /></div>
            <Button disabled={activating || keyInput.length < 8} onClick={() => { setActivating(true); setTimeout(() => { setActivating(false); setMode('info'); toast.success('Licence activated (simulated)', { description: 'Valid until 15 Dec 2027 · Campus plan.' }); }, 1600); }}>
              {activating ? 'Verifying…' : 'Activate now'}
            </Button>
            {activating && <Progress value={70} />}
            <p className="text-xs text-muted-foreground">Enter any key of 8+ characters — this is a simulated flow. No real licence server is contacted.</p>
            <Button variant="ghost" size="sm" onClick={() => setMode('info')}>← Back to licence info</Button>
          </div>
        </SectionCard>
      )}

      {mode === 'offline' && (
        <SectionCard title="Offline activation" description="For schools with no internet at the point of activation.">
          <div className="max-w-2xl space-y-3">
            {[
              [1, 'Device identifier', `${store.activeDeviceId} · fingerprint ed25519:77f2…c9a1 (simulated)`],
              [2, 'Generate activation request', 'Creates a signed request file to carry to any internet-connected computer.'],
              [3, 'Transfer & activate', 'The licensing service returns an activation file (simulated here).'],
              [4, 'Import activation file', 'Import the returned file to activate this installation offline.'],
              [5, 'Validity & renewal', 'Offline licences expire after the purchased period; renewal repeats this flow.'],
            ].map(([n, title, desc]) => (
              <div key={n as number} className={`flex gap-3 rounded-lg border p-3 ${offlineStep >= (n as number) ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30' : ''}`}>
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${offlineStep >= (n as number) ? 'bg-emerald-500 text-white' : 'bg-muted'}`}>{offlineStep > (n as number) ? '✓' : n}</div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                {n === 2 && offlineStep === 0 && <Button size="sm" onClick={() => { setOfflineStep(1); toast('Activation request generated', { description: 'activation-request-DEV-043.ehreq saved for transfer.' }); }}>Generate request</Button>}
                {n === 4 && offlineStep === 1 && <Button size="sm" onClick={() => { setOfflineStep(2); toast.success('Licence activated offline', { description: 'Valid until 15 Dec 2027 · Campus plan · 150 devices.' }); }}>Import file</Button>}
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => { setOfflineStep(0); setMode('info'); }}>← Back to licence info</Button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ============================================================
// Updates
// ============================================================

export function UpdatesScreen() {
  const store = useDemoStore();
  const local = store.local();
  const device = store.currentDevice();
  const peers = Object.values(store.world.devices).filter((d) => d.schoolId === device.schoolId && d.paired && d.id !== store.activeDeviceId);
  const [targets, setTargets] = React.useState<Set<string>>(new Set());
  const us = local.updateState;
  const hasExamActive = Object.values(local.assessments).some((a) => a.status === 'active');

  return (
    <div>
      <PageHeader
        title="Application updates"
        description={`This computer runs v${us.currentVersion}. Updates can be imported offline and distributed over the LAN.`}
        icon={<PackageCheck className="h-5 w-5" />}
      />
      {hasExamActive && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" /> An examination is currently active. Installing an update now is unsafe — updates are blocked until all sessions finish.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="This computer">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">Installed</span><span className="font-semibold">v{us.currentVersion}</span></div>
            <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">Available</span><span>{us.availableVersion ? `v${us.availableVersion}` : 'Up to date'}</span></div>
            <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">Auto-update</span><Switch defaultChecked={us.autoUpdate} onCheckedChange={() => toast('Preference saved locally')} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Compatibility</span><span className="text-emerald-600">verified ✓</span></div>
            {!us.importedPackage ? (
              <Button className="w-full" onClick={() => { store.importUpdatePackage(); toast.success('Package imported & verified', { description: 'examhub-1.4.1.offline (186 MB) — signature valid.' }); }}><Upload className="mr-1.5 h-4 w-4" /> Import offline update package</Button>
            ) : (
              <div className="rounded-lg border bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                <CheckCircle2 className="mr-1 inline h-4 w-4" /> v{us.importedPackage.version} imported {fmtRelative(us.importedPackage.importedAt)} · verified · {us.importedPackage.sizeMb} MB
              </div>
            )}
          </div>
        </SectionCard>
        <SectionCard title="Release notes — v1.4.1" className="lg:col-span-2">
          <ul className="space-y-2 text-sm">
            {(us.releaseNotes ?? ['No package imported yet — import an offline package to read its notes.']).map((n) => (
              <li key={n} className="flex gap-2"><CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {n}</li>
            ))}
          </ul>
          {us.importedPackage && (
            <div className="mt-4 border-t pt-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">DISTRIBUTE TO PEERS ({targets.size} selected)</p>
              <div className="flex flex-wrap gap-1.5">
                {peers.slice(0, 24).map((d) => (
                  <button key={d.id} onClick={() => setTargets((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} className={`rounded-full border px-2.5 py-1 text-xs ${targets.has(d.id) ? 'border-primary bg-primary/10 text-primary' : ''}`}>{d.id}</button>
                ))}
              </div>
              <Button size="sm" className="mt-3" disabled={targets.size === 0} onClick={() => { store.distributeUpdate(Array.from(targets)); toast.success(`Update distribution queued → ${targets.size} peers`); }}><RefreshCcw className="mr-1.5 h-4 w-4" /> Push update to selected peers</Button>
              <p className="mt-2 text-[11px] text-muted-foreground">Receiving peers verify the package signature and back up their data before installing (simulated).</p>
            </div>
          )}
        </SectionCard>
      </div>
      <div className="mt-4">
        <SectionCard title="Update history">
          <DataTable
            rows={us.history}
            rowKey={(h, i) => `${h.version}-${i}`}
            searchable={false}
            pageSize={6}
            columns={[
              { key: 'version', header: 'Version', render: (h) => <strong>v{h.version}</strong> },
              { key: 'at', header: 'Date', render: (h) => fmtDateTime(h.at) },
              { key: 'status', header: 'Outcome', render: (h) => <StatusBadge status={h.status === 'installed' ? 'success' : h.status} label={h.status} /> },
              { key: 'note', header: 'Note', render: (h) => <span className="text-xs text-muted-foreground">{h.note}</span> },
            ]}
          />
        </SectionCard>
      </div>
    </div>
  );
}

// ============================================================
// Backups
// ============================================================

export function BackupsScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const [restoreTarget, setRestoreTarget] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  return (
    <div>
      <PageHeader
        title="Backups & restore"
        description={`Local backups on ${store.activeDeviceId}. Backup ≠ synchronization: backups protect THIS computer; sync replicates across peers.`}
        icon={<DatabaseBackup className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => toast.success('Backup exported to removable media (simulated)', { description: 'greenfield-backup-2026-10-11.ehbak (412 MB, AES-256).' })}><Download className="mr-1.5 h-4 w-4" /> Export backup</Button>
            <Button size="sm" onClick={() => { setCreating(true); setTimeout(() => { setCreating(false); store.createBackup('full', 'All school records'); toast.success('Backup created & verified'); }, 1400); }} disabled={creating}>
              {creating ? 'Backing up…' : <><DatabaseBackup className="mr-1.5 h-4 w-4" /> Create backup now</>}
            </Button>
          </>
        }
      />
      {creating && <div className="mb-4"><Progress value={65} /><p className="mt-1 text-xs text-muted-foreground">Snapshotting local database · verifying integrity · encrypting (AES-256)…</p></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Backup history" className="lg:col-span-2">
          <DataTable
            rows={local.backups}
            rowKey={(b) => b.id}
            searchable={false}
            pageSize={6}
            columns={[
              { key: 'createdAt', header: 'Created', render: (b) => fmtDateTime(b.createdAt) },
              { key: 'kind', header: 'Type', render: (b) => <Badge variant="outline">{b.kind}</Badge> },
              { key: 'scope', header: 'Scope', render: (b) => <span className="text-xs">{b.scope}</span> },
              { key: 'sizeMb', header: 'Size', render: (b) => `${b.sizeMb} MB` },
              { key: 'encrypted', header: 'Security', render: (b) => <span className="flex items-center gap-1 text-xs text-emerald-600"><ShieldCheck className="h-3.5 w-3.5" /> encrypted · {b.verified ? 'verified' : 'unverified'}</span> },
              { key: 'actions', header: '', render: (b) => <Button size="sm" variant="outline" onClick={() => setRestoreTarget(b.id)}>Restore</Button> },
            ]}
            emptyState={<EmptyState title="No backups on this computer" description="Create a backup or enable the scheduled nightly backup (02:00)." />}
          />
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Scheduled backups">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between border-b pb-2"><span>Nightly full backup</span><Switch defaultChecked onCheckedChange={() => toast('Schedule updated')} /></div>
              <div className="flex justify-between border-b pb-2"><span>Time</span><span>02:00 (local)</span></div>
              <div className="flex justify-between"><span>Retention</span><span>14 backups</span></div>
            </div>
          </SectionCard>
          <SectionCard title="Data retention & recovery">
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>Lost-device recovery: install ExamHub on the replacement computer, choose <strong>Restore from backup</strong> at welcome, and import the most recent verified backup — or pair with a peer that holds an authorized replica of the records you need.</p>
              <Button size="sm" variant="outline" className="w-full" onClick={() => navigate('/')}><DatabaseBackup className="mr-1.5 h-4 w-4" /> Open restore wizard (welcome screen)</Button>
            </div>
          </SectionCard>
        </div>
      </div>
      <Dialog open={!!restoreTarget} onOpenChange={(v) => !v && setRestoreTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Restore from this backup?</DialogTitle><DialogDescription>Current records are snapshotted first, then the backup is restored. The app restarts afterwards (simulated).</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button onClick={() => { if (restoreTarget) { store.restoreBackup(restoreTarget); setRestoreTarget(null); toast.success('Restore completed (simulated)', { description: 'All records verified after restoration.' }); } }}>Restore now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Audit logs
// ============================================================

export function AuditScreen() {
  const store = useDemoStore();
  const local = store.local();
  return (
    <div>
      <PageHeader
        title="Audit logs"
        description={`Every significant event recorded on ${store.activeDeviceId}. Filter by user, action, status or text.`}
        icon={<ScrollText className="h-5 w-5" />}
        actions={<Button size="sm" variant="outline" onClick={() => toast.success('Audit log exported (simulated)')}><Download className="mr-1.5 h-4 w-4" /> Export CSV</Button>}
      />
      <DataTable
        rows={local.auditLog}
        rowKey={(a) => a.id}
        searchable
        searchKeys={(a) => `${a.userName} ${a.action} ${a.detail} ${a.target}`}
        pageSize={15}
        filters={[
          { key: 'action', label: 'Action', options: [...new Set(local.auditLog.map((a) => a.action))].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })), match: (a, v) => a.action === v },
          { key: 'status', label: 'Status', options: [{ value: 'success', label: 'Success' }, { value: 'warning', label: 'Warning' }, { value: 'failure', label: 'Failure' }], match: (a, v) => a.status === v },
        ]}
        columns={[
          { key: 'at', header: 'Time', sortable: true, render: (a) => <span className="whitespace-nowrap text-xs">{fmtDateTime(a.at)}</span> },
          { key: 'userName', header: 'User', sortable: true, render: (a) => <span className="text-xs font-medium">{a.userName}</span> },
          { key: 'action', header: 'Action', render: (a) => <Badge variant="outline" className="whitespace-nowrap text-[10px]">{a.action.replace(/_/g, ' ')}</Badge> },
          { key: 'target', header: 'Target', render: (a) => <span className="font-mono text-xs">{a.target}</span> },
          { key: 'detail', header: 'Detail', render: (a) => <span className="text-xs">{a.detail}</span> },
          { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
        ]}
        emptyState={<EmptyState title="No audit events yet" description="Sign-ins, approvals, sync events, permission changes and more will appear here." />}
      />
    </div>
  );
}

// ============================================================
// Settings
// ============================================================

export function SettingsScreen() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const local = store.local();
  const [tab, setTab] = React.useState('general');
  return (
    <div>
      <PageHeader title="Settings" description="Technical administration with plain-language explanations throughout." icon={<SettingsIcon className="h-5 w-5" />} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {['general', 'network', 'security', 'ai', 'appearance', 'diagnostics', 'browser'].map((t) => <TabsTrigger key={t} value={t} className="capitalize">{t === 'ai' ? 'AI provider' : t}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="general" className="mt-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="General preferences">
              <div className="space-y-3 text-sm">
                <div><Label>School language</Label><select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" aria-label="Language"><option>English (Nigeria)</option><option>Français</option><option>العربية</option></select></div>
                <div><Label>Academic settings</Label><p className="text-xs text-muted-foreground">Session, terms and grading live under Academic Setup.</p></div>
                <div className="flex items-center justify-between border-b pb-2"><span>Show contextual help</span><Switch defaultChecked /></div>
                <div className="flex items-center justify-between"><span>Compact tables</span><Switch /></div>
              </div>
            </SectionCard>
            <SectionCard title="Device identity">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Name</span><span>{device?.name}</span></div>
                <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Device ID</span><span className="font-mono">{store.activeDeviceId}</span></div>
                <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Peer port</span><span className="font-mono">{device?.port}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">School</span><span>{store.world.schools[device.schoolId]?.name}</span></div>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => toast('Rename dialog (simulated)')}>Rename this computer</Button>
              </div>
            </SectionCard>
          </div>
        </TabsContent>
        <TabsContent value="network" className="mt-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Local network & peer discovery">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between border-b pb-2"><span>LAN peer discovery (multicast)</span><Switch defaultChecked onCheckedChange={() => toast('Discovery preference saved')} /></div>
                <div className="flex items-center justify-between border-b pb-2"><span>Listening port</span><span className="font-mono">{device?.port}</span></div>
                <div className="flex items-center justify-between border-b pb-2"><span>Manual IP connections</span><Switch defaultChecked /></div>
                <div className="flex items-center justify-between"><span>Transfer speed limit</span><span>50 MB/s</span></div>
                <p className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground"><Wifi className="mr-1 inline h-3.5 w-3.5" /> Discovery finds nearby school computers automatically. If your Wi-Fi blocks multicast, add peers by IP address — both computers must use the same port.</p>
              </div>
            </SectionCard>
            <SectionCard title="Synchronization preferences">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between border-b pb-2"><span>Auto-resume blocked transfers</span><Switch defaultChecked /></div>
                <div className="flex items-center justify-between border-b pb-2"><span>Auto-push submissions after exam</span><Switch defaultChecked onCheckedChange={() => toast('Submissions will transfer to authorized collectors automatically.')} /></div>
                <div className="flex items-center justify-between border-b pb-2"><span>Question bank sharing</span><Switch defaultChecked /></div>
                <div className="flex items-center justify-between"><span>Student records replication</span><Switch /></div>
                <p className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground">Restricted records only replicate to peers whose operators hold matching authorization. Everything else stays local.</p>
              </div>
            </SectionCard>
          </div>
        </TabsContent>
        <TabsContent value="security" className="mt-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Encryption & data security">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b pb-2"><span>Local database</span><span className="flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-4 w-4" /> AES-256 at rest</span></div>
                <div className="flex justify-between border-b pb-2"><span>Peer transfers</span><span className="flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-4 w-4" /> TLS + device keys</span></div>
                <div className="flex justify-between border-b pb-2"><span>Exam packages</span><span className="flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-4 w-4" /> signed & sealed</span></div>
                <div className="flex justify-between"><span>Backups</span><span className="flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-4 w-4" /> encrypted</span></div>
              </div>
            </SectionCard>
            <SectionCard title="Authentication & session policies">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between border-b pb-2"><span>Session expiry</span><span>8 hours</span></div>
                <div className="flex items-center justify-between border-b pb-2"><span>Lock on screensaver</span><Switch defaultChecked /></div>
                <div className="flex items-center justify-between border-b pb-2"><span>Re-authentication for sensitive ops</span><Switch defaultChecked /></div>
                <div className="flex items-center justify-between"><span>Offline authentication cache</span><span>30 days</span></div>
                <p className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground">Sign-in verifies against local records so schools can keep working with no internet. Suspicious attempts land in the audit log.</p>
              </div>
            </SectionCard>
          </div>
        </TabsContent>
        <TabsContent value="ai" className="mt-3">
          <SectionCard title="AI provider" description="Choose how the AI question assistant runs. Cloud providers need internet; a local model does not.">
            <div className="grid max-w-2xl gap-2 sm:grid-cols-3">
              {[
                ['Cloud AI', 'Uses the online provider. Best quality, needs internet.', Globe],
                ['Local model', 'A small model runs on this computer. Works fully offline.', HardDrive],
                ['Disabled', 'Turn the assistant off on this computer.', XCircle],
              ].map(([label, desc, Icon]) => {
                const I = Icon as React.ComponentType<{ className?: string }>;
                return (
                  <button key={label as string} onClick={() => toast(`${label} selected`)} className="rounded-xl border p-4 text-left hover:border-primary/50">
                    <I className="h-5 w-5 text-primary" />
                    <p className="mt-1.5 text-sm font-semibold">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </TabsContent>
        <TabsContent value="appearance" className="mt-3">
          <SectionCard title="Appearance & accessibility">
            <div className="grid max-w-xl gap-3 text-sm">
              <p className="text-xs text-muted-foreground">Light and dark themes are toggled from the header. Accessibility options:</p>
              <div className="flex items-center justify-between border-b pb-2"><span>High-contrast text</span><Switch /></div>
              <div className="flex items-center justify-between border-b pb-2"><span>Larger touch targets</span><Switch /></div>
              <div className="flex items-center justify-between border-b pb-2"><span>Reduce motion</span><Switch /></div>
              <div className="flex items-center justify-between"><span>Keyboard navigation hints</span><Switch defaultChecked /></div>
            </div>
          </SectionCard>
        </TabsContent>
        <TabsContent value="diagnostics" className="mt-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Diagnostics" description="Run automated checks on this installation.">
              <div className="space-y-2">
                {[
                  ['Local database integrity', 'healthy'],
                  ['Peer listener', 'reachable on port ' + device?.port],
                  ['Storage', `${((device?.storageUsedMb ?? 0) / 1024).toFixed(1)} GB used`],
                  ['Certificate & keys', 'valid (simulated)'],
                  ['Pending transfers', `${local.transferQueue.filter((t) => ['queued', 'transferring', 'blocked_offline'].includes(t.status)).length} active`],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"><span>{k}</span><StatusBadge status={String(v).includes('reachable') || String(v).includes('valid') || String(v).includes('healthy') ? 'success' : 'info'} label={v} /></div>
                ))}
                <Button size="sm" variant="outline" className="w-full" onClick={() => toast.success('Full diagnostic run complete', { description: 'Report saved locally and can be shared with support.' })}><RefreshCcw className="mr-1.5 h-4 w-4" /> Run full diagnostics</Button>
              </div>
            </SectionCard>
            <SectionCard title="Application info & logs">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Version</span><span>{local.updateState.currentVersion} (Phase 1 prototype)</span></div>
                <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Platform</span><span>{device?.os === 'macos' ? 'macOS' : 'Windows'} · Tauri runtime (Phase 2)</span></div>
                <div className="max-h-40 overflow-y-auto rounded-lg bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {[
                    '09:00:01 INFO  peer listener started on :' + device?.port,
                    '09:00:02 INFO  local database opened (sqlite, encrypted)',
                    '09:00:05 INFO  discovery: 91 paired peers responded',
                    '09:02:11 WARN  transfer xfr-teacher-1 retry scheduled (peer unreachable)',
                    '09:05:44 INFO  sync checkpoint written',
                    '09:07:03 INFO  licence check: valid until 2026-12-15',
                  ].map((l) => <p key={l}>{l}</p>)}
                </div>
              </div>
            </SectionCard>
          </div>
        </TabsContent>
        <TabsContent value="browser" className="mt-3"><BrowserAccessScreen /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Browser access
// ============================================================

export function BrowserAccessScreen() {
  const store = useDemoStore();
  const local = store.local();
  const device = store.currentDevice();
  const [revoke, setRevoke] = React.useState<string | null>(null);
  return (
    <div className="space-y-4">
      <SectionCard title="Browser access" description="Reach this computer's ExamHub from a browser on the same LAN. Browser sessions are guests through this peer — not full desktop nodes.">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Local address</span><span className="font-mono">http://{device?.ip}:47811</span></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">LAN availability</span><StatusBadge status={device?.online ? 'online' : 'offline'} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Session limit</span><span>10 concurrent</span></div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => toast('QR code shown (mockup) — scan from a tablet to open this peer in the browser.')}><QrCode className="mr-1.5 h-4 w-4" /> Show QR code</Button>
          </div>
          <div className="flex items-center justify-center rounded-xl border-2 border-dashed p-6">
            <div className="text-center">
              <QrCode className="mx-auto h-24 w-24 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">Scan to open this peer in a browser (mockup)</p>
            </div>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">Browser ≠ desktop peer</p>
            Browser sessions have limited storage, cannot host peer-to-peer networking, and some features (distribution, collection, local AI) are unavailable. Feature indicators mark what is disabled.
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Connected browser sessions">
        <DataTable
          rows={local.browserSessions}
          rowKey={(b) => b.id}
          searchable={false}
          pageSize={5}
          columns={[
            { key: 'userName', header: 'User', render: (b) => <span className="text-sm font-medium">{b.userName}</span> },
            { key: 'role', header: 'Role', render: (b) => <Badge variant="outline">{ROLE_LABELS[b.role]}</Badge> },
            { key: 'device', header: 'Browser', render: (b) => <span className="text-xs">{b.device}</span> },
            { key: 'ip', header: 'IP', render: (b) => <span className="font-mono text-xs">{b.ip}</span> },
            { key: 'startedAt', header: 'Started', render: (b) => <span className="text-xs text-muted-foreground">{fmtRelative(b.startedAt)}</span> },
            { key: 'active', header: 'Status', render: (b) => <StatusBadge status={b.active ? 'active' : 'inactive'} label={b.active ? 'connected' : 'ended'} /> },
            { key: 'actions', header: '', render: (b) => b.active && <Button size="sm" variant="outline" onClick={() => setRevoke(b.id)}>Revoke</Button> },
          ]}
          emptyState={<EmptyState title="No browser sessions" description="Tablets and laptops on the LAN can connect through the address above." />}
        />
      </SectionCard>
      <Dialog open={!!revoke} onOpenChange={(v) => !v && setRevoke(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revoke browser session?</DialogTitle><DialogDescription>The user will be signed out immediately; unsaved answers were already auto-saved locally.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoke(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { const world = { ...store.world }; const b = world.locals[store.activeDeviceId].browserSessions.find((x) => x.id === revoke); if (b) b.active = false; useDemoStore.setState({ world }); setRevoke(null); toast('Session revoked'); }}>Revoke session</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Help & support
// ============================================================

export function HelpScreen() {
  const store = useDemoStore();
  const navigate = store.navigate;
  const [msg, setMsg] = React.useState('');
  return (
    <div>
      <PageHeader title="Help & support" description="Guided walkthroughs, glossary and a direct line to product support." icon={<LifeBuoy className="h-5 w-5" />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Guided walkthrough" className="lg:col-span-1">
          <p className="text-sm text-muted-foreground">The 30-step demonstration story covers the entire exam lifecycle across computers.</p>
          <Button size="sm" className="mt-3" onClick={() => store.setWalkthroughOpen(true)}><BookOpen className="mr-1.5 h-4 w-4" /> Open guided scenario</Button>
          <p className="mt-3 text-xs text-muted-foreground">Or use the simulator bar at the bottom to switch computers, users and network states at any time.</p>
        </SectionCard>
        <SectionCard title="Quick answers" className="lg:col-span-2">
          <div className="space-y-2">
            {[
              ['Why can’t I see an exam my colleague created?', 'Data lives on the computer where it was created. It reaches you after an authorized transfer — open Computers & Sync and request it, or ask the owner to push it.'],
              ['A student’s computer lost the network mid-exam', 'Nothing is lost. The exam package and every answer are stored locally; answers sync when the network returns. Invigilators can approve resumption.'],
              ['Who approves an assessment?', 'Any user with the “Approve assessments” permission — typically an administrator on any peer. Approvals bind to a specific version.'],
              ['What happens when the licence expires?', 'The installation enters a read-only grace mode: existing records remain viewable and exportable, but new exams are blocked until the licence is renewed. Nothing is ever deleted.'],
              ['How is this different from a school server?', 'There is no permanent server. Every installation is a peer with its own database; roles and data flow come from who signs in and what you authorize to sync.'],
            ].map(([q, a]) => (
              <details key={q} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">{q}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </SectionCard>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Contact product support">
          <div className="space-y-2">
            <Textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Describe the issue — a diagnostic report can be attached (simulated)…" aria-label="Support message" />
            <div className="flex gap-2">
              <Button size="sm" disabled={!msg.trim()} onClick={() => { setMsg(''); toast.success('Support request prepared (simulated)', { description: 'Attach the diagnostic file and send from any internet-connected computer — support works offline-first.' }); }}><MessageSquare className="mr-1.5 h-4 w-4" /> Prepare request</Button>
              <Button size="sm" variant="outline" onClick={() => toast.success('Diagnostic report exported (simulated)')}><Printer className="mr-1.5 h-4 w-4" /> Export diagnostics</Button>
            </div>
          </div>
        </SectionCard>
        <SectionCard title="About this prototype">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p><strong className="text-foreground">ExamHub Phase 1</strong> — an interactive design prototype of the offline-first, decentralized examination platform.</p>
            <p>Everything here is simulated: peer transfers, licences, AI and security are mock operations with realistic behaviour. Nothing is production-secure, and no real examinations are conducted.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => navigate('/app/dashboard')}>Dashboard</Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/app/computers')}>Computers & Sync</Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/practice')}>Public practice</Button>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
