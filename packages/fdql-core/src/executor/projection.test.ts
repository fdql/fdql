import { describe, expect, it } from 'vitest';
import { createTestProviderRuntime, testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlProjectionItem, FdqlSingleReadPlan } from '../types.ts';
import {
  arrayValue,
  mapValue,
  missingValue,
  nullValue,
  numberValue,
  stringValue,
  timestampValue,
} from '../value.ts';
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

  it('keeps empty metadata rows and expands FDQL maps in wildcard projections', () => {
    const row = {
      order: {
        context: {},
        data: {},
        id: 'ord_1',
        path: 'orders/ord_1',
        provider: 'mem',
        source: plan.provider.source,
      },
      stats: mapValue({ total: numberValue(25) }),
    };

    expect(projectItems([wildcard()], plan, row, runtime, 'external')).toEqual({
      order: {},
      stats: { total: 25 },
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

  it('spreads FDQL map values and suffixes colliding fields', () => {
    const row = {
      stats: mapValue({ score: numberValue(9), total: numberValue(25) }),
    };

    expect(
      projectItems(
        [
          item('0', { kind: 'literal', value: 0 }, 'total'),
          spread('stats'),
          spread('stats'),
        ],
        plan,
        row,
        runtime,
        'external',
      ),
    ).toEqual({ score: 9, score_2: 9, total: 0, total_2: 25, total_3: 25 });
  });

  it('spreads provider row loaded data without metadata', () => {
    const row = {
      order: {
        context: {},
        data: {
          status: stringValue('paid'),
        },
        id: 'ord_1',
        path: 'orders/ord_1',
        provider: 'mem',
        source: plan.provider.source,
      },
    };

    expect(projectItems([spread('order')], plan, row, runtime, 'external')).toEqual({
      status: 'paid',
    });
  });

  it('falls back to normal projection for non-spreadable runtime values', () => {
    const row = {
      list: arrayValue([numberValue(1)]),
      missing: missingValue,
      nothing: nullValue,
      value: stringValue('abc'),
    };

    expect(
      projectItems(
        [spread('value'), spread('nothing'), spread('list'), spread('missing')],
        plan,
        row,
        runtime,
        'external',
      ),
    ).toEqual({
      list: [1],
      nothing: null,
      value: 'abc',
    });
  });
});

function wildcard(): FdqlProjectionItem {
  return { column: 1, expression: { kind: 'wildcard' }, label: '*', line: 1 };
}

function spread(name: string): FdqlProjectionItem {
  return {
    column: 1,
    expression: { kind: 'field', path: [name] },
    label: name,
    line: 1,
    spread: true,
  };
}

function item(
  label: string,
  expression: FdqlProjectionItem['expression'],
  alias?: string,
): FdqlProjectionItem {
  return {
    ...(alias ? { alias } : {}),
    column: 1,
    expression,
    label,
    line: 1,
  };
}

function sourceRange() {
  return { endColumn: 1, endLine: 1, startColumn: 1, startLine: 1 };
}
