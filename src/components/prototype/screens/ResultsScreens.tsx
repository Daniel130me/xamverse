'use client';

/**
 * Results & marking — collection dashboard, essay marking with rubrics,
 * moderation, release, and analytics views (school / class / student).
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { PageHeader, StatCard, SectionCard, StatusBadge, DataTable, EmptyState, UserAvatar, AccessDenied } from '../shared/ui-kit';
import { fmtDateTime, fmtRelative, gradeBand } from '@/lib/prototype/ui-utils';
import { QuestionRenderer } from './ExamRunner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  ClipboardCheck, RefreshCcw, Download, Send, CheckCircle2, AlertTriangle, Users, TrendingUp,
  FileText, Printer, Search, CircleCheck, BarChart3, GraduationCap, PenLine, ShieldCheck, X,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend,
} from 'recharts';
import { toast } from 'sonner';
import type { ExamAttempt, Question } from '@/lib/prototype/types';

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {label && <p className="mb-0.5 font-medium">{label}</p>}
      {payload.map((p, i) => <p key={i} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <strong>{p.value}</strong></p>)}
    </div>
  );
}

// ============================================================
// Results hub — collection dashboard
// ============================================================

export function ResultsScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const isStudent = store.currentUser()?.role === 'student';
  const isParent = store.currentUser()?.role === 'parent';

  // student/parent personal view
  if (isStudent || isParent) {
    const me = store.currentUser()!;
    const ids = isParent ? (me.childrenIds ?? []) : [me.id];
    const attempts = local.attempts.filter((a) => ids.includes(a.studentId));
    return (
      <div>
        <PageHeader title="My results" description="Released results only. This view reads the local records of this computer." icon={<ClipboardCheck className="h-5 w-5" />} />
        {attempts.length === 0 ? (
          <EmptyState title="No results on this computer" description="Results appear once the school releases them and the records sync to this device." />
        ) : (
          <div className="space-y-3">
            {attempts.map((a) => (
              <div key={a.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{a.assessmentName}</p>
                    <p className="text-xs text-muted-foreground">Submitted {fmtRelative(a.submittedAt)} · taken on {a.deviceId}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-2xl font-bold">{a.status === 'published' ? `${a.autoScore + a.manualScore}/${a.totalMarks}` : '—'}</p>
                      <p className="text-xs text-muted-foreground">{a.status === 'published' ? `${a.percentage}%` : 'results pending release'}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                </div>
                {a.status === 'published' && (
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => navigate(`/app/results/marking?attempt=${a.id}&review=1`)}>Review answers & feedback</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // staff view — the collection dashboard
  const assessments = Object.values(local.assessments).filter((a) => a.access === 'controlled');
  const byAssessment = assessments.map((a) => {
    const subs = local.submissions.filter((s) => s.assessmentId === a.id);
    const expected = 100;
    return { a, collected: subs.length, expected, outstanding: Math.max(0, expected - subs.length), duplicates: subs.filter((s) => s.duplicateOf).length };
  });

  return (
    <div>
      <PageHeader
        title="Results & marking"
        description={`Collection, marking and moderation. Submissions stored on ${store.activeDeviceId} — other peers may hold more or fewer.`}
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => navigate('/app/sync')}><RefreshCcw className="mr-1.5 h-4 w-4" /> Collect from peers</Button>}
      />
      <div className="space-y-3">
        {byAssessment.map(({ a, collected, expected, outstanding }) => (
          <div key={a.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{a.name}</p>
                <p className="text-xs text-muted-foreground">{store.world.subjects[a.subjectId]?.name} · expected {expected} candidates</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate('/app/results/marking')}>Marking queue</Button>
                {store.can('results.approve_release') && <Button size="sm" onClick={() => navigate('/app/results/publish')}>Moderate & release</Button>}
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs"><span>Collection progress</span><span>{collected}/{expected} {outstanding > 0 ? `· ${outstanding} outstanding` : '· complete'}</span></div>
              <Progress value={(collected / expected) * 100} className="h-2" />
            </div>
            {outstanding > 0 && (
              <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {outstanding} result(s) outstanding — candidates\u2019 devices may be offline or their submissions not yet replicated. Missing results stay visible until collected.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4">
        <SectionCard title="Recent submissions (verified)" description={`Local copy on this computer`}>
          <DataTable
            rows={local.submissions.slice(0, 40)}
            rowKey={(s) => s.id}
            searchable
            searchKeys={(s) => `${s.studentName} ${s.assessmentId}`}
            pageSize={8}
            filters={[
              { key: 'assessment', label: 'Assessment', options: [...new Set(local.submissions.map((s) => s.assessmentId))].map((id) => ({ value: id, label: local.assessments[id]?.name ?? id })), match: (s, v) => s.assessmentId === v },
            ]}
            columns={[
              { key: 'studentName', header: 'Student', sortable: true, render: (s) => <span className="font-medium">{s.studentName}</span> },
              { key: 'assessmentId', header: 'Assessment', render: (s) => <span className="text-xs">{local.assessments[s.assessmentId]?.name ?? s.assessmentId}</span> },
              { key: 'score', header: 'Score', sortable: true, render: (s) => <strong>{s.score}/{s.totalMarks}</strong> },
              { key: 'receivedFromDeviceId', header: 'From peer', render: (s) => <span className="text-xs font-mono">{s.receivedFromDeviceId}</span> },
              { key: 'receivedAt', header: 'Received', render: (s) => <span className="text-xs text-muted-foreground">{fmtRelative(s.receivedAt)}</span> },
              { key: 'verified', header: 'Status', render: (s) => s.duplicateOf ? <StatusBadge status="duplicate" label="duplicate — not counted" /> : <StatusBadge status="success" label="verified" /> },
            ]}
            emptyState={<EmptyState title="No submissions on this computer" description="Use Collect from peers to pull verified submissions into this device." />}
          />
        </SectionCard>
      </div>
    </div>
  );
}

// ============================================================
// Marking queue + essay marking
// ============================================================

export function MarkingScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const urlAttempt = store.route.params.id;
  const reviewMode = store.route.params.review === '1';

  const markable = local.attempts.filter((a) => a.status === 'submitted' || (reviewMode && a.id === urlAttempt));
  const attempt = urlAttempt ? local.attempts.find((a) => a.id === urlAttempt) : null;

  if (attempt && (reviewMode || attempt.status === 'submitted')) {
    return <MarkingDetail attempt={attempt} />;
  }

  return (
    <div>
      <PageHeader
        title="Marking queue"
        description="Essay and manually-marked responses awaiting rubric-based grading. Objective questions are auto-marked on submission."
        crumbs={[{ label: 'Results & marking', onClick: () => navigate('/app/results') }, { label: 'Marking' }]}
        icon={<PenLine className="h-5 w-5" />}
      />
      <DataTable
        rows={markable}
        rowKey={(a) => a.id}
        searchable
        searchKeys={(a) => `${a.studentName} ${a.assessmentName}`}
        columns={[
          {
            key: 'studentName', header: 'Student', sortable: true, render: (a) => (
              <div className="flex items-center gap-2"><UserAvatar name={a.studentName} hue={(a.studentId.length * 47) % 360} size="sm" /><div><p className="font-medium">{a.studentName}</p><p className="text-xs text-muted-foreground">{a.className}</p></div></div>
            ),
          },
          { key: 'assessmentName', header: 'Assessment', render: (a) => <span className="text-xs">{a.assessmentName}</span> },
          { key: 'essays', header: 'Essays', render: (a) => <Badge variant="outline">{(a.essayQuestionIds ?? []).length} to mark</Badge> },
          { key: 'autoScore', header: 'Auto score', render: (a) => <span className="tabular-nums">{a.autoScore}/{a.totalMarks}</span> },
          { key: 'submittedAt', header: 'Submitted', render: (a) => <span className="text-xs text-muted-foreground">{fmtRelative(a.submittedAt)}</span> },
          { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
          { key: 'actions', header: '', render: (a) => <Button size="sm" onClick={() => navigate(`/app/results/marking/${a.id}`)}>Mark now</Button> },
        ]}
        emptyState={<EmptyState title="Nothing to mark" description="Submitted essays appear here. On other computers their submissions may still be pending transfer." icon={<PenLine className="h-6 w-6" />} />}
      />
    </div>
  );
}

function MarkingDetail({ attempt }: { attempt: ExamAttempt }) {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const reviewMode = store.route.params.review === '1';
  const a = local.assessments[attempt.assessmentId];
  const pkg = local.examPackages[attempt.assessmentId];
  const questions = ((a?.questionIds ?? []).map((qid) => local.questions[qid] ?? pkg?.questionPayload?.[qid]).filter(Boolean)) as Question[];
  const essays = questions.filter((q) => q.type === 'essay');
  const [marks, setMarks] = React.useState<Record<string, number>>({});
  const [comments, setComments] = React.useState<Record<string, string>>({});

  const submitMarks = () => {
    essays.forEach((q) => {
      const m = marks[q.id];
      if (m !== undefined) store.gradeEssay(attempt.id, q.id, m, comments[q.id] ?? '');
    });
    toast.success('Marks saved', { description: 'Attempt moved through moderation once all essays are graded.' });
    navigate('/app/results/marking');
  };

  return (
    <div>
      <PageHeader
        title={`${attempt.studentName} — ${attempt.assessmentName}`}
        description={`${attempt.className} · auto-scored ${attempt.autoScore}/${attempt.totalMarks} · ${(attempt.essayQuestionIds ?? []).length} essay(s) ${reviewMode ? '· REVIEW MODE (released result)' : ''}`}
        crumbs={[{ label: 'Marking', onClick: () => navigate('/app/results/marking') }, { label: attempt.studentName }]}
        icon={<PenLine className="h-5 w-5" />}
        actions={!reviewMode && <Button size="sm" onClick={submitMarks}><CheckCircle2 className="mr-1.5 h-4 w-4" /> Submit marks</Button>}
      />
      <div className="space-y-4">
        {questions.map((q, i) => {
          const rec = attempt.answers[q.id];
          return (
            <SectionCard key={q.id} title={`Q${i + 1} · ${q.marks} marks · ${q.topic}`}>
              <QuestionRenderer question={q} attemptAnswers={attempt.answers} readOnly showCorrect={false} />
              {q.type === 'essay' ? (
                <div className="mt-4 rounded-lg border bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-semibold">RUBRIC</p>
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">{q.explanation}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div><p className="text-xs font-medium">Award marks</p><Input type="number" min={0} max={q.marks} className="mt-1" value={marks[q.id] ?? ''} onChange={(e) => setMarks((m) => ({ ...m, [q.id]: Number(e.target.value) }))} aria-label={`Marks for Q${i + 1}`} /></div>
                    <div className="sm:col-span-2"><p className="text-xs font-medium">Examiner comment</p><Textarea rows={2} className="mt-1" value={comments[q.id] ?? ''} onChange={(e) => setComments((c) => ({ ...c, [q.id]: e.target.value }))} placeholder="Feedback shown with the released result…" aria-label={`Comment for Q${i + 1}`} /></div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 text-sm">
                  {rec?.autoCorrect ? (
                    <span className="flex items-center gap-1.5 text-emerald-600"><CircleCheck className="h-4 w-4" /> Auto-marked: {rec.autoMarks}/{q.marks}</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-red-600"><X className="h-4 w-4" /> Auto-marked: {rec?.autoMarks ?? 0}/{q.marks}</span>
                  )}
                </div>
              )}
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Moderate & release
// ============================================================

export function ResultsPublishScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const publishable = Object.values(local.assessments).filter((a) => ['marking', 'awaiting_result_approval'].includes(a.status));
  const [confirm, setConfirm] = React.useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="Moderation & release"
        description="Review marked results, apply adjustments, then release to students. Release is audited and irreversible."
        crumbs={[{ label: 'Results & marking', onClick: () => navigate('/app/results') }, { label: 'Moderate & release' }]}
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      {publishable.length === 0 ? (
        <EmptyState title="Nothing awaiting release on this computer" description="Assessments in the marking stage appear here. Note: results on other computers may be further along." />
      ) : (
        <div className="space-y-3">
          {publishable.map((a) => {
            const subs = local.submissions.filter((s) => s.assessmentId === a.id);
            const passCount = subs.filter((s) => s.score >= (a.totalMarks * a.passMark) / 100).length;
            const avg = subs.length ? Math.round((subs.reduce((s, x) => s + x.score, 0) / subs.length / a.totalMarks) * 100) : 0;
            return (
              <div key={a.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{subs.length} collected submissions · average {avg}% · {passCount} above pass mark</p>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => navigate('/app/results/marking')}><PenLine className="mr-1.5 h-4 w-4" /> Open marking</Button>
                    <Button size="sm" variant="outline" onClick={() => toast.success('Result sheet exported (simulated)', { description: 'Excel-compatible CSV saved to local exports.' })}><Download className="mr-1.5 h-4 w-4" /> Export sheet</Button>
                    <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" /> Print score sheet</Button>
                    <Button size="sm" onClick={() => setConfirm(a.id)}><Send className="mr-1.5 h-4 w-4" /> Release results</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Release results?</DialogTitle><DialogDescription>Students will see scores and feedback according to the assessment\u2019s policy. This action is recorded in the audit log.</DialogDescription></DialogHeader>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Releasing publishes results on this computer and flags the assessment as “Results released”. Peers learn of the release after synchronization.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button onClick={() => { if (confirm) { store.publishResults(confirm); setConfirm(null); toast.success('Results released', { description: 'Students see them after the release syncs to their devices.' }); } }}>Release now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Analytics
// ============================================================

export function AnalyticsScreen() {
  const store = useDemoStore();
  const local = store.local();
  const user = store.currentUser()!;
  const navigate = store.navigate;
  const isStudent = user.role === 'student';
  const isParent = user.role === 'parent';
  const subjectFilter = Object.values(store.world.subjects);
  const [subject, setSubject] = React.useState('all');

  const attempts = local.attempts.filter((a) => a.status === 'published' || a.status === 'marked');
  const filtered = subject === 'all' ? attempts : attempts.filter((a) => local.assessments[a.assessmentId]?.subjectId === subject);

  const dist = [
    { band: 'A (75+)', count: filtered.filter((a) => (a.percentage ?? 0) >= 75).length },
    { band: 'B (65–74)', count: filtered.filter((a) => (a.percentage ?? 0) >= 65 && (a.percentage ?? 0) < 75).length },
    { band: 'C (50–64)', count: filtered.filter((a) => (a.percentage ?? 0) >= 50 && (a.percentage ?? 0) < 65).length },
    { band: 'D/E (40–49)', count: filtered.filter((a) => (a.percentage ?? 0) >= 40 && (a.percentage ?? 0) < 50).length },
    { band: 'F (<40)', count: filtered.filter((a) => (a.percentage ?? 0) < 40 && a.percentage !== undefined).length },
  ];
  const gradePie = dist.map((d, i) => ({ name: d.band, value: d.count, color: ['#0d9488', '#84cc16', '#f59e0b', '#f97316', '#ef4444'][i] })).filter((d) => d.value > 0);
  const classPerf = Object.values(store.world.classes).filter((c) => c.id.startsWith('cls-ss2')).map((c, i) => ({
    name: c.name,
    avg: 55 + ((c.id.length * 17 + i * 13) % 30),
    pass: 60 + ((i * 11) % 25),
  }));
  const topicMastery = [
    { topic: 'Algebraic fractions', mastery: 72 }, { topic: 'Indices & logs', mastery: 64 },
    { topic: 'Circle geometry', mastery: 51 }, { topic: 'Statistics', mastery: 78 },
    { topic: 'Sequences', mastery: 66 }, { topic: 'Surds', mastery: 59 },
  ];
  const under = filtered.filter((a) => (a.percentage ?? 100) < 45).slice(0, 8);

  if (isStudent || isParent) {
    const me = isParent ? store.world.users[(user.childrenIds ?? [])[0]] : user;
    const mine = local.attempts.filter((a) => a.studentId === me?.id && a.status === 'published');
    const trend = mine.map((a, i) => ({ name: a.assessmentName.split('—').pop()?.trim().slice(0, 12) ?? `#${i + 1}`, score: a.percentage ?? 0 }));
    return (
      <div>
        <PageHeader title={`Progress — ${me?.name ?? 'Student'}`} description="Personal performance analytics built from released results on this computer." icon={<TrendingUp className="h-5 w-5" />} />
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Score trend">
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={trend} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} />
                <YAxis tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} domain={[0, 100]} />
                <RTooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="score" stroke="#0d9488" strokeWidth={2.5} name="Score %" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>
          <SectionCard title="Topic mastery">
            <ResponsiveContainer width="100%" height={230}>
              <RadarChart data={topicMastery} outerRadius="70%">
                <PolarGrid stroke="currentColor" opacity={0.15} />
                <PolarAngleAxis dataKey="topic" tick={{ fontSize: 9 }} />
                <Radar dataKey="mastery" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.35} name="Mastery %" />
                <RTooltip content={<ChartTip />} />
              </RadarChart>
            </ResponsiveContainer>
          </SectionCard>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <StatCard label="Attempts recorded" value={mine.length} sub="released results only" />
          <StatCard label="Strongest topic" value="Statistics" sub="78% mastery" tone="success" icon={<TrendingUp className="h-4 w-4" />} />
          <StatCard label="Focus area" value="Circle geometry" sub="51% mastery — practice recommended" tone="warning" icon={<BarChart3 className="h-4 w-4" />} onClick={() => navigate('/practice')} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Analytics & reports"
        description={`Class, subject and question-level analytics from results stored on ${store.activeDeviceId}.`}
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <>
            <select className="h-9 rounded-md border bg-background px-3 text-xs" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject filter">
              <option value="all">All subjects</option>
              {subjectFilter.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={() => toast.success('Result sheets exported (simulated)')}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Results analysed" value={filtered.length} sub="published & marked" />
        <StatCard label="School average" value={`${filtered.length ? Math.round(filtered.reduce((s, a) => s + (a.percentage ?? 0), 0) / filtered.length) : 0}%`} tone="info" />
        <StatCard label="Pass rate" value={`${filtered.length ? Math.round((filtered.filter((a) => (a.percentage ?? 0) >= 50).length / filtered.length) * 100) : 0}%`} tone="success" />
        <StatCard label="Need intervention" value={under.length} sub="below 45%" tone={under.length ? 'danger' : 'neutral'} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Grade distribution" description="All analysed results">
          {gradePie.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={gradePie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3}>
                  {gradePie.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <RTooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No released results on this computer yet" />}
        </SectionCard>
        <SectionCard title="Class comparison" description="SS2 arms — average & pass rate">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={classPerf} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} domain={[0, 100]} />
              <RTooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="avg" fill="#0d9488" radius={[4, 4, 0, 0]} name="Average %" />
              <Bar dataKey="pass" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Pass rate %" />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
        <SectionCard title="Topic mastery (subject level)" description="Identifies weak topics for intervention">
          <div className="space-y-2">
            {topicMastery.sort((a, b) => a.mastery - b.mastery).map((t) => (
              <div key={t.topic}>
                <div className="mb-0.5 flex justify-between text-xs"><span>{t.topic}</span><span className={t.mastery < 55 ? 'font-semibold text-red-600' : 'text-muted-foreground'}>{t.mastery}%</span></div>
                <Progress value={t.mastery} className={`h-1.5 ${t.mastery < 55 ? '[&>div]:bg-red-500' : ''}`} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Students needing intervention" description="Below 45% — from results on this computer">
          {under.length === 0 ? <EmptyState title="No students below threshold" /> : (
            <div className="space-y-1.5">
              {under.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2"><UserAvatar name={a.studentName} hue={(a.studentId.length * 31) % 360} size="sm" /><div><p className="font-medium">{a.studentName}</p><p className="text-xs text-muted-foreground">{a.className}</p></div></div>
                  <div className="flex items-center gap-2"><span className="font-bold text-red-600">{a.percentage}%</span><Button size="sm" variant="outline" onClick={() => toast('Intervention plan drafted (simulated)', { description: 'Recommendation saved to the student record.' })}>Plan</Button></div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
        <SectionCard title="Question performance" description="Hardest questions across recent results (representative sample)">
          <div className="space-y-2">
            {[
              { q: 'Circle chord length (13 cm / 5 cm)', correct: 41 },
              { q: 'Rationalise 6/(3−√3)', correct: 52 },
              { q: 'Log 8 + log 125', correct: 60 },
              { q: 'Algebraic fraction simplification', correct: 64 },
              { q: 'AP first term & difference', correct: 71 },
            ].map((r) => (
              <div key={r.q}>
                <div className="mb-0.5 flex justify-between text-xs"><span className="truncate">{r.q}</span><span>{r.correct}% correct</span></div>
                <Progress value={r.correct} className={`h-1.5 ${r.correct < 50 ? '[&>div]:bg-red-500' : r.correct < 65 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`} />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Use these to focus revision; export includes per-question breakdowns.</p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
