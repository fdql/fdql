import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic-write.ts';

interface ProjectsFile {
  readonly version: 1;
  readonly projects: ReadonlyArray<ProjectSummary>;
}

export class ProjectsStore {
  private readonly filePath: string;
  private cache: ReadonlyArray<ProjectSummary> | null = null;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, 'projects.json');
  }

  async list(): Promise<ReadonlyArray<ProjectSummary>> {
    if (this.cache) return cloneProjects(this.cache);
    const projects = await this.readFile();
    this.cache ??= projects;
    return cloneProjects(this.cache);
  }

  async save(projects: ReadonlyArray<ProjectSummary>): Promise<void> {
    this.cache = cloneProjects(projects);
    const payload: ProjectsFile = { version: 1, projects: this.cache };
    await writeJsonAtomic(this.filePath, payload);
  }

  private async readFile(): Promise<ReadonlyArray<ProjectSummary>> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ProjectsFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.projects)) return [];
      return cloneProjects(parsed.projects);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }
}

function cloneProjects(projects: ReadonlyArray<ProjectSummary>): ReadonlyArray<ProjectSummary> {
  return projects.map((project) => ({
    ...project,
    ...(project.emulator ? { emulator: { ...project.emulator } } : {}),
  }));
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
