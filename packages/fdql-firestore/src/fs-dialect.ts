import type { FdqlProviderDialect } from '@firebase-desk/fdql-core';
import { evaluateFirestoreCall, firestoreValueFunctions } from './fs-dialect/functions.ts';
import { firestoreLanguage } from './fs-dialect/language.ts';
import { resolveFirestoreSetting } from './fs-dialect/settings.ts';
import {
  bindFirestoreSource,
  resolveFirestoreSourceAlias,
  resolveFirestoreSourceExpression,
} from './fs-dialect/sources.ts';
import {
  hasBoundedIdPredicate,
  validateFirestoreAggregate,
  validateFirestoreOrderBy,
  validateFirestoreWhere,
} from './fs-dialect/validation.ts';

export const firestoreProviderDialect: FdqlProviderDialect = {
  aggregateFunctions: new Set(['fs.avg', 'fs.count', 'fs.max', 'fs.min', 'fs.sum']),
  language: firestoreLanguage,
  namespace: 'fs',
  sourceFunctions: new Set(['collection', 'collectionGroup', 'db', 'project', 'subcollection']),
  valueFunctions: firestoreValueFunctions,
  evaluateCall(input) {
    return evaluateFirestoreCall(input);
  },
  hasBoundedPredicate: hasBoundedIdPredicate,
  bindSource(input) {
    return bindFirestoreSource(input);
  },
  resolveSourceAlias(input) {
    return resolveFirestoreSourceAlias(input);
  },
  resolveSourceExpression(input) {
    return resolveFirestoreSourceExpression(input);
  },
  resolveSetting(input) {
    return resolveFirestoreSetting(input);
  },
  validateOrderBy(input) {
    validateFirestoreOrderBy(input);
  },
  validateAggregate(input) {
    validateFirestoreAggregate(input);
  },
  validateWhere(input) {
    validateFirestoreWhere(input);
  },
};
