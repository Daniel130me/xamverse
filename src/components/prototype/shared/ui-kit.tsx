'use client';

/** Reusable shared UI primitives for the prototype. */
import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search, Inbox, ShieldAlert, ArrowUpDown, Loader2,
} from 'lucide-react';
import { avatarStyle, initials } from '@/lib/prototype/ui-utils';

// ------------------------------------------------------------
// PageHeader with breadcrumbs
// ------------------------------------------------------------

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export function PageHeader({
  title, description, crumbs, actions, icon,
}: {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="opacity-50">/</span>}
              {c.onClick ? (
                <button onClick={c.onClick} className="hover:text-foreground hover:underline rounded focus:outline-none focus:ring-2 focus:ring-ring px-0.5">
                  {c.label}
                </button>
              ) : (
                <span>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon && <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>}
          <div>
            <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">{title}</h1>
            {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// StatCard
// ------------------------------------------------------------

export function StatCard({
  label, value, sub, icon, tone = 'neutral', onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'progress';
  onClick?: () => void;
}) {
  const toneClasses = {
    neutral: 'text-foreground bg-muted',
    success: 'text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-950',
    warning: 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-950',
    danger: 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-950',
    info: 'text-sky-600 bg-sky-100 dark:text-sky-400 dark:bg-sky-950',
    progress: 'text-violet-600 bg-violet-100 dark:text-violet-400 dark:bg-violet-950',
  }[tone];
  return (
    <Card
      className={`transition-shadow ${onClick ? 'cursor-pointer hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <CardContent className="flex items-start justify-between gap-3 p-4 lg:p-5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {icon && <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClasses}`}>{icon}</div>}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------
// EmptyState / AccessDenied / Loading
// ------------------------------------------------------------

export function EmptyState({
  title, description, action, icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function AccessDenied({ roleLabel, detail }: { roleLabel?: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-red-200 bg-red-50/50 px-6 py-14 text-center dark:border-red-900 dark:bg-red-950/20">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">Access denied</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {detail ?? `Your current role${roleLabel ? ` (${roleLabel})` : ''} does not have permission to open this section. Sign in with an authorized account on this computer to continue.`}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">This attempt has been recorded in the local audit log.</p>
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

// ------------------------------------------------------------
// DataTable — search, sort, filter, paginate, select, bulk
// ------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  render: (row: T) => React.ReactNode;
}

export function DataTable<T extends { id?: string }>({
  rows, columns, searchable = true, searchKeys, pageSize = 10, filters, bulkActions, emptyState, onRowClick, rowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  searchable?: boolean;
  searchKeys?: (row: T) => string;
  pageSize?: number;
  filters?: { key: string; label: string; options: { value: string; label: string }[]; match: (row: T, value: string) => boolean }[];
  bulkActions?: (selected: T[], clear: () => void) => React.ReactNode;
  emptyState?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowKey: (row: T, i: number) => string;
}) {
  const [query, setQuery] = React.useState('');
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<1 | -1>(1);
  const [page, setPage] = React.useState(0);
  const [filterVals, setFilterVals] = React.useState<Record<string, string>>({});
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  const filtered = React.useMemo(() => {
    let out = [...rows];
    if (query && searchKeys) {
      const q = query.toLowerCase();
      out = out.filter((r) => searchKeys(r).toLowerCase().includes(q));
    }
    (filters ?? []).forEach((f) => {
      const v = filterVals[f.key];
      if (v && v !== 'all') out = out.filter((r) => f.match(r, v));
    });
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        out.sort((a, b) => {
          const av = String((a as Record<string, unknown>)[sortKey] ?? '');
          const bv = String((b as Record<string, unknown>)[sortKey] ?? '');
          return av.localeCompare(bv) * sortDir;
        });
      }
    }
    return out;
  }, [rows, query, searchKeys, filters, filterVals, sortKey, sortDir, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const allPageSelected = pageRows.length > 0 && pageRows.every((_, i) => selected.has(page * pageSize + i));
  const selectedRows = Array.from(selected).map((i) => filtered[i]).filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search…" className="pl-8" aria-label="Search table" />
          </div>
        )}
        {(filters ?? []).map((f) => (
          <Select key={f.key} value={filterVals[f.key] ?? 'all'} onValueChange={(v) => { setFilterVals((s) => ({ ...s, [f.key]: v })); setPage(0); }}>
            <SelectTrigger className="w-40" aria-label={f.label}>
              <SelectValue placeholder={f.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{f.label}: All</SelectItem>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {bulkActions && selectedRows.length > 0 && bulkActions(selectedRows, () => setSelected(new Set()))}
        </div>
      </div>

      {filtered.length === 0 ? (
        emptyState ?? <EmptyState title="No records found" description="Try adjusting your search or filters." />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  {bulkActions && (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all on page"
                        checked={allPageSelected}
                        onCheckedChange={(v) => {
                          const s = new Set(selected);
                          pageRows.forEach((_, i) => {
                            const gi = page * pageSize + i;
                            if (v) s.add(gi);
                            else s.delete(gi);
                          });
                          setSelected(s);
                        }}
                      />
                    </TableHead>
                  )}
                  {columns.map((c) => (
                    <TableHead key={c.key} className={c.className}>
                      {c.sortable ? (
                        <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.key)}>
                          {c.header}
                          {sortKey === c.key ? (sortDir === 1 ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : (
                        c.header
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row, i) => {
                  const gi = page * pageSize + i;
                  const key = rowKey(row, gi);
                  return (
                    <TableRow
                      key={key}
                      className={onRowClick ? 'cursor-pointer' : ''}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      data-selected={selected.has(gi) || undefined}
                    >
                      {bulkActions && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select row ${gi}`}
                            checked={selected.has(gi)}
                            onCheckedChange={(v) => {
                              const s = new Set(selected);
                              if (v) s.add(gi);
                              else s.delete(gi);
                              setSelected(s);
                            }}
                          />
                        </TableCell>
                      )}
                      {columns.map((c) => (
                        <TableCell key={c.key} className={c.className}>
                          {c.render(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <span>{filtered.length} record{filtered.length === 1 ? '' : 's'}{selectedRows.length > 0 ? ` · ${selectedRows.length} selected` : ''}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span>Page {page + 1} of {pages}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// UserAvatar
// ------------------------------------------------------------

export function UserAvatar({ name, hue, size = 'md' }: { name: string; hue: number; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-12 w-12 text-sm' : 'h-9 w-9 text-xs';
  return (
    <Avatar className={cls}>
      <AvatarFallback style={avatarStyle(hue)} className="font-semibold text-white">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

// ------------------------------------------------------------
// SectionCard
// ------------------------------------------------------------

export function SectionCard({
  title, description, action, children, className = '',
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border bg-card ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 lg:px-5">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-4 lg:p-5">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------
// SyncTransferBar — progress with mock speed
// ------------------------------------------------------------

export function TransferProgress({ progress, speedMbps, status }: { progress: number; speedMbps: number; status: string }) {
  const active = status === 'transferring';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${status === 'failed' ? 'bg-red-500' : status === 'blocked_offline' ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${status === 'completed' ? 100 : progress}%` }}
        />
      </div>
      {active && <span className="text-[10px] tabular-nums text-muted-foreground">{speedMbps.toFixed(1)} MB/s</span>}
    </div>
  );
}

export { Badge, StatusBadge } from '@/lib/prototype/ui-utils';
