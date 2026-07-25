import type {
  FirestoreDocumentResult,
  FirestoreQueryDraft,
  FirestoreQueryDraftEdit,
  FirestoreSaveDocumentResult,
  FirestoreUpdateDocumentFieldsResult,
  SettingsRepository,
  SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { MockSettingsRepository } from '@firebase-desk/repo-mocks';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '../../appearance/AppearanceProvider.tsx';
import type { DeleteDocumentOptions } from './deleteDocumentModel.ts';
import { FirestoreQuerySurface } from './FirestoreQuerySurface.tsx';
import type { FirestoreResultView } from './types.ts';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (
    { count, estimateSize }: {
      readonly count: number;
      readonly estimateSize: (index: number) => number;
    },
  ) => {
    const size = count > 0 ? estimateSize(0) : 0;
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: index,
          start: index * size,
          size,
        })),
    };
  },
}));

vi.mock('../../hooks/useMediaQuery.ts', () => ({
  useMediaQuery: () => true,
}));

vi.mock('../../code-editor/CodeEditor.tsx', () => ({
  CodeEditor: (
    { onChange, value }: {
      readonly onChange?: (value: string) => void;
      readonly value: string;
    },
  ) => (
    <textarea
      aria-label='JSON value'
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
  DiffCodeEditor: (
    {
      modified,
      onModifiedChange,
      original,
    }: {
      readonly modified: string;
      readonly onModifiedChange?: (value: string) => void;
      readonly original: string;
    },
  ) => (
    <div>
      <pre>{original}</pre>
      <textarea
        aria-label='Merge draft'
        value={modified}
        onChange={(event) => onModifiedChange?.(event.currentTarget.value)}
      />
    </div>
  ),
}));

vi.mock('./FieldContextMenu.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./FieldContextMenu.tsx')>();
  return {
    ...actual,
    FieldContextMenu: (
      {
        children,
        document,
        fieldPath,
        onDeleteField,
        onEditField,
        onSetFieldNull,
        value,
      }: {
        readonly children: ReactNode;
        readonly document: FirestoreDocumentResult;
        readonly fieldPath: ReadonlyArray<string>;
        readonly onDeleteField?:
          | ((target: {
            readonly documentPath: string;
            readonly fieldPath: ReadonlyArray<string>;
            readonly value: unknown;
          }) => void)
          | undefined;
        readonly onEditField?:
          | ((target: {
            readonly documentPath: string;
            readonly fieldPath: ReadonlyArray<string>;
            readonly value: unknown;
          }, jsonMode: boolean) => void)
          | undefined;
        readonly onSetFieldNull?:
          | ((target: {
            readonly documentPath: string;
            readonly fieldPath: ReadonlyArray<string>;
            readonly value: unknown;
          }) => void)
          | undefined;
        readonly value: unknown;
      },
    ) => (
      <span>
        {children}
        <button
          type='button'
          onClick={() => onSetFieldNull?.({ documentPath: document.path, fieldPath, value })}
        >
          set null {fieldPath.join('.')}
        </button>
        <button
          type='button'
          onClick={() => onDeleteField?.({ documentPath: document.path, fieldPath, value })}
        >
          delete {fieldPath.join('.')}
        </button>
        <button
          type='button'
          onClick={() => onEditField?.({ documentPath: document.path, fieldPath, value }, false)}
        >
          edit {fieldPath.join('.')}
        </button>
      </span>
    ),
  };
});

const draft: FirestoreQueryDraft = {
  path: 'orders',
  filters: [],
  filterField: '',
  filterOp: '==',
  filterValue: '',
  limit: 25,
  sortDirection: 'desc',
  sortField: '',
};

const document: FirestoreDocumentResult = {
  id: 'ord_1',
  path: 'orders/ord_1',
  data: { active: true, meta: { count: 2 }, 'a.b': 'literal' },
  hasSubcollections: false,
  updateTime: '2026-04-29T00:00:00.000Z',
};

const documentWithSubcollections: FirestoreDocumentResult = {
  ...document,
  hasSubcollections: true,
  subcollections: [{
    id: 'events',
    path: 'orders/ord_1/events',
    documentCount: 1,
    documents: [{
      id: 'evt_1',
      path: 'orders/ord_1/events/evt_1',
      data: { type: 'created' },
      hasSubcollections: false,
    }],
  } as CollectionWithDocuments],
};

describe('FirestoreQuerySurface editing UX', () => {
  it('forwards granular query draft edits', () => {
    const onDraftEdit = vi.fn<(edit: FirestoreQueryDraftEdit) => void>();
    renderSurface({ onDraftEdit });

    fireEvent.change(screen.getByLabelText('Query path'), {
      target: { value: 'customers' },
    });

    expect(onDraftEdit).toHaveBeenCalledWith({ type: 'path-set', path: 'customers' });
  });

  it('quick toggles a boolean field from the selection preview', async () => {
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>();
    renderSurface({ onUpdateDocumentFields });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle active' }));

    await waitFor(() =>
      expect(onUpdateDocumentFields).toHaveBeenCalledWith(
        'orders/ord_1',
        [{
          baseValue: true,
          fieldPath: ['active'],
          type: 'set',
          value: false,
        }],
        {
          lastUpdateTime: document.updateTime,
          staleBehavior: 'save-and-notify',
        },
      )
    );
  });

  it('sets a field to null and shows manual refresh banner', async () => {
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>();
    renderSurface({ onUpdateDocumentFields });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);

    await waitFor(() =>
      expect(onUpdateDocumentFields).toHaveBeenCalledWith(
        'orders/ord_1',
        [{
          baseValue: true,
          fieldPath: ['active'],
          type: 'set',
          value: null,
        }],
        {
          lastUpdateTime: document.updateTime,
          staleBehavior: 'save-and-notify',
        },
      )
    );
    expect(await screen.findByText('Results changed.')).toBeTruthy();
  });

  it('uses controlled results changed state and clears it before running query', () => {
    const onResultsStaleChange = vi.fn();
    const onRun = vi.fn();
    renderSurface({
      onResultsStaleChange,
      onRun,
      resultsStale: true,
    });

    expect(screen.getByText('Results changed.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onResultsStaleChange).toHaveBeenCalledWith(false);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('reports controlled results changed state after field writes', async () => {
    const onResultsStaleChange = vi.fn();
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>();
    renderSurface({ onResultsStaleChange, onUpdateDocumentFields });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);

    await waitFor(() => expect(onResultsStaleChange).toHaveBeenCalledWith(true));
  });

  it('syncs saved field results without marking results stale', async () => {
    const savedDocument = {
      ...document,
      data: { ...document.data, active: null },
      updateTime: '2026-04-29T00:01:00.000Z',
    };
    const onResultDocumentSaved = vi.fn();
    const onResultsStaleChange = vi.fn();
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>().mockResolvedValue({
      status: 'saved',
      document: savedDocument,
    });
    renderSurface({
      onResultDocumentSaved,
      onResultsStaleChange,
      onUpdateDocumentFields,
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);

    await waitFor(() => expect(onResultDocumentSaved).toHaveBeenCalledWith(savedDocument));
    expect(onResultsStaleChange).not.toHaveBeenCalledWith(true);
  });

  it('syncs saved document results without marking results stale', async () => {
    const savedDocument = {
      ...document,
      data: { active: false },
      updateTime: '2026-04-29T00:01:00.000Z',
    };
    const onResultDocumentSaved = vi.fn();
    const onResultsStaleChange = vi.fn();
    const onSaveDocument = vi.fn<SaveDocument>().mockResolvedValue({
      status: 'saved',
      document: savedDocument,
    });
    renderSurface({ onResultDocumentSaved, onResultsStaleChange, onSaveDocument });

    fireEvent.click(screen.getByRole('button', { name: 'Edit document' }));
    fireEvent.change(screen.getByLabelText('JSON value'), {
      target: { value: '{"active":false}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onResultDocumentSaved).toHaveBeenCalledWith(savedDocument));
    expect(onResultsStaleChange).not.toHaveBeenCalledWith(true);
  });

  it('does not sync result rows when field writes conflict', async () => {
    const remoteDocument = {
      ...document,
      data: { active: false },
      updateTime: '2026-04-29T00:01:00.000Z',
    };
    const onResultDocumentSaved = vi.fn();
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>().mockResolvedValue({
      status: 'conflict',
      remoteDocument,
    });
    renderSurface({ onResultDocumentSaved, onUpdateDocumentFields });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);

    expect(await screen.findByRole('dialog', { name: 'Resolve save conflict' })).toBeTruthy();
    expect(onResultDocumentSaved).not.toHaveBeenCalled();
  });

  it('uses controlled result view state', () => {
    const onResultViewChange = vi.fn();
    renderSurface({ onResultViewChange, resultView: 'table' });

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Tree' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(onResultViewChange).toHaveBeenCalledWith('tree');
  });

  it('defaults stale behavior when settings predate Firestore write settings', async () => {
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>();
    renderSurface({
      onUpdateDocumentFields,
      settings: createLegacySettingsRepository(),
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);

    await waitFor(() =>
      expect(onUpdateDocumentFields).toHaveBeenCalledWith(
        'orders/ord_1',
        [{
          baseValue: true,
          fieldPath: ['active'],
          type: 'set',
          value: null,
        }],
        {
          lastUpdateTime: document.updateTime,
          staleBehavior: 'save-and-notify',
        },
      )
    );
  });

  it('confirms before deleting a field', async () => {
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>();
    renderSurface({ onUpdateDocumentFields });

    fireEvent.click(screen.getAllByRole('button', { name: 'delete active' })[0]!);
    expect(screen.getByRole('dialog', { name: 'Delete field' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(onUpdateDocumentFields).toHaveBeenCalledWith(
        'orders/ord_1',
        [{
          baseValue: true,
          fieldPath: ['active'],
          type: 'delete',
        }],
        {
          lastUpdateTime: document.updateTime,
          staleBehavior: 'save-and-notify',
        },
      )
    );
  });

  it('edits a literal dotted field name without treating it as nested', async () => {
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>();
    renderSurface({ onUpdateDocumentFields });

    fireEvent.click(screen.getAllByRole('button', { name: 'edit a.b' })[0]!);
    fireEvent.change(screen.getByLabelText('Field string value'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(onUpdateDocumentFields).toHaveBeenCalledWith(
        'orders/ord_1',
        [{
          baseValue: 'literal',
          fieldPath: ['a.b'],
          type: 'set',
          value: 'changed',
        }],
        {
          lastUpdateTime: document.updateTime,
          staleBehavior: 'save-and-notify',
        },
      )
    );
  });

  it('creates a document with a generated ID that can be overwritten', async () => {
    const onCreateDocument = vi.fn<CreateDocument>();
    const onGenerateDocumentId = vi.fn(async () => 'generated_id');
    renderSurface({
      onCreateDocument,
      onGenerateDocumentId,
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'New document' })[0]!);
    expect(await screen.findByDisplayValue('generated_id')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Document ID'), { target: { value: 'manual_id' } });
    fireEvent.change(screen.getByLabelText('JSON value'), {
      target: { value: '{"status":"draft"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(onCreateDocument).toHaveBeenCalledWith('orders', 'manual_id', { status: 'draft' })
    );
    expect(await screen.findByText('Results changed.')).toBeTruthy();
  });

  it('opens new collection requests with editable collection path and hint', async () => {
    const onCreateDocument = vi.fn<CreateDocument>();
    renderSurface({
      createDocumentRequest: {
        collectionPath: '',
        collectionPathEditable: true,
        requestId: 1,
      },
      onCreateDocument,
      onGenerateDocumentId: () => 'generated_id',
    });

    expect(await screen.findByRole('dialog', { name: 'New collection' })).toBeTruthy();
    expect(screen.getByText(/Firestore creates a collection/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Collection path'), {
      target: { value: 'invoices' },
    });
    expect(await screen.findByDisplayValue('generated_id')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Document ID'), { target: { value: 'first' } });
    fireEvent.change(screen.getByLabelText('JSON value'), {
      target: { value: '{"status":"new"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(onCreateDocument).toHaveBeenCalledWith('invoices', 'first', { status: 'new' })
    );
  });

  it('closes pending dialogs when the target scope changes', async () => {
    render(<ScopedCreateRequestSurface />);

    expect(await screen.findByRole('dialog', { name: 'New document' })).toBeTruthy();
    fireEvent.click(screen.getByText('Change target'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'New document' })).toBeNull();
    });
  });

  it('opens editable conflict merge and saves merged JSON with remote update time', async () => {
    const remoteDocument: FirestoreDocumentResult = {
      ...document,
      data: { active: false, meta: { count: 3 }, 'a.b': 'remote' },
      updateTime: '2026-04-29T00:01:00.000Z',
    };
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>()
      .mockResolvedValueOnce({ status: 'conflict', remoteDocument });
    const onSaveDocument = vi.fn<SaveDocument>()
      .mockResolvedValueOnce({ status: 'saved', document: remoteDocument });
    renderSurface({ onSaveDocument, onUpdateDocumentFields });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);
    expect(await screen.findByRole('dialog', { name: 'Resolve save conflict' })).toBeTruthy();
    expect(screen.getByText(/"a.b": "remote"/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Merge draft'), {
      target: { value: '{"active":"merged"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save merged' }));

    await waitFor(() =>
      expect(onSaveDocument).toHaveBeenLastCalledWith(
        'orders/ord_1',
        { active: 'merged' },
        { lastUpdateTime: remoteDocument.updateTime },
      )
    );
  });

  it('saves stale unchanged fields by default and shows a notice', async () => {
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>().mockResolvedValue({
      status: 'saved',
      document,
      documentChanged: true,
    });
    renderSurface({ onUpdateDocumentFields });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);

    await waitFor(() => expect(onUpdateDocumentFields).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Document changed elsewhere/)).toBeTruthy();
  });

  it('confirms stale unchanged field writes when configured', async () => {
    const settings = new MockSettingsRepository();
    await settings.save({ firestoreWrites: { fieldStaleBehavior: 'confirm' } });
    const remoteDocument = {
      ...document,
      updateTime: '2026-04-29T00:02:00.000Z',
    };
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>()
      .mockResolvedValueOnce({ status: 'document-changed', remoteDocument })
      .mockResolvedValueOnce({ status: 'saved', document: remoteDocument });
    renderSurface({ onUpdateDocumentFields, settings });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);
    expect(await screen.findByRole('dialog', { name: 'Document changed elsewhere' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save field' }));

    await waitFor(() =>
      expect(onUpdateDocumentFields).toHaveBeenLastCalledWith(
        'orders/ord_1',
        expect.any(Array),
        {
          lastUpdateTime: remoteDocument.updateTime,
          staleBehavior: 'confirm',
        },
      )
    );
  });

  it('shows an error when confirmed stale field writes fail', async () => {
    const settings = new MockSettingsRepository();
    await settings.save({ firestoreWrites: { fieldStaleBehavior: 'confirm' } });
    const remoteDocument = {
      ...document,
      updateTime: '2026-04-29T00:02:00.000Z',
    };
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>()
      .mockResolvedValueOnce({ status: 'document-changed', remoteDocument })
      .mockRejectedValueOnce(new Error('retry failed'));
    renderSurface({ onUpdateDocumentFields, settings });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);
    expect(await screen.findByRole('dialog', { name: 'Document changed elsewhere' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save field' }));

    expect(await screen.findByText('retry failed')).toBeTruthy();
  });

  it('blocks stale unchanged field writes when configured', async () => {
    const settings = new MockSettingsRepository();
    await settings.save({ firestoreWrites: { fieldStaleBehavior: 'block' } });
    const remoteDocument = {
      ...document,
      updateTime: '2026-04-29T00:02:00.000Z',
    };
    const onUpdateDocumentFields = vi.fn<UpdateDocumentFields>()
      .mockResolvedValueOnce({ status: 'document-changed', remoteDocument });
    renderSurface({ onUpdateDocumentFields, settings });

    fireEvent.click(screen.getAllByRole('button', { name: 'set null active' })[0]!);

    expect(await screen.findByText('Document changed elsewhere. Refresh before saving this field.'))
      .toBeTruthy();
  });
  it('confirms document delete and includes selected subcollections', async () => {
    const onSaveDocument = vi.fn<SaveDocument>();
    const onDeleteDocument = vi.fn<DeleteDocument>();
    renderSurface({
      document: documentWithSubcollections,
      onDeleteDocument,
      onSaveDocument,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete document' });
    expect(dialog).toBeTruthy();
    const checkbox = screen.getByRole('checkbox', { name: /Delete subcollection events/ });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).queryByText('1 docs')).toBeNull();

    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(onDeleteDocument).toHaveBeenCalledWith('orders/ord_1', {
        deleteSubcollectionPaths: ['orders/ord_1/events'],
        deleteDescendantDocumentPaths: ['orders/ord_1/events/evt_1'],
      })
    );
  });

  it('syncs deleted result rows without marking results stale', async () => {
    const onDeleteDocument = vi.fn<DeleteDocument>();
    const onResultDocumentDeleted = vi.fn();
    const onResultsStaleChange = vi.fn();
    renderSurface({ onDeleteDocument, onResultDocumentDeleted, onResultsStaleChange });

    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onResultDocumentDeleted).toHaveBeenCalledWith('orders/ord_1'));
    expect(onResultsStaleChange).not.toHaveBeenCalledWith(true);
  });

  it('shows delete document errors once', async () => {
    const onSaveDocument = vi.fn<SaveDocument>();
    const onDeleteDocument = vi.fn<DeleteDocument>(() => {
      throw new Error('delete failed');
    });
    renderSurface({ onDeleteDocument, onSaveDocument });

    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getAllByText('delete failed')).toHaveLength(1));
  });
});

function renderSurface(
  {
    createDocumentRequest,
    document: inputDocument = document,
    onDeleteDocument,
    onCreateDocument,
    onDraftEdit,
    onGenerateDocumentId,
    onResultViewChange,
    onResultDocumentDeleted,
    onResultDocumentSaved,
    onResultsStaleChange,
    onRun,
    onSaveDocument,
    onUpdateDocumentFields,
    resultView,
    resultsStale,
    settings = new MockSettingsRepository(),
  }: {
    readonly createDocumentRequest?: {
      readonly collectionPath: string;
      readonly collectionPathEditable?: boolean;
      readonly requestId: number;
    };
    readonly document?: FirestoreDocumentResult;
    readonly onCreateDocument?: CreateDocument;
    readonly onDeleteDocument?: DeleteDocument;
    readonly onDraftEdit?: (edit: FirestoreQueryDraftEdit) => void;
    readonly onGenerateDocumentId?: (collectionPath: string) => Promise<string> | string;
    readonly onResultViewChange?: (resultView: FirestoreResultView) => void;
    readonly onResultDocumentDeleted?: (documentPath: string) => void;
    readonly onResultDocumentSaved?: (document: FirestoreDocumentResult) => void;
    readonly onResultsStaleChange?: (stale: boolean) => void;
    readonly onRun?: () => void;
    readonly onSaveDocument?: SaveDocument;
    readonly onUpdateDocumentFields?: UpdateDocumentFields;
    readonly resultView?: FirestoreResultView;
    readonly resultsStale?: boolean;
    readonly settings?: SettingsRepository;
  },
) {
  render(
    <AppearanceProvider settings={settings}>
      <FirestoreQuerySurface
        createDocumentRequest={createDocumentRequest}
        draft={draft}
        hasMore={false}
        rows={[inputDocument]}
        selectedDocument={inputDocument}
        selectedDocumentPath={inputDocument.path}
        resultView={resultView}
        resultsStale={resultsStale}
        {...(onCreateDocument ? { onCreateDocument } : {})}
        {...(onDeleteDocument ? { onDeleteDocument } : {})}
        {...(onGenerateDocumentId ? { onGenerateDocumentId } : {})}
        onDraftEdit={onDraftEdit ?? (() => {})}
        onLoadMore={() => {}}
        onOpenDocumentInNewTab={() => {}}
        onResultViewChange={onResultViewChange}
        onResultDocumentDeleted={onResultDocumentDeleted}
        onResultDocumentSaved={onResultDocumentSaved}
        onResultsStaleChange={onResultsStaleChange}
        onRun={onRun ?? (() => {})}
        onSaveDocument={onSaveDocument ?? vi.fn<SaveDocument>()}
        {...(onUpdateDocumentFields ? { onUpdateDocumentFields } : {})}
        onSelectDocument={() => {}}
        settings={settings}
      />
    </AppearanceProvider>,
  );
}

type SaveDocument = (
  documentPath: string,
  data: Record<string, unknown>,
  options?: { readonly lastUpdateTime?: string; },
) => FirestoreSaveDocumentResult | void | Promise<FirestoreSaveDocumentResult | void>;

function ScopedCreateRequestSurface() {
  const [scope, setScope] = useState('emu:orders');
  const [settings] = useState(() => new MockSettingsRepository());
  return (
    <AppearanceProvider settings={settings}>
      <button type='button' onClick={() => setScope('emu:auditLogs')}>Change target</button>
      <FirestoreQuerySurface
        createDocumentRequest={{ collectionPath: 'orders', requestId: 1 }}
        draft={draft}
        hasMore={false}
        rows={[document]}
        selectedDocument={document}
        selectedDocumentPath={document.path}
        settings={settings}
        targetScopeKey={scope}
        onCreateDocument={() => {}}
        onDraftEdit={() => {}}
        onGenerateDocumentId={() => 'generated_id'}
        onLoadMore={() => {}}
        onOpenDocumentInNewTab={() => {}}
        onRun={() => {}}
        onSelectDocument={() => {}}
      />
    </AppearanceProvider>
  );
}

type UpdateDocumentFields = (
  documentPath: string,
  operations: ReadonlyArray<{
    readonly baseValue: unknown;
    readonly fieldPath: ReadonlyArray<string>;
    readonly type: 'delete' | 'set';
    readonly value?: unknown;
  }>,
  options: {
    readonly lastUpdateTime?: string;
    readonly staleBehavior: 'block' | 'confirm' | 'save-and-notify';
  },
) =>
  | FirestoreUpdateDocumentFieldsResult
  | void
  | Promise<FirestoreUpdateDocumentFieldsResult | void>;
type CreateDocument = (
  collectionPath: string,
  documentId: string,
  data: Record<string, unknown>,
) => void;
type DeleteDocument = (documentPath: string, options: DeleteDocumentOptions) => void;
type CollectionWithDocuments = NonNullable<FirestoreDocumentResult['subcollections']>[number] & {
  readonly documents: ReadonlyArray<FirestoreDocumentResult>;
};

function createLegacySettingsRepository(): SettingsRepository {
  const delegate = new MockSettingsRepository();
  return {
    async load() {
      const { firestoreWrites: _firestoreWrites, ...snapshot } = await delegate.load();
      return snapshot as unknown as SettingsSnapshot;
    },
    save: (patch) => delegate.save(patch),
    getHotkeyOverrides: () => delegate.getHotkeyOverrides(),
    setHotkeyOverrides: (overrides) => delegate.setHotkeyOverrides(overrides),
  };
}
