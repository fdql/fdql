import type {
  FdqlExpression,
  FdqlProviderQueryValidationInput,
  FdqlValue,
} from '@firebase-desk/fdql-core';
import { firestoreError, walkExpression } from './helpers.ts';

type OperatorKind =
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'arrayContains'
  | 'arrayContainsAny'
  | 'in'
  | 'is not null'
  | 'not in';

interface OperatorUsage {
  readonly expression: FdqlExpression;
  readonly fieldKey?: string | undefined;
  readonly kind: OperatorKind;
  readonly line: number;
  readonly value?: FdqlExpression | undefined;
}

interface StaticArrayShape {
  readonly count?: number | undefined;
  readonly static: boolean;
}

const negativeOperators = new Set<OperatorKind>(['!=', 'is not null', 'not in']);
const inequalityOperators = new Set<OperatorKind>([
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'is not null',
  'not in',
]);

export function validateFirestoreQueryConstraints(
  input: FdqlProviderQueryValidationInput,
): void {
  if (!input.predicate) return;
  const usages = collectOperatorUsages(input.predicate, input);
  validateArrayOperatorValues(usages, input);
  validateNotInCombinations(usages, input);
  validateNegativeFilterCount(usages, input);
  validateArrayOperatorsInDisjunctions(input);
  validateInequalityOrder(usages, input);
}

function collectOperatorUsages(
  expression: FdqlExpression,
  input: FdqlProviderQueryValidationInput,
): readonly OperatorUsage[] {
  const usages: OperatorUsage[] = [];
  walkExpression(expression, (node) => {
    if (node.kind === 'binary') {
      if (isFirestoreOperator(node.operator)) {
        usages.push({
          expression: node,
          fieldKey: fieldKeyFromExpression(node.left, input.rowAlias),
          kind: node.operator,
          line: lineFor(node, input.predicateLine),
          value: node.right,
        });
      }
      return;
    }
    if (node.kind === 'postfix' && node.operator === 'is not null') {
      usages.push({
        expression: node,
        fieldKey: fieldKeyFromExpression(node.expression, input.rowAlias),
        kind: 'is not null',
        line: lineFor(node, input.predicateLine),
      });
      return;
    }
    if (node.kind === 'call' && node.name === 'fs.arrayContains') {
      usages.push({
        expression: node,
        fieldKey: fieldKeyFromExpression(node.args[0], input.rowAlias),
        kind: 'arrayContains',
        line: lineFor(node, input.predicateLine),
        value: node.args[1],
      });
    }
    if (node.kind === 'call' && node.name === 'fs.arrayContainsAny') {
      usages.push({
        expression: node,
        fieldKey: fieldKeyFromExpression(node.args[0], input.rowAlias),
        kind: 'arrayContainsAny',
        line: lineFor(node, input.predicateLine),
        value: node.args[1],
      });
    }
  });
  return usages;
}

function validateArrayOperatorValues(
  usages: readonly OperatorUsage[],
  input: FdqlProviderQueryValidationInput,
): void {
  for (const usage of usages) {
    if (usage.kind !== 'in' && usage.kind !== 'not in' && usage.kind !== 'arrayContainsAny') {
      continue;
    }
    const shape = usage.value ? staticArrayShape(usage.value, input.aliases) : { static: true };
    if (!shape.static) continue;
    const max = usage.kind === 'not in' ? 10 : 30;
    if (shape.count === undefined || shape.count === 0 || shape.count > max) {
      input.diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          `${operatorLabel(usage.kind)} needs 1 to ${max} comparison values.`,
          usage.line,
        ),
      );
    }
  }
}

function validateNotInCombinations(
  usages: readonly OperatorUsage[],
  input: FdqlProviderQueryValidationInput,
): void {
  const notInCount = count(usages, 'not in');
  if (!notInCount) return;
  const hasForbidden = hasOr(input.predicate)
    || count(usages, 'in') > 0
    || count(usages, 'arrayContainsAny') > 0
    || count(usages, '!=') > 0
    || count(usages, 'is not null') > 0
    || notInCount > 1;
  if (!hasForbidden) return;
  input.diagnostics.push(
    firestoreError(
      'FDQL_UNSUPPORTED_FS_WHERE',
      '`not in` cannot be combined with or, in, arrayContainsAny, !=, is not null, or another not in.',
      usages.find((usage) => usage.kind === 'not in')?.line ?? input.predicateLine,
    ),
  );
}

function validateNegativeFilterCount(
  usages: readonly OperatorUsage[],
  input: FdqlProviderQueryValidationInput,
): void {
  const negative = usages.filter((usage) => negativeOperators.has(usage.kind));
  if (negative.length <= 1) return;
  input.diagnostics.push(
    firestoreError(
      'FDQL_UNSUPPORTED_FS_WHERE',
      'Firestore supports only one negative filter: !=, not in, or is not null.',
      negative[1]?.line ?? input.predicateLine,
    ),
  );
}

function validateArrayOperatorsInDisjunctions(input: FdqlProviderQueryValidationInput): void {
  if (!input.predicate) return;
  for (const group of disjunctionGroups(input.predicate, input)) {
    if (count(group, 'arrayContainsAny') > 1) {
      input.diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          'Firestore supports only one arrayContainsAny filter in the same disjunction.',
          group.find((usage) => usage.kind === 'arrayContainsAny')?.line ?? input.predicateLine,
        ),
      );
    }
    if (count(group, 'arrayContainsAny') > 0 && count(group, 'arrayContains') > 0) {
      input.diagnostics.push(
        firestoreError(
          'FDQL_UNSUPPORTED_FS_WHERE',
          'Firestore cannot combine arrayContains and arrayContainsAny in the same disjunction.',
          group.find((usage) => usage.kind === 'arrayContainsAny')?.line ?? input.predicateLine,
        ),
      );
    }
  }
}

function validateInequalityOrder(
  usages: readonly OperatorUsage[],
  input: FdqlProviderQueryValidationInput,
): void {
  if (!input.orderBy) return;
  const firstInequality = usages.find((usage) => inequalityOperators.has(usage.kind));
  if (!firstInequality?.fieldKey) return;
  const orderFieldKey = fieldKeyFromExpression(input.orderBy.expression, input.rowAlias);
  if (!orderFieldKey || orderFieldKey === firstInequality.fieldKey) return;
  input.diagnostics.push(
    firestoreError(
      'FDQL_UNSUPPORTED_FS_ORDER_BY',
      '`fs order by` must order first by the inequality filter field.',
      input.orderByLine ?? firstInequality.line,
    ),
  );
}

function disjunctionGroups(
  expression: FdqlExpression,
  input: FdqlProviderQueryValidationInput,
): readonly (readonly OperatorUsage[])[] {
  if (expression.kind === 'binary' && expression.operator === 'or') {
    return [
      ...disjunctionGroups(expression.left, input),
      ...disjunctionGroups(expression.right, input),
    ];
  }
  return [collectOperatorUsages(expression, input)];
}

function staticArrayShape(
  expression: FdqlExpression,
  aliases: Readonly<Record<string, FdqlValue>>,
): StaticArrayShape {
  if (expression.kind === 'array') return { count: expression.items.length, static: true };
  if (expression.kind === 'alias') {
    const value = aliases[expression.name];
    return value?.kind === 'array'
      ? { count: value.value.length, static: true }
      : { static: true };
  }
  if (isStaticValueExpression(expression)) return { static: true };
  return { static: false };
}

function isStaticValueExpression(expression: FdqlExpression): boolean {
  if (expression.kind === 'literal' || expression.kind === 'map') return true;
  return expression.kind === 'call'
    && ['bytes', 'fs.ref', 'geoPoint', 'timestamp'].includes(expression.name);
}

function isFirestoreOperator(
  operator: Extract<FdqlExpression, { readonly kind: 'binary'; }>['operator'],
): operator is Extract<OperatorKind, '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not in'> {
  return ['!=', '<', '<=', '>', '>=', 'in', 'not in'].includes(operator);
}

function fieldKeyFromExpression(
  expression: FdqlExpression | undefined,
  rowAlias: string,
): string | undefined {
  if (!expression) return undefined;
  if (
    expression.kind === 'field' && expression.path[0] === rowAlias && expression.path.length > 1
  ) {
    return `field:${expression.path.slice(1).join('\u001f')}`;
  }
  if (
    expression.kind === 'call'
    && expression.name === 'fs.id'
    && expression.args[0]?.kind === 'field'
    && expression.args[0].path.length === 1
    && expression.args[0].path[0] === rowAlias
  ) {
    return 'id';
  }
  if (expression.kind === 'call' && expression.name === 'fs.fieldPath') {
    const segments = expression.args.flatMap((arg) =>
      arg.kind === 'literal' && typeof arg.value === 'string' ? [arg.value] : []
    );
    return segments.length === expression.args.length && segments.length > 0
      ? `field:${segments.join('\u001f')}`
      : undefined;
  }
  return undefined;
}

function hasOr(expression: FdqlExpression | undefined): boolean {
  if (!expression) return false;
  let result = false;
  walkExpression(expression, (node) => {
    if (node.kind === 'binary' && node.operator === 'or') result = true;
  });
  return result;
}

function count(usages: readonly OperatorUsage[], kind: OperatorKind): number {
  return usages.filter((usage) => usage.kind === kind).length;
}

function lineFor(expression: FdqlExpression, fallback?: number | undefined): number {
  return expression.range?.startLine ?? fallback ?? 1;
}

function operatorLabel(kind: OperatorKind): string {
  return kind === 'arrayContainsAny' ? 'arrayContainsAny' : `\`${kind}\``;
}
