import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from './channels.ts';
import { FIRESTORE_SQL_EVENT_CHANNEL, FirestoreSqlRunEventSchema } from './firestore-sql.ts';

describe('firestore sql ipc schemas', () => {
  it('validates compile and run requests', () => {
    expect(IPC_CHANNELS['firestoreSql.compile'].request.parse({
      connectionId: 'prod',
      execution: { pageSize: 100, readBudget: 5000, timeoutMs: 60_000 },
      source: 'select * from orders',
    })).toMatchObject({ connectionId: 'prod' });

    expect(IPC_CHANNELS['firestoreSql.run'].request.parse({
      connectionId: 'prod',
      runId: 'run-1',
      source: 'select * from orders',
    })).toMatchObject({ runId: 'run-1' });
  });

  it('validates run events', () => {
    expect(FIRESTORE_SQL_EVENT_CHANNEL).toBe('firestoreSql.event');
    expect(FirestoreSqlRunEventSchema.parse({
      lineage: { joinedSources: [], localSources: [], readContribution: 1 },
      row: { id: 'ord_1024' },
      runId: 'run-1',
      type: 'row',
    })).toMatchObject({ type: 'row' });
  });
});
