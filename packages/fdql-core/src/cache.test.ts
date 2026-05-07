import { describe, expect, it } from 'vitest';
import { createFdqlProviderReadCacheKey } from './cache.ts';
import type {
  FdqlExpression,
  FdqlProviderReadRequest,
  FdqlProviderRow,
  FdqlSourceRange,
} from './types.ts';
import { stringValue } from './value.ts';

describe('FDQL provider read cache key', () => {
  it('canonicalizes field mask and commutative provider predicates', () => {
    const first = createFdqlProviderReadCacheKey({
      request: request({
        fieldMask: [{ path: 'name' }, { path: 'id' }],
        predicate: and(
          eq(field('team', 'id'), literal('team_1')),
          eq(field('team', 'name'), literal('Orange')),
        ),
      }),
    });
    const second = createFdqlProviderReadCacheKey({
      request: request({
        fieldMask: [{ path: 'id' }, { path: 'name' }],
        predicate: and(
          eq(field('team', 'name'), literal('Orange')),
          eq(field('team', 'id'), literal('team_1')),
        ),
      }),
    });

    expect(second.canonicalJson).toBe(first.canonicalJson);
  });

  it('excludes FDQL source and row alias names from equivalent lookup keys', () => {
    const first = createFdqlProviderReadCacheKey({
      request: request({
        predicate: eq(field('team', 'id'), field('assignment', 'teamId')),
        rowAlias: 'team',
        rows: { assignment: providerRow('assignments/a1') },
        sourceAlias: '$teams',
      }),
    });
    const second = createFdqlProviderReadCacheKey({
      request: request({
        predicate: eq(field('candidate', 'id'), field('row', 'teamId')),
        rowAlias: 'candidate',
        rows: { row: providerRow('assignments/a1') },
        sourceAlias: '$teamLookup',
      }),
    });

    expect(second.canonicalJson).toBe(first.canonicalJson);
  });

  it('keeps different provider source targets distinct', () => {
    const first = createFdqlProviderReadCacheKey({
      request: request({
        target: { collection: 'teams', databaseId: 'default', projectId: 'local' },
      }),
    });
    const second = createFdqlProviderReadCacheKey({
      request: request({ target: { collection: 'teams', databaseId: 'db2', projectId: 'local' } }),
    });

    expect(second.canonicalJson).not.toBe(first.canonicalJson);
  });

  it('ignores parser source ranges in cacheable expressions', () => {
    const first = createFdqlProviderReadCacheKey({
      request: request({
        orderBy: { direction: 'asc', expression: wildcard(range(2, 5, 2, 6)) },
        predicate: eq(field('team', 'id'), literal('team_1', range(1, 17, 1, 25))),
      }),
    });
    const second = createFdqlProviderReadCacheKey({
      request: request({
        orderBy: { direction: 'asc', expression: wildcard(range(20, 8, 20, 9)) },
        predicate: eq(field('team', 'id'), literal('team_1', range(10, 24, 10, 32))),
      }),
    });

    expect(second.canonicalJson).toBe(first.canonicalJson);
  });
});

function request(
  overrides: Partial<FdqlProviderReadRequest> & {
    readonly sourceAlias?: string | undefined;
    readonly target?: Record<string, unknown> | undefined;
  } = {},
): FdqlProviderReadRequest {
  const { sourceAlias, target, ...requestOverrides } = overrides;
  return {
    aliases: {},
    fieldMask: overrides.fieldMask,
    maxDocuments: 1,
    pageSize: 1,
    rowAlias: overrides.rowAlias ?? 'team',
    source: {
      provider: 'mem',
      sourceAlias: sourceAlias ?? '$teams',
      sourceType: 'collection',
      target: target ?? { collection: 'teams', projectId: 'local' },
    },
    ...requestOverrides,
  };
}

function providerRow(path: string): FdqlProviderRow {
  return {
    context: { projectId: 'local' },
    data: { teamId: stringValue('team_1') },
    id: path.split('/').at(-1) ?? path,
    path,
    provider: 'mem',
    source: {
      provider: 'mem',
      sourceAlias: '$assignments',
      sourceType: 'collection',
      target: { collection: 'assignments', projectId: 'local' },
    },
  };
}

function field(...path: readonly string[]): FdqlExpression {
  return { kind: 'field', path };
}

function literal(value: string, sourceRange?: FdqlSourceRange): FdqlExpression {
  return { kind: 'literal', ...(sourceRange ? { range: sourceRange } : {}), value };
}

function eq(left: FdqlExpression, right: FdqlExpression): FdqlExpression {
  return { kind: 'binary', left, operator: '=', right };
}

function and(left: FdqlExpression, right: FdqlExpression): FdqlExpression {
  return { kind: 'binary', left, operator: 'and', right };
}

function wildcard(sourceRange: FdqlSourceRange): FdqlExpression {
  return { kind: 'wildcard', range: sourceRange };
}

function range(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): FdqlSourceRange {
  return { endColumn, endLine, startColumn, startLine };
}
