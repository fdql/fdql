import type { Page, PageRequest } from './pagination.ts';
import type { FirestoreFieldStaleBehavior } from './settings.ts';

const FIRESTORE_DOCUMENT_OVERHEAD_BYTES = 32;
const FIRESTORE_DOCUMENT_NAME_OVERHEAD_BYTES = 16;

export interface FirestoreCollectionNode {
  readonly path: string;
  readonly id: string;
  readonly documentCount?: number;
}

export interface FirestoreDocumentNode {
  readonly path: string;
  readonly id: string;
  readonly hasSubcollections: boolean;
}

export type FirestoreFilterOp =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'not-in'
  | 'array-contains'
  | 'array-contains-any';

export interface FirestoreFilter {
  readonly field: string;
  readonly op: FirestoreFilterOp;
  readonly value: unknown;
}

export interface FirestoreSort {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

export interface FirestoreQuery {
  readonly connectionId: string;
  readonly path: string;
  readonly filters?: ReadonlyArray<FirestoreFilter>;
  readonly sorts?: ReadonlyArray<FirestoreSort>;
}

export interface FirestoreQueryDraft {
  readonly filterField: string;
  readonly filterOp: FirestoreFilterOp;
  readonly filterValue: string;
  readonly filters?: ReadonlyArray<FirestoreQueryFilterDraft>;
  readonly limit: number;
  readonly path: string;
  readonly sortDirection: 'asc' | 'desc';
  readonly sortField: string;
}

export interface FirestoreQueryFilterDraft {
  readonly field: string;
  readonly id: string;
  readonly op: FirestoreFilterOp;
  readonly value: string;
}

export type FirestoreQueryDraftEdit =
  | { readonly type: 'path-set'; readonly path: string; }
  | { readonly type: 'limit-set'; readonly limit: number; }
  | { readonly type: 'sort-field-set'; readonly sortField: string; }
  | {
    readonly type: 'sort-direction-set';
    readonly sortDirection: FirestoreQueryDraft['sortDirection'];
  }
  | { readonly type: 'filter-add'; readonly filter: FirestoreQueryFilterDraft; }
  | { readonly type: 'filter-remove'; readonly filterId: string; }
  | {
    readonly type: 'filter-patch';
    readonly filterId: string;
    readonly patch: {
      readonly field?: string;
      readonly op?: FirestoreFilterOp;
      readonly value?: string;
    };
  }
  | { readonly type: 'reset'; };

export interface FirestoreDocumentResult {
  readonly id: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
  readonly hasSubcollections: boolean;
  readonly subcollections?: ReadonlyArray<FirestoreCollectionNode>;
  readonly updateTime?: string;
}

export interface FirestoreDeleteDocumentOptions {
  readonly deleteSubcollectionPaths: ReadonlyArray<string>;
}

export interface FirestoreGeneratedDocumentId {
  readonly documentId: string;
}

export interface FirestoreSaveDocumentOptions {
  readonly lastUpdateTime?: string;
}

export interface FirestoreUpdateDocumentFieldsOptions {
  readonly lastUpdateTime?: string;
  readonly staleBehavior: FirestoreFieldStaleBehavior;
}

export type FirestoreFieldPatchOperation =
  | {
    readonly baseValue: unknown;
    readonly fieldPath: ReadonlyArray<string>;
    readonly type: 'delete';
  }
  | {
    readonly baseValue: unknown;
    readonly fieldPath: ReadonlyArray<string>;
    readonly type: 'set';
    readonly value: unknown;
  };

export type FirestoreSaveDocumentResult =
  | {
    readonly status: 'saved';
    readonly document: FirestoreDocumentResult;
  }
  | {
    readonly status: 'conflict';
    readonly remoteDocument: FirestoreDocumentResult | null;
  };

export type FirestoreUpdateDocumentFieldsResult =
  | {
    readonly document: FirestoreDocumentResult;
    readonly documentChanged?: boolean;
    readonly status: 'saved';
  }
  | {
    readonly remoteDocument: FirestoreDocumentResult | null;
    readonly status: 'document-changed';
  }
  | {
    readonly remoteDocument: FirestoreDocumentResult | null;
    readonly status: 'conflict';
  };

export interface FirestoreRepository {
  listRootCollections(connectionId: string): Promise<ReadonlyArray<FirestoreCollectionNode>>;
  listDocuments(
    connectionId: string,
    collectionPath: string,
    request?: PageRequest,
  ): Promise<Page<FirestoreDocumentNode>>;
  listSubcollections(
    connectionId: string,
    documentPath: string,
  ): Promise<ReadonlyArray<FirestoreCollectionNode>>;
  runQuery(
    query: FirestoreQuery,
    request?: PageRequest,
  ): Promise<Page<FirestoreDocumentResult>>;
  getDocument(connectionId: string, documentPath: string): Promise<FirestoreDocumentResult | null>;
  generateDocumentId(
    connectionId: string,
    collectionPath: string,
  ): Promise<FirestoreGeneratedDocumentId>;
  createDocument(
    connectionId: string,
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>,
  ): Promise<FirestoreDocumentResult>;
  saveDocument(
    connectionId: string,
    documentPath: string,
    data: Record<string, unknown>,
    options?: FirestoreSaveDocumentOptions,
  ): Promise<FirestoreSaveDocumentResult>;
  updateDocumentFields(
    connectionId: string,
    documentPath: string,
    operations: ReadonlyArray<FirestoreFieldPatchOperation>,
    options: FirestoreUpdateDocumentFieldsOptions,
  ): Promise<FirestoreUpdateDocumentFieldsResult>;
  deleteDocument(
    connectionId: string,
    documentPath: string,
    options?: FirestoreDeleteDocumentOptions,
  ): Promise<void>;
}

export function assertFirestoreCollectionPath(path: string): void {
  if (!isFirestoreCollectionPath(path)) {
    throw new Error(`Invalid Firestore collection path: ${path}`);
  }
}

export function assertFirestoreDocumentPath(path: string): void {
  if (!isFirestoreDocumentPath(path)) {
    throw new Error(`Invalid Firestore document path: ${path}`);
  }
}

export function isFirestoreCollectionPath(path: string): boolean {
  const parts = firestorePathParts(path);
  return parts.length > 0 && parts.length % 2 === 1;
}

export function isFirestoreDocumentPath(path: string): boolean {
  const parts = firestorePathParts(path);
  return parts.length > 0 && parts.length % 2 === 0;
}

export function firestorePathParts(path: string): ReadonlyArray<string> {
  const parts = path.split('/');
  return parts.some((part) => part.length === 0) ? [] : parts;
}

export interface FirestoreDocumentSizeEstimateOptions {
  readonly documentPath?: string | undefined;
}

export function estimateFirestoreDocumentBytes(
  data: Record<string, unknown>,
  options: FirestoreDocumentSizeEstimateOptions = {},
): number {
  // Mirrors Firestore storage-size rules; excludes index entry storage and write RPC overhead.
  return estimateFirestoreMapBytes(data)
    + (options.documentPath ? estimateFirestoreDocumentNameBytes(options.documentPath) : 0);
}

function estimateFirestoreDocumentNameBytes(path: string): number {
  return firestorePathParts(path).reduce(
    (total, part) => total + estimateFirestoreStringBytes(part),
    FIRESTORE_DOCUMENT_NAME_OVERHEAD_BYTES,
  );
}

function estimateFirestoreValueBytes(value: unknown): number {
  if (value === undefined) return 0;
  if (value === null) return 1;
  if (typeof value === 'string') return estimateFirestoreStringBytes(value);
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 1;
  if (value instanceof Date) return 8;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + estimateFirestoreValueBytes(item), 0);
  }
  if (isPlainObject(value)) {
    const taggedSize = estimateFirestoreTaggedValueBytes(value);
    return taggedSize ?? estimateFirestoreMapBytes(value);
  }
  return 0;
}

function estimateFirestoreStringBytes(value: string): number {
  return utf8ByteLength(value) + 1;
}

function estimateFirestoreMapBytes(value: Record<string, unknown>): number {
  return FIRESTORE_DOCUMENT_OVERHEAD_BYTES
    + Object.entries(value).reduce(
      (total, [key, item]) => {
        if (item === undefined) return total;
        return total
          + estimateFirestoreStringBytes(key)
          + estimateFirestoreValueBytes(item);
      },
      0,
    );
}

function estimateFirestoreTaggedValueBytes(value: Record<string, unknown>): number | undefined {
  switch (value['__type__']) {
    case 'timestamp':
      return 8;
    case 'geoPoint':
      return 16;
    case 'reference':
      return typeof value['path'] === 'string'
        ? estimateFirestoreDocumentNameBytes(value['path'])
        : 0;
    case 'bytes':
      return typeof value['base64'] === 'string' ? base64ByteLength(value['base64']) : 0;
    case 'array':
      return Array.isArray(value['value']) ? estimateFirestoreValueBytes(value['value']) : 0;
    case 'map':
      return isPlainObject(value['value']) ? estimateFirestoreMapBytes(value['value']) : 0;
    case 'vector':
      return Array.isArray(value['value']) ? value['value'].length * 8 : 0;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) index += 1;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function base64ByteLength(value: string): number {
  const normalized = value.replace(/\s/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
}
