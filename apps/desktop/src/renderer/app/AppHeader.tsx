import type { AppearanceMode } from '@firebase-desk/design-tokens';
import { Badge, Button, IconButton } from '@firebase-desk/ui';
import { ArrowLeft, ArrowRight, Moon, Plus, Settings, Sun } from 'lucide-react';
import appIconUrl from '../assets/app-icon.png';

interface AppHeaderProps {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly dataMode: 'live' | 'mock';
  readonly mode: AppearanceMode;
  readonly onAddProject: () => void;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly onModeChange: (mode: AppearanceMode) => void;
  readonly onOpenSettings: () => void;
  readonly resolvedTheme: 'dark' | 'light';
}

export function AppHeader(
  {
    canGoBack,
    canGoForward,
    dataMode,
    mode,
    onAddProject,
    onBack,
    onForward,
    onModeChange,
    onOpenSettings,
    resolvedTheme,
  }: AppHeaderProps,
) {
  const reserveTrafficLightSpace = isMacPlatform();
  return (
    <header className='app-region-drag native-titlebar flex min-w-0 items-center gap-2 border-b border-border-subtle bg-bg-panel px-2'>
      {reserveTrafficLightSpace
        ? <span className='native-titlebar-traffic-spacer shrink-0' aria-hidden='true' />
        : null}
      <div className='app-region-no-drag flex h-full shrink-0 items-center gap-1 border-r border-border-subtle pr-2'>
        <IconButton
          disabled={!canGoBack}
          icon={<ArrowLeft size={14} aria-hidden='true' />}
          label='Back'
          size='xs'
          variant='ghost'
          onClick={onBack}
        />
        <IconButton
          disabled={!canGoForward}
          icon={<ArrowRight size={14} aria-hidden='true' />}
          label='Forward'
          size='xs'
          variant='ghost'
          onClick={onForward}
        />
      </div>
      <div className='flex min-w-0 items-center gap-2'>
        <span className='grid size-6 shrink-0 place-items-center overflow-hidden rounded-md border border-border-subtle bg-bg-surface shadow-sm'>
          <img src={appIconUrl} alt='' className='size-full object-cover' />
        </span>
        <strong className='truncate text-sm font-semibold text-text-primary'>Firebase Desk</strong>
        <Badge variant={dataMode === 'live' ? 'warning' : 'neutral'}>{dataMode}</Badge>
      </div>
      <div className='app-region-no-drag ml-auto flex shrink-0 items-center gap-2'>
        <Button variant='secondary' onClick={onOpenSettings}>
          <Settings size={14} aria-hidden='true' /> Settings
        </Button>
        <Button variant='primary' onClick={onAddProject}>
          <Plus size={14} aria-hidden='true' /> Add account
        </Button>
        <ThemeSegment mode={mode} resolvedTheme={resolvedTheme} onModeChange={onModeChange} />
      </div>
    </header>
  );
}

function isMacPlatform(): boolean {
  const preloadPlatform = typeof document === 'undefined'
    ? undefined
    : document.documentElement.dataset.platform;
  if (preloadPlatform) return preloadPlatform === 'darwin';
  if (typeof navigator === 'undefined') return false;
  return /\bMac/.test(navigator.platform) || /\bMac OS X\b/.test(navigator.userAgent);
}

function ThemeSegment(
  {
    mode,
    onModeChange,
    resolvedTheme,
  }: {
    readonly mode: AppearanceMode;
    readonly onModeChange: (mode: AppearanceMode) => void;
    readonly resolvedTheme: 'dark' | 'light';
  },
) {
  const activeTheme = mode === 'system' ? resolvedTheme : mode;
  return (
    <div className='inline-flex items-center gap-0.5 rounded-md border border-border bg-bg-subtle p-0.5'>
      <IconButton
        icon={<Sun size={14} aria-hidden='true' />}
        label='Light theme'
        size='xs'
        variant={activeTheme === 'light' ? 'secondary' : 'ghost'}
        onClick={() => onModeChange('light')}
      />
      <IconButton
        icon={<Moon size={14} aria-hidden='true' />}
        label='Dark theme'
        size='xs'
        variant={activeTheme === 'dark' ? 'secondary' : 'ghost'}
        onClick={() => onModeChange('dark')}
      />
    </div>
  );
}
