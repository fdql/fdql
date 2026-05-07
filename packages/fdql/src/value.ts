import type { FdqlLiteralValue } from './types.ts';

export type FdqlValue =
  | FdqlArrayValue
  | FdqlBooleanValue
  | FdqlBytesValue
  | FdqlGeoPointValue
  | FdqlMapValue
  | FdqlMissingValue
  | FdqlNullValue
  | FdqlNumberValue
  | FdqlProviderValue
  | FdqlStringValue
  | FdqlTimestampValue;

export interface FdqlMissingValue {
  readonly kind: 'missing';
}

export interface FdqlNullValue {
  readonly kind: 'null';
}

export interface FdqlBooleanValue {
  readonly kind: 'boolean';
  readonly value: boolean;
}

export interface FdqlNumberValue {
  readonly kind: 'number';
  readonly value: number;
}

export interface FdqlStringValue {
  readonly kind: 'string';
  readonly value: string;
}

export interface FdqlArrayValue {
  readonly kind: 'array';
  readonly value: readonly FdqlValue[];
}

export interface FdqlMapValue {
  readonly kind: 'map';
  readonly value: Readonly<Record<string, FdqlValue>>;
}

export interface FdqlTimestampValue {
  readonly iso: string;
  readonly kind: 'timestamp';
}

export interface FdqlBytesValue {
  readonly base64: string;
  readonly kind: 'bytes';
}

export interface FdqlGeoPointValue {
  readonly kind: 'geoPoint';
  readonly latitude: number;
  readonly longitude: number;
}

export interface FdqlProviderValue {
  readonly display?: string | undefined;
  readonly equalityKey?: string | undefined;
  readonly kind: 'providerValue';
  readonly orderKey?: string | undefined;
  readonly provider: string;
  readonly value: Readonly<Record<string, FdqlValue>>;
  readonly valueType: string;
}

export const missingValue: FdqlMissingValue = Object.freeze({ kind: 'missing' });
export const nullValue: FdqlNullValue = Object.freeze({ kind: 'null' });

export function booleanValue(value: boolean): FdqlBooleanValue {
  return { kind: 'boolean', value };
}

export function numberValue(value: number): FdqlNumberValue {
  return { kind: 'number', value };
}

export function stringValue(value: string): FdqlStringValue {
  return { kind: 'string', value };
}

export function arrayValue(value: readonly FdqlValue[]): FdqlArrayValue {
  return { kind: 'array', value };
}

export function mapValue(value: Readonly<Record<string, FdqlValue>>): FdqlMapValue {
  return { kind: 'map', value };
}

export function timestampValue(iso: string): FdqlTimestampValue {
  return { iso, kind: 'timestamp' };
}

export function bytesValue(base64: string): FdqlBytesValue {
  return { base64, kind: 'bytes' };
}

export function geoPointValue(latitude: number, longitude: number): FdqlGeoPointValue {
  return { kind: 'geoPoint', latitude, longitude };
}

export function providerValue(input: {
  readonly display?: string | undefined;
  readonly equalityKey?: string | undefined;
  readonly orderKey?: string | undefined;
  readonly provider: string;
  readonly value: Readonly<Record<string, FdqlValue>>;
  readonly valueType: string;
}): FdqlProviderValue {
  return {
    ...(input.display === undefined ? {} : { display: input.display }),
    ...(input.equalityKey === undefined ? {} : { equalityKey: input.equalityKey }),
    kind: 'providerValue',
    ...(input.orderKey === undefined ? {} : { orderKey: input.orderKey }),
    provider: input.provider,
    value: input.value,
    valueType: input.valueType,
  };
}

export function literalToValue(value: FdqlLiteralValue): FdqlValue {
  if (value === null) return nullValue;
  if (typeof value === 'boolean') return booleanValue(value);
  if (typeof value === 'number') return numberValue(value);
  return stringValue(value);
}

export function toFdqlValue(value: unknown): FdqlValue {
  if (isFdqlValue(value)) return value;
  if (value === null || value === undefined) return value === null ? nullValue : missingValue;
  if (typeof value === 'boolean') return booleanValue(value);
  if (typeof value === 'number') return numberValue(value);
  if (typeof value === 'string') return stringValue(value);
  if (Array.isArray(value)) return arrayValue(value.map(toFdqlValue));
  if (isPlainObject(value)) {
    return mapValue(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toFdqlValue(entry)])),
    );
  }
  return stringValue(String(value));
}

export function isFdqlValue(value: unknown): value is FdqlValue {
  return isPlainObject(value)
    && typeof value['kind'] === 'string'
    && fdqlValueKinds.has(value['kind']);
}

export function isMissingValue(value: unknown): value is FdqlMissingValue {
  return isFdqlValue(value) && value.kind === 'missing';
}

export function isNullValue(value: unknown): value is FdqlNullValue {
  return isFdqlValue(value) && value.kind === 'null';
}

export function truthyValue(value: FdqlValue): boolean {
  if (value.kind === 'missing' || value.kind === 'null') return false;
  if (value.kind === 'boolean') return value.value;
  if (value.kind === 'number') return value.value !== 0 && Number.isFinite(value.value);
  if (value.kind === 'string') return value.value.length > 0;
  return true;
}

export function scalarValue(value: FdqlValue): boolean | null | number | string | undefined {
  if (value.kind === 'missing') return undefined;
  if (value.kind === 'null') return null;
  if (value.kind === 'boolean' || value.kind === 'number' || value.kind === 'string') {
    return value.value;
  }
  return undefined;
}

export function stringScalar(value: FdqlValue): string | undefined {
  return value.kind === 'string' ? value.value : undefined;
}

export function numberScalar(value: FdqlValue): number | undefined {
  return value.kind === 'number' ? value.value : undefined;
}

export function equalValues(left: FdqlValue, right: FdqlValue): boolean {
  if (left.kind === 'providerValue' || right.kind === 'providerValue') {
    if (!providerHasEqualityKey(left) || !providerHasEqualityKey(right)) {
      throw new Error('Provider values cannot be compared without equality keys.');
    }
    if (left.kind !== 'providerValue' || right.kind !== 'providerValue') return false;
    return left.provider === right.provider
      && left.valueType === right.valueType
      && left.equalityKey === right.equalityKey;
  }
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'missing':
    case 'null':
      return true;
    case 'boolean':
    case 'number':
    case 'string':
      return Object.is(left.value, (right as typeof left).value);
    case 'timestamp':
      return left.iso === (right as typeof left).iso;
    case 'bytes':
      return left.base64 === (right as typeof left).base64;
    case 'geoPoint': {
      const other = right as FdqlGeoPointValue;
      return left.latitude === other.latitude && left.longitude === other.longitude;
    }
    case 'array': {
      const other = right as FdqlArrayValue;
      return left.value.length === other.value.length
        && left.value.every((item, index) => equalValues(item, other.value[index]!));
    }
    case 'map': {
      const other = right as FdqlMapValue;
      const keys = Object.keys(left.value);
      return keys.length === Object.keys(other.value).length
        && keys.every((key) =>
          key in other.value && equalValues(left.value[key]!, other.value[key]!)
        );
    }
  }
}

export function compareValues(left: FdqlValue, right: FdqlValue): number {
  if (left.kind === 'providerValue' || right.kind === 'providerValue') {
    if (
      left.kind === 'providerValue' && right.kind === 'providerValue'
      && left.provider === right.provider
      && left.valueType === right.valueType
      && left.orderKey
      && right.orderKey
    ) {
      return left.orderKey.localeCompare(right.orderKey);
    }
    throw new Error('Provider values cannot be ordered without provider order keys.');
  }
  const leftKey = orderKey(left);
  const rightKey = orderKey(right);
  if (typeof leftKey === 'number' && typeof rightKey === 'number') return leftKey - rightKey;
  return String(leftKey).localeCompare(String(rightKey));
}

export function groupKey(value: FdqlValue): string {
  switch (value.kind) {
    case 'missing':
      return 'missing';
    case 'null':
      return 'null';
    case 'boolean':
    case 'number':
    case 'string':
      return `${value.kind}:${String(value.value)}`;
    case 'timestamp':
      return `timestamp:${value.iso}`;
    case 'bytes':
      return `bytes:${value.base64}`;
    case 'geoPoint':
      return `geoPoint:${value.latitude},${value.longitude}`;
    case 'providerValue':
      if (!value.equalityKey) {
        throw new Error('Provider values cannot be grouped without equality keys.');
      }
      return `provider:${value.provider}:${value.valueType}:${value.equalityKey}`;
    case 'array':
    case 'map':
      throw new Error('Arrays and maps cannot be aggregate group keys.');
  }
}

export function numericValue(value: FdqlValue): number {
  return value.kind === 'number' && Number.isFinite(value.value) ? value.value : 0;
}

export function outputValue(value: FdqlValue): unknown {
  switch (value.kind) {
    case 'missing':
      return undefined;
    case 'null':
      return null;
    case 'boolean':
    case 'number':
    case 'string':
      return value.value;
    case 'array':
      return value.value.map((item) => {
        const output = outputValue(item);
        return output === undefined ? null : output;
      });
    case 'map':
      return Object.fromEntries(
        Object.entries(value.value).flatMap(([key, entry]) => {
          const output = outputValue(entry);
          return output === undefined ? [] : [[key, output]];
        }),
      );
    case 'timestamp':
      return { __fdqlType: 'timestamp', value: value.iso };
    case 'bytes':
      return { __fdqlType: 'bytes', base64: value.base64 };
    case 'geoPoint':
      return {
        __fdqlType: 'geoPoint',
        latitude: value.latitude,
        longitude: value.longitude,
      };
    case 'providerValue':
      return {
        __fdqlType: 'providerValue',
        ...(value.display === undefined ? {} : { display: value.display }),
        provider: value.provider,
        value: outputValue(mapValue(value.value)),
        valueType: value.valueType,
      };
  }
}

function orderKey(value: FdqlValue): boolean | number | string {
  switch (value.kind) {
    case 'missing':
      return '';
    case 'null':
      return 'null';
    case 'boolean':
    case 'number':
    case 'string':
      return value.value;
    case 'timestamp':
      return value.iso;
    case 'bytes':
      return value.base64;
    case 'geoPoint':
      return `${value.latitude},${value.longitude}`;
    case 'array':
    case 'map':
      throw new Error('Arrays and maps cannot be ordered.');
    case 'providerValue':
      return value.orderKey ?? '';
  }
}

function providerHasEqualityKey(value: FdqlValue): boolean {
  return value.kind !== 'providerValue' || Boolean(value.equalityKey);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const fdqlValueKinds = new Set([
  'array',
  'boolean',
  'bytes',
  'geoPoint',
  'map',
  'missing',
  'null',
  'number',
  'providerValue',
  'string',
  'timestamp',
]);
