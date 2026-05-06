import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { FieldPath } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import type { AdminFirestoreProvider } from './admin-firestore-provider.ts';
import { createFirebaseFdqlRepository } from './fdql-repository.ts';

describe('Firebase FDQL repository', () => {
  it('runs native where, order, limit, and metadata-only field masks', async () => {
    const query = fakeQuery([fakeSnapshot('ord_1', 'orders/ord_1', {})]);
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $orders = fs.collection("orders", [])
from $orders as o
fs where o.status = "paid"
fs order by o.total desc
fs limit 1
return fs.id(o) as id`,
    });

    expect(db.collection).toHaveBeenCalledWith('orders');
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.orderBy).toHaveBeenCalledWith(expectFieldPath(['total']), 'desc');
    expect(query.select).toHaveBeenCalledWith();
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [{ id: 'ord_1' }],
      stats: { reads: 1, rowsOutput: 1, rowsScanned: 1 },
    });
  });

  it('returns compile diagnostics without touching Firestore', async () => {
    const db = {
      collection: vi.fn(),
    };
    const repository = createFirebaseFdqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: `alias $orders = fs.collection("orders")
from $orders as o
fs limit 1
fs limit 2
return fs.id(o) as id`,
    });

    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_DUPLICATE_STAGE' }),
    );
    expect(db.collection).not.toHaveBeenCalled();
  });
});

function fakeQuery(docs: readonly unknown[]) {
  const query = {
    get: vi.fn(async () => ({ docs })),
    limit: vi.fn((_limit: number) => query),
    orderBy: vi.fn((_field: FieldPath | string, _direction: 'asc' | 'desc') => query),
    select: vi.fn((..._fields: FieldPath[]) => query),
    where: vi.fn((_filter: unknown) => query),
  };
  return query;
}

function fakeSnapshot(id: string, path: string, data: Record<string, unknown>) {
  return {
    data: () => data,
    id,
    ref: {
      parent: { path: path.split('/').slice(0, -1).join('/') },
      path,
    },
  };
}

function expectFieldPath(path: readonly string[]) {
  return {
    asymmetricMatch(value: unknown) {
      return typeof value === 'object'
        && value !== null
        && 'isEqual' in value
        && (value as FieldPath).isEqual(new FieldPath(...path));
    },
    toString() {
      return `FieldPath(${path.join('.')})`;
    },
  };
}

function providerFor(db: unknown): AdminFirestoreProvider {
  return {
    getFirestoreConnection: vi.fn(async (connectionId: string) => ({
      config: {
        credentialJson: null,
        project: project(connectionId),
      },
      db,
    })),
  } as unknown as AdminFirestoreProvider;
}

function project(projectId: string): ProjectSummary {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    credentialEncrypted: null,
    hasCredential: false,
    id: projectId,
    name: projectId,
    projectId,
    target: 'emulator',
  };
}
