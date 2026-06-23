export type FirestoreInspectorSectionId =
  | 'fieldsInResults'
  | 'jsonContext'
  | 'selectionPreview';

export interface FirestoreInspectorSectionState {
  readonly fieldsInResults: boolean;
  readonly jsonContext: boolean;
  readonly selectionPreview: boolean;
}

export interface FirestoreInspectorUiState {
  readonly overviewCollapsed: boolean;
  readonly resultTreeExpandedIds: ReadonlyArray<string> | null;
  readonly sections: FirestoreInspectorSectionState;
  readonly selectionPreviewExpandedPathsByDocumentPath: Readonly<
    Record<string, ReadonlyArray<string>>
  >;
}
