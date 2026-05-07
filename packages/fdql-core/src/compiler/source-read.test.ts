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
});
