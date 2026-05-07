import { describe, expect, it } from 'vitest';
import { parseFdql } from '../parser.ts';
import { createProviderDialectRegistry } from '../provider.ts';
import { testProviderDialect } from '../test-helpers/provider.ts';
import type { FdqlDiagnostic, FdqlProgram, FdqlStage } from '../types.ts';
import { compileLocalStage } from './local-stages.ts';

const providers = createProviderDialectRegistry([testProviderDialect]);

describe('FDQL compiler local stages', () => {
  it('plans provider-neutral local stages and updates row aliases', () => {
    const availableRowAliases = new Set(['r']);
    const diagnostics: FdqlDiagnostic[] = [];
    const unwind = compileLocalStage(
      stageFor('then unwind entries(r.metadata) as entry'),
      availableRowAliases,
      {},
      providers,
      diagnostics,
    );
    const aggregate = compileLocalStage(
      stageFor(`then aggregate
  by r.driverId as driverId
  count() as total`),
      availableRowAliases,
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(unwind).toMatchObject({ kind: 'unwind', rowAlias: 'entry' });
    expect(aggregate).toMatchObject({ kind: 'aggregate' });
    expect(availableRowAliases.has('entry')).toBe(true);
  });

  it('reports unknown function namespaces in local expressions', () => {
    const diagnostics: FdqlDiagnostic[] = [];
    compileLocalStage(
      stageFor('then filter fb.unknown(r) = true'),
      new Set(['r']),
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_NAMESPACE', line: 3 }),
    );
  });
});

function stageFor(source: string): FdqlStage {
  const result = parseFdql(`alias $rounds = mem.collection("rounds")
from $rounds as r
${source}
return *`);
  if (!result.ok || !result.ast || 'kind' in result.ast) {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const stage = (result.ast as FdqlProgram).stages[0];
  if (!stage) throw new Error('expected stage');
  return stage;
}
