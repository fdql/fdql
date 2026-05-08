import { describe, expect, it } from 'vitest';
import { compileFdqlRead } from './compiler.ts';
import { executeFdql } from './executor.ts';
import type { FdqlProviderRuntimeRegistry } from './provider.ts';
import { createTestProviderRuntime, testProviderDialect } from './test-helpers/provider.ts';
import type { FdqlExecutionEvent } from './types.ts';

const compileOptions = { providers: [testProviderDialect] };

describe('FDQL executor composer', () => {
  it('streams rows and stats through the public executor', async () => {
    const events = await run(
      `alias $people = mem.collection("people")
from $people as p
mem where p.active = true
mem limit 10
then filter lower(p.name) = "vini"
return mem.id(p) as id, p.name`,
      createTestProviderRuntime({
        people: {
          p1: { active: true, name: 'Vini' },
          p2: { active: true, name: 'Alex' },
        },
      }),
    );

    expect(rows(events)).toEqual([{ id: 'p1', name: 'Vini' }]);
    expect(completed(events)).toMatchObject({
      providerReads: { mem: 2 },
      reads: 2,
      rowsOutput: 1,
      rowsScanned: 2,
      stoppedReason: 'completed',
    });
  });

  it('executes provider aggregate source reads', async () => {
    const events = await run(
      `alias $people = mem.collection("people")
from mem.aggregate($people as p)
  mem where p.active = true
  yield mem.count() as total,
        mem.sum(p.score) as score,
        mem.avg(p.score) as averageScore,
        mem.min(p.createdAt) as firstCreatedAt,
        mem.max(p.createdAt) as lastCreatedAt
return total, score, averageScore, firstCreatedAt, lastCreatedAt`,
      createTestProviderRuntime({
        people: {
          p1: { active: true, createdAt: '2026-01-01T00:00:00.000Z', score: 10 },
          p2: { active: true, createdAt: '2026-02-01T00:00:00.000Z', score: 4 },
          p3: { active: false, createdAt: '2026-03-01T00:00:00.000Z', score: 99 },
        },
      }),
    );

    expect(rows(events)).toEqual([{
      averageScore: 7,
      firstCreatedAt: '2026-01-01T00:00:00.000Z',
      lastCreatedAt: '2026-02-01T00:00:00.000Z',
      score: 14,
      total: 2,
    }]);
    expect(completed(events)).toMatchObject({
      aggregateReads: 1,
      reads: 1,
      rowsOutput: 1,
      rowsScanned: 1,
    });
  });

  it('executes provider aggregate count without row alias', async () => {
    const events = await run(
      `alias $people = mem.collection("people")
from mem.aggregate($people)
  yield mem.count() as total
return total`,
      createTestProviderRuntime({
        people: {
          p1: { active: true },
          p2: { active: false },
        },
      }),
    );

    expect(rows(events)).toEqual([{ total: 2 }]);
    expect(completed(events)).toMatchObject({ aggregateReads: 1, reads: 0, rowsOutput: 1 });
  });

  it('emits provider-neutral row lineage', async () => {
    const events = await run(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return mem.id(p)`,
      createTestProviderRuntime({ people: { p1: { name: 'Vini' } } }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'row',
        lineage: {
          provider: 'mem',
          readContribution: 1,
          rowPath: 'people/p1',
          source: '$people',
        },
      }),
    );
  });

  it('preserves provider failure context', async () => {
    const executionError = new Error('Provider rejected value.') as Error & {
      column: number;
      line: number;
    };
    executionError.line = 3;
    executionError.column = 12;
    const runtime: FdqlProviderRuntimeRegistry = {
      dialects: { mem: testProviderDialect },
      providers: {
        mem: {
          async *read() {
            yield* [];
            throw executionError;
          },
        },
      },
    };

    const events = await run(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      runtime,
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        diagnostic: {
          code: 'FDQL_EXECUTION_FAILED',
          column: 12,
          context: {
            provider: 'mem',
            rowAlias: 'p',
            source: '$people',
            stage: 'source',
          },
          line: 3,
          message: 'Provider rejected value.',
          severity: 'error',
        },
        kind: 'failed',
      }),
    );
  });
});

async function run(
  source: string,
  runtime: FdqlProviderRuntimeRegistry,
): Promise<readonly FdqlExecutionEvent[]> {
  const result = compileFdqlRead(source, compileOptions);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const events: FdqlExecutionEvent[] = [];
  for await (const event of executeFdql(result.plan, runtime)) events.push(event);
  return events;
}

function rows(events: readonly FdqlExecutionEvent[]): readonly Record<string, unknown>[] {
  return events.flatMap((event) => event.kind === 'row' ? [event.row] : []);
}

function completed(events: readonly FdqlExecutionEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === 'completed') return event.stats;
  }
  throw new Error('Missing completed event.');
}
