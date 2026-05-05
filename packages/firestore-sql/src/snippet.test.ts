import { describe, expect, it } from 'vitest';
import { analyzeFirestoreSql, parseFirestoreSql, planFirestoreSql } from './index.ts';
import { generateFirestoreDeskJsQuerySnippet } from './snippet.ts';

const context = { defaultProjectId: 'local' };

describe('Firestore SQL snippet generator', () => {
  it('generates Firebase Desk JS Query source for simple reads', () => {
    const result = generateFirestoreDeskJsQuerySnippet(
      plan('select id(o) as orderId, o.status as status from orders o limit 10'),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.source).toContain('const rows = [];');
    expect(result.source).toContain('db.collection("orders").limit(10).get()');
    expect(result.source).toContain('"orderId": o.id');
    expect(result.source).toContain('yield rows;');
  });

  it('warns when a join needs manual review', () => {
    const result = generateFirestoreDeskJsQuerySnippet(
      plan('select id(o), u.email from orders o left join users u on id(u) = o.userId'),
    );

    expect(result.diagnostics).toContainEqual({
      code: 'SNIPPET_JOIN_REVIEW_REQUIRED',
      message: 'Join snippets need manual review.',
      severity: 'warning',
    });
    expect(result.source).toContain('Joins from SQL plan: u');
  });
});

function plan(sql: string) {
  const parsed = parseFirestoreSql(sql);
  expect(parsed).toMatchObject({ ok: true });
  if (!parsed.ok) throw new Error('Expected parse.');
  const analysis = analyzeFirestoreSql(parsed.ast, context);
  expect(analysis).toMatchObject({ ok: true });
  const planned = planFirestoreSql(parsed.ast, analysis, context);
  expect(planned).toMatchObject({ ok: true });
  if (!planned.plan) throw new Error('Expected plan.');
  return planned.plan;
}
