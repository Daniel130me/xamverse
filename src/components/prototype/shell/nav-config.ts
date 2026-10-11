/** Role-aware navigation configuration for the app shell */
import type { PermissionKey } from '@/lib/prototype/types';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  permission?: PermissionKey | PermissionKey[];
  badgeKey?: 'approvals' | 'conflicts' | 'notifications';
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/app/dashboard', icon: 'LayoutDashboard' },
    ],
  },
  {
    label: 'Academics',
    items: [
      { label: 'School Profile', path: '/app/school/profile', icon: 'School', permission: 'school.manage' },
      { label: 'Academic Setup', path: '/app/school/academic', icon: 'CalendarRange', permission: 'academic.manage' },
      { label: 'Classes & Arms', path: '/app/school/classes', icon: 'Network', permission: 'academic.manage' },
      { label: 'Subjects', path: '/app/school/subjects', icon: 'BookOpen', permission: 'academic.manage' },
      { label: 'Staff', path: '/app/school/staff', icon: 'Users', permission: 'users.manage' },
      { label: 'Students', path: '/app/school/students', icon: 'GraduationCap', permission: 'users.manage' },
    ],
  },
  {
    label: 'Users & Access',
    items: [
      { label: 'User Accounts', path: '/app/users', icon: 'UserCog', permission: 'users.manage' },
      { label: 'Roles & Permissions', path: '/app/users/roles', icon: 'ShieldCheck', permission: 'roles.manage' },
    ],
  },
  {
    label: 'Learning Content',
    items: [
      { label: 'Question Banks', path: '/app/questions', icon: 'Layers', permission: 'questions.view' },
      { label: 'AI Question Assistant', path: '/app/ai-assistant', icon: 'Sparkles', permission: 'ai.use' },
    ],
  },
  {
    label: 'Assessments',
    items: [
      { label: 'Assessments', path: '/app/assessments', icon: 'FileText', permission: 'assessments.view' },
      { label: 'Approvals', path: '/app/approvals', icon: 'Stamp', permission: 'assessments.approve', badgeKey: 'approvals' },
      { label: 'Exam Sessions', path: '/app/exams', icon: 'MonitorPlay', permission: ['exams.monitor', 'exams.invigilate'] },
    ],
  },
  {
    label: 'Results',
    items: [
      { label: 'Results & Marking', path: '/app/results', icon: 'ClipboardCheck', permission: 'results.view_school' },
      { label: 'Analytics & Reports', path: '/app/analytics', icon: 'BarChart3', permission: 'analytics.view' },
    ],
  },
  {
    label: 'Computers & Sync',
    items: [
      { label: 'Computers & Sync', path: '/app/computers', icon: 'MonitorSmartphone', permission: 'devices.view' },
      { label: 'Sync Centre', path: '/app/sync', icon: 'RefreshCcw', permission: 'devices.view' },
      { label: 'Conflicts', path: '/app/conflicts', icon: 'GitMerge', permission: 'devices.view', badgeKey: 'conflicts' },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Notifications', path: '/app/notifications', icon: 'Bell', badgeKey: 'notifications' },
      { label: 'Licensing', path: '/app/licensing', icon: 'KeyRound', permission: 'licence.manage' },
      { label: 'Updates', path: '/app/updates', icon: 'PackageCheck', permission: 'updates.manage' },
      { label: 'Backups', path: '/app/backups', icon: 'DatabaseBackup', permission: 'backups.manage' },
      { label: 'Audit Logs', path: '/app/audit', icon: 'ScrollText', permission: 'audit.view' },
      { label: 'Settings', path: '/app/settings', icon: 'Settings', permission: 'settings.manage' },
      { label: 'Help & Support', path: '/app/help', icon: 'LifeBuoy' },
    ],
  },
];

/** simple icon registry to avoid dynamic imports */
export const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {};
