import { Button, InlineAlert } from '@firebase-desk/ui';
import { ExternalLink, RefreshCw, X } from 'lucide-react';

export interface UpdateNoticeProps {
  readonly message: string;
  readonly status: 'available' | 'failed';
  readonly onDismiss: () => void;
  readonly onOpenRelease: () => void;
  readonly onRetry: () => void;
}

export function UpdateNotice(
  { message, status, onDismiss, onOpenRelease, onRetry }: UpdateNoticeProps,
) {
  return (
    <InlineAlert
      className='flex min-h-8 items-center justify-between gap-2 rounded-none border-x-0 border-t-0 px-2 py-1 text-xs'
      variant={status === 'available' ? 'info' : 'warning'}
    >
      <span className='min-w-0 truncate' title={message}>{message}</span>
      <span className='flex shrink-0 items-center gap-1'>
        {status === 'available'
          ? (
            <Button size='xs' variant='secondary' onClick={onOpenRelease}>
              <ExternalLink size={13} aria-hidden='true' />
              Open release
            </Button>
          )
          : (
            <Button size='xs' variant='secondary' onClick={onRetry}>
              <RefreshCw size={13} aria-hidden='true' />
              Retry
            </Button>
          )}
        <Button size='xs' variant='ghost' onClick={onDismiss}>
          <X size={13} aria-hidden='true' />
          Dismiss
        </Button>
      </span>
    </InlineAlert>
  );
}
