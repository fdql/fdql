import { FirestoreFilterOpSchema } from '@firebase-desk/ipc-schemas';
import type {
  FirestoreQueryDraft,
  FirestoreQueryFilterDraft,
  FirestoreSqlContext,
  SettingsRepository,
} from '@firebase-desk/repo-contracts';
import { z } from 'zod';
import { tabsRestored } from '../app-core/workspace/workspaceTransitions.ts';
import {
  type InteractionHistoryEntry,
  type TabsState,
  WORKSPACE_TAB_KINDS,
  type WorkspaceTab,
} from './stores/tabsStore.ts';

const WorkspaceTabKindSchema = z.enum(WORKSPACE_TAB_KINDS);

const WorkspaceTabSchema = z.object({
  id: z.string().min(1),
  kind: WorkspaceTabKindSchema,
  title: z.string(),
  connectionId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  history: z.array(z.string()).min(1),
  historyIndex: z.number().int().nonnegative(),
  inspectorWidth: z.number().finite().nonnegative(),
}).superRefine((tab, context) => {
  if (!tab.connectionId && !tab.projectId) {
    context.addIssue({ code: 'custom', message: 'Tab connection id is required' });
  }
  if (tab.historyIndex >= tab.history.length) {
    context.addIssue({ code: 'custom', message: 'Tab history index out of range' });
  }
}).transform((tab): WorkspaceTab => ({
  id: tab.id,
  kind: tab.kind,
  title: tab.title,
  connectionId: tab.connectionId ?? tab.projectId ?? '',
  history: tab.history,
  historyIndex: tab.historyIndex,
  inspectorWidth: tab.inspectorWidth,
}));

const InteractionHistoryEntrySchema = z.object({
  activeTabId: z.string().min(1),
  path: z.string().optional(),
  selectedTreeItemId: z.string().nullable(),
}).transform((entry): InteractionHistoryEntry => ({
  activeTabId: entry.activeTabId,
  ...(entry.path === undefined ? {} : { path: entry.path }),
  selectedTreeItemId: entry.selectedTreeItemId,
}));

const TabsStateSchema = z.object({
  activeTabId: z.string(),
  interactionHistory: z.array(InteractionHistoryEntrySchema),
  interactionHistoryIndex: z.number().int().nonnegative(),
  tabs: z.array(WorkspaceTabSchema).min(1),
}).superRefine((state, context) => {
  const tabIds = new Set(state.tabs.map((tab) => tab.id));
  if (!tabIds.has(state.activeTabId)) {
    context.addIssue({ code: 'custom', message: 'Active tab is not open' });
  }
}).transform((state): TabsState => sanitizeTabsState(state));

const FirestoreQueryFilterDraftSchema = z.object({
  id: z.string().min(1),
  field: z.string(),
  op: FirestoreFilterOpSchema,
  value: z.string(),
}) satisfies z.ZodType<FirestoreQueryFilterDraft>;

const FirestoreQueryDraftSchema = z.object({
  path: z.string(),
  filters: z.array(FirestoreQueryFilterDraftSchema).optional(),
  filterField: z.string(),
  filterOp: FirestoreFilterOpSchema,
  filterValue: z.string(),
  sortField: z.string(),
  sortDirection: z.enum(['asc', 'desc']),
  limit: z.number().int().positive(),
}).transform((draft): FirestoreQueryDraft => ({
  path: draft.path,
  ...(draft.filters === undefined ? {} : { filters: draft.filters }),
  filterField: draft.filterField,
  filterOp: draft.filterOp,
  filterValue: draft.filterValue,
  sortField: draft.sortField,
  sortDirection: draft.sortDirection,
  limit: draft.limit,
}));

export const PersistedWorkspaceStateSchema = z.object({
  version: z.literal(1),
  authFilter: z.string(),
  drafts: z.record(z.string(), FirestoreQueryDraftSchema),
  scripts: z.record(z.string(), z.string()),
  fdqlSources: z.record(z.string(), z.string()).optional(),
  sqlContexts: z.record(
    z.string(),
    z.object({
      defaultProjectId: z.string().optional(),
      projectAliases: z.record(z.string(), z.string()).optional(),
    }) satisfies z.ZodType<FirestoreSqlContext>,
  ).optional(),
  sqlSources: z.record(z.string(), z.string()).optional(),
  tabsState: TabsStateSchema,
}).superRefine((state, context) => {
  const tabIds = new Set(state.tabsState.tabs.map((tab) => tab.id));
  for (const tabId of Object.keys(state.drafts)) {
    if (!tabIds.has(tabId)) context.addIssue({ code: 'custom', message: 'Draft tab is not open' });
  }
  for (const tabId of Object.keys(state.scripts)) {
    if (!tabIds.has(tabId)) context.addIssue({ code: 'custom', message: 'Script tab is not open' });
  }
  for (const tabId of Object.keys(state.fdqlSources ?? {})) {
    if (!tabIds.has(tabId)) context.addIssue({ code: 'custom', message: 'FDQL tab is not open' });
  }
  for (const tabId of Object.keys(state.sqlSources ?? {})) {
    if (!tabIds.has(tabId)) context.addIssue({ code: 'custom', message: 'SQL tab is not open' });
  }
  for (const tabId of Object.keys(state.sqlContexts ?? {})) {
    if (!tabIds.has(tabId)) {
      context.addIssue({ code: 'custom', message: 'SQL context tab is not open' });
    }
  }
});

export type PersistedWorkspaceState = z.infer<typeof PersistedWorkspaceStateSchema>;

export interface WorkspacePersistenceFailure {
  readonly message: string;
  readonly operation: 'load' | 'save';
}

export interface LoadPersistedWorkspaceStateResult {
  readonly error: WorkspacePersistenceFailure | null;
  readonly snapshot: PersistedWorkspaceState | null;
}

export async function loadPersistedWorkspaceState(
  settings: Pick<SettingsRepository, 'load'>,
): Promise<PersistedWorkspaceState | null> {
  return (await loadPersistedWorkspaceStateResult(settings)).snapshot;
}

export async function loadPersistedWorkspaceStateResult(
  settings: Pick<SettingsRepository, 'load'>,
): Promise<LoadPersistedWorkspaceStateResult> {
  try {
    const raw = (await settings.load()).workspaceState;
    if (raw === null || raw === undefined) return { error: null, snapshot: null };
    const parsed = PersistedWorkspaceStateSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: {
          message: 'Saved workspace state is invalid and was not restored.',
          operation: 'load',
        },
        snapshot: null,
      };
    }
    return { error: null, snapshot: parsed.data };
  } catch (error) {
    return {
      error: {
        message: messageFromError(error, 'Could not load saved workspace state.'),
        operation: 'load',
      },
      snapshot: null,
    };
  }
}

export function savePersistedWorkspaceState(
  settings: Pick<SettingsRepository, 'save'>,
  state: Omit<PersistedWorkspaceState, 'version'>,
): Promise<WorkspacePersistenceFailure | null> {
  try {
    return persistWorkspaceState(settings, state)
      .then(() => null)
      .catch((error: unknown) => ({
        message: messageFromError(error, 'Could not save workspace state.'),
        operation: 'save' as const,
      }));
  } catch (error) {
    return Promise.resolve({
      message: messageFromError(error, 'Could not save workspace state.'),
      operation: 'save',
    });
  }
}

async function persistWorkspaceState(
  settings: Pick<SettingsRepository, 'save'>,
  state: Omit<PersistedWorkspaceState, 'version'>,
): Promise<void> {
  if (!state.tabsState.tabs.length) {
    await settings.save({ workspaceState: null });
    return;
  }
  const tabIds = new Set(state.tabsState.tabs.map((tab) => tab.id));
  const payload = PersistedWorkspaceStateSchema.parse({
    version: 1,
    authFilter: state.authFilter,
    drafts: pickTabRecord(state.drafts, tabIds),
    scripts: pickTabRecord(state.scripts, tabIds),
    fdqlSources: pickTabRecord(state.fdqlSources ?? {}, tabIds),
    sqlContexts: pickTabRecord(state.sqlContexts ?? {}, tabIds),
    sqlSources: pickTabRecord(state.sqlSources ?? {}, tabIds),
    tabsState: sanitizeTabsState(state.tabsState),
  });
  await settings.save({ workspaceState: payload });
}

export function parsePersistedWorkspaceState(
  value: unknown,
): LoadPersistedWorkspaceStateResult {
  try {
    if (value === null || value === undefined) return { error: null, snapshot: null };
    const parsed = PersistedWorkspaceStateSchema.safeParse(value);
    if (!parsed.success) {
      return {
        error: {
          message: 'Saved workspace state is invalid and was not restored.',
          operation: 'load',
        },
        snapshot: null,
      };
    }
    return { error: null, snapshot: parsed.data };
  } catch (error) {
    return {
      error: {
        message: messageFromError(error, 'Could not load saved workspace state.'),
        operation: 'load',
      },
      snapshot: null,
    };
  }
}

function sanitizeTabsState(state: TabsState): TabsState {
  return tabsRestored({
    ...state,
    interactionHistoryIndex: clampInteractionHistoryIndex(
      state.interactionHistoryIndex,
      state.interactionHistory,
    ),
  });
}

function clampInteractionHistoryIndex(
  index: number,
  history: ReadonlyArray<InteractionHistoryEntry>,
): number {
  if (!history.length) return 0;
  return Math.max(0, Math.min(index, history.length - 1));
}

function pickTabRecord<T>(
  values: Readonly<Record<string, T>>,
  tabIds: ReadonlySet<string>,
): Readonly<Record<string, T>> {
  const picked: Record<string, T> = {};
  for (const [tabId, value] of Object.entries(values)) {
    if (tabIds.has(tabId)) picked[tabId] = value;
  }
  return picked;
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
