'use client';

/**
 * Computers & Sync — peer dashboard, discovery/pairing, 100-device fleet,
 * device detail, sync centre (distribute/collect/everything), conflicts.
 * Architecture: every installation is an autonomous peer — no master.
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { PageHeader, StatCard, SectionCard, StatusBadge, DataTable, EmptyState, TransferProgress, AccessDenied } from '@/components/shared/ui-kit';
import { fmtRelative, fmtDateTime, TRANSFER_STATUS_LABELS } from '@/lib/ui-utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  MonitorSmartphone, Wifi, WifiOff, RefreshCcw, Send, Search, ShieldCheck, ShieldAlert, GitMerge,
  Download, HardDrive, Radio, CircleCheck, XCircle, AlertTriangle, Network, ArrowRight, ScanLine,
  KeyRound, Trash2, Clock, CheckCircle2, Layers, CircleDot, Unplug, PlugZap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Device, ConflictCase } from '@/lib/prototype/types';

// ============================================================
// Peer dashboard
// ============================================================

export function ComputersScreen() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const local = store.local();
  const navigate = store.navigate;
  const peers = Object.values(store.world.devices).filter((d) => d.schoolId === device.schoolId);
  const paired = peers.filter((d) => d.paired);
  const reachable = paired.filter((d) => d.online && store.world.network.lanOnline);
  const pendingTasks = local.transferQueue.filter((t) => ['queued', 'transferring', 'blocked_offline'].includes(t.status));
  const failed = local.transferQueue.filter((t) => t.status === 'failed');
  const [scanOpen, setScanOpen] = React.useState(false);
  const [discovered, setDiscovered] = React.useState<Device[]>([]);
  const [scanning, setScanning] = React.useState(false);
  const [manualIp, setManualIp] = React.useState('');

  const scan = () => {
    setScanning(true);
    setTimeout(() => {
      const { discovered } = store.scanNetwork();
      const unpaired = discovered.filter((d) => !d.paired);
      setDiscovered(unpaired);
      setScanning(false);
      toast.success(`Scan complete — ${discovered.length} reachable peers, ${unpaired.length} unpaired`, { description: 'Only unpaired computers are shown below. Paired ones are already trusted.' });
    }, 1300);
  };

  const connectManual = () => {
    const d = peers.find((p) => p.ip === manualIp.trim());
    if (!d) {
      toast.error('No peer answered at that address', { description: 'Check the IP, port 47810, and that the firewall allows local traffic. (Simulated timeout.)' });
      return;
    }
    setDiscovered((ds) => [...ds.filter((x) => x.id !== d.id), d]);
    toast.success(`Peer responded: ${d.name}`, { description: 'Identity fingerprint verified (simulated).' });
  };

  return (
    <div>
      <PageHeader
        title="Computers & Sync"
        description="Every installation is an independent peer — there is no permanent admin, teacher or student computer. The signed-in user decides what this computer can do."
        icon={<MonitorSmartphone className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setScanOpen(true)}><ScanLine className="mr-1.5 h-4 w-4" /> Discover peers</Button>
            <Button size="sm" onClick={() => navigate('/app/sync')}><RefreshCcw className="mr-1.5 h-4 w-4" /> Sync centre</Button>
          </>
        }
      />

      {/* this device */}
      <div className="mb-4 grid gap-3 lg:grid-cols-4">
        <StatCard label="This computer" value={device?.name ?? '—'} sub={`${device?.id} · ${device?.ip}:${device?.port} · ${device?.os === 'macos' ? 'macOS' : 'Windows'}`} icon={<MonitorSmartphone className="h-4 w-4" />} tone={device?.online ? 'success' : 'danger'} />
        <StatCard label="Paired devices" value={paired.length} sub={`${peers.length} known identities`} icon={<Network className="h-4 w-4" />} />
        <StatCard label="Reachable now" value={reachable.length} sub={store.world.network.lanOnline ? 'LAN online' : 'LAN OFFLINE — simulated'} icon={<Wifi className="h-4 w-4" />} tone={store.world.network.lanOnline ? 'success' : 'danger'} />
        <StatCard label="Pending sync tasks" value={pendingTasks.length} sub={`${failed.length} failed (retryable)`} icon={<RefreshCcw className="h-4 w-4" />} tone={pendingTasks.length ? 'warning' : 'success'} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Local storage health">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm"><HardDrive className="h-4 w-4 text-muted-foreground" /><span>Database: healthy (SQLite, encrypted at rest)</span></div>
            <div>
              <div className="mb-1 flex justify-between text-xs"><span>Storage used</span><span>{((device?.storageUsedMb ?? 0) / 1024).toFixed(1)} GB / {((device?.storageTotalMb ?? 8192) / 1024).toFixed(0)} GB</span></div>
              <Progress value={((device?.storageUsedMb ?? 0) / (device?.storageTotalMb ?? 8192)) * 100} className="h-2" />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>Last successful sync</span><span>{fmtRelative(local.lastSyncAt)}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>Listening port</span><span className="font-mono">{device?.port}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>Peer identity</span><span className="font-mono text-[10px]">ed25519:{device?.id.slice(-4)}…9f2c (simulated)</span></div>
          </div>
        </SectionCard>
        <SectionCard title="Sync status summary" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3 text-center"><p className="text-xl font-bold text-emerald-600">{local.transferQueue.filter((t) => t.status === 'completed').length}</p><p className="text-xs text-muted-foreground">completed</p></div>
            <div className="rounded-lg border p-3 text-center"><p className="text-xl font-bold text-violet-600">{local.transferQueue.filter((t) => ['queued', 'transferring'].includes(t.status)).length}</p><p className="text-xs text-muted-foreground">in flight</p></div>
            <div className="rounded-lg border p-3 text-center"><p className="text-xl font-bold text-amber-600">{local.transferQueue.filter((t) => t.status === 'blocked_offline').length}</p><p className="text-xs text-muted-foreground">pending (peer offline)</p></div>
            <div className="rounded-lg border p-3 text-center"><p className="text-xl font-bold text-red-600">{failed.length}</p><p className="text-xs text-muted-foreground">failed</p></div>
          </div>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => navigate('/app/sync')}>Open transfer queue <ArrowRight className="ml-1 h-3 w-3" /></Button>
        </SectionCard>
      </div>

      {/* fleet table */}
      <SectionCard title={`Device fleet — ${peers.length} computers`} description="Statuses are this computer's knowledge. Pairing, trust and sync state per peer.">
        <DataTable
          rows={peers}
          rowKey={(d) => d.id}
          searchable
          searchKeys={(d) => `${d.name} ${d.id} ${d.ip}`}
          pageSize={10}
          filters={[
            { key: 'status', label: 'Connectivity', options: [{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }, { value: 'unpaired', label: 'Unpaired' }], match: (d, v) => v === 'online' ? d.online && d.paired : v === 'offline' ? !d.online : !d.paired },
            { key: 'os', label: 'OS', options: [{ value: 'windows', label: 'Windows' }, { value: 'macos', label: 'macOS' }], match: (d, v) => d.os === v },
          ]}
          bulkActions={(selected, clear) => (
            <>
              <Button size="sm" variant="outline" onClick={() => { selected.forEach((d) => { if (!d.paired) store.pairDevice((d as Device).id); }); clear(); toast.success(`Paired ${selected.length} device(s)`); }}>Pair selected</Button>
              <Button size="sm" variant="outline" onClick={() => { store.syncWithPeers(selected.map((d) => (d as Device).id), ['question_bank', 'school_settings']); clear(); toast.success(`Sync queued for ${selected.length} peer(s)`); }}>Sync selected</Button>
            </>
          )}
          onRowClick={(d) => store.navigate(`/app/computers/${d.id}`)}
          columns={[
            {
              key: 'name', header: 'Computer', sortable: true, render: (d) => (
                <div>
                  <p className="font-medium">{d.name} {store.activeDeviceId === d.id && <Badge className="ml-1 text-[9px]">THIS PC</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{d.id} · {d.ip}</p>
                </div>
              ),
            },
            { key: 'online', header: 'Connectivity', render: (d) => (
              <span className={`flex items-center gap-1.5 text-xs font-medium ${d.online && store.world.network.lanOnline ? 'text-emerald-600' : 'text-red-500'}`}>
                {d.online && store.world.network.lanOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {d.online ? (store.world.network.lanOnline ? 'online' : 'LAN down') : 'offline'}
              </span>
            ) },
            { key: 'paired', header: 'Trust', render: (d) => d.paired ? <StatusBadge status="trusted" label="paired" /> : <StatusBadge status="unpaired" label="unpaired" /> },
            { key: 'appVersion', header: 'App', render: (d) => <Badge variant="outline" className="text-[10px]">v{d.appVersion}</Badge> },
            { key: 'lastSeen', header: 'Last seen', render: (d) => <span className="text-xs text-muted-foreground">{fmtRelative(d.lastSeen)}</span> },
            { key: 'dbHealth', header: 'Health', render: (d) => <StatusBadge status={d.dbHealth} label={d.dbHealth === 'warning' ? 'storage low' : d.dbHealth} /> },
            { key: 'storage', header: 'Storage', render: (d) => <span className="text-xs text-muted-foreground">{(d.storageUsedMb / 1024).toFixed(1)} GB</span> },
          ]}
        />
      </SectionCard>

      {/* discovery dialog */}
      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Peer discovery</DialogTitle><DialogDescription>Scan the LAN or connect by IP. Device identity is verified before pairing.</DialogDescription></DialogHeader>
          <div className="flex gap-2">
            <Button onClick={scan} disabled={scanning}><ScanLine className="mr-1.5 h-4 w-4" /> {scanning ? 'Scanning…' : 'Scan LAN'}</Button>
            <div className="flex flex-1 gap-2">
              <Input value={manualIp} onChange={(e) => setManualIp(e.target.value)} placeholder="Manual IP, e.g. 192.168.8.196" aria-label="Manual IP" />
              <Button variant="outline" onClick={connectManual}>Connect</Button>
            </div>
          </div>
          <div className="min-h-32 space-y-2">
            {scanning && <p className="py-8 text-center text-sm text-muted-foreground"><span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent align-[-2px]" />Probing 192.168.8.0/24 …</p>}
            {!scanning && discovered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No unpaired computers found yet. Run a scan or try a manual IP (e.g. 192.168.8.196 — DEV-096).</p>}
            {discovered.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{d.name} <span className="text-muted-foreground">({d.id})</span></p>
                  <p className="text-xs text-muted-foreground">{d.ip} · {d.os === 'macos' ? 'macOS' : 'Windows'} · app v{d.appVersion} · fingerprint ed25519:{d.id.slice(-4)}…</p>
                </div>
                <Button size="sm" onClick={() => { store.pairDevice(d.id); setDiscovered((ds) => ds.filter((x) => x.id !== d.id)); }}>Pair & trust</Button>
              </div>
            ))}
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-500" /> Firewall troubleshooting: ensure inbound TCP {device?.port} is allowed on the peer. Discovery uses multicast; it is blocked on some Wi-Fi APs — use manual IP then.
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Device detail
// ============================================================

export function DeviceDetailScreen() {
  const store = useDemoStore();
  const navigate = store.navigate;
  const id = store.route.params.id;
  const d = store.world.devices[id];
  const local = store.local();
  if (!d) return <EmptyState title="Device not found" />;
  const transfers = local.transferQueue.filter((t) => t.fromDeviceId === id || t.toDeviceId === id);
  const pkgCount = Object.keys(store.world.locals[id]?.examPackages ?? {}).length;

  return (
    <div>
      <PageHeader
        title={`${d.name} — ${d.id}`}
        description={`${d.os === 'macos' ? 'macOS' : 'Windows'} peer · ${d.ip}:${d.port} · app v${d.appVersion}`}
        crumbs={[{ label: 'Computers & Sync', onClick: () => navigate('/app/computers') }, { label: d.name }]}
        icon={<MonitorSmartphone className="h-5 w-5" />}
        actions={
          <>
            {d.paired ? (
              <Button size="sm" variant="outline" onClick={() => { store.unpairDevice(d.id); toast('Pairing revoked', { description: 'This peer can no longer send or receive authorized payloads.' }); }}><Unplug className="mr-1.5 h-4 w-4" /> Revoke pairing</Button>
            ) : (
              <Button size="sm" onClick={() => { store.pairDevice(d.id); toast.success(`${d.name} paired`); }}><PlugZap className="mr-1.5 h-4 w-4" /> Pair device</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => store.setDeviceOnline(d.id, !d.online)}>{d.online ? 'Simulate disconnect' : 'Simulate reconnect'}</Button>
            <Button size="sm" onClick={() => { store.syncWithPeers([d.id], ['question_bank', 'student_records', 'school_settings']); toast.success(`Sync queued → ${d.name}`); }}><RefreshCcw className="mr-1.5 h-4 w-4" /> Sync with this peer</Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Identity & trust">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Device ID</span><span className="font-mono">{d.id}</span></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Address</span><span className="font-mono">{d.ip}:{d.port}</span></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Paired / trusted</span><span>{d.paired ? 'Yes' : 'No'}</span></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Status</span><StatusBadge status={d.online ? 'online' : 'offline'} /></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Last seen</span><span>{fmtRelative(d.lastSeen)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">School</span><span>{store.world.schools[d.schoolId]?.shortName}</span></div>
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Note: computers have no permanent role. “Current session” below is temporary — any user with the right permissions can sign in here.</p>
            <div className="rounded-md border p-2 text-xs">
              <p className="font-medium">Current session (if any)</p>
              <p className="text-muted-foreground">{store.world.locals[d.id] ? 'Session data is per-device and only visible on the device itself.' : '—'}</p>
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Local data on this peer">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Exam packages" value={pkgCount} sub="approved deliveries" />
            <StatCard label="Questions" value={Object.keys(store.world.locals[id]?.questions ?? {}).length} sub="local copies" />
            <StatCard label="Attempts taken here" value={store.world.locals[id]?.attempts.length ?? 0} />
            <StatCard label="Submissions collected" value={store.world.locals[id]?.submissions.length ?? 0} />
          </div>
        </SectionCard>
        <SectionCard title="Transfers involving this peer" description="From this computer's transfer queue">
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {transfers.length === 0 && <p className="text-xs text-muted-foreground">No recent transfers.</p>}
            {transfers.slice(0, 12).map((t) => (
              <div key={t.id} className="rounded border px-2.5 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{t.payloadLabel}</span>
                  <StatusBadge status={t.status} label={TRANSFER_STATUS_LABELS[t.status]} />
                </div>
                <p className="mt-0.5 text-muted-foreground">{t.fromDeviceId} → {t.toDeviceId} · {fmtRelative(t.createdAt)}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ============================================================
// Sync centre — transfer queue + operations
// ============================================================

export function SyncCentreScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const device = store.currentDevice();
  const peers = Object.values(store.world.devices).filter((d) => d.schoolId === device.schoolId && d.paired && d.id !== store.activeDeviceId);
  const [targets, setTargets] = React.useState<Set<string>>(new Set());
  const [payloads, setPayloads] = React.useState<Set<string>>(new Set(['question_bank']));
  const [collectOpen, setCollectOpen] = React.useState(false);
  const [collectTargets, setCollectTargets] = React.useState<Set<string>>(new Set());

  const queue = local.transferQueue;
  const active = queue.filter((t) => ['queued', 'transferring', 'blocked_offline', 'failed'].includes(t.status));
  const history = local.syncHistory;

  return (
    <div>
      <PageHeader
        title="Sync centre"
        description="Push and pull authorized data between peers. Operations respect your permissions and the receiving device's authorization."
        icon={<RefreshCcw className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => { store.syncWithPeers(peers.map((d) => d.id), ['question_bank', 'school_settings']); toast.success(`Sync-everything queued → ${peers.length} peers`); }}>Sync everything permitted</Button>
            <Button size="sm" onClick={() => setCollectOpen(true)}><Download className="mr-1.5 h-4 w-4" /> Collect results</Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title={`Transfer queue (${active.length} active)`} description="Live simulated transfers — progress updates every second.">
            {active.length === 0 ? (
              <EmptyState title="Queue is empty" description="Start a sync, distribute an assessment, or submit results to see transfers here." icon={<RefreshCcw className="h-6 w-6" />} />
            ) : (
              <div className="max-h-80 space-y-1.5 overflow-y-auto">
                {active.slice(0, 40).map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{t.payloadLabel}</p>
                      <p className="text-[11px] text-muted-foreground">{t.direction === 'outgoing' ? '→' : '←'} {t.direction === 'outgoing' ? t.toDeviceId : t.fromDeviceId} · {t.sizeKb < 1024 ? `${t.sizeKb} KB` : `${(t.sizeKb / 1024).toFixed(1)} MB`} · initiated by {t.initiatedBy}</p>
                      {t.errorNote && <p className="mt-0.5 text-[11px] text-amber-600">{t.errorNote}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <TransferProgress progress={t.progress} speedMbps={t.speedMbps} status={t.status} />
                      {t.status === 'failed' || t.status === 'blocked_offline' ? (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => { store.retryTransfer(t.id); toast('Retry queued'); }}><RefreshCcw className="mr-1 h-3 w-3" /> Retry</Button>
                      ) : (
                        <StatusBadge status={t.status} label={TRANSFER_STATUS_LABELS[t.status]} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Sync history" description="Recent transfer events recorded locally">
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {history.length === 0 && <p className="text-xs text-muted-foreground">No sync events recorded on this computer yet.</p>}
              {history.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
                  <div><p>{e.label}</p><p className="text-muted-foreground">{fmtDateTime(e.at)} · by {e.initiatedBy}</p></div>
                  <StatusBadge status={e.outcome} label={e.outcome} />
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Push data to peers">
            <div className="space-y-2.5">
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">DATA TO SEND</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ['question_bank', 'Question banks (approved)'],
                    ['student_records', 'Student records'],
                    ['staff_records', 'Staff records'],
                    ['permissions', 'Permissions & identity'],
                    ['school_settings', 'School settings'],
                  ].map(([k, l]) => (
                    <button key={k} onClick={() => setPayloads((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className={`rounded-full border px-2.5 py-1 text-xs ${payloads.has(k) ? 'border-primary bg-primary/10 text-primary' : ''}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">RECEIVING COMPUTERS ({targets.size} selected)</p>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {peers.slice(0, 30).map((d) => (
                    <label key={d.id} className="flex items-center gap-2 rounded p-1 text-xs hover:bg-accent">
                      <input type="checkbox" className="accent-[var(--primary)]" checked={targets.has(d.id)} onChange={(e) => setTargets((s) => { const n = new Set(s); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} />
                      <span className="flex-1 truncate">{d.name} <span className="text-muted-foreground">{d.id}</span></span>
                      <span className={`h-1.5 w-1.5 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-red-400'}`} />
                    </label>
                  ))}
                </div>
              </div>
              <Button size="sm" className="w-full" disabled={targets.size === 0 || payloads.size === 0} onClick={() => { store.syncWithPeers(Array.from(targets), Array.from(payloads)); toast.success(`${payloads.size} payload type(s) queued → ${targets.size} peer(s)`); }}>
                <Send className="mr-1.5 h-4 w-4" /> Start sync
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">Restricted payloads (student/staff records) are only accepted by peers whose operator holds the matching authorization. Anything else is rejected and audited — see the conflict module for a real example.</p>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* collect dialog */}
      <Dialog open={collectOpen} onOpenChange={setCollectOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Collect results from peers</DialogTitle>
            <DialogDescription>Pulls verified submission records from selected computers into this one. Duplicates are recognised by content hash and never counted twice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{collectTargets.size} peers selected</p>
              <Button size="sm" variant="outline" onClick={() => setCollectTargets(new Set(peers.filter((d) => d.online).map((d) => d.id)))}>Select all reachable ({peers.filter((d) => d.online).length})</Button>
            </div>
            <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {peers.map((d) => {
                const attempts = store.world.locals[d.id]?.attempts.filter((a) => a.status !== 'in_progress') ?? [];
                return (
                  <label key={d.id} className={`flex items-center gap-2 rounded border p-2 text-xs ${collectTargets.has(d.id) ? 'border-primary bg-primary/5' : ''}`}>
                    <input type="checkbox" className="accent-[var(--primary)]" checked={collectTargets.has(d.id)} onChange={(e) => setCollectTargets((s) => { const n = new Set(s); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} />
                    <span className="flex-1 truncate">{d.name}</span>
                    <Badge variant="outline" className="text-[9px]">{attempts.length} attempt(s)</Badge>
                    <span className={`h-1.5 w-1.5 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-red-400'}`} />
                  </label>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectOpen(false)}>Cancel</Button>
            <Button disabled={collectTargets.size === 0} onClick={() => {
              // collect for each controlled assessment
              const controlled = Object.values(local.assessments).filter((a) => a.access === 'controlled');
              controlled.forEach((a) => store.collectResults(a.id, Array.from(collectTargets)));
              setCollectOpen(false);
              toast.success(`Collection started from ${collectTargets.size} peers`, { description: 'Offline peers are queued and retry automatically on reconnection.' });
            }}><Download className="mr-1.5 h-4 w-4" /> Collect now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Conflicts
// ============================================================

const CONFLICT_TYPE_LABELS: Record<ConflictCase['type'], string> = {
  question_edited_both_sides: 'Question edited on both sides',
  assessment_revision_divergence: 'Draft revision divergence',
  published_edited_after_approval: 'Approved assessment modified',
  duplicate_submission: 'Duplicate submission',
  unauthorized_restricted_payload: 'Unauthorized payload',
  delete_vs_edit: 'Delete vs edit',
};

export function ConflictsScreen() {
  const store = useDemoStore();
  const local = store.local();
  const conflicts = local.conflicts;
  const [detail, setDetail] = React.useState<ConflictCase | null>(null);
  const [note, setNote] = React.useState('');
  const canResolve = store.can('conflicts.resolve');

  return (
    <div>
      <PageHeader
        title="Sync conflicts"
        description="Divergent copies detected during synchronization. Resolutions are versioned, audited and never silently overwrite published records."
        icon={<GitMerge className="h-5 w-5" />}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open" value={conflicts.filter((c) => c.status === 'open').length} tone="warning" icon={<AlertTriangle className="h-4 w-4" />} />
        <StatCard label="Resolved" value={conflicts.filter((c) => c.status === 'resolved').length} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Deferred" value={conflicts.filter((c) => c.status === 'deferred').length} icon={<Clock className="h-4 w-4" />} />
        <StatCard label="Duplicate submissions kept once" value={conflicts.filter((c) => c.type === 'duplicate_submission').length} tone="info" icon={<Layers className="h-4 w-4" />} />
      </div>

      {conflicts.length === 0 ? (
        <EmptyState title="No conflicts on this computer" description="Conflicts appear when the sync engine finds divergent copies of the same record." />
      ) : (
        <div className="space-y-3">
          {conflicts.map((c) => (
            <div key={c.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{c.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.id} · {CONFLICT_TYPE_LABELS[c.type]} · {c.affectedRecord} · detected {fmtRelative(c.detectedAt)}</p>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{c.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={c.status} />
                  {c.status === 'open' && (
                    <Button size="sm" variant="outline" onClick={() => setDetail(detail?.id === c.id ? null : c)}>{detail?.id === c.id ? 'Close' : 'Inspect & resolve'}</Button>
                  )}
                  {c.status === 'resolved' && c.resolution && (
                    <Badge variant="outline" className="text-emerald-600">resolved: {c.resolution.choice === 'a' ? 'kept version A' : c.resolution.choice === 'b' ? 'kept version B' : c.resolution.choice}</Badge>
                  )}
                </div>
              </div>
              {detail?.id === c.id && c.status === 'open' && (
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    {([['a', c.versionA], ['b', c.versionB]] as const).map(([side, v]) => (
                      <div key={side} className="rounded-lg border p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Version {side.toUpperCase()} — {v.label}</p>
                        <p className="mt-1 text-sm">{v.summary}</p>
                        <div className="mt-2 space-y-1">
                          {v.fields.map((f) => (
                            <div key={f.field} className="rounded bg-muted/50 p-1.5 text-xs"><strong>{f.field}:</strong> {f.value}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                    <CircleDot className="mr-1 inline h-3.5 w-3.5" /> Suggested resolution: {c.suggestedResolution}
                  </div>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note (recorded in the audit trail)…" aria-label="Resolution note" />
                  {canResolve ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => { store.resolveConflict(c.id, 'a', note || 'Kept version A'); setDetail(null); setNote(''); toast.success('Conflict resolved — version A kept'); }}>Keep version A</Button>
                      <Button size="sm" onClick={() => { store.resolveConflict(c.id, 'b', note || 'Kept version B'); setDetail(null); setNote(''); toast.success('Conflict resolved — version B kept'); }}>Keep version B</Button>
                      <Button size="sm" variant="outline" onClick={() => { store.resolveConflict(c.id, 'merge', note || 'Manual merge applied'); setDetail(null); setNote(''); toast.success('Merged manually'); }}>Manual merge</Button>
                      <Button size="sm" variant="outline" onClick={() => { store.resolveConflict(c.id, 'both', note || 'Both versions preserved'); setDetail(null); setNote(''); toast.success('Both versions preserved'); }}>Preserve both</Button>
                      <Button size="sm" variant="ghost" onClick={() => { store.deferConflict(c.id); setDetail(null); toast('Deferred — this conflict will resurface on next sync'); }}>Defer</Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Your role does not include conflict resolution. Ask an administrator to resolve this case.</p>
                  )}
                </div>
              )}
              {c.status === 'resolved' && c.resolution && (
                <div className="mt-3 grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-2">
                  <div><p className="text-xs font-semibold text-muted-foreground">BEFORE</p><p className="mt-1 text-sm">{c.resolution.before}</p></div>
                  <div><p className="text-xs font-semibold text-muted-foreground">AFTER</p><p className="mt-1 text-sm">{c.resolution.after}</p></div>
                  <p className="text-xs text-muted-foreground md:col-span-2">Resolved by {c.resolution.resolvedBy} · {fmtDateTime(c.resolution.resolvedAt)} · “{c.resolution.note}”</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
