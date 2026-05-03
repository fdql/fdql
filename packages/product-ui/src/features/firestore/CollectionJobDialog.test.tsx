import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionJobDialog } from './CollectionJobDialog.tsx';

const project: ProjectSummary = {
  credentialEncrypted: null,
  createdAt: '2026-04-29T00:00:00.000Z',
  hasCredential: false,
  id: 'emu',
  name: 'Emulator',
  projectId: 'demo-project',
  target: 'emulator',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CollectionJobDialog', () => {
  it('confirms delete once and passes subcollection choice', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const onStartJob = vi.fn();
    renderDialog({ initialKind: 'delete', onStartJob });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include subcollections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start job' }));

    await waitFor(() =>
      expect(onStartJob).toHaveBeenCalledWith({
        collectionPath: 'orders',
        connectionId: 'emu',
        includeSubcollections: true,
        type: 'firestore.deleteCollection',
      })
    );
    expect(confirm).toHaveBeenCalledWith('Delete collection orders including subcollections?');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('confirms overwrite-capable jobs once before queueing', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const onStartJob = vi.fn();
    renderDialog({ initialKind: 'duplicate', onStartJob });

    fireEvent.change(screen.getByRole('combobox', { name: 'Collision policy' }), {
      target: { value: 'overwrite' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start job' }));

    await waitFor(() =>
      expect(onStartJob).toHaveBeenCalledWith(
        expect.objectContaining({
          collisionPolicy: 'overwrite',
          targetCollectionPath: 'orders_copy',
          type: 'firestore.duplicateCollection',
        }),
      )
    );
    expect(confirm).toHaveBeenCalledWith('Overwrite existing target documents?');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('imports encoded JSONL into the edited target collection path', async () => {
    const onStartJob = vi.fn();
    renderDialog({
      initialKind: 'import',
      onPickImportFile: async () => '/tmp/orders.jsonl',
      onStartJob,
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Target collection path' }), {
      target: { value: 'orders_imported' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    await waitFor(() => {
      const input = screen.getByRole('textbox', { name: 'Import file path' }) as HTMLInputElement;
      expect(input.value).toBe('/tmp/orders.jsonl');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start job' }));

    await waitFor(() =>
      expect(onStartJob).toHaveBeenCalledWith({
        collisionPolicy: 'skip',
        connectionId: 'emu',
        filePath: '/tmp/orders.jsonl',
        targetCollectionPath: 'orders_imported',
        type: 'firestore.importCollection',
      })
    );
  });

  it('surfaces native picker failures without changing the path', async () => {
    renderDialog({
      initialKind: 'export',
      onPickExportFile: async () => {
        throw new Error('Save dialog failed');
      },
    });

    const filePath = screen.getByRole('textbox', { name: 'Export file path' }) as HTMLInputElement;
    expect(filePath.readOnly).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    expect(await screen.findByText('Save dialog failed')).toBeTruthy();
    expect(filePath.value).toBe('');
  });

  it('treats picker cancel as no-op', async () => {
    renderDialog({
      initialKind: 'import',
      onPickImportFile: async () => null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    await waitFor(() => {
      const input = screen.getByRole('textbox', { name: 'Import file path' }) as HTMLInputElement;
      expect(input.value).toBe('');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks plain JSONL exports as export-only', () => {
    renderDialog({ initialKind: 'export' });

    fireEvent.change(screen.getByRole('combobox', { name: 'JSONL encoding' }), {
      target: { value: 'plain' },
    });

    expect(screen.getByText(/Plain JSONL is export-only/)).toBeTruthy();
  });
});

function renderDialog(
  props: Partial<ComponentProps<typeof CollectionJobDialog>> = {},
) {
  return render(
    <CollectionJobDialog
      activeProject={project}
      collectionPath='orders'
      open
      projects={[project]}
      onOpenChange={vi.fn()}
      onStartJob={vi.fn()}
      {...props}
    />,
  );
}
