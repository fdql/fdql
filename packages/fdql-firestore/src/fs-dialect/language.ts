import type { FdqlProviderLanguageMetadata } from '@firebase-desk/fdql-core';

export const firestoreLanguage: FdqlProviderLanguageMetadata = {
  aggregateFunctions: [
    {
      detail: 'Firestore count aggregate',
      insertText: 'fs.count()',
      name: 'fs.count',
    },
    {
      detail: 'Firestore sum aggregate',
      insertText: 'fs.sum(${1:field})',
      name: 'fs.sum',
    },
    {
      detail: 'Firestore average aggregate',
      insertText: 'fs.avg(${1:field})',
      name: 'fs.avg',
    },
    {
      detail: 'Firestore minimum by ordered read',
      insertText: 'fs.min(${1:field})',
      name: 'fs.min',
    },
    {
      detail: 'Firestore maximum by ordered read',
      insertText: 'fs.max(${1:field})',
      name: 'fs.max',
    },
  ],
  clauses: [
    {
      detail: 'Firestore provider filter',
      insertText: 'fs where ${1:field} = ${2:value}',
      keyword: 'where',
      label: 'fs where',
    },
    {
      detail: 'Firestore provider ordering',
      insertText: 'fs order by ${1:field} ${2|asc,desc|}',
      keyword: 'order by',
      label: 'fs order by',
    },
    {
      detail: 'Firestore provider limit',
      insertText: 'fs limit ${1:25}',
      keyword: 'limit',
      label: 'fs limit',
    },
  ],
  settings: [
    {
      detail: 'Default Firestore project id',
      insertText: 'set fs.projectId = "${1:project-id}"',
      name: 'fs.projectId',
    },
    {
      detail: 'Default Firestore database id',
      insertText: 'set fs.databaseId = "${1:database-id}"',
      name: 'fs.databaseId',
    },
  ],
  sourceFunctions: [
    {
      detail: 'Firestore collection source',
      insertText: 'fs.collection("${1:collection}")',
      name: 'fs.collection',
    },
    {
      detail: 'Firestore collection group source',
      insertText: 'fs.collectionGroup("${1:collectionId}")',
      name: 'fs.collectionGroup',
    },
    {
      detail: 'Firestore subcollection source',
      insertText: 'fs.subcollection("${1:parentPath}", "${2:collection}", ${3:["field"]})',
      name: 'fs.subcollection',
    },
    {
      detail: 'Firestore project selector',
      insertText: 'fs.project("${1:project-id}")',
      name: 'fs.project',
    },
    {
      detail: 'Firestore database selector',
      insertText: 'fs.db("${1:database-id}")',
      name: 'fs.db',
    },
  ],
  valueFunctions: [
    {
      detail: 'Document id for a Firestore row',
      insertText: 'fs.id(${1:row})',
      name: 'fs.id',
    },
    {
      detail: 'Document path for a Firestore row',
      insertText: 'fs.path(${1:row})',
      name: 'fs.path',
    },
    {
      detail: 'Project id for a Firestore row',
      insertText: 'fs.projectId(${1:row})',
      name: 'fs.projectId',
    },
    {
      detail: 'Database id for a Firestore row',
      insertText: 'fs.databaseId(${1:row})',
      name: 'fs.databaseId',
    },
    {
      detail: 'Parent path for a Firestore row',
      insertText: 'fs.parentPath(${1:row})',
      name: 'fs.parentPath',
    },
    {
      detail: 'Firestore document reference value',
      insertText: 'fs.ref(${1:rowOrPath})',
      name: 'fs.ref',
    },
    {
      detail: 'Firestore field path with explicit segments',
      insertText: 'fs.fieldPath("${1:field}")',
      name: 'fs.fieldPath',
    },
    {
      detail: 'Firestore array-contains predicate',
      insertText: 'fs.arrayContains(${1:field}, ${2:value})',
      name: 'fs.arrayContains',
    },
    {
      detail: 'Firestore array-contains-any predicate',
      insertText: 'fs.arrayContainsAny(${1:field}, ${2:values})',
      name: 'fs.arrayContainsAny',
    },
  ],
};
