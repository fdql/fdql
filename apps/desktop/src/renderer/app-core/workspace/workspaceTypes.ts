import type { FirestoreQueryDraft } from '@firebase-desk/repo-contracts';
import type { FirestoreInspectorUiState } from '../firestore/query/firestoreQueryState.ts';

export const WORKSPACE_TAB_KINDS = [
  'firestore-query',
  'auth-users',
  'js-query',
  'firestore-sql',
  'fdql',
] as const;

export type WorkspaceTabKind = (typeof WORKSPACE_TAB_KINDS)[number];

interface WorkspaceTabBase {
  readonly id: string;
  readonly connectionId: string;
  readonly kind: WorkspaceTabKind;
  readonly inspectorWidth: number;
}

export interface FirestoreQueryTab extends WorkspaceTabBase {
  readonly kind: 'firestore-query';
  readonly draft: FirestoreQueryDraft;
  readonly inspectorUi: FirestoreInspectorUiState;
}

export interface ToolWorkspaceTab extends WorkspaceTabBase {
  readonly kind: Exclude<WorkspaceTabKind, 'firestore-query'>;
  readonly title: string;
  readonly history: ReadonlyArray<string>;
  readonly historyIndex: number;
}

export type WorkspaceTab = FirestoreQueryTab | ToolWorkspaceTab;

export interface FirestoreInteractionLocation {
  readonly kind: 'firestore-query';
  readonly connectionId: string;
  readonly draft: FirestoreQueryDraft;
}

export interface ToolInteractionLocation {
  readonly kind: 'tool';
  readonly connectionId: string;
  readonly path: string;
}

export type WorkspaceInteractionLocation =
  | FirestoreInteractionLocation
  | ToolInteractionLocation;

export interface InteractionHistoryEntry {
  readonly activeTabId: string;
  readonly location: WorkspaceInteractionLocation;
  readonly selectedTreeItemId: string | null;
}

export interface TabsState {
  readonly activeTabId: string;
  readonly interactionHistory: ReadonlyArray<InteractionHistoryEntry>;
  readonly interactionHistoryIndex: number;
  readonly selectedTreeItemId: string | null;
  readonly tabs: ReadonlyArray<WorkspaceTab>;
}

export interface OpenFirestoreTabInput {
  readonly connectionId: string;
  readonly draft?: FirestoreQueryDraft;
  readonly kind: 'firestore-query';
  readonly path?: string;
}

export interface OpenFirestoreTargetInput {
  readonly connectionId: string;
  readonly draft?: FirestoreQueryDraft;
  readonly newTab: boolean;
  readonly path: string;
}

export interface OpenToolTabInput {
  readonly connectionId: string;
  readonly kind: Exclude<WorkspaceTabKind, 'firestore-query'>;
  readonly path?: string;
}

export type OpenTabInput = OpenFirestoreTabInput | OpenToolTabInput;

export interface SelectionState {
  readonly authUserId: string | null;
}
