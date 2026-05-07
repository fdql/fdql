import { expect, type Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { replaceMonacoEditorValue } from '../fixtures/editor.ts';
import {
  deleteFirestoreEmulatorDocument,
  getFirestoreEmulatorDocument,
  listFirestoreEmulatorCollection,
  setFirestoreEmulatorDocument,
} from '../fixtures/firestore-rest.ts';
import {
  addLocalEmulatorAccount,
  openAuthentication,
  openFirestore,
  openLiveApp,
  uniqueSmokeId,
} from '../fixtures/live-app.ts';

test('Firestore query, create, edit, conflict, and delete flows use emulator UI', async () => {
  const live = await openLiveApp({
    activityExportFileName: 'activity-export.jsonl',
    jobExportFileName: 'jobs-export.jsonl',
    jobImportFileName: 'jobs-export.jsonl',
  });
  try {
    const page = live.page;
    const activityExportPath = join(live.userDataDir, 'activity-export.jsonl');
    const jobsExportPath = join(live.userDataDir, 'jobs-export.jsonl');
    const suffix = uniqueSmokeId('ui');
    await addLocalEmulatorAccount(page);
    await openFirestore(page);

    await test.step('query seeded orders', async () => {
      await expectFirestoreRoots(page);
      await querySeededOrders(page);
    });

    await test.step('same collection tabs keep independent query results', async () => {
      await querySameCollectionInTwoTabs(page);
    });

    await test.step('create first document for a new collection from sidebar', async () => {
      await createCollectionFromSidebar(page, suffix);
    });

    await test.step('create and edit document through UI', async () => {
      await createAndEditDocument(page, suffix);
    });

    await test.step('field patch writes preserve concurrent fields and delete fields', async () => {
      await fieldPatchWrites(page, suffix);
    });

    await test.step('resolve save conflict through UI', async () => {
      await resolveConflict(page, suffix);
    });

    await test.step('delete document with selected subcollection through UI', async () => {
      await deleteWithSelectedSubcollection(page, suffix);
    });

    await test.step('collection jobs export, import, duplicate, and delete through emulator UI', async () => {
      await collectionJobs(page, suffix, jobsExportPath);
    });

    await test.step('activity trail records UI actions and exports detail mode', async () => {
      await verifyActivityTrail(page, suffix, activityExportPath);
    });
  } finally {
    await live.close();
  }
});

async function expectFirestoreRoots(page: Page): Promise<void> {
  const tree = page.getByRole('tree', { name: 'Account tree' });
  await expect(tree.getByRole('treeitem', { name: /orders/ })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: /customers/ })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: /featureFlags/ })).toBeVisible();
  await expect(tree.getByText('ord_1024')).toHaveCount(0);
}

async function querySeededOrders(page: Page): Promise<void> {
  const tree = page.getByRole('tree', { name: 'Account tree' });
  await tree.getByRole('treeitem', { name: /orders/ }).click();
  await expect(page.getByLabel('Query path')).toHaveValue('orders');

  await clearFiltersAndSort(page);
  await page.getByLabel('Result limit').fill('2');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('Document ID')).toBeVisible();
  await expect(page.getByText('ord_1024')).toBeVisible();
  await expect(page.getByText('ord_1025')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();

  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText('ord_1026')).toBeVisible();

  await ensureFilterRow(page);
  await queryField(page, 'Filter 1 field').fill('status');
  await page.getByLabel('Filter 1 value').fill('paid');
  await page.getByLabel('Result limit').fill('3');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('ord_1024')).toBeVisible();
  await expect(page.getByText('ord_1027')).toBeVisible();

  await page.getByRole('tab', { name: 'JSON' }).click();
  await expect(page.getByLabel('JSON results')).toHaveValue(/orders\/ord_1024\/events/);
  await page.getByRole('tab', { name: 'Table' }).click();
  await expect(page.getByRole('button', { name: /events/ }).first()).toBeVisible();

  await page.getByLabel('Query path').fill('orders/ord_1024/events');
  await clearFiltersAndSort(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('evt_created')).toBeVisible();
  await expect(page.getByText('evt_paid')).toBeVisible();

  await page.getByLabel('Query path').fill('orders/ord_1024');
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByRole('tab', { name: 'JSON' }).click();
  await expect(page.getByLabel('JSON results')).toHaveValue(/"path": "orders\/ord_1024"/);
  await expect(page.getByLabel('JSON results')).toHaveValue(/Ada Lovelace/);
  await page.getByRole('tab', { name: 'Table' }).click();

  await page.getByLabel('Query path').fill('orders');
  await page.getByLabel('Result limit').fill('1');
  await clearFiltersAndSort(page);
  await queryField(page, 'Sort field').fill('total');
  await page.getByLabel('Sort direction').selectOption('desc');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('ord_1123')).toBeVisible();
}

async function querySameCollectionInTwoTabs(page: Page): Promise<void> {
  const tree = page.getByRole('tree', { name: 'Account tree' });
  const workspaceTabs = page.locator('[role="tablist"]').first();

  await page.getByLabel('Query path').fill('orders');
  await page.getByLabel('Result limit').fill('1');
  await clearFiltersAndSort(page);
  await queryField(page, 'Sort field').fill('total');
  await page.getByLabel('Sort direction').selectOption('desc');
  await page.getByRole('button', { name: 'Run' }).click();
  await expectResultDocumentId(page, 'ord_1123');

  await tree.getByRole('treeitem', { name: /orders/ }).dblclick();
  await expect(workspaceTabs.getByRole('tab', { name: /orders/ })).toHaveCount(2);
  await page.getByLabel('Query path').fill('orders');
  await page.getByLabel('Result limit').fill('2');
  await clearFiltersAndSort(page);
  await ensureFilterRow(page);
  await queryField(page, 'Filter 1 field').fill('status');
  await page.getByLabel('Filter 1 value').fill('paid');
  await page.getByRole('button', { name: 'Run' }).click();
  await expectResultDocumentId(page, 'ord_1024');

  await workspaceTabs.getByRole('tab', { name: /orders/ }).first().click();
  await expectResultDocumentId(page, 'ord_1123');
  await expect(resultDocumentIdCell(page, 'ord_1024')).toHaveCount(0);

  await workspaceTabs.getByRole('tab', { name: /orders/ }).nth(1).click();
  await expectResultDocumentId(page, 'ord_1024');

  await resultsPanel(page).getByRole('tab', { name: 'Tree' }).click();
  await expectResultView(page, 'Tree');

  await workspaceTabs.getByRole('tab', { name: /orders/ }).first().click();
  await expectResultView(page, 'Table');

  await workspaceTabs.getByRole('tab', { name: /orders/ }).nth(1).click();
  await expectResultView(page, 'Tree');
  await resultsPanel(page).getByRole('tab', { name: 'Table' }).click();

  await selectDocument(page, 'ord_1024');
  await openFieldEdit(page, 'customer', 'Edit string');
  const editDialog = page.getByRole('dialog', { name: 'Edit customer' });
  await editDialog.getByLabel('Field string value').fill('Ada Lovelace updated in tab');
  await editDialog.getByRole('button', { name: 'Save' }).click();
  await expectDialogHidden(editDialog, 'Scoped results changed field dialog stayed open');
  await expect(resultsChangedBanner(page)).toBeVisible();

  await workspaceTabs.getByRole('tab', { name: /orders/ }).first().click();
  await expect(resultsChangedBanner(page)).toHaveCount(0);

  await workspaceTabs.getByRole('tab', { name: /orders/ }).nth(1).click();
  await expect(resultsChangedBanner(page)).toBeVisible();

  await openAuthentication(page);
  await expect(workspaceTabs.getByRole('tab', { name: /Auth/ })).toBeVisible();
  await expect(resultsChangedBanner(page)).toHaveCount(0);

  await workspaceTabs.getByRole('tab', { name: /orders/ }).nth(1).click();
  await expect(resultsChangedBanner(page)).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(resultsChangedBanner(page)).toHaveCount(0);
}

async function createCollectionFromSidebar(page: Page, suffix: string): Promise<void> {
  const collectionPath = `smokeUiSidebarCollections_${suffix}`;
  const documentId = `first-${suffix}`;
  const path = `${collectionPath}/${documentId}`;
  const tree = page.getByRole('tree', { name: 'Account tree' });

  await tree.getByText('Firestore', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New collection' }).click();

  const createDialog = page.getByRole('dialog', { name: 'New collection' });
  await expect(createDialog).toBeVisible();
  await expect(
    createDialog.getByText(/Firestore creates a collection when the first document is written/),
  ).toBeVisible();
  await createDialog.getByLabel('Collection path').fill(collectionPath);
  await createDialog.getByLabel('Document ID').fill(documentId);
  await replaceMonacoEditorValue(
    page,
    createDialog,
    JSON.stringify(
      {
        nested: { ok: true },
        source: 'sidebar-new-collection',
      },
      null,
      2,
    ),
  );
  await expect(createDialog.getByRole('button', { name: 'Create' })).toBeEnabled();
  await createDialog.getByRole('button', { name: 'Create' }).click();
  await expectDialogHidden(createDialog, 'New collection dialog stayed open');

  const created = await getFirestoreEmulatorDocument(path);
  expect(created?.fields).toMatchObject({
    nested: { mapValue: { fields: { ok: { booleanValue: true } } } },
    source: { stringValue: 'sidebar-new-collection' },
  });

  await runCollectionQuery(page, collectionPath);
  await expectResultDocumentId(page, documentId);
}

async function createAndEditDocument(page: Page, suffix: string): Promise<void> {
  const documentId = `created-${suffix}`;
  const path = `smokeUiCreates/${documentId}`;
  const createdAt = new Date().toISOString();

  await runCollectionQuery(page, 'smokeUiCreates');
  await page.getByRole('button', { name: 'New document' }).click();
  const createDialog = page.getByRole('dialog', { name: 'New document' });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel('Document ID').fill(documentId);
  await replaceMonacoEditorValue(
    page,
    createDialog,
    JSON.stringify(
      {
        count: 1,
        createdAt: { __type__: 'timestamp', value: createdAt },
        location: { __type__: 'geoPoint', latitude: -36.8485, longitude: 174.7633 },
        source: 'ui-create',
        status: 'draft',
      },
      null,
      2,
    ),
  );
  await expect(createDialog.getByRole('button', { name: 'Create' })).toBeEnabled();
  await createDialog.getByRole('button', { name: 'Create' }).click();
  await expectDialogHidden(createDialog, 'Create dialog stayed open');
  await refreshChangedResults(page);
  await expectResultDocumentId(page, documentId);

  const created = await getFirestoreEmulatorDocument(path);
  expect(created?.fields).toMatchObject({
    count: { integerValue: '1' },
    createdAt: { timestampValue: createdAt },
    location: { geoPointValue: { latitude: -36.8485, longitude: 174.7633 } },
    source: { stringValue: 'ui-create' },
    status: { stringValue: 'draft' },
  });

  await selectDocument(page, documentId);
  await page.getByRole('button', { name: 'Edit document' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit document JSON' });
  await expect(editDialog).toBeVisible();
  await replaceMonacoEditorValue(
    page,
    editDialog,
    JSON.stringify(
      {
        count: 2,
        createdAt: { __type__: 'timestamp', value: createdAt },
        source: 'ui-edit',
        status: 'edited',
      },
      null,
      2,
    ),
  );
  await editDialog.getByRole('button', { name: 'Save' }).click();
  await expectDialogHidden(editDialog, 'Edit dialog stayed open');
  await refreshChangedResults(page);
  await expect(page.getByText('edited').first()).toBeVisible();

  const edited = await getFirestoreEmulatorDocument(path);
  expect(edited?.fields).toMatchObject({
    count: { integerValue: '2' },
    createdAt: { timestampValue: createdAt },
    source: { stringValue: 'ui-edit' },
    status: { stringValue: 'edited' },
  });
}

async function fieldPatchWrites(page: Page, suffix: string): Promise<void> {
  const documentId = `patch-${suffix}`;
  const path = `smokeUiPatches/${documentId}`;
  await setFirestoreEmulatorDocument(path, {
    remote: 'base',
    removable: 'present',
    status: 'base',
  });

  await runCollectionQuery(page, 'smokeUiPatches');
  await selectDocument(page, documentId);
  await setFirestoreEmulatorDocument(path, {
    remote: 'outside',
    removable: 'present',
    status: 'base',
  });

  await openFieldEdit(page, 'status', 'Edit string');
  const statusDialog = page.getByRole('dialog', { name: 'Edit status' });
  await statusDialog.getByLabel('Field string value').fill('patched');
  await statusDialog.getByRole('button', { name: 'Save' }).click();
  await expectDialogHidden(statusDialog, 'Field patch dialog stayed open');
  await expect(page.getByText(/Document changed elsewhere/)).toBeVisible();
  await refreshChangedResults(page);

  let patched = await getFirestoreEmulatorDocument(path);
  expect(patched?.fields).toMatchObject({
    remote: { stringValue: 'outside' },
    removable: { stringValue: 'present' },
    status: { stringValue: 'patched' },
  });

  await selectDocument(page, documentId);
  await openFieldEdit(page, 'status', 'Edit string');
  const conflictFieldDialog = page.getByRole('dialog', { name: 'Edit status' });
  await setFirestoreEmulatorDocument(path, {
    remote: 'outside',
    removable: 'present',
    status: 'remote-conflict',
  });
  await conflictFieldDialog.getByLabel('Field string value').fill('local-conflict');
  await conflictFieldDialog.getByRole('button', { name: 'Save' }).click();

  const conflictDialog = page.getByRole('dialog', { name: 'Resolve save conflict' });
  await expect(conflictDialog).toBeVisible();
  await replaceMonacoEditorValue(
    page,
    conflictDialog,
    JSON.stringify(
      {
        conflictResolved: true,
        remote: 'outside',
        removable: 'present',
        status: 'merged-conflict',
      },
      null,
      2,
    ),
  );
  await conflictDialog.getByRole('button', { name: 'Save merged' }).click();
  await expectDialogHidden(conflictDialog, 'Field conflict dialog stayed open');
  await refreshChangedResults(page);

  patched = await getFirestoreEmulatorDocument(path);
  expect(patched?.fields).toMatchObject({
    conflictResolved: { booleanValue: true },
    remote: { stringValue: 'outside' },
    removable: { stringValue: 'present' },
    status: { stringValue: 'merged-conflict' },
  });

  await selectDocument(page, documentId);
  await openFieldMenu(page, 'removable', 'Delete field');
  const deleteDialog = page.getByRole('dialog', { name: 'Delete field' });
  await deleteDialog.getByRole('button', { name: 'Delete' }).click();
  await expectDialogHidden(deleteDialog, 'Delete field dialog stayed open');

  await expect.poll(async () => (await getFirestoreEmulatorDocument(path))?.fields?.['removable'])
    .toBeUndefined();
  patched = await getFirestoreEmulatorDocument(path);
  expect(patched?.fields).toMatchObject({
    conflictResolved: { booleanValue: true },
    remote: { stringValue: 'outside' },
    status: { stringValue: 'merged-conflict' },
  });
}

async function resolveConflict(page: Page, suffix: string): Promise<void> {
  const documentId = `conflict-${suffix}`;
  const path = `smokeUiConflicts/${documentId}`;
  const deliveredAt = new Date(Date.now() + 1).toISOString();
  await setFirestoreEmulatorDocument(path, {
    deliveredAt: { __type__: 'timestamp', value: deliveredAt },
    title: 'base',
  });

  await runCollectionQuery(page, 'smokeUiConflicts');
  await selectDocument(page, documentId);
  await page.getByRole('button', { name: 'Edit document' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit document JSON' });
  await expect(editDialog).toBeVisible();

  await setFirestoreEmulatorDocument(path, {
    deliveredAt: { __type__: 'timestamp', value: deliveredAt },
    remoteOnly: true,
    title: 'remote',
  });
  await replaceMonacoEditorValue(
    page,
    editDialog,
    JSON.stringify(
      {
        deliveredAt: { __type__: 'timestamp', value: deliveredAt },
        localOnly: true,
        title: 'local',
      },
      null,
      2,
    ),
  );
  await editDialog.getByRole('button', { name: 'Save' }).click();

  const conflictDialog = page.getByRole('dialog', { name: 'Resolve save conflict' });
  await expect(conflictDialog).toBeVisible();
  await expect(conflictDialog.getByText('Remote document changed.')).toBeVisible();
  await expect(conflictDialog.getByRole('button', { name: 'Discard my changes' })).toBeVisible();
  await expect(conflictDialog.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  await replaceMonacoEditorValue(
    page,
    conflictDialog,
    JSON.stringify(
      {
        deliveredAt: { __type__: 'timestamp', value: deliveredAt },
        localMerged: true,
        remoteOnly: true,
        title: 'merged',
      },
      null,
      2,
    ),
  );
  await conflictDialog.getByRole('button', { name: 'Save merged' }).click();
  await expectDialogHidden(conflictDialog, 'Conflict dialog stayed open');

  const merged = await getFirestoreEmulatorDocument(path);
  expect(merged?.fields).toMatchObject({
    deliveredAt: { timestampValue: deliveredAt },
    localMerged: { booleanValue: true },
    remoteOnly: { booleanValue: true },
    title: { stringValue: 'merged' },
  });
}

async function deleteWithSelectedSubcollection(page: Page, suffix: string): Promise<void> {
  const documentId = `delete-${suffix}`;
  const path = `smokeUiDeletes/${documentId}`;
  const deletedChildPath = `${path}/events/deleted`;
  const keptChildPath = `${path}/keep/kept`;
  await setFirestoreEmulatorDocument(path, { type: 'parent' });
  await setFirestoreEmulatorDocument(deletedChildPath, { type: 'deleted' });
  await setFirestoreEmulatorDocument(keptChildPath, { type: 'kept' });

  await runCollectionQuery(page, 'smokeUiDeletes');
  await selectDocument(page, documentId);
  await expect(page.getByRole('button', { name: /events/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Delete document' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete document' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Delete subcollection events/ }).check();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expectDialogHidden(dialog, 'Delete dialog stayed open');

  expect(await getFirestoreEmulatorDocument(path)).toBeNull();
  expect(await getFirestoreEmulatorDocument(deletedChildPath)).toBeNull();
  expect(await getFirestoreEmulatorDocument(keptChildPath)).toMatchObject({
    fields: { type: { stringValue: 'kept' } },
  });

  await deleteFirestoreEmulatorDocument(keptChildPath);
}

async function collectionJobs(page: Page, suffix: string, exportPath: string): Promise<void> {
  const sourceCollection = `smokeJobsSource_${suffix}`;
  const sourceDocumentId = `source-${suffix}`;
  const sourcePath = `${sourceCollection}/${sourceDocumentId}`;
  const importedCollection = `smokeJobsImported_${suffix}`;
  const copyCollection = `smokeJobsCopy_${suffix}`;
  const duplicateCollection = `smokeJobsDuplicate_${suffix}`;
  await setFirestoreEmulatorDocument(sourcePath, {
    amount: 42,
    shippedAt: { __type__: 'timestamp', value: '2026-04-29T02:03:04.000Z' },
    source: 'jobs-source',
  });

  await runCollectionQuery(page, sourceCollection);
  await openCollectionJob(page, 'Export collection');
  const exportDialog = page.getByRole('dialog', { name: 'Collection job' });
  await exportDialog.getByRole('button', { name: 'Choose' }).click();
  await expect(exportDialog.getByLabel('Export file path')).toHaveValue(exportPath);
  await exportDialog.getByRole('button', { name: 'Start job' }).click();
  await expectDialogHidden(exportDialog, 'Export job dialog stayed open');
  await expect.poll(async () => readFile(exportPath, 'utf8').catch(() => '')).toContain(
    sourceDocumentId,
  );

  await openCollectionJob(page, 'Import collection');
  const importDialog = page.getByRole('dialog', { name: 'Collection job' });
  await importDialog.getByLabel('Target collection path').fill(importedCollection);
  await importDialog.getByRole('button', { name: 'Choose' }).click();
  await expect(importDialog.getByLabel('Import file path')).toHaveValue(exportPath);
  await importDialog.getByRole('button', { name: 'Start job' }).click();
  await expectDialogHidden(importDialog, 'Import job dialog stayed open');
  await expect.poll(async () =>
    await getFirestoreEmulatorDocument(
      `${importedCollection}/${sourceDocumentId}`,
    )
  ).toMatchObject({
    fields: {
      amount: { integerValue: '42' },
      shippedAt: { timestampValue: '2026-04-29T02:03:04Z' },
      source: { stringValue: 'jobs-source' },
    },
  });

  await openCollectionJob(page, 'Copy collection');
  const copyDialog = page.getByRole('dialog', { name: 'Collection job' });
  await copyDialog.getByLabel('Target collection path').fill(copyCollection);
  await copyDialog.getByRole('button', { name: 'Start job' }).click();
  await expectDialogHidden(copyDialog, 'Copy job dialog stayed open');
  await expect.poll(async () =>
    await getFirestoreEmulatorDocument(
      `${copyCollection}/${sourceDocumentId}`,
    )
  ).toMatchObject({
    fields: { source: { stringValue: 'jobs-source' } },
  });

  await openCollectionJob(page, 'Duplicate collection');
  const duplicateDialog = page.getByRole('dialog', { name: 'Collection job' });
  await duplicateDialog.getByLabel('Target collection path').fill(duplicateCollection);
  await duplicateDialog.getByRole('button', { name: 'Start job' }).click();
  await expectDialogHidden(duplicateDialog, 'Duplicate job dialog stayed open');
  await expect.poll(async () =>
    await getFirestoreEmulatorDocument(
      `${duplicateCollection}/${sourceDocumentId}`,
    )
  ).toMatchObject({
    fields: { source: { stringValue: 'jobs-source' } },
  });

  const docsOnlyCollection = `smokeJobsDeleteDocsOnly_${suffix}`;
  const docsOnlyParent = `${docsOnlyCollection}/parent`;
  const docsOnlyChild = `${docsOnlyParent}/events/child`;
  await setFirestoreEmulatorDocument(docsOnlyParent, { mode: 'docs-only' });
  await setFirestoreEmulatorDocument(docsOnlyChild, { kept: true });
  await runCollectionQuery(page, docsOnlyCollection);
  await openCollectionJob(page, 'Delete collection');
  const docsOnlyDialog = page.getByRole('dialog', { name: 'Collection job' });
  await expect(docsOnlyDialog.getByText(/Subcollections may remain/)).toBeVisible();
  await docsOnlyDialog.getByRole('button', { name: 'Start job' }).click();
  await expect(docsOnlyDialog.getByText(`Delete collection ${docsOnlyCollection}?`)).toBeVisible();
  await docsOnlyDialog.getByRole('button', { name: 'Delete collection' }).click();
  await expectDialogHidden(docsOnlyDialog, 'Docs-only delete job dialog stayed open');
  await expect.poll(async () => await listFirestoreEmulatorCollection(docsOnlyCollection))
    .toHaveLength(0);
  expect(await getFirestoreEmulatorDocument(docsOnlyChild)).toMatchObject({
    fields: { kept: { booleanValue: true } },
  });

  const recursiveCollection = `smokeJobsDeleteRecursive_${suffix}`;
  const recursiveParent = `${recursiveCollection}/parent`;
  const recursiveChild = `${recursiveParent}/events/child`;
  await setFirestoreEmulatorDocument(recursiveParent, { mode: 'recursive' });
  await setFirestoreEmulatorDocument(recursiveChild, { deleted: true });
  await runCollectionQuery(page, recursiveCollection);
  await openCollectionJob(page, 'Delete collection');
  const recursiveDialog = page.getByRole('dialog', { name: 'Collection job' });
  await recursiveDialog.getByRole('checkbox', { name: 'Include subcollections' }).check();
  await recursiveDialog.getByRole('button', { name: 'Start job' }).click();
  await expect(recursiveDialog.getByText(
    `Delete collection ${recursiveCollection} including subcollections?`,
  )).toBeVisible();
  await recursiveDialog.getByRole('button', { name: 'Delete collection' }).click();
  await expectDialogHidden(recursiveDialog, 'Recursive delete job dialog stayed open');
  await expect.poll(async () => await getFirestoreEmulatorDocument(recursiveParent)).toBeNull();
  await expect.poll(async () => await getFirestoreEmulatorDocument(recursiveChild)).toBeNull();

  await openJobs(page);
  await expect(page.getByRole('region', { name: 'Jobs' }).getByText('Export collection').first())
    .toBeVisible();
  await expect(page.getByRole('region', { name: 'Jobs' }).getByText('Import collection').first())
    .toBeVisible();
  await expect(page.getByRole('region', { name: 'Jobs' }).getByText('Copy collection').first())
    .toBeVisible();
  await expect(page.getByRole('region', { name: 'Jobs' }).getByText('Duplicate collection').first())
    .toBeVisible();
  await expect(page.getByRole('region', { name: 'Jobs' }).getByText('Delete collection').first())
    .toBeVisible();
  await closeJobs(page);
}

async function verifyActivityTrail(
  page: Page,
  suffix: string,
  activityExportPath: string,
): Promise<void> {
  await openActivity(page);
  const activity = page.getByRole('region', { name: 'Activity' });
  await expect(activity.getByText('Create document').first()).toBeVisible();
  await expect(activity.getByText('Update fields').first()).toBeVisible();
  await expect(activity.getByText('Save document').first()).toBeVisible();
  await expect(activity.getByText('Delete document').first()).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await settings.getByLabel('Activity detail').selectOption('fullPayload');
  await expect(settings.getByLabel('Activity detail')).toHaveValue('fullPayload');
  await expect(settings.getByText(/fullPayload, 5 MB/)).toBeVisible();
  await settings.getByRole('button', { name: 'Close dialog' }).click();
  await expect(settings).toBeHidden();
  await closeActivity(page);

  const documentId = `activity-${suffix}`;
  await runCollectionQuery(page, 'smokeUiActivity');
  await page.getByRole('button', { name: 'New document' }).click();
  const createDialog = page.getByRole('dialog', { name: 'New document' });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel('Document ID').fill(documentId);
  await replaceMonacoEditorValue(
    page,
    createDialog,
    JSON.stringify({ source: 'activity-full-payload' }, null, 2),
  );
  await createDialog.getByRole('button', { name: 'Create' }).click();
  await expectDialogHidden(createDialog, 'Activity create dialog stayed open');
  await refreshChangedResults(page);
  await expectResultDocumentId(page, documentId);
  await selectDocument(page, documentId);
  await openFieldEdit(page, 'source', 'Edit string');
  const editDialog = page.getByRole('dialog', { name: 'Edit source' });
  await editDialog.getByLabel('Field string value').fill('activity-patched');
  await editDialog.getByRole('button', { name: 'Save' }).click();
  await expectDialogHidden(editDialog, 'Activity field edit dialog stayed open');
  await refreshChangedResults(page);

  await openActivity(page);
  await activity.getByRole('button', { name: 'Export' }).click();

  await expect.poll(async () => readFile(activityExportPath, 'utf8').catch(() => '')).toContain(
    'activity-full-payload',
  );
  const exported = await readFile(activityExportPath, 'utf8');
  expect(exported).toContain('"payload"');
  expect(exported).toContain('"operations"');
  expect(exported).toContain('activity-patched');
}

async function runCollectionQuery(page: Page, path: string): Promise<void> {
  await page.getByRole('tab', { name: 'Table' }).click();
  await page.getByLabel('Query path').fill(path);
  await page.getByLabel('Result limit').fill('25');
  await clearFiltersAndSort(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('Document ID')).toBeVisible();
}

async function expectResultDocumentId(page: Page, documentId: string): Promise<void> {
  await expect(resultDocumentIdCell(page, documentId)).toBeVisible();
}

async function expectResultView(page: Page, view: 'JSON' | 'Table' | 'Tree'): Promise<void> {
  await expect(resultsPanel(page).getByRole('tab', { name: view })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

function resultsPanel(page: Page) {
  return page.locator('section[aria-label="Results"]');
}

function resultDocumentIdCell(page: Page, documentId: string) {
  return resultsPanel(page).locator(`code[title="${documentId}"]`).first();
}

async function clearFiltersAndSort(page: Page): Promise<void> {
  await queryField(page, 'Sort field').fill('');
  if (await queryField(page, 'Filter 1 field').count()) {
    await queryField(page, 'Filter 1 field').fill('');
    await page.getByLabel('Filter 1 value').fill('');
  }
}

async function ensureFilterRow(page: Page): Promise<void> {
  if (await queryField(page, 'Filter 1 field').count()) return;
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(queryField(page, 'Filter 1 field')).toBeVisible();
}

function queryField(page: Page, name: string) {
  return page.getByRole('combobox', { name });
}

async function selectDocument(page: Page, documentId: string): Promise<void> {
  await resultDocumentIdCell(page, documentId).click();
  await expect(page.getByText(new RegExp(`/${escapeRegExp(documentId)}$`)).first()).toBeVisible();
}

async function openFieldEdit(page: Page, fieldName: string, menuItem: string): Promise<void> {
  await openFieldMenu(page, fieldName, menuItem);
  await expect(page.getByRole('dialog', { name: `Edit ${fieldName}` })).toBeVisible();
}

async function openFieldMenu(page: Page, fieldName: string, menuItem: string): Promise<void> {
  await page.getByRole('treeitem', { name: new RegExp(`\\b${escapeRegExp(fieldName)}\\b`) })
    .last()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: menuItem }).click();
}

async function refreshChangedResults(page: Page): Promise<void> {
  const bannerText = resultsChangedBanner(page);
  await expect(bannerText).toBeVisible();
  await bannerText.locator('xpath=..').getByRole('button', { name: 'Refresh' }).click();
}

async function openCollectionJob(page: Page, menuItem: string): Promise<void> {
  await resultsPanel(page).getByRole('button', { name: 'Jobs' }).click();
  await page.getByRole('menuitem', { name: menuItem }).click();
  await expect(page.getByRole('dialog', { name: 'Collection job' })).toBeVisible();
}

async function openJobs(page: Page): Promise<void> {
  const drawer = page.getByRole('region', { name: 'Jobs' });
  if (await drawer.count()) return;
  await page.locator('footer').getByRole('button', { name: /Jobs/ }).click();
  await expect(drawer).toBeVisible();
}

async function closeJobs(page: Page): Promise<void> {
  const drawer = page.getByRole('region', { name: 'Jobs' });
  if (!(await drawer.count())) return;
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
}

function resultsChangedBanner(page: Page) {
  return resultsPanel(page).getByText('Results changed.');
}

async function openActivity(page: Page): Promise<void> {
  const activity = page.getByRole('region', { name: 'Activity' });
  if (await activity.count()) return;
  await page.locator('footer').getByRole('button', { name: /Activity/ }).click();
  await expect(activity).toBeVisible();
}

async function closeActivity(page: Page): Promise<void> {
  const activity = page.getByRole('region', { name: 'Activity' });
  if (!(await activity.count())) return;
  await activity.getByRole('button', { name: 'Close' }).click();
  await expect(activity).toBeHidden();
}

async function expectDialogHidden(dialog: ReturnType<Page['getByRole']>, message: string) {
  try {
    await expect(dialog).toBeHidden();
  } catch (error) {
    throw new Error(`${message}: ${await dialog.textContent()}`, { cause: error });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
