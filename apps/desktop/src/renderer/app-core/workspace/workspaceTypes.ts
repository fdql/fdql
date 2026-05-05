export const WORKSPACE_TAB_KINDS = [
  'firestore-query',
  'auth-users',
  'js-query',
  'firestore-sql',
] as const;

export type WorkspaceTabKind = (typeof WORKSPACE_TAB_KINDS)[number];

export interface WorkspaceTab {
  readonly id: string;
  readonly kind: WorkspaceTabKind;
  readonly title: string;
  readonly connectionId: string;
  readonly history: ReadonlyArray<string>;
  readonly historyIndex: number;
  readonly inspectorWidth: number;
}

export interface InteractionHistoryEntry {
  readonly activeTabId: string;
  readonly path?: string;
  readonly selectedTreeItemId: string | null;
}

export interface TabsState {
  readonly activeTabId: string;
  readonly interactionHistory: ReadonlyArray<InteractionHistoryEntry>;
  readonly interactionHistoryIndex: number;
  readonly tabs: ReadonlyArray<WorkspaceTab>;
}

export interface OpenTabInput {
  readonly kind: WorkspaceTabKind;
  readonly connectionId: string;
  readonly path?: string;
}

export interface SelectionState {
  readonly authUserId: string | null;
  readonly treeItemId: string | null;
}
