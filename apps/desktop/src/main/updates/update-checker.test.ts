import { describe, expect, it, vi } from 'vitest';
import {
  checkForUpdates,
  compareStableVersions,
  isAllowedReleaseUrl,
  normalizeStableVersion,
} from './update-checker.ts';

describe('update checker', () => {
  it('normalizes and compares stable versions only', () => {
    expect(normalizeStableVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeStableVersion('1.2.3')).toBe('1.2.3');
    expect(normalizeStableVersion('v1.2.3-beta.1')).toBeNull();
    expect(normalizeStableVersion('latest')).toBeNull();
    expect(compareStableVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareStableVersions('1.2.0', '1.2.1')).toBeLessThan(0);
    expect(compareStableVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('detects a newer stable release and validates its manifest', async () => {
    const fetch = fetchJson({
      manifest: {
        appId: 'dev.firebase-desk.app',
        releaseUrl: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.7',
        schemaVersion: 1,
        version: '0.0.7',
      },
      release: releaseMetadata('v0.0.7'),
    });

    await expect(checkForUpdates({
      currentVersion: '0.0.6',
      fetch,
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    })).resolves.toEqual({
      checkedAt: '2026-05-04T00:00:00.000Z',
      currentVersion: '0.0.6',
      latestVersion: '0.0.7',
      releaseUrl: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.7',
      status: 'available',
    });
  });

  it('returns current when the stable release is not newer', async () => {
    const fetch = fetchJson({ release: releaseMetadata('v0.0.6', []) });

    await expect(checkForUpdates({
      currentVersion: '0.0.6',
      fetch,
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    })).resolves.toMatchObject({
      latestVersion: '0.0.6',
      status: 'current',
    });
  });

  it('fails visibly for rolling or malformed release metadata', async () => {
    const fetch = fetchJson({
      release: {
        ...releaseMetadata('latest', []),
        prerelease: true,
      },
    });

    await expect(checkForUpdates({
      currentVersion: '0.0.6',
      fetch,
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    })).resolves.toMatchObject({
      message: 'Newest release is not a stable published release.',
      status: 'failed',
    });
  });

  it('fails visibly when release manifest validation fails', async () => {
    const fetch = fetchJson({
      manifest: {
        appId: 'dev.firebase-desk.app',
        releaseUrl: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.8',
        schemaVersion: 1,
        version: '0.0.8',
      },
      release: releaseMetadata('v0.0.7'),
    });

    await expect(checkForUpdates({
      currentVersion: '0.0.6',
      fetch,
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    })).resolves.toMatchObject({
      message: 'Release manifest version does not match release tag.',
      status: 'failed',
    });
  });

  it('restricts external update URLs to repo release pages and assets', () => {
    expect(
      isAllowedReleaseUrl(
        'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.7',
      ),
    )
      .toBe(true);
    expect(
      isAllowedReleaseUrl(
        'https://github.com/viniciusrmcarneiro/firebase-desk/releases/download/v0.0.7/app.zip',
      ),
    ).toBe(true);
    expect(isAllowedReleaseUrl('https://github.com/viniciusrmcarneiro/firebase-desk/issues/25'))
      .toBe(false);
    expect(isAllowedReleaseUrl('https://example.com/releases/tag/v0.0.7')).toBe(false);
  });
});

function releaseMetadata(tagName: string, assets: ReadonlyArray<unknown> = [manifestAsset()]) {
  return {
    assets,
    draft: false,
    html_url: `https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/${tagName}`,
    prerelease: false,
    tag_name: tagName,
  };
}

function manifestAsset() {
  return {
    browser_download_url:
      'https://github.com/viniciusrmcarneiro/firebase-desk/releases/download/v0.0.7/release-manifest.json',
    name: 'release-manifest.json',
  };
}

function fetchJson(
  { manifest, release }: { readonly manifest?: unknown; readonly release: unknown; },
) {
  return vi.fn(async (url: string) => ({
    json: async () => url.endsWith('release-manifest.json') ? manifest : release,
    ok: true,
    status: 200,
  }));
}
