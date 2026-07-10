// @vitest-environment jsdom

import type {
  FirestoreDocumentResult,
  FirestoreRepository,
  ProjectSummary,
} from '@firebase-desk/repo-contracts';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFirestoreWriteController } from './useFirestoreWriteController.ts';

describe('useFirestoreWriteController', () => {
  it('routes write operations through the active project repository', async () => {
    const firestore = firestoreRepository({
      createDocument: vi.fn().mockResolvedValue(document()),
      deleteDocument: vi.fn().mockResolvedValue(undefined),
      generateDocumentId: vi.fn().mockResolvedValue({ documentId: 'generated-id' }),
      saveDocument: vi.fn().mockResolvedValue({ document: document(), status: 'saved' }),
      updateDocumentFields: vi.fn().mockResolvedValue({ document: document(), status: 'saved' }),
    });
    const { result } = renderHook(() =>
      useFirestoreWriteController({
        activeProject: project,
        activeTab: { id: 'tab_1', kind: 'firestore-query' },
        dataMode: 'live',
        firestore,
        onStatus: vi.fn(),
        recordActivity: vi.fn(),
        refreshAfterLiveWrite: vi.fn(),
      })
    );
    const operations = [{
      baseValue: 'draft',
      fieldPath: ['status'],
      type: 'set' as const,
      value: 'paid',
    }];

    await act(async () => {
      await expect(result.current.generateDocumentId('orders')).resolves.toBe('generated-id');
      await result.current.createDocument('orders', 'ord_created', { status: 'new' });
      await result.current.saveDocument('orders/ord_1', { status: 'paid' });
      await result.current.updateDocumentFields(
        'orders/ord_1',
        operations,
        { staleBehavior: 'save-and-notify' },
      );
      await result.current.deleteDocument('orders/ord_1', {
        deleteSubcollectionPaths: ['orders/ord_1/events'],
      });
    });

    expect(firestore.generateDocumentId).toHaveBeenCalledWith('emu', 'orders');
    expect(firestore.createDocument).toHaveBeenCalledWith('emu', 'orders', 'ord_created', {
      status: 'new',
    });
    expect(firestore.saveDocument).toHaveBeenCalledWith(
      'emu',
      'orders/ord_1',
      { status: 'paid' },
      undefined,
    );
    expect(firestore.updateDocumentFields).toHaveBeenCalledWith(
      'emu',
      'orders/ord_1',
      operations,
      { staleBehavior: 'save-and-notify' },
    );
    expect(firestore.deleteDocument).toHaveBeenCalledWith('emu', 'orders/ord_1', {
      deleteSubcollectionPaths: ['orders/ord_1/events'],
    });
  });

  it('keeps failure statuses visible while rethrowing modal errors', async () => {
    const onStatus = vi.fn();
    const firestore = firestoreRepository({
      saveDocument: vi.fn().mockRejectedValue(new Error('denied')),
      updateDocumentFields: vi.fn().mockRejectedValue(new Error('stale')),
    });
    const { result } = renderHook(() =>
      useFirestoreWriteController({
        activeProject: project,
        activeTab: { id: 'tab_1', kind: 'firestore-query' },
        dataMode: 'mock',
        firestore,
        onStatus,
        recordActivity: vi.fn(),
        refreshAfterLiveWrite: vi.fn(),
      })
    );

    let saveError: unknown;
    await act(async () => {
      try {
        await result.current.saveDocument('orders/ord_1', { status: 'paid' });
      } catch (error) {
        saveError = error;
      }
    });

    let updateError: unknown;
    await act(async () => {
      try {
        await result.current.updateDocumentFields(
          'orders/ord_1',
          [{ baseValue: 'draft', fieldPath: ['status'], type: 'set', value: 'paid' }],
          { staleBehavior: 'save-and-notify' },
        );
      } catch (error) {
        updateError = error;
      }
    });

    expect(saveError).toEqual(expect.any(Error));
    expect(updateError).toEqual(expect.any(Error));
    expect(onStatus).toHaveBeenCalledWith('Save failed: denied');
    expect(onStatus).toHaveBeenCalledWith('Update failed: stale');
  });
});

const project: ProjectSummary = {
  createdAt: '2026-04-27T00:00:00.000Z',
  credentialEncrypted: null,
  emulator: { authHost: '127.0.0.1:9099', firestoreHost: '127.0.0.1:8080' },
  hasCredential: false,
  id: 'emu',
  name: 'Local Emulator',
  projectId: 'demo-local',
  target: 'emulator',
};

function firestoreRepository(
  overrides: Partial<
    Pick<
      FirestoreRepository,
      | 'createDocument'
      | 'deleteDocument'
      | 'generateDocumentId'
      | 'saveDocument'
      | 'updateDocumentFields'
    >
  > = {},
) {
  return {
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    generateDocumentId: vi.fn(),
    saveDocument: vi.fn(),
    updateDocumentFields: vi.fn(),
    ...overrides,
  } satisfies Pick<
    FirestoreRepository,
    | 'createDocument'
    | 'deleteDocument'
    | 'generateDocumentId'
    | 'saveDocument'
    | 'updateDocumentFields'
  >;
}

function document(
  data: Record<string, unknown> = { status: 'paid' },
): FirestoreDocumentResult {
  return {
    data,
    hasSubcollections: false,
    id: 'ord_1',
    path: 'orders/ord_1',
  };
}
