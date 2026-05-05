import type { WorkspaceTabKind } from './workspaceTypes.ts';

export interface ParsedWorkspaceTreeItem {
  readonly connectionId?: string | undefined;
  readonly kind: string;
  readonly path?: string | undefined;
}

export interface WorkspaceTreeActiveTab {
  readonly id: string;
  readonly path?: string | undefined;
}

export type WorkspaceTreeTarget =
  | { readonly type: 'current'; readonly activeTabId: string | null; readonly path?: string; }
  | {
    readonly type: 'open-firestore';
    readonly connectionId: string;
    readonly newTab: boolean;
    readonly path: string;
  }
  | {
    readonly type: 'open-tool';
    readonly connectionId: string;
    readonly kind: Exclude<WorkspaceTabKind, 'firestore-query'>;
    readonly newTab: boolean;
    readonly path: string;
  };

export interface WorkspaceTreeSelectionResult {
  readonly lastAction: string;
  readonly selectedTreeItemId: string;
  readonly target: WorkspaceTreeTarget | null;
}

export interface WorkspaceTreeOpenResult {
  readonly target: WorkspaceTreeTarget | null;
}

export function selectWorkspaceTreeItemCommand(
  input: {
    readonly activeTab: WorkspaceTreeActiveTab | null;
    readonly item: ParsedWorkspaceTreeItem;
    readonly selectedTreeItemId: string;
  },
): WorkspaceTreeSelectionResult {
  return {
    lastAction: actionLabelForTreeItem(input.item.kind, input.item.path),
    selectedTreeItemId: input.selectedTreeItemId,
    target: selectTargetForTreeItem(input.item, input.activeTab),
  };
}

export function openWorkspaceTreeItemCommand(
  item: ParsedWorkspaceTreeItem,
): WorkspaceTreeOpenResult {
  if (item.kind === 'auth' && item.connectionId) {
    return { target: toolTarget('auth-users', item.connectionId, false) };
  }
  if (item.kind === 'script' && item.connectionId) {
    return { target: toolTarget('js-query', item.connectionId, true) };
  }
  if (item.kind === 'sql' && item.connectionId) {
    return { target: toolTarget('firestore-sql', item.connectionId, true) };
  }
  if (item.connectionId && item.path) {
    return {
      target: {
        connectionId: item.connectionId,
        newTab: true,
        path: item.path,
        type: 'open-firestore',
      },
    };
  }
  return { target: null };
}

function selectTargetForTreeItem(
  item: ParsedWorkspaceTreeItem,
  activeTab: WorkspaceTreeActiveTab | null,
): WorkspaceTreeTarget | null {
  if (item.kind === 'status') return null;
  if (item.kind === 'auth' && item.connectionId) {
    return toolTarget('auth-users', item.connectionId, false);
  }
  if (item.kind === 'script' && item.connectionId) {
    return toolTarget('js-query', item.connectionId, false);
  }
  if (item.kind === 'sql' && item.connectionId) {
    return toolTarget('firestore-sql', item.connectionId, false);
  }
  if (item.kind === 'collection' && item.connectionId && item.path) {
    return {
      connectionId: item.connectionId,
      newTab: false,
      path: item.path,
      type: 'open-firestore',
    };
  }
  return {
    activeTabId: activeTab?.id ?? null,
    ...(activeTab?.path === undefined ? {} : { path: activeTab.path }),
    type: 'current',
  };
}

function toolTarget(
  kind: Exclude<WorkspaceTabKind, 'firestore-query'>,
  connectionId: string,
  newTab: boolean,
): WorkspaceTreeTarget {
  return {
    connectionId,
    kind,
    newTab,
    path: kind === 'auth-users'
      ? 'auth/users'
      : kind === 'js-query'
      ? 'scripts/default'
      : 'sql/default',
    type: 'open-tool',
  };
}

function actionLabelForTreeItem(kind: string, path?: string): string {
  if (kind === 'collection') return `Opened ${path ?? 'collection'}`;
  if (kind === 'auth') return 'Opened Authentication';
  if (kind === 'script') return 'Opened JavaScript Query';
  if (kind === 'sql') return 'Opened Firestore SQL';
  if (kind === 'project') return 'Selected account';
  if (kind === 'firestore') return 'Selected Firestore';
  return 'Selected tree item';
}
