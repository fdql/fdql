import { describe, expect, it } from 'vitest';
import {
  collectStatementBlock,
  expressionBlockSlice,
  isProviderClauseBlockStart,
  nameRefInSourceBlock,
  parseExpressionBlock,
} from './source-block.ts';
import { createSourceLines } from './source-text.ts';

describe('FDQL parser source blocks', () => {
  it('collects continuation lines until the next statement', () => {
    const block = collectStatementBlock(
      createSourceLines(`from $events
  as event
return event.slug`),
      0,
    );

    expect(block).toMatchObject({
      nextIndex: 1,
      text: 'from $events as event',
    });
  });

  it('stops before provider clauses split across lines', () => {
    const lines = createSourceLines(`from $events
  as event
fs
  limit
  20`);
    const block = collectStatementBlock(lines, 0);
    const providerBlock = collectStatementBlock(lines, 2);

    expect(block).toMatchObject({
      nextIndex: 1,
      text: 'from $events as event',
    });
    expect(isProviderClauseBlockStart(lines, 2)).toBe(true);
    expect(providerBlock).toMatchObject({
      nextIndex: 4,
      text: 'fs limit 20',
    });
  });

  it('keeps name ranges on continuation lines', () => {
    const block = collectStatementBlock(
      createSourceLines(`from $events
  as event`),
      0,
    );

    expect(nameRefInSourceBlock('event', block, block.text.indexOf(' as ') + 4).range).toEqual({
      endColumn: 11,
      endLine: 2,
      startColumn: 6,
      startLine: 2,
    });
  });

  it('remaps expression ranges from collected text to source positions', () => {
    const block = collectStatementBlock(
      createSourceLines(`mem where
  event.schedule.endsAt is not null`),
      0,
    );
    const parsed = parseExpressionBlock(expressionBlockSlice(block, 'mem where '.length));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.expression?.range).toEqual({
      endColumn: 36,
      endLine: 2,
      startColumn: 3,
      startLine: 2,
    });
  });
});
