import { describe, expect, it } from 'vitest';
import { testProviderDialect } from '../test-helpers/provider.ts';
import { compileSingleFdqlRead } from './source-read.ts';

const options = { providers: [testProviderDialect] };

describe('FDQL compiler source reads', () => {
  it('plans provider reads with provider clauses', () => {
    const result = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem where p.active = true
mem order by p.createdAt desc
mem limit 25
return mem.id(p) as id, p.name`,
      options,
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          limit: 25,
          orderBy: { direction: 'desc' },
          source: {
            provider: 'mem',
            sourceType: 'collection',
            target: { collection: 'people' },
          },
        },
      },
    });
  });

  it('plans provider aggregate source reads', () => {
    const count = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from mem.aggregate($people)
  yield mem.count() as total
return total`,
      options,
    );
    const filtered = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from mem.aggregate($people as p)
  mem where p.active = true
  yield mem.count() as total, mem.sum(p.score) as score
return total, score`,
      options,
    );

    expect(count).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        providerAggregate: {
          items: [{ alias: 'total', functionName: 'mem.count' }],
          rowAlias: '__aggregate',
        },
      },
    });
    expect(filtered).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: { predicate: expect.objectContaining({ kind: 'binary' }) },
        providerAggregate: {
          items: [
            { alias: 'total', functionName: 'mem.count' },
            { alias: 'score', functionName: 'mem.sum' },
          ],
          rowAlias: 'p',
        },
      },
    });
  });

  it('requires explicit return stages', () => {
    const read = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1`,
      options,
    );
    const aggregate = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from mem.aggregate($people)
  yield mem.count() as total`,
      options,
    );

    expect(read.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_MISSING_RETURN' }),
    );
    expect(aggregate.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_MISSING_RETURN' }),
    );
  });

  it('requires declared provider source aliases and registered providers', () => {
    const undeclared = compileSingleFdqlRead(
      `from $people as p
mem limit 1
return p.name`,
      options,
    );
    const missingProvider = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      {},
    );
    const unknownProvider = compileSingleFdqlRead(
      `alias $people = fb.collection("people")
from $people as p
fb limit 1
return p.name`,
      options,
    );

    expect(undeclared.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNDECLARED_ALIAS' }),
    );
    expect(missingProvider.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE' }),
    );
    expect(unknownProvider.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE' }),
    );
  });

  it('blocks unbounded reads and duplicate singleton stages', () => {
    const unbounded = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
return p.name`,
      options,
    );
    const duplicate = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem order by p.name asc
mem order by p.createdAt asc
mem limit 1
mem limit 1
return mem.id(p) as id`,
      options,
    );

    expect(unbounded.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNBOUNDED_PROVIDER_READ' }),
    );
    expect(duplicate.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FDQL_DUPLICATE_STAGE', line: 4 }),
        expect.objectContaining({ code: 'FDQL_DUPLICATE_STAGE', line: 6 }),
      ]),
    );
  });

  it('validates return stages and provider predicates', () => {
    const duplicateReturn = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name
return p.teamId`,
      options,
    );
    const unknownFunction = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return fb.unknown(p), p.name`,
      options,
    );
    const invalidPredicate = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem where "paid" = p.status
mem limit 1
return p.name`,
      options,
    );

    expect(duplicateReturn.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_DUPLICATE_STAGE', line: 5 }),
    );
    expect(unknownFunction.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE', line: 4 }),
    );
    expect(invalidPredicate.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNSUPPORTED_PROVIDER_WHERE' }),
    );
  });

  it('validates row binding roots through return and row-shaping stages', () => {
    const invalidLookupAggregateReturn = compileSingleFdqlRead(
      `alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as order
mem limit 1
then lookup aggregate $teams as stats from team
  yield mem.count() as total
return total`,
      options,
    );
    const validLookupAggregateField = compileSingleFdqlRead(
      `alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as order
mem limit 1
then lookup aggregate $teams as stats from team
  yield mem.count() as total
return stats.total`,
      options,
    );
    const validLookupAggregateBinding = compileSingleFdqlRead(
      `alias $orders = mem.collection("orders")
alias $teams = mem.collection("teams")
from $orders as order
mem limit 1
then lookup aggregate $teams as stats from team
  yield mem.count() as total
return stats`,
      options,
    );
    const validLocalAggregate = compileSingleFdqlRead(
      `alias $orders = mem.collection("orders")
from $orders as order
mem limit 10
then aggregate
  yield count() as total
return total`,
      options,
    );
    const invalidWithReplacement = compileSingleFdqlRead(
      `alias $orders = mem.collection("orders")
from $orders as order
mem limit 1
then with order.status as status
return order`,
      options,
    );
    const validWithWildcard = compileSingleFdqlRead(
      `alias $orders = mem.collection("orders")
from $orders as order
mem limit 1
then with *, order.status as status
return order`,
      options,
    );

    expect(invalidLookupAggregateReturn.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'FDQL_UNKNOWN_ROW_BINDING',
        message:
          'Unknown row binding total. Use a current row alias or projected binding such as stats.total.',
      }),
    );
    expect(validLookupAggregateField.diagnostics).toEqual([]);
    expect(validLookupAggregateField.ok).toBe(true);
    expect(validLookupAggregateBinding.diagnostics).toEqual([]);
    expect(validLookupAggregateBinding.ok).toBe(true);
    expect(validLocalAggregate.diagnostics).toEqual([]);
    expect(validLocalAggregate.ok).toBe(true);
    expect(invalidWithReplacement.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_ROW_BINDING' }),
    );
    expect(validWithWildcard.diagnostics).toEqual([]);
    expect(validWithWildcard.ok).toBe(true);
  });

  it('validates provider aggregate source clauses and yield', () => {
    const missingYield = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from mem.aggregate($people)
return total`,
      options,
    );
    const whereWithoutAlias = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from mem.aggregate($people)
  mem where p.active = true
  yield mem.count() as total
return total`,
      options,
    );
    const unsupportedClause = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from mem.aggregate($people as p)
  mem order by p.name asc
  yield mem.count() as total
return total`,
      options,
    );
    const fieldWithoutAlias = compileSingleFdqlRead(
      `alias $people = mem.collection("people")
from mem.aggregate($people)
  yield mem.sum(p.score) as score
return score`,
      options,
    );

    expect(missingYield.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_MISSING_PROVIDER_AGGREGATE_YIELD' }),
    );
    expect(whereWithoutAlias.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_PROVIDER_AGGREGATE' }),
    );
    expect(unsupportedClause.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNSUPPORTED_PROVIDER_AGGREGATE_CLAUSE' }),
    );
    expect(fieldWithoutAlias.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_PROVIDER_AGGREGATE' }),
    );
  });
});
