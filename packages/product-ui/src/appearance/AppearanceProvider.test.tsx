import type {
  HotkeyOverrides,
  SettingsPatch,
  SettingsRepository,
  SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
} from '@firebase-desk/repo-contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppearanceProvider, useAppearance } from './AppearanceProvider.tsx';

class TestSettingsRepository implements SettingsRepository {
  snapshot: SettingsSnapshot = {
    activityLog: DEFAULT_ACTIVITY_LOG_SETTINGS,
    hotkeyOverrides: {},
    inspectorWidth: 360,
    sidebarWidth: 280,
    dataMode: 'mock',
    density: 'compact',
    firstRunGuide: { completedAt: null },
    theme: 'system',
    resultTableLayouts: {},
    firestoreFieldCatalogs: {},
    firestoreWrites: DEFAULT_FIRESTORE_WRITE_SETTINGS,
    updates: DEFAULT_UPDATE_SETTINGS,
    workspaceState: null,
  };

  async load(): Promise<SettingsSnapshot> {
    return this.snapshot;
  }

  async save(patch: SettingsPatch): Promise<SettingsSnapshot> {
    this.snapshot = {
      sidebarWidth: patch.sidebarWidth ?? this.snapshot.sidebarWidth,
      inspectorWidth: patch.inspectorWidth ?? this.snapshot.inspectorWidth,
      theme: patch.theme ?? this.snapshot.theme,
      density: patch.density ?? this.snapshot.density,
      dataMode: patch.dataMode ?? this.snapshot.dataMode,
      firstRunGuide: patch.firstRunGuide ?? this.snapshot.firstRunGuide,
      hotkeyOverrides: patch.hotkeyOverrides ?? this.snapshot.hotkeyOverrides,
      activityLog: patch.activityLog ?? this.snapshot.activityLog,
      resultTableLayouts: patch.resultTableLayouts ?? this.snapshot.resultTableLayouts,
      firestoreFieldCatalogs: patch.firestoreFieldCatalogs ?? this.snapshot.firestoreFieldCatalogs,
      firestoreWrites: patch.firestoreWrites ?? this.snapshot.firestoreWrites,
      updates: patch.updates ?? this.snapshot.updates,
      workspaceState: patch.workspaceState ?? this.snapshot.workspaceState,
    };
    return this.snapshot;
  }

  async getHotkeyOverrides(): Promise<HotkeyOverrides> {
    return this.snapshot.hotkeyOverrides;
  }

  async setHotkeyOverrides(overrides: HotkeyOverrides): Promise<void> {
    this.snapshot = { ...this.snapshot, hotkeyOverrides: overrides };
  }
}

function installMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  return {
    emit(nextMatches: boolean) {
      Object.defineProperty(media, 'matches', { configurable: true, value: nextMatches });
      listeners.forEach((listener) => listener({ matches: nextMatches } as MediaQueryListEvent));
    },
  };
}

function Probe() {
  const appearance = useAppearance();
  return (
    <button type='button' onClick={() => void appearance.setMode('dark')}>
      {appearance.mode}:{appearance.resolvedTheme}
    </button>
  );
}

describe('AppearanceProvider', () => {
  it('loads system mode and reacts to media changes', async () => {
    const media = installMatchMedia(false);
    const settings = new TestSettingsRepository();
    render(
      <AppearanceProvider settings={settings}>
        <Probe />
      </AppearanceProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('system:light'));
    media.emit(true);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('saves explicit mode changes', async () => {
    installMatchMedia(false);
    const settings = new TestSettingsRepository();
    render(
      <AppearanceProvider settings={settings}>
        <Probe />
      </AppearanceProvider>,
    );

    fireEvent.click(await screen.findByRole('button'));
    await waitFor(() => expect(settings.snapshot.theme).toBe('dark'));
  });
});
