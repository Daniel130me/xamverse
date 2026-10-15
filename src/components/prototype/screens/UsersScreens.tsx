'use client';

/** Users & permissions — accounts, sessions, roles matrix, custom roles, my profile */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { PageHeader, StatCard, SectionCard, StatusBadge, DataTable, EmptyState, UserAvatar } from '@/components/shared/ui-kit';
import { ROLE_LABELS, fmtDateTime, fmtRelative } from '@/lib/ui-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { UserCog, ShieldCheck, Plus, KeyRound, MonitorSmartphone, History, Save, Search, CircleUser } from 'lucide-react';
import { toast } from 'sonner';
import type { PermissionKey, RoleDefinition, User } from '@/lib/prototype/types';

const PERMISSION_GROUPS: { group: string; perms: { key: PermissionKey; label: string }[] }[] = [
  { group: 'School', perms: [
    { key: 'school.manage', label: 'Manage school profile' },
    { key: 'academic.manage', label: 'Manage academic setup' },
  ] },
  { group: 'Users', perms: [
    { key: 'users.manage', label: 'Manage user accounts' },
    { key: 'roles.manage', label: 'Manage roles & permissions' },
  ] },
  { group: 'Questions', perms: [
    { key: 'questions.view', label: 'View question banks' },
    { key: 'questions.create', label: 'Create & edit questions' },
    { key: 'questions.approve', label: 'Approve questions' },
    { key: 'ai.use', label: 'Use AI assistant' },
  ] },
  { group: 'Assessments', perms: [
    { key: 'assessments.view', label: 'View assessments' },
    { key: 'assessments.create', label: 'Create assessments' },
    { key: 'assessments.approve', label: 'Approve assessments' },
    { key: 'assessments.publish', label: 'Publish & distribute' },
  ] },
  { group: 'Examinations', perms: [
    { key: 'exams.monitor', label: 'Monitor exam sessions' },
    { key: 'exams.invigilate', label: 'Invigilate & control sessions' },
    { key: 'exams.take', label: 'Take examinations' },
  ] },
  { group: 'Results', perms: [
    { key: 'results.view_school', label: 'View school results' },
    { key: 'results.view_own', label: 'View own results' },
    { key: 'results.mark', label: 'Mark & moderate' },
    { key: 'results.approve_release', label: 'Approve & release results' },
  ] },
  { group: 'Analytics', perms: [
    { key: 'analytics.view', label: 'View analytics & reports' },
  ] },
  { group: 'Computers & Sync', perms: [
    { key: 'devices.view', label: 'View computers & sync' },
    { key: 'devices.pair', label: 'Pair & revoke devices' },
    { key: 'sync.distribute', label: 'Distribute assessments' },
    { key: 'sync.collect', label: 'Collect results' },
    { key: 'sync.run', label: 'Run own sync tasks' },
    { key: 'conflicts.resolve', label: 'Resolve conflicts' },
  ] },
  { group: 'System', perms: [
    { key: 'licence.manage', label: 'Manage licence & billing' },
    { key: 'updates.manage', label: 'Manage app updates' },
    { key: 'backups.manage', label: 'Manage backups & restore' },
    { key: 'settings.manage', label: 'Manage settings' },
    { key: 'audit.view', label: 'View audit logs' },
  ] },
];

// ============================================================
// User accounts
// ============================================================

export function UsersScreen() {
  const store = useDemoStore();
  const device = store.currentDevice();
  const users = Object.values(store.world.users).filter((u) => u.schoolId === device.schoolId);
  const [detail, setDetail] = React.useState<User | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const toggleUser = (u: User) => {
    const next: User['status'] = u.status === 'active' ? 'suspended' : 'active';
    store.setUserStatus(u.id, next);
    store.audit('permission_change', u.id, `${u.name} account ${next === 'active' ? 'reactivated' : 'suspended'}`, 'warning');
    toast.success(`${u.name} ${next === 'active' ? 'reactivated' : 'suspended'}`);
  };

  return (
    <div>
      <PageHeader
        title="User accounts"
        description={`${users.length} accounts in this school. Sign-in state is per computer — accounts sync only to authorized peers.`}
        icon={<UserCog className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => setInviteOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Invite user</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active" value={users.filter((u) => u.status === 'active').length} tone="success" />
        <StatCard label="Suspended" value={users.filter((u) => u.status === 'suspended').length} tone="warning" />
        <StatCard label="Staff" value={users.filter((u) => u.role !== 'student' && u.role !== 'parent').length} />
        <StatCard label="Students & parents" value={users.filter((u) => u.role === 'student' || u.role === 'parent').length} />
      </div>
      <DataTable
        rows={users}
        rowKey={(u) => u.id}
        searchable
        searchKeys={(u) => `${u.name} ${u.email}`}
        pageSize={12}
        filters={[
          { key: 'role', label: 'Role', options: [...new Set(users.map((u) => ROLE_LABELS[u.role]))].map((r) => ({ value: r, label: r })), match: (u, v) => ROLE_LABELS[u.role] === v },
        ]}
        onRowClick={(u) => setDetail(u)}
        columns={[
          {
            key: 'name', header: 'User', sortable: true, render: (u) => (
              <div className="flex items-center gap-2.5">
                <UserAvatar name={u.name} hue={u.avatarHue} size="sm" />
                <div><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email}</p></div>
              </div>
            ),
          },
          { key: 'role', header: 'Role', sortable: true, render: (u) => <Badge variant="outline">{ROLE_LABELS[u.role]}</Badge> },
          { key: 'status', header: 'Status', render: (u) => <StatusBadge status={u.status} /> },
          { key: 'lastLoginAt', header: 'Last sign-in', render: (u) => <span className="text-xs text-muted-foreground">{fmtRelative(u.lastLoginAt)}</span> },
          {
            key: 'toggle', header: '', render: (u) => (
              <div onClick={(e) => e.stopPropagation()}>
                <Switch checked={u.status === 'active'} onCheckedChange={() => toggleUser(u)} aria-label={`Toggle ${u.name}`} />
              </div>
            ),
          },
        ]}
      />

      {/* user detail dialog */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-lg">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5"><UserAvatar name={detail.name} hue={detail.avatarHue} /> {detail.name}</DialogTitle>
                <DialogDescription>{ROLE_LABELS[detail.role]} · {detail.email} · joined {fmtDateTime(detail.createdAt)}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">RECENT SESSIONS ON THIS COMPUTER (simulated)</p>
                  <div className="space-y-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg border p-2 text-xs">
                        <span className="flex items-center gap-1.5"><MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground" /> {['DEV-017', 'DEV-043', 'Browser (iPad)'][i]}</span>
                        <span className="text-muted-foreground">{fmtRelative(new Date(Date.now() - (i + 1) * 86400000).toISOString())}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">AUDIT HISTORY (this device)</p>
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs text-muted-foreground">
                    {store.local().auditLog.slice(0, 4).map((a) => (
                      <p key={a.id}>{fmtDateTime(a.at)} — {a.detail}</p>
                    ))}
                  </div>
                </div>
                <p className="flex items-start gap-1.5 rounded-md bg-muted p-2.5 text-xs text-muted-foreground"><KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Password resets require the user to be reachable on a paired computer, or an administrator-generated reset code (simulated).</p>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => { toast('Password reset code generated (simulated)'); }}>Reset password</Button>
                <Button size="sm" onClick={() => setDetail(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite a user</DialogTitle><DialogDescription>Creates the account locally; it propagates via authorized sync.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            <div><Label>Full name</Label><Input className="mt-1" placeholder="e.g. Mrs. Halima Bala" /></div>
            <div><Label>Email</Label><Input className="mt-1" placeholder="name@school.ng" /></div>
            <div><Label>Role</Label>
              <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" aria-label="Role">
                {['teacher', 'exam_officer', 'invigilator', 'hod', 'administrator', 'parent'].map((r) => <option key={r} value={r}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS]}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={() => { setInviteOpen(false); toast.success('Invitation created', { description: 'The account is active on this computer and will sync to authorized peers.' }); }}>Create account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// Roles & permissions matrix
// ============================================================

export function RolesScreen() {
  const store = useDemoStore();
  const [selectedId, setSelectedId] = React.useState('role-teacher');
  const roles = store.world.roleDefinitions;
  const role = roles.find((r) => r.id === selectedId)!;
  const [perms, setPerms] = React.useState<PermissionKey[]>(role.permissions);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newPerms, setNewPerms] = React.useState<PermissionKey[]>([]);
  const [customRoles, setCustomRoles] = React.useState<RoleDefinition[]>([]);

  React.useEffect(() => {
    setPerms(role.permissions);
  }, [selectedId]);

  const allRoles = [...roles, ...customRoles];
  const toggle = (p: PermissionKey) => setPerms((ps) => ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]);

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        description="Granular role-based access control. Two users on the same computer see entirely different navigation."
        icon={<ShieldCheck className="h-5 w-5" />}
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New custom role</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-4">
        <SectionCard title="Roles">
          <div className="space-y-1.5">
            {allRoles.map((r) => (
              <button key={r.id} onClick={() => setSelectedId(r.id)} className={`w-full rounded-lg border p-2.5 text-left transition-colors ${selectedId === r.id ? 'border-primary ring-1 ring-primary/20' : 'hover:bg-accent'}`}>
                <p className="flex items-center justify-between text-sm font-medium">{r.name} {r.system && <Badge variant="outline" className="text-[9px]">system</Badge>}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.memberCount} member(s) · {r.permissions.length} perms</p>
              </button>
            ))}
          </div>
        </SectionCard>
        <div className="lg:col-span-3">
          <SectionCard
            title={`${role.name} — permissions`}
            description={role.description}
            action={
              <Button size="sm" onClick={() => { toast.success(`Permissions saved for ${role.name}`, { description: 'Changes apply on next sign-in. Audit event recorded.' }); store.audit('permission_change', role.id, `Permissions updated for role "${role.name}" (${perms.length} granted)`, 'warning'); }}>
                <Save className="mr-1.5 h-4 w-4" /> Save changes
              </Button>
            }
          >
            <div className="space-y-4">
              {PERMISSION_GROUPS.map((g) => (
                <div key={g.group}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</p>
                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {g.perms.map((p) => (
                      <label key={p.key} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs hover:bg-accent">
                        <Checkbox checked={perms.includes(p.key)} onCheckedChange={() => toggle(p.key)} />
                        <span className="flex-1">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create custom role</DialogTitle><DialogDescription>Name it and pick the exact permission set.</DialogDescription></DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Lab Assistant" aria-label="Role name" />
          <div className="max-h-56 space-y-3 overflow-y-auto rounded-lg border p-3">
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.group}>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">{g.group}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.perms.map((p) => (
                    <label key={p.key} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${newPerms.includes(p.key) ? 'border-primary bg-primary/10 text-primary' : ''}`}>
                      <Checkbox className="hidden" checked={newPerms.includes(p.key)} onCheckedChange={() => setNewPerms((ps) => ps.includes(p.key) ? ps.filter((x) => x !== p.key) : [...ps, p.key])} />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => { if (newName.trim()) { const r: RoleDefinition = { id: `role-custom-${Date.now()}`, name: newName.trim(), description: 'Custom role created by administrator', system: false, permissions: newPerms, memberCount: 0 }; setCustomRoles((cs) => [...cs, r]); setSelectedId(r.id); setCreateOpen(false); setNewName(''); setNewPerms([]); toast.success(`Role "${r.name}" created`); } }}>Create role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// My profile (account)
// ============================================================

export function AccountScreen() {
  const store = useDemoStore();
  const user = store.currentUser()!;
  const local = store.local();
  return (
    <div>
      <PageHeader title="My profile" description="Your account, session and activity on this computer." icon={<CircleUser className="h-5 w-5" />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Account">
          <div className="flex items-center gap-3">
            <UserAvatar name={user.name} hue={user.avatarHue} size="lg" />
            <div>
              <p className="font-semibold">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
              <Badge variant="outline" className="mt-1">{ROLE_LABELS[user.role]}</Badge>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Session device</span><span>{store.activeDeviceId}</span></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Signed in</span><span>{fmtRelative(store.session?.startedAt)}</span></div>
            <div className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">Permissions</span><span>{store.roleDef()?.permissions.length ?? 0} granted</span></div>
          </div>
        </SectionCard>
        <SectionCard title="My recent activity" className="lg:col-span-2">
          <div className="space-y-2">
            {local.auditLog.filter((a) => a.userName === user.name).slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border p-2.5 text-xs">
                <span>{a.detail}</span>
                <span className="text-muted-foreground">{fmtRelative(a.at)}</span>
              </div>
            ))}
            {local.auditLog.filter((a) => a.userName === user.name).length === 0 && <EmptyState title="No personal activity yet" description="Actions you take on this computer are recorded in its local audit log." />}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
