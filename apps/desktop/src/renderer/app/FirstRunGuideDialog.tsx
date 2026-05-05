import { Button, Dialog, DialogContent, InlineAlert } from '@firebase-desk/ui';
import { Database, KeyRound, Play, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

interface FirstRunGuideDialogProps {
  readonly errorMessage: string | null;
  readonly open: boolean;
  readonly saving: boolean;
  readonly onKeepMock: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenSettings: () => void;
  readonly onSwitchToLive: () => void;
}

export function FirstRunGuideDialog(
  {
    errorMessage,
    open,
    saving,
    onKeepMock,
    onOpenChange,
    onOpenSettings,
    onSwitchToLive,
  }: FirstRunGuideDialogProps,
) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='w-[min(640px,calc(100vw-32px))]'
        description='Firebase Desk starts with local demo data so you can inspect workflows before connecting a project.'
        title='Try Firebase Desk in mock mode'
      >
        <InlineAlert variant='info'>
          Mock mode uses local sample data only. It does not read or write Firebase projects.
        </InlineAlert>
        {errorMessage ? <InlineAlert variant='danger'>{errorMessage}</InlineAlert> : null}
        <div className='grid gap-2 sm:grid-cols-2'>
          <GuideItem
            icon={<Database size={16} aria-hidden='true' />}
            title='Firestore workspace'
            text='Browse collections, run filtered queries, compare table/tree/JSON results, and edit documents safely.'
          />
          <GuideItem
            icon={<KeyRound size={16} aria-hidden='true' />}
            title='Authentication'
            text='Search users, inspect profile data, and review custom claims against predictable fixtures.'
          />
          <GuideItem
            icon={<Play size={16} aria-hidden='true' />}
            title='JavaScript Query'
            text='Run admin scripts against the demo repository and inspect results, logs, and errors.'
          />
          <GuideItem
            icon={<ShieldCheck size={16} aria-hidden='true' />}
            title='Connect when ready'
            text='Switch to live mode to add a service account or a Firebase Emulator profile.'
          />
        </div>
        <div className='flex flex-wrap justify-end gap-2 border-t border-border pt-3'>
          <Button disabled={saving} variant='ghost' onClick={onOpenSettings}>
            Open settings
          </Button>
          <Button disabled={saving} variant='secondary' onClick={onKeepMock}>
            Keep mock mode
          </Button>
          <Button disabled={saving} variant='primary' onClick={onSwitchToLive}>
            {saving ? 'Switching' : 'Switch to live'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GuideItem(
  { icon, text, title }: {
    readonly icon: ReactNode;
    readonly text: string;
    readonly title: string;
  },
) {
  return (
    <section className='grid gap-1 rounded-md border border-border-subtle bg-bg-panel p-3'>
      <div className='flex items-center gap-2 text-sm font-medium text-text-primary'>
        {icon}
        {title}
      </div>
      <p className='text-sm leading-5 text-text-secondary'>{text}</p>
    </section>
  );
}
