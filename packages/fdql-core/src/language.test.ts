import { describe, expect, it } from 'vitest';
import { fdqlCoreLanguageMetadata } from './language.ts';

describe('FDQL core language metadata', () => {
  it('exposes core syntax metadata for reusable editor services', () => {
    expect(fdqlCoreLanguageMetadata.keywords).toEqual(
      expect.arrayContaining(['alias', 'from', 'return', 'set', 'then', 'union all']),
    );
    expect(names(fdqlCoreLanguageMetadata.settings)).toEqual(
      expect.arrayContaining(['fdql.readBudget', 'fdql.timeout']),
    );
    expect(names(fdqlCoreLanguageMetadata.expressionFunctions)).toEqual(
      expect.arrayContaining(['timestamp', 'entries', 'mapGet']),
    );
    expect(names(fdqlCoreLanguageMetadata.snippets)).toEqual(
      expect.arrayContaining(['from', 'then filter', 'then lookup required one', 'union all']),
    );
  });
});

function names(items: readonly { readonly name: string; }[]): readonly string[] {
  return items.map((item) => item.name);
}
