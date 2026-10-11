'use client';

/** Guided onboarding wizard — 7 steps with progress, validation, resume support */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  GraduationCap, ArrowLeft, ArrowRight, Check, School, Network, DatabaseBackup, Upload, MonitorSmartphone,
  KeyRound, CheckCircle2, Info, Save,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Subject } from '@/lib/prototype/types';

type Step = { key: string; title: string; desc: string };

const STEPS: Step[] = [
  { key: 'school', title: 'School information', desc: 'Name, address, contact and type.' },
  { key: 'calendar', title: 'Academic calendar', desc: 'Session, term and grading policy.' },
  { key: 'classes', title: 'Classes & subjects', desc: 'Choose the arms and subjects to offer.' },
  { key: 'admin', title: 'Administrator account', desc: 'Create the first administrator.' },
  { key: 'device', title: 'Device registration', desc: 'Name this computer on the network.' },
  { key: 'plan', title: 'Subscription plan', desc: 'Select a plan and activation mode.' },
  { key: 'review', title: 'Review & finish', desc: 'Confirm everything, then initialize.' },
];

const SUBJECT_PRESETS: { name: string; code: string; checked: boolean }[] = [
  { name: 'Mathematics', code: 'MTH', checked: true },
  { name: 'English Language', code: 'ENG', checked: true },
  { name: 'Basic Science', code: 'BSC', checked: true },
  { name: 'Social Studies', code: 'SOS', checked: false },
  { name: 'Civic Education', code: 'CIV', checked: false },
  { name: 'Computer Studies', code: 'ICT', checked: true },
  { name: 'Yoruba', code: 'YOR', checked: false },
  { name: 'Business Studies', code: 'BUS', checked: false },
];

const PLANS = [
  { id: 'starter', name: 'Starter', price: '₦120,000 / yr', devices: 'Up to 10 computers', students: 'Up to 150 students', features: ['Question banks', 'Controlled exams', 'Peer sync'] },
  { id: 'standard', name: 'Standard', price: '₦260,000 / yr', devices: 'Up to 40 computers', students: 'Up to 800 students', features: ['Everything in Starter', 'AI question assistant', 'Advanced analytics'] },
  { id: 'campus', name: 'Campus', price: '₦540,000 / yr', devices: 'Up to 150 computers', students: 'Unlimited students', features: ['Everything in Standard', 'Multi-school support', 'Priority offline licence renewal'] },
];

export function OnboardingScreen() {
  const store = useDemoStore();
  const params = store.route.params;
  const initialMode = params.mode === 'join' ? 'join' : params.mode === 'import' ? 'import' : params.mode === 'restore' ? 'restore' : 'register';
  const [mode, setMode] = React.useState<string>(initialMode);
  const [step, setStep] = React.useState(0);
  const [saved, setSaved] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);

  // form state
  const [schoolName, setSchoolName] = React.useState('');
  const [schoolType, setSchoolType] = React.useState('secondary');
  const [address, setAddress] = React.useState('');
  const [city, setCity] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [session, setSession] = React.useState('2026/2027');
  const [term, setTerm] = React.useState('1');
  const [subjects, setSubjects] = React.useState<Subject[]>(() =>
    SUBJECT_PRESETS.filter((s) => s.checked).map((s, i) => ({ id: `sub-new-${i}`, name: s.name, code: s.code, departmentId: 'dep-general', levelCategory: 'all' as const }))
  );
  const [className, setClassName] = React.useState('');
  const [classes, setClasses] = React.useState<string[]>(['JSS1 A', 'JSS1 B']);
  const [adminName, setAdminName] = React.useState('');
  const [adminEmail, setAdminEmail] = React.useState('');
  const [adminPass, setAdminPass] = React.useState('');
  const [deviceName, setDeviceName] = React.useState('');
  const [plan, setPlan] = React.useState('standard');
  const [activation, setActivation] = React.useState<'online' | 'offline'>('offline');
  const [initStep, setInitStep] = React.useState(0); // 0 idle, 1-4 initializing

  const isJoin = mode === 'join';
  const isRestore = mode === 'restore';
  const isImport = mode === 'import';

  const validateStep = (): boolean => {
    const errs: string[] = [];
    if (step === 0) {
      if (schoolName.trim().length < 3) errs.push('School name must be at least 3 characters.');
      if (!address.trim()) errs.push('Street address is required.');
      if (!city.trim()) errs.push('City is required.');
      if (!/^\+?[\d\s-]{7,}$/.test(phone)) errs.push('Enter a valid phone number.');
      if (!email.includes('@')) errs.push('Enter a valid school email.');
    }
    if (step === 2 && classes.length === 0) errs.push('Add at least one class.');
    if (step === 3) {
      if (adminName.trim().length < 3) errs.push('Administrator full name is required.');
      if (!adminEmail.includes('@')) errs.push('Administrator email is invalid.');
      if (adminPass.length < 8) errs.push('Password must be at least 8 characters.');
    }
    if (step === 4 && deviceName.trim().length < 2) errs.push('Give this computer a name (e.g. OFFICE-PC1).');
    setErrors(errs);
    return errs.length === 0;
  };

  const next = () => {
    if (!validateStep()) return;
    if (step === STEPS.length - 1) {
      // simulate initialization
      setInitStep(1);
      const iv = setInterval(() => {
        setInitStep((s) => {
          if (s >= 4) {
            clearInterval(iv);
            setDone(true);
            toast.success('Setup complete', { description: 'Your school is configured on this computer. Sign in to begin.' });
            return s;
          }
          return s + 1;
        });
      }, 700);
      return;
    }
    setStep((s) => s + 1);
  };

  const saveForLater = () => {
    setSaved(true);
    toast('Setup saved locally', { description: 'You can close the app and resume this wizard later — progress is stored on this computer.' });
  };

  if (isJoin) return <JoinSchoolFlow onBack={() => store.navigate('/')} />;
  if (isRestore) return <RestoreFlow onBack={() => store.navigate('/')} />;
  if (isImport) return <ImportFlow onBack={() => store.navigate('/')} />;

  return (
    <div className="min-h-screen bg-muted/30 p-4 lg:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => store.navigate('/')}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
          <div className="flex items-center gap-2">
            {saved && <Badge variant="outline" className="text-emerald-600"><Save className="mr-1 h-3 w-3" /> Saved on this computer</Badge>}
            <Button variant="outline" size="sm" onClick={saveForLater}>Save & exit</Button>
          </div>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><GraduationCap className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-bold">Register a new school</h1>
            <p className="text-sm text-muted-foreground">Everything is stored locally on this computer — internet is not required.</p>
          </div>
        </div>

        {/* progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Step {step + 1} of {STEPS.length}: {STEPS[step].title}</span>
            <span>{Math.round(((step + 1) / STEPS.length) * 100)}%</span>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} className="mt-1.5" />
        </div>

        <Card>
          <CardContent className="p-5 lg:p-6">
            {done ? (
              <div className="py-10 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                <h2 className="mt-3 text-lg font-bold">{schoolName || 'Your school'} is ready</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Local storage initialized, {classes.length} classes and {subjects.length} subjects created,
                  administrator account registered, and this computer named <strong>{deviceName || 'MAIN-PC'}</strong>.
                  {activation === 'offline' ? ' An offline activation request file was generated for your licence.' : ' Online licence activation succeeded (simulated).'}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <Button onClick={() => { store.navigate('/login'); }}>Go to sign in</Button>
                  <Button variant="outline" onClick={() => { store.navigate('/'); }}>Back to welcome</Button>
                </div>
              </div>
            ) : initStep > 0 ? (
              <div className="space-y-3 py-8">
                <p className="text-center text-sm font-medium">Initializing local installation…</p>
                {[
                  [1, 'Creating local database schema'],
                  [2, 'Registering device identity'],
                  [3, 'Generating licence activation request'],
                  [4, 'Writing school configuration'],
                ].map(([n, label]) => (
                  <div key={n as number} className="mx-auto flex max-w-md items-center gap-2 text-sm">
                    {initStep > (n as number) ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : initStep === n ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : <span className="h-4 w-4 rounded-full border border-muted-foreground/30" />}
                    <span className={initStep >= (n as number) ? '' : 'text-muted-foreground'}>{label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <h2 className="text-sm font-semibold">{STEPS[step].title}</h2>
                <p className="text-xs text-muted-foreground">{STEPS[step].desc}</p>

                <div className="mt-4 space-y-4">
                  {step === 0 && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label htmlFor="sname">School name *</Label>
                        <Input id="sname" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="e.g. Crescent Heights College" className="mt-1" />
                      </div>
                      <div>
                        <Label>School type</Label>
                        <div className="mt-1 flex gap-2">
                          {['primary', 'secondary', 'combined'].map((t) => (
                            <button key={t} type="button" onClick={() => setSchoolType(t)} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium capitalize ${schoolType === t ? 'border-primary bg-primary/10 text-primary' : ''}`}>{t}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="sphone">Phone *</Label>
                        <Input id="sphone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 800 000 0000" className="mt-1" />
                      </div>
                      <div className="sm:col-span-2">
                        <Label htmlFor="saddr">Address *</Label>
                        <Input id="saddr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" className="mt-1" />
                      </div>
                      <div>
                        <Label htmlFor="scity">City *</Label>
                        <Input id="scity" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1" />
                      </div>
                      <div>
                        <Label htmlFor="semail">School email *</Label>
                        <Input id="semail" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="office@school.ng" className="mt-1" />
                      </div>
                    </div>
                  )}

                  {step === 1 && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label>Starting session</Label>
                        <div className="mt-1 flex gap-2">
                          {['2025/2026', '2026/2027'].map((s) => (
                            <button key={s} type="button" onClick={() => setSession(s)} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${session === s ? 'border-primary bg-primary/10 text-primary' : ''}`}>{s}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label>First term</Label>
                        <div className="mt-1 flex gap-2">
                          {['1', '2', '3'].map((t) => (
                            <button key={t} type="button" onClick={() => setTerm(t)} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${term === t ? 'border-primary bg-primary/10 text-primary' : ''}`}>Term {t}</button>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground sm:col-span-2">
                        <Info className="mb-1 h-3.5 w-3.5 text-primary" />
                        Default grading policy: A (75–100), B (65–74), C (50–64), D (45–49), E (40–44), F (0–39). You can customise this later under Academic Setup.
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-4">
                      <div>
                        <Label>Classes & arms</Label>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {classes.map((c) => (
                            <Badge key={c} variant="secondary" className="gap-1">{c} <button aria-label={`Remove ${c}`} onClick={() => setClasses((cs) => cs.filter((x) => x !== c))} className="ml-0.5 text-muted-foreground hover:text-red-500">×</button></Badge>
                          ))}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <Input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="e.g. SS1 A" aria-label="New class name" onKeyDown={(e) => { if (e.key === 'Enter' && className.trim()) { setClasses((cs) => [...cs, className.trim()]); setClassName(''); } }} />
                          <Button type="button" variant="outline" onClick={() => { if (className.trim()) { setClasses((cs) => [...cs, className.trim()]); setClassName(''); } }}>Add</Button>
                        </div>
                      </div>
                      <div>
                        <Label>Subjects to offer</Label>
                        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                          {SUBJECT_PRESETS.map((p, i) => (
                            <label key={p.name} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm hover:bg-accent cursor-pointer">
                              <Checkbox
                                checked={subjects.some((s) => s.name === p.name)}
                                onCheckedChange={(v) => {
                                  setSubjects((ss) => v ? [...ss, { id: `sub-new-${p.code}`, name: p.name, code: p.code, departmentId: 'dep-general', levelCategory: 'all' as const }] : ss.filter((s) => s.name !== p.name));
                                  void i;
                                }}
                              />
                              {p.name} <span className="ml-auto text-xs text-muted-foreground">{p.code}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 3 && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label htmlFor="aname">Administrator full name *</Label>
                        <Input id="aname" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="e.g. Mrs. Amina Bello" className="mt-1" />
                      </div>
                      <div>
                        <Label htmlFor="aemail">Administrator email *</Label>
                        <Input id="aemail" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@school.ng" className="mt-1" />
                      </div>
                      <div>
                        <Label htmlFor="apass">Password (min 8 chars) *</Label>
                        <Input id="apass" type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} className="mt-1" />
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground sm:col-span-2">
                        The first administrator can create staff accounts, custom roles and additional administrators after setup. Accounts are stored locally and sync to paired peers with authorization.
                      </div>
                    </div>
                  )}

                  {step === 4 && (
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="dname">Name this computer *</Label>
                        <Input id="dname" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="e.g. OFFICE-PC1" className="mt-1" />
                      </div>
                      <div className="rounded-lg border p-4">
                        <p className="flex items-center gap-2 text-sm font-medium"><MonitorSmartphone className="h-4 w-4 text-primary" /> Device identity</p>
                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                          <p>Device ID: <span className="font-mono text-foreground">DEV-{Math.floor(1000 + Math.random() * 8999)}-{(deviceName || 'NEW').slice(0, 3).toUpperCase()}</span></p>
                          <p>Local port: <span className="font-mono text-foreground">47810</span> · Storage: 8.0 GB reserved · OS: detected automatically</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 5 && (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        {PLANS.map((p) => (
                          <button key={p.id} type="button" onClick={() => setPlan(p.id)} className={`rounded-xl border p-4 text-left transition-all ${plan === p.id ? 'border-primary ring-2 ring-primary/20' : 'hover:border-muted-foreground/30'}`}>
                            <p className="text-sm font-bold">{p.name}</p>
                            <p className="mt-0.5 text-lg font-bold text-primary">{p.price}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{p.devices} · {p.students}</p>
                            <ul className="mt-2 space-y-1">
                              {p.features.map((f) => <li key={f} className="flex items-center gap-1 text-xs"><Check className="h-3 w-3 text-emerald-500" /> {f}</li>)}
                            </ul>
                          </button>
                        ))}
                      </div>
                      <div>
                        <Label>Activation mode</Label>
                        <div className="mt-1 grid gap-2 sm:grid-cols-2">
                          <button type="button" onClick={() => setActivation('online')} className={`rounded-lg border p-3 text-left text-sm ${activation === 'online' ? 'border-primary bg-primary/5' : ''}`}>
                            <p className="font-medium">Online activation</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">Requires internet once. Fastest option.</p>
                          </button>
                          <button type="button" onClick={() => setActivation('offline')} className={`rounded-lg border p-3 text-left text-sm ${activation === 'offline' ? 'border-primary bg-primary/5' : ''}`}>
                            <p className="font-medium">Offline activation</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">Generate a request file, activate on any internet computer, import the licence file.</p>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 6 && (
                    <div className="space-y-3 text-sm">
                      {[
                        ['School', `${schoolName || '—'} (${schoolType})`],
                        ['Address', `${address || '—'}, ${city || '—'}`],
                        ['Session / term', `${session}, Term ${term}`],
                        ['Classes', classes.join(', ') || '—'],
                        ['Subjects', subjects.map((s) => s.name).join(', ') || '—'],
                        ['Administrator', `${adminName || '—'} (${adminEmail || '—'})`],
                        ['This computer', deviceName || '—'],
                        ['Plan', PLANS.find((p) => p.id === plan)?.name ?? '—'],
                        ['Activation', activation === 'online' ? 'Online' : 'Offline (request file will be generated)'],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-4 border-b pb-2">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="text-right font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {errors.length > 0 && (
                  <ul className="mt-4 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                    {errors.map((e) => <li key={e}>• {e}</li>)}
                  </ul>
                )}

                <div className="mt-6 flex items-center justify-between">
                  <Button variant="outline" size="sm" disabled={step === 0 || initStep > 0} onClick={() => setStep((s) => s - 1)}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
                  <Button onClick={next} disabled={initStep > 0}>{step === STEPS.length - 1 ? 'Finish setup' : 'Continue'} <ArrowRight className="ml-1 h-4 w-4" /></Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function JoinSchoolFlow({ onBack }: { onBack: () => void }) {
  const store = useDemoStore();
  const [state, setState] = React.useState<'form' | 'scanning' | 'request' | 'waiting' | 'approved'>('form');
  const [ip, setIp] = React.useState('');
  const [code, setCode] = React.useState('');
  const [discovered, setDiscovered] = React.useState<string[]>([]);
  const [chosen, setChosen] = React.useState<string | null>(null);

  const scan = () => {
    setState('scanning');
    setTimeout(() => {
      setDiscovered(['DEV-043 — GF-ADMIN-PC43 (192.168.8.143)', 'DEV-001 — GF-ADMIN-PC01 (192.168.8.101)']);
      setState('request');
      toast('Scan complete', { description: '2 paired peers discovered on this LAN.' });
    }, 1400);
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 lg:p-8">
      <div className="mx-auto max-w-2xl">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-6"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Network className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-bold">Join an existing school</h1>
            <p className="text-sm text-muted-foreground">Pair with a school peer and request authorization to join.</p>
          </div>
        </div>
        <Card>
          <CardContent className="space-y-4 p-6">
            {state === 'form' && (
              <>
                <div>
                  <Label>Step 1 — discover peers</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Scan the local network, or enter a peer address manually if discovery is blocked by the firewall.</p>
                  <div className="mt-2 flex gap-2">
                    <Button onClick={scan}>Scan LAN</Button>
                    <div className="flex flex-1 gap-2">
                      <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="Manual IP, e.g. 192.168.8.143" aria-label="Manual peer IP" />
                      <Button variant="outline" onClick={() => { if (ip) { setDiscovered([`Manual — ${ip}`]); setState('request'); } }}>Connect</Button>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <Info className="mb-1 h-3.5 w-3.5 text-primary" /> A school administrator must approve the pairing on the destination computer. The pairing request includes this device\u2019s identity key (simulated).
                </div>
              </>
            )}
            {state === 'scanning' && (
              <div className="py-8 text-center text-sm text-muted-foreground"><span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent align-[-2px]" />Scanning local network…</div>
            )}
            {state === 'request' && (
              <>
                <Label>Step 2 — choose a peer</Label>
                <div className="space-y-2">
                  {discovered.map((d) => (
                    <button key={d} onClick={() => setChosen(d)} className={`w-full rounded-lg border p-3 text-left text-sm ${chosen === d ? 'border-primary ring-1 ring-primary/30' : ''}`}>{d}</button>
                  ))}
                </div>
                <div>
                  <Label htmlFor="pcode">School invitation code (optional)</Label>
                  <Input id="pcode" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Provided by the school administrator" className="mt-1" />
                </div>
                <Button disabled={!chosen} onClick={() => { setState('waiting'); setTimeout(() => setState('approved'), 1800); }}>
                  <Network className="mr-1.5 h-4 w-4" /> Send pairing request
                </Button>
              </>
            )}
            {state === 'waiting' && <div className="py-8 text-center text-sm text-muted-foreground"><span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent align-[-2px]" />Waiting for approval on {chosen}…</div>}
            {state === 'approved' && (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="mt-2 font-semibold">Pairing approved</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">This computer is now paired with {chosen}. School data will replicate according to your authorization level. Switch to the Little Stars/Greenfield devices in the simulator to explore.</p>
                <Button className="mt-4" onClick={() => store.navigate('/login')}>Continue to sign in</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RestoreFlow({ onBack }: { onBack: () => void }) {
  const store = useDemoStore();
  const [file, setFile] = React.useState<string | null>(null);
  const [restoring, setRestoring] = React.useState(false);
  const [done, setDone] = React.useState(false);
  return (
    <div className="min-h-screen bg-muted/30 p-4 lg:p-8">
      <div className="mx-auto max-w-2xl">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-6"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><DatabaseBackup className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-bold">Restore an installation from backup</h1>
            <p className="text-sm text-muted-foreground">Imports an encrypted ExamHub backup file and rebuilds local records.</p>
          </div>
        </div>
        <Card>
          <CardContent className="space-y-4 p-6">
            {!done ? (
              <>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center hover:border-primary/50">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">{file ?? 'Choose a backup file (.ehbak)'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Selecting simulates picking “greenfield-full-2026-10-04.ehbak”</p>
                  <input type="file" className="hidden" onChange={() => setFile('greenfield-full-2026-10-04.ehbak')} aria-label="Backup file" />
                </label>
                {file && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                    <p className="font-medium text-foreground">Backup summary (verified)</p>
                    <p className="mt-1 text-muted-foreground">School: Greenfield Academy · Created 04 Oct 2026 02:00 · 412 MB · AES-256 encrypted · Signature valid</p>
                  </div>
                )}
                <Button disabled={!file || restoring} onClick={() => { setRestoring(true); setTimeout(() => { setRestoring(false); setDone(true); toast.success('Restore complete'); }, 1600); }}>
                  {restoring ? 'Restoring…' : <><DatabaseBackup className="mr-1.5 h-4 w-4" /> Restore this backup</>}
                </Button>
                {restoring && <Progress value={64} />}
              </>
            ) : (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="mt-2 font-semibold">Restoration successful</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">All records were rebuilt from the backup. The demo world has been reset to its seeded state.</p>
                <Button className="mt-4" onClick={() => store.navigate('/login')}>Continue to sign in</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ImportFlow({ onBack }: { onBack: () => void }) {
  const store = useDemoStore();
  const [state, setState] = React.useState<'pick' | 'map' | 'done'>('pick');
  const [rows, setRows] = React.useState(0);
  return (
    <div className="min-h-screen bg-muted/30 p-4 lg:p-8">
      <div className="mx-auto max-w-2xl">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-6"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Upload className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-bold">Import existing school data</h1>
            <p className="text-sm text-muted-foreground">Bring students, staff and results into a fresh installation from CSV/Excel exports.</p>
          </div>
        </div>
        <Card>
          <CardContent className="space-y-4 p-6">
            {state === 'pick' && (
              <>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center hover:border-primary/50">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">Choose a CSV or Excel file</p>
                  <p className="mt-1 text-xs text-muted-foreground">Selecting simulates importing “students_master_list.csv” (172 rows)</p>
                  <input type="file" className="hidden" onChange={() => { setRows(172); setState('map'); }} aria-label="Import file" />
                </label>
                <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Supported: students, staff, parents, subjects, previous results. Duplicate admission numbers are flagged before anything is written.
                </div>
              </>
            )}
            {state === 'map' && (
              <>
                <p className="text-sm font-medium">Map columns → <span className="text-muted-foreground">students_master_list.csv ({rows} rows)</span></p>
                <div className="space-y-2">
                  {[
                    ['Column A: "Name of Student"', 'Full name'],
                    ['Column B: "Class"', 'Class'],
                    ['Column C: "Admission No"', 'Admission number'],
                    ['Column D: "Parent Phone"', 'Guardian phone'],
                  ].map(([col, field]) => (
                    <div key={col} className="flex items-center justify-between rounded-lg border p-2.5 text-xs">
                      <span className="font-mono">{col}</span>
                      <span className="text-muted-foreground">→ {field} ✓</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  3 rows have duplicate admission numbers — they will be skipped and reported after import.
                </div>
                <Button onClick={() => { setState('done'); toast.success('Import complete', { description: '169 records imported · 3 skipped.' }); }}>
                  <KeyRound className="mr-1.5 h-4 w-4" /> Import 169 records
                </Button>
              </>
            )}
            {state === 'done' && (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="mt-2 font-semibold">169 records imported</p>
                <p className="mt-1 text-sm text-muted-foreground">3 duplicates skipped. A full report was saved to local logs.</p>
                <Button className="mt-4" onClick={() => store.navigate('/login')}>Continue to sign in</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
