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
    expect(availableRowAliases.has('entry')).toBe(true);

    const aggregate = compileLocalStage(
      stageFor(`then aggregate
  by r.driverId as driverId
  yield count() as total`),
      availableRowAliases,
      {},
      providers,
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(unwind).toMatchObject({ kind: 'unwind', rowAlias: 'entry' });
    expect(aggregate).toMatchObject({ kind: 'aggregate' });
    expect([...availableRowAliases]).toEqual(['driverId', 'total']);
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

  it('validates and updates row bindings for local shape changes', () => {
    const replaced = new Set(['order']);
    const replacedDiagnostics: FdqlDiagnostic[] = [];
    compileLocalStage(
      stageFor('then with order.status as status'),
      replaced,
      {},
      providers,
      replacedDiagnostics,
    );
    compileLocalStage(
      stageFor('then filter order.status = "paid"'),
      replaced,
      {},
      providers,
      replacedDiagnostics,
    );

    const preserved = new Set(['order']);
    const preservedDiagnostics: FdqlDiagnostic[] = [];
    compileLocalStage(
      stageFor('then with *, order.status as status'),
      preserved,
      {},
      providers,
      preservedDiagnostics,
    );
    compileLocalStage(
      stageFor('then filter order.status = "paid"'),
      preserved,
      {},
      providers,
      preservedDiagnostics,
    );

    expect([...replaced]).toEqual(['status']);
    expect(replacedDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'FDQL_UNKNOWN_ROW_BINDING' }),
    );
    expect([...preserved]).toEqual(['order', 'status']);
    expect(preservedDiagnostics).toEqual([]);
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
