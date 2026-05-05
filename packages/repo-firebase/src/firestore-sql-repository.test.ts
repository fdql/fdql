import type { ProjectSummary } from '@firebase-desk/repo-contracts';
import { FieldPath } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import type { AdminFirestoreProvider } from './admin-firestore-provider.ts';
import { FirebaseFirestoreSqlRepository } from './firestore-sql-repository.ts';

describe('FirebaseFirestoreSqlRepository', () => {
  it('compiles read SQL and returns a snippet', async () => {
    const repository = new FirebaseFirestoreSqlRepository(providerFor({}));

    const result = await repository.compile({
      connectionId: 'local',
      source: 'select slug from admin-events limit 1',
    });

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    expect(result.snippet).toContain('db.collection("admin-events").limit(1).get()');
  });

  it('runs read SQL with Firestore limit and field projection', async () => {
    const query = fakeQuery([
      fakeSnapshot('evt_1', 'admin-events/evt_1', { slug: 'acc-multi-league-imola-2021' }),
    ]);
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = new FirebaseFirestoreSqlRepository(providerFor(db));
    const events: string[] = [];
    repository.subscribe((event) => events.push(event.type));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: 'select slug from admin-events limit 1',
    });

    expect(db.collection).toHaveBeenCalledWith('admin-events');
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(selectedFieldSegments(query)).toEqual([['slug']]);
    expect(result).toMatchObject({
      diagnostics: [],
      rows: [{ slug: 'acc-multi-league-imola-2021' }],
      stats: { reads: 1, rowsOutput: 1, rowsScanned: 1 },
    });
    expect(events).toEqual(['started', 'plan', 'plan', 'read', 'row', 'stats', 'completed']);
  });

  it('uses metadata-only projection for document id reads', async () => {
    const query = fakeQuery([fakeSnapshot('evt_1', 'admin-events/evt_1', {})]);
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = new FirebaseFirestoreSqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: 'select id(e) from admin-events e limit 1',
    });

    expect(query.select).toHaveBeenCalledWith();
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(result.rows).toEqual([{ id: 'evt_1' }]);
  });

  it('does not project Firestore fields for wildcard reads', async () => {
    const query = fakeQuery([
      fakeSnapshot('evt_1', 'admin-events/evt_1', { slug: 'first', status: 'published' }),
    ]);
    const db = {
      collection: vi.fn(() => query),
    };
    const repository = new FirebaseFirestoreSqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: 'select * from admin-events limit 1',
    });

    expect(query.select).not.toHaveBeenCalled();
    expect(result.rows).toEqual([{ slug: 'first', status: 'published' }]);
  });

  it('returns compile diagnostics without touching Firestore', async () => {
    const db = {
      collection: vi.fn(),
    };
    const repository = new FirebaseFirestoreSqlRepository(providerFor(db));

    const result = await repository.run({
      connectionId: 'local',
      runId: 'run_1',
      source: 'delete from admin-events',
    });

    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_READ_COMMAND',
    }));
    expect(db.collection).not.toHaveBeenCalled();
  });
});

function fakeQuery(docs: readonly unknown[]) {
  const query = {
    get: vi.fn(async () => ({ docs })),
    limit: vi.fn((_limit: number) => query),
    select: vi.fn((..._fields: FieldPath[]) => query),
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

function selectedFieldSegments(query: ReturnType<typeof fakeQuery>): string[][] {
  const call = query.select.mock.calls[0] ?? [];
  return call.map((field) => {
    const match = [['slug'], ['status'], ['userId'], ['email']].find((candidate) =>
      field.isEqual(new FieldPath(...candidate))
    );
    return match ?? [];
  });
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
