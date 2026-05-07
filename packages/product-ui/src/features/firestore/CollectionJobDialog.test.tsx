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
  it('uses in-app confirmation for delete jobs', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const onStartJob = vi.fn();
    renderDialog({ initialKind: 'delete', onStartJob });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include subcollections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start job' }));

    expect(screen.getByText('Delete collection orders including subcollections?')).toBeTruthy();
    expect(onStartJob).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete collection' }));

    await waitFor(() =>
      expect(onStartJob).toHaveBeenCalledWith({
        collectionPath: 'orders',
        connectionId: 'emu',
        includeSubcollections: true,
        type: 'firestore.deleteCollection',
      })
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('uses in-app confirmation for overwrite-capable jobs', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const onStartJob = vi.fn();
    renderDialog({ initialKind: 'duplicate', onStartJob });

    fireEvent.change(screen.getByRole('combobox', { name: 'Collision policy' }), {
      target: { value: 'overwrite' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start job' }));

    expect(screen.getByText('Overwrite existing target documents?')).toBeTruthy();
    expect(onStartJob).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite and start' }));

    await waitFor(() =>
      expect(onStartJob).toHaveBeenCalledWith(
        expect.objectContaining({
          collisionPolicy: 'overwrite',
          targetCollectionPath: 'orders_copy',
          type: 'firestore.duplicateCollection',
        }),
      )
    );
    expect(confirm).not.toHaveBeenCalled();
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

  it('clears stale export picker errors when a later picker is canceled', async () => {
    const onPickExportFile = vi
      .fn<NonNullable<ComponentProps<typeof CollectionJobDialog>['onPickExportFile']>>()
      .mockRejectedValueOnce(new Error('Save dialog failed'))
      .mockResolvedValueOnce(null);
    renderDialog({ initialKind: 'export', onPickExportFile });

    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(await screen.findByText('Save dialog failed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('clears stale import picker errors when a later picker is canceled', async () => {
    const onPickImportFile = vi
      .fn<NonNullable<ComponentProps<typeof CollectionJobDialog>['onPickImportFile']>>()
      .mockRejectedValueOnce(new Error('Open dialog failed'))
      .mockResolvedValueOnce(null);
    renderDialog({ initialKind: 'import', onPickImportFile });

    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(await screen.findByText('Open dialog failed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
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
