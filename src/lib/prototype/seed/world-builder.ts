/**
 * buildWorld() — constructs the entire simulated demo environment:
 *  - 2 schools (1 fully configured, 1 small for multi-school isolation demo)
 *  - 103 device identities (100 for Greenfield, 3 for Little Stars)
 *  - Per-device INDEPENDENT local state (records only propagate via sync)
 *  - Users for every role + 170 students + parents
 *  - Question banks, assessments in various lifecycle stages
 *  - A previous completed exam (results + analytics), a Biology mock in marking,
 *    and the fresh Math exam draft on DEV-017 for the guided scenario.
 */
import type {
  AcademicSession, Assessment, ClassRoom, ConflictCase, Department, Device, DeviceLocalState,
  ExamAttempt, ExamPackage, Question, RoleDefinition, School, SubmissionRecord, Subject, TopicNode, User,
} from '../types';
import type { DemoWorld } from '../world';
import { mulberry32, personName, hashCode } from './pools';
import { buildSeedQuestions } from './questions';

const NOW = new Date('2026-10-11T09:00:00');
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number, h = 10, m = 0) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return iso(d);
};
const daysAhead = (n: number, h = 10, m = 0) => daysAgo(-n, h, m);

export const MAIN_MATH_ASSESSMENT_ID = 'ASSESS-MATH-SS2-MIDTERM';
export const ENGLISH_CA_ID = 'ASSESS-ENG-SS2-CA1';
export const BIOLOGY_MOCK_ID = 'ASSESS-BIO-SS2-MOCK';

// ------------------------------------------------------------
// Static structures
// ------------------------------------------------------------

function buildSchools(): Record<string, School> {
  return {
    'sch-greenfield': {
      id: 'sch-greenfield',
      name: 'Greenfield Academy',
      shortName: 'GF Academy',
      type: 'combined',
      address: '14 Ahmadu Bello Way',
      city: 'Lagos',
      state: 'Lagos',
      phone: '+234 803 555 0100',
      email: 'office@greenfieldacademy.ng',
      motto: 'Knowledge • Character • Service',
      logoHue: 160,
      currentSession: '2025/2026',
      currentTerm: 1,
      plan: 'campus',
      announcement: 'Mid-term examinations begin Monday, 12th October. All SS2 students should confirm their device readiness with the exam office.',
      gradingScheme: [
        { grade: 'A', min: 75, max: 100, remark: 'Excellent' },
        { grade: 'B', min: 65, max: 74, remark: 'Very Good' },
        { grade: 'C', min: 50, max: 64, remark: 'Good' },
        { grade: 'D', min: 45, max: 49, remark: 'Pass' },
        { grade: 'E', min: 40, max: 44, remark: 'Weak Pass' },
        { grade: 'F', min: 0, max: 39, remark: 'Fail' },
      ],
    },
    'sch-littlestars': {
      id: 'sch-littlestars',
      name: 'Little Stars Primary School',
      shortName: 'Little Stars',
      type: 'primary',
      address: '5 Palm Grove Close',
      city: 'Ibadan',
      state: 'Oyo',
      phone: '+234 802 555 0450',
      email: 'admin@littlestars.sch.ng',
      motto: 'Little steps, giant leaps',
      logoHue: 30,
      currentSession: '2025/2026',
      currentTerm: 1,
      plan: 'starter',
      announcement: 'Welcome back for the new session!',
      gradingScheme: [
        { grade: 'Excellent', min: 80, max: 100, remark: 'Outstanding' },
        { grade: 'Good', min: 60, max: 79, remark: 'Satisfactory' },
        { grade: 'Needs Support', min: 0, max: 59, remark: 'Keep practising' },
      ],
    },
  };
}

function buildAcademicSessions(): AcademicSession[] {
  return [
    {
      id: 'sess-2024-25', name: '2024/2025', startDate: '2024-09-09', endDate: '2025-07-25', status: 'completed',
      terms: [
        { term: 1, label: 'First Term', start: '2024-09-09', end: '2024-12-13', status: 'completed' },
        { term: 2, label: 'Second Term', start: '2025-01-06', end: '2025-04-04', status: 'completed' },
        { term: 3, label: 'Third Term', start: '2025-04-28', end: '2025-07-25', status: 'completed' },
      ],
    },
    {
      id: 'sess-2025-26', name: '2025/2026', startDate: '2025-09-08', endDate: '2026-07-24', status: 'active',
      terms: [
        { term: 1, label: 'First Term', start: '2025-09-08', end: '2025-12-12', status: 'completed' },
        { term: 2, label: 'Second Term', start: '2026-01-05', end: '2026-04-03', status: 'completed' },
        { term: 3, label: 'Third Term', start: '2026-04-27', end: '2026-07-24', status: 'active' },
      ],
    },
    {
      id: 'sess-2026-27', name: '2026/2027', startDate: '2026-09-14', endDate: '2027-07-30', status: 'planned',
      terms: [
        { term: 1, label: 'First Term', start: '2026-09-14', end: '2026-12-11', status: 'planned' },
        { term: 2, label: 'Second Term', start: '2027-01-11', end: '2027-04-09', status: 'planned' },
        { term: 3, label: 'Third Term', start: '2027-05-03', end: '2027-07-30', status: 'planned' },
      ],
    },
  ];
}

function buildClasses(): Record<string, ClassRoom> {
  const out: Record<string, ClassRoom> = {};
  const defs: [string, string, string, ClassRoom['category'], number][] = [
    ['cls-ss2a', 'SS2 A', 'SS2', 'senior_secondary', 30],
    ['cls-ss2b', 'SS2 B', 'SS2', 'senior_secondary', 30],
    ['cls-ss2c', 'SS2 C', 'SS2', 'senior_secondary', 25],
    ['cls-ss2d', 'SS2 D', 'SS2', 'senior_secondary', 15],
    ['cls-jss3a', 'JSS3 A', 'JSS3', 'junior_secondary', 25],
    ['cls-jss3b', 'JSS3 B', 'JSS3', 'junior_secondary', 20],
    ['cls-jss1a', 'JSS1 A', 'JSS1', 'junior_secondary', 15],
    ['cls-pry6', 'Primary 6', 'PRY6', 'primary', 10],
  ];
  defs.forEach(([id, name, level, category, capacity]) => {
    out[id] = { id, name, level, arm: name.split(' ')[1], category, capacity };
  });
  return out;
}

function buildDepartments(): Department[] {
  return [
    { id: 'dep-sci', name: 'Science', headId: 'u-hod-grace' },
    { id: 'dep-lang', name: 'Languages', headId: 'u-teacher-eng' },
    { id: 'dep-mst', name: 'Mathematics & ICT' },
    { id: 'dep-hum', name: 'Humanities' },
  ];
}

function buildSubjects(): Record<string, Subject> {
  const list: Subject[] = [
    { id: 'sub-math', name: 'Mathematics', code: 'MTH', departmentId: 'dep-mst', levelCategory: 'all' },
    { id: 'sub-eng', name: 'English Language', code: 'ENG', departmentId: 'dep-lang', levelCategory: 'all' },
    { id: 'sub-bio', name: 'Biology', code: 'BIO', departmentId: 'dep-sci', levelCategory: 'senior_secondary' },
    { id: 'sub-phy', name: 'Physics', code: 'PHY', departmentId: 'dep-sci', levelCategory: 'senior_secondary' },
    { id: 'sub-chem', name: 'Chemistry', code: 'CHM', departmentId: 'dep-sci', levelCategory: 'senior_secondary' },
    { id: 'sub-bas', name: 'Basic Science', code: 'BSC', departmentId: 'dep-sci', levelCategory: 'junior_secondary' },
    { id: 'sub-lit', name: 'Literature-in-English', code: 'LIT', departmentId: 'dep-lang', levelCategory: 'senior_secondary' },
    { id: 'sub-civic', name: 'Civic Education', code: 'CIV', departmentId: 'dep-hum', levelCategory: 'all' },
    { id: 'sub-ict', name: 'Computer Studies', code: 'ICT', departmentId: 'dep-mst', levelCategory: 'all' },
    { id: 'sub-yor', name: 'Yoruba', code: 'YOR', departmentId: 'dep-lang', levelCategory: 'all' },
    { id: 'sub-num', name: 'Numeracy', code: 'NUM', departmentId: 'dep-mst', levelCategory: 'primary' },
    { id: 'sub-lit-eng', name: 'Literacy (English)', code: 'LIT-P', departmentId: 'dep-lang', levelCategory: 'primary' },
  ];
  return Object.fromEntries(list.map((s) => [s.id, s]));
}

function buildTopics(): TopicNode[] {
  return [
    { id: 'top-math-alg', subjectId: 'sub-math', name: 'Algebraic Fractions', subtopics: ['Simplification', 'Operations', 'Equations'] },
    { id: 'top-math-idx', subjectId: 'sub-math', name: 'Indices and Logarithms', subtopics: ['Laws of indices', 'Logarithms', 'Equations with indices'] },
    { id: 'top-math-surds', subjectId: 'sub-math', name: 'Surds', subtopics: ['Rationalisation', 'Simplification'] },
    { id: 'top-math-circ', subjectId: 'sub-math', name: 'Circle Geometry', subtopics: ['Chords and angles', 'Arcs and sectors', 'Theorems'] },
    { id: 'top-math-stat', subjectId: 'sub-math', name: 'Statistics', subtopics: ['Averages', 'Data collection', 'Charts'] },
    { id: 'top-math-seq', subjectId: 'sub-math', name: 'Sequences and Series', subtopics: ['AP', 'GP', 'Quadratic sequences'] },
    { id: 'top-math-word', subjectId: 'sub-math', name: 'Word Problems', subtopics: ['Age problems', 'Money', 'Rates'] },
    { id: 'top-math-quad', subjectId: 'sub-math', name: 'Quadratic Equations', subtopics: ['Factorisation', 'Completing the square', 'Formula'] },
    { id: 'top-eng-comp', subjectId: 'sub-eng', name: 'Comprehension', subtopics: ['Inference', 'Main idea', 'Vocabulary in context'] },
    { id: 'top-eng-lex', subjectId: 'sub-eng', name: 'Lexis and Structure', subtopics: ['Antonyms', 'Concord', 'Phrasal verbs'] },
    { id: 'top-eng-essay', subjectId: 'sub-eng', name: 'Essay Writing', subtopics: ['Argumentative', 'Narrative', 'Expository'] },
    { id: 'top-bio-res', subjectId: 'sub-bio', name: 'Respiratory System', subtopics: ['Human respiration', 'Gaseous exchange'] },
    { id: 'top-bio-exc', subjectId: 'sub-bio', name: 'Excretion', subtopics: ['Kidney', 'Skin', 'Liver'] },
    { id: 'top-bio-eco', subjectId: 'sub-bio', name: 'Ecology', subtopics: ['Food chains', 'Habitats', 'Energy flow'] },
    { id: 'top-phy-newton', subjectId: 'sub-phy', name: 'Newton\u2019s Laws', subtopics: ['Second law', 'Momentum', 'Inertia'] },
    { id: 'top-phy-heat', subjectId: 'sub-phy', name: 'Heat Energy', subtopics: ['Specific heat capacity', 'Expansion', 'Transfer'] },
    { id: 'top-bas-matter', subjectId: 'sub-bas', name: 'Matter', subtopics: ['States of matter', 'Changes of state'] },
    { id: 'top-bas-solar', subjectId: 'sub-bas', name: 'The Solar System', subtopics: ['Planets', 'Earth and moon'] },
  ];
}

function buildRoleDefinitions(): RoleDefinition[] {
  const P = (...keys: string[]) => keys as RoleDefinition['permissions'];
  return [
    { id: 'role-proprietor', name: 'Proprietor / Owner', description: 'Full ownership access including billing and licence management.', system: true, memberCount: 1, permissions: P('school.manage', 'academic.manage', 'users.manage', 'roles.manage', 'questions.view', 'assessments.view', 'results.view_school', 'analytics.view', 'devices.view', 'licence.manage', 'audit.view', 'settings.manage') },
    { id: 'role-admin', name: 'Administrator', description: 'Runs the school day-to-day: users, approvals, distribution, results.', system: true, memberCount: 2, permissions: P('school.manage', 'academic.manage', 'users.manage', 'roles.manage', 'questions.view', 'questions.approve', 'assessments.view', 'assessments.approve', 'assessments.publish', 'exams.monitor', 'results.view_school', 'results.mark', 'results.approve_release', 'analytics.view', 'devices.view', 'devices.pair', 'sync.distribute', 'sync.collect', 'conflicts.resolve', 'licence.manage', 'updates.manage', 'backups.manage', 'settings.manage', 'audit.view') },
    { id: 'role-exoff', name: 'Examination Officer', description: 'Plans exams, monitors sessions, prepares distribution and collection.', system: true, memberCount: 1, permissions: P('questions.view', 'assessments.view', 'assessments.approve', 'exams.monitor', 'results.view_school', 'results.mark', 'analytics.view', 'devices.view', 'sync.distribute', 'sync.collect', 'audit.view') },
    { id: 'role-hod', name: 'Head of Department', description: 'Reviews departmental questions and assessments, views analytics.', system: true, memberCount: 1, permissions: P('questions.view', 'questions.approve', 'assessments.view', 'exams.monitor', 'results.view_school', 'results.mark', 'analytics.view') },
    { id: 'role-teacher', name: 'Teacher', description: 'Creates questions and assessments, marks essays, views own classes.', system: true, memberCount: 4, permissions: P('questions.view', 'questions.create', 'ai.use', 'assessments.view', 'assessments.create', 'exams.monitor', 'results.mark', 'analytics.view', 'sync.run') },
    { id: 'role-invigilator', name: 'Invigilator', description: 'Supervises live examination sessions and logs incidents.', system: true, memberCount: 2, permissions: P('exams.invigilate', 'results.view_school') },
    { id: 'role-student', name: 'Student', description: 'Takes examinations and practice, views own results only.', system: true, memberCount: 170, permissions: P('exams.take', 'results.view_own') },
    { id: 'role-parent', name: 'Parent / Guardian', description: 'Views linked students\u2019 released results and progress.', system: true, memberCount: 31, permissions: P('results.view_own') },
    { id: 'role-support', name: 'Technical Support Admin', description: 'Maintains devices, network, updates and diagnostics.', system: true, memberCount: 1, permissions: P('devices.view', 'devices.pair', 'updates.manage', 'backups.manage', 'settings.manage', 'audit.view', 'school.manage') },
  ];
}

// ------------------------------------------------------------
// Devices
// ------------------------------------------------------------

export const KEY_DEVICES = {
  proprietor: 'DEV-001',
  exoff: 'DEV-005',
  adminCollect: 'DEV-008',
  teacherEng: 'DEV-011',
  teacherMath: 'DEV-017',
  hod: 'DEV-022',
  teacherBio: 'DEV-024',
  teacherPhy: 'DEV-026',
  adminMain: 'DEV-043',
  labStart: 61,
  labEnd: 100,
  invig: 'DEV-090',
  offlineDuringDistribution: 'DEV-092',
  pendingA: 'DEV-055',
  pendingB: 'DEV-078',
  pendingC: 'DEV-034',
  collectOffline1: 'DEV-034',
  collectOffline2: 'DEV-071',
  collectOffline3: 'DEV-089',
} as const;

const OFFLINE_DEVICE_SET = new Set<number>([
  12, 19, 27, 34, 41, 48, 55, 62, 71, 78, 85, 89, 92, 96,
]);

function buildDevices(): Record<string, Device> {
  const devices: Record<string, Device> = {};
  for (let i = 1; i <= 100; i++) {
    const id = `DEV-${String(i).padStart(3, '0')}`;
    const online = !OFFLINE_DEVICE_SET.has(i);
    let name: string;
    if (i <= 3) name = `GF-ADMIN-PC${String(i).padStart(2, '0')}`;
    else if (i <= 20) name = `GF-STAFF-PC${String(i - 3).padStart(2, '0')}`;
    else if (i <= 60) name = `GF-LAB1-PC${String(i - 20).padStart(2, '0')}`;
    else name = `GF-LAB2-PC${String(i - 60).padStart(2, '0')}`;
    devices[id] = {
      id,
      index: i,
      name,
      ip: `192.168.8.${100 + i}`,
      port: 47810 + (i % 40),
      os: i % 7 === 0 ? 'macos' : 'windows',
      appVersion: i % 11 === 0 ? '1.3.2' : '1.4.0',
      schoolId: 'sch-greenfield',
      paired: i <= 92,
      online,
      lastSeen: online ? daysAgo(0, 8, 15 + i) : daysAgo(i % 5 + 1, 16, 0),
      storageUsedMb: 180 + ((i * 37) % 2600),
      storageTotalMb: 8192,
      dbHealth: i === 71 ? 'warning' : 'healthy',
      trusted: i <= 92,
      note: i === 71 ? 'Disk space low — cleanup recommended' : undefined,
    };
  }
  // Little Stars devices
  ['DEV-101', 'DEV-102', 'DEV-103'].forEach((id, ix) => {
    devices[id] = {
      id,
      index: 101 + ix,
      name: `LS-OFFICE-PC${ix + 1}`,
      ip: `192.168.20.${10 + ix}`,
      port: 47810,
      os: ix === 2 ? 'macos' : 'windows',
      appVersion: '1.4.0',
      schoolId: 'sch-littlestars',
      paired: true,
      online: ix !== 2,
      lastSeen: daysAgo(0, 8, 30),
      storageUsedMb: 240 + ix * 90,
      storageTotalMb: 4096,
      dbHealth: 'healthy',
      trusted: true,
    };
  });
  return devices;
}

function emptyLocal(deviceId: string): DeviceLocalState {
  return {
    deviceId,
    questions: {},
    assessments: {},
    versions: {},
    examPackages: {},
    attempts: [],
    submissions: [],
    approvalRequests: [],
    transferQueue: [],
    syncHistory: [],
    notifications: [],
    auditLog: [],
    backups: [],
    browserSessions: [],
    conflicts: [],
    updateState: {
      currentVersion: '1.4.0',
      autoUpdate: false,
      history: [
        { version: '1.4.0', at: daysAgo(14), status: 'installed', note: 'Imported offline package, installed successfully.' },
        { version: '1.3.2', at: daysAgo(45), status: 'installed', note: 'LAN distribution from DEV-001.' },
      ],
    },
    syncCheckpoint: daysAgo(0, 7, 45),
    lastSyncAt: daysAgo(0, 7, 45),
  };
}

// ------------------------------------------------------------
// Users
// ------------------------------------------------------------

interface StudentSeed { id: string; name: string; classId: string; hue: number; admissionNo: string }

function buildStudents(): StudentSeed[] {
  const rnd = mulberry32(20261011);
  const students: StudentSeed[] = [];
  const classPlan: [string, number, string][] = [
    ['cls-ss2a', 30, 'GA/SS2A'], ['cls-ss2b', 30, 'GA/SS2B'], ['cls-ss2c', 25, 'GA/SS2C'], ['cls-ss2d', 15, 'GA/SS2D'],
    ['cls-jss3a', 25, 'GA/JSS3A'], ['cls-jss3b', 20, 'GA/JSS3B'], ['cls-jss1a', 15, 'GA/JSS1A'], ['cls-pry6', 10, 'GA/PRY6'],
  ];
  const used = new Set<string>();
  for (const [classId, count, prefix] of classPlan) {
    for (let i = 0; i < count; i++) {
      let full = '';
      let tries = 0;
      do {
        full = personName(rnd).full;
        tries++;
      } while (used.has(full) && tries < 40);
      used.add(full);
      students.push({
        id: `stu-${prefix}-${String(i + 1).padStart(2, '0')}`,
        name: full,
        classId,
        hue: Math.floor(rnd() * 360),
        admissionNo: `${prefix}/${String(i + 1).padStart(3, '0')}`,
      });
    }
  }
  // Give the demo student a fixed identity
  const demo = students[0];
  demo.id = 'stu-amina';
  demo.name = 'Amina Yusuf';
  return students;
}

function buildUsers(students: StudentSeed[]): Record<string, User> {
  const users: Record<string, User> = {};
  const mk = (id: string, name: string, email: string, role: User['role'], hue: number, extra: Partial<User> = {}): User => {
    const u: User = {
      id, name, email, role, schoolId: 'sch-greenfield', status: 'active',
      avatarHue: hue, createdAt: daysAgo(200), lastLoginAt: daysAgo(0, 7, 40), ...extra,
    };
    users[id] = u;
    return u;
  };
  mk('u-proprietor', 'Dr. Benjamin Adeyemi', 'proprietor@greenfieldacademy.ng', 'proprietor', 210, { demoLabel: 'Proprietor', phone: '+234 803 111 0001' });
  mk('u-admin', 'Mrs. Adaeze Okafor', 'a.okafor@greenfieldacademy.ng', 'administrator', 320, { demoLabel: 'Administrator (main)', phone: '+234 803 111 0002' });
  mk('u-admin2', 'Mr. Tunde Olawale', 't.olawale@greenfieldacademy.ng', 'administrator', 130, { demoLabel: 'Administrator (2nd)', phone: '+234 803 111 0003' });
  mk('u-exoff', 'Mr. Chukwuemeka Nwosu', 'c.nwosu@greenfieldacademy.ng', 'exam_officer', 20, { demoLabel: 'Examination Officer', phone: '+234 803 111 0004' });
  mk('u-hod-grace', 'Dr. Grace Ade', 'g.ade@greenfieldacademy.ng', 'hod', 280, { demoLabel: 'Head of Department', departmentId: 'dep-sci' });
  mk('u-teacher-math', 'Mr. Daniel Ibrahim', 'd.ibrahim@greenfieldacademy.ng', 'teacher', 160, { demoLabel: 'Teacher (Mathematics)', subjectIds: ['sub-math'], departmentId: 'dep-mst' });
  mk('u-teacher-eng', 'Mrs. Fatima Bello', 'f.bello@greenfieldacademy.ng', 'teacher', 340, { demoLabel: 'Teacher (English)', subjectIds: ['sub-eng', 'sub-lit'], departmentId: 'dep-lang' });
  mk('u-teacher-bio', 'Mrs. Ngozi Umeh', 'n.umeh@greenfieldacademy.ng', 'teacher', 100, { subjectIds: ['sub-bio'], departmentId: 'dep-sci' });
  mk('u-teacher-phy', 'Mr. Ibrahim Musa', 'i.musa@greenfieldacademy.ng', 'teacher', 200, { subjectIds: ['sub-phy'], departmentId: 'dep-sci' });
  mk('u-invig', 'Mr. Henry Osaze', 'h.osaze@greenfieldacademy.ng', 'invigilator', 60, { demoLabel: 'Invigilator', phone: '+234 803 111 0005' });
  mk('u-invig2', 'Mrs. Laraba Tanko', 'l.tanko@greenfieldacademy.ng', 'invigilator', 30, {});
  mk('u-support', 'Sam Igbinedion', 'support@greenfieldacademy.ng', 'support', 240, { demoLabel: 'Technical Support' });
  // students
  students.forEach((s) => {
    users[s.id] = {
      id: s.id, name: s.name, email: `${s.admissionNo.replace(/\//g, '').toLowerCase()}@student.greenfieldacademy.ng`,
      role: 'student', schoolId: 'sch-greenfield', status: 'active', classId: s.classId, admissionNo: s.admissionNo,
      avatarHue: s.hue, createdAt: daysAgo(120),
    };
  });
  // demo student overrides
  users['stu-amina'].demoLabel = 'Student (Amina)';
  users['stu-amina'].email = 'amina.yusuf@student.greenfieldacademy.ng';
  // parents
  const aminaClass = 'cls-ss2a';
  const parentIds: string[] = [];
  students.filter((s) => s.classId === aminaClass).slice(0, 30).forEach((s, ix) => {
    const pid = `par-${ix + 1}`;
    parentIds.push(pid);
    const nm = s.name;
    users[pid] = {
      id: pid,
      name: ix === 0 ? 'Mrs. Kemi Adeleke' : `${['Mr.', 'Mrs.', 'Dr.', 'Alhaji', 'Chief'][ix % 5]} ${nm.split(' ')[1]}`,
      email: `parent${ix + 1}@mail.ng`,
      role: 'parent', schoolId: 'sch-greenfield', status: 'active',
      childrenIds: [s.id], avatarHue: (ix * 47) % 360, createdAt: daysAgo(90),
    };
  });
  users['par-1'].demoLabel = 'Parent (Kemi Adeleke)';
  users['par-1'].email = 'kemi.adeleke@mail.ng';
  // suspend one user to demo states
  users['par-9'].status = 'suspended';
  // Little Stars users
  users['u-ls-admin'] = { id: 'u-ls-admin', name: 'Mrs. Bolanle Ojo', email: 'b.ojo@littlestars.sch.ng', role: 'administrator', schoolId: 'sch-littlestars', status: 'active', avatarHue: 30, createdAt: daysAgo(60) };
  users['u-ls-teacher'] = { id: 'u-ls-teacher', name: 'Mr. Kunle Adisa', email: 'k.adisa@littlestars.sch.ng', role: 'teacher', schoolId: 'sch-littlestars', status: 'active', subjectIds: ['sub-num', 'sub-lit-eng'], avatarHue: 90, createdAt: daysAgo(60) };
  students.filter((s) => s.classId === 'cls-pry6').forEach((s, ix) => {
    users[`stu-ls-${ix + 1}`] = {
      id: `stu-ls-${ix + 1}`, name: s.name, email: `ls${ix + 1}@student.littlestars.ng`, role: 'student',
      schoolId: 'sch-littlestars', status: 'active', classId: 'cls-pry6', admissionNo: `LS/00${ix + 1}`,
      avatarHue: (ix * 80) % 360, createdAt: daysAgo(50),
    };
  });
  return users;
}

// ------------------------------------------------------------
// Assessments
// ------------------------------------------------------------

function buildEnglishCA(questions: Question[]): Assessment {
  const qIds = questions.filter((q) => q.subjectId === 'sub-eng' && q.level === 'SS2').map((q) => q.id);
  const objQs = qIds.slice(0, 3);
  return {
    id: ENGLISH_CA_ID,
    schoolId: 'sch-greenfield',
    name: 'SS2 English Language — 1st CA',
    description: 'First continuous assessment for SS2 English Language.',
    instructions: 'Answer ALL questions. For the essay, write at least 450 words. Marks are shown against each question.',
    subjectId: 'sub-eng',
    classIds: ['cls-ss2a', 'cls-ss2b', 'cls-ss2c', 'cls-ss2d'],
    type: 'continuous_assessment',
    access: 'controlled',
    startAt: daysAgo(18, 8, 30),
    endAt: daysAgo(16, 15, 0),
    durationMin: 60,
    totalMarks: 20,
    passMark: 10,
    attemptsAllowed: 1,
    questionIds: qIds,
    sections: [
      { id: 'sec-a', name: 'Section A — Objective', instruction: 'Choose the correct option.', questionIds: objQs },
      { id: 'sec-b', name: 'Section B — Essay', instruction: 'Write on ONE question.', questionIds: qIds.filter((q) => !objQs.includes(q)) },
    ],
    randomizeQuestions: false,
    randomizeOptions: false,
    status: 'results_released',
    version: 2,
    approvedVersion: 1,
    approvedBy: 'u-admin',
    approvedByName: 'Mrs. Adaeze Okafor',
    approvedAt: daysAgo(19, 14, 0),
    createdBy: 'u-teacher-eng',
    createdByName: 'Mrs. Fatima Bello',
    createdOnDevice: KEY_DEVICES.teacherEng,
    createdAt: daysAgo(21, 9, 0),
    updatedAt: daysAgo(16, 12, 0),
    resultVisibility: 'after_release',
    feedbackPolicy: 'correct_incorrect',
    submissionMode: 'collected',
  };
}

function buildBiologyMock(questions: Question[]): Assessment {
  const qIds = questions.filter((q) => q.subjectId === 'sub-bio').map((q) => q.id);
  return {
    id: BIOLOGY_MOCK_ID,
    schoolId: 'sch-greenfield',
    name: 'SS2 Biology — Mock Examination',
    description: 'Mock WAEC-style examination for SS2 Biology.',
    instructions: 'Answer all objective questions and both theory questions.',
    subjectId: 'sub-bio',
    classIds: ['cls-ss2a', 'cls-ss2b', 'cls-ss2c', 'cls-ss2d'],
    type: 'mock_exam',
    access: 'controlled',
    startAt: daysAgo(4, 9, 0),
    endAt: daysAgo(2, 15, 0),
    durationMin: 90,
    totalMarks: 12,
    passMark: 6,
    attemptsAllowed: 1,
    questionIds: qIds,
    sections: [{ id: 'sec-a', name: 'Section A — Objectives', questionIds: qIds }],
    randomizeQuestions: true,
    randomizeOptions: false,
    status: 'marking',
    version: 1,
    approvedVersion: 1,
    approvedBy: 'u-exoff',
    approvedByName: 'Mr. Chukwuemeka Nwosu',
    approvedAt: daysAgo(6, 11, 0),
    createdBy: 'u-teacher-bio',
    createdByName: 'Mrs. Ngozi Umeh',
    createdOnDevice: KEY_DEVICES.teacherBio,
    createdAt: daysAgo(8, 10, 0),
    updatedAt: daysAgo(2, 15, 30),
    resultVisibility: 'after_approval',
    feedbackPolicy: 'full_solutions',
    submissionMode: 'collected',
  };
}

function buildMathDraft(questions: Question[]): Assessment {
  const qIds = questions.filter((q) => q.subjectId === 'sub-math' && q.level === 'SS2').map((q) => q.id);
  const obj = qIds.filter((id) => {
    const q = questions.find((x) => x.id === id)!;
    return q.type !== 'essay';
  });
  const essays = qIds.filter((id) => !obj.includes(id));
  return {
    id: MAIN_MATH_ASSESSMENT_ID,
    schoolId: 'sch-greenfield',
    name: 'SS2 Mathematics — Mid-Term Examination',
    description: 'Mid-term examination covering algebraic fractions, indices, surds, circle geometry, sequences and statistics.',
    instructions: 'Answer ALL questions in Section A. Attempt the essay question in Section B. Show all workings for full marks.',
    subjectId: 'sub-math',
    classIds: ['cls-ss2a', 'cls-ss2b', 'cls-ss2c', 'cls-ss2d'],
    type: 'end_of_term_exam',
    access: 'controlled',
    startAt: daysAhead(1, 8, 30),
    endAt: daysAhead(5, 15, 0),
    durationMin: 45,
    totalMarks: 25,
    passMark: 13,
    attemptsAllowed: 1,
    questionIds: qIds,
    sections: [
      { id: 'sec-a', name: 'Section A — Objective', instruction: 'Answer all questions. Each question carries its shown marks.', questionIds: obj },
      { id: 'sec-b', name: 'Section B — Theory', instruction: 'Show all workings.', questionIds: essays },
    ],
    randomizeQuestions: true,
    randomizeOptions: true,
    status: 'draft',
    version: 1,
    createdBy: 'u-teacher-math',
    createdByName: 'Mr. Daniel Ibrahim',
    createdOnDevice: KEY_DEVICES.teacherMath,
    createdAt: daysAgo(1, 15, 20),
    updatedAt: daysAgo(0, 8, 5),
    resultVisibility: 'after_release',
    feedbackPolicy: 'correct_incorrect',
    submissionMode: 'collected',
  };
}

function buildPublicPractice(questions: Question[]): Assessment[] {
  const mathQs = questions.filter((q) => q.subjectId === 'sub-math').map((q) => q.id);
  const basQs = questions.filter((q) => q.subjectId === 'sub-bas').map((q) => q.id);
  return [
    {
      id: 'ASSESS-PUB-MATH-PRACTICE',
      schoolId: 'sch-greenfield',
      name: 'Public Practice — Mathematics Challenge',
      description: 'A free public practice set for Mathematics (SS2 level). No sign-in required.',
      instructions: 'Choose your answers and receive instant feedback. Nothing here affects school records.',
      subjectId: 'sub-math',
      classIds: [],
      type: 'public_practice',
      access: 'public',
      startAt: daysAgo(30),
      endAt: daysAhead(300),
      durationMin: 20,
      totalMarks: mathQs.length * 2,
      passMark: 0,
      attemptsAllowed: 99,
      questionIds: mathQs,
      sections: [{ id: 'sec-a', name: 'Practice Questions', questionIds: mathQs }],
      randomizeQuestions: true,
      randomizeOptions: true,
      status: 'results_released',
      version: 1,
      createdBy: 'u-admin',
      createdByName: 'Mrs. Adaeze Okafor',
      createdOnDevice: KEY_DEVICES.adminMain,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
      resultVisibility: 'immediate',
      feedbackPolicy: 'full_solutions',
      submissionMode: 'auto_sync',
    },
    {
      id: 'ASSESS-PUB-BAS-PRACTICE',
      schoolId: 'sch-greenfield',
      name: 'Public Practice — Basic Science Quiz',
      description: 'A fun Basic Science quiz for JSS students. Practice without an account.',
      instructions: 'Answer the questions and get instant feedback.',
      subjectId: 'sub-bas',
      classIds: [],
      type: 'public_practice',
      access: 'public',
      startAt: daysAgo(30),
      endAt: daysAhead(300),
      durationMin: 15,
      totalMarks: basQs.length * 1,
      passMark: 0,
      attemptsAllowed: 99,
      questionIds: basQs,
      sections: [{ id: 'sec-a', name: 'Quiz', questionIds: basQs }],
      randomizeQuestions: true,
      randomizeOptions: true,
      status: 'results_released',
      version: 1,
      createdBy: 'u-teacher-bio',
      createdByName: 'Mrs. Ngozi Umeh',
      createdOnDevice: KEY_DEVICES.teacherBio,
      createdAt: daysAgo(25),
      updatedAt: daysAgo(25),
      resultVisibility: 'immediate',
      feedbackPolicy: 'full_solutions',
      submissionMode: 'auto_sync',
    },
  ];
}

// ------------------------------------------------------------
// Attempts / submissions for prior exams
// ------------------------------------------------------------

function hashOf(s: string): string {
  return `sha256:${hashCode(s).toString(16).padStart(8, '0')}${hashCode(s + 'x').toString(16).padStart(8, '0')}`;
}

interface PriorExamSpec {
  assessment: Assessment;
  students: StudentSeed[];
  devicePool: string[];
  submittedCount: number; // how many students have submitted
  fullAnswerCount: number; // how many get full per-question answers
  released: boolean;
}

function buildAttempts(spec: PriorExamSpec): { attemptsByDevice: Record<string, ExamAttempt[]>; submissionsByDevice: Record<string, SubmissionRecord[]> } {
  const rnd = mulberry32(hashCode(spec.assessment.id));
  const attemptsByDevice: Record<string, ExamAttempt[]> = {};
  const submissionsByDevice: Record<string, SubmissionRecord[]> = {};
  const classLabel = (classId: string) => {
    const core = classId.replace('cls-', ''); // e.g. ss2a
    const m = core.match(/^(ss|jss|pry)(\d)([a-d])$/i);
    if (m) return `${m[1].toUpperCase()}${m[2]} ${m[3].toUpperCase()}`;
    return core.toUpperCase();
  };
  spec.students.forEach((stu, ix) => {
    const device = spec.devicePool[ix % spec.devicePool.length];
    const submitted = ix < spec.submittedCount;
    const isFull = ix < spec.fullAnswerCount;
    const objectiveQs = spec.assessment.questionIds.filter((qid) => {
      const q = questionsLookup[qid];
      return q && q.type !== 'essay';
    });
    const essayQs = spec.assessment.questionIds.filter((qid) => !objectiveQs.includes(qid));
    const answers: ExamAttempt['answers'] = {};
    let autoScore = 0;
    if (isFull) {
      objectiveQs.forEach((qid) => {
        const q = questionsLookup[qid];
        const correctChance = 0.45 + rnd() * 0.5;
        const ok = rnd() < correctChance;
        const selected = q.options ? [ok ? q.correct[Math.floor(rnd() * q.correct.length)] ?? q.options[0].id : q.options[Math.floor(rnd() * q.options.length)].id] : undefined;
        const marks = ok ? q.marks : q.type === 'multi_choice' ? Math.floor(rnd() * q.marks) : 0;
        answers[qid] = { questionId: qid, state: selected || q.type === 'essay' ? 'answered' : 'unanswered', selected, autoCorrect: ok, autoMarks: marks, timeSpentSec: Math.floor(q.estimatedTimeSec * (0.5 + rnd())) };
        autoScore += marks;
      });
      essayQs.forEach((qid) => {
        const q = questionsLookup[qid];
        answers[qid] = { questionId: qid, state: 'answered', text: 'Student response drafted on device (representative answer kept for review).', timeSpentSec: q.estimatedTimeSec };
      });
    }
    if (!submitted) autoScore = 0;
    const attempt: ExamAttempt = {
      id: `ATT-${spec.assessment.id}-${String(ix + 1).padStart(3, '0')}`,
      assessmentId: spec.assessment.id,
      assessmentVersion: spec.assessment.approvedVersion ?? 1,
      assessmentName: spec.assessment.name,
      studentId: stu.id,
      studentName: stu.name,
      classId: stu.classId,
      className: classLabel(stu.classId),
      deviceId: device,
      startedAt: daysAgo(spec.released ? 17 : 3, 9, 15 + (ix % 40)),
      submittedAt: submitted ? daysAgo(spec.released ? 17 : 3, 10, 5 + (ix % 50)) : undefined,
      durationUsedSec: submitted ? spec.assessment.durationMin * 60 * (0.55 + rnd() * 0.4) : undefined,
      status: !submitted ? 'in_progress' : spec.released ? 'published' : 'marked',
      answers,
      autoScore,
      manualScore: 0,
      totalMarks: spec.assessment.totalMarks,
      percentage: submitted ? Math.round((autoScore / spec.assessment.totalMarks) * 1000) / 10 : undefined,
      syncState: submitted ? 'synced' : 'local_only',
      essayQuestionIds: essayQs,
    };
    (attemptsByDevice[device] ||= []).push(attempt);
    if (submitted) {
      const sub: SubmissionRecord = {
        id: `SUB-${spec.assessment.id}-${String(ix + 1).padStart(3, '0')}`,
        attemptId: attempt.id,
        assessmentId: spec.assessment.id,
        studentId: stu.id,
        studentName: stu.name,
        classId: stu.classId,
        score: autoScore,
        totalMarks: spec.assessment.totalMarks,
        receivedFromDeviceId: device,
        receivedAt: daysAgo(spec.released ? 16 : 2, 11, (ix % 55)),
        contentHash: hashOf(attempt.id + stu.id),
        verified: true,
      };
      (submissionsByDevice[device] ||= []).push(sub);
    }
  });
  return { attemptsByDevice, submissionsByDevice };
}

// lookup used while building attempts
let questionsLookup: Record<string, Question> = {};

// ------------------------------------------------------------
// Conflicts
// ------------------------------------------------------------

function buildConflicts(): ConflictCase[] {
  return [
    {
      id: 'CONF-001', type: 'question_edited_both_sides',
      title: 'Question edited on two computers — "Epiglottis" (Biology)',
      description: 'Mrs. Ngozi Umeh edited this question on DEV-024 while Mr. Chukwuemeka Nwosu approved a wording fix on DEV-005. Both edits happened offline and both devices now hold different revisions.',
      affectedRecord: 'Q-1016 (Biology — Respiratory System)', recordKind: 'question',
      deviceAId: KEY_DEVICES.teacherBio, deviceBId: KEY_DEVICES.exoff,
      userA: 'Mrs. Ngozi Umeh', userB: 'Mr. Chukwuemeka Nwosu',
      detectedAt: daysAgo(1, 14, 22), status: 'open',
      suggestedResolution: 'Keep the newer revision (DEV-024) but review the wording change from DEV-005 before deciding.',
      versionA: { label: 'Version 3 — DEV-024', summary: 'Edited 2 days ago: replaced option (c) "Oesophagus" with "Bronchus" and updated explanation.', fields: [{ field: 'Statement', value: 'Which structure prevents food from entering the trachea during swallowing?' }, { field: 'Option C', value: 'Bronchus' }, { field: 'Marks', value: '2' }] },
      versionB: { label: 'Version 2 — DEV-005', summary: 'Edited 3 days ago: corrected the explanation to mention the epiglottis reflex.', fields: [{ field: 'Statement', value: 'Which structure prevents food from entering the trachea during swallowing?' }, { field: 'Option C', value: 'Oesophagus' }, { field: 'Explanation', value: 'The epiglottis folds over the trachea during swallowing (reflex action).' }] },
    },
    {
      id: 'CONF-002', type: 'assessment_revision_divergence',
      title: 'Draft assessment diverged — "JSS3 Basic Science Test 2"',
      description: 'Two revisions of the same draft exist on different computers because the draft was edited offline on both before any sync.',
      affectedRecord: 'ASSESS-BAS-JSS3-T2 (draft v2/v3)', recordKind: 'assessment',
      deviceAId: KEY_DEVICES.teacherPhy, deviceBId: KEY_DEVICES.hod,
      userA: 'Mr. Ibrahim Musa', userB: 'Dr. Grace Ade',
      detectedAt: daysAgo(2, 9, 41), status: 'open',
      suggestedResolution: 'Merge manually: take question list from DEV-026 (newer) and duration change from DEV-022.',
      versionA: { label: 'v3 — DEV-026', summary: 'Question list updated: 12 questions, duration 40 min.', fields: [{ field: 'Questions', value: '12' }, { field: 'Duration', value: '40 min' }, { field: 'Status', value: 'draft' }] },
      versionB: { label: 'v2 — DEV-022', summary: 'Duration extended to 45 min after accessibility review; question list unchanged (10).', fields: [{ field: 'Questions', value: '10' }, { field: 'Duration', value: '45 min' }, { field: 'Status', value: 'draft' }] },
    },
    {
      id: 'CONF-003', type: 'published_edited_after_approval',
      title: 'Approved assessment modified after approval — English CA',
      description: 'The English CA was approved at version 1. A later edit created version 2 on DEV-011. This is allowed (the edit became a new draft), but the sync engine flagged the divergence because a third computer still holds the approved-only copy.',
      affectedRecord: `${ENGLISH_CA_ID} (approved v1 vs local edit v2)`, recordKind: 'assessment',
      deviceAId: KEY_DEVICES.teacherEng, deviceBId: KEY_DEVICES.adminMain,
      userA: 'Mrs. Fatima Bello', userB: 'Mrs. Adaeze Okafor',
      detectedAt: daysAgo(5, 16, 5), status: 'open',
      suggestedResolution: 'Keep approved version 1 as the delivered package; require re-approval for version 2. Record the decision and close the flag.',
      versionA: { label: 'v2 (local draft) — DEV-011', summary: 'Essay word count lowered from 450 to 400 (draft, awaiting approval).', fields: [{ field: 'Version', value: '2 (draft)' }, { field: 'Essay length', value: '400 words' }] },
      versionB: { label: 'v1 (approved) — DEV-043', summary: 'The version approved on 23 Sep and distributed to all computers.', fields: [{ field: 'Version', value: '1 (approved)' }, { field: 'Essay length', value: '450 words' }] },
    },
    {
      id: 'CONF-004', type: 'duplicate_submission',
      title: 'Duplicate result submission — Biology Mock, Amina Yusuf',
      description: 'The same verified submission was received twice: once directly from the candidate\u2019s device and once from a peer that had replicated the attempt. The content hash is identical.',
      affectedRecord: 'ATT-BIO-001 / Amina Yusuf', recordKind: 'submission',
      deviceAId: 'DEV-063', deviceBId: KEY_DEVICES.adminCollect,
      userA: 'Amina Yusuf', userB: 'Mr. Tunde Olawale (collector)',
      detectedAt: daysAgo(1, 18, 10), status: 'open',
      suggestedResolution: 'Automatically de-duplicate: keep one submission, mark the copy with the same content hash as a duplicate. Do not count it twice.',
      versionA: { label: 'Submission A — direct', summary: 'Received from DEV-063 (the device where the exam was taken).', fields: [{ field: 'Attempt', value: 'ATT-BIO-001' }, { field: 'Hash', value: 'sha256:8f41c2ab…' }] },
      versionB: { label: 'Submission B — replica', summary: 'Received from DEV-008 which held an authorised replica of the attempt.', fields: [{ field: 'Attempt', value: 'ATT-BIO-001' }, { field: 'Hash', value: 'sha256:8f41c2ab… (identical)' }] },
    },
    {
      id: 'CONF-005', type: 'unauthorized_restricted_payload',
      title: 'Unauthorized payload rejected — unpaired computer tried to send student records',
      description: 'A computer on the school LAN that is not paired with this installation attempted to push a student-records payload. The payload was quarantined by the receiving peer.',
      affectedRecord: 'student_records payload (quarantined)', recordKind: 'restricted',
      deviceAId: 'DEV-096', deviceBId: KEY_DEVICES.adminMain,
      userA: 'Unknown (unpaired device)', userB: 'Mrs. Adaeze Okafor',
      detectedAt: daysAgo(3, 11, 3), status: 'open',
      suggestedResolution: 'Reject the payload and audit the event. Pair the device first if it is a legitimate school computer.',
      versionA: { label: 'Quarantined payload', summary: 'Unsigned student-records payload from an unpaired peer (DEV-096).', fields: [{ field: 'Origin', value: 'DEV-096 (unpaired)' }, { field: 'Records', value: '~170 student records' }, { field: 'Signature', value: 'MISSING' }] },
      versionB: { label: 'Policy', summary: 'Restricted payloads are only accepted from paired, trusted peers with the correct authorization.', fields: [{ field: 'Rule', value: 'Reject + audit' }, { field: 'Action', value: 'Quarantine payload' }] },
    },
    {
      id: 'CONF-006', type: 'delete_vs_edit',
      title: 'Deleted on one computer, edited on another — "Rhombus" matching question',
      description: 'Mrs. Fatima Bello deleted a draft matching question on DEV-011; Dr. Grace Ade edited the same draft on DEV-022 before the deletion replicated.',
      affectedRecord: 'Q-1012 (Mathematics — Matching Concepts)', recordKind: 'question',
      deviceAId: KEY_DEVICES.teacherEng, deviceBId: KEY_DEVICES.hod,
      userA: 'Mrs. Fatima Bello', userB: 'Dr. Grace Ade',
      detectedAt: daysAgo(1, 8, 55), status: 'open',
      suggestedResolution: 'Ask the owner. If the edit is valuable, keep the edited version and cancel the deletion; otherwise complete the deletion.',
      versionA: { label: 'Deleted — DEV-011', summary: 'Owner removed the draft question as duplicate.', fields: [{ field: 'State', value: 'Deleted' }, { field: 'By', value: 'Mrs. Fatima Bello' }] },
      versionB: { label: 'Edited — DEV-022', summary: 'Re-worded the left-hand items and added a subtopic tag.', fields: [{ field: 'State', value: 'Draft v2' }, { field: 'By', value: 'Dr. Grace Ade' }] },
    },
  ];
}

// ------------------------------------------------------------
// The world builder
// ------------------------------------------------------------

export function buildWorld(): DemoWorld {
  const schools = buildSchools();
  const classes = buildClasses();
  const subjects = buildSubjects();
  const devices = buildDevices();
  const students = buildStudents();
  const users = buildUsers(students);

  const seedQs = buildSeedQuestions('sch-greenfield', 'u-teacher-math', 'Mr. Daniel Ibrahim');
  questionsLookup = Object.fromEntries(seedQs.map((q) => [q.id, q]));

  const englishCA = buildEnglishCA(seedQs);
  const biologyMock = buildBiologyMock(seedQs);
  const mathDraft = buildMathDraft(seedQs);
  const publicPractice = buildPublicPractice(seedQs);

  // class teachers
  classes['cls-ss2a'].classTeacherId = 'u-teacher-math';
  classes['cls-ss2b'].classTeacherId = 'u-teacher-eng';
  classes['cls-ss2c'].classTeacherId = 'u-teacher-bio';
  classes['cls-ss2d'].classTeacherId = 'u-teacher-phy';

  const locals: Record<string, DeviceLocalState> = {};
  Object.values(devices).forEach((d) => {
    locals[d.id] = emptyLocal(d.id);
  });

  const world: DemoWorld = {
    version: 3,
    createdAt: NOW.toISOString(),
    schools,
    sessions: buildAcademicSessions(),
    classes,
    departments: buildDepartments(),
    subjects,
    topics: buildTopics(),
    users,
    roleDefinitions: buildRoleDefinitions(),
    devices,
    locals,
    network: { lanOnline: true, scanEnabled: true },
    scenario: { mainAssessmentId: MAIN_MATH_ASSESSMENT_ID, createdAssessmentId: null, distributionDone: false, collectionDone: false },
  };

  // ---------- distribute shared knowledge ----------
  // Question bank: known on staff/admin devices (synced previously)
  const staffDevices = ['DEV-001', 'DEV-004', 'DEV-005', 'DEV-008', 'DEV-011', 'DEV-017', 'DEV-022', 'DEV-024', 'DEV-026', 'DEV-043', 'DEV-090', 'DEV-091'];
  staffDevices.forEach((id) => {
    seedQs.forEach((q) => {
      locals[id].questions[q.id] = { ...q };
    });
  });

  // English CA: approved & distributed everywhere; released results
  const buildPkgPayload = (a: Assessment): ExamPackage['questionPayload'] => {
    const payload: ExamPackage['questionPayload'] = {};
    a.questionIds.forEach((qid) => {
      const q = seedQs.find((x) => x.id === qid);
      if (q) payload[qid] = { ...q };
    });
    return payload;
  };
  const allGF = Object.values(devices).filter((d) => d.schoolId === 'sch-greenfield');
  allGF.forEach((d) => {
    locals[d.id].assessments[ENGLISH_CA_ID] = { ...englishCA };
    locals[d.id].examPackages[ENGLISH_CA_ID] = {
      assessmentId: ENGLISH_CA_ID, version: 1, receivedAt: daysAgo(18, 7, 30), fromDeviceId: KEY_DEVICES.adminMain,
      questionPayload: buildPkgPayload(englishCA), totalMarks: englishCA.totalMarks, durationMin: englishCA.durationMin,
    };
  });
  locals[KEY_DEVICES.teacherEng].assessments[ENGLISH_CA_ID] = {
    ...englishCA,
    version: 2, // teacher edited after approval -> new draft revision (conflict case demo)
  };

  // English attempts: 100 SS2 students, released, summary + 12 representative
  const ss2Students = students.filter((s) => s.classId.startsWith('cls-ss2'));
  const labPool = Array.from({ length: 40 }, (_, i) => `DEV-${String(KEY_DEVICES.labStart + i).padStart(3, '0')}`);
  const eng = buildAttempts({ assessment: englishCA, students: ss2Students, devicePool: labPool, submittedCount: 100, fullAnswerCount: 12, released: true });
  Object.entries(eng.attemptsByDevice).forEach(([dev, list]) => {
    locals[dev].attempts.push(...list);
  });
  // submissions landed on admin/exoff devices (collected historically)
  Object.entries(eng.submissionsByDevice).forEach(([dev, list]) => {
    locals[KEY_DEVICES.adminMain].submissions.push(...list);
    if (dev !== KEY_DEVICES.adminMain && Math.random() < 0.5) locals[KEY_DEVICES.adminCollect].submissions.push(...list.slice(0, Math.ceil(list.length / 2)));
  });
  locals[KEY_DEVICES.exoff].submissions = [...locals[KEY_DEVICES.adminMain].submissions];

  // Biology mock: distributed, marking stage, 60 submitted, collected on 043 & 008
  allGF.forEach((d) => {
    locals[d.id].assessments[BIOLOGY_MOCK_ID] = { ...biologyMock };
    locals[d.id].examPackages[BIOLOGY_MOCK_ID] = {
      assessmentId: BIOLOGY_MOCK_ID, version: 1, receivedAt: daysAgo(5, 7, 30), fromDeviceId: KEY_DEVICES.exoff,
      questionPayload: buildPkgPayload(biologyMock), totalMarks: biologyMock.totalMarks, durationMin: biologyMock.durationMin,
    };
  });
  const bio = buildAttempts({ assessment: biologyMock, students: ss2Students, devicePool: labPool, submittedCount: 60, fullAnswerCount: 12, released: false });
  Object.entries(bio.attemptsByDevice).forEach(([dev, list]) => {
    locals[dev].attempts.push(...list);
  });
  Object.entries(bio.submissionsByDevice).forEach(([dev, list]) => {
    locals[KEY_DEVICES.adminMain].submissions.push(...list);
    locals[KEY_DEVICES.adminCollect].submissions.push(...list);
  });

  // Math draft: ONLY on the teacher's device (created locally, never synced)
  locals[KEY_DEVICES.teacherMath].assessments[MAIN_MATH_ASSESSMENT_ID] = { ...mathDraft };

  // Public practice visible on all devices
  allGF.forEach((d) => {
    publicPractice.forEach((p) => {
      locals[d.id].assessments[p.id] = { ...p };
    });
  });

  // sync history on key devices
  locals[KEY_DEVICES.adminMain].syncHistory = [
    { id: 'syn-1', at: daysAgo(18, 7, 30), deviceId: KEY_DEVICES.adminMain, peerDeviceId: '*', payloadType: 'assessment_package', label: 'Distributed approved English CA v1 → 92 paired peers', outcome: 'success', initiatedBy: 'Mrs. Adaeze Okafor' },
    { id: 'syn-2', at: daysAgo(16, 13, 0), deviceId: KEY_DEVICES.adminMain, peerDeviceId: '*', payloadType: 'submission', label: 'Collected English CA submissions → 100 verified', outcome: 'success', initiatedBy: 'Mrs. Adaeze Okafor' },
    { id: 'syn-3', at: daysAgo(5, 7, 30), deviceId: KEY_DEVICES.adminMain, peerDeviceId: '*', payloadType: 'assessment_package', label: 'Distributed approved Biology Mock v1 → 92 paired peers (3 pending)', outcome: 'success', initiatedBy: 'Mr. Chukwuemeka Nwosu' },
    { id: 'syn-4', at: daysAgo(2, 17, 0), deviceId: KEY_DEVICES.adminMain, peerDeviceId: 'DEV-096', payloadType: 'student_records', label: 'Rejected unauthorized payload from unpaired peer', outcome: 'blocked', initiatedBy: 'System' },
  ];
  locals[KEY_DEVICES.adminCollect].syncHistory = [
    { id: 'syn-b1', at: daysAgo(16, 15, 10), deviceId: KEY_DEVICES.adminCollect, peerDeviceId: '*', payloadType: 'submission', label: 'Collected English CA submissions (55 of 100) as secondary collector', outcome: 'success', initiatedBy: 'Mr. Tunde Olawale' },
    { id: 'syn-b2', at: daysAgo(2, 16, 45), deviceId: KEY_DEVICES.adminCollect, peerDeviceId: '*', payloadType: 'submission', label: 'Collected Biology Mock submissions (60 received)', outcome: 'success', initiatedBy: 'Mr. Tunde Olawale' },
  ];
  locals[KEY_DEVICES.teacherMath].syncHistory = [
    { id: 'syn-t1', at: daysAgo(2, 9, 0), deviceId: KEY_DEVICES.teacherMath, peerDeviceId: KEY_DEVICES.adminMain, payloadType: 'question_bank', label: 'Pushed 24 approved questions to shared bank', outcome: 'success', initiatedBy: 'Mr. Daniel Ibrahim' },
    { id: 'syn-t2', at: daysAgo(1, 18, 30), deviceId: KEY_DEVICES.teacherMath, peerDeviceId: KEY_DEVICES.exoff, payloadType: 'question_bank', label: 'Transfer failed — peer unreachable', outcome: 'failed', initiatedBy: 'Mr. Daniel Ibrahim', detail: 'Connection timed out after 30s. Retry scheduled.' },
  ];

  // notifications
  locals[KEY_DEVICES.teacherMath].notifications = [
    { id: 'n1', kind: 'assessment_approved', title: 'Biology Mock approved', body: 'Your forwarded question set was used in the approved Biology Mock v1.', at: daysAgo(6, 11, 0), read: true, deviceId: KEY_DEVICES.teacherMath },
    { id: 'n2', kind: 'sync_progress', title: 'Transfer failed', body: 'Question bank transfer to DEV-005 failed — peer unreachable. Retry scheduled.', at: daysAgo(1, 18, 30), read: false, deviceId: KEY_DEVICES.teacherMath, actionRoute: '/app/sync' },
    { id: 'n3', kind: 'conflict_detected', title: 'Conflict detected on your question', body: '"Rhombus" matching question was edited on DEV-022 after you deleted it on DEV-011.', at: daysAgo(1, 8, 55), read: false, deviceId: KEY_DEVICES.teacherMath, actionRoute: '/app/conflicts' },
  ];
  locals[KEY_DEVICES.adminMain].notifications = [
    { id: 'n4', kind: 'approval_requested', title: 'Approval requested: JSS3 Basic Science Test 2', body: 'Mr. Ibrahim Musa submitted a draft for approval (12 questions).', at: daysAgo(2, 9, 0), read: false, deviceId: KEY_DEVICES.adminMain, actionRoute: '/app/approvals' },
    { id: 'n5', kind: 'conflict_detected', title: '4 sync conflicts need review', body: 'Conflicts were detected during the last synchronization rounds.', at: daysAgo(1, 14, 30), read: false, deviceId: KEY_DEVICES.adminMain, actionRoute: '/app/conflicts' },
    { id: 'n6', kind: 'licence_expiry', title: 'Licence renews in 65 days', body: 'Campus plan expires 15 Dec 2026. Renewal reminder.', at: daysAgo(2, 8, 0), read: true, deviceId: KEY_DEVICES.adminMain, actionRoute: '/app/licensing' },
    { id: 'n7', kind: 'update_available', title: 'Update 1.4.1 available on LAN', body: 'DEV-001 holds a verified 1.4.1 package. You can distribute it to peers.', at: daysAgo(0, 7, 50), read: false, deviceId: KEY_DEVICES.adminMain, actionRoute: '/app/updates' },
    { id: 'n8', kind: 'result_received', title: 'Biology Mock: 60 of 100 submissions collected', body: '40 outstanding. Retry collection when candidates\u2019 devices reconnect.', at: daysAgo(2, 16, 50), read: false, deviceId: KEY_DEVICES.adminMain, actionRoute: '/app/results' },
  ];
  locals[KEY_DEVICES.adminCollect].notifications = [
    { id: 'n9', kind: 'result_received', title: 'Biology Mock: 60 submissions on this computer', body: 'This computer holds a partial collection. DEV-043 holds the full set.', at: daysAgo(2, 16, 50), read: false, deviceId: KEY_DEVICES.adminCollect, actionRoute: '/app/results' },
    { id: 'n10', kind: 'conflict_detected', title: 'Duplicate submission detected', body: 'Amina Yusuf\u2019s Biology submission was received twice with identical hash.', at: daysAgo(1, 18, 10), read: false, deviceId: KEY_DEVICES.adminCollect, actionRoute: '/app/conflicts' },
  ];
  locals[KEY_DEVICES.exoff].notifications = [
    { id: 'n11', kind: 'exam_distributed', title: 'Biology Mock distributed', body: '92 peers acknowledged. 3 pending, 1 offline at distribution time.', at: daysAgo(5, 7, 45), read: true, deviceId: KEY_DEVICES.exoff },
  ];

  // a second pending approval on DEV-043 (from Physics teacher, seeded)
  locals[KEY_DEVICES.adminMain].approvalRequests = [
    {
      id: 'APR-002', assessmentId: 'ASSESS-PHY-SS2-T1', version: 1,
      assessmentName: 'SS2 Physics — Kinematics Test 1', subjectId: 'sub-phy',
      requestedBy: 'u-teacher-phy', requestedByName: 'Mr. Ibrahim Musa',
      fromDeviceId: KEY_DEVICES.teacherPhy, requestedAt: daysAgo(2, 9, 0),
      status: 'pending', questionCount: 12, totalMarks: 24,
    },
  ];
  // the assessment exists on the physics teacher's device as pending_approval
  locals[KEY_DEVICES.teacherPhy].assessments['ASSESS-PHY-SS2-T1'] = {
    id: 'ASSESS-PHY-SS2-T1', schoolId: 'sch-greenfield', name: 'SS2 Physics — Kinematics Test 1',
    description: 'Test covering Newton\u2019s laws and kinematics.', instructions: 'Answer all questions.',
    subjectId: 'sub-phy', classIds: ['cls-ss2a', 'cls-ss2b'], type: 'weekly_test', access: 'controlled',
    startAt: daysAhead(3, 9, 0), endAt: daysAhead(3, 15, 0), durationMin: 40, totalMarks: 24, passMark: 12,
    attemptsAllowed: 1, questionIds: seedQs.filter((q) => q.subjectId === 'sub-phy').map((q) => q.id),
    sections: [{ id: 's1', name: 'Section A', questionIds: seedQs.filter((q) => q.subjectId === 'sub-phy').map((q) => q.id) }],
    randomizeQuestions: false, randomizeOptions: false, status: 'pending_approval', version: 1,
    createdBy: 'u-teacher-phy', createdByName: 'Mr. Ibrahim Musa', createdOnDevice: KEY_DEVICES.teacherPhy,
    createdAt: daysAgo(2, 8, 40), updatedAt: daysAgo(2, 9, 0),
    resultVisibility: 'after_release', feedbackPolicy: 'correct_incorrect', submissionMode: 'collected',
  };

  // conflicts on devices
  const conflicts = buildConflicts();
  [KEY_DEVICES.adminMain, KEY_DEVICES.adminCollect].forEach((d) => {
    locals[d].conflicts = conflicts.map((c) => ({ ...c }));
  });
  locals[KEY_DEVICES.teacherMath].conflicts = [conflicts[5], conflicts[0]].map((c) => ({ ...c }));
  locals[KEY_DEVICES.exoff].conflicts = [conflicts[0]].map((c) => ({ ...c }));

  // audit logs
  const mkAudit = (deviceId: string, rows: [number, string, string, string, string, string, string, 'success' | 'failure' | 'warning'][]) =>
    rows.map(([dayOffset, time, userName, action, target, detail, status], ix) => ({
      id: `aud-${deviceId}-${ix}`,
      at: `${daysAgo(dayOffset).slice(0, 11)}${time}:00.000Z`,
      deviceId, userId: 'system', userName, action: action as never, target, detail, status,
    }));
  locals[KEY_DEVICES.adminMain].auditLog = mkAudit(KEY_DEVICES.adminMain, [
    [0, 'T07:45', 'Mrs. Adaeze Okafor', 'login', 'session', 'Signed in on DEV-043', 'success'],
    [1, 'T14:22', 'System (sync)', 'sync_event', 'Q-1016', 'Conflict detected during sync with DEV-024', 'warning'],
    [2, 'T09:10', 'Mrs. Adaeze Okafor', 'assessment_approved', 'ASSESS-ENG-SS2-CA1 v1', 'Approved version 1 for distribution', 'success'],
    [3, 'T11:03', 'System (sync)', 'sync_event', 'student_records', 'Blocked unauthorized payload from DEV-096', 'failure'],
    [4, 'T16:05', 'Mrs. Adaeze Okafor', 'result_adjusted', 'ATT-ENG-042', 'Manual mark adjusted 8 → 9 after review', 'success'],
    [5, 'T08:30', 'Mr. Tunde Olawale', 'login', 'session', 'Signed in on DEV-008', 'success'],
  ]);
  locals[KEY_DEVICES.teacherMath].auditLog = mkAudit(KEY_DEVICES.teacherMath, [
    [0, 'T08:05', 'Mr. Daniel Ibrahim', 'question_changed', 'Q-1001..Q-1010', 'Updated draft questions for mid-term exam', 'success'],
    [1, 'T15:20', 'Mr. Daniel Ibrahim', 'assessment_revised', 'ASSESS-MATH-SS2-MIDTERM v1', 'Created draft assessment', 'success'],
    [1, 'T18:30', 'System (sync)', 'sync_event', 'question_bank', 'Transfer to DEV-005 failed (unreachable)', 'failure'],
  ]);
  locals[KEY_DEVICES.exoff].auditLog = mkAudit(KEY_DEVICES.exoff, [
    [5, 'T07:30', 'Mr. Chukwuemeka Nwosu', 'exam_published', 'ASSESS-BIO-SS2-MOCK v1', 'Distributed approved package to 92 peers', 'success'],
    [6, 'T11:00', 'Mr. Chukwuemeka Nwosu', 'assessment_approved', 'ASSESS-BIO-SS2-MOCK v1', 'Approved version 1', 'success'],
  ]);

  // backups on key devices
  [KEY_DEVICES.adminMain, KEY_DEVICES.adminCollect, KEY_DEVICES.proprietor].forEach((d, ix) => {
    locals[d].backups = [
      { id: `bkp-${d}-2`, createdAt: daysAgo(3, 2, 0), createdBy: 'System (scheduled)', sizeMb: 412 + ix * 40, kind: 'full', scope: 'All school records', encrypted: true, verified: true, location: `D:\\ExamHubBackups\\auto-${d}`, status: 'completed' },
      { id: `bkp-${d}-1`, createdAt: daysAgo(10, 2, 0), createdBy: 'System (scheduled)', sizeMb: 398 + ix * 40, kind: 'full', scope: 'All school records', encrypted: true, verified: true, location: `D:\\ExamHubBackups\\auto-${d}`, status: 'completed' },
    ];
  });

  // browser sessions on admin device
  locals[KEY_DEVICES.adminMain].browserSessions = [
    { id: 'brs-1', userName: 'Mrs. Adaeze Okafor', role: 'administrator', device: 'iPad (Safari)', ip: '192.168.8.240', startedAt: daysAgo(0, 7, 55), active: true },
    { id: 'brs-2', userName: 'Mr. Chukwuemeka Nwosu', role: 'exam_officer', device: 'Windows laptop (Chrome)', ip: '192.168.8.241', startedAt: daysAgo(1, 9, 30), active: false },
  ];

  // pending transfer example on teacher device (failed, retryable)
  locals[KEY_DEVICES.teacherMath].transferQueue = [
    {
      id: 'xfr-teacher-1', fromDeviceId: KEY_DEVICES.teacherMath, toDeviceId: KEY_DEVICES.exoff,
      payloadType: 'question_bank', payloadId: 'qbank-math-drafts', payloadLabel: 'Question bank — 4 draft questions',
      sizeKb: 128, status: 'failed', progress: 42, speedMbps: 0, initiatedBy: 'Mr. Daniel Ibrahim',
      createdAt: daysAgo(1, 18, 28), retries: 1, errorNote: 'Peer unreachable — connection timed out.', direction: 'outgoing',
    },
  ];

  return world;
}

export { buildAttempts };
