import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader.tsx';

afterEach(() => {
  delete document.documentElement.dataset.platform;
  vi.unstubAllGlobals();
});

describe('AppHeader', () => {
  it('reserves macOS traffic light space from the preload platform', () => {
    document.documentElement.dataset.platform = 'darwin';
    stubNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    const { container } = render(<AppHeader {...props()} />);

    expect(container.querySelector('.native-titlebar-traffic-spacer')).toBeTruthy();
  });

  it('does not reserve traffic light space on other platforms', () => {
    document.documentElement.dataset.platform = 'win32';
    stubNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)');

    const { container } = render(<AppHeader {...props()} />);

    expect(container.querySelector('.native-titlebar-traffic-spacer')).toBeNull();
  });

  it('shows the app version and exposes manual update check', () => {
    const onCheckForUpdates = vi.fn();

    render(<AppHeader {...props({ onCheckForUpdates })} appVersion='1.2.3' />);

    expect(screen.getByText('v1.2.3')).toBeTruthy();
    expect(screen.getByText('Check updates')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it('shows manual no-update feedback', () => {
    render(<AppHeader {...props({ updateStatusLabel: 'Up to date' })} />);

    expect(screen.getByRole('status').textContent).toBe('Up to date');
  });
});

function stubNavigator(platform: string, userAgent: string): void {
  vi.stubGlobal('navigator', { platform, userAgent });
}

function props(patch: Partial<Parameters<typeof AppHeader>[0]> = {}): Parameters<
  typeof AppHeader
>[0] {
  return {
    appVersion: '0.1.0',
    canGoBack: false,
    canGoForward: false,
    canCheckForUpdates: true,
    checkingForUpdates: false,
    dataMode: 'mock',
    mode: 'system',
    onAddProject: vi.fn(),
    onBack: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onForward: vi.fn(),
    onModeChange: vi.fn(),
    onOpenSettings: vi.fn(),
    resolvedTheme: 'light',
    updateStatusLabel: null,
    ...patch,
  };
}
