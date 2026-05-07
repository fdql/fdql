import { describe, expect, it } from 'vitest';
import { testProviderDialect } from '../test-helpers/provider.ts';
import { compileFdqlCommand } from './command.ts';

const options = { providers: [testProviderDialect] };

describe('FDQL compiler commands', () => {
  it.each([
    ['clear cache', {}],
    ['clear cache provider mem', { provider: 'mem' }],
    ['clear cache provider mem project "local"', { projectId: 'local', provider: 'mem' }],
  ])('compiles cache clear command: %s', (source, plan) => {
    const result = compileFdqlCommand(source, options);

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: { kind: 'clearCache', ...plan },
    });
  });

  it('rejects cache clear command mixed with a pipeline', () => {
    const result = compileFdqlCommand(
      `clear cache
alias $people = mem.collection("people")
from $people as p
mem limit 1
return p.name`,
      options,
    );

    expect(result).toMatchObject({ ok: false });
    expect(result?.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_COMMAND_MIXED_WITH_PIPELINE', line: 1 }),
    );
  });

  it('rejects unknown providers and malformed project selectors', () => {
    const unknown = compileFdqlCommand('clear cache provider fb', options);
    const malformed = compileFdqlCommand('clear cache provider mem project local', options);

    expect(unknown?.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE', line: 1 }),
    );
    expect(malformed?.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_INVALID_COMMAND', line: 1 }),
    );
  });
});
