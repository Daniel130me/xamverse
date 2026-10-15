'use client';

/**
 * Role dashboards — administrator, teacher, student, exam officer,
 * invigilator, parent. Every card links somewhere useful.
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { PageHeader, StatCard, SectionCard, StatusBadge, EmptyState, UserAvatar, AccessDenied } from '@/components/shared/ui-kit';
import { ASSESSMENT_STATUS_LABELS, fmtDate, fmtRelative, gradeBand } from '@/lib/ui-utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Users, GraduationCap, FileText, Stamp, MonitorPlay, MonitorSmartphone, RefreshCcw, KeyRound, Wifi,
  ClipboardCheck, Sparkles, CalendarDays, Layers, TrendingUp, TrendingDown, BookOpenCheck, AlertTriangle,
  ArrowRight, PlayCircle, Trophy, Target, Lightbulb, Bell, ShieldAlert, Activity, CircleDot,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, BarChart, Bar,
  RadarChart, PolarGrid, PolarAngleAxis, Radar, PieChart, Pie, Cell, Legend,
} from 'recharts';

const CHART_COLORS = ['#0d9488', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#84cc16'];

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {label && <p className="mb-0.5 font-medium">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  );
}

// ============================================================
// Administrator dashboard
// ============================================================

export function AdminDashboard() {
  const store = useDemoStore();
  const user = store.currentUser();
  const local = store.local();
  const device = store.currentDevice();
  const school = store.world.schools[device.schoolId];
  const navigate = store.navigate;

  const students = Object.values(store.world.users).filter((u) => u.schoolId === device.schoolId && u.role === 'student');
  const staff = Object.values(store.world.users).filter((u) => u.schoolId === device.schoolId && ['teacher', 'hod', 'exam_officer', 'invigilator', 'administrator'].includes(u.role));
  const assessments = Object.values(local.assessments);
  const pendingApprovals = local.approvalRequests.filter((r) => r.status === 'pending');
  const upcoming = assessments.filter((a) => a.access === 'controlled' && new Date(a.startAt) > new Date('2026-10-11'));
  const peers = Object.values(store.world.devices).filter((d) => d.schoolId === device.schoolId && d.paired);
  const onlinePeers = peers.filter((d) => d.online && store.world.network.lanOnline);
  const pendingTransfers = local.transferQueue.filter((t) => t.status === 'blocked_offline' || t.status === 'queued' || t.status === 'transferring');
  const openConflicts = local.conflicts.filter((c) => c.status === 'open');
  const collected = local.submissions.length;

  const perfData = React.useMemo(() => [
    { week: 'W1', average: 54 }, { week: 'W2', average: 58 }, { week: 'W3', average: 57 },
    { week: 'W4', average: 63 }, { week: 'W5', average: 61 }, { week: 'W6', average: 66 },
  ], []);

  const subjData = React.useMemo(() => [
    { subject: 'Maths', avg: 62 }, { subject: 'English', avg: 71 }, { subject: 'Biology', avg: 68 },
    { subject: 'Physics', avg: 57 }, { subject: 'Civic', avg: 77 },
  ], []);

  return (
    <div>
      <PageHeader
        title={`Good morning, ${user?.name.split(' ').slice(-1)[0] ?? 'Administrator'}`}
        description={`${school?.name} · ${school?.currentSession} · Term ${school?.currentTerm} — signed in on ${device.name} (${store.activeDeviceId}). This dashboard reflects data stored on THIS computer.`}
        icon={<Activity className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/app/approvals')}><Stamp className="mr-1.5 h-4 w-4" /> Approvals {pendingApprovals.length > 0 && <Badge className="ml-1.5" variant="default">{pendingApprovals.length}</Badge>}</Button>
            <Button size="sm" onClick={() => navigate('/app/computers')}><MonitorSmartphone className="mr-1.5 h-4 w-4" /> Computers & Sync</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total students" value={students.length} sub={`${Object.values(store.world.classes).length} classes`} icon={<GraduationCap className="h-4 w-4" />} onClick={() => navigate('/app/school/students')} />
        <StatCard label="Staff" value={staff.length} sub="teaching & non-teaching" icon={<Users className="h-4 w-4" />} onClick={() => navigate('/app/school/staff')} />
        <StatCard label="Assessments (local)" value={assessments.length} sub={`${assessments.filter((a) => a.status === 'approved').length} approved`} icon={<FileText className="h-4 w-4" />} tone="info" onClick={() => navigate('/app/assessments')} />
        <StatCard label="Pending approvals" value={pendingApprovals.length} sub="requests on this device" icon={<Stamp className="h-4 w-4" />} tone={pendingApprovals.length ? 'warning' : 'neutral'} onClick={() => navigate('/app/approvals')} />
        <StatCard label="Peers online" value={`${onlinePeers.length}/${peers.length}`} sub="paired & reachable" icon={<Wifi className="h-4 w-4" />} tone={onlinePeers.length === peers.length ? 'success' : 'warning'} onClick={() => navigate('/app/computers')} />
        <StatCard label="Pending sync tasks" value={pendingTransfers.length} sub="queued or blocked" icon={<RefreshCcw className="h-4 w-4" />} tone={pendingTransfers.length ? 'warning' : 'success'} onClick={() => navigate('/app/sync')} />
        <StatCard label="Submissions collected" value={collected} sub="on this computer" icon={<ClipboardCheck className="h-4 w-4" />} tone="progress" onClick={() => navigate('/app/results')} />
        <StatCard label="Licence" value="Campus" sub={`renews ${fmtDate('2026-12-15T00:00:00')}`} icon={<KeyRound className="h-4 w-4" />} tone="success" onClick={() => navigate('/app/licensing')} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="School-wide performance" description="Average score across released assessments (from this computer's local results)" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={perfData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
              <YAxis tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} domain={[0, 100]} />
              <RTooltip content={<ChartTip />} />
              <Line type="monotone" dataKey="average" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 3 }} name="Average %" />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>
        <SectionCard title="Recent activity (audit)">
          <div className="space-y-2.5">
            {local.auditLog.slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-xs">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${a.status === 'success' ? 'bg-emerald-500' : a.status === 'failure' ? 'bg-red-500' : 'bg-amber-500'}`} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.detail}</p>
                  <p className="text-muted-foreground">{a.userName} · {fmtRelative(a.at)}</p>
                </div>
              </div>
            ))}
            {local.auditLog.length === 0 && <p className="text-xs text-muted-foreground">No activity recorded on this device yet.</p>}
            <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/app/audit')}>View full audit log <ArrowRight className="ml-1 h-3 w-3" /></Button>
          </div>
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Subject averages" description="Released results this term">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={subjData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} vertical={false} />
              <XAxis dataKey="subject" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
              <YAxis tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} domain={[0, 100]} />
              <RTooltip content={<ChartTip />} />
              <Bar dataKey="avg" fill="#0d9488" radius={[4, 4, 0, 0]} name="Average %" />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
        <SectionCard title="Needs attention">
          <div className="space-y-2">
            {openConflicts.length > 0 && (
              <button onClick={() => navigate('/app/conflicts')} className="flex w-full items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40">
                <GitMergeIcon /> <span className="flex-1"><strong>{openConflicts.length} sync conflicts</strong> need review — {openConflicts[0].title.slice(0, 48)}…</span> <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {pendingTransfers.filter((t) => t.status === 'blocked_offline').length > 0 && (
              <button onClick={() => navigate('/app/sync')} className="flex w-full items-center gap-2.5 rounded-lg border border-sky-200 bg-sky-50 p-3 text-left text-xs hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40">
                <RefreshCcw className="h-4 w-4 shrink-0 text-sky-600" /> <span className="flex-1"><strong>{pendingTransfers.filter((t) => t.status === 'blocked_offline').length} transfers blocked</strong> — peers offline. They resume automatically on reconnect.</span> <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {upcoming.length > 0 && (
              <button onClick={() => navigate('/app/exams')} className="flex w-full items-center gap-2.5 rounded-lg border p-3 text-left text-xs hover:bg-accent">
                <CalendarDays className="h-4 w-4 shrink-0 text-primary" /> <span className="flex-1"><strong>{upcoming.length} upcoming assessments</strong> — next: {upcoming[0]?.name}</span> <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {Object.values(store.world.devices).some((d) => d.dbHealth === 'warning') && (
              <button onClick={() => navigate('/app/computers')} className="flex w-full items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-left text-xs hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" /> <span className="flex-1"><strong>1 device has a storage warning</strong> — DEV-071 disk space low.</span> <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </SectionCard>
        <SectionCard title="Notifications" description="On this device">
          <div className="space-y-2">
            {local.notifications.slice(0, 5).map((n) => (
              <button key={n.id} onClick={() => { store.markNotificationsRead([n.id]); if (n.actionRoute) navigate(n.actionRoute); }} className="flex w-full items-start gap-2 rounded-lg p-2 text-left text-xs hover:bg-accent">
                <Bell className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${n.read ? 'text-muted-foreground' : 'text-primary'}`} />
                <span className="min-w-0">
                  <span className={`block truncate text-xs ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{n.title}</span>
                  <span className="block truncate text-muted-foreground">{n.body}</span>
                </span>
              </button>
            ))}
            {local.notifications.length === 0 && <p className="text-xs text-muted-foreground">Nothing new on this computer.</p>}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function GitMergeIcon() {
  return <span className="flex h-4 w-4 items-center justify-center text-amber-600"><CircleDot className="h-4 w-4" /></span>;
}

// ============================================================
// Teacher dashboard
// ============================================================

export function TeacherDashboard() {
  const store = useDemoStore();
  const user = store.currentUser()!;
  const local = store.local();
  const navigate = store.navigate;
  const mySubjects = user.subjectIds ?? [];
  const subjectNames = mySubjects.map((id) => store.world.subjects[id]?.name).join(', ');
  const myClasses = Object.values(store.world.classes).filter((c) => c.classTeacherId === user.id);
  const myAssessments = Object.values(local.assessments).filter((a) => a.createdBy === user.id);
  const drafts = myAssessments.filter((a) => a.status === 'draft' || a.status === 'revision_requested' || a.status === 'rejected');
  const pending = myAssessments.filter((a) => a.status === 'pending_approval');
  const approved = myAssessments.filter((a) => ['approved', 'distributing', 'distributed', 'active'].includes(a.status));
  const myQuestions = Object.values(local.questions).filter((q) => q.createdBy === user.id);
  const markingQueue = local.attempts.filter((a) => a.status === 'submitted' && (a.essayQuestionIds ?? []).length > 0);

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ').slice(-1)[0]}`}
        description={`${subjectNames || 'Teaching'} · ${myClasses.length > 0 ? `Class teacher of ${myClasses.map((c) => c.name).join(', ')}` : 'Subject teacher'} — data shown is local to ${store.activeDeviceId}.`}
        icon={<BookOpenCheck className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/app/ai-assistant')}><Sparkles className="mr-1.5 h-4 w-4 text-violet-500" /> AI assistant</Button>
            <Button size="sm" onClick={() => navigate('/app/assessments/new')}><FileText className="mr-1.5 h-4 w-4" /> New assessment</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="My questions" value={myQuestions.length} sub={`${myQuestions.filter((q) => q.status === 'draft').length} drafts · ${myQuestions.filter((q) => q.status === 'pending_review').length} in review`} icon={<Layers className="h-4 w-4" />} onClick={() => navigate('/app/questions')} />
        <StatCard label="Draft assessments" value={drafts.length} sub={drafts[0]?.name ? `latest: ${drafts[0].name.slice(0, 28)}…` : 'none yet'} icon={<FileText className="h-4 w-4" />} tone={drafts.length ? 'warning' : 'neutral'} onClick={() => navigate('/app/assessments')} />
        <StatCard label="Pending approval" value={pending.length} sub="with reviewers" icon={<Stamp className="h-4 w-4" />} tone={pending.length ? 'info' : 'neutral'} onClick={() => navigate('/app/assessments')} />
        <StatCard label="Approved & live" value={approved.length} sub="ready or running" icon={<MonitorPlay className="h-4 w-4" />} tone="success" onClick={() => navigate('/app/assessments')} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="My draft & pending assessments" description="Created on this computer" action={<Button size="sm" variant="ghost" onClick={() => navigate('/app/assessments')}>View all <ArrowRight className="ml-1 h-3 w-3" /></Button>}>
          {myAssessments.length === 0 ? (
            <EmptyState title="No assessments yet" description="Create your first assessment — it stays on this computer until you submit it for approval." action={<Button size="sm" onClick={() => navigate('/app/assessments/new')}>Create assessment</Button>} />
          ) : (
            <div className="space-y-2">
              {myAssessments.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/app/assessments/${a.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/app/assessments/${a.id}`); } }}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">v{a.version} · {a.questionIds.length} questions · {a.totalMarks} marks · {fmtDate(a.startAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {a.status === 'draft' && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); navigate('/app/sync'); }}>Submit for approval</Button>}
                    <StatusBadge status={a.status} label={ASSESSMENT_STATUS_LABELS[a.status]} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Awaiting my marking" description="Essay responses submitted by students">
          {markingQueue.length === 0 ? (
            <EmptyState title="Nothing to mark" description="When students submit essays, they appear here (once their results sync to this computer)." />
          ) : (
            <div className="space-y-2">
              {markingQueue.slice(0, 5).map((a) => (
                <button key={a.id} onClick={() => navigate('/app/results')} className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-accent">
                  <div>
                    <p className="text-sm font-medium">{a.studentName}</p>
                    <p className="text-xs text-muted-foreground">{a.assessmentName} · {(a.essayQuestionIds ?? []).length} essay(s)</p>
                  </div>
                  <Badge variant="outline">Mark now</Badge>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="My classes" description="Performance snapshot">
          <div className="space-y-3">
            {(myClasses.length ? myClasses : Object.values(store.world.classes).slice(0, 3)).map((c) => {
              const pct = 55 + ((c.id.length * 13) % 35);
              return (
                <button key={c.id} onClick={() => navigate('/app/analytics')} className="w-full text-left">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">avg {pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </button>
              );
            })}
          </div>
        </SectionCard>
        <SectionCard title="Upcoming tests" description="Approved & scheduled">
          {approved.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing scheduled yet. Approved assessments appear here with their exam window.</p>
          ) : (
            <div className="space-y-2">
              {approved.map((a) => (
                <div key={a.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(a.startAt)} → {fmtDate(a.endAt)} · {a.durationMin} min</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
        <SectionCard title="Sync shortcuts" description="Share your work with peers">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Your drafts live only on {store.activeDeviceId} until transferred:</p>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => navigate('/app/sync')}><RefreshCcw className="mr-1.5 h-4 w-4" /> Open Sync Centre</Button>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => navigate('/app/questions')}><Layers className="mr-1.5 h-4 w-4" /> Share question bank</Button>
            <p className="text-[11px] text-muted-foreground">Controlled exams cannot be delivered to students until an administrator approves them — even if they are already on other computers.</p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ============================================================
// Student dashboard
// ============================================================

export function StudentDashboard() {
  const store = useDemoStore();
  const user = store.currentUser()!;
  const local = store.local();
  const navigate = store.navigate;

  // exams available ON THIS DEVICE (must have a package delivered + approved)
  const availableExams = Object.values(local.assessments).filter((a) => {
    if (a.access !== 'controlled') return false;
    if (!local.examPackages[a.id]) return false;
    if (user.classId && !a.classIds.includes(user.classId)) return false;
    return true;
  });
  const released = local.attempts.filter((a) => a.studentId === user.id && a.status === 'published');
  const inProgress = local.attempts.find((a) => a.studentId === user.id && a.status === 'in_progress');
  const avg = released.length ? Math.round(released.reduce((s, a) => s + (a.percentage ?? 0), 0) / released.length) : 0;

  const trend = [
    { name: 'CA1', score: 58 }, { name: 'CA2', score: 64 }, { name: 'Mid-term', score: 61 }, { name: 'Project', score: 72 }, { name: 'Mock', score: 69 },
  ];
  const mastery = [
    { topic: 'Algebra', value: 78 }, { topic: 'Geometry', value: 64 }, { topic: 'Statistics', value: 85 },
    { topic: 'Grammar', value: 70 }, { topic: 'Ecology', value: 58 }, { topic: 'Mechanics', value: 49 },
  ];

  return (
    <div>
      <PageHeader
        title={`Hi ${user.name.split(' ')[0]} 👋`}
        description={`${store.world.classes[user.classId ?? '']?.name ?? ''} · ${user.admissionNo ?? ''} — signed in on computer ${store.currentDevice().name}. You only see exams delivered to THIS computer.`}
        icon={<GraduationCap className="h-5 w-5" />}
      />

      {inProgress && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
          <div className="flex items-center gap-3">
            <PlayCircle className="h-8 w-8 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold">You have an exam in progress: {inProgress.assessmentName}</p>
              <p className="text-xs text-muted-foreground">Started {fmtRelative(inProgress.startedAt)} — answers were saved locally on this computer.</p>
            </div>
          </div>
          <Button onClick={() => navigate('/exam')}>Resume exam</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Exams available" value={availableExams.length} sub="delivered to this computer" icon={<MonitorPlay className="h-4 w-4" />} tone={availableExams.length ? 'success' : 'neutral'} />
        <StatCard label="Average score" value={`${avg}%`} sub="released results only" icon={<TrendingUp className="h-4 w-4" />} tone={avg >= 50 ? 'success' : 'warning'} />
        <StatCard label="Practice sessions" value={3} sub="this term" icon={<Target className="h-4 w-4" />} tone="info" onClick={() => navigate('/practice')} />
        <StatCard label="Learning streak" value="5 days" sub="keep it going!" icon={<Trophy className="h-4 w-4" />} tone="warning" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Available examinations" description="Controlled exams — delivered to this computer by your school">
          {availableExams.length === 0 ? (
            <EmptyState
              title="No exams on this computer yet"
              description="When the exam office distributes an assessment, it is stored here locally and appears automatically — even without internet."
              icon={<MonitorPlay className="h-6 w-6" />}
            />
          ) : (
            <div className="space-y-2">
              {availableExams.map((a) => {
                const attempt = local.attempts.find((at) => at.assessmentId === a.id && at.studentId === user.id);
                return (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.name}</p>
                      <p className="text-xs text-muted-foreground">{store.world.subjects[a.subjectId]?.name} · {a.questionIds.length} questions · {a.durationMin} min · {a.totalMarks} marks</p>
                      <p className="text-xs text-muted-foreground">Window: {fmtDate(a.startAt)} → {fmtDate(a.endAt)}</p>
                    </div>
                    {attempt?.status === 'published' ? (
                      <StatusBadge status="published" label={`Scored ${attempt.percentage}%`} />
                    ) : (
                      <Button size="sm" onClick={() => navigate('/exam')}>Start exam</Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title="My recent results" description="Released by your school">
          {released.length === 0 ? (
            <EmptyState title="No released results on this computer" description="Results appear after your school releases them and they sync to this computer." />
          ) : (
            <div className="space-y-2">
              {released.map((a) => (
                <button key={a.id} onClick={() => navigate('/app/results')} className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-accent">
                  <div>
                    <p className="text-sm font-medium">{a.assessmentName}</p>
                    <p className="text-xs text-muted-foreground">Submitted {fmtRelative(a.submittedAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${((a.percentage ?? 0) >= 50) ? 'text-emerald-600' : 'text-red-600'}`}>{a.autoScore + a.manualScore}/{a.totalMarks}</p>
                    <StatusBadge status={gradeBand(store.world.schools[store.currentDevice().schoolId]?.gradingScheme ?? [], a.percentage ?? 0)} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Score trend" description="This term">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} domain={[0, 100]} />
              <RTooltip content={<ChartTip />} />
              <Line type="monotone" dataKey="score" stroke="#0d9488" strokeWidth={2.5} name="Score %" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>
        <SectionCard title="Topic mastery" description="Strong and weak areas">
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={mastery} outerRadius="72%">
              <PolarGrid stroke="currentColor" opacity={0.15} />
              <PolarAngleAxis dataKey="topic" tick={{ fontSize: 9 }} />
              <Radar dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.35} name="Mastery %" />
              <RTooltip content={<ChartTip />} />
            </RadarChart>
          </ResponsiveContainer>
        </SectionCard>
        <SectionCard title="Recommended practice" description="Based on your weakest topics">
          <div className="space-y-2">
            {[
              { topic: 'Mechanics (Physics)', score: 49, icon: TrendingDown },
              { topic: 'Ecology (Biology)', score: 58, icon: TrendingDown },
              { topic: 'Geometry (Maths)', score: 64, icon: TrendingDown },
            ].map((r) => (
              <button key={r.topic} onClick={() => navigate('/practice')} className="flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left text-xs hover:bg-accent">
                <r.icon className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="flex-1"><strong>{r.topic}</strong> — mastery {r.score}%. Practice set available.</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ))}
            <Button size="sm" variant="outline" className="w-full" onClick={() => navigate('/practice')}><PlayCircle className="mr-1.5 h-4 w-4" /> Start a practice session</Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ============================================================
// Exam officer dashboard
// ============================================================

export function ExamOfficerDashboard() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const pending = local.approvalRequests.filter((r) => r.status === 'pending');
  const approved = Object.values(local.assessments).filter((a) => ['approved', 'distributing', 'distributed', 'active'].includes(a.status));
  const peers = Object.values(store.world.devices).filter((d) => d.schoolId === store.currentDevice().schoolId && d.paired);
  const readyPeers = peers.filter((d) => d.online).length;
  const collected = local.submissions.filter((s) => s.assessmentId === 'ASSESS-ENG-SS2-CA1').length;

  const calendar = Object.values(local.assessments).filter((a) => a.access === 'controlled').sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <div>
      <PageHeader
        title="Examination Officer"
        description={`Plan, approve, distribute and collect. Local view: ${store.activeDeviceId}.`}
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/app/sync')}><RefreshCcw className="mr-1.5 h-4 w-4" /> Distribution centre</Button>
            <Button size="sm" onClick={() => navigate('/app/exams')}><MonitorPlay className="mr-1.5 h-4 w-4" /> Monitor sessions</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending approvals" value={pending.length} sub="awaiting review" icon={<Stamp className="h-4 w-4" />} tone={pending.length ? 'warning' : 'success'} onClick={() => navigate('/app/approvals')} />
        <StatCard label="Approved / running" value={approved.length} sub="assessments" icon={<FileText className="h-4 w-4" />} tone="success" />
        <StatCard label="Device readiness" value={`${readyPeers}/${peers.length}`} sub="paired peers online" icon={<MonitorSmartphone className="h-4 w-4" />} tone={readyPeers === peers.length ? 'success' : 'warning'} onClick={() => navigate('/app/computers')} />
        <StatCard label="English CA collected" value={`${collected}/100`} sub="verified submissions" icon={<ClipboardCheck className="h-4 w-4" />} tone="progress" onClick={() => navigate('/app/results')} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Examination calendar" description="All controlled assessments known to this computer">
          {calendar.length === 0 ? (
            <EmptyState title="Nothing scheduled" description="Approved assessments and their windows appear here." />
          ) : (
            <div className="space-y-2">
              {calendar.map((a) => (
                <button key={a.id} onClick={() => navigate(`/app/assessments/${a.id}`)} className="flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left hover:bg-accent">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(a.startAt)} → {fmtDate(a.endAt)} · {a.durationMin} min</p>
                  </div>
                  <StatusBadge status={a.status} label={ASSESSMENT_STATUS_LABELS[a.status]} />
                </button>
              ))}
            </div>
          )}
        </SectionCard>
        <SectionCard title="Distribution & collection progress" description="Last operations from this device">
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-xs"><span>Biology Mock — package distribution</span><span>92/92 peers acknowledged</span></div>
              <Progress value={100} className="h-2" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs"><span>Biology Mock — result collection</span><span>60/100 submissions</span></div>
              <Progress value={60} className="h-2" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs"><span>English CA — released</span><span>100/100</span></div>
              <Progress value={100} className="h-2" />
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/app/sync')}>Open sync history <ArrowRight className="ml-1 h-3 w-3" /></Button>
          </div>
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title="Incident reports" description="Logged during live sessions (visible with your permissions)">
          <div className="space-y-2 text-sm">
            {[
              { id: 'INC-003', text: 'DEV-074 lost connection mid-exam — student resumed after reconnect.', at: '2 days ago', severity: 'warning' },
              { id: 'INC-002', text: 'Candidate on DEV-063 reported frozen timer — restarted by invigilator.', at: '2 days ago', severity: 'warning' },
              { id: 'INC-001', text: 'Unauthorized USB device detected on DEV-081 during Biology Mock.', at: '3 days ago', severity: 'danger' },
            ].map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 rounded-lg border p-3 text-xs">
                <span className="flex items-center gap-2"><AlertTriangle className={`h-4 w-4 ${i.severity === 'danger' ? 'text-red-500' : 'text-amber-500'}`} /><strong>{i.id}</strong> — {i.text}</span>
                <span className="shrink-0 text-muted-foreground">{i.at}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ============================================================
// Invigilator dashboard
// ============================================================

export function InvigilatorDashboard() {
  const store = useDemoStore();
  const navigate = store.navigate;
  const local = store.local();
  const liveSession = {
    name: 'SS2 Biology — Mock Examination',
    room: 'Computer Lab 2',
    expected: 100,
    present: 96,
    active: 94,
    submitted: 58,
    devicesReady: 95,
  };
  return (
    <div>
      <PageHeader
        title="Invigilation"
        description="Your assigned sessions and live controls. You can monitor candidates and log incidents — but not manage assessments."
        icon={<ShieldAlert className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => navigate('/app/exams')}><MonitorPlay className="mr-1.5 h-4 w-4" /> Open live session</Button>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Assigned sessions" value={1} sub="today" icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard label="Candidates present" value={`${liveSession.present}/${liveSession.expected}`} sub="checked in" icon={<Users className="h-4 w-4" />} tone="warning" />
        <StatCard label="Actively writing" value={liveSession.active} sub="exams in progress" icon={<Activity className="h-4 w-4" />} tone="info" />
        <StatCard label="Submitted so far" value={liveSession.submitted} sub="collected automatically" icon={<ClipboardCheck className="h-4 w-4" />} tone="success" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Live session" description={liveSession.name}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm"><Badge variant="outline">Lab 2</Badge> <span className="text-xs text-muted-foreground">Device readiness: {liveSession.devicesReady}/100 · {liveSession.expected - liveSession.present} absent</span></div>
            <Progress value={(liveSession.submitted / liveSession.expected) * 100} className="h-2" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate('/app/exams')}>Candidate roster</Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/app/exams')}>Log incident</Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/app/exams')}>Approve resumption</Button>
            </div>
            <p className="text-xs text-muted-foreground">Invigilators may pause/resume candidate sessions and record incidents. Result collection and publishing require an administrator or examination officer.</p>
          </div>
        </SectionCard>
        <SectionCard title="Recent incidents" description="This session">
          <div className="space-y-2 text-xs">
            {[
              ['INC-003', 'DEV-074 lost connection mid-exam — auto-saved locally, resumed.', '2 min ago'],
              ['INC-002', 'Timer freeze on DEV-063 — session restarted, extra time granted (simulated).', '12 min ago'],
              ['INC-001', 'Late arrival — Adebayo O. checked in 20 min late, admitted with note.', '35 min ago'],
            ].map(([id, text, at]) => (
              <div key={id} className="flex items-start justify-between gap-2 rounded-lg border p-2.5">
                <span><strong>{id}</strong> — {text}</span>
                <span className="shrink-0 text-muted-foreground">{at}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ============================================================
// Parent dashboard
// ============================================================

export function ParentDashboard() {
  const store = useDemoStore();
  const user = store.currentUser()!;
  const navigate = store.navigate;
  const local = store.local();
  const children = (user.childrenIds ?? []).map((id) => store.world.users[id]).filter(Boolean);
  return (
    <div>
      <PageHeader
        title={`Welcome, ${user.name}`}
        description="Track your children's released results and progress. You only see results the school has released."
        icon={<Users className="h-5 w-5" />}
      />
      {children.map((child) => {
        const released = local.attempts.filter((a) => a.studentId === child.id && a.status === 'published');
        const avg = released.length ? Math.round(released.reduce((s, a) => s + (a.percentage ?? 0), 0) / released.length) : 0;
        return (
          <div key={child.id} className="mb-4">
            <SectionCard
              title={child.name}
              description={`${store.world.classes[child.classId ?? '']?.name ?? ''} · ${child.admissionNo ?? ''}`}
              action={<Button size="sm" variant="outline" onClick={() => navigate('/app/analytics')}>Full report</Button>}
            >
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="flex items-center gap-3">
                  <UserAvatar name={child.name} hue={child.avatarHue} size="lg" />
                  <div>
                    <p className="text-2xl font-bold">{avg}%</p>
                    <p className="text-xs text-muted-foreground">average · {released.length} released result(s)</p>
                  </div>
                </div>
                <div className="lg:col-span-2">
                  {released.length === 0 ? (
                    <EmptyState title="No released results yet on this computer" description="Results become visible once the school releases them and they sync to this device." />
                  ) : (
                    <div className="space-y-2">
                      {released.map((a) => (
                        <div key={a.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                          <div>
                            <p className="font-medium">{a.assessmentName}</p>
                            <p className="text-xs text-muted-foreground">Submitted {fmtRelative(a.submittedAt)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{a.autoScore + a.manualScore}/{a.totalMarks}</span>
                            <StatusBadge status={gradeBand(store.world.schools[store.currentDevice().schoolId]?.gradingScheme ?? [], a.percentage ?? 0)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>
        );
      })}
      <SectionCard title="Recommendations for your child" description="Practice suggestions from released results">
        <div className="space-y-2 text-sm">
          {['Mechanics (Physics) — mastery below 50%: revision set available', 'Ecology (Biology) — practice quiz recommended', 'Geometry (Maths) — topic test suggested before mid-terms'].map((r) => (
            <div key={r} className="flex items-center gap-2 rounded-lg border p-3 text-xs"><Lightbulb className="h-4 w-4 text-amber-500" /> {r}</div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

// ============================================================
// Dispatcher
// ============================================================

export function DashboardRouter() {
  const store = useDemoStore();
  const user = store.currentUser();
  if (!user) return <AccessDenied detail="No active session on this computer." />;
  switch (user.role) {
    case 'proprietor':
    case 'administrator':
    case 'support':
      return <AdminDashboard />;
    case 'exam_officer':
      return <ExamOfficerDashboard />;
    case 'teacher':
    case 'hod':
      return <TeacherDashboard />;
    case 'invigilator':
      return <InvigilatorDashboard />;
    case 'student':
      return <StudentDashboard />;
    case 'parent':
      return <ParentDashboard />;
    default:
      return <AdminDashboard />;
  }
}

export { ChartTip };
