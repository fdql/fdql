import { expect, test } from '@playwright/test';
import {
  addLocalEmulatorAccount,
  EMULATOR_ACCOUNT_NAME,
  expandEmulatorAccount,
  FIRESTORE_TREE_ITEM_LABEL,
  openLiveApp,
} from '../fixtures/live-app.ts';

test('desktop boots live and local emulator account can be added', async () => {
  const live = await openLiveApp();
  try {
    await addLocalEmulatorAccount(live.page);
    await expandEmulatorAccount(live.page);

    const tree = live.page.getByRole('tree', { name: 'Account tree' });
    await expect(tree.getByRole('treeitem', { name: new RegExp(EMULATOR_ACCOUNT_NAME) }))
      .toBeVisible();
    await expect(tree.getByText(FIRESTORE_TREE_ITEM_LABEL, { exact: true })).toBeVisible();
    await expect(tree.getByRole('treeitem', { name: /Authentication/ })).toBeVisible();
    await expect(tree.getByRole('treeitem', { name: /JavaScript Query/ })).toBeVisible();
  } finally {
    await live.close();
  }
});
