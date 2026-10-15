'use client';

/**
 * School management — profile, academic setup, classes, subjects, staff,
 * students, student detail, enrollment & bulk import.
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { PageHeader, StatCard, SectionCard, StatusBadge, DataTable, EmptyState, UserAvatar, AccessDenied } from '@/components/shared/ui-kit';
import { ROLE_LABELS, fmtDate, fmtDateTime, fmtRelative } from '@/lib/ui-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  School, CalendarRange, Network, BookOpen, Users, GraduationCap, Upload, Download, Plus, Save, Pencil,
  ArrowLeftRight, TrendingUp, UserCheck, Search, FileSpreadsheet, ArrowRight, Trash2, Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ClassRoom, User } from '@/lib/prototype/types';

// ============================================================
// School profile
// ============================================================

export function SchoolProfileScreen() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const school = store.world.schools[device.schoolId];
  const [edit, setEdit] = React.useState(false);
  const [form, setForm] = React.useState({ ...school });

  const save = () => {
    store.updateSchoolProfile(school.id, form);
    setEdit(false);
    toast.success('School profile saved', { description: 'Changes are stored locally and sync to authorized peers.' });
  };

  return (
    <div>
      <PageHeader
        title="School profile"
        description="Identity, contact and academic configuration for this school."
        icon={<School className="h-5 w-5" />}
        actions={!edit ? (
          <Button size="sm" onClick={() => setEdit(true)}><Pencil className="mr-1.5 h-4 w-4" /> Edit profile</Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => { setForm({ ...school }); setEdit(false); }}>Cancel</Button>
            <Button size="sm" onClick={save}><Save className="mr-1.5 h-4 w-4" /> Save changes</Button>
          </>
        )}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Identity" className="lg:col-span-2">
          {edit ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label>School name</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>City</Label><Input className="mt-1" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              <div><Label>State</Label><Input className="mt-1" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Address</Label><Input className="mt-1" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div><Label>Phone</Label><Input className="mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input className="mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Announcement</Label><Textarea className="mt-1" value={form.announcement ?? ''} onChange={(e) => setForm({ ...form, announcement: e.target.value })} /></div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white" style={{ background: `oklch(0.6 0.14 ${school.logoHue})` }}>{school.name[0]}</div>
                <div>
                  <p className="text-lg font-bold">{school.name}</p>
                  <p className="text-sm text-muted-foreground">{school.motto}</p>
                  <Badge variant="outline" className="mt-1 capitalize">{school.type} school</Badge>
                </div>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div><p className="text-xs text-muted-foreground">Address</p><p>{school.address}, {school.city}, {school.state}</p></div>
                <div><p className="text-xs text-muted-foreground">Contact</p><p>{school.phone} · {school.email}</p></div>
              </div>
              {school.announcement && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/40">
                  <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">Current announcement</p>
                  <p className="mt-0.5 text-sky-800 dark:text-sky-200">{school.announcement}</p>
                </div>
              )}
            </div>
          )}
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Quick stats">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Students" value={Object.values(store.world.users).filter((u) => u.schoolId === school.id && u.role === 'student').length} />
              <StatCard label="Classes" value={Object.values(store.world.classes).length} />
              <StatCard label="Subjects" value={Object.values(store.world.subjects).length} />
              <StatCard label="Computers" value={Object.values(store.world.devices).filter((d) => d.schoolId === school.id).length} />
            </div>
          </SectionCard>
          <SectionCard title="Multi-school note">
            <p className="text-xs text-muted-foreground">
              This installation supports multiple schools with strict isolation. Records, users and devices of
              other schools on the same computer are never visible from this school\u2019s context. Use the device
              simulator to sign in as “Mrs. Bolanle Ojo” on DEV-101 to see the second demo school.
            </p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Academic setup — sessions, terms, grading
// ============================================================

export function AcademicSetupScreen() {
  const store = useDemoStore();
  const [selected, setSelected] = React.useState(store.world.sessions.find((s) => s.status === 'active')?.id ?? store.world.sessions[0]?.id);
  const session = store.world.sessions.find((s) => s.id === selected);
  const school = store.world.schools[store.currentDevice().schoolId];
  return (
    <div>
      <PageHeader
        title="Academic setup"
        description="Sessions, terms, academic levels and grading policies."
        icon={<CalendarRange className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => toast.success('Session created (simulated)', { description: 'A planning session is stored locally.' })}><Plus className="mr-1.5 h-4 w-4" /> New session</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Academic sessions" className="lg:col-span-1">
          <div className="space-y-2">
            {store.world.sessions.map((s) => (
              <button key={s.id} onClick={() => setSelected(s.id)} className={`w-full rounded-lg border p-3 text-left transition-colors ${selected === s.id ? 'border-primary ring-1 ring-primary/20' : 'hover:bg-accent'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{s.name}</p>
                  <StatusBadge status={s.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{fmtDate(s.startDate)} → {fmtDate(s.endDate)}</p>
              </button>
            ))}
          </div>
        </SectionCard>
        <SectionCard title={session ? `${session.name} — terms` : 'Terms'} className="lg:col-span-2">
          <div className="space-y-2">
            {session?.terms.map((t) => (
              <div key={t.term} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(t.start)} → {fmtDate(t.end)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {session.status === 'active' && school.currentTerm === t.term && <Badge>Current</Badge>}
                  <StatusBadge status={t.status} />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="mt-2" onClick={() => toast('Term dates updated (simulated)')}><CalendarRange className="mr-1.5 h-4 w-4" /> Adjust term dates</Button>
          </div>
        </SectionCard>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Grading policy" description="Applied to all results for this school" action={<Button size="sm" variant="outline" onClick={() => toast('Grading editor (simulated)')}>Edit bands</Button>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {school.gradingScheme.map((g) => (
              <div key={g.grade} className="rounded-lg border p-3 text-center">
                <p className="text-lg font-bold text-primary">{g.grade}</p>
                <p className="text-xs text-muted-foreground">{g.min}–{g.max}%</p>
                <p className="text-xs">{g.remark}</p>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Assessment defaults" description="Applied to newly created assessments">
          <div className="space-y-3 text-sm">
            {[
              ['Default duration', '45 minutes'],
              ['Default pass mark', '50%'],
              ['Attempts allowed', '1'],
              ['Result visibility', 'After approval & release'],
              ['Feedback policy', 'Correct / incorrect only'],
              ['Randomise questions', 'Off by default'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b pb-2"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ============================================================
// Classes & arms
// ============================================================

export function ClassesScreen() {
  const store = useDemoStore();
  const classes = Object.values(store.world.classes);
  const [addOpen, setAddOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const students = Object.values(store.world.users).filter((u) => u.role === 'student');
  return (
    <div>
      <PageHeader
        title="Classes & arms"
        description="Class groups, arms, capacities and class-teacher assignments."
        icon={<Network className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Add class</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {classes.map((c) => {
          const count = students.filter((s) => s.classId === c.id).length;
          const teacher = c.classTeacherId ? store.world.users[c.classTeacherId] : null;
          return (
            <div key={c.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{c.category.replace(/_/g, ' ')}</p>
                </div>
                <Badge variant="outline">Arm {c.arm}</Badge>
              </div>
              <p className="mt-3 text-2xl font-bold">{count}<span className="text-sm font-normal text-muted-foreground">/{c.capacity} students</span></p>
              <div className="mt-2 flex items-center gap-2">
                {teacher ? <UserAvatar name={teacher.name} hue={teacher.avatarHue} size="sm" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px]">—</span>}
                <span className="truncate text-xs text-muted-foreground">{teacher ? `${teacher.name} (class teacher)` : 'No class teacher'}</span>
              </div>
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => store.navigate('/app/school/students')}>View students</Button>
            </div>
          );
        })}
      </div>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add class</DialogTitle><DialogDescription>Creates the class locally on this computer.</DialogDescription></DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SS1 C" aria-label="Class name" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => { if (name.trim()) { store.createClass(store.currentDevice().schoolId, name.trim()); toast.success(`Class "${name.trim()}" created`); setName(''); setAddOpen(false); } }}>Create class</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Subjects & departments
// ============================================================

export function SubjectsScreen() {
  const store = useDemoStore();
  const subjects = Object.values(store.world.subjects);
  const departments = store.world.departments;
  return (
    <div>
      <PageHeader
        title="Subjects & departments"
        description="Subject offerings grouped by department."
        icon={<BookOpen className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => toast.success('Subject editor opened (simulated)')}><Plus className="mr-1.5 h-4 w-4" /> Add subject</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-4">
        <SectionCard title="Departments" className="lg:col-span-1">
          <div className="space-y-2">
            {departments.map((d) => {
              const head = d.headId ? store.world.users[d.headId] : null;
              const count = subjects.filter((s) => s.departmentId === d.id).length;
              return (
                <div key={d.id} className="rounded-lg border p-3">
                  <p className="text-sm font-semibold">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{count} subject(s)</p>
                  {head && <p className="mt-1 flex items-center gap-1.5 text-xs"><UserAvatar name={head.name} hue={head.avatarHue} size="sm" /> HOD: {head.name}</p>}
                </div>
              );
            })}
          </div>
        </SectionCard>
        <div className="lg:col-span-3">
          <DataTable
            rows={subjects}
            rowKey={(s) => s.id}
            searchable
            searchKeys={(s) => `${s.name} ${s.code}`}
            columns={[
              { key: 'name', header: 'Subject', sortable: true, render: (s) => <span className="font-medium">{s.name}</span> },
              { key: 'code', header: 'Code', sortable: true, render: (s) => <Badge variant="outline">{s.code}</Badge> },
              { key: 'departmentId', header: 'Department', render: (s) => departments.find((d) => d.id === s.departmentId)?.name ?? '—' },
              { key: 'levelCategory', header: 'Level', render: (s) => <span className="text-xs capitalize">{s.levelCategory.replace(/_/g, ' ')}</span> },
              { key: 'topics', header: 'Topics', render: (s) => <span className="text-xs text-muted-foreground">{store.world.topics.filter((t) => t.subjectId === s.id).length} topic group(s)</span> },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Staff
// ============================================================

export function StaffScreen() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const staff = Object.values(store.world.users).filter((u) => u.schoolId === device.schoolId && ['teacher', 'hod', 'exam_officer', 'invigilator', 'administrator', 'proprietor', 'support'].includes(u.role));
  return (
    <div>
      <PageHeader
        title="Staff records"
        description={`${staff.length} staff members registered in this school.`}
        icon={<Users className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => toast.success('Staff CSV exported (simulated)')}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
            <Button size="sm" onClick={() => store.navigate('/app/school/enrollment')}><Upload className="mr-1.5 h-4 w-4" /> Bulk import</Button>
          </>
        }
      />
      <DataTable
        rows={staff}
        rowKey={(s) => s.id}
        searchable
        searchKeys={(s) => `${s.name} ${s.email} ${ROLE_LABELS[s.role]}`}
        pageSize={12}
        filters={[
          { key: 'role', label: 'Role', options: Object.values(ROLE_LABELS).map((r) => ({ value: r, label: r })), match: (s, v) => ROLE_LABELS[s.role] === v },
        ]}
        columns={[
          {
            key: 'name', header: 'Staff', sortable: true, render: (s) => (
              <div className="flex items-center gap-2.5">
                <UserAvatar name={s.name} hue={s.avatarHue} size="sm" />
                <div><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.email}</p></div>
              </div>
            ),
          },
          { key: 'role', header: 'Role', sortable: true, render: (s) => <Badge variant="outline">{ROLE_LABELS[s.role]}</Badge> },
          { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
          { key: 'lastLoginAt', header: 'Last login', render: (s) => <span className="text-xs text-muted-foreground">{fmtRelative(s.lastLoginAt)}</span> },
          {
            key: 'actions', header: '', render: (s) => (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); toast(`Opening ${s.name}'s record`); }}>View</Button>
            ),
          },
        ]}
      />
    </div>
  );
}

// ============================================================
// Students directory
// ============================================================

export function StudentsScreen() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const students = Object.values(store.world.users).filter((u) => u.schoolId === device.schoolId && u.role === 'student');
  const [detailId, setDetailId] = React.useState<string | null>(store.route.params.id && store.world.users[store.route.params.id]?.role === 'student' ? store.route.params.id : null);
  return (
    <div>
      <PageHeader
        title="Student records"
        description={`${students.length} enrolled students. Click a row for the full record, results and audit history.`}
        icon={<GraduationCap className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => toast.success('Master list exported (simulated)')}><Download className="mr-1.5 h-4 w-4" /> Export</Button>
            <Button size="sm" onClick={() => store.navigate('/app/school/enrollment')}><Upload className="mr-1.5 h-4 w-4" /> Enroll / import</Button>
          </>
        }
      />
      {detailId ? (
        <StudentRecord studentId={detailId} onBack={() => setDetailId(null)} />
      ) : (
        <DataTable
          rows={students}
          rowKey={(s) => s.id}
          searchable
          searchKeys={(s) => `${s.name} ${s.admissionNo}`}
          pageSize={12}
          filters={[
            { key: 'class', label: 'Class', options: Object.values(store.world.classes).map((c) => ({ value: c.id, label: c.name })), match: (s, v) => s.classId === v },
          ]}
          onRowClick={(s) => setDetailId(s.id)}
          columns={[
            {
              key: 'name', header: 'Student', sortable: true, render: (s) => (
                <div className="flex items-center gap-2.5">
                  <UserAvatar name={s.name} hue={s.avatarHue} size="sm" />
                  <div><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.admissionNo}</p></div>
                </div>
              ),
            },
            { key: 'classId', header: 'Class', sortable: true, render: (s) => store.world.classes[s.classId ?? '']?.name ?? '—' },
            { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
            { key: 'guardian', header: 'Guardian', render: (s) => { const p = Object.values(store.world.users).find((u) => u.role === 'parent' && u.childrenIds?.includes(s.id)); return <span className="text-xs">{p?.name ?? '—'}</span>; } },
          ]}
        />
      )}
    </div>
  );
}

function StudentRecord({ studentId, onBack }: { studentId: string; onBack: () => void }) {
  const store = useDemoStore();
  const student = store.world.users[studentId];
  const local = store.local();
  const attempts = local.attempts.filter((a) => a.studentId === studentId);
  const parent = Object.values(store.world.users).find((u) => u.role === 'parent' && u.childrenIds?.includes(studentId));
  return (
    <div>
      <PageHeader
        title={student.name}
        description={`${store.world.classes[student.classId ?? '']?.name ?? ''} · ${student.admissionNo ?? ''}`}
        crumbs={[{ label: 'Students', onClick: onBack }, { label: student.name.split(' ').slice(-1)[0] }]}
        icon={<GraduationCap className="h-5 w-5" />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => toast('Transfer wizard (simulated)', { description: 'Move this student to another class or school with records.' })}><ArrowLeftRight className="mr-1.5 h-4 w-4" /> Transfer</Button>
            <Button size="sm" variant="outline" onClick={() => toast('Promotion run (simulated)', { description: 'At session end, students move to the next level.' })}><TrendingUp className="mr-1.5 h-4 w-4" /> Promote</Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Personal record">
          <div className="flex items-center gap-3">
            <UserAvatar name={student.name} hue={student.avatarHue} size="lg" />
            <div className="space-y-0.5 text-sm">
              <p className="font-semibold">{student.name}</p>
              <p className="text-xs text-muted-foreground">{student.email}</p>
              <StatusBadge status={student.status} />
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Admission No</span><span>{student.admissionNo}</span></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Class</span><span>{store.world.classes[student.classId ?? '']?.name}</span></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Guardian</span><span>{parent?.name ?? '—'}</span></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Enrolled</span><span>{fmtDate(student.createdAt)}</span></div>
          </div>
        </SectionCard>
        <SectionCard title="Assessment history (on this computer)" className="lg:col-span-2">
          {attempts.length === 0 ? (
            <EmptyState title="No attempts on this computer" description="Attempts are stored on the device where the student wrote them and only appear here after synchronization." />
          ) : (
            <div className="space-y-2">
              {attempts.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{a.assessmentName}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(a.submittedAt)} · taken on {a.deviceId}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{a.autoScore + a.manualScore}/{a.totalMarks}</span>
                    <StatusBadge status={a.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export function StudentDetailScreen() { return <StudentsScreen />; }

// ============================================================
// Enrollment & bulk import
// ============================================================

export function EnrollmentScreen() {
  const store = useDemoStore();
  const [tab, setTab] = React.useState<'single' | 'bulk' | 'codes'>('single');
  return (
    <div>
      <PageHeader
        title="Enrollment & imports"
        description="Add students one at a time, import CSV/Excel lists in bulk, or generate registration codes."
        icon={<Upload className="h-5 w-5" />}
      />
      <div className="mb-4 flex gap-2">
        {([['single', 'Single student'], ['bulk', 'Bulk import'], ['codes', 'Registration codes']] as const).map(([k, l]) => (
          <Button key={k} size="sm" variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>
      {tab === 'single' && <SingleEnroll />}
      {tab === 'bulk' && <BulkImport />}
      {tab === 'codes' && <RegCodes />}
    </div>
  );
}

function SingleEnroll() {
  const [done, setDone] = React.useState(false);
  return (
    <SectionCard title="Enroll a student">
      {done ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <UserCheck className="mb-1 h-5 w-5" /> Student enrolled and admission number assigned. Records exist on this computer; sync to share with other peers.
        </div>
      ) : (
        <form className="grid max-w-xl gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setDone(true); toast.success('Student enrolled (simulated)'); }}>
          <div><Label>Full name *</Label><Input required className="mt-1" placeholder="e.g. Chioma Eze" /></div>
          <div><Label>Class *</Label>
            <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" aria-label="Class"><option>SS2 A</option><option>SS2 B</option><option>JSS3 A</option></select>
          </div>
          <div><Label>Gender</Label>
            <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" aria-label="Gender"><option>Female</option><option>Male</option></select>
          </div>
          <div><Label>Date of birth</Label><Input type="date" className="mt-1" /></div>
          <div className="sm:col-span-2"><Label>Guardian name & phone</Label><Input className="mt-1" placeholder="Mrs. Eze — +234 800 000 0000" /></div>
          <div className="sm:col-span-2"><Button type="submit">Enroll student</Button></div>
        </form>
      )}
    </SectionCard>
  );
}

function BulkImport() {
  const store = useDemoStore();
  const [state, setState] = React.useState<'pick' | 'review' | 'done'>('pick');
  return (
    <SectionCard title="Bulk import students" description="Upload a CSV or Excel export — duplicates are flagged before writing.">
      {state === 'pick' && (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center hover:border-primary/50">
          <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">Choose students.csv</p>
          <p className="text-xs text-muted-foreground">Simulated: 60 rows, 2 duplicate admission numbers</p>
          <input type="file" className="hidden" onChange={() => setState('review')} aria-label="Import file" />
        </label>
      )}
      {state === 'review' && (
        <div className="space-y-3">
          <div className="rounded-lg border p-3 text-sm">
            <p className="font-medium">Preview — students_master_list.csv</p>
            <p className="mt-1 text-xs text-muted-foreground">58 new · 2 duplicates (GA/SS2B/014, GA/SS2C/003) · columns mapped automatically</p>
          </div>
          <div className="overflow-hidden rounded-lg border text-xs">
            {[['Name', 'Class', 'Admission No'], ['Blessing Ogundipe', 'SS2 A', 'GA/SS2A/031'], ['Hassan Danjuma', 'SS2 B', 'GA/SS2B/031'], ['Joy Ijeoma', 'JSS3 A', 'GA/JSS3A/026']].map((r, i) => (
              <div key={i} className={`flex gap-4 border-b px-3 py-1.5 last:border-0 ${i === 0 ? 'bg-muted/50 font-semibold' : ''}`}>{r.map((c, j) => <span key={j} className="w-40 truncate">{c}</span>)}</div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { setState('done'); toast.success('58 students imported', { description: '2 duplicates skipped — see the report in local logs.' }); }}>Import 58 records</Button>
            <Button variant="outline" onClick={() => setState('pick')}>Cancel</Button>
          </div>
        </div>
      )}
      {state === 'done' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Import complete: 58 records written locally, 2 duplicates skipped. <Button size="sm" variant="outline" className="ml-2" onClick={() => setState('pick')}>Import another</Button>
        </div>
      )}
    </SectionCard>
  );
}

function RegCodes() {
  const [codes, setCodes] = React.useState<{ code: string; classId: string; used: boolean }[]>([
    { code: 'GF-ENR-4KX9', classId: 'SS2 A', used: true },
    { code: 'GF-ENR-7QW2', classId: 'SS2 A', used: true },
    { code: 'GF-ENR-M3PL', classId: 'JSS3 A', used: false },
  ]);
  return (
    <SectionCard title="Student registration codes" description="Parents/students can self-register by pairing code + registration code (authorized peers only).">
      <div className="space-y-2">
        {codes.map((c) => (
          <div key={c.code} className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span className="font-mono font-semibold">{c.code}</span>
            <span className="text-muted-foreground">{c.classId}</span>
            <StatusBadge status={c.used ? 'approved' : 'pending'} label={c.used ? 'Used' : 'Available'} />
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => { setCodes((cs) => [...cs, { code: `GF-ENR-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, classId: 'SS2 B', used: false }]); toast.success('Registration code generated'); }}><Plus className="mr-1.5 h-4 w-4" /> Generate code</Button>
      </div>
    </SectionCard>
  );
}
