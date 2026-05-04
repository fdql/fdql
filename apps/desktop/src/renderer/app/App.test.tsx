import type { SettingsSnapshot } from '@firebase-desk/repo-contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

const settingsLoad = vi.hoisted(() => vi.fn());
const createRepositories = vi.hoisted(() => vi.fn());

vi.mock('@firebase-desk/hotkeys', () => ({
  HotkeysProvider: ({ children }: { readonly children: ReactNode; }) => <>{children}</>,
}));

vi.mock('@firebase-desk/product-ui', () => ({
  AppearanceProvider: ({ children }: { readonly children: ReactNode; }) => <>{children}</>,
}));

const appShellProps = vi.hoisted(() => vi.fn());

vi.mock('./AppShell.tsx', () => ({
  AppShell: (props: { readonly appVersion: string; }) => {
    appShellProps(props);
    return <div data-testid='app-shell' />;
  },
}));

vi.mock('./RepositoryProvider.tsx', () => ({
  createRepositories: (options: unknown) => {
    createRepositories(options);
    return {
      settings: { load: settingsLoad },
    };
  },
  RepositoryProvider: ({ children }: { readonly children: ReactNode; }) => <>{children}</>,
}));

describe('desktop App', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    settingsLoad.mockReset();
    createRepositories.mockReset();
    appShellProps.mockReset();
    vi.stubGlobal('firebaseDesk', {
      app: { getConfig: vi.fn().mockResolvedValue({ appVersion: '0.1.0', dataMode: 'mock' }) },
    });
  });

  it('shows the splash while settings load', () => {
    settingsLoad.mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(screen.getByLabelText('Loading Firebase Desk')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Firebase Desk' })).toBeTruthy();
  });

  it('shows the app shell after settings load', async () => {
    settingsLoad.mockResolvedValue(settingsSnapshot());

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeTruthy());
    expect(appShellProps).toHaveBeenCalledWith(expect.objectContaining({ appVersion: '0.1.0' }));
    expect(screen.queryByLabelText('Loading Firebase Desk')).toBeNull();
  });

  it('keeps the app version when data mode changes', async () => {
    settingsLoad.mockResolvedValue(settingsSnapshot());
    vi.stubGlobal('firebaseDesk', {
      app: { getConfig: vi.fn().mockResolvedValue({ appVersion: '0.1.0', dataMode: 'mock' }) },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeTruthy());
    const options = createRepositories.mock.calls.at(-1)?.[0] as {
      readonly onDataModeChange: (dataMode: 'live') => void;
    };

    await act(async () => options.onDataModeChange('live'));

    await waitFor(() =>
      expect(appShellProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ appVersion: '0.1.0' }),
      )
    );
  });

  it('shows a retryable boot failure when config load fails', async () => {
    const getConfig = vi.fn()
      .mockRejectedValueOnce(new Error('config unavailable'))
      .mockResolvedValue({ appVersion: '0.1.0', dataMode: 'mock' });
    settingsLoad.mockResolvedValue(settingsSnapshot());
    vi.stubGlobal('firebaseDesk', { app: { getConfig } });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText('Firebase Desk failed to start')).toBeTruthy()
    );
    expect(screen.getByText('config unavailable')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeTruthy());
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it('shows a retryable boot failure when preload app API is unavailable outside dev', async () => {
    settingsLoad.mockResolvedValue(settingsSnapshot());
    vi.stubGlobal('firebaseDesk', undefined);
    vi.stubEnv('DEV', false);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText('Firebase Desk failed to start')).toBeTruthy()
    );
    expect(screen.getByText('Firebase Desk preload app API is unavailable.')).toBeTruthy();
  });

  it('uses mock config in dev when preload app API is unavailable', async () => {
    settingsLoad.mockResolvedValue(settingsSnapshot());
    vi.stubGlobal('firebaseDesk', undefined);
    vi.stubEnv('DEV', true);

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeTruthy());
    expect(createRepositories).toHaveBeenCalledWith(
      expect.objectContaining({ dataMode: 'mock' }),
    );
    expect(appShellProps).toHaveBeenCalledWith(
      expect.objectContaining({ appVersion: 'dev-browser' }),
    );
  });

  it('shows a retryable boot failure when settings load fails', async () => {
    settingsLoad.mockRejectedValueOnce(new Error('settings unavailable'))
      .mockResolvedValue(settingsSnapshot());

    render(<App />);

    await waitFor(() =>
      expect(screen.getByLabelText('Firebase Desk failed to start')).toBeTruthy()
    );
    expect(screen.getByText('settings unavailable')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeTruthy());
    expect(settingsLoad).toHaveBeenCalledTimes(2);
  });
});

function settingsSnapshot(): SettingsSnapshot {
  return {
    activityLog: {
      detailMode: 'metadata',
      enabled: true,
      maxBytes: 5 * 1024 * 1024,
    },
    sidebarWidth: 280,
    inspectorWidth: 360,
    theme: 'system',
    density: 'compact',
    dataMode: 'mock',
    hotkeyOverrides: {},
    resultTableLayouts: {},
    firestoreFieldCatalogs: {},
    firestoreWrites: { fieldStaleBehavior: 'save-and-notify' },
    updates: { dismissedVersion: null, lastCheckedAt: null },
    workspaceState: null,
  };
}
