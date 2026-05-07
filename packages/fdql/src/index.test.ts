import { describe, expect, it } from 'vitest';
import {
  builtinProviderDialects,
  compileFdql,
  compileFdqlRead,
  firestoreProviderDialect,
} from './index.ts';

describe('FDQL facade', () => {
  it('registers built-in Firestore provider dialects', () => {
    expect(builtinProviderDialects).toContain(firestoreProviderDialect);
  });

  it('compiles Firestore syntax without explicit provider registration', () => {
    const result = compileFdqlRead(
      `set fs.projectId = "local"
alias $drivers = fs.collection("drivers", ["firstName"])
from $drivers as d
fs where fs.id(d) = "drv_1"
return fs.id(d) as id, d.firstName`,
    );

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: {
        provider: {
          source: {
            provider: 'fs',
            target: { collectionPath: 'drivers', projectId: 'local' },
          },
        },
      },
    });
  });

  it('compiles Firestore cache clear command without explicit provider registration', () => {
    const result = compileFdql('clear cache provider fs project "local"');

    expect(result).toMatchObject({
      diagnostics: [],
      ok: true,
      plan: { kind: 'clearCache', projectId: 'local', provider: 'fs' },
    });
  });
});
