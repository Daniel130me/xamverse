/** Shared formatting + status utilities for the prototype */
import type { AssessmentStatus, QuestionStatus, QuestionType, Role, TransferStatus, ConflictStatus } from './types';

export const ROLE_LABELS: Record<Role, string> = {
  proprietor: 'Proprietor',
  administrator: 'Administrator',
  exam_officer: 'Examination Officer',
  hod: 'Head of Department',
  teacher: 'Teacher',
  invigilator: 'Invigilator',
  student: 'Student',
  parent: 'Parent / Guardian',
  support: 'Technical Support',
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: 'Single choice',
  multi_choice: 'Multiple response',
  true_false: 'True / False',
  short_answer: 'Short answer',
  numeric: 'Numerical answer',
  essay: 'Essay',
  matching: 'Matching',
  ordering: 'Ordering',
  fill_blank: 'Fill in the blank',
};

export const ASSESSMENT_STATUS_LABELS: Record<AssessmentStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  revision_requested: 'Revision requested',
  rejected: 'Rejected',
  approved: 'Approved',
  scheduled: 'Scheduled',
  ready_for_distribution: 'Ready for distribution',
  distributing: 'Distribution in progress',
  distributed: 'Distributed',
  active: 'Active',
  completed: 'Completed',
  marking: 'Marking in progress',
  awaiting_result_approval: 'Awaiting result approval',
  results_released: 'Results released',
  archived: 'Archived',
};

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  queued: 'Queued',
  transferring: 'Transferring',
  completed: 'Completed',
  failed: 'Failed',
  blocked_offline: 'Peer offline',
  cancelled: 'Cancelled',
};

export const CONFLICT_STATUS_LABELS: Record<ConflictStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  deferred: 'Deferred',
};

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'progress';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  info: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900',
  success: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  warning: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  danger: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900',
  progress: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900',
};

export function statusTone(status: string): Tone {
  switch (status) {
    case 'approved': case 'distributed': case 'completed': case 'results_released': case 'published':
    case 'success': case 'active': case 'healthy': case 'trusted': case 'online': case 'marked': case 'paid':
      return 'success';
    case 'pending_approval': case 'queued': case 'scheduled': case 'grace_period': case 'warning':
    case 'planned': case 'awaiting_moderation': case 'in_progress': case 'flagged': case 'pending': case 'suspended':
      return 'warning';
    case 'rejected': case 'failed': case 'blocked_offline': case 'expired': case 'invalid': case 'revoked':
    case 'error': case 'offline': case 'failure': case 'unauthorized_attempt': case 'blocked': case 'duplicate':
      return 'danger';
    case 'distributing': case 'transferring': case 'marking': case 'syncing': case 'conflict': case 'deferred':
      return 'progress';
    case 'draft': case 'archived': case 'inactive': case 'completed_neutral': case 'unpaired':
      return 'neutral';
    default:
      return 'info';
  }
}

export function StatusBadge({ status, label, className = '' }: { status: string; label?: string; className?: string }) {
  const tone = statusTone(status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label ?? status}
    </span>
  );
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(iso?: string): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function initials(name: string): string {
  return name
    .replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.|Alhaji|Chief)\s+/, '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function avatarStyle(hue: number): React.CSSProperties {
  return { backgroundColor: `oklch(0.72 0.12 ${hue})` };
}

export function gradeBand(scheme: { grade: string; min: number; max: number }[], pct: number): string {
  const band = scheme.find((b) => pct >= b.min && pct <= b.max);
  return band?.grade ?? '—';
}
