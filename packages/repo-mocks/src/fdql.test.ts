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
});
