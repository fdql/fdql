import type { AccountTreeItem } from '@firebase-desk/product-ui';
import type {
  FirestoreCollectionNode,
  FirestoreQuery,
  FirestoreQueryDraft,
  ProjectSummary,
} from '@firebase-desk/repo-contracts';
import { activePath, type WorkspaceTab } from './stores/tabsStore.ts';

export type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface LoadState<T> {
  readonly status: LoadStatus;
  readonly items: ReadonlyArray<T>;
  readonly errorMessage?: string;
}

export interface TreeCache {
  readonly roots: Readonly<Record<string, LoadState<FirestoreCollectionNode>>>;
  readonly tools: Readonly<Record<string, LoadState<'tools'>>>;
}

export interface ParsedTreeId {
  readonly kind: string;
  readonly path?: string;
  readonly connectionId?: string;
}

export type ConnectionTargetOption =
  | 'local-emulator'
  | 'mock-service-account'
  | 'production-service-account';

export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MAX_SIDEBAR_WIDTH = 560;
export const MIN_SIDEBAR_WIDTH = 280;
export const MIN_WORKSPACE_WIDTH = 360;
export const initialTreeCache: TreeCache = { roots: {}, tools: {} };
const TREE_NODE_KIND = {
  auth: 'auth',
  collection: 'collection',
  firestore: 'firestore',
  project: 'project',
  script: 'script',
  fdql: 'fdql',
  sql: 'sql',
  status: 'status',
} as const;
export const DEFAULT_FIRESTORE_DRAFT: FirestoreQueryDraft = {
  path: 'orders',
  filters: [],
  filterField: '',
  filterOp: '==',
  filterValue: '',
  sortField: '',
  sortDirection: 'desc',
  limit: 25,
};

export function projectIdForConnection(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'mock-connection';
}

export function projectTargetForOption(option: ConnectionTargetOption): ProjectSummary['target'] {
  return option === 'production-service-account' ? 'production' : 'emulator';
}

export function buildTreeItems(
  projects: ReadonlyArray<ProjectSummary>,
  expandedIds: ReadonlySet<string>,
  cache: TreeCache,
  selectedId: string | null,
  filterValue: string,
): ReadonlyArray<AccountTreeItem> {
  const items: AccountTreeItem[] = [];
  for (const project of projects) {
    const projectId = projectNodeId(project.id);
    items.push({
      id: projectId,
      kind: 'project',
      label: projectTreeLabel(project),
      depth: 0,
      hasChildren: true,
      expanded: expandedIds.has(projectId),
      ...(project.target === 'emulator' ? { projectTarget: project.target } : {}),
      selected: selectedId === projectId,
      canRemove: true,
    });
    if (!expandedIds.has(projectId)) continue;
    const toolState = cache.tools[project.id] ?? { status: 'idle', items: [] };
    appendStatus(items, toolState, projectId, 1);
    if (toolState.status !== 'success') continue;
    const firestoreId = firestoreNodeId(project.id);
    const rootState = cache.roots[project.id] ?? { status: 'idle', items: [] };
    items.push({
      id: firestoreId,
      kind: 'firestore',
      label: 'Firestore',
      depth: 1,
      hasChildren: true,
      expanded: expandedIds.has(firestoreId),
      secondary: rootState.status === 'success' ? String(rootState.items.length) : 'load',
      selected: selectedId === firestoreId,
      canCreateCollection: rootState.status === 'success',
      canRefresh: true,
    });
    if (expandedIds.has(firestoreId)) {
      appendStatus(items, rootState, firestoreId, 2);
      if (rootState.status === 'success' && rootState.items.length === 0) {
        appendEmptyRootState(items, firestoreId, project.projectId, 2);
      }
      for (const collection of rootState.items) {
        appendCollection(items, project.id, collection, 2, selectedId);
      }
    }
    items.push({
      id: authNodeId(project.id),
      kind: 'auth',
      label: 'Authentication',
      depth: 1,
      hasChildren: false,
      expanded: false,
      secondary: 'users',
      selected: selectedId === authNodeId(project.id),
    });
    items.push({
      id: scriptNodeId(project.id),
      kind: 'script',
      label: 'JavaScript Query',
      depth: 1,
      hasChildren: false,
      expanded: false,
      secondary: 'SDK',
      selected: selectedId === scriptNodeId(project.id),
    });
    items.push({
      id: fdqlNodeId(project.id),
      kind: 'fdql',
      label: 'FDQL',
      depth: 1,
      hasChildren: false,
      expanded: false,
      secondary: 'beta',
      selected: selectedId === fdqlNodeId(project.id),
    });
    items.push({
      id: sqlNodeId(project.id),
      kind: 'sql',
      label: 'Firestore SQL',
      depth: 1,
      hasChildren: false,
      expanded: false,
      secondary: 'read-only',
      selected: selectedId === sqlNodeId(project.id),
    });
  }
  const filter = filterValue.trim().toLowerCase();
  if (!filter) return items;
  return items.filter((item) =>
    item.label.toLowerCase().includes(filter) || item.secondary?.toLowerCase().includes(filter)
  );
}

export function getDraft(
  tab: WorkspaceTab | undefined,
  drafts: Readonly<Record<string, FirestoreQueryDraft>>,
): FirestoreQueryDraft {
  if (!tab) return DEFAULT_FIRESTORE_DRAFT;
  return drafts[tab.id] ?? {
    ...DEFAULT_FIRESTORE_DRAFT,
    path: activePath(tab) || DEFAULT_FIRESTORE_DRAFT.path,
  };
}

export function draftToQuery(connectionId: string, draft: FirestoreQueryDraft): FirestoreQuery {
  const path = normalizePath(draft.path);
  const useQueryControls = isCollectionPath(path);
  return {
    connectionId,
    path,
    filters: useQueryControls ? queryFiltersForDraft(draft) : [],
    sorts: useQueryControls && draft.sortField.trim()
      ? [{ field: draft.sortField.trim(), direction: draft.sortDirection }]
      : [],
  };
}

export function queryFiltersForDraft(
  draft: FirestoreQueryDraft,
): NonNullable<FirestoreQuery['filters']> {
  return (draft.filters ?? [])
    .filter((filter) => filter.field.trim())
    .map((filter) => ({
      field: filter.field.trim(),
      op: filter.op,
      value: parseFilterValue(filter.value),
    }));
}

export function parseFilterValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

export function normalizePath(path: string): string {
  return path.split('/').filter(Boolean).join('/');
}

export function isDocumentPath(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 && parts.length % 2 === 0;
}

export function isCollectionPath(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 && parts.length % 2 === 1;
}

export function resolveProject(
  projects: ReadonlyArray<ProjectSummary>,
  connectionId?: string | null,
): ProjectSummary | null {
  return projects.find((project) => project.id === connectionId) ?? null;
}

export function treeItemIdForTab(tab: WorkspaceTab): string {
  if (tab.kind === 'auth-users') return authNodeId(tab.connectionId);
  if (tab.kind === 'js-query') return scriptNodeId(tab.connectionId);
  if (tab.kind === 'firestore-sql') return sqlNodeId(tab.connectionId);
  if (tab.kind === 'fdql') return fdqlNodeId(tab.connectionId);
  return collectionNodeId(tab.connectionId, normalizePath(activePath(tab)));
}

export function omitKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  if (!(key in record)) return record;
  const next: Record<string, T> = {};
  for (const [itemKey, value] of Object.entries(record)) {
    if (itemKey !== key) next[itemKey] = value;
  }
  return next;
}

export function projectNodeId(projectId: string): string {
  return treeNodeId(TREE_NODE_KIND.project, projectId);
}

export function firestoreNodeId(projectId: string): string {
  return treeNodeId(TREE_NODE_KIND.firestore, projectId);
}

export function authNodeId(projectId: string): string {
  return treeNodeId(TREE_NODE_KIND.auth, projectId);
}

export function scriptNodeId(projectId: string): string {
  return treeNodeId(TREE_NODE_KIND.script, projectId);
}

export function fdqlNodeId(projectId: string): string {
  return treeNodeId(TREE_NODE_KIND.fdql, projectId);
}

export function sqlNodeId(projectId: string): string {
  return treeNodeId(TREE_NODE_KIND.sql, projectId);
}

export function collectionNodeId(projectId: string, path: string): string {
  return treeNodeId(TREE_NODE_KIND.collection, projectId, path);
}

export function parseTreeId(id: string): ParsedTreeId {
  const [kind, connectionId, ...pathParts] = id.split(':');
  const path = pathParts.join(':');
  return {
    kind: kind ?? '',
    ...(connectionId ? { connectionId } : {}),
    ...(path ? { path } : {}),
  };
}

export function parentIdForStatus(id: string): string | null {
  const prefix = `${TREE_NODE_KIND.status}:`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

export function actionLabelForTreeItem(kind: string, path?: string): string {
  if (kind === 'collection') return `Opened ${path ?? 'collection'}`;
  if (kind === 'auth') return 'Opened Authentication';
  if (kind === 'script') return 'Opened JavaScript Query';
  if (kind === 'fdql') return 'Opened FDQL';
  if (kind === 'sql') return 'Opened Firestore SQL';
  if (kind === 'project') return 'Selected account';
  if (kind === 'firestore') return 'Selected Firestore';
  return 'Selected tree item';
}

export function toggleSet(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function appendCollection(
  items: AccountTreeItem[],
  projectId: string,
  collection: FirestoreCollectionNode,
  depth: number,
  selectedId: string | null,
) {
  const id = collectionNodeId(projectId, collection.path);
  items.push({
    id,
    kind: 'collection',
    label: collection.id,
    depth,
    hasChildren: false,
    expanded: false,
    selected: selectedId === id,
  });
}

function projectTreeLabel(project: ProjectSummary): string {
  if (project.name === project.projectId) return project.name;
  return `${project.name} (${project.projectId})`;
}

function appendEmptyRootState(
  items: AccountTreeItem[],
  parentId: string,
  projectId: string,
  depth: number,
) {
  items.push({
    id: treeNodeId(TREE_NODE_KIND.status, parentId),
    kind: 'status',
    label: 'No root collections',
    depth,
    hasChildren: false,
    expanded: false,
    canRefresh: true,
    secondary: projectId,
  });
}

function appendStatus<T>(
  items: AccountTreeItem[],
  state: LoadState<T>,
  parentId: string,
  depth: number,
) {
  if (state.status !== 'loading' && state.status !== 'error') return;
  items.push({
    id: treeNodeId(TREE_NODE_KIND.status, parentId),
    kind: 'status',
    label: state.status === 'loading' ? 'Loading' : 'Load failed',
    depth,
    hasChildren: false,
    expanded: false,
    canRefresh: state.status === 'error',
    ...(state.errorMessage ? { secondary: state.errorMessage } : {}),
    status: state.status,
  });
}

function treeNodeId(kind: string, connectionId: string, path?: string): string {
  return path === undefined ? `${kind}:${connectionId}` : `${kind}:${connectionId}:${path}`;
}
