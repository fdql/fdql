import type { BackgroundJobEvent, BackgroundJobStatus } from '@firebase-desk/repo-contracts/jobs';

export type NativeContextMenuAction =
  | 'copy'
  | 'cut'
  | 'delete'
  | 'inspect'
  | 'open-link'
  | 'paste'
  | 'paste-and-match-style'
  | 'separator'
  | 'select-all';

export interface NativeContextMenuParams {
  readonly isEditable: boolean;
  readonly linkURL?: string | undefined;
  readonly selectionText?: string | undefined;
}

export interface JobNotification {
  readonly body: string;
  readonly jobId: string;
  readonly title: string;
}

const externalProtocols = new Set(['http:', 'https:', 'mailto:']);
const finalJobStatuses = new Set<BackgroundJobStatus>([
  'cancelled',
  'failed',
  'interrupted',
  'succeeded',
]);

export function shouldOpenExternally(targetUrl: string, currentUrl: string): boolean {
  const target = parseUrl(targetUrl);
  if (!target || !externalProtocols.has(target.protocol)) return false;
  if (target.protocol === 'mailto:') return true;

  return !isInternalAppNavigation(targetUrl, currentUrl);
}

export function isInternalAppNavigation(targetUrl: string, currentUrl: string): boolean {
  const target = parseUrl(targetUrl);
  const current = parseUrl(currentUrl);
  if (!target || !current) return false;
  if (target.protocol === 'file:' && current.protocol === 'file:') {
    return target.pathname === current.pathname;
  }
  if (!externalProtocols.has(target.protocol) || !externalProtocols.has(current.protocol)) {
    return false;
  }
  if (target.protocol === 'mailto:' || current.protocol === 'mailto:') return false;
  return target.origin === current.origin;
}

export function nativeContextMenuActions(
  params: NativeContextMenuParams,
  isDevelopment: boolean,
): ReadonlyArray<NativeContextMenuAction> {
  const actions: NativeContextMenuAction[] = [];

  if (params.linkURL && canOpenExternalUrl(params.linkURL)) actions.push('open-link', 'separator');

  if (params.isEditable) {
    actions.push(
      'cut',
      'copy',
      'paste',
      'paste-and-match-style',
      'separator',
      'delete',
      'select-all',
    );
  } else if (params.selectionText?.trim()) {
    actions.push('copy');
  }

  if (isDevelopment) {
    if (actions.length > 0 && actions.at(-1) !== 'separator') actions.push('separator');
    actions.push('inspect');
  }

  return trimSeparators(actions);
}

export function backgroundJobNotificationForEvent(
  event: BackgroundJobEvent,
): JobNotification | null {
  if (event.type !== 'job-updated' || !finalJobStatuses.has(event.job.status)) return null;
  if (!event.job.finishedAt || event.job.acknowledgedAt) return null;
  const outcome = jobOutcome(event.job.status);
  return {
    body: event.job.error?.message ?? event.job.summary ?? outcome,
    jobId: event.job.id,
    title: `${event.job.title} ${outcome}`,
  };
}

function jobOutcome(status: BackgroundJobStatus): string {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'interrupted') return 'interrupted';
  return status;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function canOpenExternalUrl(value: string): boolean {
  const url = parseUrl(value);
  return Boolean(url && externalProtocols.has(url.protocol));
}

function trimSeparators(
  actions: ReadonlyArray<NativeContextMenuAction>,
): ReadonlyArray<NativeContextMenuAction> {
  const trimmed = [...actions];
  while (trimmed[0] === 'separator') trimmed.shift();
  while (trimmed.at(-1) === 'separator') trimmed.pop();
  for (let index = trimmed.length - 1; index > 0; index -= 1) {
    if (trimmed[index] === 'separator' && trimmed[index - 1] === 'separator') {
      trimmed.splice(index, 1);
    }
  }
  return trimmed;
}
