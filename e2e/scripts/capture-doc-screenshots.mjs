import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const desktopDir = resolve(repoRoot, 'apps/desktop');
const mainEntry = resolve(desktopDir, '.build/out/main/index.js');
const outputDir = resolve(repoRoot, 'apps/docs/public/screenshots');

await mkdir(outputDir, { recursive: true });

const userDataDir = await mkdtemp(resolve(tmpdir(), 'firebase-desk-docs-'));
const app = await electron.launch({
  args: [mainEntry, '--data-mode=mock'],
  cwd: desktopDir,
  env: {
    ...process.env,
    FIREBASE_DESK_USER_DATA_DIR: userDataDir,
  },
});

try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 920 });

  await expect(page.getByRole('dialog', { name: 'Try Firebase Desk in mock mode' }))
    .toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: resolve(outputDir, 'first-run.png'), fullPage: true });

  await page.getByRole('button', { name: 'Keep mock mode' }).click();
  await expect(page.getByRole('dialog', { name: 'Try Firebase Desk in mock mode' })).toBeHidden();

  await captureAddAccount(page);

  await openMockWorkspace(page);
  await page.screenshot({ path: resolve(outputDir, 'workspace.png'), fullPage: true });
  await captureCommandPalette(page);
  await captureFirestoreTree(page);
  await captureDocumentEdit(page);
  await captureCollectionJob(page);
  await captureJobs(page);
  await captureActivity(page);

  await openAuthSurface(page);
  await page.screenshot({ path: resolve(outputDir, 'auth.png'), fullPage: true });

  await openJsQuerySurface(page);
  await page.screenshot({ path: resolve(outputDir, 'js-query.png'), fullPage: true });

  await captureSettings(page);
} finally {
  await app.close();
  await rm(userDataDir, { force: true, recursive: true });
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function openMockWorkspace(page) {
  await page.getByRole('treeitem', { name: /Local Emulator/ }).click();
  await expect(page.getByRole('treeitem', { name: /Firestore/ })).toBeVisible();
  await page.getByRole('treeitem', { name: /Firestore/ }).click();
  await expect(page.getByRole('treeitem', { name: /orders/ })).toBeVisible();
  await page.getByRole('treeitem', { name: /^orders/ }).click();
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('ord_1024')).toBeVisible({ timeout: 20_000 });
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function openAuthSurface(page) {
  await page.getByRole('treeitem', { name: /Authentication/ }).click();
  await expect(page.getByLabel('Filter users')).toBeVisible();
  await expect(page.getByRole('gridcell', { name: 'Ada Lovelace' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('gridcell', { name: 'Ada Lovelace' }).click();
  await expect(page.getByText('User detail')).toBeVisible();
  await expect(page.getByRole('gridcell', { name: 'ada@example.com' })).toBeVisible();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function captureAddAccount(page) {
  await page.getByRole('button', { name: 'Add account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Firebase Account' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Local emulator' }).click();
  await dialog.screenshot({ path: resolve(outputDir, 'add-account.png') });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function captureCommandPalette(page) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: resolve(outputDir, 'command-palette.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function captureFirestoreTree(page) {
  const results = page.locator('section[aria-label="Results"]');
  await results.getByRole('tab', { name: 'Tree' }).click();
  await expect(results.getByText('Fields').first()).toBeVisible();
  await page.screenshot({ path: resolve(outputDir, 'firestore-tree.png'), fullPage: true });
  await results.getByRole('tab', { name: 'Table' }).click();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function captureDocumentEdit(page) {
  await page.getByRole('gridcell', { name: 'ord_1024' }).click();
  await page.getByRole('button', { name: 'Edit document' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit document JSON' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toBeHidden({ timeout: 20_000 });
  await expect(dialog.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
  await dialog.screenshot({ path: resolve(outputDir, 'document-edit.png') });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function captureCollectionJob(page) {
  const results = page.locator('section[aria-label="Results"]');
  await results.getByRole('button', { name: 'Jobs' }).click();
  await page.getByRole('menuitem', { name: 'Copy collection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Collection job' });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: resolve(outputDir, 'collection-job.png') });
  await dialog.getByLabel('Target collection path').fill('orders_docs_screenshot_copy');
  await dialog.getByRole('button', { name: 'Start job' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function captureJobs(page) {
  const drawer = page.locator('section[aria-label="Jobs"]');
  if (!(await drawer.count())) {
    await page.locator('footer').getByRole('button', { name: /Jobs/ }).click({ force: true });
  }
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Copy collection').first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: resolve(outputDir, 'jobs.png'), fullPage: true });
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function captureActivity(page) {
  const drawer = page.locator('section[aria-label="Activity"]');
  if (!(await drawer.count())) {
    await page.locator('footer').getByRole('button', { name: /Activity/ }).click({ force: true });
  }
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Run query').first()).toBeVisible({ timeout: 20_000 });
  await drawer.getByText('Run query').first().click();
  await expect(drawer.getByText('Metadata').first()).toBeVisible();
  await page.screenshot({ path: resolve(outputDir, 'activity.png'), fullPage: true });
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function openJsQuerySurface(page) {
  await page.getByRole('treeitem', { name: /JavaScript Query/ }).click();
  await expect(page.getByText('JavaScript Query').first()).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText('yield DocumentSnapshot')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('yield QuerySnapshot')).toBeVisible();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function captureSettings(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Appearance')).toBeVisible();
  await dialog.screenshot({ path: resolve(outputDir, 'settings.png') });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
}
