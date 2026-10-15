/**
 * Store test suite — the behavioural contract of the simulated service layer.
 *
 * These tests pin down the invariants that docs/STATE_MACHINES.md and
 * docs/DATA_MODELS.md declare, so Phase 2/3 engine implementations can be
 * validated against the exact same rules the prototype enforces today:
 * version-locked approvals, per-device isolation, transfer engine semantics,
 * hash-based duplicate detection, RBAC and the exam lifecycle.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useDemoStore } from '../store';
import type { Question } from '../types';

const S = () => useDemoStore.getState();

const MATH = 'ASSESS-MATH-SS2-MIDTERM';
const TEACHER = 'u-teacher-math';
const ADMIN = 'u-admin';
const ADMIN2 = 'u-admin2';
const STUDENT = 'stu-amina';

/** Drive the tick engine until cond() holds (or max ticks elapse). */
function runUntil(cond: () => boolean, max = 400): boolean {
  for (let i = 0; i < max && !cond(); i++) S().tick();
  return cond();
}

beforeEach(() => {
  window.localStorage.clear();
  S().resetDemo();
});

describe('seeded demo world', () => {
  it('creates two isolated schools with 103 peer devices', () => {
    const w = S().world;
    expect(Object.keys(w.schools)).toHaveLength(2);
    expect(Object.keys(w.devices)).toHaveLength(103);
    expect(Object.keys(w.locals)).toHaveLength(103);
    for (const u of Object.values(w.users)) {
      expect(w.schools[u.schoolId]).toBeDefined();
    }
  });

  it('devices carry no permanent role field', () => {
    const d = S().world.devices['DEV-017'] as unknown as Record<string, unknown>;
    expect('role' in d).toBe(false);
    expect('currentUserRole' in d).toBe(false);
  });

  it('data exists per device — the seeded draft is only on DEV-017', () => {
    expect(S().world.locals['DEV-017'].assessments[MATH]).toBeDefined();
    expect(S().world.locals['DEV-043'].assessments[MATH]).toBeUndefined();
  });

  it('seeds a pending approval request on the reviewer device', () => {
    const apr = S().world.locals['DEV-043'].approvalRequests.find((r) => r.id === 'APR-002');
    expect(apr?.status).toBe('pending');
  });
});

describe('AuthService', () => {
  it('logs in per device and switching device ends the session', () => {
    S().switchDevice('DEV-017');
    S().login(TEACHER);
    expect(S().session?.userId).toBe(TEACHER);
    expect(S().currentUser()?.name).toBe('Mr. Daniel Ibrahim');
    S().switchDevice('DEV-043');
    expect(S().session).toBeNull();
  });

  it('enforces RBAC — teacher cannot approve, administrator can', () => {
    S().switchDevice('DEV-017');
    S().login(TEACHER);
    expect(S().can('questions.create')).toBe(true);
    expect(S().can('assessments.approve')).toBe(false);
    expect(S().can('sync.distribute')).toBe(false);
    S().login(ADMIN);
    expect(S().can('assessments.approve')).toBe(true);
    expect(S().can('sync.distribute')).toBe(true);
  });
});

describe('assessment lifecycle', () => {
  it('version-lock: editing an approved assessment creates a new draft revision', () => {
    S().loadScenario('approved');
    const a = S().world.locals['DEV-017'].assessments[MATH];
    expect(a.status).toBe('approved');
    expect(a.version).toBe(1);

    S().saveAssessment({ ...a, name: 'SS2 Mathematics — Mid-Term (edited)' }, 'test edit');
    const edited = S().world.locals['DEV-017'].assessments[MATH];
    expect(edited.version).toBe(2);
    expect(edited.status).toBe('draft');
    expect(edited.approvedVersion).toBe(1); // the approved v1 binding is preserved
    expect(S().world.locals['DEV-043'].assessments[MATH].approvedByName).toBe('Mrs. Adaeze Okafor');
  });

  it('submit → transfer → review → approve roundtrip across peer devices', () => {
    S().switchDevice('DEV-017');
    S().login(TEACHER);
    S().submitAssessmentForApproval(MATH, 'DEV-043');
    expect(S().local().assessments[MATH].status).toBe('pending_approval');

    // request physically transfers to the reviewer device
    expect(
      runUntil(() =>
        S().world.locals['DEV-043'].approvalRequests.some((r) => r.assessmentId === MATH && r.status === 'pending')
      )
    ).toBe(true);

    S().switchDevice('DEV-043');
    S().login(ADMIN);
    const req = S().local().approvalRequests.find((r) => r.assessmentId === MATH)!;
    S().decideApproval(req.id, 'approved', 'coverage verified');

    const onReviewer = S().local().assessments[MATH];
    expect(onReviewer.status).toBe('approved');
    expect(onReviewer.approvedVersion).toBe(req.version);

    // the decision transfers back and mutates the teacher's copy
    expect(runUntil(() => S().world.locals['DEV-017'].assessments[MATH].status === 'approved')).toBe(true);
  });

  it('distribute → sealed package lands on peers; offline peers block then auto-resume', () => {
    S().loadScenario('approved');
    S().switchDevice('DEV-043');
    S().login(ADMIN);

    expect(S().distributeAssessment(MATH, ['DEV-065', 'DEV-071'])).toBe(2);
    // DEV-071 is seeded offline (one of the 3 outstanding devices) → blocked
    expect(
      runUntil(() =>
        S().local().transferQueue.some((t) => t.toDeviceId === 'DEV-071' && t.status === 'blocked_offline')
      )
    ).toBe(true);
    // online target completes with a sealed package built from the distributor's bank
    expect(runUntil(() => !!S().world.locals['DEV-065'].examPackages[MATH])).toBe(true);
    expect(S().world.locals['DEV-071'].examPackages[MATH]).toBeUndefined();
    const pkg = S().world.locals['DEV-065'].examPackages[MATH];
    expect(Object.keys(pkg.questionPayload ?? {}).length).toBeGreaterThan(0);
    expect(pkg.fromDeviceId).toBe('DEV-043');

    // simulate reconnect → blocked transfer auto-resumes and delivers
    S().setDeviceOnline('DEV-071', true);
    expect(runUntil(() => !!S().world.locals['DEV-071'].examPackages[MATH])).toBe(true);
  });

  it('publishResults releases the assessment and writes an audit event', () => {
    S().loadScenario('collected');
    S().switchDevice('DEV-043');
    S().login(ADMIN);
    expect(S().local().assessments[MATH].status).toBe('marking');
    S().publishResults(MATH);
    expect(S().local().assessments[MATH].status).toBe('results_released');
    expect(S().local().auditLog.some((e) => e.action === 'result_adjusted' && e.target === MATH)).toBe(true);
  });
});

describe('exam attempt lifecycle', () => {
  it('rejects attempts on computers the exam was never delivered to', () => {
    S().loadScenario('distributed');
    S().switchDevice('DEV-101'); // Little Stars — different school, no package
    expect(S().startAttempt(MATH, STUDENT)).toBeNull();
  });

  it('auto-marks objective answers on submit and queues submissions to authorised collectors', () => {
    S().loadScenario('distributed');
    S().switchDevice('DEV-063');
    S().login(STUDENT);

    const attemptId = S().startAttempt(MATH, STUDENT);
    expect(attemptId).toBeTruthy();
    expect(S().activeExam).not.toBeNull();

    // answer every objective question correctly from the sealed package
    const answer = (qid: string): Question | undefined =>
      S().local().examPackages[MATH]?.questionPayload?.[qid] ?? S().local().questions[qid];
    let objective = 0;
    let essayCount = 0;
    for (const qid of S().activeExam!.questionOrder) {
      const q = answer(qid);
      if (!q) continue;
      if (q.type === 'essay') {
        essayCount++;
        continue;
      }
      objective++;
      if (q.type === 'single_choice' || q.type === 'true_false' || q.type === 'multi_choice') {
        S().saveAnswer(qid, { selected: [...q.correct] });
      } else if (q.type === 'short_answer' || q.type === 'numeric') {
        S().saveAnswer(qid, { text: q.correct[0] });
      } else if (q.type === 'fill_blank') {
        S().saveAnswer(qid, { text: (q.blanks ?? []).map((b) => b.answer).join('||') });
      } else if (q.type === 'matching') {
        S().saveAnswer(qid, { pairs: Object.fromEntries((q.pairs ?? []).map((p) => [p.left, p.right])) });
      } else if (q.type === 'ordering') {
        S().saveAnswer(qid, { ordering: [...(q.items ?? [])] });
      }
    }
    expect(objective).toBeGreaterThan(0);

    S().submitAttempt();
    const attempt = S().local().attempts.find((a) => a.id === attemptId)!;
    // every objective answer must be marked correct
    expect(attempt.autoScore).toBeGreaterThan(0);
    expect(attempt.status).toBe(essayCount > 0 ? 'submitted' : 'marked');

    // submissions enqueue to the three authorised collectors
    const outgoing = S().local().transferQueue.filter(
      (t) => t.payloadType === 'submission' && t.payloadId === attemptId && t.direction === 'outgoing'
    );
    expect(outgoing).toHaveLength(3);

    // collector receives the result
    expect(
      runUntil(() => S().world.locals['DEV-008'].submissions.some((s) => s.attemptId === attemptId))
    ).toBe(true);
  });
});

describe('results collection & dedup', () => {
  it('collecting the same attempt twice raises a duplicate conflict and never double-counts', () => {
    S().loadScenario('collected');
    S().switchDevice('DEV-008');
    S().login(ADMIN2);

    const countSubs = () => S().local().submissions.filter((s) => s.assessmentId === MATH).length;
    const before = countSubs();
    expect(before).toBe(97); // 3 outstanding devices: DEV-071, DEV-089, DEV-096 (all seeded offline)

    // reconnect DEV-071 (documented flow 8.4: reconnect outstanding devices, re-run collection)
    S().setDeviceOnline('DEV-071', true);
    S().collectResults(MATH, ['DEV-071']);
    expect(runUntil(() => countSubs() === before + 1)).toBe(true);

    // second collection of the same peer — identical content hash → duplicate
    S().collectResults(MATH, ['DEV-071']);
    expect(
      runUntil(() => S().local().conflicts.some((c) => c.type === 'duplicate_submission' && c.status === 'open'), 400)
    ).toBe(true);
    expect(countSubs()).toBe(before + 1); // still exactly one copy
  });
});

describe('SyncService', () => {
  it('blocked transfers can be retried and cancelled', () => {
    S().loadScenario('approved');
    S().switchDevice('DEV-043');
    S().login(ADMIN);
    S().setDeviceOnline('DEV-071', false);
    S().distributeAssessment(MATH, ['DEV-071']);

    const findTask = () =>
      S().local().transferQueue.find((t) => t.toDeviceId === 'DEV-071' && t.payloadType === 'assessment_package');
    expect(findTask()!.status).toBe('blocked_offline');

    S().retryTransfer(findTask()!.id);
    expect(findTask()!.retries).toBe(1); // still offline → stays blocked
    expect(findTask()!.status).toBe('blocked_offline');

    S().cancelTransfer(findTask()!.id);
    expect(findTask()!.status).toBe('cancelled');
  });

  it('scanNetwork only discovers online same-school peers', () => {
    S().switchDevice('DEV-017');
    const { discovered } = S().scanNetwork();
    expect(discovered.length).toBeGreaterThan(0);
    for (const d of discovered) {
      expect(d.schoolId).toBe('sch-greenfield');
      expect(d.online).toBe(true);
      expect(d.id).not.toBe('DEV-017');
    }
  });
});

describe('ConflictService', () => {
  it('resolution records who/when/choice and the decision is audited', () => {
    S().switchDevice('DEV-043');
    S().login(ADMIN);
    const open = S().local().conflicts.filter((c) => c.status === 'open');
    expect(open.length).toBeGreaterThan(0);

    S().resolveConflict(open[0].id, 'a', 'keeping the source record');
    const resolved = S().local().conflicts.find((c) => c.id === open[0].id)!;
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution?.choice).toBe('a');
    expect(resolved.resolution?.resolvedBy).toBe('Mrs. Adaeze Okafor');
    // the audit event is written to both affected devices (not the resolver's)
    expect(
      S().world.locals[open[0].deviceAId].auditLog.some(
        (e) => e.action === 'conflict_resolved' && e.target === open[0].id
      )
    ).toBe(true);

    S().deferConflict(open[1].id);
    expect(S().local().conflicts.find((c) => c.id === open[1].id)!.status).toBe('deferred');
  });
});

describe('PracticeService', () => {
  it('runs a guest practice session with clamped navigation', () => {
    S().switchDevice('DEV-017');
    const qids = Object.keys(S().local().questions).slice(0, 3);
    S().startPractice(
      { subjectId: 'sub-math', level: 'SS2', topic: 'Any', difficulty: 'medium', count: 3, timed: false, durationMin: 10 },
      qids
    );
    expect(S().practice?.guestName).toMatch(/^Guest-/);

    S().savePracticeAnswer(qids[0], { selected: ['opt-1'] });
    expect(S().practice?.answers[qids[0]]?.state).toBe('answered');

    S().gotoPracticeQuestion(2);
    expect(S().practice?.currentIndex).toBe(2);
    S().gotoPracticeQuestion(99); // clamped to the last question
    expect(S().practice?.currentIndex).toBe(2);
    S().gotoPracticeQuestion(-5); // clamped to the first
    expect(S().practice?.currentIndex).toBe(0);

    S().finishPractice();
    expect(S().practice?.finishedAt).toBeDefined();
  });
});

describe('school & people administration', () => {
  it('updates the school profile through the service layer', () => {
    S().switchDevice('DEV-043');
    S().login(ADMIN);
    const school = S().world.schools['sch-greenfield'];
    S().updateSchoolProfile('sch-greenfield', { motto: 'Knowledge is light' });
    expect(S().world.schools['sch-greenfield'].motto).toBe('Knowledge is light');
    expect(S().world.schools['sch-greenfield'].name).toBe(school.name);
    expect(S().local().auditLog.some((e) => e.detail.includes('School profile updated'))).toBe(true);
  });

  it('creates a class locally and toggles user status', () => {
    S().switchDevice('DEV-043');
    S().login(ADMIN);
    S().createClass('sch-greenfield', 'SS1 C');
    expect(Object.values(S().world.classes).some((c) => c.name === 'SS1 C' && c.arm === 'C')).toBe(true);

    const target = Object.values(S().world.users).find((u) => u.role === 'teacher' && u.schoolId === 'sch-greenfield')!;
    S().setUserStatus(target.id, 'suspended');
    expect(S().world.users[target.id].status).toBe('suspended');
    S().setUserStatus(target.id, 'active');
    expect(S().world.users[target.id].status).toBe('active');
  });
});
