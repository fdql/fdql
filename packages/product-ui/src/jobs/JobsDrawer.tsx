import type { BackgroundJob } from '@firebase-desk/repo-contracts/jobs';
import { Badge, Button, cn, DockedPanel, InlineAlert } from '@firebase-desk/ui';
import { Maximize2, Minimize2, Trash2, X } from 'lucide-react';

export interface JobsDrawerProps {
  readonly expanded?: boolean | undefined;
  readonly isLoading?: boolean | undefined;
  readonly jobs: ReadonlyArray<BackgroundJob>;
  readonly onCancel: (id: string) => void;
  readonly onClearCompleted: () => void;
  readonly onClose: () => void;
  readonly onExpandedChange?: ((expanded: boolean) => void) | undefined;
  readonly open: boolean;
}

export function JobsDrawer(
  {
    expanded = false,
    isLoading = false,
    jobs,
    onCancel,
    onClearCompleted,
    onClose,
    onExpandedChange,
    open,
  }: JobsDrawerProps,
) {
  if (!open) return null;
  return (
    <DockedPanel
      aria-label='Jobs'
      className={cn(
        'z-popover grid min-h-0 grid-rows-[auto_minmax(0,1fr)]',
        expanded ? 'h-[70vh] max-h-[720px]' : 'h-80',
      )}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header className='flex h-10 items-center gap-2 border-b border-border-subtle px-3'>
        <div className='min-w-0 flex-1 text-sm font-semibold text-text-primary'>Jobs</div>
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
        <Button size='xs' variant='secondary' onClick={onClearCompleted}>
          <Trash2 size={13} aria-hidden='true' /> Clear completed
        </Button>
        <Button size='xs' variant='ghost' onClick={onClose}>
          <X size={13} aria-hidden='true' /> Close
        </Button>
      </header>
      <div className='min-h-0 overflow-auto'>
        {isLoading
          ? <div className='p-4 text-sm text-text-secondary'>Loading jobs</div>
          : jobs.length === 0
          ? <div className='p-4 text-sm text-text-secondary'>No jobs</div>
          : jobs.map((job) => <JobRow key={job.id} job={job} onCancel={onCancel} />)}
      </div>
    </DockedPanel>
  );
}

function JobRow(
  {
    job,
    onCancel,
  }: {
    readonly job: BackgroundJob;
    readonly onCancel: (id: string) => void;
  },
) {
  const active = job.status === 'queued' || job.status === 'running';
  const progressPercent = jobProgressPercent(job);
  return (
    <details className='border-b border-border-subtle'>
      <summary className='grid cursor-pointer grid-cols-[112px_92px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-xs hover:bg-action-ghost-hover'>
        <span className='font-mono text-text-muted'>{timeLabel(job.updatedAt)}</span>
        <Badge variant={badgeVariant(job.status)}>{job.status}</Badge>
        <span className='min-w-0 truncate text-sm text-text-primary'>
          {job.title}
          <span className='text-text-muted'>· {job.summary ?? progressSummary(job)}</span>
        </span>
        {active
          ? (
            <Button
              disabled={job.cancelRequested}
              size='xs'
              variant='secondary'
              onClick={(event) => {
                event.preventDefault();
                onCancel(job.id);
              }}
            >
              Cancel
            </Button>
          )
          : null}
      </summary>
      <div className='grid gap-2 bg-bg-subtle px-3 py-2 text-xs'>
        <div className='h-2 overflow-hidden rounded-full bg-bg-panel'>
          <div
            aria-label={`${job.title} progress`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(progressPercent)}
            className='h-full bg-action-primary'
            role='progressbar'
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className='grid grid-cols-5 gap-2 font-mono text-text-secondary'>
          <span>read {job.progress.read}</span>
          <span>written {job.progress.written}</span>
          <span>deleted {job.progress.deleted}</span>
          <span>skipped {job.progress.skipped}</span>
          <span>failed {job.progress.failed}</span>
        </div>
        {job.progress.currentPath
          ? <Detail label='Current' value={job.progress.currentPath} />
          : null}
        {job.result?.filePath ? <Detail label='File' value={job.result.filePath} /> : null}
        {job.error ? <InlineAlert variant='danger'>{job.error.message}</InlineAlert> : null}
        <pre className='max-h-28 select-text overflow-auto rounded-md border border-border-subtle bg-bg-panel p-2 font-mono text-xs text-text-secondary'>
          {JSON.stringify(job.request, null, 2)}
        </pre>
      </div>
    </details>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: string; }) {
  return (
    <div className='grid grid-cols-[72px_minmax(0,1fr)] gap-2'>
      <span className='text-text-muted'>{label}</span>
      <span className='select-text break-all font-mono text-text-secondary'>{value}</span>
    </div>
  );
}

function progressSummary(job: BackgroundJob): string {
  if (job.status === 'queued') return 'Waiting';
  return `read ${job.progress.read}, wrote ${job.progress.written}, deleted ${job.progress.deleted}`;
}

function jobProgressPercent(job: BackgroundJob): number {
  const processed = job.progress.written + job.progress.deleted + job.progress.skipped
    + job.progress.failed;
  const total = Math.max(job.progress.read, processed);
  if (total === 0) return 8;
  return Math.min(100, Math.max(8, (processed / total) * 100));
}

function badgeVariant(status: BackgroundJob['status']) {
  if (status === 'failed' || status === 'interrupted') return 'danger';
  if (status === 'cancelled') return 'warning';
  if (status === 'succeeded') return 'success';
  return 'warning';
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
