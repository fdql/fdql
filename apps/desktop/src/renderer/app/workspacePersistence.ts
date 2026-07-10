import { FirestoreFilterOpSchema } from '@firebase-desk/ipc-schemas';
import type {
  FirestoreQueryDraft,
  FirestoreQueryFilterDraft,
  FirestoreSqlContext,
  SettingsPatch,
  SettingsRepository,
} from '@firebase-desk/repo-contracts';
import { z } from 'zod';
import { createFirestoreDraft } from '../app-core/firestore/query/firestoreQueryDraft.ts';
import {
  defaultFirestoreInspectorUiState,
  type FirestoreInspectorUiState,
} from '../app-core/firestore/query/firestoreQueryState.ts';
import { tabsRestored } from '../app-core/workspace/workspaceTransitions.ts';
import type { InteractionHistoryEntry, TabsState, WorkspaceTab } from './stores/tabsStore.ts';

const CURRENT_WORKSPACE_VERSION = 2;
const ToolWorkspaceTabKindSchema = z.enum([
  'auth-users',
  'js-query',
  'firestore-sql',
  'fdql',
]);
const LegacyWorkspaceTabKindSchema = z.enum([
  'firestore-query',
  'auth-users',
  'js-query',
  'firestore-sql',
  'fdql',
]);

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
  filters: draft.filters ?? [],
  filterField: draft.filterField,
  filterOp: draft.filterOp,
  filterValue: draft.filterValue,
  sortField: draft.sortField,
  sortDirection: draft.sortDirection,
  limit: draft.limit,
}));

const FirestoreInspectorSectionStateSchema = z.object({
  fieldsInResults: z.boolean().optional(),
  jsonContext: z.boolean().optional(),
  selectionPreview: z.boolean().optional(),
}).transform((sections): FirestoreInspectorUiState['sections'] => ({
  fieldsInResults: sections.fieldsInResults ?? false,
  jsonContext: sections.jsonContext ?? true,
  selectionPreview: sections.selectionPreview ?? true,
}));

const FirestoreInspectorUiStateSchema = z.object({
  overviewCollapsed: z.boolean().optional(),
  resultView: z.enum(['json', 'table', 'tree']).default('table'),
  resultTreeExpandedIds: z.array(z.string()).nullable().optional(),
  sections: FirestoreInspectorSectionStateSchema.optional(),
  selectionPreviewExpandedPathsByDocumentPath: z.record(z.string(), z.array(z.string()))
    .optional(),
}).transform((state): FirestoreInspectorUiState => ({
  overviewCollapsed: state.overviewCollapsed ?? false,
  resultView: state.resultView,
  resultTreeExpandedIds: state.resultTreeExpandedIds ?? null,
  sections: state.sections ?? {
    fieldsInResults: false,
    jsonContext: true,
    selectionPreview: true,
  },
  selectionPreviewExpandedPathsByDocumentPath: state.selectionPreviewExpandedPathsByDocumentPath
    ?? {},
}));

const FirestoreWorkspaceTabV2Schema = z.object({
  id: z.string().min(1),
  kind: z.literal('firestore-query'),
  connectionId: z.string().min(1),
  draft: FirestoreQueryDraftSchema,
  inspectorUi: FirestoreInspectorUiStateSchema,
  inspectorWidth: z.number().finite().nonnegative(),
});

const ToolWorkspaceTabV2Schema = z.object({
  id: z.string().min(1),
  kind: ToolWorkspaceTabKindSchema,
  title: z.string(),
  connectionId: z.string().min(1),
  history: z.array(z.string()).min(1),
  historyIndex: z.number().int().nonnegative(),
  inspectorWidth: z.number().finite().nonnegative(),
}).superRefine((tab, context) => {
  if (tab.historyIndex >= tab.history.length) {
    context.addIssue({ code: 'custom', message: 'Tab history index out of range' });
  }
});

const WorkspaceTabV2Schema = z.union([
  FirestoreWorkspaceTabV2Schema,
  ToolWorkspaceTabV2Schema,
]).transform((tab): WorkspaceTab => tab);

const WorkspaceInteractionLocationV2Schema = z.union([
  z.object({
    kind: z.literal('firestore-query'),
    connectionId: z.string().min(1),
    draft: FirestoreQueryDraftSchema,
  }),
  z.object({
    kind: z.literal('tool'),
    connectionId: z.string().min(1),
    path: z.string(),
  }),
]);

const InteractionHistoryEntryV2Schema = z.object({
  activeTabId: z.string().min(1),
  location: WorkspaceInteractionLocationV2Schema,
  selectedTreeItemId: z.string().nullable(),
}).transform((entry): InteractionHistoryEntry => entry);

const TabsStateV2Schema = z.object({
  activeTabId: z.string(),
  interactionHistory: z.array(InteractionHistoryEntryV2Schema),
  interactionHistoryIndex: z.number().int(),
  selectedTreeItemId: z.string().nullable().optional(),
  tabs: z.array(WorkspaceTabV2Schema).min(1),
}).superRefine((state, context) => {
  const tabIds = new Set(state.tabs.map((tab) => tab.id));
  if (!tabIds.has(state.activeTabId)) {
    context.addIssue({ code: 'custom', message: 'Active tab is not open' });
  }
}).transform((state): TabsState =>
  sanitizeTabsState({
    ...state,
    selectedTreeItemId: state.selectedTreeItemId ?? null,
  })
);

const SqlContextsSchema = z.record(
  z.string(),
  z.object({
    defaultProjectId: z.string().optional(),
    projectAliases: z.record(z.string(), z.string()).optional(),
  }) satisfies z.ZodType<FirestoreSqlContext>,
);

const PersistedWorkspaceStateV2Schema = z.object({
  version: z.literal(2),
  savedAt: z.number().finite().nonnegative().optional(),
  authFilter: z.string(),
  scripts: z.record(z.string(), z.string()),
  fdqlSources: z.record(z.string(), z.string()).optional(),
  sqlContexts: SqlContextsSchema.optional(),
  sqlSources: z.record(z.string(), z.string()).optional(),
  tabsState: TabsStateV2Schema,
}).superRefine(validateTabRecords);

const LegacyWorkspaceTabSchema = z.object({
  id: z.string().min(1),
  kind: LegacyWorkspaceTabKindSchema,
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
});

const LegacyInteractionHistoryEntrySchema = z.object({
  activeTabId: z.string().min(1),
  path: z.string().optional(),
  selectedTreeItemId: z.string().nullable(),
});

const LegacyTabsStateSchema = z.object({
  activeTabId: z.string(),
  interactionHistory: z.array(LegacyInteractionHistoryEntrySchema),
  interactionHistoryIndex: z.number().int().nonnegative(),
  tabs: z.array(LegacyWorkspaceTabSchema).min(1),
}).superRefine((state, context) => {
  if (!state.tabs.some((tab) => tab.id === state.activeTabId)) {
    context.addIssue({ code: 'custom', message: 'Active tab is not open' });
  }
});

const PersistedWorkspaceStateV1Schema = z.object({
  version: z.literal(1),
  savedAt: z.number().finite().nonnegative().optional(),
  authFilter: z.string(),
  drafts: z.record(z.string(), FirestoreQueryDraftSchema),
  firestoreInspectorUi: z.record(z.string(), FirestoreInspectorUiStateSchema).optional(),
  scripts: z.record(z.string(), z.string()),
  fdqlSources: z.record(z.string(), z.string()).optional(),
  sqlContexts: SqlContextsSchema.optional(),
  sqlSources: z.record(z.string(), z.string()).optional(),
  tabsState: LegacyTabsStateSchema,
});

type PersistedWorkspaceStateV1 = z.infer<typeof PersistedWorkspaceStateV1Schema>;
export type PersistedWorkspaceState = z.infer<typeof PersistedWorkspaceStateV2Schema>;

export interface WorkspacePersistenceFailure {
  readonly message: string;
  readonly operation: 'load' | 'save';
}

export interface LoadPersistedWorkspaceStateResult {
  readonly error: WorkspacePersistenceFailure | null;
  readonly migrated?: boolean | undefined;
  readonly recoveryDiagnostic?: string | undefined;
  readonly snapshot: PersistedWorkspaceState | null;
  readonly unsupportedVersion?: number | undefined;
}

type WorkspacePersistenceInput = Omit<PersistedWorkspaceState, 'version'>;
type WorkspaceSaveResult = WorkspacePersistenceFailure | null;
type WorkspaceSaveSettings = Pick<SettingsRepository, 'save'>;

interface QueuedWorkspaceSave {
  patch: SettingsPatch;
  readonly waiters: Array<(result: WorkspaceSaveResult) => void>;
}

interface WorkspaceSaveQueue {
  active: boolean;
  pending: QueuedWorkspaceSave | null;
}

const blockedFutureWorkspaceWrites = new WeakSet<object>();
const workspaceSaveQueues = new WeakMap<object, WorkspaceSaveQueue>();

export async function loadPersistedWorkspaceState(
  settings: Pick<SettingsRepository, 'load'>,
): Promise<PersistedWorkspaceState | null> {
  return (await loadPersistedWorkspaceStateResult(settings)).snapshot;
}

export async function loadPersistedWorkspaceStateResult(
  settings: Pick<SettingsRepository, 'load'>,
): Promise<LoadPersistedWorkspaceStateResult> {
  try {
    const settingsSnapshot = await settings.load();
    const raw = settingsSnapshot.workspaceState;
    if (raw === null || raw === undefined) {
      blockedFutureWorkspaceWrites.delete(settings);
      return { error: null, snapshot: null };
    }
    const parsed = parsePersistedWorkspaceState(raw);
    const clearedAt = settingsSnapshot.workspaceStateClearedAt ?? null;
    const savedAt = parsed.snapshot
      ? parsed.snapshot.savedAt ?? 0
      : savedAtFromRawWorkspace(raw);
    if (clearedAt !== null && savedAt !== null && savedAt <= clearedAt) {
      blockedFutureWorkspaceWrites.delete(settings);
      return { error: null, snapshot: null };
    }
    if (parsed.unsupportedVersion !== undefined) {
      blockedFutureWorkspaceWrites.add(settings);
      return parsed;
    }
    blockedFutureWorkspaceWrites.delete(settings);
    return parsed;
  } catch (error) {
    blockedFutureWorkspaceWrites.delete(settings);
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
  settings: WorkspaceSaveSettings,
  state: WorkspacePersistenceInput,
  options: { readonly recordedAtMs?: number | undefined; } = {},
): Promise<WorkspaceSaveResult> {
  if (blockedFutureWorkspaceWrites.has(settings)) return Promise.resolve(null);
  try {
    const patch = workspaceSavePatch(state, options.recordedAtMs ?? Date.now());
    return enqueueWorkspaceSave(settings, patch);
  } catch (error) {
    return Promise.resolve(saveFailure(error));
  }
}

export function clearPersistedWorkspaceState(
  settings: WorkspaceSaveSettings,
  recordedAtMs = Date.now(),
): Promise<WorkspaceSaveResult> {
  blockedFutureWorkspaceWrites.delete(settings);
  return enqueueWorkspaceSave(settings, {
    workspaceState: null,
    workspaceStateClearedAt: recordedAtMs,
  });
}

export function parsePersistedWorkspaceState(
  value: unknown,
): LoadPersistedWorkspaceStateResult {
  try {
    if (value === null || value === undefined) return { error: null, snapshot: null };
    const version = workspaceVersion(value);
    if (version !== null && version > CURRENT_WORKSPACE_VERSION) {
      return {
        error: {
          message:
            `Saved workspace version ${version} is newer than this app. Persistence is disabled.`,
          operation: 'load',
        },
        snapshot: null,
        unsupportedVersion: version,
      };
    }
    if (version === 1) {
      const parsed = PersistedWorkspaceStateV1Schema.safeParse(value);
      if (!parsed.success) return invalidWorkspaceResult();
      const recoveryDiagnostic = legacyRecoveryDiagnostic(parsed.data);
      return {
        error: null,
        migrated: true,
        ...(recoveryDiagnostic ? { recoveryDiagnostic } : {}),
        snapshot: migratePersistedWorkspaceV1(parsed.data),
      };
    }
    const parsed = PersistedWorkspaceStateV2Schema.safeParse(value);
    if (!parsed.success) return invalidWorkspaceResult();
    return { error: null, snapshot: remapVersion2DuplicateTabRecords(parsed.data, value) };
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

function workspaceSavePatch(state: WorkspacePersistenceInput, recordedAtMs: number): SettingsPatch {
  if (!state.tabsState.tabs.length) {
    return { workspaceState: null, workspaceStateClearedAt: recordedAtMs };
  }
  const sourceTabs = state.tabsState.tabs;
  const tabsState = sanitizeTabsState(state.tabsState);
  const payload = PersistedWorkspaceStateV2Schema.parse({
    version: CURRENT_WORKSPACE_VERSION,
    savedAt: recordedAtMs,
    authFilter: state.authFilter,
    scripts: remapTabRecord(state.scripts, sourceTabs, tabsState.tabs, 'js-query'),
    fdqlSources: remapTabRecord(state.fdqlSources ?? {}, sourceTabs, tabsState.tabs, 'fdql'),
    sqlContexts: remapTabRecord(
      state.sqlContexts ?? {},
      sourceTabs,
      tabsState.tabs,
      'firestore-sql',
    ),
    sqlSources: remapTabRecord(
      state.sqlSources ?? {},
      sourceTabs,
      tabsState.tabs,
      'firestore-sql',
    ),
    tabsState,
  });
  return { workspaceState: payload };
}

function enqueueWorkspaceSave(
  settings: WorkspaceSaveSettings,
  patch: SettingsPatch,
): Promise<WorkspaceSaveResult> {
  const key = settings as object;
  const queue = workspaceSaveQueues.get(key) ?? { active: false, pending: null };
  workspaceSaveQueues.set(key, queue);
  return new Promise((resolve) => {
    const item = { patch, waiters: [resolve] };
    if (!queue.active) {
      queue.active = true;
      void drainWorkspaceSaveQueue(settings, queue, item);
      return;
    }
    if (queue.pending) {
      queue.pending.patch = patch;
      queue.pending.waiters.push(resolve);
      return;
    }
    queue.pending = item;
  });
}

async function drainWorkspaceSaveQueue(
  settings: WorkspaceSaveSettings,
  queue: WorkspaceSaveQueue,
  first: QueuedWorkspaceSave,
): Promise<void> {
  let current: QueuedWorkspaceSave | null = first;
  while (current) {
    // eslint-disable-next-line no-await-in-loop -- Writes must stay serialized.
    const result = await performWorkspaceSave(settings, current.patch);
    for (const resolve of current.waiters) resolve(result);
    current = queue.pending;
    queue.pending = null;
  }
  queue.active = false;
  workspaceSaveQueues.delete(settings);
}

async function performWorkspaceSave(
  settings: WorkspaceSaveSettings,
  patch: SettingsPatch,
): Promise<WorkspaceSaveResult> {
  try {
    await settings.save(patch);
    return null;
  } catch (error) {
    return saveFailure(error);
  }
}

function migratePersistedWorkspaceV1(state: PersistedWorkspaceStateV1): PersistedWorkspaceState {
  const migratedTabs = state.tabsState.tabs.map((tab): WorkspaceTab => {
    const connectionId = tab.connectionId ?? tab.projectId ?? '';
    if (tab.kind === 'firestore-query') {
      const activePath = tab.history[tab.historyIndex] ?? 'orders';
      return {
        id: tab.id,
        kind: tab.kind,
        connectionId,
        draft: cloneDraft(state.drafts[tab.id] ?? createFirestoreDraft(activePath)),
        inspectorUi: state.firestoreInspectorUi?.[tab.id] ?? defaultFirestoreInspectorUiState(),
        inspectorWidth: tab.inspectorWidth,
      };
    }
    return {
      id: tab.id,
      kind: tab.kind,
      connectionId,
      title: tab.title,
      history: tab.history,
      historyIndex: tab.historyIndex,
      inspectorWidth: tab.inspectorWidth,
    };
  });
  const migratedHistory: InteractionHistoryEntry[] = [];
  let migratedHistoryIndex = 0;
  const legacyHistoryIndex = clampInteractionHistoryIndex(
    state.tabsState.interactionHistoryIndex,
    state.tabsState.interactionHistory,
  );
  state.tabsState.interactionHistory.forEach((entry, index) => {
    const matchingIndexes = state.tabsState.tabs
      .map((tab, tabIndex) => ({ tab, tabIndex }))
      .filter(({ tab }) => tab.id === entry.activeTabId);
    const matched = matchingIndexes.find(({ tab }) =>
      entry.path !== undefined && tab.history.includes(entry.path)
    ) ?? matchingIndexes[0];
    const legacyTab = matched?.tab;
    const migratedTab = matched ? migratedTabs[matched.tabIndex] : undefined;
    if (!legacyTab || !migratedTab) {
      return;
    }
    const path = entry.path ?? legacyTab.history[legacyTab.historyIndex] ?? '';
    const isActiveSnapshot = index === legacyHistoryIndex
      && entry.activeTabId === state.tabsState.activeTabId;
    migratedHistory.push({
      activeTabId: entry.activeTabId,
      location: migratedTab.kind === 'firestore-query'
        ? {
          kind: 'firestore-query',
          connectionId: migratedTab.connectionId,
          draft: isActiveSnapshot
            ? cloneDraft(migratedTab.draft)
            : createFirestoreDraft(path || migratedTab.draft.path),
        }
        : { kind: 'tool', connectionId: migratedTab.connectionId, path },
      selectedTreeItemId: entry.selectedTreeItemId,
    });
    if (index <= legacyHistoryIndex) {
      migratedHistoryIndex = migratedHistory.length - 1;
    }
  });
  const selectedTreeItemId = migratedHistory[migratedHistoryIndex]?.selectedTreeItemId ?? null;
  const tabsState = sanitizeTabsState({
    activeTabId: state.tabsState.activeTabId,
    interactionHistory: migratedHistory,
    interactionHistoryIndex: migratedHistoryIndex,
    selectedTreeItemId,
    tabs: migratedTabs,
  });
  return {
    version: 2,
    ...(state.savedAt === undefined ? {} : { savedAt: state.savedAt }),
    authFilter: state.authFilter,
    scripts: remapLegacyTabRecord(
      state.scripts,
      state.tabsState.tabs,
      tabsState.tabs,
      'js-query',
    ),
    ...(state.fdqlSources === undefined
      ? {}
      : {
        fdqlSources: remapLegacyTabRecord(
          state.fdqlSources,
          state.tabsState.tabs,
          tabsState.tabs,
          'fdql',
        ),
      }),
    ...(state.sqlContexts === undefined
      ? {}
      : {
        sqlContexts: remapLegacyTabRecord(
          state.sqlContexts,
          state.tabsState.tabs,
          tabsState.tabs,
          'firestore-sql',
        ),
      }),
    ...(state.sqlSources === undefined
      ? {}
      : {
        sqlSources: remapLegacyTabRecord(
          state.sqlSources,
          state.tabsState.tabs,
          tabsState.tabs,
          'firestore-sql',
        ),
      }),
    tabsState,
  };
}

function remapVersion2DuplicateTabRecords(
  state: PersistedWorkspaceState,
  raw: unknown,
): PersistedWorkspaceState {
  const sourceTabs = rawWorkspaceTabs(raw);
  if (sourceTabs.length !== state.tabsState.tabs.length) return state;
  return {
    ...state,
    scripts: remapTabRecord(state.scripts, sourceTabs, state.tabsState.tabs, 'js-query'),
    ...(state.fdqlSources === undefined
      ? {}
      : {
        fdqlSources: remapTabRecord(
          state.fdqlSources,
          sourceTabs,
          state.tabsState.tabs,
          'fdql',
        ),
      }),
    ...(state.sqlContexts === undefined
      ? {}
      : {
        sqlContexts: remapTabRecord(
          state.sqlContexts,
          sourceTabs,
          state.tabsState.tabs,
          'firestore-sql',
        ),
      }),
    ...(state.sqlSources === undefined
      ? {}
      : {
        sqlSources: remapTabRecord(
          state.sqlSources,
          sourceTabs,
          state.tabsState.tabs,
          'firestore-sql',
        ),
      }),
  };
}

function remapLegacyTabRecord<T>(
  values: Readonly<Record<string, T>>,
  sourceTabs: ReadonlyArray<{ readonly id: string; readonly kind: string; }>,
  normalizedTabs: ReadonlyArray<WorkspaceTab>,
  kind: WorkspaceTab['kind'],
): Readonly<Record<string, T>> {
  return remapTabRecord(values, sourceTabs, normalizedTabs, kind);
}

function remapTabRecord<T>(
  values: Readonly<Record<string, T>>,
  sourceTabs: ReadonlyArray<{ readonly id: string; readonly kind: string; }>,
  normalizedTabs: ReadonlyArray<WorkspaceTab>,
  kind: WorkspaceTab['kind'],
): Readonly<Record<string, T>> {
  const remapped: Record<string, T> = {};
  sourceTabs.forEach((sourceTab, index) => {
    const normalizedTab = normalizedTabs[index];
    if (
      sourceTab.kind !== kind
      || normalizedTab?.kind !== kind
      || !Object.hasOwn(values, sourceTab.id)
    ) return;
    remapped[normalizedTab.id] = values[sourceTab.id]!;
  });
  return remapped;
}

function rawWorkspaceTabs(
  value: unknown,
): ReadonlyArray<{ readonly id: string; readonly kind: string; }> {
  if (!isRecord(value) || !isRecord(value.tabsState)) return [];
  const tabs = value.tabsState.tabs;
  if (!Array.isArray(tabs)) return [];
  return tabs.flatMap((tab) =>
    isRecord(tab) && typeof tab.id === 'string' && typeof tab.kind === 'string'
      ? [{ id: tab.id, kind: tab.kind }]
      : []
  );
}

function legacyRecoveryDiagnostic(state: PersistedWorkspaceStateV1): string | null {
  const firestoreTabIds = new Set(
    state.tabsState.tabs.filter((tab) => tab.kind === 'firestore-query').map((tab) => tab.id),
  );
  const hasOrphanRecord = [
    ...Object.keys(state.drafts),
    ...Object.keys(state.firestoreInspectorUi ?? {}),
  ].some((tabId) => !firestoreTabIds.has(tabId));
  const tabKindsById = new Map<string, Set<string>>();
  for (const tab of state.tabsState.tabs) {
    const kinds = tabKindsById.get(tab.id) ?? new Set<string>();
    kinds.add(tab.kind);
    tabKindsById.set(tab.id, kinds);
  }
  const hasOrphanToolRecord = [
    ...Object.keys(state.scripts).map((tabId) => [tabId, 'js-query'] as const),
    ...Object.keys(state.fdqlSources ?? {}).map((tabId) => [tabId, 'fdql'] as const),
    ...Object.keys(state.sqlSources ?? {}).map((tabId) => [tabId, 'firestore-sql'] as const),
    ...Object.keys(state.sqlContexts ?? {}).map((tabId) => [tabId, 'firestore-sql'] as const),
  ].some(([tabId, kind]) => !tabKindsById.get(tabId)?.has(kind));
  return hasOrphanRecord || hasOrphanToolRecord
    ? 'Recovered workspace state; ignored orphan or mismatched tab records.'
    : null;
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
  history: ReadonlyArray<unknown>,
): number {
  if (!history.length) return 0;
  return Math.max(0, Math.min(index, history.length - 1));
}

function validateTabRecords(
  state: {
    readonly tabsState: { readonly tabs: ReadonlyArray<{ readonly id: string; }>; };
    readonly scripts: Readonly<Record<string, string>>;
    readonly fdqlSources?: Readonly<Record<string, string>> | undefined;
    readonly sqlContexts?: Readonly<Record<string, FirestoreSqlContext>> | undefined;
    readonly sqlSources?: Readonly<Record<string, string>> | undefined;
  },
  context: z.RefinementCtx,
): void {
  validateExternalTabRecords(state, new Set(state.tabsState.tabs.map((tab) => tab.id)), context);
}

function validateExternalTabRecords(
  state: {
    readonly scripts: Readonly<Record<string, string>>;
    readonly fdqlSources?: Readonly<Record<string, string>> | undefined;
    readonly sqlContexts?: Readonly<Record<string, FirestoreSqlContext>> | undefined;
    readonly sqlSources?: Readonly<Record<string, string>> | undefined;
  },
  tabIds: ReadonlySet<string>,
  context: z.RefinementCtx,
): void {
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
}

function cloneDraft(draft: FirestoreQueryDraft): FirestoreQueryDraft {
  return { ...draft, ...(draft.filters ? { filters: [...draft.filters] } : {}) };
}

function workspaceVersion(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const version = value.version;
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : null;
}

function savedAtFromRawWorkspace(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const savedAt = value.savedAt;
  return typeof savedAt === 'number' && Number.isFinite(savedAt) && savedAt >= 0 ? savedAt : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidWorkspaceResult(): LoadPersistedWorkspaceStateResult {
  return {
    error: {
      message: 'Saved workspace state is invalid and was not restored.',
      operation: 'load',
    },
    snapshot: null,
  };
}

function saveFailure(error: unknown): WorkspacePersistenceFailure {
  return {
    message: messageFromError(error, 'Could not save workspace state.'),
    operation: 'save',
  };
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
