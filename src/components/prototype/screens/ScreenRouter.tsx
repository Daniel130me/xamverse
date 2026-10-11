'use client';

/**
 * ScreenRouter — maps /app/* paths to module screens.
 * Permission checks produce AccessDenied states; unknown routes fall back to dashboard.
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { AccessDenied, EmptyState } from '../shared/ui-kit';
import { ROLE_LABELS } from '@/lib/prototype/ui-utils';
import { Button } from '@/components/ui/button';
import type { PermissionKey } from '@/lib/prototype/types';

// lazy imports are avoided intentionally — everything is client-side local
import {
  SchoolProfileScreen, AcademicSetupScreen, ClassesScreen, SubjectsScreen, StaffScreen,
  StudentsScreen, StudentDetailScreen, EnrollmentScreen,
} from './SchoolScreens';
import { UsersScreen, RolesScreen, AccountScreen } from './UsersScreens';
import { QuestionBanksScreen, QuestionEditorScreen, AiAssistantScreen } from './QuestionScreens';
import { AssessmentsScreen, AssessmentWizardScreen, AssessmentDetailScreen, ApprovalsScreen } from './AssessmentScreens';
import { ExamSessionsScreen, ExamSessionDetailScreen } from './ExamScreens';
import { ResultsScreen, MarkingScreen, ResultsPublishScreen, AnalyticsScreen } from './ResultsScreens';
import { ComputersScreen, DeviceDetailScreen, SyncCentreScreen, ConflictsScreen } from './InfraScreens';
import {
  NotificationsScreen, LicensingScreen, UpdatesScreen, BackupsScreen, AuditScreen,
  SettingsScreen, HelpScreen, BrowserAccessScreen,
} from './SystemScreens';

interface Guard { perm?: PermissionKey | PermissionKey[]; }

const ROUTES: Record<string, { el: React.ComponentType; guard?: Guard }> = {
  '/app/dashboard': { el: () => null }, // handled by DashboardRouter
  '/app/school/profile': { el: SchoolProfileScreen, guard: { perm: 'school.manage' } },
  '/app/school/academic': { el: AcademicSetupScreen, guard: { perm: 'academic.manage' } },
  '/app/school/classes': { el: ClassesScreen, guard: { perm: 'academic.manage' } },
  '/app/school/subjects': { el: SubjectsScreen, guard: { perm: 'academic.manage' } },
  '/app/school/staff': { el: StaffScreen, guard: { perm: 'users.manage' } },
  '/app/school/students': { el: StudentsScreen, guard: { perm: 'users.manage' } },
  '/app/school/students/detail': { el: StudentDetailScreen, guard: { perm: 'users.manage' } },
  '/app/school/enrollment': { el: EnrollmentScreen, guard: { perm: 'users.manage' } },
  '/app/users': { el: UsersScreen, guard: { perm: 'users.manage' } },
  '/app/users/roles': { el: RolesScreen, guard: { perm: 'roles.manage' } },
  '/app/account': { el: AccountScreen },
  '/app/questions': { el: QuestionBanksScreen, guard: { perm: 'questions.view' } },
  '/app/questions/editor': { el: QuestionEditorScreen, guard: { perm: 'questions.create' } },
  '/app/questions/detail': { el: QuestionEditorScreen, guard: { perm: 'questions.view' } },
  '/app/ai-assistant': { el: AiAssistantScreen, guard: { perm: 'ai.use' } },
  '/app/assessments': { el: AssessmentsScreen, guard: { perm: 'assessments.view' } },
  '/app/assessments/new': { el: AssessmentWizardScreen, guard: { perm: 'assessments.create' } },
  '/app/assessments/detail': { el: AssessmentDetailScreen, guard: { perm: 'assessments.view' } },
  '/app/approvals': { el: ApprovalsScreen, guard: { perm: 'assessments.approve' } },
  '/app/exams': { el: ExamSessionsScreen, guard: { perm: ['exams.monitor', 'exams.invigilate'] } },
  '/app/exams/detail': { el: ExamSessionDetailScreen, guard: { perm: ['exams.monitor', 'exams.invigilate'] } },
  '/app/results': { el: ResultsScreen, guard: { perm: 'results.view_school' } },
  '/app/results/marking': { el: MarkingScreen, guard: { perm: 'results.mark' } },
  '/app/results/publish': { el: ResultsPublishScreen, guard: { perm: 'results.approve_release' } },
  '/app/analytics': { el: AnalyticsScreen, guard: { perm: 'analytics.view' } },
  '/app/computers': { el: ComputersScreen, guard: { perm: 'devices.view' } },
  '/app/computers/detail': { el: DeviceDetailScreen, guard: { perm: 'devices.view' } },
  '/app/sync': { el: SyncCentreScreen, guard: { perm: 'devices.view' } },
  '/app/conflicts': { el: ConflictsScreen, guard: { perm: 'devices.view' } },
  '/app/notifications': { el: NotificationsScreen },
  '/app/licensing': { el: LicensingScreen, guard: { perm: 'licence.manage' } },
  '/app/updates': { el: UpdatesScreen, guard: { perm: 'updates.manage' } },
  '/app/backups': { el: BackupsScreen, guard: { perm: 'backups.manage' } },
  '/app/audit': { el: AuditScreen, guard: { perm: 'audit.view' } },
  '/app/settings': { el: SettingsScreen, guard: { perm: 'settings.manage' } },
  '/app/help': { el: HelpScreen },
  '/app/settings/browser': { el: BrowserAccessScreen },
};

export function ScreenRouter() {
  const store = useDemoStore();
  const route = store.route;
  const rawPath = route.path;

  // Resolve route: exact match first, then strip trailing id segments.
  // /app/school/students/stu-amina → /app/school/students/detail → /app/school/students
  const parts = rawPath.split('/').filter(Boolean);
  let path = rawPath;
  if (!ROUTES[path] && parts.length >= 3 && parts[0] === 'app') {
    const candidates = [];
    for (let cut = parts.length - 1; cut >= 2; cut--) {
      candidates.push(`/${parts.slice(0, cut).join('/')}/detail`);
      candidates.push(`/${parts.slice(0, cut).join('/')}`);
    }
    path = candidates.find((c) => ROUTES[c]) ?? path;
  }
  const user = store.currentUser();

  // exact match
  const def = ROUTES[path];
  if (!def) {
    // some detail routes registered without /detail suffix (e.g. /app/questions/editor)
    const def2 = ROUTES[rawPath];
    if (def2) {
      if (def2.guard?.perm) {
        const required2 = Array.isArray(def2.guard.perm) ? def2.guard.perm : [def2.guard.perm];
        if (!required2.some((p) => store.can(p))) {
          return <AccessDenied roleLabel={user ? ROLE_LABELS[user.role] : undefined} />;
        }
      }
      const El2 = def2.el;
      return <El2 />;
    }
    return (
      <EmptyState
        title="Screen not found"
        description={`No screen is mapped for "${rawPath}". Use the sidebar to navigate.`}
        action={<Button size="sm" onClick={() => store.navigate('/app/dashboard')}>Go to dashboard</Button>}
      />
    );
  }
  if (def.guard?.perm) {
    const required = Array.isArray(def.guard.perm) ? def.guard.perm : [def.guard.perm];
    if (!required.some((p) => store.can(p))) {
      return <AccessDenied roleLabel={user ? ROLE_LABELS[user.role] : undefined} />;
    }
  }
  const El = def.el;
  return <El />;
}
