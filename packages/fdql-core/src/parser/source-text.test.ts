import { describe, expect, it } from 'vitest';
import { createSourceLines, sharedPreamble, splitUnionAll } from './source-text.ts';

describe('FDQL parser source text', () => {
  it('strips comments outside strings and keeps source locations', () => {
    const lines = createSourceLines(`  alias $url = "https://example.test/a//b" // comment
  from $url as u`);

    expect(lines).toEqual([
      expect.objectContaining({
        column: 3,
        line: 1,
        text: 'alias $url = "https://example.test/a//b"',
      }),
      expect.objectContaining({ column: 3, line: 2, text: 'from $url as u' }),
    ]);
  });

  it('splits top-level union all and extracts shared preamble', () => {
    const source = `set fdql.readBudget = 10
alias $a = mem.collection("a")
from $a as a
return a
union all
from $a as b
return b`;

    expect(splitUnionAll(source)).toHaveLength(2);
    expect(sharedPreamble(source)).toBe(`set fdql.readBudget = 10
alias $a = mem.collection("a")`);
  });
});
