import { describe, expect, it } from 'vitest';
import { createTestProviderRuntime, testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlProjectionItem, FdqlSingleReadPlan } from '../types.ts';
import { missingValue, stringValue, timestampValue } from '../value.ts';
import { projectItems } from './projection.ts';

const runtime = createTestProviderRuntime({});
const plan: FdqlSingleReadPlan = {
  aliases: {},
  kind: 'read',
  localStages: [],
  provider: {
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
    pageSize: 100,
    readBudget: 10,
    timeoutMs: 60_000,
  },
};

describe('FDQL executor projection', () => {
  it('omits missing values and encodes typed values for external rows', () => {
    const row = {
      p: {
        context: {},
        data: {
          createdAt: timestampValue('2025-10-01T00:00:00.000Z'),
          missing: missingValue,
          name: stringValue('Vini'),
        },
        id: 'p1',
        path: 'people/p1',
        provider: 'mem',
        source: plan.provider.source,
      },
    };

    expect(projectItems([wildcard()], plan, row, runtime, 'external')).toEqual({
      p: {
        createdAt: { __fdqlType: 'timestamp', value: '2025-10-01T00:00:00.000Z' },
        name: 'Vini',
      },
    });
  });

  it('uses function fallback labels without provider-specific special cases', () => {
    const row = {
      p: {
        context: {},
        data: {},
        id: 'p1',
        path: 'people/p1',
        provider: 'mem',
        source: plan.provider.source,
      },
    };

    expect(
      projectItems(
        [{
          column: 1,
          expression: { args: [{ kind: 'field', path: ['p'] }], kind: 'call', name: 'mem.id' },
          label: 'mem.id(p)',
          line: 1,
        }],
        plan,
        row,
        { ...runtime, dialects: { mem: testProviderDialect } },
        'external',
      ),
    ).toEqual({ id: 'p1' });
  });
});

function wildcard(): FdqlProjectionItem {
  return { column: 1, expression: { kind: 'wildcard' }, label: '*', line: 1 };
}

function sourceRange() {
  return { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };
}
