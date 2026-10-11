'use client';

/** Exam sessions — calendar/list, live monitoring (100 candidates), invigilation */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { PageHeader, StatCard, SectionCard, StatusBadge, DataTable, EmptyState, AccessDenied } from '../shared/ui-kit';
import { ASSESSMENT_STATUS_LABELS, fmtDateTime, fmtRelative } from '@/lib/prototype/ui-utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  MonitorPlay, CalendarDays, Users, Wifi, WifiOff, AlertTriangle, Search, PlayCircle, PauseCircle,
  ClipboardCheck, ShieldCheck, Radio, CircleCheck, Timer, Download, CircleDot,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================
// Exam sessions list
// ============================================================

export function ExamSessionsScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const controlled = Object.values(local.assessments).filter((a) => a.access === 'controlled')
    .sort((a, b) => b.startAt.localeCompare(a.startAt));

  return (
    <div>
      <PageHeader
        title="Examination sessions"
        description="Live and scheduled sessions, device readiness and invigilation controls."
        icon={<MonitorPlay className="h-5 w-5" />}
        actions={<Button size="sm" variant="outline" onClick={() => navigate('/app/computers')}><Wifi className="mr-1.5 h-4 w-4" /> Device readiness</Button>}
      />
      {controlled.length === 0 ? (
        <EmptyState title="No exam sessions known to this computer" description="Sessions appear once approved assessments are delivered or synced here." />
      ) : (
        <div className="space-y-3">
          {controlled.map((a) => {
            const pkg = local.examPackages[a.id];
            const attempts = local.attempts.filter((at) => at.assessmentId === a.id);
            const expected = 100;
            const live = ['distributed', 'active'].includes(a.status);
            return (
              <div key={a.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(a.startAt)} → {fmtDateTime(a.endAt)} · {a.durationMin} min · {store.world.subjects[a.subjectId]?.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={a.status} label={ASSESSMENT_STATUS_LABELS[a.status]} />
                      {pkg ? <Badge variant="outline" className="text-[10px]">package on this device</Badge> : <Badge variant="outline" className="text-[10px] text-amber-600">not delivered here</Badge>}
                      {live && <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"><Radio className="mr-1 h-3 w-3" /> LIVE</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => store.navigate(`/app/exams/${a.id}`)}>Monitor session</Button>
                    {store.can('exams.invigilate') && <Button size="sm" variant="outline" onClick={() => store.navigate(`/app/exams/${a.id}?invigilate=1`)}>Invigilate</Button>}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div><p className="text-xs text-muted-foreground">Expected candidates</p><p className="text-lg font-bold">{expected}</p></div>
                  <div><p className="text-xs text-muted-foreground">Attempts on this device</p><p className="text-lg font-bold">{attempts.length}</p></div>
                  <div><p className="text-xs text-muted-foreground">Submitted (this device)</p><p className="text-lg font-bold">{attempts.filter((x) => x.status !== 'in_progress').length}</p></div>
                  <div><p className="text-xs text-muted-foreground">Collected (school-wide)</p><p className="text-lg font-bold">{local.submissions.filter((s) => s.assessmentId === a.id).length}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Session monitoring detail — the 100-candidate roster
// ============================================================

const SS2_NAMES = (() => {
  // deterministic 100-candidate roster for the live view
  const arr: { id: string; name: string; classId: string; device: string }[] = [];
  for (let i = 0; i < 100; i++) {
    const cls = ['SS2 A', 'SS2 B', 'SS2 C', 'SS2 D'][i % 4];
    const dev = `DEV-${String(61 + (i % 40)).padStart(3, '0')}`;
    arr.push({ id: `cand-${i}`, name: `Candidate ${String(i + 1).padStart(3, '0')}`, classId: cls, device: dev });
  }
  return arr;
})();

export function ExamSessionDetailScreen() {
  const store = useDemoStore();
  const navigate = store.navigate;
  const local = store.local();
  const id = store.route.params.id || Object.keys(local.assessments)[0];
  const a = local.assessments[id];
  const isInvigilator = store.currentUser()?.role === 'invigilator';
  const [incidentOpen, setIncidentOpen] = React.useState(false);
  const [incidentText, setIncidentText] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [incidents, setIncidents] = React.useState<{ id: string; text: string; at: string }[]>([
    { id: 'INC-003', text: 'DEV-074 lost connection mid-exam — student auto-saved, resumed.', at: '2 min ago' },
    { id: 'INC-002', text: 'Timer freeze on DEV-063 — session restarted by invigilator.', at: '12 min ago' },
  ]);

  if (!a) return <EmptyState title="Session not found" description="This assessment is not stored on this computer." />;

  // live roster derived deterministically + real attempt state where it exists
  const roster = SS2_NAMES.map((c, i) => {
    const attempt = local.attempts.find((at) => at.assessmentId === a.id && at.studentId.includes(`-${String(i + 1).padStart(2, '0')}`) && at.studentId.startsWith('stu-'));
    const seededStatus = i < 58 ? 'submitted' : i < 62 ? 'in_progress' : i < 96 ? 'in_progress' : i === 96 ? 'absent' : i === 97 ? 'disconnected' : 'in_progress';
    const status = attempt ? (attempt.status === 'in_progress' ? 'in_progress' : 'submitted') : seededStatus;
    return { ...c, status, attemptId: attempt?.id };
  });
  const counts = {
    submitted: roster.filter((r) => r.status === 'submitted').length,
    active: roster.filter((r) => r.status === 'in_progress').length,
    absent: roster.filter((r) => r.status === 'absent').length,
    disconnected: roster.filter((r) => r.status === 'disconnected').length,
  };

  const filtered = roster.filter((r) => `${r.name} ${r.classId} ${r.device}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <PageHeader
        title={`Live session — ${a.name}`}
        description="Candidate roster, attendance, device status and permitted controls. Data reflects what this computer can see."
        crumbs={[{ label: 'Exam sessions', onClick: () => navigate('/app/exams') }, { label: 'Live' }]}
        icon={<MonitorPlay className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => toast.success('Attendance sheet exported (simulated)')}><Download className="mr-1.5 h-4 w-4" /> Export roster</Button>
            <Button size="sm" variant="outline" onClick={() => setIncidentOpen(true)}><AlertTriangle className="mr-1.5 h-4 w-4 text-amber-500" /> Log incident</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Submitted" value={counts.submitted} sub={`of 100 expected`} tone="success" icon={<CircleCheck className="h-4 w-4" />} />
        <StatCard label="Writing now" value={counts.active} sub="exams in progress" tone="info" icon={<PlayCircle className="h-4 w-4" />} />
        <StatCard label="Disconnected" value={counts.disconnected} sub="answers saved locally" tone="warning" icon={<WifiOff className="h-4 w-4" />} />
        <StatCard label="Absent" value={counts.absent} sub="not checked in" icon={<Users className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard
            title={`Candidate roster (${filtered.length})`}
            description="Search, filter and act on individual candidates."
            action={
              <div className="relative w-44"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find candidate…" className="h-8 pl-8 text-xs" /></div>
            }
          >
            <div className="max-h-96 space-y-1.5 overflow-y-auto">
              {filtered.map((c) => {
                const dev = store.world.devices[c.device];
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${c.status === 'submitted' ? 'bg-emerald-500' : c.status === 'in_progress' ? 'bg-sky-500 animate-pulse' : c.status === 'disconnected' ? 'bg-amber-500' : 'bg-red-300'}`} />
                      <span className="min-w-0"><strong className="truncate">{c.name}</strong> · {c.classId} · {c.device}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={`flex items-center gap-1 ${dev?.online ? 'text-emerald-600' : 'text-red-500'}`}>{dev?.online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}</span>
                      <StatusBadge status={c.status === 'in_progress' ? 'active' : c.status === 'submitted' ? 'completed' : c.status} label={c.status.replace('_', ' ')} />
                      {isInvigilator && c.status === 'in_progress' && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => toast(`Paused ${c.name} (simulated)`, { description: 'Invigilator pause — student must be resumed with approval.' })}><PauseCircle className="h-3 w-3" /></Button>
                      )}
                      {isInvigilator && c.status === 'disconnected' && (
                        <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => toast.success(`Resumption approved for ${c.name}`, { description: 'Extra time is recorded and audited.' })}>Approve resumption</Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Session progress">
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs"><span>Submission rate</span><span>{counts.submitted}/100</span></div>
                <Progress value={counts.submitted} className="h-2" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs"><span>Checked in</span><span>{100 - counts.absent}/100</span></div>
                <Progress value={100 - counts.absent} className="h-2" />
              </div>
              <p className="text-xs text-muted-foreground">Collection readiness: {counts.submitted === 100 ? 'All candidates submitted — ready to collect results.' : `${counts.submitted} of 100 submitted so far.`}</p>
              {counts.disconnected > 0 && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <WifiOff className="mr-1 inline h-3.5 w-3.5" /> {counts.disconnected} candidate device(s) offline. Their exams continue from the locally stored package; submissions sync on reconnection.
                </p>
              )}
            </div>
          </SectionCard>
          <SectionCard title="Incident log">
            <div className="space-y-2">
              {incidents.map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs">
                  <span><strong>{i.id}</strong> — {i.text}</span>
                  <span className="shrink-0 text-muted-foreground">{i.at}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>

      <Dialog open={incidentOpen} onOpenChange={setIncidentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log incident</DialogTitle><DialogDescription>Recorded on this computer and included in session reports.</DialogDescription></DialogHeader>
          <Input value={incidentText} onChange={(e) => setIncidentText(e.target.value)} placeholder="Describe what happened…" aria-label="Incident description" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidentOpen(false)}>Cancel</Button>
            <Button onClick={() => { if (incidentText.trim()) { setIncidents((is) => [{ id: `INC-${String(is.length + 1).padStart(3, '0')}`, text: incidentText.trim(), at: 'just now' }, ...is]); setIncidentOpen(false); setIncidentText(''); toast.success('Incident logged'); } }}>Log incident</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
