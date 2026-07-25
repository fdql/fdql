import type { FdqlDefaultProviderContext, FdqlProviderDialectRegistry } from '../provider.ts';
import type {
  FdqlCompileOptions,
  FdqlDiagnostic,
  FdqlExecutionSettings,
  FdqlExpression,
  FdqlSetDeclaration,
  FdqlValue,
} from '../types.ts';
import { arrayValue, literalToValue, mapValue, missingValue, scalarValue } from '../value.ts';
import { diagnosticAtName, diagnosticAtRange } from './diagnostics.ts';

export const defaultSettings: FdqlExecutionSettings = {
  allowUnboundedReads: false,
  cache: 'off',
  cacheTtlMs: 86_400_000,
  lineage: 'compact',
  pageSize: 100,
  readBudget: 5000,
  timeoutMs: 60_000,
};

const maxCacheTtlMs = 30 * 86_400_000;

export interface ResolvedPreambleSettings {
  readonly providerContext: FdqlDefaultProviderContext;
  readonly settings: FdqlExecutionSettings;
}

function defaultProviderContext(options: FdqlCompileOptions): FdqlDefaultProviderContext {
  return cloneProviderContext(options.defaultProviderContext ?? {});
}

export function resolveSettings(
  declarations: readonly FdqlSetDeclaration[],
  options: FdqlCompileOptions,
  providers: FdqlProviderDialectRegistry,
  diagnostics: FdqlDiagnostic[],
): ResolvedPreambleSettings {
  let settings: FdqlExecutionSettings = { ...defaultSettings, ...options.executionDefaults };
  let providerContext = defaultProviderContext(options);
  const seenKeys = new Map<string, number>();
  const seenKeyRefs = new Map<string, FdqlSetDeclaration>();
  for (const declaration of declarations) {
    const parsedKey = parseSettingKey(declaration, diagnostics);
    if (!parsedKey) continue;
    const firstLine = seenKeys.get(declaration.key);
    if (firstLine !== undefined) {
      const firstDeclaration = seenKeyRefs.get(declaration.key);
      diagnostics.push(
        diagnosticAtName(
          'FDQL_DUPLICATE_SET',
          `set ${declaration.key} can only appear once. First used on line ${firstLine}.`,
          declaration.keyRef ?? firstDeclaration?.keyRef,
          declaration.line,
        ),
      );
      continue;
    }
    seenKeys.set(declaration.key, declaration.line);
    seenKeyRefs.set(declaration.key, declaration);
    if (parsedKey.namespace === 'fdql') {
      settings = applyFdqlSetting(parsedKey.key, declaration, settings, diagnostics);
      continue;
    }
    const value = evaluateSetValue(declaration, diagnostics);
    if (!value) continue;
    const provider = providers[parsedKey.namespace];
    if (!provider) {
      diagnostics.push(
        diagnosticAtName(
          'FDQL_UNKNOWN_NAMESPACE',
          `Unknown provider namespace ${parsedKey.namespace}.`,
          declaration.keyRef,
          declaration.line,
        ),
      );
      continue;
    }
    const resolved = provider.resolveSetting?.({
      diagnostics,
      key: parsedKey.key,
      line: declaration.line,
      value,
    });
    if (resolved) {
      providerContext = mergeProviderContext(providerContext, parsedKey.namespace, resolved);
    } else if (!provider.resolveSetting) {
      diagnostics.push(
        diagnosticAtName(
          'FDQL_UNKNOWN_SET_KEY',
          `Unknown set key ${declaration.key}.`,
          declaration.keyRef,
          declaration.line,
        ),
      );
    }
  }
  return { providerContext, settings };
}

export function parseCacheTtlMs(value: string): number | undefined {
  const durationMs = parseDurationMs(value);
  if (!durationMs || durationMs > maxCacheTtlMs) return undefined;
  return durationMs;
}

function parseSettingKey(
  declaration: FdqlSetDeclaration,
  diagnostics: FdqlDiagnostic[],
): { readonly key: string; readonly namespace: string; } | null {
  const key = declaration.key;
  const match = /^([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)$/.exec(key);
  if (!match) {
    diagnostics.push(
      diagnosticAtName(
        'FDQL_INVALID_SET_KEY',
        'set keys must use namespace.key syntax.',
        declaration.keyRef,
        declaration.line,
      ),
    );
    return null;
  }
  return { key: match[2]!, namespace: match[1]! };
}

function evaluateSetValue(
  declaration: FdqlSetDeclaration,
  diagnostics: FdqlDiagnostic[],
): FdqlValue | null {
  if (!declaration.value) {
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_INVALID_SET',
        `Invalid value for set ${declaration.key}.`,
        declaration.range,
      ),
    );
    return null;
  }
  if (!isSetValueExpression(declaration.value)) {
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_INVALID_SET',
        `set ${declaration.key} values must be literals, arrays, or maps.`,
        declaration.value.range,
      ),
    );
    return null;
  }
  if (declaration.value.kind === 'literal') return literalToValue(declaration.value.value);
  if (declaration.value.kind === 'array') {
    return arrayValue(
      declaration.value.items.map((item) =>
        evaluateSetValue({ ...declaration, value: item }, diagnostics) ?? missingValue
      ),
    );
  }
  if (declaration.value.kind === 'map') {
    return mapValue(Object.fromEntries(
      declaration.value.entries.map((entry) => [
        entry.key,
        evaluateSetValue({ ...declaration, value: entry.value }, diagnostics) ?? missingValue,
      ]),
    ));
  }
  return null;
}

function isSetValueExpression(expression: FdqlExpression): boolean {
  if (expression.kind === 'literal') return true;
  if (expression.kind === 'array') return expression.items.every(isSetValueExpression);
  if (expression.kind === 'map') {
    return expression.entries.every((entry) => isSetValueExpression(entry.value));
  }
  return false;
}

function applyFdqlSetting(
  key: string,
  declaration: FdqlSetDeclaration,
  settings: FdqlExecutionSettings,
  diagnostics: FdqlDiagnostic[],
): FdqlExecutionSettings {
  const rawValue = declaration.rawValue.trim();
  const valueRange = declaration.value?.range ?? declaration.range;
  if (key === 'readBudget') {
    const value = numericSetValue(declaration, diagnostics);
    if (value && Number.isInteger(value) && value > 0) return { ...settings, readBudget: value };
    diagnostics.push(
      diagnosticAtRange('FDQL_INVALID_SET', 'Invalid value for set fdql.readBudget.', valueRange),
    );
  } else if (key === 'timeout') {
    const timeoutMs = parseDurationMs(rawValue);
    if (timeoutMs) return { ...settings, timeoutMs };
    else {
      diagnostics.push(
        diagnosticAtRange('FDQL_INVALID_SET', 'Invalid value for set fdql.timeout.', valueRange),
      );
    }
  } else if (key === 'cache') {
    const cacheMode = rawValue.toLowerCase();
    if (cacheMode === 'off' || cacheMode === 'run' || cacheMode === 'persistent') {
      return { ...settings, cache: cacheMode };
    }
    diagnostics.push(
      diagnosticAtRange('FDQL_INVALID_SET', 'Invalid value for set fdql.cache.', valueRange),
    );
  } else if (key === 'cacheTtl') {
    const cacheTtlMs = parseCacheTtlMs(rawValue);
    if (cacheTtlMs) return { ...settings, cacheTtlMs };
    diagnostics.push(
      diagnosticAtRange('FDQL_INVALID_SET', 'Invalid value for set fdql.cacheTtl.', valueRange),
    );
  } else if (key === 'lineage') {
    const lineage = rawValue.toLowerCase();
    if (lineage === 'compact' || lineage === 'off' || lineage === 'trace') {
      return { ...settings, lineage };
    }
    diagnostics.push(
      diagnosticAtRange('FDQL_INVALID_SET', 'Invalid value for set fdql.lineage.', valueRange),
    );
  } else if (key === 'allowUnboundedReads') {
    const value = scalarSetValue(declaration, diagnostics);
    if (typeof value === 'boolean') return { ...settings, allowUnboundedReads: value };
    diagnostics.push(
      diagnosticAtRange(
        'FDQL_INVALID_SET',
        'Invalid value for set fdql.allowUnboundedReads.',
        valueRange,
      ),
    );
  } else if (
    !['allowUnboundedReads', 'cache', 'cacheTtl', 'lineage', 'readBudget', 'timeout'].includes(key)
  ) {
    diagnostics.push(
      diagnosticAtName(
        'FDQL_UNKNOWN_SET_KEY',
        `Unknown set key fdql.${key}.`,
        declaration.keyRef,
        declaration.line,
      ),
    );
  } else {
    diagnostics.push(
      diagnosticAtRange('FDQL_INVALID_SET', `Invalid value for set fdql.${key}.`, valueRange),
    );
  }
  return settings;
}

function numericSetValue(
  declaration: FdqlSetDeclaration,
  diagnostics: FdqlDiagnostic[],
): number | undefined {
  const value = scalarSetValue(declaration, diagnostics);
  return typeof value === 'number' ? value : undefined;
}

function scalarSetValue(
  declaration: FdqlSetDeclaration,
  diagnostics: FdqlDiagnostic[],
): ReturnType<typeof scalarValue> | undefined {
  const value = evaluateSetValue(declaration, diagnostics);
  return value ? scalarValue(value) : undefined;
}

function cloneProviderContext(context: FdqlDefaultProviderContext): FdqlDefaultProviderContext {
  return Object.fromEntries(
    Object.entries(context).map(([namespace, values]) => [namespace, { ...values }]),
  );
}

function mergeProviderContext(
  context: FdqlDefaultProviderContext,
  namespace: string,
  values: Readonly<Record<string, unknown>>,
): FdqlDefaultProviderContext {
  return {
    ...context,
    [namespace]: {
      ...context[namespace],
      ...values,
    },
  };
}

function parseDurationMs(value: string): number | undefined {
  const match = /^(\d+)(s|m|h|d)$/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) return undefined;
  const unit = match[2]!.toLowerCase();
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60_000;
  if (unit === 'h') return amount * 3_600_000;
  return amount * 86_400_000;
}
