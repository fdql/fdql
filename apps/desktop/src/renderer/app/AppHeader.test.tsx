import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppHeader', () => {
  it('reserves macOS traffic light space from the renderer platform', () => {
    stubNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)');

    const { container } = render(<AppHeader {...props()} />);

    expect(container.querySelector('.native-titlebar-traffic-spacer')).toBeTruthy();
  });

  it('does not reserve traffic light space on other platforms', () => {
    stubNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    const { container } = render(<AppHeader {...props()} />);

    expect(container.querySelector('.native-titlebar-traffic-spacer')).toBeNull();
  });
});

function stubNavigator(platform: string, userAgent: string): void {
  vi.stubGlobal('navigator', { platform, userAgent });
}

function props(): Parameters<typeof AppHeader>[0] {
  return {
    canGoBack: false,
    canGoForward: false,
    dataMode: 'mock',
    mode: 'system',
    onAddProject: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onModeChange: vi.fn(),
    onOpenSettings: vi.fn(),
    resolvedTheme: 'light',
  };
}
