'use client';

/**
 * Public practice — anonymous, guest-identity practice with instant feedback.
 * Deliberately friendly for younger students; clearly separated from
 * official academic records.
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { QuestionRenderer } from './ExamRunner';
import { fmtSec } from '@/lib/prototype/ui-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  GraduationCap, ArrowLeft, ArrowRight, PlayCircle, Timer, Zap, Sparkles, UserPlus, Info,
  PartyPopper, RefreshCcw, Trophy, Target, BookOpen, ShieldCheck, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Question } from '@/lib/prototype/types';

export function PracticeHub() {
  const store = useDemoStore();
  const navigate = store.navigate;
  const local = store.local();
  const [config, setConfig] = React.useState({ subjectId: 'sub-math', level: 'SS2', topic: 'any', difficulty: 'any', count: 5, timed: false, durationMin: 10 });
  const publicSets = Object.values(local.assessments).filter((a) => a.access === 'public');

  const start = () => {
    const pool = Object.values(local.questions).filter((q) => {
      if (!['approved', 'draft'].includes(q.status)) return false;
      if (q.subjectId !== config.subjectId) return false;
      if (config.level !== 'any' && q.level !== config.level) return false;
      if (config.topic !== 'any' && q.topic !== config.topic) return false;
      if (config.difficulty !== 'any' && q.difficulty !== config.difficulty) return false;
      return true;
    });
    const questions = pool.slice(0, config.count);
    if (questions.length === 0) {
      toast.error('No questions match — try another combination.');
      return;
    }
    store.startPractice(config, questions.map((q) => q.id));
    navigate('/practice/session');
  };

  const topics = store.world.topics.filter((t) => t.subjectId === config.subjectId);

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-background to-background dark:from-amber-950/20">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
          <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300">No sign-in needed</Badge>
        </div>

        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 text-white"><Zap className="h-7 w-7" /></div>
          <h1 className="text-3xl font-bold">Practice Zone</h1>
          <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
            Sharpen your skills with instant feedback. Practice attempts use a temporary guest identity and
            are <strong>never</strong> merged with school records.
          </p>
        </div>

        {/* public curated sets */}
        {publicSets.length > 0 && (
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {publicSets.map((p) => (
              <button
                key={p.id}
                onClick={() => { store.startPractice({ subjectId: p.subjectId, level: 'any', topic: 'any', difficulty: 'any', count: Math.min(8, p.questionIds.length), timed: false, durationMin: p.durationMin }, p.questionIds.slice(0, 8)); navigate('/practice/session'); }}
                className="group rounded-2xl border-2 border-amber-200 bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-amber-900"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950"><BookOpen className="h-5 w-5" /></div>
                  <div>
                    <p className="font-bold">{p.name.replace('Public Practice — ', '')}</p>
                    <p className="text-xs text-muted-foreground">{p.questionIds.length} questions · instant feedback</p>
                  </div>
                  <PlayCircle className="ml-auto h-6 w-6 text-amber-500 transition-transform group-hover:scale-110" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* custom practice builder */}
        <div className="mt-8 rounded-2xl border bg-card p-6">
          <h2 className="text-lg font-bold">Build your own practice</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><Label>Subject</Label>
              <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={config.subjectId} onChange={(e) => setConfig({ ...config, subjectId: e.target.value, topic: 'any' })} aria-label="Subject">
                {Object.values(store.world.subjects).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><Label>Level</Label>
              <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={config.level} onChange={(e) => setConfig({ ...config, level: e.target.value })} aria-label="Level">
                <option value="any">Any</option>
                {['PRY6', 'JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'].map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div><Label>Topic</Label>
              <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={config.topic} onChange={(e) => setConfig({ ...config, topic: e.target.value })} aria-label="Topic">
                <option value="any">All topics</option>
                {topics.map((t) => <option key={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div><Label>Difficulty</Label>
              <div className="mt-1 flex gap-1.5">
                {['any', 'easy', 'medium', 'hard'].map((d) => (
                  <button key={d} onClick={() => setConfig({ ...config, difficulty: d })} className={`flex-1 rounded-lg border py-2 text-xs capitalize ${config.difficulty === d ? 'border-primary bg-primary/10 text-primary' : ''}`}>{d}</button>
                ))}
              </div>
            </div>
            <div><Label>Number of questions</Label>
              <div className="mt-1 flex gap-1.5">
                {[3, 5, 8, 10].map((n) => (
                  <button key={n} onClick={() => setConfig({ ...config, count: n })} className={`flex-1 rounded-lg border py-2 text-xs ${config.count === n ? 'border-primary bg-primary/10 text-primary' : ''}`}>{n}</button>
                ))}
              </div>
            </div>
            <div><Label>Timer</Label>
              <div className="mt-1 flex gap-1.5">
                <button onClick={() => setConfig({ ...config, timed: false })} className={`flex-1 rounded-lg border py-2 text-xs ${!config.timed ? 'border-primary bg-primary/10 text-primary' : ''}`}>Relaxed</button>
                <button onClick={() => setConfig({ ...config, timed: true, durationMin: Math.max(5, config.count) })} className={`flex-1 rounded-lg border py-2 text-xs ${config.timed ? 'border-primary bg-primary/10 text-primary' : ''}`}>Timed ({config.count} min)</button>
              </div>
            </div>
          </div>
          <Button size="lg" className="mt-5 w-full" onClick={start}><PlayCircle className="mr-2 h-5 w-5" /> Start practice</Button>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Guest attempts are kept for 24 hours on this device, then deleted automatically. Create an account to save progress permanently — you can link your guest results after verifying your identity.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
          <Button variant="outline" onClick={() => navigate('/login')}><UserPlus className="mr-1.5 h-4 w-4" /> Create an account</Button>
          <Button variant="ghost" onClick={() => navigate('/')}><GraduationCap className="mr-1.5 h-4 w-4" /> ExamHub home</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Practice session runner
// ============================================================

export function PracticeSessionScreen() {
  const store = useDemoStore();
  const navigate = store.navigate;
  const practice = store.practice;
  const local = store.local();

  if (!practice) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center">
          <p className="text-muted-foreground">No active practice session.</p>
          <Button className="mt-3" onClick={() => navigate('/practice')}>Back to Practice Zone</Button>
        </div>
      </div>
    );
  }

  const questions = practice.questionIds.map((qid) => local.questions[qid]).filter(Boolean) as Question[];
  const finished = !!practice.finishedAt;

  if (finished) {
    // results
    let correct = 0;
    questions.forEach((q) => {
      const r = practice.answers[q.id];
      if (!r) return;
      if (q.type === 'single_choice' || q.type === 'true_false') { if (r.selected?.[0] && q.correct.includes(r.selected[0])) correct++; }
      else if (q.type === 'multi_choice') { const s = r.selected ?? []; if (s.length === q.correct.length && s.every((x) => q.correct.includes(x))) correct++; }
      else if (q.type === 'short_answer') { if (q.correct.some((c) => c.toLowerCase() === (r.text ?? '').trim().toLowerCase())) correct++; }
      else if (q.type === 'numeric') { const n = parseFloat(r.text ?? ''); if (!isNaN(n) && Math.abs(n - parseFloat(q.correct[0])) <= (q.tolerance ?? 0.001)) correct++; }
      else if (q.type === 'matching') { if (q.pairs?.every((p) => r.pairs?.[p.left] === p.right)) correct++; }
      else if (q.type === 'ordering') { if (r.ordering?.join('|') === q.items?.join('|')) correct++; }
      else if (q.type === 'fill_blank') { if (q.blanks?.every((b, i) => r.text?.split('||')[i]?.trim().toLowerCase() === b.answer.toLowerCase())) correct++; }
      else if (q.type === 'essay') { /* self-marked prompt */ }
    });
    const attempted = questions.filter((q) => practice.answers[q.id]).length;
    const pct = Math.round((correct / questions.length) * 100);
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-background p-4 dark:from-emerald-950/30">
        <div className="mx-auto max-w-2xl py-10">
          <div className="text-center">
            <PartyPopper className="mx-auto h-14 w-14 text-emerald-500" />
            <h1 className="mt-3 text-2xl font-bold">Session complete!</h1>
            <p className="mt-1 text-muted-foreground">Guest identity: <strong>{practice.guestName}</strong> (kept 24h, then deleted)</p>
          </div>
          <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border bg-card p-4"><p className="text-2xl font-bold text-emerald-600">{correct}/{questions.length}</p><p className="text-xs text-muted-foreground">correct</p></div>
            <div className="rounded-xl border bg-card p-4"><p className="text-2xl font-bold">{pct}%</p><p className="text-xs text-muted-foreground">accuracy</p></div>
            <div className="rounded-xl border bg-card p-4"><p className="text-2xl font-bold">{attempted}</p><p className="text-xs text-muted-foreground">attempted</p></div>
          </div>
          {pct >= 80 && <p className="mt-3 text-center text-sm font-medium text-amber-600"><Trophy className="mr-1 inline h-4 w-4" /> Outstanding — you are ready for a harder set!</p>}
          {pct < 50 && <p className="mt-3 text-center text-sm font-medium text-sky-600"><Target className="mr-1 inline h-4 w-4" /> Good effort! Review the explanations below and try again.</p>}

          <div className="mt-8 space-y-3">
            <h2 className="text-lg font-bold">Review & explanations</h2>
            {questions.map((q, i) => (
              <div key={q.id} className="rounded-xl border bg-card p-4">
                <p className="mb-2 text-sm font-semibold">Q{i + 1} · {q.topic}</p>
                <QuestionRenderer question={q} attemptAnswers={practice.answers} showCorrect />
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-2">
            <Button onClick={() => { store.exitPractice(); navigate('/practice'); }}><RefreshCcw className="mr-1.5 h-4 w-4" /> Retake / new session</Button>
            <Button variant="outline" onClick={() => navigate('/login')}><UserPlus className="mr-1.5 h-4 w-4" /> Save progress — create account</Button>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Guest practice records are never merged into official academic records automatically.
          </p>
        </div>
      </div>
    );
  }

  // running
  const q = questions[practice.currentIndex];
  const total = questions.length;
  const progress = ((practice.currentIndex) / total) * 100;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-white"><Zap className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Practice — {store.world.subjects[practice.config.subjectId]?.name}</p>
            <p className="text-[11px] text-muted-foreground">Guest {practice.guestName} · instant feedback on</p>
          </div>
          {practice.config.timed && (
            <span className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold"><Timer className="h-3.5 w-3.5" /> {practice.config.durationMin}:00</span>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { store.exitPractice(); navigate('/practice'); }} aria-label="Exit practice"><X className="h-4 w-4" /></Button>
        </div>
        <Progress value={progress} className="h-1 rounded-none" />
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="rounded-2xl border bg-card p-5 lg:p-7">
          <div className="mb-3 flex items-center gap-2">
            <Badge variant="outline">Question {practice.currentIndex + 1} of {total}</Badge>
            {q.topic && <Badge variant="outline" className="text-muted-foreground">{q.topic}</Badge>}
          </div>
          <QuestionRenderer
            question={q}
            attemptAnswers={practice.answers}
            showCorrect={!!practice.answers[q.id]}
            onSave={(qid, patch) => store.savePracticeAnswer(qid, patch)}
          />
          {practice.answers[q.id] && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
              <p className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300"><Sparkles className="h-4 w-4" /> Feedback unlocked</p>
              {q.explanation && <p className="mt-1 whitespace-pre-wrap text-emerald-800/90 dark:text-emerald-200/90">{q.explanation}</p>}
            </div>
          )}
          <div className="mt-6 flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={practice.currentIndex === 0} onClick={() => store.gotoPracticeQuestion(practice.currentIndex - 1)}><ArrowLeft className="mr-1.5 h-4 w-4" /> Previous</Button>
            {practice.currentIndex < total - 1 ? (
              <Button size="sm" onClick={() => store.gotoPracticeQuestion(practice.currentIndex + 1)}>Next <ArrowRight className="ml-1.5 h-4 w-4" /></Button>
            ) : (
              <Button size="sm" onClick={() => { store.finishPractice(); toast.success('Practice finished'); }}><PartyPopper className="mr-1.5 h-4 w-4" /> Finish & see results</Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
