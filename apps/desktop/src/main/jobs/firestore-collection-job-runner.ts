import {
  assertFirestoreCollectionPath,
  assertFirestoreDocumentPath,
  firestorePathParts,
} from '@firebase-desk/repo-contracts';
import type {
  BackgroundJob,
  BackgroundJobProgress,
  BackgroundJobResult,
  FirestoreCollectionJobRequest,
  FirestoreJobCollisionPolicy,
} from '@firebase-desk/repo-contracts/jobs';
import { encodeAdminData } from '@firebase-desk/repo-firebase';
import type { AdminFirestoreProvider } from '@firebase-desk/repo-firebase';
import { decodeAdminData } from '@firebase-desk/repo-firebase';
import {
  type DocumentData,
  FieldPath,
  type Firestore,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from 'firebase-admin/firestore';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const PAGE_SIZE = 250;
const DEFAULT_WRITE_BATCH_MAX_BYTES = 8 * 1024 * 1024;
const WRITE_BATCH_LIMIT = 500;
const WRITE_OPERATION_OVERHEAD_BYTES = 512;

type MutableProgress = {
  -readonly [K in keyof BackgroundJobProgress]: BackgroundJobProgress[K];
};

export interface FirestoreCollectionJobRunnerOptions {
  readonly tempDirectory: string;
  readonly writeBatchMaxBytes?: number | undefined;
}

export interface JobCancellationSignal {
  isCancelled(): boolean;
}

export interface JobProgressSink {
  update(progress: BackgroundJobProgress): Promise<void>;
}

export class JobCancelledError extends Error {
  constructor() {
    super('Job cancelled.');
    this.name = 'JobCancelledError';
  }
}

export class FirestoreCollectionJobRunner {
  constructor(
    private readonly provider: AdminFirestoreProvider,
    private readonly options: FirestoreCollectionJobRunnerOptions,
  ) {}

  async run(
    job: BackgroundJob,
    signal: JobCancellationSignal,
    sink: JobProgressSink,
  ): Promise<BackgroundJobResult | undefined> {
    switch (job.request.type) {
      case 'firestore.copyCollection':
        await this.copyCollection(job.request, signal, sink);
        return undefined;
      case 'firestore.duplicateCollection':
        await this.copyCollection(
          {
            collisionPolicy: job.request.collisionPolicy,
            includeSubcollections: job.request.includeSubcollections,
            sourceCollectionPath: job.request.collectionPath,
            sourceConnectionId: job.request.connectionId,
            targetCollectionPath: job.request.targetCollectionPath,
            targetConnectionId: job.request.connectionId,
            type: 'firestore.copyCollection',
          },
          signal,
          sink,
        );
        return undefined;
      case 'firestore.deleteCollection':
        await this.deleteCollection(job.request, signal, sink);
        return undefined;
      case 'firestore.exportCollection':
        await this.exportCollection(job.request, signal, sink);
        return { filePath: job.request.filePath };
      case 'firestore.importCollection':
        await this.importCollection(job.request, signal, sink);
        return undefined;
    }
  }

  private async copyCollection(
    request: Extract<FirestoreCollectionJobRequest, { readonly type: 'firestore.copyCollection'; }>,
    signal: JobCancellationSignal,
    sink: JobProgressSink,
  ): Promise<void> {
    assertFirestoreCollectionPath(request.sourceCollectionPath);
    assertFirestoreCollectionPath(request.targetCollectionPath);
    const sourceDb = await this.firestore(request.sourceConnectionId);
    const targetDb = await this.firestore(request.targetConnectionId);
    const batcher = new BatchWriter(targetDb, this.writeBatchMaxBytes());
    const progress = progressCounter();
    let chunk: QueryDocumentSnapshot[] = [];

    for await (
      const doc of streamCollectionDocuments(
        sourceDb,
        request.sourceCollectionPath,
        request.includeSubcollections,
        signal,
      )
    ) {
      assertNotCancelled(signal);
      chunk.push(doc);
      if (chunk.length < WRITE_BATCH_LIMIT) continue;
      await this.copyDocumentChunk(
        chunk,
        request,
        targetDb,
        batcher,
        progress,
        signal,
        sink,
      );
      chunk = [];
    }
    await this.copyDocumentChunk(
      chunk,
      request,
      targetDb,
      batcher,
      progress,
      signal,
      sink,
    );
    assertNotCancelled(signal);
    await batcher.commit();
    await sink.update({ ...progress, currentPath: undefined });
  }

  private async deleteCollection(
    request: Extract<
      FirestoreCollectionJobRequest,
      { readonly type: 'firestore.deleteCollection'; }
    >,
    signal: JobCancellationSignal,
    sink: JobProgressSink,
  ): Promise<void> {
    assertFirestoreCollectionPath(request.collectionPath);
    const db = await this.firestore(request.connectionId);
    const batcher = new BatchWriter(db, this.writeBatchMaxBytes());
    const progress = progressCounter();
    for await (
      const doc of streamCollectionDocumentsForDelete(
        db,
        request.collectionPath,
        request.includeSubcollections,
        signal,
      )
    ) {
      assertNotCancelled(signal);
      progress.read += 1;
      progress.currentPath = doc.ref.path;
      await batcher.delete(doc.ref.path, signal);
      progress.deleted += 1;
      await sink.update(progress);
    }
    assertNotCancelled(signal);
    await batcher.commit();
    await sink.update({ ...progress, currentPath: undefined });
  }

  private async exportCollection(
    request: Extract<
      FirestoreCollectionJobRequest,
      { readonly type: 'firestore.exportCollection'; }
    >,
    signal: JobCancellationSignal,
    sink: JobProgressSink,
  ): Promise<void> {
    assertFirestoreCollectionPath(request.collectionPath);
    await mkdir(dirname(request.filePath), { recursive: true });
    if (request.format === 'csv') {
      await this.exportCsv(request, signal, sink);
      return;
    }
    const db = await this.firestore(request.connectionId);
    const progress = progressCounter();
    const stream = createWriteStream(request.filePath, { encoding: 'utf8' });
    try {
      for await (
        const doc of streamCollectionDocuments(
          db,
          request.collectionPath,
          request.includeSubcollections,
          signal,
        )
      ) {
        assertNotCancelled(signal);
        progress.read += 1;
        progress.currentPath = doc.ref.path;
        const encoded = encodeAdminData(doc.data());
        const line = JSON.stringify({
          path: relativeDocumentPath(request.collectionPath, doc.ref.path),
          data: request.encoding === 'plain' ? plainJsonValue(encoded) : encoded,
          updateTime: doc.updateTime.toDate().toISOString(),
        });
        await writeLine(stream, line);
        await sink.update(progress);
      }
      await endStream(stream);
      await sink.update({ ...progress, currentPath: undefined });
    } catch (error) {
      await destroyStream(stream);
      await unlink(request.filePath).catch(() => undefined);
      throw error;
    }
  }

  private async exportCsv(
    request: Extract<
      FirestoreCollectionJobRequest,
      { readonly type: 'firestore.exportCollection'; }
    >,
    signal: JobCancellationSignal,
    sink: JobProgressSink,
  ): Promise<void> {
    const db = await this.firestore(request.connectionId);
    const progress = progressCounter();
    const columns = new Set<string>(['path']);
    await mkdir(this.options.tempDirectory, { recursive: true });
    const tempPath = join(
      this.options.tempDirectory,
      `firebase-desk-export-${Date.now()}-${basename(request.filePath)}.jsonl`,
    );
    const temp = createWriteStream(tempPath, { encoding: 'utf8' });
    try {
      for await (
        const doc of streamCollectionDocuments(
          db,
          request.collectionPath,
          request.includeSubcollections,
          signal,
        )
      ) {
        assertNotCancelled(signal);
        progress.read += 1;
        progress.currentPath = doc.ref.path;
        const record = flattenCsvRecord({
          path: relativeDocumentPath(request.collectionPath, doc.ref.path),
          data: encodeAdminData(doc.data()),
        });
        Object.keys(record).forEach((key) => columns.add(key));
        await writeLine(temp, JSON.stringify(record));
        await sink.update(progress);
      }
      await endStream(temp);
      await writeCsvFromTemp(tempPath, request.filePath, Array.from(columns));
      await unlink(tempPath).catch(() => undefined);
      await sink.update({ ...progress, currentPath: undefined });
    } catch (error) {
      await destroyStream(temp);
      await unlink(tempPath).catch(() => undefined);
      await unlink(request.filePath).catch(() => undefined);
      throw error;
    }
  }

  private async importCollection(
    request: Extract<
      FirestoreCollectionJobRequest,
      { readonly type: 'firestore.importCollection'; }
    >,
    signal: JobCancellationSignal,
    sink: JobProgressSink,
  ): Promise<void> {
    assertFirestoreCollectionPath(request.targetCollectionPath);
    const db = await this.firestore(request.connectionId);
    const batcher = new BatchWriter(db, this.writeBatchMaxBytes());
    const progress = progressCounter();
    const input = createReadStream(request.filePath, { encoding: 'utf8' });
    const lines = createInterface({ crlfDelay: Infinity, input });
    let chunk: Array<{ readonly data: Record<string, unknown>; readonly targetPath: string; }> = [];
    try {
      for await (const line of lines) {
        assertNotCancelled(signal);
        if (!line.trim()) continue;
        const item = parseImportLine(line);
        const targetPath = `${request.targetCollectionPath}/${item.path}`;
        assertFirestoreDocumentPath(targetPath);
        chunk.push({ data: item.data, targetPath });
        if (chunk.length < WRITE_BATCH_LIMIT) continue;
        await writeImportChunk(db, chunk, batcher, request.collisionPolicy, progress, signal, sink);
        chunk = [];
      }
      await writeImportChunk(db, chunk, batcher, request.collisionPolicy, progress, signal, sink);
      assertNotCancelled(signal);
      await batcher.commit();
      await sink.update({ ...progress, currentPath: undefined });
    } finally {
      lines.close();
    }
  }

  private async firestore(connectionId: string): Promise<Firestore> {
    return (await this.provider.getFirestoreConnection(connectionId)).db;
  }

  private writeBatchMaxBytes(): number {
    return this.options.writeBatchMaxBytes ?? DEFAULT_WRITE_BATCH_MAX_BYTES;
  }

  private async copyDocumentChunk(
    docs: ReadonlyArray<QueryDocumentSnapshot>,
    request: Extract<FirestoreCollectionJobRequest, { readonly type: 'firestore.copyCollection'; }>,
    targetDb: Firestore,
    batcher: BatchWriter,
    progress: MutableProgress,
    signal: JobCancellationSignal,
    sink: JobProgressSink,
  ): Promise<void> {
    if (docs.length === 0) return;
    const targets = docs.map((doc) => {
      const relativePath = relativeDocumentPath(request.sourceCollectionPath, doc.ref.path);
      const targetPath = `${request.targetCollectionPath}/${relativePath}`;
      assertFirestoreDocumentPath(targetPath);
      return { doc, targetPath };
    });
    const writable = await writableTargetPaths(
      targetDb,
      targets.map((target) => target.targetPath),
      request.collisionPolicy,
    );
    // oxlint-disable no-await-in-loop -- progress and batch commits must stay ordered.
    for (const { doc, targetPath } of targets) {
      assertNotCancelled(signal);
      progress.read += 1;
      progress.currentPath = doc.ref.path;
      if (!writable.has(targetPath)) {
        progress.skipped += 1;
        await sink.update(progress);
        continue;
      }
      const encodedData = encodeAdminData(doc.data());
      await batcher.set(
        targetPath,
        decodeAdminData(targetDb, encodedData),
        estimateSetOperationBytes(targetPath, encodedData),
        signal,
      );
      progress.written += 1;
      await sink.update(progress);
    }
    // oxlint-enable no-await-in-loop
  }
}

class BatchWriter {
  private batch: WriteBatch;
  private count = 0;
  private estimatedBytes = 0;

  constructor(
    private readonly db: Firestore,
    private readonly maxBytes: number,
  ) {
    this.batch = db.batch();
  }

  async delete(path: string, signal: JobCancellationSignal): Promise<void> {
    const operationBytes = estimateDeleteOperationBytes(path);
    await this.commitBeforeOverflow(operationBytes, signal);
    this.batch.delete(this.db.doc(path));
    this.count += 1;
    this.estimatedBytes += operationBytes;
  }

  async commit(): Promise<void> {
    if (this.count === 0) return;
    const batch = this.batch;
    this.batch = this.db.batch();
    this.count = 0;
    this.estimatedBytes = 0;
    await batch.commit();
  }

  async set(
    path: string,
    data: DocumentData,
    operationBytes: number,
    signal: JobCancellationSignal,
  ): Promise<void> {
    await this.commitBeforeOverflow(operationBytes, signal);
    this.batch.set(this.db.doc(path), data);
    this.count += 1;
    this.estimatedBytes += operationBytes;
  }

  private async commitBeforeOverflow(
    operationBytes: number,
    signal: JobCancellationSignal,
  ): Promise<void> {
    if (
      this.count === 0
      || (this.count < WRITE_BATCH_LIMIT && this.estimatedBytes + operationBytes <= this.maxBytes)
    ) {
      return;
    }
    assertNotCancelled(signal);
    await this.commit();
  }
}

async function* streamCollectionDocuments(
  db: Firestore,
  collectionPath: string,
  includeSubcollections: boolean,
  signal: JobCancellationSignal,
): AsyncGenerator<QueryDocumentSnapshot> {
  for await (const doc of streamDirectCollectionDocuments(db, collectionPath, signal)) {
    yield doc;
    if (!includeSubcollections) continue;
    const subcollections = await doc.ref.listCollections();
    for (const subcollection of subcollections) {
      yield* streamCollectionDocuments(db, subcollection.path, true, signal);
    }
  }
}

async function* streamCollectionDocumentsForDelete(
  db: Firestore,
  collectionPath: string,
  includeSubcollections: boolean,
  signal: JobCancellationSignal,
): AsyncGenerator<QueryDocumentSnapshot> {
  for await (const doc of streamDirectCollectionDocuments(db, collectionPath, signal)) {
    if (includeSubcollections) {
      const subcollections = await doc.ref.listCollections();
      for (const subcollection of subcollections) {
        yield* streamCollectionDocumentsForDelete(db, subcollection.path, true, signal);
      }
    }
    yield doc;
  }
}

async function* streamDirectCollectionDocuments(
  db: Firestore,
  collectionPath: string,
  signal: JobCancellationSignal,
): AsyncGenerator<QueryDocumentSnapshot> {
  let last: QueryDocumentSnapshot | null = null;
  while (true) {
    assertNotCancelled(signal);
    let query = db.collection(collectionPath)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    // eslint-disable-next-line no-await-in-loop -- Each page depends on the previous cursor.
    const snapshot = await query.get();
    if (snapshot.empty) return;
    for (const doc of snapshot.docs) {
      assertNotCancelled(signal);
      yield doc;
    }
    last = snapshot.docs[snapshot.docs.length - 1] ?? null;
    if (!last || snapshot.docs.length < PAGE_SIZE) return;
  }
}

async function writeImportChunk(
  db: Firestore,
  items: ReadonlyArray<{ readonly data: Record<string, unknown>; readonly targetPath: string; }>,
  batcher: BatchWriter,
  policy: FirestoreJobCollisionPolicy,
  progress: MutableProgress,
  signal: JobCancellationSignal,
  sink: JobProgressSink,
): Promise<void> {
  if (items.length === 0) return;
  const writable = await writableTargetPaths(
    db,
    items.map((item) => item.targetPath),
    policy,
  );
  // oxlint-disable no-await-in-loop -- progress and batch commits must stay ordered.
  for (const item of items) {
    assertNotCancelled(signal);
    progress.read += 1;
    progress.currentPath = item.targetPath;
    if (!writable.has(item.targetPath)) {
      progress.skipped += 1;
      await sink.update(progress);
      continue;
    }
    await batcher.set(
      item.targetPath,
      decodeAdminData(db, item.data),
      estimateSetOperationBytes(item.targetPath, item.data),
      signal,
    );
    progress.written += 1;
    await sink.update(progress);
  }
  // oxlint-enable no-await-in-loop
}

async function writableTargetPaths(
  db: Firestore,
  paths: ReadonlyArray<string>,
  policy: FirestoreJobCollisionPolicy,
): Promise<ReadonlySet<string>> {
  if (policy === 'overwrite') return new Set(paths);
  const existing = await existingTargetPaths(db, paths);
  if (policy === 'fail' && existing.size > 0) {
    throw new Error(`Target document already exists: ${Array.from(existing)[0]}`);
  }
  return new Set(paths.filter((path) => !existing.has(path)));
}

async function existingTargetPaths(
  db: Firestore,
  paths: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> {
  if (paths.length === 0) return new Set();
  const snapshots = await db.getAll(...paths.map((path) => db.doc(path)));
  return new Set(
    snapshots.flatMap((snapshot, index) => snapshot.exists ? [paths[index] as string] : []),
  );
}

function parseImportLine(
  line: string,
): { readonly data: Record<string, unknown>; readonly path: string; } {
  const value = JSON.parse(line) as unknown;
  if (!value || typeof value !== 'object') throw new Error('Import line must be an object.');
  const record = value as { readonly data?: unknown; readonly path?: unknown; };
  if (typeof record.path !== 'string' || !record.path) {
    throw new Error('Import line path is required.');
  }
  if (!isRelativeDocumentPath(record.path)) {
    throw new Error(`Import line path must be relative document path: ${record.path}`);
  }
  if (!isPlainObject(record.data)) throw new Error('Import line data must be an object.');
  return { data: record.data, path: record.path };
}

function isRelativeDocumentPath(path: string): boolean {
  const parts = firestorePathParts(path);
  return parts.length > 0 && parts.length % 2 === 1;
}

function relativeDocumentPath(collectionPath: string, documentPath: string): string {
  const collectionParts = firestorePathParts(collectionPath);
  const documentParts = firestorePathParts(documentPath);
  return documentParts.slice(collectionParts.length).join('/');
}

function progressCounter(): MutableProgress {
  return {
    deleted: 0,
    failed: 0,
    read: 0,
    skipped: 0,
    written: 0,
  };
}

function estimateDeleteOperationBytes(path: string): number {
  return WRITE_OPERATION_OVERHEAD_BYTES + Buffer.byteLength(path, 'utf8');
}

function estimateSetOperationBytes(path: string, data: unknown): number {
  return estimateDeleteOperationBytes(path)
    + Buffer.byteLength(JSON.stringify(data) ?? 'null', 'utf8');
}

function assertNotCancelled(signal: JobCancellationSignal): void {
  if (signal.isCancelled()) throw new JobCancelledError();
}

function plainJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plainJsonValue);
  if (!isPlainObject(value)) return value;
  switch (value['__type__']) {
    case 'timestamp':
      return value['value'];
    case 'reference':
      return value['path'];
    case 'bytes':
      return value['base64'];
    case 'geoPoint':
      return { latitude: value['latitude'], longitude: value['longitude'] };
    case 'array':
      return Array.isArray(value['value']) ? value['value'].map(plainJsonValue) : [];
    case 'map':
      return isPlainObject(value['value']) ? plainJsonValue(value['value']) : {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, plainJsonValue(entry)]),
  );
}

function flattenCsvRecord(input: {
  readonly data: Record<string, unknown>;
  readonly path: string;
}): Record<string, string> {
  const record: Record<string, string> = { path: input.path };
  flattenCsvValue(record, '', input.data);
  return record;
}

function flattenCsvValue(out: Record<string, string>, prefix: string, value: unknown): void {
  if (!prefix && isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) flattenCsvValue(out, key, entry);
    return;
  }
  if (isPlainObject(value) && !value['__type__']) {
    for (const [key, entry] of Object.entries(value)) {
      flattenCsvValue(out, prefix ? `${prefix}.${key}` : key, entry);
    }
    return;
  }
  out[prefix] = csvCellValue(value);
}

function csvCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(plainJsonValue(value));
}

async function writeCsvFromTemp(
  tempPath: string,
  filePath: string,
  columns: ReadonlyArray<string>,
): Promise<void> {
  const output = createWriteStream(filePath, { encoding: 'utf8' });
  try {
    await writeLine(output, columns.map(csvEscape).join(','));
    const input = createReadStream(tempPath, { encoding: 'utf8' });
    const lines = createInterface({ crlfDelay: Infinity, input });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as Record<string, string>;
      await writeLine(output, columns.map((column) => csvEscape(record[column] ?? '')).join(','));
    }
    await endStream(output);
  } catch (error) {
    await destroyStream(output);
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function writeLine(stream: NodeJS.WritableStream, line: string): Promise<void> {
  if (!stream.write(`${line}\n`)) await once(stream, 'drain');
}

async function endStream(stream: NodeJS.WritableStream): Promise<void> {
  stream.end();
  await once(stream, 'finish');
}

async function destroyStream(stream: NodeJS.WritableStream): Promise<void> {
  const writable = stream as NodeJS.WritableStream & {
    readonly closed?: boolean;
    readonly destroyed?: boolean;
    destroy: () => void;
  };
  if (writable.closed) return;
  const closed = once(stream, 'close').catch(() => undefined);
  if (!writable.destroyed) writable.destroy();
  await closed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
