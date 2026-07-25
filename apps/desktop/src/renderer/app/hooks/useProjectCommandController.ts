import type {
  ActivityLogAppendInput,
  ProjectAddInput,
  ProjectSummary,
  ProjectUpdatePatch,
} from '@firebase-desk/repo-contracts';
import { useMemo } from 'react';
import {
  addProjectCommand,
  removeProjectCommand,
  updateProjectCommand,
} from '../../app-core/workspace/projectCommands.ts';
import type { RepositorySet } from '../RepositoryProvider.tsx';

interface UseProjectCommandControllerInput {
  readonly projects: RepositorySet['projects'];
  readonly recordActivity: (input: ActivityLogAppendInput) => Promise<void> | void;
  readonly reloadProjects: () => Promise<ReadonlyArray<ProjectSummary>>;
  readonly setLastAction: (action: string) => void;
  readonly upsertProject: (project: ProjectSummary) => void;
}

export function useProjectCommandController(
  {
    projects,
    recordActivity,
    reloadProjects,
    setLastAction,
    upsertProject,
  }: UseProjectCommandControllerInput,
) {
  const env = useMemo(() => ({
    invalidateProjects: async () => {
      await reloadProjects().catch(() => undefined);
    },
    now: Date.now,
    projects,
    recordActivity,
  }), [recordActivity, reloadProjects, projects]);

  return {
    addProject: async (input: ProjectAddInput): Promise<ProjectSummary> => {
      const result = await addProjectCommand(env, input);
      upsertProject(result.result);
      setLastAction(result.lastAction);
      return result.result;
    },
    removeProject: async (
      connectionId: string,
      project: ProjectSummary | null,
    ): Promise<void> => {
      const result = await removeProjectCommand(env, { connectionId, project });
      setLastAction(result.lastAction);
      return result.result;
    },
    updateProject: async (
      id: string,
      patch: ProjectUpdatePatch,
    ): Promise<ProjectSummary> => {
      const result = await updateProjectCommand(env, { id, patch });
      upsertProject(result.result);
      setLastAction(result.lastAction);
      return result.result;
    },
  };
}
