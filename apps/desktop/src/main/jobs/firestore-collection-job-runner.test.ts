import type { BackgroundJob } from '@firebase-desk/repo-contracts/jobs';
import type { AdminFirestoreProvider } from '@firebase-desk/repo-firebase';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirestoreCollectionJobRunner } from './firestore-collection-job-runner.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('FirestoreCollectionJobRunner', () => {
  it('deletes through paged reads and 500-operation batches', async () => {
    const db = new FakeFirestore({
      orders: Array.from(
        { length: 501 },
        (_, index) => `orders/order_${String(index).padStart(3, '0')}`,
      ),
    });
    const runner = new FirestoreCollectionJobRunner(provider(db), { tempDirectory: '/tmp' });
    const progress = vi.fn();

    await runner.run(deleteJob(false), neverCancelled(), { update: progress });

    expect(db.reads).toEqual([
      { path: 'orders', startAfter: null },
      { path: 'orders', startAfter: 'orders/order_249' },
      { path: 'orders', startAfter: 'orders/order_499' },
    ]);
    expect(db.commits.map((commit) => commit.length)).toEqual([500, 1]);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      currentPath: undefined,
      deleted: 501,
      read: 501,
    }));
  });

  it('deletes recursive subcollections before parent documents', async () => {
    const db = new FakeFirestore({
      'orders': ['orders/order_1'],
      'orders/order_1/items': ['orders/order_1/items/item_1'],
    });
    const runner = new FirestoreCollectionJobRunner(provider(db), { tempDirectory: '/tmp' });

    await runner.run(deleteJob(true), neverCancelled(), { update: vi.fn() });

    expect(db.commits.flat()).toEqual([
      'orders/order_1/items/item_1',
      'orders/order_1',
    ]);
  });

  it('copies documents with batched collision checks', async () => {
    const db = new FakeFirestore({
      'orders': ['orders/order_1', 'orders/order_2'],
      'orders_copy': ['orders_copy/order_2'],
    });
    const runner = new FirestoreCollectionJobRunner(provider(db), { tempDirectory: '/tmp' });

    await runner.run(copyJob('skip'), neverCancelled(), { update: vi.fn() });

    expect(db.getAllCalls).toEqual([['orders_copy/order_1', 'orders_copy/order_2']]);
    expect(db.commits.flat()).toEqual(['orders_copy/order_1']);
  });

  it('splits copy writes by estimated request payload size', async () => {
    const db = new FakeFirestore(
      { orders: ['orders/order_1', 'orders/order_2', 'orders/order_3'] },
      {
        'orders/order_1': { body: 'x'.repeat(120) },
        'orders/order_2': { body: 'x'.repeat(120) },
        'orders/order_3': { body: 'x'.repeat(120) },
      },
    );
    const runner = new FirestoreCollectionJobRunner(provider(db), {
      tempDirectory: '/tmp',
      writeBatchMaxBytes: 1000,
    });

    await runner.run(copyJob('overwrite'), neverCancelled(), { update: vi.fn() });

    expect(db.commits.map((commit) => commit.length)).toEqual([1, 1, 1]);
  });

  it('retries oversized copy commits as smaller batches', async () => {
    const db = new FakeFirestore(
      { orders: ['orders/order_1', 'orders/order_2', 'orders/order_3', 'orders/order_4'] },
      {},
      { rejectCommitsOver: 2 },
    );
    const runner = new FirestoreCollectionJobRunner(provider(db), { tempDirectory: '/tmp' });

    await runner.run(copyJob('overwrite'), neverCancelled(), { update: vi.fn() });

    expect(db.commits).toEqual([
      ['orders_copy/order_1', 'orders_copy/order_2'],
      ['orders_copy/order_3', 'orders_copy/order_4'],
    ]);
  });

  it('reports the document path when one copy write exceeds request payload size', async () => {
    const db = new FakeFirestore(
      { orders: ['orders/order_1'] },
      {},
      { rejectCommitsOver: 0 },
    );
    const runner = new FirestoreCollectionJobRunner(provider(db), { tempDirectory: '/tmp' });

    await expect(runner.run(copyJob('overwrite'), neverCancelled(), { update: vi.fn() }))
      .rejects.toThrow('orders_copy/order_1');
  });

  it('imports encoded JSONL with batched collision checks', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'import.jsonl');
    await writeFile(
      filePath,
      [
        JSON.stringify({ data: { name: 'Ada' }, path: 'user_1' }),
        JSON.stringify({ data: { name: 'Grace' }, path: 'user_2' }),
      ].join('\n'),
    );
    const db = new FakeFirestore({ users_imported: ['users_imported/user_2'] });
    const runner = new FirestoreCollectionJobRunner(provider(db), { tempDirectory: dir });

    await runner.run(importJob(filePath), neverCancelled(), { update: vi.fn() });

    expect(db.getAllCalls).toEqual([['users_imported/user_1', 'users_imported/user_2']]);
    expect(db.commits.flat()).toEqual(['users_imported/user_1']);
  });

  it('removes partial JSONL exports on failure', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'orders.jsonl');
    const db = new FakeFirestore({ orders: ['orders/order_1'] });
    const runner = new FirestoreCollectionJobRunner(provider(db), { tempDirectory: dir });

    await expect(runner.run(
      exportJob(filePath),
      neverCancelled(),
      {
        update: async () => {
          throw new Error('write failed');
        },
      },
    )).rejects.toThrow('write failed');

    await expect(access(filePath)).rejects.toThrow();
  });

  it('exports encoded JSONL for importable typed values', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'orders.jsonl');
    const db = new FakeFirestore(
      { orders: ['orders/order_1'] },
      {
        'orders/order_1': {
          shippedAt: new Date('2026-04-29T02:03:04.000Z'),
        },
      },
    );
    const runner = new FirestoreCollectionJobRunner(provider(db), { tempDirectory: dir });

    await runner.run(exportJob(filePath), neverCancelled(), { update: vi.fn() });

    const line = JSON.parse(await readFile(filePath, 'utf8')) as {
      readonly data: { readonly shippedAt: { readonly __type__: string; }; };
    };
    expect(line.data.shippedAt.__type__).toBe('timestamp');
  });
});

class FakeFirestore {
  readonly commits: string[][] = [];
  readonly getAllCalls: string[][] = [];
  readonly reads: Array<{ readonly path: string; readonly startAfter: string | null; }> = [];
  private readonly existingPaths: Set<string>;

  constructor(
    private readonly docsByCollection: Record<string, string[]>,
    private readonly dataByPath: Record<string, Record<string, unknown>> = {},
    private readonly options: { readonly rejectCommitsOver?: number; } = {},
  ) {
    this.existingPaths = new Set(Object.values(docsByCollection).flat());
  }

  batch() {
    const paths: string[] = [];
    return {
      commit: async () => {
        if (
          this.options.rejectCommitsOver !== undefined
          && paths.length > this.options.rejectCommitsOver
        ) {
          throw new Error('Request payload size exceeds the limit: 11534336 bytes.');
        }
        this.commits.push([...paths]);
      },
      delete: (ref: { readonly path: string; }) => {
        paths.push(ref.path);
        this.existingPaths.delete(ref.path);
      },
      set: (ref: { readonly path: string; }) => {
        paths.push(ref.path);
        this.existingPaths.add(ref.path);
      },
    };
  }

  collection(path: string) {
    return new FakeQuery(this, path);
  }

  doc(path: string) {
    return { path };
  }

  async getAll(...refs: Array<{ readonly path: string; }>) {
    this.getAllCalls.push(refs.map((ref) => ref.path));
    return refs.map((ref) => ({ exists: this.existingPaths.has(ref.path), ref }));
  }

  documents(path: string, startAfter: string | null, limit: number): FakeSnapshot[] {
    this.reads.push({ path, startAfter });
    const paths = this.docsByCollection[path] ?? [];
    const startIndex = startAfter ? paths.indexOf(startAfter) + 1 : 0;
    return paths.slice(startIndex, startIndex + limit).map((docPath) =>
      new FakeSnapshot(this, docPath, this.dataByPath[docPath] ?? {})
    );
  }

  subcollections(documentPath: string): Array<{ readonly path: string; }> {
    const prefix = `${documentPath}/`;
    return Object.keys(this.docsByCollection)
      .filter((path) =>
        path.startsWith(prefix) && path.slice(prefix.length).split('/').length === 1
      )
      .map((path) => ({ path }));
  }
}

class FakeQuery {
  private limitValue = 250;
  private startAfterPath: string | null = null;

  constructor(
    private readonly db: FakeFirestore,
    private readonly path: string,
  ) {}

  orderBy() {
    return this;
  }

  limit(limit: number) {
    this.limitValue = limit;
    return this;
  }

  startAfter(doc: { readonly ref: { readonly path: string; }; }) {
    this.startAfterPath = doc.ref.path;
    return this;
  }

  async get() {
    const docs = this.db.documents(this.path, this.startAfterPath, this.limitValue);
    return { docs, empty: docs.length === 0 };
  }
}

class FakeSnapshot {
  readonly ref: {
    readonly path: string;
    readonly listCollections: () => Promise<Array<{ readonly path: string; }>>;
  };
  readonly updateTime = {
    toDate: () => new Date('2026-04-29T00:00:00.000Z'),
  };

  constructor(
    db: FakeFirestore,
    path: string,
    private readonly value: Record<string, unknown>,
  ) {
    this.ref = {
      listCollections: async () => db.subcollections(path),
      path,
    };
  }

  data() {
    return this.value;
  }
}

function provider(db: FakeFirestore): AdminFirestoreProvider {
  return {
    getFirestoreConnection: async () => ({ db }),
  } as unknown as AdminFirestoreProvider;
}

function deleteJob(includeSubcollections: boolean): BackgroundJob {
  return {
    createdAt: '2026-04-29T00:00:00.000Z',
    id: 'job-1',
    progress: { deleted: 0, failed: 0, read: 0, skipped: 0, written: 0 },
    request: {
      collectionPath: 'orders',
      connectionId: 'emu',
      includeSubcollections,
      type: 'firestore.deleteCollection',
    },
    status: 'running',
    title: 'Delete collection',
    type: 'firestore.deleteCollection',
    updatedAt: '2026-04-29T00:00:00.000Z',
  };
}

function copyJob(collisionPolicy: 'fail' | 'overwrite' | 'skip'): BackgroundJob {
  return {
    createdAt: '2026-04-29T00:00:00.000Z',
    id: 'job-1',
    progress: { deleted: 0, failed: 0, read: 0, skipped: 0, written: 0 },
    request: {
      collisionPolicy,
      includeSubcollections: false,
      sourceCollectionPath: 'orders',
      sourceConnectionId: 'emu',
      targetCollectionPath: 'orders_copy',
      targetConnectionId: 'emu',
      type: 'firestore.copyCollection',
    },
    status: 'running',
    title: 'Copy collection',
    type: 'firestore.copyCollection',
    updatedAt: '2026-04-29T00:00:00.000Z',
  };
}

function exportJob(filePath: string): BackgroundJob {
  return {
    createdAt: '2026-04-29T00:00:00.000Z',
    id: 'job-1',
    progress: { deleted: 0, failed: 0, read: 0, skipped: 0, written: 0 },
    request: {
      collectionPath: 'orders',
      connectionId: 'emu',
      encoding: 'encoded',
      filePath,
      format: 'jsonl',
      includeSubcollections: false,
      type: 'firestore.exportCollection',
    },
    status: 'running',
    title: 'Export collection',
    type: 'firestore.exportCollection',
    updatedAt: '2026-04-29T00:00:00.000Z',
  };
}

function importJob(filePath: string): BackgroundJob {
  return {
    createdAt: '2026-04-29T00:00:00.000Z',
    id: 'job-1',
    progress: { deleted: 0, failed: 0, read: 0, skipped: 0, written: 0 },
    request: {
      collisionPolicy: 'skip',
      connectionId: 'emu',
      filePath,
      targetCollectionPath: 'users_imported',
      type: 'firestore.importCollection',
    },
    status: 'running',
    title: 'Import collection',
    type: 'firestore.importCollection',
    updatedAt: '2026-04-29T00:00:00.000Z',
  };
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'firebase-desk-runner-'));
  tempDirs.push(dir);
  return dir;
}

function neverCancelled() {
  return { isCancelled: () => false };
}
