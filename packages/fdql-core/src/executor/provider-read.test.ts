import { describe, expect, it } from 'vitest';
import type { FdqlProviderRuntimeRegistry } from '../provider.ts';
import { testProviderDialect } from '../test-helpers/provider.ts';
import type {
  FdqlProviderReadControls,
  FdqlProviderReadRequest,
  FdqlSingleReadPlan,
} from '../types.ts';
import { stringValue } from '../value.ts';
import { createReadRequest, readProvider } from './provider-read.ts';
import { createStats } from './stats.ts';

const plan: FdqlSingleReadPlan = {
  aliases: {},
  kind: 'read',
  localStages: [],
  provider: {
    limit: 10,
    source: {
      provider: 'mem',
      sourceAlias: '$people',
      sourceType: 'collection',
      target: { collection: 'people' },
    },
  },
  returnStage: { column: 1, items: [], kind: 'return', line: 1, range: sourceRange() },
  rowAlias: 'p',
  settings: {
    allowUnboundedReads: false,
    cache: 'off',
    cacheTtlMs: 86_400_000,
    lineage: 'compact',
    pageSize: 100,
    readBudget: 3,
    timeoutMs: 60_000,
  },
};

describe('FDQL executor provider reads', () => {
  it('creates provider read requests from plans and remaining budget', () => {
    const stats = createStats(3);
    stats.reads = 1;

    const request = createReadRequest(plan.provider, plan, 'p', stats, 'source');

    expect(request).toMatchObject({
      limit: 10,
      maxDocuments: 2,
      pageSize: 2,
      rowAlias: 'p',
      source: { provider: 'mem', sourceAlias: '$people' },
      stage: 'source',
    });
  });

  it('adds diagnostic context to provider read failures', async () => {
    const runtime: FdqlProviderRuntimeRegistry = {
      dialects: { mem: testProviderDialect },
      providers: {
        mem: {
          async *read() {
            yield* [];
            throw new Error('bad read');
          },
        },
      },
    };
    const request = createReadRequest(plan.provider, plan, 'p', createStats(3), 'source');
    const controls: FdqlProviderReadControls = { deadlineAtMs: 60_000, now: () => 0 };

    await expect(collect(readProvider(runtime, request, controls))).rejects.toMatchObject({
      context: {
        provider: 'mem',
        rowAlias: 'p',
        source: '$people',
        stage: 'source',
      },
      message: 'bad read',
    });
  });

  it('streams provider rows from the registered runtime', async () => {
    const runtime: FdqlProviderRuntimeRegistry = {
      dialects: { mem: testProviderDialect },
      providers: {
        mem: {
          async *read(request: FdqlProviderReadRequest) {
            yield {
              context: {},
              data: { name: stringValue('Vini') },
              id: 'p1',
              path: 'people/p1',
              provider: 'mem',
              source: request.source,
            };
          },
        },
      },
    };

    await expect(
      collect(
        readProvider(
          runtime,
          createReadRequest(plan.provider, plan, 'p', createStats(3), 'source'),
          { deadlineAtMs: 60_000, now: () => 0 },
        ),
      ),
    ).resolves.toHaveLength(1);
  });
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<readonly T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

function sourceRange() {
  return { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };
}
