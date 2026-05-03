import { describe, expect, it } from 'vitest';
import {
  assertFirestoreCollectionPath,
  assertFirestoreDocumentPath,
  estimateFirestoreDocumentBytes,
  firestorePathParts,
  isFirestoreCollectionPath,
  isFirestoreDocumentPath,
} from './firestore.ts';

const DOCUMENT_OVERHEAD_BYTES = 32;
const VALUE_FIELD_NAME_BYTES = 6;

function estimateSingleFieldDocumentBytes(value: unknown): number {
  return estimateFirestoreDocumentBytes({ value });
}

describe('Firestore path helpers', () => {
  it('classifies collection and document paths without filtering empty segments', () => {
    expect(isFirestoreCollectionPath('orders')).toBe(true);
    expect(isFirestoreCollectionPath('orders/ord_1/events')).toBe(true);
    expect(isFirestoreCollectionPath('orders/ord_1')).toBe(false);
    expect(isFirestoreCollectionPath('/orders')).toBe(false);
    expect(isFirestoreDocumentPath('orders/ord_1')).toBe(true);
    expect(isFirestoreDocumentPath('orders')).toBe(false);
    expect(isFirestoreDocumentPath('orders/')).toBe(false);
    expect(firestorePathParts('orders//events')).toEqual([]);
  });

  it('throws clear errors for invalid paths', () => {
    expect(() => assertFirestoreCollectionPath('orders/ord_1')).toThrow(
      'Invalid Firestore collection path: orders/ord_1',
    );
    expect(() => assertFirestoreDocumentPath('orders')).toThrow(
      'Invalid Firestore document path: orders',
    );
  });
});

describe('Firestore document size estimates', () => {
  it('counts string field values as UTF-8 bytes plus one byte', () => {
    expect(estimateSingleFieldDocumentBytes('tasks')).toBe(
      DOCUMENT_OVERHEAD_BYTES + VALUE_FIELD_NAME_BYTES + 6,
    );
    expect(estimateSingleFieldDocumentBytes('λ')).toBe(
      DOCUMENT_OVERHEAD_BYTES + VALUE_FIELD_NAME_BYTES + 3,
    );
    expect(estimateSingleFieldDocumentBytes('🔥')).toBe(
      DOCUMENT_OVERHEAD_BYTES + VALUE_FIELD_NAME_BYTES + 5,
    );
  });

  it('adds document name size when a path is provided', () => {
    expect(estimateFirestoreDocumentBytes(
      {},
      { documentPath: 'users/jeff/tasks/my_task_id' },
    )).toBe(DOCUMENT_OVERHEAD_BYTES + 44);
  });

  it('uses documented scalar value sizes', () => {
    const base = DOCUMENT_OVERHEAD_BYTES + VALUE_FIELD_NAME_BYTES;
    expect(estimateSingleFieldDocumentBytes(null)).toBe(base + 1);
    expect(estimateSingleFieldDocumentBytes(true)).toBe(base + 1);
    expect(estimateSingleFieldDocumentBytes(false)).toBe(base + 1);
    expect(estimateSingleFieldDocumentBytes(7)).toBe(base + 8);
    expect(estimateSingleFieldDocumentBytes(7.5)).toBe(base + 8);
    expect(estimateSingleFieldDocumentBytes('Personal')).toBe(base + 9);
  });

  it('omits undefined fields because Firestore has no undefined value type', () => {
    expect(estimateSingleFieldDocumentBytes(undefined)).toBe(DOCUMENT_OVERHEAD_BYTES);
    expect(estimateFirestoreDocumentBytes({ kept: false, omitted: undefined })).toBe(
      DOCUMENT_OVERHEAD_BYTES + 5 + 1,
    );
  });

  it('uses documented timestamp and date-time value sizes', () => {
    const base = DOCUMENT_OVERHEAD_BYTES + VALUE_FIELD_NAME_BYTES;
    expect(estimateSingleFieldDocumentBytes({
      __type__: 'timestamp',
      value: '2026-01-01T00:00:00Z',
    })).toBe(base + 8);
    expect(estimateSingleFieldDocumentBytes(new Date('2026-01-01T00:00:00Z'))).toBe(base + 8);
  });

  it('uses documented geo point, reference, bytes, and vector value sizes', () => {
    const base = DOCUMENT_OVERHEAD_BYTES + VALUE_FIELD_NAME_BYTES;
    expect(estimateSingleFieldDocumentBytes({ __type__: 'geoPoint', latitude: 1, longitude: 2 }))
      .toBe(base + 16);
    expect(estimateSingleFieldDocumentBytes({
      __type__: 'reference',
      path: 'users/jeff/tasks/my_task_id',
    })).toBe(base + 44);
    expect(estimateSingleFieldDocumentBytes({ __type__: 'bytes', base64: 'AQIDBA==' })).toBe(
      base + 4,
    );
    expect(estimateSingleFieldDocumentBytes({ __type__: 'vector', value: [0, 1, 2] })).toBe(
      base + 24,
    );
  });

  it('sums array values without extra array overhead', () => {
    const base = DOCUMENT_OVERHEAD_BYTES + VALUE_FIELD_NAME_BYTES;
    expect(estimateSingleFieldDocumentBytes([true, null, 'λ', 7])).toBe(base + 13);
    expect(estimateSingleFieldDocumentBytes({ __type__: 'array', value: [false, 'ok'] })).toBe(
      base + 4,
    );
  });

  it('adds 32 bytes plus field names and values for maps', () => {
    const base = DOCUMENT_OVERHEAD_BYTES + VALUE_FIELD_NAME_BYTES;
    expect(estimateSingleFieldDocumentBytes({ done: false })).toBe(base + 38);
    expect(estimateSingleFieldDocumentBytes({ __type__: 'map', value: { done: false } })).toBe(
      base + 38,
    );
  });

  it('matches the documented document-size example', () => {
    expect(estimateFirestoreDocumentBytes(
      {
        description: 'Learn Cloud Firestore',
        done: false,
        priority: 1,
        type: 'Personal',
      },
      { documentPath: 'users/jeff/tasks/my_task_id' },
    )).toBe(147);
  });
});
