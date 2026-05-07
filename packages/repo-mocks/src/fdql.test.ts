import { describe, expect, it } from 'vitest';
import { createMockFdqlRepository } from './fdql.ts';

describe('mock FDQL repository', () => {
  it('streams row and stats events', async () => {
    const repo = createMockFdqlRepository();
    const events: string[] = [];
    const unsubscribe = repo.subscribe((event) => events.push(event.type));

    const result = await repo.run({
      connectionId: 'mock',
      runId: 'run_1',
      source: `alias $orders = fs.collection("orders", ["status"])
from $orders as o
fs where o.status = "paid"
fs limit 1
return fs.id(o) as id, o.status`,
    });

    unsubscribe();
    expect(result.rows).toEqual([{ id: 'ord_1024', status: 'paid' }]);
    expect(result.stats).toMatchObject({ reads: 1, rowsOutput: 1 });
    expect(events).toEqual(
      expect.arrayContaining(['started', 'read', 'row', 'stats', 'completed']),
    );
  });

  it('applies nested field mask segments like the live repository', async () => {
    const repo = createMockFdqlRepository();

    const result = await repo.run({
      connectionId: 'mock',
      runId: 'run_1',
      source: `alias $orders = fs.collection("orders", ["metadata.fraudScore"])
from $orders as o
fs where fs.id(o) = "ord_1024"
return o.metadata.fraudScore as fraudScore, o.status`,
    });

    expect(result.rows).toEqual([{ fraudScore: 0.02 }]);
  });

  it('runs cache clear commands as successful no-ops', async () => {
    const repo = createMockFdqlRepository();

    const result = await repo.run({
      connectionId: 'mock',
      runId: 'run_1',
      source: 'clear cache provider fs project "mock"',
    });

    expect(result).toMatchObject({
      command: {
        clearedEntries: 0,
        kind: 'clearCache',
        message: 'Cleared 0 cache entries.',
      },
      diagnostics: [],
      rows: [],
      stats: null,
    });
  });
});
