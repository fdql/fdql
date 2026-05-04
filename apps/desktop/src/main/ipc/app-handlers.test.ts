import type { SettingsRepository } from '@firebase-desk/repo-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppHandlers } from './app-handlers.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('app IPC handlers', () => {
  it('accepts force update requests without changing the main check', async () => {
    const fetch = vi.fn(async () => ({
      json: async () => ({
        assets: [],
        draft: false,
        html_url: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.6',
        prerelease: false,
        tag_name: 'v0.0.6',
      }),
      ok: true,
      status: 200,
    }));
    vi.stubGlobal('fetch', fetch);
    const handlers = createAppHandlers({
      appVersion: '0.0.6',
      dataDirectory: '/tmp/firebase-desk',
      openDataDirectory: vi.fn(),
      openExternalUrl: vi.fn(),
      settingsRepository: { load: vi.fn() } as unknown as SettingsRepository,
    });

    await expect(handlers['app.checkForUpdates']({ force: true })).resolves.toMatchObject({
      currentVersion: '0.0.6',
      latestVersion: '0.0.6',
      status: 'current',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('opens only allowed release URLs externally', async () => {
    const openExternalUrl = vi.fn();
    const handlers = createAppHandlers({
      appVersion: '0.0.6',
      dataDirectory: '/tmp/firebase-desk',
      openDataDirectory: vi.fn(),
      openExternalUrl,
      settingsRepository: { load: vi.fn() } as unknown as SettingsRepository,
    });

    await expect(handlers['app.openExternalUrl']({
      url: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.7',
    })).resolves.toBeUndefined();
    await expect(handlers['app.openExternalUrl']({
      url: 'https://github.com/viniciusrmcarneiro/firebase-desk/issues/25',
    })).rejects.toThrow('External URL is not allowed.');

    expect(openExternalUrl).toHaveBeenCalledTimes(1);
  });
});
