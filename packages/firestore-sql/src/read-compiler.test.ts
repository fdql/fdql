import { describe, expect, it } from 'vitest';
import { compileFirestoreSqlRead } from './read-compiler.ts';

const context = {
  defaultProjectId: 'local',
  projectAliases: { prod: 'prod-project' },
};

describe('Firestore SQL read compiler', () => {
  it('compiles supported select with execution defaults', () => {
    const result = compileFirestoreSqlRead(
      'select id(o) as orderId from orders o limit 10 page size 25',
      {
        ...context,
        readBudget: 250,
        timeoutMs: 5000,
      },
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true });
    expect(result.plan?.kind).toBe('select');
    expect(result.plan?.stages[0]).toMatchObject({
      execution: { limit: 10, pageSize: 25, readBudget: 250, timeoutMs: 5000 },
      kind: 'execution',
    });
  });

  it('compiles top-level union all', () => {
    const result = compileFirestoreSqlRead(
      `select id(o) from orders o limit 10
union all
select id(o) from project($prod).orders o limit 10`,
      context,
    );

    expect(result).toMatchObject({ diagnostics: [], ok: true, plan: { kind: 'unionAll' } });
  });

  it('warns about scans before run', () => {
    const result = compileFirestoreSqlRead('select id(o) from orders o', context);

    expect(result).toMatchObject({
      diagnostics: [{ code: 'HIDDEN_SCAN_WARNING', severity: 'warning' }],
      ok: true,
    });
  });

  it('blocks write commands as unsupported', () => {
    const result = compileFirestoreSqlRead('delete from orders o where o.status = "test"', context);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_READ_COMMAND', severity: 'error' }),
    );
  });

  it('blocks aggregation for this release', () => {
    const result = compileFirestoreSqlRead('select count(*) as total from orders o', context);

    expect(result).toMatchObject({ ok: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_AGGREGATION', severity: 'error' }),
    );
  });
});
