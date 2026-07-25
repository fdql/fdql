import type { FdqlProviderDialect } from '@firebase-desk/fdql-core';
import { evaluateFirestoreCall, firestoreValueFunctions } from './fs-dialect/functions.ts';
import { firestoreLanguage } from './fs-dialect/language.ts';
import { validateFirestoreQueryConstraints } from './fs-dialect/query-constraints.ts';
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
  evaluateCall: evaluateFirestoreCall,
  hasBoundedPredicate: hasBoundedIdPredicate,
  bindSource: bindFirestoreSource,
  resolveSourceAlias: resolveFirestoreSourceAlias,
  resolveSourceExpression: resolveFirestoreSourceExpression,
  resolveSetting: resolveFirestoreSetting,
  validateOrderBy: validateFirestoreOrderBy,
  validateAggregate: validateFirestoreAggregate,
  validateWhere: validateFirestoreWhere,
  validateQuery: validateFirestoreQueryConstraints,
};
