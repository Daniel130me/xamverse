'use client';

/**
 * ExamRunner — the controlled examination experience.
 * Fullscreen (no shell). Pre-exam checks → instructions → exam with timer,
 * question palette, auto-save, offline banner → submit → confirmation.
 * Supports all 9 question types.
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { QUESTION_TYPE_LABELS, fmtSec } from '@/lib/ui-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeft, ArrowRight, CheckCircle2, Clock, Flag, Save, ShieldCheck, Wifi, WifiOff, AlertTriangle,
  FileText, Send, MonitorCheck, IdCard, ScrollText, Timer, ListChecks, PartyPopper, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Question } from '@/lib/prototype/types';

export function ExamRunner() {
  const store = useDemoStore();
  const navigate = store.navigate;
  const local = store.local();
  const user = store.currentUser();
  const activeExam = store.activeExam;
  const device = store.currentDevice();
  const lanOnline = store.world.network.lanOnline;

  // ---------- phase 1: choose exam ----------
  if (!user || user.role !== 'student') {
    return (
      <CenterCard>
        <ShieldCheck className="h-10 w-10 text-muted-foreground" />
        <p className="mt-2 font-semibold">Examination area</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">Sign in as a student on this computer to take a controlled examination. {user ? `You are signed in as ${user.name.split(' ')[0]}, whose role is not a candidate.` : 'No session on this computer.'}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/app/dashboard')}>Back to dashboard</Button>
      </CenterCard>
    );
  }

  if (!activeExam) {
    const controlled = Object.values(local.assessments).filter((a) => {
      if (a.access !== 'controlled') return false;
      if (!local.examPackages[a.id]) return false;
      if (user.classId && !a.classIds.includes(user.classId)) return false;
      return true;
    });

    return (
      <CenterCard wide>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Available examinations</h1>
            <p className="text-sm text-muted-foreground">Only packages delivered to <strong>{device?.name}</strong> are listed — nothing streams from a server.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/app/dashboard')}><X className="mr-1 h-4 w-4" /> Exit</Button>
        </div>
        {controlled.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <MonitorCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-2 font-medium">No exam packages on this computer</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">When your school distributes an assessment, this computer stores its approved package locally and it appears here — even offline.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {controlled.map((a) => {
              const attempt = local.attempts.find((at) => at.assessmentId === a.id && at.studentId === user.id);
              const pkg = local.examPackages[a.id];
              return (
                <div key={a.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{a.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{store.world.subjects[a.subjectId]?.name} · {a.questionIds.length} questions · {a.totalMarks} marks · pass mark {a.passMark} · {a.durationMin} minutes</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Exam window: {new Date(a.startAt).toLocaleString()} → {new Date(a.endAt).toLocaleString()}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="text-[10px]"><ShieldCheck className="mr-1 h-3 w-3" /> approved v{pkg.version}</Badge>
                        <Badge variant="outline" className="text-[10px]">received {new Date(pkg.receivedAt).toLocaleDateString()}</Badge>
                        {a.randomizeQuestions && <Badge variant="outline" className="text-[10px]">randomised order</Badge>}
                      </div>
                    </div>
                    {attempt?.status === 'published' ? (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">Completed — {attempt.percentage}%</Badge>
                    ) : attempt?.status === 'in_progress' ? (
                      <Button onClick={() => store.startAttempt(a.id, user.id)}>Resume exam</Button>
                    ) : (
                      <Button onClick={() => store.startAttempt(a.id, user.id)}>Start exam</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CenterCard>
    );
  }

  // ---------- phase 2: running exam ----------
  const attempt = local.attempts.find((a) => a.id === activeExam.attemptId);
  if (!attempt) {
    return <CenterCard><p>Attempt not found. <Button variant="outline" size="sm" className="ml-2" onClick={() => store.exitExam()}>Exit</Button></p></CenterCard>;
  }

  const assessment = local.assessments[attempt.assessmentId];
  const pkg = local.examPackages[attempt.assessmentId];
  const questions = activeExam.questionOrder.map((qid) => local.questions[qid] ?? pkg?.questionPayload?.[qid]).filter(Boolean) as Question[];

  // ---------- phase 3: submitted ----------
  if (attempt.status !== 'in_progress') {
    return (
      <CenterCard>
        <PartyPopper className="h-12 w-12 text-emerald-500" />
        <h1 className="mt-3 text-lg font-bold">Submitted successfully</h1>
        <p className="mt-1 max-w-md text-center text-sm text-muted-foreground">
          Your answers for <strong>{attempt.assessmentName}</strong> were saved on this computer
          {attempt.syncState === 'synced' ? ' and a verified copy has already been transferred to your school\u2019s collection computer.' : ' and are queued for transfer to your school\u2019s collection computer.'}
        </p>
        <div className="mt-4 w-full max-w-md space-y-2 rounded-xl border p-4 text-left text-xs">
          <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Submission stored locally on {store.activeDeviceId}</p>
          <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {Object.keys(attempt.answers).length} responses recorded</p>
          {attempt.syncState === 'queued' || attempt.syncState === 'local_only' ? (
            <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" /> Waiting to sync — transfers run automatically when the network is available</p>
          ) : (
            <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Synchronized to collection peers</p>
          )}
        </div>
        <div className="mt-5 flex gap-2">
          <Button onClick={() => { store.exitExam(); navigate('/app/dashboard'); }}>Back to dashboard</Button>
          <Button variant="outline" onClick={() => { store.exitExam(); navigate('/app/notifications'); }}>View status</Button>
        </div>
      </CenterCard>
    );
  }

  return <ExamInProgress />;
}

function ExamInProgress() {
  const store = useDemoStore();
  const navigate = store.navigate;
  const local = store.local();
  const activeExam = store.activeExam!;
  const attempt = local.attempts.find((a) => a.id === activeExam.attemptId)!;
  const assessment = local.assessments[attempt.assessmentId];
  const pkg2 = local.examPackages[attempt.assessmentId];
  const questions = activeExam.questionOrder.map((qid) => local.questions[qid] ?? pkg2?.questionPayload?.[qid]).filter(Boolean) as Question[];
  const currentQ = questions[activeExam.currentIndex];
  const device = store.currentDevice();
  const online = store.world.network.lanOnline && device.online;
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [showPaletteMobile, setShowPaletteMobile] = React.useState(false);

  const answeredCount = questions.filter((q) => {
    const r = attempt.answers[q.id];
    return r && (r.selected?.length || r.text || r.ordering || r.pairs);
  }).length;
  const flaggedCount = questions.filter((q) => attempt.answers[q.id]?.state === 'flagged').length;
  const timeCritical = activeExam.remainingSec <= 300;

  const handleSubmit = () => {
    setConfirmOpen(false);
    store.submitAttempt(false);
    toast.success('Exam submitted', { description: 'Your answers were saved locally on this computer.' });
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      {/* header */}
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-3 py-2 lg:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{attempt.assessmentName}</p>
            <p className="text-[11px] text-muted-foreground">{attempt.studentName} · {attempt.className} · {store.activeDeviceId}</p>
          </div>

          {/* timer */}
          <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-sm font-bold tabular-nums ${timeCritical ? 'animate-pulse border-red-300 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950' : 'border-primary/30 bg-primary/5 text-primary'}`}>
            <Timer className="h-4 w-4" /> {fmtSec(activeExam.remainingSec)}
            {activeExam.timeScale > 1 && <Badge variant="outline" className="ml-1 text-[9px]">×{activeExam.timeScale}</Badge>}
          </div>

          {/* auto-save indicator */}
          <div className="hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] text-muted-foreground sm:flex">
            <Save className="h-3.5 w-3.5 text-emerald-500" />
            {activeExam.lastSavedAt ? `Saved ${new Date(activeExam.lastSavedAt).toLocaleTimeString()}` : 'Auto-save on'}
          </div>

          {/* connection */}
          <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium ${online ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'}`}>
            {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {online ? 'Online' : 'Offline — saving locally'}
          </div>

          {/* demo time controls */}
          <div className="hidden items-center gap-1 md:flex">
            <span className="text-[10px] text-muted-foreground">Demo speed:</span>
            {[1, 10, 60].map((s) => (
              <button key={s} onClick={() => store.setExamTimeScale(s)} className={`rounded border px-1.5 py-0.5 text-[10px] ${activeExam.timeScale === s ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'}`}>×{s}</button>
            ))}
          </div>

          <Button size="sm" className="ml-auto" onClick={() => setConfirmOpen(true)}><Send className="mr-1.5 h-3.5 w-3.5" /> Submit exam</Button>
        </div>
        {!online && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-1.5 text-center text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            <WifiOff className="mr-1 inline h-3.5 w-3.5" /> This computer is offline. The exam package is stored locally — you can continue safely. All answers save to this device and sync after reconnection.
          </div>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-4 px-3 py-4 lg:px-6">
        {/* question area */}
        <div className="min-w-0 flex-1">
          {currentQ && (
            <div className="rounded-xl border bg-card p-4 lg:p-6">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge variant="outline">Question {activeExam.currentIndex + 1} of {questions.length}</Badge>
                <Badge variant="outline">{QUESTION_TYPE_LABELS[currentQ.type]}</Badge>
                <Badge variant="outline">{currentQ.marks} mark{currentQ.marks > 1 ? 's' : ''}</Badge>
                <Badge variant="outline" className="text-muted-foreground">~{Math.round(currentQ.estimatedTimeSec / 60)} min</Badge>
                <Badge variant="outline" className="capitalize">{currentQ.difficulty}</Badge>
                <Button
                  variant={attempt.answers[currentQ.id]?.state === 'flagged' ? 'default' : 'outline'}
                  size="sm"
                  className="ml-auto"
                  onClick={() => store.toggleFlag(currentQ.id)}
                >
                  <Flag className="mr-1.5 h-3.5 w-3.5" /> {attempt.answers[currentQ.id]?.state === 'flagged' ? 'Flagged' : 'Flag for review'}
                </Button>
              </div>

              <QuestionRenderer question={currentQ} attemptAnswers={attempt.answers} onSave={store.saveAnswer} readOnly={false} />

              {currentQ.hint && (
                <details className="mt-4 rounded-lg border border-dashed p-3 text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Need a hint? (no mark penalty)</summary>
                  <p className="mt-2 text-muted-foreground">{currentQ.hint}</p>
                </details>
              )}

              <Separator className="my-4" />
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" disabled={activeExam.currentIndex === 0} onClick={() => store.nextQuestion(-1)}><ArrowLeft className="mr-1.5 h-4 w-4" /> Previous</Button>
                <p className="hidden text-xs text-muted-foreground sm:block">{answeredCount} of {questions.length} answered · {flaggedCount} flagged</p>
                {activeExam.currentIndex < questions.length - 1 ? (
                  <Button size="sm" onClick={() => store.nextQuestion(1)}>Next <ArrowRight className="ml-1.5 h-4 w-4" /></Button>
                ) : (
                  <Button size="sm" onClick={() => setConfirmOpen(true)}>Review & submit <CheckCircle2 className="ml-1.5 h-4 w-4" /></Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* palette */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-20 rounded-xl border bg-card p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><ListChecks className="h-4 w-4" /> Question palette</p>
            <div className="grid grid-cols-6 gap-1.5">
              {questions.map((q, i) => {
                const r = attempt.answers[q.id];
                const isAnswered = r && (r.selected?.length || r.text || r.ordering || r.pairs);
                const isFlagged = r?.state === 'flagged';
                const isCurrent = i === activeExam.currentIndex;
                return (
                  <button
                    key={q.id}
                    onClick={() => store.gotoQuestion(i)}
                    className={`relative flex h-8 w-8 items-center justify-center rounded-md border text-xs font-medium transition-colors ${
                      isCurrent ? 'border-primary ring-2 ring-primary/40' :
                      isFlagged ? 'border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' :
                      isAnswered ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                      'bg-muted/50'
                    }`}
                    aria-label={`Question ${i + 1}${isFlagged ? ' flagged' : isAnswered ? ' answered' : ''}`}
                  >
                    {i + 1}
                    {isFlagged && <Flag className="absolute -right-1 -top-1 h-2.5 w-2.5 text-amber-500" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              <p className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-emerald-300 bg-emerald-100 dark:bg-emerald-950" /> Answered ({answeredCount})</p>
              <p className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-amber-400 bg-amber-100 dark:bg-amber-950" /> Flagged ({flaggedCount})</p>
              <p className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-muted" /> Unanswered ({questions.length - answeredCount})</p>
            </div>
            <Button size="sm" className="mt-3 w-full" onClick={() => setConfirmOpen(true)}><Send className="mr-1.5 h-3.5 w-3.5" /> Submit exam</Button>
            <Button variant="ghost" size="sm" className="mt-1.5 w-full" onClick={() => { store.exitExam(); navigate('/app/dashboard'); }}>Save & exit (resume later)</Button>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Your progress is saved on this computer after every change. If the network drops or the app closes, you can resume from this device.</p>
          </div>
        </aside>
      </div>

      {/* mobile palette toggle */}
      <button
        onClick={() => setShowPaletteMobile((v) => !v)}
        className="fixed bottom-4 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg lg:hidden"
        aria-label="Toggle question palette"
      >
        <ListChecks className="h-5 w-5" />
      </button>
      {showPaletteMobile && (
        <div className="fixed inset-x-3 bottom-20 z-20 rounded-xl border bg-card p-4 shadow-xl lg:hidden">
          <div className="grid grid-cols-8 gap-1.5">
            {questions.map((q, i) => {
              const r = attempt.answers[q.id];
              const isAnswered = r && (r.selected?.length || r.text || r.ordering || r.pairs);
              const isCurrent = i === activeExam.currentIndex;
              return (
                <button key={q.id} onClick={() => { store.gotoQuestion(i); setShowPaletteMobile(false); }} className={`flex h-9 w-9 items-center justify-center rounded-md border text-xs ${isCurrent ? 'border-primary ring-2 ring-primary/40' : isAnswered ? 'border-emerald-300 bg-emerald-100 dark:bg-emerald-950' : 'bg-muted/50'}`}>{i + 1}</button>
              );
            })}
          </div>
        </div>
      )}

      {/* submit confirmation */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold">Submit your examination?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Once submitted, answers cannot be changed.</p>
            <div className="mt-3 space-y-1.5 rounded-lg border p-3 text-sm">
              <p className="flex justify-between"><span>Answered</span><strong className="text-emerald-600">{answeredCount} of {questions.length}</strong></p>
              <p className="flex justify-between"><span>Flagged for review</span><strong className="text-amber-600">{flaggedCount}</strong></p>
              <p className="flex justify-between"><span>Time remaining</span><strong>{fmtSec(activeExam.remainingSec)}</strong></p>
            </div>
            {answeredCount < questions.length && (
              <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> You have {questions.length - answeredCount} unanswered question(s). They will be marked as skipped.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>Keep working</Button>
              <Button size="sm" onClick={handleSubmit}><Send className="mr-1.5 h-3.5 w-3.5" /> Submit now</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Question renderer (shared with marking & practice)
// ============================================================

export function QuestionRenderer({
  question, attemptAnswers, onSave, readOnly, showCorrect,
}: {
  question: Question;
  attemptAnswers: Record<string, { selected?: string[]; text?: string; ordering?: string[]; pairs?: Record<string, string> }>;
  onSave?: (questionId: string, patch: { selected?: string[]; text?: string; ordering?: string[]; pairs?: Record<string, string> }) => void;
  readOnly?: boolean;
  showCorrect?: boolean;
}) {
  const rec = attemptAnswers[question.id];
  const qid = question.id;

  const renderStatement = () => {
    // fill-in-the-blank: render {{blankN}} inline inputs
    if (question.type === 'fill_blank') {
      const parts = question.statement.split(/(\{\{blank\d+\}\})/g);
      return (
        <p className="text-[15px] leading-relaxed">
          {parts.map((p, i) => {
            const m = p.match(/\{\{blank(\d+)\}\}/);
            if (!m) return <span key={i}>{p}</span>;
            const idx = Number(m[1]) - 1;
            const value = rec?.text ? rec.text.split('||')[idx] ?? '' : '';
            const correct = showCorrect ? question.blanks?.[idx]?.answer : undefined;
            return (
              <span key={i} className="mx-1 inline-flex items-center gap-1">
                <Input
                  className="inline-block h-8 w-28 text-sm"
                  value={value}
                  disabled={readOnly}
                  aria-label={`Blank ${idx + 1}`}
                  onChange={(e) => {
                    if (!onSave) return;
                    const all = (rec?.text ?? '').split('||');
                    all[idx] = e.target.value;
                    onSave(qid, { text: all.join('||') });
                  }}
                />
                {correct && <Badge variant="outline" className="text-[10px] text-emerald-600">ans: {correct}</Badge>}
              </span>
            );
          })}
        </p>
      );
    }
    return <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{question.statement}</p>;
  };

  return (
    <div>
      {renderStatement()}
      {question.attachment && (
        <div className="mt-3 rounded-lg border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          [ {question.attachment.kind === 'image' ? 'Diagram' : question.attachment.kind === 'table' ? 'Table' : 'Audio clip'}: {question.attachment.label} — media placeholder ]
        </div>
      )}

      <div className="mt-4">
        {(question.type === 'single_choice' || question.type === 'true_false') && question.options && (
          <RadioGroup
            value={rec?.selected?.[0] ?? ''}
            onValueChange={(v) => !readOnly && onSave?.(qid, { selected: [v] })}
            className="gap-2"
            disabled={readOnly}
          >
            {question.options.map((o) => {
              const isSel = rec?.selected?.[0] === o.id;
              const isRight = showCorrect && question.correct.includes(o.id);
              return (
                <label key={o.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent ${isSel ? 'border-primary bg-primary/5' : ''} ${isRight ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : ''}`}>
                  <RadioGroupItem value={o.id} disabled={readOnly} />
                  <span className="flex-1">{question.type === 'true_false' ? o.text : o.text}</span>
                  {isRight && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                </label>
              );
            })}
          </RadioGroup>
        )}

        {question.type === 'multi_choice' && question.options && (
          <div className="space-y-2">
            {question.options.map((o) => {
              const sel = rec?.selected ?? [];
              const isSel = sel.includes(o.id);
              const isRight = showCorrect && question.correct.includes(o.id);
              return (
                <label key={o.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm hover:bg-accent ${isSel ? 'border-primary bg-primary/5' : ''} ${isRight ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : ''}`}>
                  <Checkbox checked={isSel} disabled={readOnly} onCheckedChange={(v) => {
                    if (!onSave) return;
                    const next = v ? [...sel, o.id] : sel.filter((x) => x !== o.id);
                    onSave(qid, { selected: next });
                  }} />
                  <span className="flex-1">{o.text}</span>
                  {isRight && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                </label>
              );
            })}
            <p className="text-xs text-muted-foreground">Select all that apply.</p>
          </div>
        )}

        {(question.type === 'short_answer') && (
          <div>
            <Input
              value={rec?.text ?? ''}
              disabled={readOnly}
              placeholder="Type your answer…"
              aria-label="Short answer"
              onChange={(e) => onSave?.(qid, { text: e.target.value })}
            />
            {showCorrect && <p className="mt-1.5 text-xs text-emerald-600">Accepted: {question.correct.join(' / ')}</p>}
          </div>
        )}

        {question.type === 'numeric' && (
          <div>
            <Input
              type="number"
              step="any"
              value={rec?.text ?? ''}
              disabled={readOnly}
              placeholder="Enter a number…"
              aria-label="Numeric answer"
              onChange={(e) => onSave?.(qid, { text: e.target.value })}
            />
            {showCorrect && <p className="mt-1.5 text-xs text-emerald-600">Expected: {question.correct[0]}{question.tolerance ? ` (± ${question.tolerance})` : ''}</p>}
          </div>
        )}

        {question.type === 'essay' && (
          <div>
            <Textarea
              value={rec?.text ?? ''}
              disabled={readOnly}
              rows={7}
              placeholder="Write your answer here. Show all workings where applicable…"
              aria-label="Essay answer"
              onChange={(e) => onSave?.(qid, { text: e.target.value })}
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">{(rec?.text ?? '').trim().split(/\s+/).filter(Boolean).length} words</p>
          </div>
        )}

        {question.type === 'matching' && question.pairs && (
          <div className="space-y-2">
            {question.pairs.map((p, i) => (
              <div key={p.left} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                <span className="min-w-32 font-medium">{p.left}</span>
                <span className="text-muted-foreground">→</span>
                {showCorrect ? (
                  <Badge variant="outline" className="text-emerald-600">{p.right}</Badge>
                ) : (
                  <select
                    className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
                    value={rec?.pairs?.[p.left] ?? ''}
                    disabled={readOnly}
                    aria-label={`Match for ${p.left}`}
                    onChange={(e) => {
                      if (!onSave) return;
                      const pairs = { ...(rec?.pairs ?? {}), [p.left]: e.target.value };
                      onSave(qid, { pairs });
                    }}
                  >
                    <option value="">Choose…</option>
                    {question.pairs!.map((opt) => <option key={opt.right} value={opt.right}>{opt.right}</option>)}
                  </select>
                )}
                {showCorrect && rec?.pairs?.[p.left] === p.right && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {showCorrect && rec?.pairs?.[p.left] !== p.right && <X className="h-4 w-4 text-red-500" />}
                <span className="sr-only">Pair {i + 1}</span>
              </div>
            ))}
          </div>
        )}

        {question.type === 'ordering' && question.items && (
          <div className="space-y-1.5">
            {(rec?.ordering ?? question.items).map((item, i, arr) => {
              const isRight = showCorrect && question.items?.[i] === item;
              return (
                <div key={item} className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm ${isRight ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : ''}`}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">{i + 1}</span>
                  <span className="flex-1">{item}</span>
                  {!readOnly && (
                    <span className="flex gap-1">
                      <button
                        className="rounded border p-1 hover:bg-accent disabled:opacity-30"
                        disabled={i === 0}
                        aria-label={`Move ${item} up`}
                        onClick={() => {
                          if (!onSave || i === 0) return;
                          const next = [...arr];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          onSave(qid, { ordering: next });
                        }}
                      >↑</button>
                      <button
                        className="rounded border p-1 hover:bg-accent disabled:opacity-30"
                        disabled={i === arr.length - 1}
                        aria-label={`Move ${item} down`}
                        onClick={() => {
                          if (!onSave || i === arr.length - 1) return;
                          const next = [...arr];
                          [next[i + 1], next[i]] = [next[i], next[i + 1]];
                          onSave(qid, { ordering: next });
                        }}
                      >↓</button>
                    </span>
                  )}
                </div>
              );
            })}
            {rec?.ordering && showCorrect && <p className="text-xs text-muted-foreground">Correct order shown in green where it matches.</p>}
          </div>
        )}
      </div>

      {showCorrect && question.explanation && question.type !== 'essay' && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">Explanation</p>
          <p className="mt-1 whitespace-pre-wrap text-emerald-800/90 dark:text-emerald-200/90">{question.explanation}</p>
        </div>
      )}
    </div>
  );
}

function CenterCard({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <div className={`flex flex-col items-center rounded-2xl border bg-card p-8 shadow-sm ${wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}`}>{children}</div>
    </div>
  );
}
