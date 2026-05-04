import {
  ACTIVITY_LOG_AREAS,
  ACTIVITY_LOG_STATUSES,
  type ActivityLogArea,
  type ActivityLogEntry,
  type ActivityLogStatus,
} from '@firebase-desk/repo-contracts';
import { Badge, Button, cn, DockedPanel, Input } from '@firebase-desk/ui';
import { Download, ExternalLink, Maximize2, Minimize2, Trash2, X } from 'lucide-react';
import { useState } from 'react';

export interface ActivityDrawerProps {
  readonly area: ActivityLogArea | 'all';
  readonly entries: ReadonlyArray<ActivityLogEntry>;
  readonly expanded?: boolean | undefined;
  readonly isLoading?: boolean | undefined;
  readonly onAreaChange: (area: ActivityLogArea | 'all') => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
  readonly onExport: () => void;
  readonly onExpandedChange?: ((expanded: boolean) => void) | undefined;
  readonly onOpenTarget?: ((entry: ActivityLogEntry) => void) | undefined;
  readonly onSearchChange: (search: string) => void;
  readonly onStatusChange: (status: ActivityLogStatus | 'all') => void;
  readonly open: boolean;
  readonly search: string;
  readonly status: ActivityLogStatus | 'all';
}

export function ActivityDrawer(
  {
    area,
    entries,
    expanded = false,
    isLoading = false,
    onAreaChange,
    onClear,
    onClose,
    onExport,
    onExpandedChange,
    onOpenTarget,
    onSearchChange,
    onStatusChange,
    open,
    search,
    status,
  }: ActivityDrawerProps,
) {
  if (!open) return null;
  return (
    <DockedPanel
      aria-label='Activity'
      className={cn(
        'z-popover grid min-h-0',
        expanded ? 'h-[70vh] max-h-[720px]' : 'h-80',
      )}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header className='flex h-10 items-center gap-2 border-b border-border-subtle px-3'>
        <div className='min-w-0 flex-1'>
          <div className='text-sm font-semibold text-text-primary'>Activity</div>
        </div>
        <Button size='xs' variant='secondary' onClick={onExport}>
          <Download size={13} aria-hidden='true' /> Export
        </Button>
        {onExpandedChange
          ? (
            <Button
              aria-expanded={expanded}
              size='xs'
              variant='secondary'
              onClick={() => onExpandedChange(!expanded)}
            >
              {expanded
                ? <Minimize2 size={13} aria-hidden='true' />
                : <Maximize2 size={13} aria-hidden='true' />}
              {expanded ? 'Collapse' : 'Expand'}
            </Button>
          )
          : null}
        <Button size='xs' variant='secondary' onClick={onClear}>
          <Trash2 size={13} aria-hidden='true' /> Clear
        </Button>
        <Button size='xs' variant='ghost' onClick={onClose}>
          <X size={13} aria-hidden='true' /> Close
        </Button>
      </header>
      <div className='grid min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
        <div className='flex items-center gap-2 border-b border-border-subtle p-2'>
          <Input
            aria-label='Search activity'
            className='min-w-0 flex-1'
            placeholder='Search activity'
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
          <select
            aria-label='Activity area'
            className='h-[var(--density-control-height)] rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary'
            value={area}
            onChange={(event) => onAreaChange(event.currentTarget.value as ActivityLogArea | 'all')}
          >
            <option value='all'>all areas</option>
            {ACTIVITY_LOG_AREAS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            aria-label='Activity status'
            className='h-[var(--density-control-height)] rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary'
            value={status}
            onChange={(event) =>
              onStatusChange(event.currentTarget.value as ActivityLogStatus | 'all')}
          >
            <option value='all'>all statuses</option>
            {ACTIVITY_LOG_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className='min-h-0 overflow-auto'>
          {isLoading
            ? <div className='p-4 text-sm text-text-secondary'>Loading activity</div>
            : entries.length === 0
            ? <div className='p-4 text-sm text-text-secondary'>No activity</div>
            : entries.map((entry) => (
              <ActivityEntryRow key={entry.id} entry={entry} onOpenTarget={onOpenTarget} />
            ))}
        </div>
      </div>
    </DockedPanel>
  );
}

function ActivityEntryRow(
  {
    entry,
    onOpenTarget,
  }: {
    readonly entry: ActivityLogEntry;
    readonly onOpenTarget?: ((entry: ActivityLogEntry) => void) | undefined;
  },
) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className='border-b border-border-subtle'
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className='grid cursor-pointer grid-cols-[112px_92px_86px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-xs hover:bg-action-ghost-hover'>
        <span className='font-mono text-text-muted'>{timeLabel(entry.timestamp)}</span>
        <Badge variant={badgeVariant(entry.status)}>{entry.status}</Badge>
        <span className='font-mono text-text-secondary'>{entry.area}</span>
        <span className='min-w-0 truncate text-sm text-text-primary'>
          {entry.action}
          <span className='text-text-muted'>· {entry.summary}</span>
        </span>
        <span className='flex items-center gap-2'>
          {entry.durationMs !== undefined
            ? <span className='font-mono text-text-muted'>{entry.durationMs}ms</span>
            : null}
          {onOpenTarget && entry.target
            ? (
              <Button
                size='xs'
                variant='ghost'
                onClick={(event) => {
                  event.preventDefault();
                  onOpenTarget(entry);
                }}
              >
                <ExternalLink size={13} aria-hidden='true' /> Open
              </Button>
            )
            : null}
        </span>
      </summary>
      {open
        ? (
          <div className='grid gap-2 bg-bg-subtle px-3 py-2 text-xs'>
            {entry.target
              ? <ActivityDetail label='Target' value={targetLabel(entry)} />
              : null}
            {entry.error
              ? <ActivityDetail label='Error' value={entry.error.message} />
              : null}
            <JsonBlock label='Metadata' value={entry.metadata ?? {}} />
            {entry.payload ? <JsonBlock label='Payload' value={entry.payload} /> : null}
          </div>
        )
        : null}
    </details>
  );
}

function ActivityDetail({ label, value }: { readonly label: string; readonly value: string; }) {
  return (
    <div className='grid grid-cols-[80px_minmax(0,1fr)] gap-2'>
      <span className='text-text-muted'>{label}</span>
      <span className='min-w-0 select-text break-all font-mono text-text-secondary'>{value}</span>
    </div>
  );
}

function JsonBlock({ label, value }: { readonly label: string; readonly value: unknown; }) {
  const { text, truncated } = boundedPrettyJson(value, JSON_PREVIEW_LIMIT);
  return (
    <div className='grid gap-1'>
      <span className='text-text-muted'>
        {label}
        {truncated
          ? (
            <span className='ml-2 text-text-muted'>
              · truncated for display (&gt;{formatBytes(JSON_PREVIEW_LIMIT)})
            </span>
          )
          : null}
      </span>
      <pre className='max-h-32 select-text overflow-auto rounded-md border border-border-subtle bg-bg-panel p-2 font-mono text-xs text-text-secondary'>
        {text}
        {truncated ? '\n… (truncated)' : null}
      </pre>
    </div>
  );
}

const JSON_PREVIEW_LIMIT = 8 * 1024;

function jsonIndent(depth: number): string {
  return '  '.repeat(depth);
}

// Pretty-prints JSON with a character budget. Stops walking once the budget is exceeded so large
// document payloads do not freeze the activity drawer when expanded.
function boundedPrettyJson(
  value: unknown,
  limit: number,
): { text: string; truncated: boolean; } {
  let out = '';
  let truncated = false;
  const seen = new WeakSet<object>();
  function append(chunk: string): boolean {
    if (out.length >= limit) {
      truncated = true;
      return false;
    }
    out += chunk;
    if (out.length >= limit) {
      truncated = true;
      return false;
    }
    return true;
  }
  function write(node: unknown, depth: number): boolean {
    if (out.length >= limit) {
      truncated = true;
      return false;
    }
    if (node === null || node === undefined) return append('null');
    const t = typeof node;
    if (t === 'string') return append(JSON.stringify(node as string));
    if (t === 'number' || t === 'boolean') return append(String(node));
    if (Array.isArray(node)) {
      if (seen.has(node)) return append('null');
      seen.add(node);
      if (node.length === 0) return append('[]');
      if (!append('[\n')) return false;
      for (let i = 0; i < node.length; i += 1) {
        if (!append(jsonIndent(depth + 1))) return false;
        if (!write(node[i], depth + 1)) return false;
        if (i < node.length - 1 && !append(',')) return false;
        if (!append('\n')) return false;
      }
      return append(`${jsonIndent(depth)}]`);
    }
    if (t === 'object') {
      const obj = node as Record<string, unknown>;
      if (seen.has(obj)) return append('{}');
      seen.add(obj);
      const keys = Object.keys(obj);
      if (keys.length === 0) return append('{}');
      if (!append('{\n')) return false;
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i]!;
        if (!append(`${jsonIndent(depth + 1)}${JSON.stringify(key)}: `)) return false;
        if (!write(obj[key], depth + 1)) return false;
        if (i < keys.length - 1 && !append(',')) return false;
        if (!append('\n')) return false;
      }
      return append(`${jsonIndent(depth)}}`);
    }
    try {
      return append(JSON.stringify(node));
    } catch {
      return append('null');
    }
  }
  write(value, 0);
  return { text: out, truncated };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function badgeVariant(status: ActivityLogStatus): 'danger' | 'neutral' | 'success' | 'warning' {
  if (status === 'success') return 'success';
  if (status === 'failure') return 'danger';
  if (status === 'conflict') return 'warning';
  return 'neutral';
}

function targetLabel(entry: ActivityLogEntry): string {
  return entry.target?.path ?? entry.target?.uid ?? entry.target?.label ?? entry.target?.type ?? '';
}

function timeLabel(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}
