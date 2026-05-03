import { MockSettingsRepository } from '@firebase-desk/repo-mocks';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '../../appearance/AppearanceProvider.tsx';
import { CreateDocumentModal } from './CreateDocumentModal.tsx';

vi.mock('../../code-editor/CodeEditor.tsx', () => ({
  CodeEditor: (
    { onChange, value }: {
      readonly onChange?: (value: string) => void;
      readonly value: string;
    },
  ) => (
    <textarea
      aria-label='Document JSON'
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CreateDocumentModal', () => {
  it('generates an ID, allows override, and creates object JSON', async () => {
    const onCreateDocument = vi.fn<CreateDocument>();
    renderModal({ onCreateDocument });

    expect(await screen.findByDisplayValue('generated_id')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Document ID'), { target: { value: 'manual_id' } });
    fireEvent.change(screen.getByLabelText('Document JSON'), {
      target: { value: '{"status":"draft"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(onCreateDocument).toHaveBeenCalledWith('orders', 'manual_id', { status: 'draft' })
    );
  });

  it('validates document ID and preserves draft JSON', async () => {
    const onCreateDocument = vi.fn<CreateDocument>();
    renderModal({ onCreateDocument });

    expect(await screen.findByDisplayValue('generated_id')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Document ID'), { target: { value: 'bad/id' } });
    fireEvent.change(screen.getByLabelText('Document JSON'), {
      target: { value: '{"status":"draft"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Document ID cannot contain /.')).toBeTruthy();
    expect(screen.getByLabelText('Document JSON')).toHaveProperty(
      'value',
      '{"status":"draft"}',
    );
    expect(onCreateDocument).not.toHaveBeenCalled();
  });

  it('creates the first document for an editable collection path with a Firestore hint', async () => {
    const onCreateDocument = vi.fn<CreateDocument>();
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CreateDocumentModal
          collectionPath=''
          collectionPathEditable
          hint='Firestore creates a collection when the first document is written.'
          open
          title='New collection'
          onCreateDocument={onCreateDocument}
          onGenerateDocumentId={() => 'generated_id'}
          onOpenChange={() => {}}
        />
      </AppearanceProvider>,
    );

    expect(screen.getByRole('dialog', { name: 'New collection' })).toBeTruthy();
    expect(screen.getByText('Firestore creates a collection when the first document is written.'))
      .toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'Firestore creates a collection when the first document is written.',
    );
    fireEvent.change(screen.getByLabelText('Collection path'), {
      target: { value: ' newOrders ' },
    });
    expect(await screen.findByDisplayValue('generated_id')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Document ID'), { target: { value: 'first' } });
    fireEvent.change(screen.getByLabelText('Document JSON'), {
      target: { value: '{"status":"created"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(onCreateDocument).toHaveBeenCalledWith('newOrders', 'first', {
        status: 'created',
      })
    );
  });

  it('guards dirty new document drafts before closing', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const onOpenChange = vi.fn();
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CreateDocumentModal
          collectionPath='orders'
          open
          onCreateDocument={vi.fn<CreateDocument>()}
          onGenerateDocumentId={() => 'generated_id'}
          onOpenChange={onOpenChange}
        />
      </AppearanceProvider>,
    );

    expect(await screen.findByDisplayValue('generated_id')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Document JSON'), {
      target: { value: '{"status":"draft"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirm).toHaveBeenCalledWith('Discard the new document draft?');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

function renderModal(
  { onCreateDocument }: { readonly onCreateDocument: CreateDocument; },
) {
  render(
    <AppearanceProvider settings={new MockSettingsRepository()}>
      <CreateDocumentModal
        collectionPath='orders'
        open
        onCreateDocument={onCreateDocument}
        onGenerateDocumentId={() => 'generated_id'}
        onOpenChange={() => {}}
      />
    </AppearanceProvider>,
  );
}

type CreateDocument = (
  collectionPath: string,
  documentId: string,
  data: Record<string, unknown>,
) => void | Promise<void>;
