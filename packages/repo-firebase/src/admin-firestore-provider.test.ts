import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminFirestoreProvider, firestoreSettingsFor } from './admin-firestore-provider.ts';

const originalEmulatorHost = process.env['FIRESTORE_EMULATOR_HOST'];

describe('AdminFirestoreProvider', () => {
  afterEach(() => {
    restoreEmulatorHost();
  });

  it('routes emulator projects through the configured Firestore emulator host', async () => {
    process.env['FIRESTORE_EMULATOR_HOST'] = 'localhost:9999';
    const provider = new AdminFirestoreProvider({
      resolveConnection: async () => ({ project: emulatorProject(), credentialJson: null }),
    });

    try {
      const db = await provider.getFirestore('test');
      expect(settingsFor(db)).toMatchObject({
        port: 8080,
        servicePath: '127.0.0.1',
        ssl: false,
      });
      expect(firestoreSettingsFor({ project: emulatorProject(), credentialJson: null }))
        .toMatchObject({
          clientConfig: {
            interfaces: {
              'google.firestore.v1.Firestore': {
                retry_params: {
                  default: {
                    total_timeout_millis: 5_000,
                  },
                },
              },
            },
          },
        });
      expect(process.env['FIRESTORE_EMULATOR_HOST']).toBe('localhost:9999');
    } finally {
      await provider.clear();
    }
  });
});

function emulatorProject(): ProjectSummary {
  return {
    id: 'test',
    name: 'Test Emulator',
    projectId: 'demo-firebase-lite',
    target: 'emulator',
    emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
    hasCredential: false,
    credentialEncrypted: null,
    createdAt: '2026-04-28T00:00:00.000Z',
  };
}

function settingsFor(db: Firestore): Record<string, unknown> | undefined {
  return (db as Firestore & { readonly _settings?: Record<string, unknown>; })['_settings'];
}

function restoreEmulatorHost(): void {
  if (originalEmulatorHost === undefined) delete process.env['FIRESTORE_EMULATOR_HOST'];
  else process.env['FIRESTORE_EMULATOR_HOST'] = originalEmulatorHost;
}
