'use client';

/** Login — real form + demonstration quick-login selector (no real credentials) */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { ROLE_LABELS, fmtRelative } from '@/lib/prototype/ui-utils';
import { UserAvatar } from '../shared/ui-kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { GraduationCap, ArrowLeft, Lock, UserRound, AlertTriangle, ChevronRight, MonitorSmartphone, KeyRound, Clock } from 'lucide-react';
import { toast } from 'sonner';

const DEMO_USERS: { id: string; hint: string }[] = [
  { id: 'u-admin', hint: 'Approve assessments, distribute to peers, resolve conflicts' },
  { id: 'u-admin2', hint: 'Collect results from peers on DEV-008' },
  { id: 'u-proprietor', hint: 'Licence, billing and school oversight' },
  { id: 'u-exoff', hint: 'Exam calendar, distribution and monitoring' },
  { id: 'u-teacher-math', hint: 'The guided scenario: creates the mid-term exam' },
  { id: 'u-teacher-eng', hint: 'English teacher with published results' },
  { id: 'u-hod-grace', hint: 'Reviews departmental questions & marks' },
  { id: 'u-invig', hint: 'Live session monitoring & incident logging' },
  { id: 'stu-amina', hint: 'Take exams, see own results & progress' },
  { id: 'par-1', hint: 'View linked child\u2019s released results' },
  { id: 'u-support', hint: 'Devices, updates, backups and diagnostics' },
];

export function LoginScreen() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const [email, setEmail] = React.useState('d.ibrahim@greenfieldacademy.ng');
  const [password, setPassword] = React.useState('demo1234');
  const [error, setError] = React.useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    const user = Object.values(store.world.users).find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      setError('No account with that email on this school\u2019s local records. Try the demo accounts below.');
      return;
    }
    if (user.status === 'suspended') {
      setError('This account is suspended. Contact your administrator.');
      return;
    }
    if (user.schoolId !== device.schoolId) {
      setError(`That account belongs to another school. This computer (${device.name}) is registered to ${store.world.schools[device.schoolId]?.name}.`);
      return;
    }
    setError(null);
    store.login(user.id);
    toast.success(`Welcome, ${user.name}`, { description: `${ROLE_LABELS[user.role]} · signed in on ${device.name}` });
    store.navigate('/app/dashboard');
  };

  const school = store.world.schools[device.schoolId];

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* left panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-gradient-to-br from-emerald-600 to-teal-800 p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15"><GraduationCap className="h-5 w-5" /></div>
          <div>
            <p className="font-bold">ExamHub</p>
            <p className="text-xs text-emerald-100">Offline-first examinations</p>
          </div>
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-tight">One installation.<br />Every role.</h1>
          <p className="mt-3 max-w-md text-sm text-emerald-50">
            This computer keeps its own local records. The account you sign in with decides which
            features you see — administrator, teacher, invigilator, student or parent.
          </p>
          <div className="mt-6 space-y-2 text-xs text-emerald-100">
            <p className="flex items-center gap-2"><MonitorSmartphone className="h-4 w-4" /> You are signing in on <strong>{device?.name}</strong> ({store.activeDeviceId})</p>
            <p className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Authentication is verified against local records (simulated)</p>
          </div>
        </div>
        <p className="text-xs text-emerald-200/80">Simulated prototype — no production credentials are validated.</p>
      </div>

      {/* right panel */}
      <div className="flex w-full flex-col overflow-y-auto p-6 lg:w-1/2 lg:p-10">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => store.navigate('/')}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
          <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300">Simulated computer: {device?.name}</Badge>
        </div>

        <div className="mx-auto w-full max-w-md">
          <h2 className="text-xl font-bold">Sign in to {school?.shortName ?? 'your school'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use a real form or pick a demonstration account below — no passwords needed for demo accounts.</p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <Label htmlFor="email">Email or username</Label>
              <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.ng" autoComplete="username" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mt-1" />
            </div>
            {error && (
              <p className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
              </p>
            )}
            <div className="flex items-center justify-between text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => toast('Offline recovery', { description: 'In production, password recovery requires an authorized peer with recovery rights — no cloud involved.' })}>Forgot password?</button>
              <span className="text-muted-foreground">Offline authentication is cached for {school?.shortName ?? 'the school'}.</span>
            </div>
            <Button type="submit" className="w-full"><Lock className="mr-1.5 h-4 w-4" /> Sign in</Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">DEMONSTRATION ACCOUNTS</span>
            <Separator className="flex-1" />
          </div>

          <Card>
            <CardContent className="max-h-80 space-y-1 overflow-y-auto p-2">
              {DEMO_USERS.map(({ id, hint }) => {
                const u = store.world.users[id];
                if (!u) return null;
                const isCurrentDeviceSchool = u.schoolId === device.schoolId;
                return (
                  <button
                    key={id}
                    disabled={!isCurrentDeviceSchool}
                    onClick={() => {
                      store.login(id);
                      toast.success(`Signed in as ${u.name}`, { description: ROLE_LABELS[u.role] });
                      store.navigate('/app/dashboard');
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent disabled:opacity-40 ${isCurrentDeviceSchool ? '' : 'cursor-not-allowed'}`}
                  >
                    <UserAvatar name={u.name} hue={u.avatarHue} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">{u.name} {!isCurrentDeviceSchool && <Badge variant="outline" className="text-[9px]">other school</Badge>}</span>
                      <span className="block truncate text-xs text-muted-foreground">{u.demoLabel ?? ROLE_LABELS[u.role]} — {hint}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Last sign-in {fmtRelative(Object.values(store.world.users).find((u) => u.role === 'administrator')?.lastLoginAt)}</span>
            <button className="flex items-center gap-1 text-primary hover:underline" onClick={() => store.navigate('/onboarding')}>
              <UserRound className="h-3.5 w-3.5" /> New school? Start setup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
