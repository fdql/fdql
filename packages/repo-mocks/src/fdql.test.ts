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

  it('reads static and template subcollections', async () => {
    const repo = createMockFdqlRepository();

    const staticResult = await repo.run({
      connectionId: 'mock',
      runId: 'run_1',
      source: `alias $events = fs.subcollection("orders/ord_1024", "events", ["type"])
from $events as event
fs order by event.type asc
fs limit 1
return fs.id(event) as id, event.type`,
    });
    const templateResult = await repo.run({
      connectionId: 'mock',
      runId: 'run_2',
      source: `alias $orders = fs.collection("orders", [])
alias $events = fs.subcollection("events", ["type"])
from $orders as order
fs where fs.id(order) = "ord_1024"
then lookup many $events of order as events
return fs.id(order) as id, events`,
    });

    expect(staticResult.rows).toEqual([{ id: 'evt_created', type: 'created' }]);
    expect(templateResult.rows).toEqual([{
      events: [{ type: 'created' }, { type: 'paid' }],
      id: 'ord_1024',
    }]);
    expect(templateResult.stats).toMatchObject({ lookupReads: 2, reads: 3, rowsOutput: 1 });
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
