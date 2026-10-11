'use client';

/** Welcome / entry hub — get started, sign in, register, join, restore, practice */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  GraduationCap, LogIn, School, Network, DatabaseBackup, Globe, MonitorSmartphone, ArrowRight, ShieldCheck,
  RefreshCcw, WifiOff, Layers, ClipboardCheck, KeyRound, Sparkles, Info, Menu, X, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

export function WelcomeScreen() {
  const store = useDemoStore();
  const navigate = store.navigate;

  const cards = [
    { icon: LogIn, title: 'Sign in to an existing school', desc: 'Authenticate on this computer with a staff or student account.', action: () => navigate('/login'), cta: 'Sign in', primary: true },
    { icon: School, title: 'Register a new school', desc: 'Run the guided onboarding wizard to configure your school offline.', action: () => navigate('/onboarding'), cta: 'Start setup' },
    { icon: Network, title: 'Join an existing school', desc: 'Pair this computer with a nearby peer and request authorization.', action: () => navigate('/onboarding', { mode: 'join' }), cta: 'Join school' },
    { icon: Layers, title: 'Import existing school data', desc: 'Bring records from CSV/Excel exports or a previous installation.', action: () => navigate('/onboarding', { mode: 'import' }), cta: 'Import data' },
    { icon: DatabaseBackup, title: 'Restore from backup', desc: 'Recover a school installation from an encrypted backup file.', action: () => navigate('/onboarding', { mode: 'restore' }), cta: 'Restore' },
    { icon: Globe, title: 'Public practice (no sign-in)', desc: 'Try practice assessments anonymously — instant feedback included.', action: () => navigate('/practice'), cta: 'Practise now' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-background to-background dark:from-emerald-950/30">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-12">
        {/* top bar */}
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><GraduationCap className="h-5 w-5" /></div>
            <div>
              <p className="font-bold leading-tight">ExamHub</p>
              <p className="text-xs text-muted-foreground">Offline-first school examinations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300">Phase 1 Prototype</Badge>
            <Button variant="outline" size="sm" onClick={() => navigate('/login')}>Sign in</Button>
          </div>
        </div>

        {/* hero */}
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">
              Run school examinations <span className="text-primary">without internet</span>
            </h1>
            <p className="mt-4 max-w-xl text-muted-foreground">
              ExamHub turns every school computer into an independent, secure peer. Create questions,
              approve assessments, distribute exams to a hundred lab computers over the local network,
              collect results, and resolve conflicts — all offline.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                { icon: WifiOff, label: 'Works fully offline' },
                { icon: MonitorSmartphone, label: 'Peer-to-peer computers' },
                { icon: ShieldCheck, label: 'Role-based access' },
                { icon: RefreshCcw, label: 'Selective sync' },
                { icon: Sparkles, label: 'AI question drafting' },
                { icon: KeyRound, label: 'Offline licence activation' },
              ].map((f) => (
                <span key={f.label} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium">
                  <f.icon className="h-3.5 w-3.5 text-primary" /> {f.label}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => navigate('/login')}>Sign in to demo <ArrowRight className="ml-1 h-4 w-4" /></Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/onboarding')}>Register a new school</Button>
              <Button size="lg" variant="ghost" onClick={() => navigate('/practice')}>Public practice</Button>
            </div>
            <p className="mt-4 flex max-w-xl items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This is a simulated prototype for design review. No real examinations, security, or synchronization are performed — every operation is a local mock with realistic behaviour.
            </p>
          </div>

          {/* architecture card */}
          <Card className="overflow-hidden border-2">
            <CardContent className="p-0">
              <div className="border-b bg-muted/40 px-5 py-3">
                <p className="text-sm font-semibold">The peer architecture</p>
                <p className="text-xs text-muted-foreground">No central server. The signed-in user defines the interface.</p>
              </div>
              <div className="space-y-3 p-5">
                {[
                  { n: 'A', label: 'Computer A', role: 'Administrator signs in → admin tools', tone: 'bg-emerald-500' },
                  { n: 'B', label: 'Computer B', role: 'Teacher signs in → question banks & drafts', tone: 'bg-sky-500' },
                  { n: 'C', label: 'Computer C', role: 'Student signs in → exam taking only', tone: 'bg-amber-500' },
                ].map((r) => (
                  <div key={r.n} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white ${r.tone}`}>{r.n}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.role}</p>
                    </div>
                    <div className="ml-auto hidden gap-1 sm:flex">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      <span className="h-2 w-2 rounded-full bg-red-300" />
                    </div>
                  </div>
                ))}
                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  <ClipboardCheck className="mb-1 h-4 w-4 text-primary" />
                  Same computer, different session → different interface. Data stays local until an
                  authorized sync distributes it.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* entry cards */}
        <div className="mt-14">
          <h2 className="mb-4 text-lg font-semibold">Get started</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <button
                key={c.title}
                onClick={c.action}
                className={`group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring ${c.primary ? 'border-primary/40 ring-1 ring-primary/20' : ''}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><c.icon className="h-4.5 w-4.5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{c.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.desc}</p>
                  <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">{c.cta} <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* demo users hint */}
        <div className="mt-10 rounded-xl border bg-card p-5">
          <p className="text-sm font-semibold">Try the full demonstration story</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in as <strong>Mr. Daniel Ibrahim</strong> (teacher) on <strong>DEV-017</strong> to create the mid-term exam,
            then follow the guided scenario: submit → approve on <strong>DEV-043</strong> as an administrator →
            distribute to 100 computers → students take the exam → collect and release results.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { store.switchDevice('DEV-017'); navigate('/login'); }}>Open the scenario on DEV-017</Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/login')}>Demo login selector</Button>
          </div>
        </div>

        <footer className="mt-10 border-t pt-6 text-center text-xs text-muted-foreground">
          <Separator className="mb-6" />
          ExamHub Phase 1 interactive prototype · simulated data only · light/dark theme supported
        </footer>
      </div>
    </div>
  );
}
