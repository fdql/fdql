import { describe, expect, it } from 'vitest';
import { OpenExternalUrlRequestSchema, UpdateCheckResultSchema } from './updates.ts';

describe('update schemas', () => {
  it('validates available update results and external URLs', () => {
    expect(
      UpdateCheckResultSchema.parse({
        checkedAt: '2026-05-04T00:00:00.000Z',
        currentVersion: '0.0.6',
        latestVersion: '0.0.7',
        releaseUrl: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.7',
        status: 'available',
      }),
    ).toMatchObject({ latestVersion: '0.0.7', status: 'available' });

    expect(
      OpenExternalUrlRequestSchema.parse({
        url: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.7',
      }),
    ).toMatchObject({
      url: 'https://github.com/viniciusrmcarneiro/firebase-desk/releases/tag/v0.0.7',
    });
  });

  it('validates failed update results', () => {
    expect(
      UpdateCheckResultSchema.parse({
        checkedAt: '2026-05-04T00:00:00.000Z',
        message: 'network down',
        status: 'failed',
      }),
    ).toEqual({
      checkedAt: '2026-05-04T00:00:00.000Z',
      message: 'network down',
      status: 'failed',
    });
  });
});
