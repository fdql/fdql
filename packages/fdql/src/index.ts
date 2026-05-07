import {
  compileFdqlRead as compileFdqlReadCore,
  type FdqlCompileOptions,
  type FdqlProviderDialect,
  type FdqlReadCompileResult,
} from '@firebase-desk/fdql-core';
import { firestoreProviderDialect } from '@firebase-desk/fdql-firestore';

export * from '@firebase-desk/fdql-core';
export * from '@firebase-desk/fdql-firestore';

export const builtinProviderDialects = [
  firestoreProviderDialect,
] as const satisfies readonly FdqlProviderDialect[];

export function compileFdqlRead(
  source: string,
  options: FdqlCompileOptions = {},
): FdqlReadCompileResult {
  return compileFdqlReadCore(source, {
    ...options,
    providers: [...builtinProviderDialects, ...(options.providers ?? [])],
  });
}
