import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsStore } from './projects-store.ts';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeJsonAtomic: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: mocks.readFile };
});

vi.mock('./atomic-write.ts', () => ({
  writeJsonAtomic: mocks.writeJsonAtomic,
}));

const project: ProjectSummary = {
  id: 'local-emulator',
  name: 'Local Emulator',
  projectId: 'demo-local',
  target: 'emulator',
  emulator: {
    authHost: '127.0.0.1:9099',
    firestoreHost: '127.0.0.1:8080',
  },
  hasCredential: false,
  credentialEncrypted: null,
  createdAt: '2026-07-25T00:00:00.000Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.writeJsonAtomic.mockResolvedValue(undefined);
});

describe('ProjectsStore', () => {
  it('keeps projects saved while the initial file read is pending', async () => {
    let resolveRead!: (value: string) => void;
    mocks.readFile.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const store = new ProjectsStore('/tmp/firebase-desk-projects');

    const initialLoad = store.list();
    await store.save([project]);
    resolveRead(JSON.stringify({ version: 1, projects: [] }));

    await expect(initialLoad).resolves.toEqual([project]);
    await expect(store.list()).resolves.toEqual([project]);
  });
});
