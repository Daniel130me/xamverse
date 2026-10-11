'use client';

/**
 * Assessments — list, creation wizard (6 steps), detail with lifecycle &
 * version timeline, approvals queue. Implements the approval rule:
 * teacher assessments stay unavailable for controlled delivery until
 * an authorized admin approves THAT version; edits create new revisions.
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { PageHeader, StatCard, SectionCard, StatusBadge, DataTable, EmptyState, AccessDenied } from '../shared/ui-kit';
import { ASSESSMENT_STATUS_LABELS, QUESTION_TYPE_LABELS, fmtDateTime, fmtDate, fmtRelative } from '@/lib/prototype/ui-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  FileText, Plus, Stamp, Send, CheckCircle2, XCircle, MonitorSmartphone, History, Pencil, Copy,
  ArrowLeft, ArrowRight, Archive, Clock, AlertTriangle, RefreshCcw, Layers, Sparkles, ShieldCheck,
  Download, CircleAlert, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Assessment, AssessmentStatus, AssessmentType } from '@/lib/prototype/types';

const TYPE_LABELS: Record<AssessmentType, string> = {
  continuous_assessment: 'Continuous assessment', weekly_test: 'Weekly test', assignment: 'Assignment',
  mock_exam: 'Mock examination', entrance_exam: 'Entrance examination', end_of_term_exam: 'End-of-term examination',
  diagnostic: 'Diagnostic assessment', public_practice: 'Public practice test', custom: 'Custom type',
};

// ============================================================
// Assessments list
// ============================================================

export function AssessmentsScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const canCreate = store.can('assessments.create');
  const assessments = Object.values(local.assessments).filter((a) => a.access === 'controlled');
  return (
    <div>
      <PageHeader
        title="Assessments"
        description={`Known to this computer (${store.activeDeviceId}). Statuses below are local — other computers may hold different states until sync.`}
        icon={<FileText className="h-5 w-5" />}
        actions={canCreate && <Button size="sm" onClick={() => navigate('/app/assessments/new')}><Plus className="mr-1.5 h-4 w-4" /> New assessment</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total" value={assessments.length} icon={<FileText className="h-4 w-4" />} />
        <StatCard label="Drafts / revisions" value={assessments.filter((a) => ['draft', 'revision_requested', 'rejected'].includes(a.status)).length} tone="warning" />
        <StatCard label="Approved" value={assessments.filter((a) => ['approved', 'distributing', 'distributed', 'active'].includes(a.status)).length} tone="success" icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard label="In results stage" value={assessments.filter((a) => ['marking', 'awaiting_result_approval', 'results_released'].includes(a.status)).length} tone="progress" />
      </div>
      <DataTable
        rows={assessments}
        rowKey={(a) => a.id}
        searchable
        searchKeys={(a) => `${a.name} ${a.description}`}
        filters={[
          { key: 'status', label: 'Status', options: Object.entries(ASSESSMENT_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l })), match: (a, v) => a.status === v },
          { key: 'subject', label: 'Subject', options: Object.values(store.world.subjects).map((s) => ({ value: s.id, label: s.name })), match: (a, v) => a.subjectId === v },
        ]}
        onRowClick={(a) => navigate(`/app/assessments/${a.id}`)}
        columns={[
          {
            key: 'name', header: 'Assessment', sortable: true, render: (a) => (
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">{TYPE_LABELS[a.type]} · {store.world.subjects[a.subjectId]?.name} · {a.questionIds.length} questions</p>
              </div>
            ),
          },
          { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} label={ASSESSMENT_STATUS_LABELS[a.status]} /> },
          { key: 'version', header: 'Version', render: (a) => <span className="text-xs">v{a.version}{a.approvedVersion ? <span className="text-muted-foreground"> (approved v{a.approvedVersion})</span> : null}</span> },
          { key: 'window', header: 'Window', render: (a) => <span className="text-xs text-muted-foreground">{fmtDate(a.startAt)} → {fmtDate(a.endAt)}</span> },
          { key: 'createdBy', header: 'Created by', render: (a) => <span className="text-xs">{a.createdByName}<br /><span className="text-muted-foreground">{a.createdOnDevice}</span></span> },
        ]}
        emptyState={<EmptyState title="No assessments on this computer" description="Assessments appear here when created locally or after they are distributed to this device." action={canCreate ? <Button size="sm" onClick={() => navigate('/app/assessments/new')}>Create one</Button> : undefined} />}
      />
    </div>
  );
}

// ============================================================
// Creation wizard
// ============================================================

export function AssessmentWizardScreen() {
  const store = useDemoStore();
  const navigate = store.navigate;
  const user = store.currentUser()!;
  const device = store.currentDevice();
  const local = store.local();
  const [step, setStep] = React.useState(0);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [bankPicker, setBankPicker] = React.useState(false);
  const [aiAdd, setAiAdd] = React.useState(false);

  const STEPS = ['Details', 'Questions', 'Sections & marks', 'Schedule & rules', 'Security & feedback', 'Review'];

  const [form, setForm] = React.useState<Assessment>(() => ({
    id: `ASSESS-${Date.now()}`, schoolId: device.schoolId,
    name: '', description: '', instructions: '',
    subjectId: user.subjectIds?.[0] ?? 'sub-math',
    classIds: [], type: 'weekly_test', access: 'controlled',
    startAt: '', endAt: '', durationMin: 45, totalMarks: 0, passMark: 50, attemptsAllowed: 1,
    questionIds: [], sections: [], randomizeQuestions: false, randomizeOptions: false,
    status: 'draft', version: 1, createdBy: user.id, createdByName: user.name,
    createdOnDevice: store.activeDeviceId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    resultVisibility: 'after_release', feedbackPolicy: 'correct_incorrect', submissionMode: 'collected',
  }));

  const questions = form.questionIds.map((id) => local.questions[id]).filter(Boolean);
  const totalMarks = questions.reduce((s, q) => s + q.marks, 0);

  const set = (patch: Partial<Assessment>) => setForm((f) => ({ ...f, ...patch }));

  const validate = (): boolean => {
    const errs: string[] = [];
    if (step === 0) {
      if (form.name.trim().length < 4) errs.push('Assessment name must be at least 4 characters.');
      if (form.classIds.length === 0) errs.push('Select at least one eligible class.');
    }
    if (step === 1 && form.questionIds.length === 0) errs.push('Add at least one question — import from the bank, create new, or use the AI assistant.');
    if (step === 3) {
      if (!form.startAt) errs.push('Choose a start date.');
      if (!form.endAt) errs.push('Choose an end date.');
      if (form.startAt && form.endAt && form.endAt <= form.startAt) errs.push('End must be after start.');
      if (form.durationMin < 5) errs.push('Duration must be at least 5 minutes.');
    }
    setErrors(errs);
    return errs.length === 0;
  };

  const next = () => {
    if (!validate()) return;
    if (step === STEPS.length - 1) {
      const final: Assessment = { ...form, totalMarks, updatedAt: new Date().toISOString() };
      store.saveAssessment(final, 'Created via wizard (draft v1)');
      toast.success('Assessment saved as draft', { description: `Stored locally on ${store.activeDeviceId}. Submit it for approval when ready.` });
      navigate(`/app/assessments/${final.id}`);
      return;
    }
    setStep((s) => s + 1);
  };

  return (
    <div>
      <PageHeader
        title="Create assessment"
        description="Drafts stay on this computer. Controlled exams cannot reach students until an administrator approves this exact version."
        crumbs={[{ label: 'Assessments', onClick: () => navigate('/app/assessments') }, { label: 'New' }]}
        icon={<FileText className="h-5 w-5" />}
        actions={<Button size="sm" variant="ghost" onClick={() => navigate('/app/assessments')}><ArrowLeft className="mr-1.5 h-4 w-4" /> Cancel</Button>}
      />
      <div className="mb-5">
        <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Step {step + 1} of {STEPS.length}: {STEPS[step]}</span><span>{Math.round(((step + 1) / STEPS.length) * 100)}%</span></div>
        <Progress value={((step + 1) / STEPS.length) * 100} className="mt-1.5" />
      </div>

      <SectionCard>
        {step === 0 && (
          <div className="grid max-w-2xl gap-3">
            <div><Label>Assessment name *</Label><Input className="mt-1" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. SS2 Mathematics — Mid-Term Examination" /></div>
            <div><Label>Description</Label><Input className="mt-1" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Short summary shown in lists" /></div>
            <div><Label>Instructions to students</Label><Textarea rows={3} className="mt-1" value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Shown before the exam starts…" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Subject</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.subjectId} onChange={(e) => set({ subjectId: e.target.value })} aria-label="Subject">
                  {Object.values(store.world.subjects).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><Label>Assessment type</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.type} onChange={(e) => set({ type: e.target.value as AssessmentType })} aria-label="Type">
                  {(Object.entries(TYPE_LABELS) as [AssessmentType, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label>Eligible classes *</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.values(store.world.classes).map((c) => (
                  <label key={c.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium ${form.classIds.includes(c.id) ? 'border-primary bg-primary/10 text-primary' : ''}`}>
                    <Checkbox className="hidden" checked={form.classIds.includes(c.id)} onCheckedChange={(v) => set({ classIds: v ? [...form.classIds, c.id] : form.classIds.filter((x) => x !== c.id) })} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Access</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => set({ access: 'controlled' })} className={`rounded-lg border p-3 text-left text-sm ${form.access === 'controlled' ? 'border-primary bg-primary/5' : ''}`}>
                  <p className="font-medium">Controlled</p>
                  <p className="text-xs text-muted-foreground">Requires approval, distribution and eligibility. For real examinations.</p>
                </button>
                <button type="button" onClick={() => set({ access: 'public' })} className={`rounded-lg border p-3 text-left text-sm ${form.access === 'public' ? 'border-primary bg-primary/5' : ''}`}>
                  <p className="font-medium">Public practice</p>
                  <p className="text-xs text-muted-foreground">Anyone can attempt it without signing in. No approval needed.</p>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setBankPicker(true)}><Layers className="mr-1.5 h-4 w-4" /> Import from question bank</Button>
              <Button size="sm" variant="outline" onClick={() => setAiAdd(true)}><Sparkles className="mr-1.5 h-4 w-4 text-violet-500" /> AI-generate</Button>
              <Button size="sm" variant="outline" onClick={() => { toast('Opening editor…'); navigate('/app/questions/editor'); }}><Plus className="mr-1.5 h-4 w-4" /> Create new question</Button>
              <Button size="sm" variant="outline" onClick={() => toast('Duplicate from a previous assessment (simulated)')}><Copy className="mr-1.5 h-4 w-4" /> Duplicate previous</Button>
              <Button size="sm" variant="outline" onClick={() => toast('File import (simulated)')}><Download className="mr-1.5 h-4 w-4" /> Import file</Button>
            </div>
            {questions.length === 0 ? (
              <EmptyState title="No questions selected" description="Import from your question bank — you can filter by subject, topic, type and difficulty." icon={<Layers className="h-6 w-6" />} />
            ) : (
              <div className="space-y-2">
                {questions.map((q, i) => (
                  <div key={q.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{i + 1}. {q.statement.split('\n')[0].slice(0, 90)}</p>
                      <p className="text-xs text-muted-foreground">{QUESTION_TYPE_LABELS[q.type]} · {q.marks} marks · {q.difficulty} · {q.topic}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" aria-label="Move up" onClick={() => set({ questionIds: swap(form.questionIds, i, -1) })}>↑</Button>
                      <Button variant="ghost" size="sm" aria-label="Move down" onClick={() => set({ questionIds: swap(form.questionIds, i, 1) })}>↓</Button>
                      <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => set({ questionIds: form.questionIds.filter((id) => id !== q.id) })}>×</Button>
                    </div>
                  </div>
                ))}
                <p className="text-sm"><strong>Total marks: {totalMarks}</strong></p>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">Group questions into sections (e.g. Objective, Theory). Marks come from the questions themselves.</p>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input placeholder="Section name, e.g. Section A — Objective" aria-label="Section name" onKeyDown={(e) => { if (e.key === 'Enter') { const el = e.target as HTMLInputElement; if (el.value.trim()) { set({ sections: [...form.sections, { id: `sec-${Date.now()}`, name: el.value.trim(), questionIds: [] }] }); el.value = ''; } } }} />
              </div>
            </div>
            {form.sections.map((sec, i) => (
              <div key={sec.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{sec.name}</p>
                  <Button variant="ghost" size="sm" onClick={() => set({ sections: form.sections.filter((s) => s.id !== sec.id) })}>Remove</Button>
                </div>
                <div className="mt-2 space-y-1">
                  {questions.map((q) => {
                    const inSec = sec.questionIds.includes(q.id);
                    return (
                      <label key={q.id} className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-xs hover:bg-accent">
                        <Checkbox checked={inSec} onCheckedChange={(v) => set({ sections: form.sections.map((s, j) => j === i ? { ...s, questionIds: v ? [...s.questionIds, q.id] : s.questionIds.filter((x) => x !== q.id) } : s) })} />
                        <span className="truncate">{q.statement.slice(0, 70)}… ({q.marks} marks)</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            {form.sections.length === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                No sections defined — all questions will be presented in a single section.
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            <div><Label>Start date & time *</Label><Input type="datetime-local" className="mt-1" value={form.startAt ? form.startAt.slice(0, 16) : ''} onChange={(e) => set({ startAt: new Date(e.target.value).toISOString() })} /></div>
            <div><Label>End date & time *</Label><Input type="datetime-local" className="mt-1" value={form.endAt ? form.endAt.slice(0, 16) : ''} onChange={(e) => set({ endAt: new Date(e.target.value).toISOString() })} /></div>
            <div><Label>Duration (minutes)</Label><Input type="number" min={5} className="mt-1" value={form.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })} /></div>
            <div><Label>Attempts allowed</Label><Input type="number" min={1} max={5} className="mt-1" value={form.attemptsAllowed} onChange={(e) => set({ attemptsAllowed: Number(e.target.value) })} /></div>
            <div><Label>Pass mark (% or marks)</Label><Input type="number" className="mt-1" value={form.passMark} onChange={(e) => set({ passMark: Number(e.target.value) })} /></div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.randomizeQuestions} onCheckedChange={(v) => set({ randomizeQuestions: v })} /> Randomise question order</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.randomizeOptions} onCheckedChange={(v) => set({ randomizeOptions: v })} /> Randomise options</label>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground sm:col-span-2">
              <Clock className="mr-1 inline h-3.5 w-3.5" /> The exam becomes available to eligible students on THIS computer only after the approved package is delivered here — the schedule is enforced locally at start time.
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="max-w-2xl space-y-3">
            <div><Label>Result visibility</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.resultVisibility} onChange={(e) => set({ resultVisibility: e.target.value as Assessment['resultVisibility'] })} aria-label="Result visibility">
                <option value="immediate">Immediately after submission</option>
                <option value="after_approval">After moderation approval</option>
                <option value="after_release">Only when school releases results</option>
              </select>
            </div>
            <div><Label>Answer feedback policy</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.feedbackPolicy} onChange={(e) => set({ feedbackPolicy: e.target.value as Assessment['feedbackPolicy'] })} aria-label="Feedback policy">
                <option value="none">No feedback (score only)</option>
                <option value="correct_incorrect">Correct / incorrect only</option>
                <option value="full_solutions">Full solutions & explanations</option>
              </select>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Security controls</p>
              <div className="mt-2 space-y-2 text-sm">
                <label className="flex items-center justify-between"><span>Lock to fullscreen during exam</span><Switch defaultChecked /></label>
                <label className="flex items-center justify-between"><span>Block copy/paste</span><Switch defaultChecked /></label>
                <label className="flex items-center justify-between"><span>Require invigilator code to resume an interrupted attempt</span><Switch defaultChecked /></label>
                <label className="flex items-center justify-between"><span>Access code required at start</span><Switch /></label>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="max-w-2xl space-y-2 text-sm">
            {[
              ['Name', form.name || '—'],
              ['Subject / classes', `${store.world.subjects[form.subjectId]?.name} · ${form.classIds.map((c) => store.world.classes[c]?.name).join(', ') || '—'}`],
              ['Type / access', `${TYPE_LABELS[form.type]} · ${form.access}`],
              ['Questions', `${questions.length} questions · ${totalMarks} marks`],
              ['Sections', form.sections.length ? form.sections.map((s) => s.name).join(', ') : 'Single section'],
              ['Window', `${form.startAt ? fmtDateTime(form.startAt) : '—'} → ${form.endAt ? fmtDateTime(form.endAt) : '—'}`],
              ['Duration / attempts', `${form.durationMin} min · ${form.attemptsAllowed} attempt(s)`],
              ['Results / feedback', `${form.resultVisibility.replace(/_/g, ' ')} · ${form.feedbackPolicy.replace(/_/g, ' ')}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b pb-2"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v}</span></div>
            ))}
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <ShieldCheck className="mr-1 inline h-4 w-4" /> Saved as <strong>draft v1</strong> on {store.activeDeviceId}. Submit for approval from the assessment page — an administrator must approve this version before distribution.
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {errors.map((e) => <li key={e}>• {e}</li>)}
          </ul>
        )}

        <div className="mt-5 flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)}><ArrowLeft className="mr-1.5 h-4 w-4" /> Back</Button>
          <Button size="sm" onClick={next}>{step === STEPS.length - 1 ? 'Save draft assessment' : 'Continue'} <ArrowRight className="ml-1.5 h-4 w-4" /></Button>
        </div>
      </SectionCard>

      {/* bank picker dialog */}
      <Dialog open={bankPicker} onOpenChange={setBankPicker}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Import from question bank</DialogTitle><DialogDescription>Questions stored on this computer ({store.activeDeviceId}).</DialogDescription></DialogHeader>
          <div className="space-y-2">
            {Object.values(local.questions).filter((q) => q.status === 'approved').map((q) => {
              const selected = form.questionIds.includes(q.id);
              return (
                <label key={q.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-accent ${selected ? 'border-primary bg-primary/5' : ''}`}>
                  <Checkbox checked={selected} onCheckedChange={(v) => set({ questionIds: v ? [...form.questionIds, q.id] : form.questionIds.filter((x) => x !== q.id) })} />
                  <div className="min-w-0">
                    <p className="text-sm">{q.statement.split('\n')[0].slice(0, 100)}</p>
                    <p className="text-xs text-muted-foreground">{QUESTION_TYPE_LABELS[q.type]} · {q.marks} marks · {q.topic} · {q.difficulty}</p>
                  </div>
                </label>
              );
            })}
            {Object.values(local.questions).filter((q) => q.status === 'approved').length === 0 && (
              <EmptyState title="No approved questions on this device" description="Ask a peer to sync the question bank, or create questions first." />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBankPicker(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI add dialog */}
      <Dialog open={aiAdd} onOpenChange={setAiAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>AI-generate questions</DialogTitle><DialogDescription>Simulated generation — drafts are added straight into this assessment.</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">Generates 3 {store.world.subjects[form.subjectId]?.name} questions for the selected topic and difficulty.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiAdd(false)}>Cancel</Button>
            <Button onClick={() => {
              const aiQs: Assessment['questionIds'] = [];
              const base = Object.values(local.questions).filter((q) => q.subjectId === form.subjectId).slice(0, 3);
              base.forEach((src) => {
                const copy = { ...src, id: `Q-AI-${Math.random().toString(36).slice(2, 8)}`, source: 'ai' as const, status: 'draft' as const, statement: `[AI] ${src.statement}` };
                local.questions[copy.id] = copy;
                aiQs.push(copy.id);
              });
              set({ questionIds: [...form.questionIds, ...aiQs] });
              setAiAdd(false);
              toast.success('3 AI-generated questions added', { description: 'Remember: they count as drafts for review purposes.' });
            }}><Sparkles className="mr-1.5 h-4 w-4" /> Generate & add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function swap<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

// ============================================================
// Assessment detail — lifecycle, versions, actions
// ============================================================

export function AssessmentDetailScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const id = store.route.params.id;
  const a = local.assessments[id];
  const user = store.currentUser()!;
  const canApprove = store.can('assessments.approve');
  const canDistribute = store.can('sync.distribute');
  const [distOpen, setDistOpen] = React.useState(false);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [targetDevices, setTargetDevices] = React.useState<Set<string>>(new Set());

  if (!a) {
    return <EmptyState title="Assessment not found on this computer" description="This record may exist on another device but has not been synchronized here. Open Computers & Sync to receive it." action={<Button size="sm" onClick={() => navigate('/app/sync')}>Open sync centre</Button>} />;
  }

  const questions = a.questionIds.map((qid) => local.questions[qid]).filter(Boolean);
  const versions = local.versions[a.id] ?? [];
  const transfers = local.transferQueue.filter((t) => t.payloadId === a.id);
  const doneCount = transfers.filter((t) => t.status === 'completed').length;
  const requests = local.approvalRequests.filter((r) => r.assessmentId === a.id);

  const lifecycle: AssessmentStatus[] = ['draft', 'pending_approval', 'approved', 'distributing', 'distributed', 'active', 'completed', 'marking', 'results_released'];
  const stageIdx = lifecycle.indexOf(a.status);

  const allGF = Object.values(store.world.devices).filter((d) => d.schoolId === a.schoolId);

  return (
    <div>
      <PageHeader
        title={a.name}
        description={`${a.instructions || a.description || 'No instructions.'}`}
        crumbs={[{ label: 'Assessments', onClick: () => navigate('/app/assessments') }, { label: a.name.slice(0, 30) }]}
        icon={<FileText className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => navigate('/app/assessments')}><ArrowLeft className="mr-1.5 h-4 w-4" /> Back</Button>
            {/* contextual actions by status + role */}
            {a.status === 'draft' && store.can('assessments.create') && <Button size="sm" onClick={() => setSubmitOpen(true)}><Send className="mr-1.5 h-4 w-4" /> Submit for approval</Button>}
            {a.status === 'revision_requested' && store.can('assessments.create') && <Button size="sm" onClick={() => setEditOpen(true)}><Pencil className="mr-1.5 h-4 w-4" /> Revise & resubmit</Button>}
            {a.status === 'approved' && canDistribute && <Button size="sm" onClick={() => setDistOpen(true)}><MonitorSmartphone className="mr-1.5 h-4 w-4" /> Distribute to computers</Button>}
            {['marking', 'awaiting_result_approval'].includes(a.status) && store.can('results.approve_release') && <Button size="sm" onClick={() => navigate('/app/results/publish')}>Review & release results</Button>}
          </>
        }
      />

      {/* lifecycle strip */}
      <div className="mb-4 overflow-x-auto rounded-xl border bg-card p-4">
        <div className="flex min-w-max items-center gap-1.5">
          {lifecycle.map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${i < stageIdx ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : i === stageIdx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {i < stageIdx ? <CheckCircle2 className="h-3 w-3" /> : i === stageIdx ? <span className="h-2 w-2 rounded-full bg-current" /> : null}
                {ASSESSMENT_STATUS_LABELS[s]}
              </div>
              {i < lifecycle.length - 1 && <span className="h-px w-4 bg-border" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="Overview">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div><p className="text-xs text-muted-foreground">Status</p><div className="mt-0.5"><StatusBadge status={a.status} label={ASSESSMENT_STATUS_LABELS[a.status]} /></div></div>
              <div><p className="text-xs text-muted-foreground">Version</p><p className="mt-0.5 font-medium">v{a.version}{a.approvedVersion ? ` · approved v${a.approvedVersion}` : ''}</p></div>
              <div><p className="text-xs text-muted-foreground">Subject / classes</p><p className="mt-0.5">{store.world.subjects[a.subjectId]?.name} · {a.classIds.map((c) => store.world.classes[c]?.name).join(', ')}</p></div>
              <div><p className="text-xs text-muted-foreground">Marks</p><p className="mt-0.5">{a.totalMarks} total · pass {a.passMark}</p></div>
              <div><p className="text-xs text-muted-foreground">Window</p><p className="mt-0.5">{fmtDateTime(a.startAt)} → {fmtDateTime(a.endAt)}</p></div>
              <div><p className="text-xs text-muted-foreground">Duration / attempts</p><p className="mt-0.5">{a.durationMin} min · {a.attemptsAllowed} attempt(s)</p></div>
              <div><p className="text-xs text-muted-foreground">Created by</p><p className="mt-0.5">{a.createdByName} on {a.createdOnDevice}</p></div>
              {a.approvedByName && <div><p className="text-xs text-muted-foreground">Approved by</p><p className="mt-0.5">{a.approvedByName} · {fmtRelative(a.approvedAt)}</p></div>}
              {a.rejectionNote && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Reviewer note</p><p className="mt-0.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">{a.rejectionNote}</p></div>}
            </div>
          </SectionCard>

          <SectionCard title={`Questions (${questions.length})`} description="Stored locally; the delivered package pins the approved copy.">
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div key={q.id} className="rounded-lg border p-3">
                  <p className="text-sm">{i + 1}. {q.statement.split('\n')[0].slice(0, 110)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{QUESTION_TYPE_LABELS[q.type]} · {q.marks} marks · {q.difficulty} · {q.topic}</p>
                </div>
              ))}
              {questions.length === 0 && <p className="text-sm text-muted-foreground">Question payloads for this package are pinned on delivery — details are available on the distributing computer.</p>}
            </div>
          </SectionCard>

          {transfers.length > 0 && (
            <SectionCard title={`Distribution progress (${doneCount}/${transfers.length} completed)`} description="Per-computer transfers of the approved package">
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {transfers.slice(0, 30).map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-xs">
                    <span className="flex items-center gap-1.5"><MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground" /> {t.toDeviceId} {store.world.devices[t.toDeviceId]?.name}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className={`h-full ${t.status === 'completed' ? 'bg-emerald-500' : t.status === 'blocked_offline' ? 'bg-amber-500' : t.status === 'failed' ? 'bg-red-500' : 'bg-violet-500'}`} style={{ width: `${t.status === 'completed' ? 100 : t.progress}%` }} /></div>
                      <StatusBadge status={t.status} label={t.status === 'blocked_offline' ? 'pending' : t.status} />
                    </div>
                  </div>
                ))}
              </div>
              {transfers.some((t) => t.status === 'blocked_offline' || t.status === 'failed') && (
                <Button size="sm" variant="outline" className="mt-3" onClick={() => navigate('/app/sync')}><RefreshCcw className="mr-1.5 h-4 w-4" /> Manage retries in Sync Centre</Button>
              )}
            </SectionCard>
          )}
        </div>

        <div className="space-y-4">
          <SectionCard title="Approval rule" >
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              <ShieldCheck className="mb-1 h-4 w-4" />
              A teacher-created assessment stays unavailable for controlled delivery until an authorized administrator approves <strong>this exact version</strong>. If the approved exam is edited, the edits become a new draft revision — the approved version is never silently altered.
            </div>
          </SectionCard>

          <SectionCard title="Version history" action={<History className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-2">
              {versions.length === 0 && <p className="text-xs text-muted-foreground">v{a.version} — initial creation.</p>}
              {versions.slice().reverse().map((v, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border p-2.5 text-xs">
                  <Badge variant="outline" className="shrink-0">v{v.version}</Badge>
                  <div><p>{v.changeSummary}</p><p className="mt-0.5 text-muted-foreground">{v.editedBy} · {fmtRelative(v.editedAt)} · {v.statusAtCreation.replace(/_/g, ' ')}</p></div>
                </div>
              ))}
            </div>
          </SectionCard>

          {requests.length > 0 && (
            <SectionCard title="Approval requests">
              <div className="space-y-2">
                {requests.map((r) => (
                  <div key={r.id} className="rounded-lg border p-2.5 text-xs">
                    <p className="font-medium">{r.assessmentName} v{r.version}</p>
                    <p className="text-muted-foreground">to {r.to ?? 'reviewer'} · {fmtRelative(r.requestedAt)}</p>
                    <div className="mt-1"><StatusBadge status={r.status} /></div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {(canApprove || canDistribute) && ['approved', 'distributing', 'distributed'].includes(a.status) && (
            <SectionCard title="Quick actions">
              <div className="space-y-2">
                <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setDistOpen(true)}><MonitorSmartphone className="mr-1.5 h-4 w-4" /> Distribute to peers</Button>
                <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => navigate('/app/exams')}><Clock className="mr-1.5 h-4 w-4" /> Monitor exam sessions</Button>
                <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => navigate('/app/results')}><FileText className="mr-1.5 h-4 w-4" /> Result collection</Button>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {/* submit for approval dialog */}
      <SubmitForApprovalDialog open={submitOpen} onOpenChange={setSubmitOpen} assessment={a} />

      {/* distribute dialog */}
      <Dialog open={distOpen} onOpenChange={setDistOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Distribute “{a.name}”</DialogTitle>
            <DialogDescription>Sends the approved package (v{a.approvedVersion ?? a.version}) to selected computers over the LAN. Each computer keeps its own local copy.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setTargetDevices(new Set(allGF.filter((d) => d.id !== store.activeDeviceId).map((d) => d.id)))}>Select all {allGF.length - 1} computers</Button>
              <Button size="sm" variant="outline" onClick={() => setTargetDevices(new Set())}>Clear</Button>
              <span className="ml-auto text-xs text-muted-foreground">{targetDevices.size} selected · only paired & online peers can receive now; offline ones queue.</span>
            </div>
            <div className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {allGF.filter((d) => d.id !== store.activeDeviceId).map((d) => (
                <label key={d.id} className={`flex items-center gap-2 rounded border p-2 text-xs ${targetDevices.has(d.id) ? 'border-primary bg-primary/5' : ''}`}>
                  <Checkbox checked={targetDevices.has(d.id)} onCheckedChange={(v) => setTargetDevices((s) => { const n = new Set(s); if (v) n.add(d.id); else n.delete(d.id); return n; })} />
                  <span className="flex-1 truncate">{d.name} <span className="text-muted-foreground">{d.id}</span></span>
                  <span className={`h-2 w-2 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-red-400'}`} />
                  {!d.paired && <Badge variant="outline" className="text-[9px]">unpaired</Badge>}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDistOpen(false)}>Cancel</Button>
            <Button
              disabled={targetDevices.size === 0}
              onClick={() => {
                const queued = store.distributeAssessment(a.id, Array.from(targetDevices));
                setDistOpen(false);
                toast.success(`Distribution started → ${queued} computer(s)`, { description: 'Transfers run in the background. Watch progress here or in the Sync Centre.' });
              }}
            >
              <Send className="mr-1.5 h-4 w-4" /> Start distribution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* edit dialog */}
      <EditRevisionDialog open={editOpen} onOpenChange={setEditOpen} assessment={a} />
    </div>
  );
}

// ============================================================
// Edit revision dialog — creates a new draft revision on save
// ============================================================

function EditRevisionDialog({ open, onOpenChange, assessment }: { open: boolean; onOpenChange: (v: boolean) => void; assessment: Assessment }) {
  const store = useDemoStore();
  const [name, setName] = React.useState(assessment.name);
  const [instructions, setInstructions] = React.useState(assessment.instructions);
  React.useEffect(() => {
    if (open) { setName(assessment.name); setInstructions(assessment.instructions); }
  }, [open, assessment]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Revise assessment</DialogTitle><DialogDescription>Creates a new draft revision — the approved version stays untouched.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          <div><Label>Name</Label><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" /></div>
          <div><Label>Instructions</Label><Textarea className="mt-1" value={instructions} onChange={(e) => setInstructions(e.target.value)} aria-label="Instructions" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => {
            store.saveAssessment({ ...assessment, name, instructions }, 'Revised after reviewer request');
            onOpenChange(false);
            toast.success('New draft revision created', { description: `v${assessment.version + 1} saved locally — resubmit for approval.` });
          }}>Save revision & resubmit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Submit-for-approval dialog (choose destination reviewer device)
// ============================================================

function SubmitForApprovalDialog({ open, onOpenChange, assessment }: { open: boolean; onOpenChange: (v: boolean) => void; assessment: Assessment }) {
  const store = useDemoStore();
  const reviewers = Object.values(store.world.devices).filter((d) => d.schoolId === assessment.schoolId && d.paired && ['DEV-001', 'DEV-005', 'DEV-008', 'DEV-043', 'DEV-022'].includes(d.id));
  const [target, setTarget] = React.useState('DEV-043');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit for approval</DialogTitle>
          <DialogDescription>Choose the computer holding an authorized reviewer. The request transfers over the LAN; if that computer is offline it will queue.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {reviewers.map((d) => (
            <label key={d.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${target === d.id ? 'border-primary bg-primary/5' : ''}`}>
              <input type="radio" name="reviewer" checked={target === d.id} onChange={() => setTarget(d.id)} aria-label={d.name} className="accent-[var(--primary)]" />
              <div className="flex-1">
                <p className="font-medium">{d.name} <span className="text-muted-foreground">({d.id})</span></p>
                <p className="text-xs text-muted-foreground">{['DEV-043', 'DEV-001'].includes(d.id) ? 'Administrator workstation' : d.id === 'DEV-005' ? 'Examination officer' : d.id === 'DEV-022' ? 'Head of department' : 'Administrator'}</p>
              </div>
              <span className={`h-2 w-2 rounded-full ${d.online && store.world.network.lanOnline ? 'bg-emerald-500' : 'bg-red-400'}`} title={d.online ? 'online' : 'offline'} />
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => {
            store.submitAssessmentForApproval(assessment.id, target);
            onOpenChange(false);
            toast.success('Submitted for approval', { description: `Request queued → ${target}. Switch to that computer as an administrator to approve it.` });
          }}><Send className="mr-1.5 h-4 w-4" /> Send request to {target}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Approvals queue
// ============================================================

export function ApprovalsScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const requests = local.approvalRequests;
  const [detail, setDetail] = React.useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="Approvals"
        description={`Assessment approval requests received on ${store.activeDeviceId}. Approvals are version-specific and audited.`}
        icon={<Stamp className="h-5 w-5" />}
      />
      {requests.length === 0 ? (
        <EmptyState
          title="No approval requests on this computer"
          description="When a teacher submits an assessment for approval and targets this computer, the request appears here after the transfer completes."
          icon={<Stamp className="h-6 w-6" />}
          action={<Button size="sm" variant="outline" onClick={() => navigate('/app/sync')}>Open sync centre</Button>}
        />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{r.assessmentName} <Badge variant="outline" className="ml-1">v{r.version}</Badge></p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.questionCount} questions · {r.totalMarks} marks · requested by {r.requestedByName} from {r.fromDeviceId} · {fmtRelative(r.requestedAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.status === 'pending' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setDetail(detail === r.id ? null : r.id)}>{detail === r.id ? 'Hide' : 'Review'}</Button>
                      <Button size="sm" variant="outline" onClick={() => { store.decideApproval(r.id, 'revision_requested', 'Please clarify Section B instructions and confirm the pass mark.'); toast('Revision requested', { description: 'The teacher will be notified once the decision syncs back.' }); }}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Request changes
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { store.decideApproval(r.id, 'rejected', 'Question mix too difficult for a mid-term; rebalance easy/hard ratio.'); toast('Request rejected'); }}>
                        <XCircle className="mr-1 h-3.5 w-3.5 text-red-500" /> Reject
                      </Button>
                      <Button size="sm" onClick={() => { store.decideApproval(r.id, 'approved'); toast.success(`Approved "${r.assessmentName}" v${r.version}`, { description: 'The decision syncs to the teacher. You can now distribute this version.' }); }}>
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                    </>
                  )}
                  {r.status === 'approved' && (
                    <Button size="sm" variant="outline" onClick={() => navigate(`/app/assessments/${r.assessmentId}`)}>Open & distribute</Button>
                  )}
                </div>
              </div>
              {detail === r.id && (
                <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3 text-xs">
                  <p className="font-semibold text-foreground">Review checklist</p>
                  {[
                    ['Version identity', `Approval will be recorded against v${r.version} only.`],
                    ['Question coverage', `${r.questionCount} questions across the declared sections.`],
                    ['Marks & pass mark', `${r.totalMarks} total marks.`],
                    ['Distribution plan', 'After approval, distribute from this computer to lab peers.'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /><span><strong>{k}:</strong> {v}</span></div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
