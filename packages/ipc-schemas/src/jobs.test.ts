import { describe, expect, it } from 'vitest';
import {
  BackgroundJobAcknowledgeIssuesRequestSchema,
  BackgroundJobEventSchema,
  BackgroundJobListRequestSchema,
  BackgroundJobSchema,
  FirestoreCollectionJobRequestSchema,
} from './jobs.ts';

describe('job schemas', () => {
  it('accepts valid collection job requests and events', () => {
    const request = FirestoreCollectionJobRequestSchema.parse({
      collisionPolicy: 'skip',
      includeSubcollections: true,
      sourceCollectionPath: 'orders',
      sourceConnectionId: 'source',
      targetCollectionPath: 'orders_copy',
      targetConnectionId: 'target',
      type: 'firestore.copyCollection',
    });

    expect(request.type).toBe('firestore.copyCollection');
    expect(
      BackgroundJobSchema.parse({
        acknowledgedAt: '2026-04-29T00:00:02.000Z',
        createdAt: '2026-04-29T00:00:00.000Z',
        id: 'job-1',
        progress: { deleted: 0, failed: 0, read: 1, skipped: 0, total: 2, written: 1 },
        request,
        status: 'running',
        title: 'Copy collection',
        type: 'firestore.copyCollection',
        updatedAt: '2026-04-29T00:00:00.000Z',
      }),
    ).toMatchObject({ id: 'job-1', status: 'running' });

    expect(
      BackgroundJobEventSchema.parse({
        job: {
          createdAt: '2026-04-29T00:00:00.000Z',
          id: 'job-1',
          progress: { deleted: 0, failed: 0, read: 1, skipped: 0, written: 1 },
          request,
          status: 'succeeded',
          title: 'Copy collection',
          type: 'firestore.copyCollection',
          updatedAt: '2026-04-29T00:00:01.000Z',
        },
        type: 'job-updated',
      }),
    ).toMatchObject({ type: 'job-updated' });
  });

  it('rejects invalid paths, missing subcollection choice, and filters', () => {
    expect(() =>
      FirestoreCollectionJobRequestSchema.parse({
        collisionPolicy: 'skip',
        sourceCollectionPath: 'orders/ord_1',
        sourceConnectionId: 'source',
        targetCollectionPath: 'orders_copy',
        targetConnectionId: 'target',
        type: 'firestore.copyCollection',
      })
    ).toThrow();
    expect(() =>
      FirestoreCollectionJobRequestSchema.parse({
        collectionPath: 'orders',
        connectionId: 'source',
        type: 'firestore.deleteCollection',
      })
    ).toThrow();
    expect(() => BackgroundJobListRequestSchema.parse({ limit: 0 })).toThrow();
    expect(() => BackgroundJobAcknowledgeIssuesRequestSchema.parse({ ids: ['job-1'] }))
      .not.toThrow();
    expect(() => BackgroundJobAcknowledgeIssuesRequestSchema.parse({ ids: [] })).toThrow();
    expect(() => BackgroundJobAcknowledgeIssuesRequestSchema.parse({ ids: [''] })).toThrow();
  });
});
