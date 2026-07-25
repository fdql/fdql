import {
  FirestoreBytes,
  FirestoreGeoPoint,
  FirestoreReference,
  FirestoreTimestamp,
} from '@firebase-desk/data-format';
import type { FirestorePrimitiveFieldType } from '@firebase-desk/repo-contracts';

export type FirestoreEditableType =
  | 'array'
  | 'boolean'
  | 'bytes'
  | 'geoPoint'
  | 'map'
  | 'null'
  | 'number'
  | 'reference'
  | 'string'
  | 'timestamp';

export type FirestoreKnownEncodedType =
  | 'array'
  | 'bytes'
  | 'geoPoint'
  | 'map'
  | 'reference'
  | 'timestamp';

export type FirestoreTypeIcon =
  | 'array'
  | 'boolean'
  | 'bytes'
  | 'geoPoint'
  | 'map'
  | 'null'
  | 'number'
  | 'reference'
  | 'string'
  | 'timestamp';

interface FirestoreTypeInfo {
  readonly editLabel: string;
  readonly icon: FirestoreTypeIcon;
  readonly jsonMode: boolean;
  readonly primitiveCatalogType?: FirestorePrimitiveFieldType;
}

export const FIRESTORE_TYPE_REGISTRY: Readonly<Record<FirestoreEditableType, FirestoreTypeInfo>> = {
  array: { editLabel: 'array', icon: 'array', jsonMode: true },
  boolean: {
    editLabel: 'boolean',
    icon: 'boolean',
    jsonMode: false,
    primitiveCatalogType: 'boolean',
  },
  bytes: { editLabel: 'bytes', icon: 'bytes', jsonMode: false, primitiveCatalogType: 'bytes' },
  geoPoint: {
    editLabel: 'geoPoint',
    icon: 'geoPoint',
    jsonMode: false,
    primitiveCatalogType: 'geoPoint',
  },
  map: { editLabel: 'map', icon: 'map', jsonMode: true },
  null: { editLabel: 'null', icon: 'null', jsonMode: false, primitiveCatalogType: 'null' },
  number: { editLabel: 'number', icon: 'number', jsonMode: false, primitiveCatalogType: 'number' },
  reference: {
    editLabel: 'reference',
    icon: 'reference',
    jsonMode: false,
    primitiveCatalogType: 'reference',
  },
  string: { editLabel: 'string', icon: 'string', jsonMode: false, primitiveCatalogType: 'string' },
  timestamp: {
    editLabel: 'timestamp',
    icon: 'timestamp',
    jsonMode: false,
    primitiveCatalogType: 'timestamp',
  },
};

export const FIRESTORE_EDITABLE_TYPES: ReadonlyArray<FirestoreEditableType> = [
  'string',
  'number',
  'boolean',
  'null',
  'array',
  'map',
  'timestamp',
  'reference',
  'bytes',
  'geoPoint',
];

export function firestoreValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const nativeType = nativeFirestoreValueType(value);
  if (nativeType) return nativeType;
  const encodedType = encodedFirestoreType(value);
  if (encodedType) return encodedType;
  const fdqlType = encodedFdqlType(value);
  if (fdqlType) return fdqlType;
  return typeof value;
}

export function editableTypeForValue(value: unknown): FirestoreEditableType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const nativeType = nativeFirestoreValueType(value);
  if (nativeType) return nativeType;
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (isPlainObject(value)) {
    const encodedType = encodedFirestoreType(value);
    if (isKnownEncodedFirestoreType(encodedType)) return encodedType;
    return 'map';
  }
  return 'string';
}

export function labelForEditableType(type: FirestoreEditableType): string {
  return FIRESTORE_TYPE_REGISTRY[type].editLabel;
}

export function isJsonEditableType(type: FirestoreEditableType): boolean {
  return FIRESTORE_TYPE_REGISTRY[type].jsonMode;
}

export function iconForFirestoreFieldType(type: string): FirestoreTypeIcon {
  const normalized = type.startsWith('array<') ? 'array' : type;
  return isEditableType(normalized) ? FIRESTORE_TYPE_REGISTRY[normalized].icon : 'string';
}

export function primitiveCatalogTypeForValue(value: unknown): FirestorePrimitiveFieldType | null {
  if (value === null) return 'null';
  const nativeType = nativeFirestoreValueType(value);
  if (nativeType) return FIRESTORE_TYPE_REGISTRY[nativeType].primitiveCatalogType ?? null;
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  const encodedType = encodedFirestoreType(value);
  return isKnownEncodedFirestoreType(encodedType)
    ? FIRESTORE_TYPE_REGISTRY[encodedType].primitiveCatalogType ?? null
    : null;
}

export function nativeFirestoreValueType(value: unknown): FirestoreEditableType | null {
  if (value instanceof FirestoreTimestamp) return 'timestamp';
  if (value instanceof FirestoreGeoPoint) return 'geoPoint';
  if (value instanceof FirestoreReference) return 'reference';
  if (value instanceof FirestoreBytes) return 'bytes';
  return null;
}

export function encodedFirestoreType(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  return typeof value['__type__'] === 'string' ? value['__type__'] : null;
}

export function encodedFdqlType(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  return typeof value['__fdqlType'] === 'string' ? value['__fdqlType'] : null;
}

export function isKnownEncodedFirestoreType(value: unknown): value is FirestoreKnownEncodedType {
  return value === 'timestamp' || value === 'geoPoint' || value === 'reference'
    || value === 'bytes' || value === 'array' || value === 'map';
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEditableType(value: string): value is FirestoreEditableType {
  return value in FIRESTORE_TYPE_REGISTRY;
}
