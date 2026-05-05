import { HotkeysProvider } from '@firebase-desk/hotkeys';
import { AppearanceProvider } from '@firebase-desk/product-ui';
import type { DataMode, SettingsSnapshot } from '@firebase-desk/repo-contracts';
import { Button, InlineAlert } from '@firebase-desk/ui';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import splashLogoUrl from '../assets/splash-logo.png';
import { AppShell } from './AppShell.tsx';
import { RenderErrorBoundary } from './RenderErrorBoundary.tsx';
import { createRepositories, RepositoryProvider } from './RepositoryProvider.tsx';
import { type AppRuntime, isDemoRuntime, resolveAppRuntime } from './runtime.ts';

interface AppConfig {
  readonly appVersion: string;
  readonly dataMode: DataMode;
}

function SplashScreen() {
  return (
    <section
      aria-label='Loading Firebase Desk'
      className='grid h-screen place-items-center bg-slate-50 px-8'
    >
      <div className='flex w-full max-w-[34rem] flex-col items-center'>
        <img
          src={splashLogoUrl}
          alt='Firebase Desk'
          className='w-full object-contain'
          draggable={false}
        />
        <div
          aria-hidden='true'
          className='mt-6 h-1 w-28 overflow-hidden rounded-full bg-slate-200'
        >
          <div className='h-full w-2/5 rounded-full bg-action-primary motion-safe:animate-pulse' />
        </div>
      </div>
    </section>
  );
}

function BootFailureScreen(
  { message, onRetry }: { readonly message: string; readonly onRetry: () => void; },
) {
  return (
    <section
      aria-label='Firebase Desk failed to start'
      className='grid h-screen place-items-center bg-slate-50 px-8'
    >
      <div className='flex w-full max-w-[34rem] flex-col gap-4 rounded-lg border border-border-subtle bg-bg-panel p-6 shadow-lg'>
        <div>
          <h1 className='text-lg font-semibold text-text-primary'>Could not start Firebase Desk</h1>
          <p className='mt-1 text-sm text-text-muted'>
            Configuration or settings could not be loaded.
          </p>
        </div>
        <InlineAlert variant='danger'>{message}</InlineAlert>
        <div className='flex justify-end'>
          <Button variant='primary' onClick={onRetry}>Retry</Button>
        </div>
      </div>
    </section>
  );
}

export function App() {
  const runtime = resolveAppRuntime();
  const demoMode = isDemoRuntime(runtime);
  const [dataMode, setDataMode] = useState<DataMode | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);

  const handleDataModeChange = useCallback((nextDataMode: DataMode) => {
    setBootError(null);
    setSnapshot(null);
    setDataMode(nextDataMode);
  }, []);

  const retryBoot = useCallback(() => {
    setBootError(null);
    setAppVersion(null);
    setDataMode(null);
    setSnapshot(null);
    setBootAttempt((attempt) => attempt + 1);
  }, []);

  const repositories = useMemo(
    () =>
      dataMode
        ? createRepositories({ dataMode, demoMode, onDataModeChange: handleDataModeChange })
        : null,
    [dataMode, demoMode, handleDataModeChange],
  );
  const handleHotkeySettingsError = useCallback((message: string) => {
    void repositories?.activity.append({
      action: 'Load hotkey overrides',
      area: 'settings',
      error: { message },
      status: 'failure',
      summary: message,
      target: { type: 'settings' },
    }).catch(() => undefined);
  }, [repositories]);

  useEffect(() => {
    let cancelled = false;
    setBootError(null);
    loadAppConfig(runtime).then((config) => {
      if (!cancelled) {
        setAppVersion(config.appVersion);
        setDataMode(config.dataMode);
      }
    }).catch((error) => {
      if (!cancelled) {
        setBootError(messageFromError(error, 'Could not load app configuration.'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bootAttempt, runtime]);

  useEffect(() => {
    if (!repositories) return;
    let cancelled = false;
    setSnapshot(null);
    repositories.settings.load().then((nextSnapshot) => {
      if (!cancelled) setSnapshot(nextSnapshot);
    }).catch((error) => {
      if (!cancelled) {
        setBootError(messageFromError(error, 'Could not load app settings.'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  if (bootError) return <BootFailureScreen message={bootError} onRetry={retryBoot} />;
  if (!repositories || !snapshot || appVersion === null) return <SplashScreen />;

  return (
    <RepositoryProvider repositories={repositories}>
      <HotkeysProvider settings={repositories.settings} onError={handleHotkeySettingsError}>
        <AppearanceProvider settings={repositories.settings}>
          <div
            style={{
              '--sidebar-width': `${snapshot.sidebarWidth}px`,
              '--inspector-width': `${snapshot.inspectorWidth}px`,
              height: '100vh',
            } as CSSProperties}
          >
            <RenderErrorBoundary label='Firebase Desk' resetKey={dataMode ?? 'mock'}>
              <AppShell
                appVersion={appVersion}
                dataMode={dataMode ?? 'mock'}
                demoMode={demoMode}
                initialSidebarWidth={snapshot.sidebarWidth}
              />
            </RenderErrorBoundary>
          </div>
        </AppearanceProvider>
      </HotkeysProvider>
    </RepositoryProvider>
  );
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function loadAppConfig(runtime: AppRuntime): Promise<AppConfig> {
  if (typeof window !== 'undefined' && window.firebaseDesk?.app?.getConfig) {
    return await window.firebaseDesk.app.getConfig();
  }
  if (runtime === 'demo') {
    return { appVersion: 'demo', dataMode: 'mock' };
  }
  if (import.meta.env.DEV) {
    return { appVersion: 'dev-browser', dataMode: 'mock' };
  }
  throw new Error('Firebase Desk preload app API is unavailable.');
}
