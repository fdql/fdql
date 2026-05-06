import { expect, type Page, test } from '@playwright/test';
import { replaceMonacoEditorValue } from '../fixtures/editor.ts';
import { addLocalEmulatorAccount, openFdql, openLiveApp } from '../fixtures/live-app.ts';

test('FDQL runs bounded reads and reports duplicate singleton clauses', async () => {
  const live = await openLiveApp();
  try {
    const page = live.page;
    await addLocalEmulatorAccount(page);
    await openFdql(page);

    await test.step('bounded read shows only returned fields', async () => {
      await runFdql(
        page,
        `alias $orders = fs.collection("orders", [])

from $orders as o
fs order by o.total desc
fs limit 1

return fs.id(o) as id`,
      );

      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader', { name: 'id' })).toBeVisible();
      await expect(table.getByRole('columnheader', { name: 'status' })).toHaveCount(0);
      await expect(table.getByRole('columnheader', { name: 'total' })).toHaveCount(0);
      await expect(table.locator('tbody tr')).toHaveCount(1);
      await expect(table.getByRole('cell', { name: 'ord_1123' })).toBeVisible();
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('1 reads')).toBeVisible();
      await expect(page.getByText('1 scanned')).toBeVisible();
    });

    await test.step('field projection shows exact result cells', async () => {
      await runFdql(
        page,
        `set readBudget = 5000

alias $versions = fs.collection("public-versions", ["version"])

from $versions as v
fs where fs.id(v) = "version"

return fs.id(v) as id, v.version`,
      );

      const table = page.getByRole('table');
      await expect(table.locator('thead th')).toHaveText(['id', 'version']);
      await expect(table.locator('tbody tr')).toHaveCount(1);
      await expect(table.locator('tbody td')).toHaveText(['version', '3166']);
      await expect(table.getByRole('columnheader', { name: 'platform' })).toHaveCount(0);
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('1 reads')).toBeVisible();
      await expect(page.getByText('1 scanned')).toBeVisible();
    });

    await test.step('duplicate fs limit is an issue and clears stale rows', async () => {
      await runFdql(
        page,
        `alias $orders = fs.collection("orders")

from $orders as o
fs limit 1
fs limit 1

return fs.id(o) as id`,
      );

      await page.getByRole('tab', { name: /Issues/ }).click();
      await expect(page.getByText('FDQL_DUPLICATE_STAGE')).toBeVisible();
      await page.getByRole('tab', { name: /Results/ }).click();
      await expect(page.getByText('No rows yet')).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    });
  } finally {
    await live.close();
  }
});

async function runFdql(page: Page, source: string): Promise<void> {
  await replaceMonacoEditorValue(page, page.locator('body'), source);
  await page.getByRole('button', { name: 'Run' }).click();
}
