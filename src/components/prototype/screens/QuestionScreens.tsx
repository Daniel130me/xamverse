'use client';

/** Question banks — overview tabs, full editor (9 types), AI assistant */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { PageHeader, StatCard, SectionCard, StatusBadge, DataTable, EmptyState, UserAvatar, AccessDenied } from '../shared/ui-kit';
import { QUESTION_TYPE_LABELS, fmtDate, fmtRelative } from '@/lib/prototype/ui-utils';
import { QuestionRenderer } from './ExamRunner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Layers, Plus, Sparkles, Pencil, Copy, Archive, Upload, Download, Search, CheckCircle2, XCircle,
  Wand2, RefreshCcw, Save, FileUp, CircleAlert, CloudOff, HardDrive, Clock, BrainCircuit, Eye, History,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Question, QuestionType } from '@/lib/prototype/types';

// ============================================================
// Question banks overview
// ============================================================

export function QuestionBanksScreen() {
  const store = useDemoStore();
  const local = store.local();
  const user = store.currentUser()!;
  const navigate = store.navigate;
  const questions = Object.values(local.questions);
  const canApprove = store.can('questions.approve');
  const [editing, setEditing] = React.useState<Question | null>(null);

  const mine = questions.filter((q) => q.createdBy === user.id);
  const pending = questions.filter((q) => q.status === 'pending_review');
  const approved = questions.filter((q) => q.status === 'approved');
  const drafts = questions.filter((q) => q.status === 'draft');
  const archived = questions.filter((q) => q.status === 'archived');

  const columns = [
    {
      key: 'statement', header: 'Question', render: (q: Question) => (
        <div className="min-w-0">
          <p className="max-w-md truncate text-sm font-medium">{q.statement.split('\n')[0]}</p>
          <p className="text-xs text-muted-foreground">{store.world.subjects[q.subjectId]?.name} · {q.topic}{q.subtopic ? ` › ${q.subtopic}` : ''}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (q: Question) => <Badge variant="outline" className="whitespace-nowrap">{QUESTION_TYPE_LABELS[q.type]}</Badge> },
    { key: 'difficulty', header: 'Difficulty', render: (q: Question) => <span className={`text-xs font-medium capitalize ${q.difficulty === 'easy' ? 'text-emerald-600' : q.difficulty === 'medium' ? 'text-amber-600' : 'text-red-600'}`}>{q.difficulty}</span> },
    { key: 'marks', header: 'Marks', sortable: true, render: (q: Question) => <span className="tabular-nums">{q.marks}</span> },
    { key: 'status', header: 'Status', render: (q: Question) => <StatusBadge status={q.status} /> },
    { key: 'updated', header: 'Updated', sortable: true, render: (q: Question) => <span className="text-xs text-muted-foreground">{fmtRelative(q.updatedAt)}</span> },
    {
      key: 'actions', header: '', render: (q: Question) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => setEditing(q)}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="sm" onClick={() => { const copy = { ...q, id: `Q-${Date.now()}`, status: 'draft' as const, statement: q.statement, version: 1 }; store.saveQuestion(copy, 'Duplicated'); toast.success('Question duplicated as draft'); }}><Copy className="h-3.5 w-3.5" /></Button>
        </div>
      ),
    },
  ];

  const filterBar = (rows: Question[]) => (
    <DataTable
      rows={rows}
      rowKey={(q) => q.id}
      searchable
      searchKeys={(q) => `${q.statement} ${q.topic} ${q.tags.join(' ')}`}
      filters={[
        { key: 'subject', label: 'Subject', options: Object.values(store.world.subjects).map((s) => ({ value: s.id, label: s.name })), match: (q, v) => q.subjectId === v },
        { key: 'type', label: 'Type', options: Object.entries(QUESTION_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })), match: (q, v) => q.type === v },
        { key: 'difficulty', label: 'Difficulty', options: [{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }], match: (q, v) => q.difficulty === v },
      ]}
      onRowClick={(q) => setEditing(q)}
      columns={columns}
      emptyState={<EmptyState title="No questions in this view" description="Create one manually or let the AI assistant draft a set for you." action={<Button size="sm" onClick={() => navigate('/app/questions/editor')}><Plus className="mr-1.5 h-4 w-4" /> New question</Button>} />}
    />
  );

  return (
    <div>
      <PageHeader
        title="Question banks"
        description={`Everything stored locally on ${store.activeDeviceId}. Questions reach other computers only through sync.`}
        icon={<Layers className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => toast.success('Bulk import started (simulated)', { description: 'Map columns, preview, then confirm — duplicates detected.' })}><Upload className="mr-1.5 h-4 w-4" /> Import</Button>
            <Button size="sm" variant="outline" onClick={() => toast.success('Exported question-bank.json (simulated)')}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
            <Button size="sm" onClick={() => navigate('/app/questions/editor')}><Plus className="mr-1.5 h-4 w-4" /> New question</Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="All questions" value={questions.length} sub="on this computer" icon={<Layers className="h-4 w-4" />} />
        <StatCard label="My drafts" value={drafts.filter((q) => q.createdBy === user.id).length} tone="warning" icon={<Pencil className="h-4 w-4" />} />
        <StatCard label="Pending review" value={pending.length} tone="info" icon={<Clock className="h-4 w-4" />} />
        <StatCard label="Approved" value={approved.length} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="AI-generated" value={questions.filter((q) => q.source === 'ai').length} tone="progress" icon={<Sparkles className="h-4 w-4" />} />
      </div>

      <Tabs defaultValue="all">
        <TabsList className="flex-wrap">
          <TabsTrigger value="all">All ({questions.length})</TabsTrigger>
          <TabsTrigger value="mine">My drafts ({mine.filter((q) => q.status === 'draft').length})</TabsTrigger>
          <TabsTrigger value="pending">Pending review ({pending.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="archived">Archived ({archived.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-3">{filterBar(questions)}</TabsContent>
        <TabsContent value="mine" className="mt-3">{filterBar(mine)}</TabsContent>
        <TabsContent value="pending" className="mt-3">
          {canApprove && pending.length > 0 && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-900 dark:bg-sky-950/40">
              <CircleAlert className="h-4 w-4 text-sky-600" /> You can approve or reject pending questions below — approvals are versioned and recorded in the audit log.
            </div>
          )}
          {filterBar(pending)}
        </TabsContent>
        <TabsContent value="approved" className="mt-3">{filterBar(approved)}</TabsContent>
        <TabsContent value="archived" className="mt-3">{filterBar(archived)}</TabsContent>
      </Tabs>

      <QuestionEditorDialog question={editing} onOpenChange={(v) => !v && setEditing(null)} />
    </div>
  );
}

// ============================================================
// Editor — create/edit, all types
// ============================================================

const blankQuestion = (subjectId: string, level: string): Question => ({
  id: `Q-${Date.now()}`, schoolId: 'sch-greenfield', subjectId, level,
  topic: '', type: 'single_choice', difficulty: 'medium', estimatedTimeSec: 60, marks: 2, tags: [],
  statement: '', options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }],
  correct: [], status: 'draft', createdBy: '', createdByName: '', createdAt: '', updatedAt: '',
  version: 1, source: 'manual', usageCount: 0, attachment: null,
});

export function QuestionEditorScreen() {
  const store = useDemoStore();
  const local = store.local();
  const navigate = store.navigate;
  const user = store.currentUser()!;
  const urlId = store.route.params.id;
  const existing = urlId ? local.questions[urlId] : null;
  const [q, setQ] = React.useState<Question>(() => existing ?? blankQuestion('sub-math', 'SS2'));
  const topics = store.world.topics.filter((t) => t.subjectId === q.subjectId);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const set = (patch: Partial<Question>) => setQ((prev) => ({ ...prev, ...patch }));

  const save = (status?: Question['status']) => {
    const final: Question = {
      ...q,
      status: status ?? q.status,
      createdBy: q.createdBy || user.id,
      createdByName: q.createdByName || user.name,
      createdAt: q.createdAt || new Date().toISOString(),
    };
    store.saveQuestion(final);
    toast.success(existing ? 'Question updated' : 'Question saved as draft', { description: `Saved locally on ${store.activeDeviceId} — v${final.version}.` });
    set(final);
  };

  return (
    <div>
      <PageHeader
        title={existing ? `Edit question — v${existing.version}` : 'New question'}
        description="Author once, review, approve, then use in any assessment. Rich content, equations and media placeholders are supported."
        crumbs={[{ label: 'Question banks', onClick: () => navigate('/app/questions') }, { label: existing ? 'Edit' : 'New' }]}
        icon={<Pencil className="h-5 w-5" />}
        actions={
          <>
            {existing && <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}><History className="mr-1.5 h-4 w-4" /> Version history</Button>}
            <Button size="sm" variant="outline" onClick={() => save('draft')}><Save className="mr-1.5 h-4 w-4" /> Save draft</Button>
            <Button size="sm" onClick={() => { save('pending_review'); toast.success('Submitted for review', { description: 'A reviewer (HOD or administrator) must approve it.' }); }}><Upload className="mr-1.5 h-4 w-4" /> Submit for review</Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="Question statement">
            <Textarea rows={4} value={q.statement} onChange={(e) => set({ statement: e.target.value })} placeholder="Type the question. Use **bold**, line breaks, and insert media placeholders below." aria-label="Question statement" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['Insert image', 'Insert table', 'Insert audio', 'Insert equation'].map((b) => (
                <Button key={b} type="button" size="sm" variant="outline" onClick={() => { set({ attachment: { kind: b.includes('image') ? 'image' : b.includes('table') ? 'table' : b.includes('audio') ? 'audio' : 'table', label: b } }); toast(`${b} placeholder added`); }}>{b}</Button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Answers" description="Configure the correct response and supporting material.">
            <TypeSpecificEditor q={q} set={set} />
          </SectionCard>

          <SectionCard title="Explanation & worked solution" description="Shown to students per the assessment's feedback policy.">
            <div className="space-y-2">
              <div><Label>Explanation</Label><Textarea rows={2} className="mt-1" value={q.explanation ?? ''} onChange={(e) => set({ explanation: e.target.value })} placeholder="Why the correct answer is right…" /></div>
              <div><Label>Worked solution (optional)</Label><Textarea rows={3} className="mt-1" value={q.workedSolution ?? ''} onChange={(e) => set({ workedSolution: e.target.value })} placeholder="Step-by-step solution for full-solutions feedback…" /></div>
              <div><Label>Hint (optional)</Label><Input className="mt-1" value={q.hint ?? ''} onChange={(e) => set({ hint: e.target.value })} placeholder="A nudge without giving it away…" /></div>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Classification">
            <div className="space-y-2.5">
              <div><Label>Subject</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={q.subjectId} onChange={(e) => set({ subjectId: e.target.value, topic: '' })} aria-label="Subject">
                  {Object.values(store.world.subjects).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><Label>Academic level</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={q.level} onChange={(e) => set({ level: e.target.value })} aria-label="Level">
                  {['PRY6', 'JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'].map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div><Label>Topic</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={q.topic} onChange={(e) => set({ topic: e.target.value })} aria-label="Topic">
                  <option value="">Select topic…</option>
                  {topics.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div><Label>Subtopic</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={q.subtopic ?? ''} onChange={(e) => set({ subtopic: e.target.value })} aria-label="Subtopic">
                  <option value="">—</option>
                  {topics.find((t) => t.name === q.topic)?.subtopics.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div><Label>Learning objective</Label><Input className="mt-1" value={q.learningObjective ?? ''} onChange={(e) => set({ learningObjective: e.target.value })} placeholder="What should the student demonstrate?" /></div>
            </div>
          </SectionCard>
          <SectionCard title="Marks & timing">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Marks</Label><Input type="number" min={1} className="mt-1" value={q.marks} onChange={(e) => set({ marks: Number(e.target.value) })} /></div>
              <div><Label>Est. time (sec)</Label><Input type="number" min={10} step={10} className="mt-1" value={q.estimatedTimeSec} onChange={(e) => set({ estimatedTimeSec: Number(e.target.value) })} /></div>
              <div className="col-span-2"><Label>Difficulty</Label>
                <div className="mt-1 flex gap-1.5">
                  {(['easy', 'medium', 'hard'] as const).map((d) => (
                    <button key={d} type="button" onClick={() => set({ difficulty: d })} className={`flex-1 rounded-lg border py-1.5 text-xs capitalize ${q.difficulty === d ? 'border-primary bg-primary/10 text-primary' : ''}`}>{d}</button>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
          <SectionCard title="Tags">
            <TagEditor tags={q.tags} onChange={(tags) => set({ tags })} />
          </SectionCard>
          {q.source === 'ai' && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
              <Sparkles className="mb-1 h-4 w-4" /> Generated by the AI assistant — reviewed and editable before approval.
            </div>
          )}
        </div>
      </div>

      {historyOpen && existing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setHistoryOpen(false)}>
          <div className="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">Version history</h3>
            <div className="mt-3 space-y-2">
              {Array.from({ length: existing.version }, (_, i) => i + 1).reverse().map((v) => (
                <div key={v} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div>
                    <p className="font-medium">Version {v}{v === existing.version && ' (current)'}</p>
                    <p className="text-xs text-muted-foreground">{v === existing.version ? 'Latest edit on this computer' : `Earlier revision by ${existing.createdByName}`}</p>
                  </div>
                  <Badge variant="outline">v{v}</Badge>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setHistoryOpen(false)}>Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [val, setVal] = React.useState('');
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => <Badge key={t} variant="secondary">{t} <button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="ml-1 hover:text-red-500">×</button></Badge>)}
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Add tag…" onKeyDown={(e) => { if (e.key === 'Enter' && val.trim()) { onChange([...tags, val.trim()]); setVal(''); } }} />
      </div>
    </div>
  );
}

function TypeSpecificEditor({ q, set }: { q: Question; set: (patch: Partial<Question>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Question type</Label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(Object.entries(QUESTION_TYPE_LABELS) as [QuestionType, string][]).map(([t, l]) => (
            <button key={t} type="button" onClick={() => {
              const patch: Partial<Question> = { type: t };
              if (t === 'single_choice' && !q.options?.length) patch.options = [{ id: 'a', text: '' }, { id: 'b', text: '' }];
              if (t === 'matching' && !q.pairs) patch.pairs = [{ left: '', right: '' }];
              if (t === 'ordering' && !q.items) patch.items = ['', ''];
              if (t === 'fill_blank' && !q.blanks) patch.blanks = [{ answer: '' }];
              if (t === 'true_false' && !q.options) patch.options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }];
              set(patch);
            }} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${q.type === t ? 'border-primary bg-primary/10 text-primary' : ''}`}>{l}</button>
          ))}
        </div>
      </div>

      {(q.type === 'single_choice' || q.type === 'multi_choice') && (
        <div className="space-y-2">
          {(q.options ?? []).map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <Checkbox
                aria-label={`Mark option ${o.id} correct`}
                checked={q.correct.includes(o.id)}
                onCheckedChange={(v) => set({ correct: v ? [...q.correct, o.id] : q.correct.filter((c) => c !== o.id) })}
              />
              <span className="w-6 text-center text-xs font-bold text-muted-foreground">{String.fromCharCode(97 + i)}</span>
              <Input value={o.text} onChange={(e) => set({ options: q.options!.map((x) => x.id === o.id ? { ...x, text: e.target.value } : x) })} placeholder={`Option ${String.fromCharCode(97 + i)}`} />
              <Button variant="ghost" size="sm" aria-label="Remove option" onClick={() => set({ options: q.options!.filter((x) => x.id !== o.id), correct: q.correct.filter((c) => c !== o.id) })}>×</Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => set({ options: [...(q.options ?? []), { id: Math.random().toString(36).slice(2, 5), text: '' }] })}><Plus className="mr-1 h-3.5 w-3.5" /> Add option</Button>
            {q.type === 'multi_choice' && <p className="self-center text-xs text-muted-foreground">Tick all correct options.</p>}
          </div>
        </div>
      )}

      {q.type === 'true_false' && (
        <div className="flex gap-2">
          {['true', 'false'].map((v) => (
            <button key={v} type="button" onClick={() => set({ correct: [v] })} className={`rounded-lg border px-6 py-2 text-sm capitalize ${q.correct[0] === v ? 'border-primary bg-primary/10 text-primary' : ''}`}>{v}</button>
          ))}
        </div>
      )}

      {(q.type === 'short_answer') && (
        <div>
          <Label>Accepted answers (comma-separated)</Label>
          <Input className="mt-1" value={q.correct.join(', ')} onChange={(e) => set({ correct: e.target.value.split(',').map((s) => s.trim()) })} placeholder="e.g. are, were" />
        </div>
      )}

      {q.type === 'numeric' && (
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Correct value</Label><Input className="mt-1" value={q.correct[0] ?? ''} onChange={(e) => set({ correct: [e.target.value] })} /></div>
          <div><Label>Tolerance (±)</Label><Input type="number" step="0.01" className="mt-1" value={q.tolerance ?? 0.01} onChange={(e) => set({ tolerance: Number(e.target.value) })} /></div>
        </div>
      )}

      {q.type === 'essay' && (
        <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">Essays are marked manually against a rubric after submission. Put the rubric in the explanation field — it appears in the marking screen.</p>
      )}

      {q.type === 'matching' && (
        <div className="space-y-2">
          {(q.pairs ?? []).map((p, i) => (
            <div key={i} className="flex gap-2">
              <Input value={p.left} onChange={(e) => set({ pairs: q.pairs!.map((x, j) => j === i ? { ...x, left: e.target.value } : x) })} placeholder={`Left item ${i + 1}`} />
              <Input value={p.right} onChange={(e) => set({ pairs: q.pairs!.map((x, j) => j === i ? { ...x, right: e.target.value } : x) })} placeholder={`Match ${i + 1}`} />
              <Button variant="ghost" size="sm" onClick={() => set({ pairs: q.pairs!.filter((_, j) => j !== i) })}>×</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set({ pairs: [...(q.pairs ?? []), { left: '', right: '' }] })}><Plus className="mr-1 h-3.5 w-3.5" /> Add pair</Button>
        </div>
      )}

      {q.type === 'ordering' && (
        <div className="space-y-2">
          {(q.items ?? []).map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">{i + 1}</span>
              <Input value={it} onChange={(e) => set({ items: q.items!.map((x, j) => j === i ? e.target.value : x) })} placeholder={`Step ${i + 1} in correct order`} />
              <Button variant="ghost" size="sm" onClick={() => set({ items: q.items!.filter((_, j) => j !== i) })}>×</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set({ items: [...(q.items ?? []), ''] })}><Plus className="mr-1 h-3.5 w-3.5" /> Add step</Button>
        </div>
      )}

      {q.type === 'fill_blank' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">In the statement, type <code className="rounded bg-muted px-1">{'{{blank1}}'}</code> etc. where blanks belong. Define answers below.</p>
          {(q.blanks ?? []).map((b, i) => (
            <div key={i} className="flex gap-2">
              <span className="flex h-9 w-24 items-center text-xs text-muted-foreground">Blank {i + 1}</span>
              <Input value={b.answer} onChange={(e) => set({ blanks: q.blanks!.map((x, j) => j === i ? { answer: e.target.value } : x) })} placeholder="Accepted answer" />
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set({ blanks: [...(q.blanks ?? []), { answer: '' }] })}><Plus className="mr-1 h-3.5 w-3.5" /> Add blank</Button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Editor dialog wrapper for quick edit from the table
// ============================================================

function QuestionEditorDialog({ question, onOpenChange }: { question: Question | null; onOpenChange: (v: boolean) => void }) {
  const store = useDemoStore();
  const user = store.currentUser()!;
  const [q, setQ] = React.useState<Question | null>(question);
  const [preview, setPreview] = React.useState(false);
  React.useEffect(() => setQ(question), [question]);
  if (!q) return null;
  const canApprove = store.can('questions.approve');
  const isOwn = q.createdBy === user.id;

  const save = (status?: Question['status']) => {
    store.saveQuestion({ ...q, status: status ?? q.status });
    toast.success('Question saved', { description: `v${q.version + 1} stored locally.` });
    onOpenChange(false);
  };

  return (
    <Dialog open={!!question} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit question</DialogTitle>
          <DialogDescription>{store.world.subjects[q.subjectId]?.name} · {q.topic} · v{q.version} · used in {q.usageCount} assessments</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea rows={3} value={q.statement} onChange={(e) => setQ({ ...q, statement: e.target.value })} aria-label="Statement" />
          <TypeSpecificEditor q={q} set={(patch) => setQ({ ...q, ...patch })} />
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Marks</Label><Input type="number" className="mt-1" value={q.marks} onChange={(e) => setQ({ ...q, marks: Number(e.target.value) })} /></div>
            <div><Label>Status</Label>
              <div className="mt-1"><StatusBadge status={q.status} /></div>
            </div>
          </div>
          {preview && (
            <div className="rounded-xl border p-4">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">STUDENT PREVIEW</p>
              <QuestionRenderer question={q} attemptAnswers={{}} showCorrect />
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setPreview((v) => !v)}><Eye className="mr-1.5 h-4 w-4" /> {preview ? 'Hide preview' : 'Preview'}</Button>
          {canApprove && q.status === 'pending_review' && (
            <>
              <Button variant="outline" size="sm" onClick={() => { store.saveQuestion({ ...q, status: 'rejected' }); toast('Question rejected', { description: 'The author will see the rejection after sync.' }); onOpenChange(false); }}><XCircle className="mr-1.5 h-4 w-4 text-red-500" /> Reject</Button>
              <Button size="sm" onClick={() => { store.saveQuestion({ ...q, status: 'approved' }); toast.success('Question approved'); onOpenChange(false); }}><CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve</Button>
            </>
          )}
          {isOwn && <Button variant="outline" size="sm" onClick={() => { store.saveQuestion({ ...q, status: 'archived' }); toast('Question archived'); onOpenChange(false); }}><Archive className="mr-1.5 h-4 w-4" /> Archive</Button>}
          <Button size="sm" onClick={() => save()}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// AI assistant
// ============================================================

const AI_STATES = [
  { id: 'cloud', label: 'Cloud AI available', desc: 'Connected — generation uses the cloud provider.', icon: BrainCircuit, tone: 'success' },
  { id: 'local', label: 'Local AI available', desc: 'A small model runs on this computer — no internet needed.', icon: HardDrive, tone: 'info' },
  { id: 'none', label: 'No AI configured', desc: 'Configure a provider in Settings → AI.', icon: CloudOff, tone: 'warning' },
];

const SAMPLE_GENERATED: Omit<Question, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'attachment'>[] = [
  {
    schoolId: 'sch-greenfield', subjectId: 'sub-math', level: 'SS2', topic: 'Algebraic Fractions', subtopic: 'Operations',
    learningObjective: 'Add and subtract algebraic fractions',
    type: 'single_choice', difficulty: 'medium', estimatedTimeSec: 90, marks: 2,
    statement: 'Simplify: 1/(x+1) + 1/(x−1)',
    options: [{ id: 'a', text: '2x / (x² − 1)' }, { id: 'b', text: '2 / (x² − 1)' }, { id: 'c', text: '(x²−1)/2x' }, { id: 'd', text: '2x / (x² + 1)' }],
    correct: ['a'], explanation: 'Common denominator (x+1)(x−1): numerator = (x−1) + (x+1) = 2x.',
    workedSolution: '1/(x+1) + 1/(x−1) = [(x−1) + (x+1)] / [(x+1)(x−1)] = 2x/(x²−1)',
    tags: ['algebra', 'ai-generated'], status: 'draft', createdBy: '', createdByName: '', version: 1, source: 'ai',
  },
  {
    schoolId: 'sch-greenfield', subjectId: 'sub-math', level: 'SS2', topic: 'Indices and Logarithms', subtopic: 'Equations with indices',
    learningObjective: 'Solve exponential equations',
    type: 'short_answer', difficulty: 'hard', estimatedTimeSec: 120, marks: 3,
    statement: 'Solve for x: 3^(2x) − 12(3^x) + 27 = 0',
    correct: ['1', '2'], acceptMultiple: true,
    explanation: 'Let y = 3^x. Then y² − 12y + 27 = 0 → (y−3)(y−9) = 0 → y = 3 or 9 → x = 1 or 2.',
    workedSolution: 'Substitute y = 3^x, solve the quadratic, convert back with y = 3^x.',
    tags: ['indices', 'ai-generated'], status: 'draft', createdBy: '', createdByName: '', version: 1, source: 'ai',
  },
  {
    schoolId: 'sch-greenfield', subjectId: 'sub-math', level: 'SS2', topic: 'Statistics', subtopic: 'Data collection',
    learningObjective: 'Interpret frequency tables',
    type: 'numeric', difficulty: 'medium', estimatedTimeSec: 90, marks: 2,
    statement: 'A frequency table shows 2 students scored 4, 3 scored 6 and 5 scored 8. Calculate the mean score to 1 decimal place.',
    correct: ['6.7'], tolerance: 0.05,
    explanation: 'Mean = (2×4 + 3×6 + 5×8) / 10 = 66/10 = 6.6.',
    tags: ['statistics', 'ai-generated'], status: 'draft', createdBy: '', createdByName: '', version: 1, source: 'ai',
  },
  {
    schoolId: 'sch-greenfield', subjectId: 'sub-math', level: 'SS2', topic: 'Circle Geometry', subtopic: 'Arcs and sectors',
    learningObjective: 'Compute sector areas',
    type: 'single_choice', difficulty: 'easy', estimatedTimeSec: 75, marks: 2,
    statement: 'A sector has radius 7 cm and angle 90°. Find its area (π = 22/7).',
    options: [{ id: 'a', text: '38.5 cm²' }, { id: 'b', text: '77 cm²' }, { id: 'c', text: '154 cm²' }, { id: 'd', text: '11 cm²' }],
    correct: ['a'], explanation: 'Area = (90/360) × πr² = ¼ × 22/7 × 49 = 38.5 cm².',
    tags: ['geometry', 'ai-generated'], status: 'draft', createdBy: '', createdByName: '', version: 1, source: 'ai',
  },
];

export function AiAssistantScreen() {
  const store = useDemoStore();
  const user = store.currentUser()!;
  const navigate = store.navigate;
  const [aiState, setAiState] = React.useState('cloud');
  const [subjectId, setSubjectId] = React.useState('sub-math');
  const [level, setLevel] = React.useState('SS2');
  const [topic, setTopic] = React.useState('Algebraic Fractions');
  const [difficulty, setDifficulty] = React.useState('medium');
  const [qType, setQType] = React.useState<QuestionType>('single_choice');
  const [count, setCount] = React.useState(4);
  const [prompt, setPrompt] = React.useState('Generate questions that test factorisation of quadratics with real-life word problems.');
  const [source, setSource] = React.useState<'typed' | 'notes' | 'document'>('typed');
  const [generating, setGenerating] = React.useState(0);
  const [generated, setGenerated] = React.useState<Question[]>([]);
  const [accepted, setAccepted] = React.useState<Set<number>>(new Set());

  const generate = () => {
    setGenerating(1);
    const iv = setInterval(() => setGenerating((s) => {
      if (s >= 100) { clearInterval(iv); return 100; }
      return s + 14;
    }), 130);
    setTimeout(() => {
      clearInterval(iv);
      setGenerating(100);
      const qs = SAMPLE_GENERATED.slice(0, count).map((t, i) => ({
        ...t,
        id: `Q-AI-${Date.now()}-${i}`,
        difficulty: difficulty as Question['difficulty'],
        type: qType === 'single_choice' && i % 4 === 2 ? 'numeric' as QuestionType : qType === 'single_choice' ? 'single_choice' as QuestionType : qType,
        subjectId, level, topic,
        createdBy: user.id, createdByName: user.name,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })) as Question[];
      setGenerated(qs);
      setAccepted(new Set(qs.map((_, i) => i)));
      toast.success(`${qs.length} questions generated`, { description: aiState === 'cloud' ? 'Generated by cloud AI — review before use.' : 'Generated by the local model on this computer.' });
    }, 1500);
  };

  const acceptToBank = () => {
    generated.filter((_, i) => accepted.has(i)).forEach((q) => store.saveQuestion(q, 'Accepted from AI assistant (draft)'));
    toast.success(`${accepted.size} questions saved to your drafts`, { description: 'They remain drafts — submit for review when ready.' });
    setGenerated([]);
    setGenerating(0);
  };

  const topicsFor = store.world.topics.filter((t) => t.subjectId === subjectId);

  return (
    <div>
      <PageHeader
        title="AI question assistant"
        description="Draft questions from typed instructions, lesson notes or an uploaded document. Everything is editable before it reaches the bank."
        icon={<Sparkles className="h-5 w-5" />}
        actions={
          <select className="h-9 rounded-md border bg-background px-3 text-xs" value={aiState} onChange={(e) => setAiState(e.target.value)} aria-label="AI provider state">
            {AI_STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        }
      />

      {/* availability banner */}
      <div className={`mb-4 flex items-center gap-2.5 rounded-xl border p-3 text-sm ${aiState === 'cloud' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200' : aiState === 'local' ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}>
        {AI_STATES.find((s) => s.id === aiState)!.icon && React.createElement(AI_STATES.find((s) => s.id === aiState)!.icon, { className: 'h-4 w-4' })}
        <span><strong>{AI_STATES.find((s) => s.id === aiState)!.label}</strong> — {AI_STATES.find((s) => s.id === aiState)!.desc}</span>
        {aiState === 'cloud' && <Badge variant="outline" className="ml-auto text-[10px]">requires internet</Badge>}
        {aiState === 'local' && <Badge variant="outline" className="ml-auto text-[10px]">offline capable</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Generation settings" className="lg:col-span-1">
          <div className="space-y-2.5">
            <div><Label>Subject</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject">
                {Object.values(store.world.subjects).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Level</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
                  {['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'].map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div><Label>Topic</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
                  {topicsFor.map((t) => <option key={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Difficulty</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="Difficulty">
                  {['easy', 'medium', 'hard'].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div><Label>Question type</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={qType} onChange={(e) => setQType(e.target.value as QuestionType)} aria-label="Question type">
                  {Object.entries(QUESTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div><Label>How many</Label>
              <div className="mt-1 flex gap-1.5">
                {[2, 4, 6, 8].map((n) => <button key={n} onClick={() => setCount(n)} className={`flex-1 rounded-lg border py-1.5 text-xs ${count === n ? 'border-primary bg-primary/10 text-primary' : ''}`}>{n}</button>)}
              </div>
            </div>
            <div><Label>Source material</Label>
              <div className="mt-1 flex gap-1.5">
                {([['typed', 'Typed instructions'], ['notes', 'Lesson notes'], ['document', 'PDF upload']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setSource(k)} className={`flex-1 rounded-lg border px-1 py-1.5 text-[11px] font-medium ${source === k ? 'border-primary bg-primary/10 text-primary' : ''}`}>{l}</button>
                ))}
              </div>
            </div>
            {source === 'typed' && <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Instructions" />}
            {source === 'notes' && <Textarea rows={3} className="bg-muted/40" defaultValue="Lesson notes — Algebraic Fractions: simplification by factorisation, LCM method for addition/subtraction, equations involving fractions…" readOnly aria-label="Lesson notes" />}
            {source === 'document' && (
              <label className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed p-4 text-center hover:border-primary/50">
                <FileUp className="h-6 w-6 text-muted-foreground" />
                <p className="mt-1 text-xs font-medium">ss2-mathematics-syllabus.pdf</p>
                <p className="text-[10px] text-muted-foreground">Click to simulate choosing a different file</p>
                <input type="file" className="hidden" aria-label="Document upload" />
              </label>
            )}
            <Button className="w-full" onClick={generate} disabled={generating > 0 && generating < 100}>
              <Wand2 className="mr-1.5 h-4 w-4" /> {generating > 0 && generating < 100 ? 'Generating…' : 'Generate questions'}
            </Button>
            {generating > 0 && generating < 100 && <Progress value={generating} />}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The prototype simulates generation with realistic predefined outputs. Generated items are drafts until a teacher reviews them, and controlled exams still require administrator approval.
            </p>
          </div>
        </SectionCard>

        <div className="lg:col-span-2">
          <SectionCard
            title={`Generated questions ${generated.length ? `(${generated.length})` : ''}`}
            description="Accept individually, regenerate, edit, or send everything to your drafts."
            action={generated.length > 0 ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setGenerating(0); setGenerated([]); }}>Discard all</Button>
                <Button size="sm" onClick={acceptToBank} disabled={accepted.size === 0}><CheckCircle2 className="mr-1.5 h-4 w-4" /> Save {accepted.size} to drafts</Button>
              </div>
            ) : undefined}
          >
            {generated.length === 0 ? (
              <EmptyState
                title="Nothing generated yet"
                description="Configure the settings and generate a draft set. You can also generate alternative versions of an existing question from its editor."
                icon={<Sparkles className="h-6 w-6" />}
                action={<Button size="sm" variant="outline" onClick={() => navigate('/app/questions')}>Open question bank</Button>}
              />
            ) : (
              <div className="space-y-3">
                {generated.map((q, i) => (
                  <div key={q.id} className={`rounded-xl border p-4 transition-colors ${accepted.has(i) ? 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20' : 'opacity-60'}`}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Checkbox checked={accepted.has(i)} onCheckedChange={(v) => setAccepted((s) => { const n = new Set(s); if (v) n.add(i); else n.delete(i); return n; })} aria-label={`Accept question ${i + 1}`} />
                      <Badge variant="outline">{QUESTION_TYPE_LABELS[q.type]}</Badge>
                      <Badge variant="outline" className="capitalize">{q.difficulty}</Badge>
                      <Badge variant="outline">{q.marks} marks</Badge>
                      <div className="ml-auto flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => { toast('Regenerating question ' + (i + 1) + '…'); setTimeout(() => { toast.success(`Question ${i + 1} regenerated (v2)`); }, 900); }}><RefreshCcw className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => { store.saveQuestion(q, 'Accepted from AI assistant'); toast('Opened in drafts'); navigate('/app/questions'); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-sm font-medium">{q.statement}</p>
                    {q.options && (
                      <ul className="mt-2 space-y-1 text-sm">
                        {q.options.map((o) => (
                          <li key={o.id} className={`flex items-center gap-2 ${q.correct.includes(o.id) ? 'font-medium text-emerald-700 dark:text-emerald-300' : ''}`}>
                            <span className="text-xs text-muted-foreground">{String.fromCharCode(97 + q.options!.indexOf(o))})</span> {o.text}
                            {q.correct.includes(o.id) && <CheckCircle2 className="h-3.5 w-3.5" />}
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.explanation && <p className="mt-2 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">{q.explanation}</p>}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
