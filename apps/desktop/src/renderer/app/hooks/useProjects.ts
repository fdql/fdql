import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRepositories } from '../RepositoryProvider.tsx';

export interface ProjectsLoadState {
  readonly data: ReadonlyArray<ProjectSummary> | undefined;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly reload: () => Promise<ReadonlyArray<ProjectSummary>>;
}

export function useProjects() {
  const repositories = useRepositories();
  const requestId = useRef(0);
  const [state, setState] = useState<Omit<ProjectsLoadState, 'reload'>>({
    data: undefined,
    error: null,
    isLoading: true,
  });

  const reload = useCallback(async (): Promise<ReadonlyArray<ProjectSummary>> => {
    const id = ++requestId.current;
    setState((current) => ({ ...current, error: null, isLoading: true }));
    try {
      const projects = await repositories.projects.list();
      if (id === requestId.current) {
        setState({ data: projects, error: null, isLoading: false });
      }
      return projects;
    } catch (error) {
      const nextError = error instanceof Error
        ? error
        : new Error('Could not load projects.');
      if (id === requestId.current) {
        setState((current) => ({ ...current, error: nextError, isLoading: false }));
      }
      throw nextError;
    }
  }, [repositories.projects]);

  const upsert = useCallback((project: ProjectSummary) => {
    requestId.current++;
    setState((current) => ({
      data: upsertProject(current.data ?? [], project),
      error: null,
      isLoading: false,
    }));
  }, []);

  useEffect(() => {
    void reload().catch(() => undefined);
    return () => {
      requestId.current++;
    };
  }, [reload]);

  return { ...state, reload, upsert };
}

function upsertProject(
  projects: ReadonlyArray<ProjectSummary>,
  project: ProjectSummary,
): ReadonlyArray<ProjectSummary> {
  const index = projects.findIndex((candidate) => candidate.id === project.id);
  if (index < 0) return [...projects, project];
  return projects.map((candidate, candidateIndex) =>
    candidateIndex === index ? project : candidate
  );
}
