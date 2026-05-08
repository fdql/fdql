import { describe, expect, it } from 'vitest';
import { compileFdql, compileFdqlRead } from './compiler.ts';
import { testProviderDialect } from './test-helpers/provider.ts';

const options = { providers: [testProviderDialect] };

describe('FDQL compiler composer', () => {
  it('compiles a provider read through the public read entrypoint', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
from $people as p
mem limit 1
return mem.id(p) as id, p.name`,
      options,
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: { kind: 'read', provider: { source: { provider: 'mem' } } },
    });
  });

  it('routes clear cache commands through the command-aware entrypoint', () => {
    const result = compileFdql('clear cache provider mem', options);

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: { kind: 'clearCache', provider: 'mem' },
    });
  });

  it('rejects union branches without explicit returns', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
alias $teams = mem.collection("teams")

from $people as p
mem limit 1

union all

from $teams as t
mem limit 1
return mem.id(t) as id`,
      options,
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_MISSING_RETURN' }),
    );
  });

  it('compiles top-level union branches with shared preamble', () => {
    const result = compileFdqlRead(
      `alias $people = mem.collection("people")
alias $teams = mem.collection("teams")

from $people as p
mem limit 1
return mem.id(p) as id

union all

from $teams as t
mem limit 1
return mem.id(t) as id`,
      options,
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: { branches: expect.any(Array), kind: 'union' },
    });
  });
});
