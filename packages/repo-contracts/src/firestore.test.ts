import { describe, expect, it } from 'vitest';
import {
  assertFirestoreCollectionPath,
  assertFirestoreDocumentPath,
  estimateFirestoreDocumentBytes,
  firestorePathParts,
  isFirestoreCollectionPath,
  isFirestoreDocumentPath,
} from './firestore.ts';

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
  it('estimates nested document bytes without runtime-specific APIs', () => {
    expect(estimateFirestoreDocumentBytes({
      active: true,
      name: 'Ada',
      tags: ['x', 'λ'],
    })).toBe(191);
  });

  it('accounts for multibyte strings and nested object keys', () => {
    expect(estimateFirestoreDocumentBytes({
      meta: {
        emoji: '🔥',
        score: 12,
      },
    })).toBe(196);
  });
});
