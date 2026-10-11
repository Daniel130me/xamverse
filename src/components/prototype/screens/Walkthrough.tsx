'use client';

/**
 * WalkthroughDrawer — the guided 30-step scenario from the specification:
 * teacher creates exam on DEV-017 → admin approves on DEV-043 → distribute to
 * 100 computers → students take the exam offline → admin collects results on
 * DEV-008 → export & release. Each step links to the exact screen/device.
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, ChevronRight, CircleCheck, Circle, ArrowRight, Map } from 'lucide-react';
import { toast } from 'sonner';

interface Step {
  id: number;
  title: string;
  device: string;
  user?: string;
  route: string;
  detail: string;
  /** automatic check: returns true when the world satisfies this step */
  done?: (s: ReturnType<typeof useDemoStore.getState>) => boolean;
}

export const STEPS: Step[] = [
  { id: 1, title: 'Teacher logs into Computer 17', device: 'DEV-017', user: 'u-teacher-math', route: '/login', detail: 'Use the demo selector: Mr. Daniel Ibrahim (Teacher, Mathematics).' },
  { id: 2, title: 'Create the Mathematics examination', device: 'DEV-017', user: 'u-teacher-math', route: '/app/assessments/new', detail: 'The seeded draft “SS2 Mathematics — Mid-Term Examination” is on DEV-017; you can also build a fresh one in the wizard.' },
  { id: 3, title: 'Exam saved locally on Computer 17', device: 'DEV-017', user: 'u-teacher-math', route: '/app/assessments', detail: 'Note: it exists ONLY on DEV-017 until transferred — check DEV-043 and see nothing.', done: (s) => !!s.world.locals['DEV-017'].assessments['ASSESS-MATH-SS2-MIDTERM'] },
  { id: 4, title: 'Submit for administrative approval', device: 'DEV-017', user: 'u-teacher-math', route: '/app/assessments/ASSESS-MATH-SS2-MIDTERM', detail: 'Open the assessment → “Submit for approval”.' },
  { id: 5, title: 'Choose Computer 43 as reviewer destination', device: 'DEV-017', user: 'u-teacher-math', route: '/app/assessments/ASSESS-MATH-SS2-MIDTERM', detail: 'Pick DEV-043 in the dialog — the request transfers across the LAN.', done: (s) => s.world.locals['DEV-017'].assessments['ASSESS-MATH-SS2-MIDTERM']?.status === 'pending_approval' },
  { id: 6, title: 'Administrator logs into Computer 43', device: 'DEV-043', user: 'u-admin', route: '/login', detail: 'Switch device in the simulator bar to DEV-043, then sign in as Mrs. Adaeze Okafor.' },
  { id: 7, title: 'See the pending assessment', device: 'DEV-043', user: 'u-admin', route: '/app/approvals', detail: 'The approval request appears after the transfer completes.', done: (s) => s.world.locals['DEV-043'].approvalRequests.some((r) => r.assessmentId === 'ASSESS-MATH-SS2-MIDTERM' && r.status === 'pending') },
  { id: 8, title: 'Review and approve', device: 'DEV-043', user: 'u-admin', route: '/app/approvals', detail: 'Use “Review” to check the checklist, then Approve.' },
  { id: 9, title: 'Approval recorded against the exact version', device: 'DEV-043', user: 'u-admin', route: '/app/assessments/ASSESS-MATH-SS2-MIDTERM', detail: 'Assessment shows “approved v1”. The teacher is notified when the decision syncs back.', done: (s) => s.world.locals['DEV-043'].assessments['ASSESS-MATH-SS2-MIDTERM']?.approvedVersion === 1 },
  { id: 10, title: 'Open the peer distribution interface', device: 'DEV-043', user: 'u-admin', route: '/app/assessments/ASSESS-MATH-SS2-MIDTERM', detail: 'Click “Distribute to computers” on the approved assessment.' },
  { id: 11, title: 'Select all 100 school computers', device: 'DEV-043', user: 'u-admin', route: '/app/assessments/ASSESS-MATH-SS2-MIDTERM', detail: '“Select all” covers the whole fleet of DEV-001…DEV-100.' },
  { id: 12, title: 'Start simulated distribution', device: 'DEV-043', user: 'u-admin', route: '/app/assessments/ASSESS-MATH-SS2-MIDTERM', detail: 'Per-computer transfer tasks are created and progress live.' },
  { id: 13, title: 'Each computer receives its own local copy', device: 'DEV-043', user: 'u-admin', route: '/app/computers', detail: 'Open any device (e.g. DEV-063) and check “Exam packages” — copies exist independently.', done: (s) => Object.values(s.world.devices).filter((d) => s.world.locals[d.id]?.examPackages['ASSESS-MATH-SS2-MIDTERM']).length > 50 },
  { id: 14, title: 'Watch per-computer progress & acknowledgments', device: 'DEV-043', user: 'u-admin', route: '/app/assessments/ASSESS-MATH-SS2-MIDTERM', detail: 'The distribution progress panel lists each peer\u2019s status.' },
  { id: 15, title: '96 succeed · 3 pending · 1 offline', device: 'DEV-043', user: 'u-admin', route: '/app/sync', detail: 'DEV-092 is offline (blocked), others stream at mock speeds. Blocked ones queue automatically.', done: (s) => s.world.locals['DEV-043'].transferQueue.some((t) => t.status === 'blocked_offline') },
  { id: 16, title: 'Retry and reconnect', device: 'DEV-043', user: 'u-admin', route: '/app/sync', detail: 'Use “This PC online/offline” in the simulator to reconnect DEV-092 — blocked transfers resume.' },
  { id: 17, title: 'Students take the exam on different computers', device: 'DEV-063', user: 'stu-amina', route: '/exam', detail: 'Switch to DEV-063 + Amina Yusuf, open “Start exam”. Any lab device works — computers have no fixed role.' },
  { id: 18, title: 'Answers save to the local database', device: 'DEV-063', user: 'stu-amina', route: '/exam', detail: 'The header shows auto-save ticks; every change is written locally.' },
  { id: 19, title: 'A computer disconnects during the exam', device: 'DEV-063', user: 'stu-amina', route: '/exam', detail: 'Click “LAN offline” in the simulator — a red banner confirms local saving continues.' },
  { id: 20, title: 'Student continues because the package is local', device: 'DEV-063', user: 'stu-amina', route: '/exam', detail: 'The exam keeps working fully offline — this is the offline-first core.' },
  { id: 21, title: 'Students complete and submit', device: 'DEV-063', user: 'stu-amina', route: '/exam', detail: 'Submit; the attempt is queued to authorized collectors (DEV-005/008/043).' },
  { id: 22, title: 'Another administrator logs into Computer 8', device: 'DEV-008', user: 'u-admin2', route: '/login', detail: 'DEV-008 was NOT the creator or approver — proving any peer can collect.' },
  { id: 23, title: 'Open the result collection interface', device: 'DEV-008', user: 'u-admin2', route: '/app/results', detail: 'Results & marking shows what has been collected locally so far.' },
  { id: 24, title: 'Discover peers and collect submissions', device: 'DEV-008', user: 'u-admin2', route: '/app/sync', detail: '“Collect results” → select all reachable peers → pull verified submissions.' },
  { id: 25, title: '97 of 100 submissions collected', device: 'DEV-008', user: 'u-admin2', route: '/app/results', detail: 'The dashboard shows the count and outstanding list. (Use scenario 4 to jump here instantly.)', done: (s) => s.world.locals['DEV-008'].submissions.filter((x) => x.assessmentId === 'ASSESS-MATH-SS2-MIDTERM').length >= 90 },
  { id: 26, title: 'Three results remain outstanding', device: 'DEV-008', user: 'u-admin2', route: '/app/results', detail: 'DEV-034, DEV-071, DEV-089 are offline — missing results stay visible until collected.' },
  { id: 27, title: 'Reconnect the outstanding peers', device: 'DEV-008', user: 'u-admin2', route: '/app/computers', detail: 'Reconnect the three devices via the simulator, then re-run collection (or load scenario 5).' },
  { id: 28, title: 'All 100 submissions complete', device: 'DEV-008', user: 'u-admin2', route: '/app/results', detail: 'Collection dashboard reaches 100/100 — duplicates were never double-counted.', done: (s) => s.world.locals['DEV-008'].submissions.filter((x) => x.assessmentId === 'ASSESS-MATH-SS2-MIDTERM').length >= 97 },
  { id: 29, title: 'Consolidated result dashboard', device: 'DEV-008', user: 'u-admin2', route: '/app/results', detail: 'Scores, averages and missing-result warnings are consolidated here.' },
  { id: 30, title: 'Export, moderate and release results', device: 'DEV-008', user: 'u-admin2', route: '/app/results/publish', detail: 'Export sheets, complete marking, then release to students.' },
];

export function WalkthroughDrawer() {
  const store = useDemoStore();
  const open = store.walkthroughOpen;
  if (!open) return null;

  const progress = STEPS.filter((s) => s.done?.(useDemoStore.getState())).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => store.setWalkthroughOpen(false)}>
      <div className="flex h-full w-full max-w-md flex-col border-l bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-2">
            <Map className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-bold">Guided scenario — exam lifecycle</p>
              <p className="text-xs text-muted-foreground">{progress}/{STEPS.length} steps satisfied (auto-detected)</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => store.setWalkthroughOpen(false)} aria-label="Close walkthrough"><X className="h-4 w-4" /></Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-1.5 p-3">
            {STEPS.map((s) => {
              const done = s.done?.(useDemoStore.getState()) ?? false;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    if (s.device) store.switchDevice(s.device);
                    if (s.user) store.switchUser(s.user);
                    store.setWalkthroughOpen(false);
                    store.navigate(s.route);
                    toast(`Step ${s.id}: ${s.title}`, { description: `${s.device}${s.user ? ` · ${store.world.users[s.user]?.name ?? ''}` : ''}` });
                  }}
                  className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  {done ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold"><span className="text-muted-foreground">Step {s.id}.</span> {s.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{s.detail}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[9px]">{s.device}</Badge>
                      {s.user && <Badge variant="outline" className="text-[9px]">{store.world.users[s.user]?.name ?? s.user}</Badge>}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <div className="border-t p-3">
          <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
            Click any step to jump to the right computer, user and screen. Steps with a green check are already satisfied by the current world state.
          </p>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => { store.loadScenario('fresh'); store.switchDevice('DEV-017'); store.switchUser('u-teacher-math'); store.navigate('/app/assessments'); store.setWalkthroughOpen(false); toast('Scenario reset — starting at Step 1'); }}>
              Start from the beginning <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
