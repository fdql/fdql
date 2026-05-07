import { describe, expect, it } from 'vitest';
import {
  bytesValue,
  compareValues,
  equalValues,
  geoPointValue,
  groupKey,
  mapValue,
  missingValue,
  nullValue,
  outputValue,
  providerValue,
  stringValue,
  timestampValue,
} from './value.ts';

describe('FDQL values', () => {
  it('keeps missing distinct from null in equality and output', () => {
    expect(equalValues(missingValue, nullValue)).toBe(false);
    expect(outputValue(mapValue({ kept: nullValue, skipped: missingValue }))).toEqual({
      kept: null,
    });
  });

  it('encodes non-json core values for external rows', () => {
    expect(outputValue(timestampValue('2026-01-01T00:00:00.000Z'))).toEqual({
      __fdqlType: 'timestamp',
      value: '2026-01-01T00:00:00.000Z',
    });
    expect(outputValue(bytesValue('SGVsbG8='))).toEqual({
      __fdqlType: 'bytes',
      base64: 'SGVsbG8=',
    });
    expect(outputValue(geoPointValue(-37.8136, 144.9631))).toEqual({
      __fdqlType: 'geoPoint',
      latitude: -37.8136,
      longitude: 144.9631,
    });
  });

  it('groups provider values only with equality keys and orders only with order keys', () => {
    const keyed = providerValue({
      equalityKey: 'fs:prod:(default):drivers/d1',
      provider: 'fs',
      value: { path: stringValue('drivers/d1') },
      valueType: 'documentRef',
    });
    const unkeyed = providerValue({
      provider: 'fs',
      value: { path: stringValue('drivers/d1') },
      valueType: 'documentRef',
    });
    const sameKey = providerValue({
      equalityKey: 'fs:prod:(default):drivers/d1',
      provider: 'fs',
      value: { path: stringValue('drivers/d1') },
      valueType: 'documentRef',
    });
    const otherKey = providerValue({
      equalityKey: 'fs:prod:(default):drivers/d2',
      provider: 'fs',
      value: { path: stringValue('drivers/d2') },
      valueType: 'documentRef',
    });

    expect(equalValues(keyed, sameKey)).toBe(true);
    expect(equalValues(keyed, otherKey)).toBe(false);
    expect(() => equalValues(keyed, unkeyed)).toThrow(
      'Provider values cannot be compared without equality keys.',
    );
    expect(groupKey(keyed)).toBe('provider:fs:documentRef:fs:prod:(default):drivers/d1');
    expect(() => groupKey(unkeyed)).toThrow('Provider values cannot be grouped');
    expect(() => compareValues(keyed, keyed)).toThrow('Provider values cannot be ordered');
  });
});
