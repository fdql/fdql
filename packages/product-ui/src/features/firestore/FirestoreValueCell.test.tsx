import {
  FirestoreBytes,
  FirestoreGeoPoint,
  FirestoreReference,
  FirestoreTimestamp,
} from '@firebase-desk/data-format';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  FirestoreValueCell,
  firestoreValueType,
  formatFirestoreValue,
  isFirestoreTypedValue,
} from './FirestoreValueCell.tsx';

const isoTimestamp = '2026-04-24T09:30:12.058Z';

describe('FirestoreValueCell', () => {
  it('renders encoded timestamps as compact local ISO offset values', () => {
    const expected = expectedLocalTimestamp(isoTimestamp);
    const { rerender } = render(
      <FirestoreValueCell value={{ __type__: 'timestamp', value: isoTimestamp }} />,
    );

    expect(expected).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(screen.queryByText('time')).toBeNull();
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.getByTitle(isoTimestamp)).toBeTruthy();

    rerender(<FirestoreValueCell value={new FirestoreTimestamp(isoTimestamp)} />);

    expect(screen.queryByText('time')).toBeNull();
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.getByTitle(isoTimestamp)).toBeTruthy();
  });

  it('formats FDQL typed timestamp values without a badge', () => {
    const expected = expectedLocalTimestamp(isoTimestamp);
    render(<FirestoreValueCell value={{ __fdqlType: 'timestamp', value: isoTimestamp }} />);

    expect(screen.queryByText('time')).toBeNull();
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.getByTitle(isoTimestamp)).toBeTruthy();
  });

  it('treats native Firestore values as typed scalar values', () => {
    const timestamp = new FirestoreTimestamp(isoTimestamp);
    const geoPoint = new FirestoreGeoPoint(-36.8485123, 174.7633444);
    const reference = new FirestoreReference('customers/cus_ada');
    const bytes = new FirestoreBytes('AQID');

    expect(isFirestoreTypedValue(timestamp)).toBe(true);
    expect(firestoreValueType(timestamp)).toBe('timestamp');
    expect(formatFirestoreValue(timestamp)).toBe(expectedLocalTimestamp(isoTimestamp));
    expect(formatFirestoreValue(geoPoint)).toBe('-36.848512, 174.763344');
    expect(formatFirestoreValue(reference)).toBe('customers/cus_ada');
    expect(formatFirestoreValue(bytes)).toBe('3 bytes');
  });

  it('summarizes encoded Firestore map and array sentinels without expanding them', () => {
    expect(isFirestoreTypedValue({ __type__: 'map', value: { a: 1, b: true } })).toBe(true);
    expect(formatFirestoreValue({ __type__: 'array', value: [1, 2, 3] })).toBe('[1,2,3]');
    expect(formatFirestoreValue({ __type__: 'map', value: { a: 1, b: true } })).toBe(
      '{"a":1,"b":true}',
    );
    expect(firestoreValueType({ __type__: 'reference', path: 'customers/cus_ada' })).toBe(
      'reference',
    );
  });

  it('renders plain objects with compact content previews', () => {
    render(<FirestoreValueCell value={{ nested: true }} />);

    expect(screen.getByText('{"nested":true}')).toBeTruthy();
    expect(screen.getByTitle('{"nested":true}')).toBeTruthy();
  });

  it('renders truncated values with size and reload hint', () => {
    render(
      <FirestoreValueCell
        value={{ __type__: 'truncated', sizeBytes: 1024 * 512, valueType: 'array' }}
      />,
    );

    expect(screen.getByText('trunc')).toBeTruthy();
    expect(screen.getByText(/array/)).toBeTruthy();
    expect(screen.getByText(/512 KB/)).toBeTruthy();
    expect(screen.getByTitle(/Reload the document to view it\./)).toBeTruthy();
  });

  it('caps primitive field values at 255 characters', () => {
    const value = 'x'.repeat(300);

    expect(formatFirestoreValue(value)).toHaveLength(255);
    expect(formatFirestoreValue(value).endsWith('...')).toBe(true);
  });

  it('caps preview length for very large values without scanning the whole structure', () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 50000; i += 1) huge[`field_${i}`] = `value_${i}`;
    const start = performance.now();
    const preview = formatFirestoreValue(huge);
    const elapsed = performance.now() - start;

    expect(preview.length).toBeLessThanOrEqual(255);
    expect(preview.endsWith('...')).toBe(true);
    // Should be much faster than fully stringifying the 50k-key object.
    // Generous bound to avoid flakiness on busy CI machines.
    expect(elapsed).toBeLessThan(500);
  });
});

function expectedLocalTimestamp(iso: string): string {
  const date = new Date(iso);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    + `${sign}${pad2(Math.floor(absoluteMinutes / 60))}:${pad2(absoluteMinutes % 60)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
