import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProjectCommandController } from './useProjectCommandController.ts';

describe('useProjectCommandController', () => {
  it('runs project commands with status and project reload wiring', async () => {
    const setLastAction = vi.fn();
    const reloadProjects = vi.fn().mockResolvedValue([project]);
    const recordActivity = vi.fn();
    const upsertProject = vi.fn();
    const projects = {
      add: vi.fn().mockResolvedValue(project),
      remove: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(project),
    };
    const { result } = renderHook(() =>
      useProjectCommandController({
        projects: projects as never,
        recordActivity,
        reloadProjects,
        setLastAction,
        upsertProject,
      })
    );

    await act(async () => {
      await result.current.updateProject('emu', { name: 'Local Emulator' });
    });

    expect(projects.update).toHaveBeenCalledWith('emu', { name: 'Local Emulator' });
    expect(reloadProjects).toHaveBeenCalledTimes(1);
    expect(setLastAction).toHaveBeenCalledWith('Updated Local Emulator');
    expect(upsertProject).toHaveBeenCalledWith(project);
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Update account',
      status: 'success',
    }));
  });
});

const project: ProjectSummary = {
  id: 'emu',
  name: 'Local Emulator',
  projectId: 'demo-local',
  target: 'emulator',
  emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
  hasCredential: false,
  credentialEncrypted: null,
  createdAt: '2026-04-27T00:00:00.000Z',
};
