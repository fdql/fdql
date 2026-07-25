import { type ElectronApplication, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDesktop } from './launch.ts';

export const EMULATOR_ACCOUNT_NAME = 'Local Emulator E2E';
export const EMULATOR_CONNECTION_ID = 'local-emulator-e2e';
export const FIRESTORE_PROJECT_ID = 'demo-local';
export const FIRESTORE_TREE_ITEM_LABEL = 'Firestore';

export interface LiveApp {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly userDataDir: string;
  readonly close: () => Promise<void>;
}

export interface OpenLiveAppOptions {
  readonly activityExportFileName?: string;
  readonly jobExportFileName?: string;
  readonly jobImportFileName?: string;
}

export async function openLiveApp(options: OpenLiveAppOptions = {}): Promise<LiveApp> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'firebase-desk-e2e-'));
  const app = await launchDesktop({
    args: ['--data-mode=live'],
    ...(options.activityExportFileName || options.jobExportFileName || options.jobImportFileName
      ? {
        env: {
          ...(options.activityExportFileName
            ? {
              FIREBASE_DESK_ACTIVITY_EXPORT_PATH: join(
                userDataDir,
                options.activityExportFileName,
              ),
            }
            : {}),
          ...(options.jobExportFileName
            ? { FIREBASE_DESK_JOB_EXPORT_PATH: join(userDataDir, options.jobExportFileName) }
            : {}),
          ...(options.jobImportFileName
            ? { FIREBASE_DESK_JOB_IMPORT_PATH: join(userDataDir, options.jobImportFileName) }
            : {}),
        },
      }
      : {}),
    userDataDir,
  });
  const page = await app.firstWindow();
  await expect(page).toHaveTitle(/Firebase Desk/);
  return {
    app,
    page,
    userDataDir,
    close: async () => {
      await app.close();
      await rm(userDataDir, { force: true, recursive: true });
    },
  };
}

export async function addLocalEmulatorAccount(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Firebase Account' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Local emulator' }).click();
  await dialog.getByLabel('Display name').fill(EMULATOR_ACCOUNT_NAME);
  await dialog.getByRole('button', { name: 'Add account' }).click();
  await expect(dialog).toBeHidden();
}

export async function expandEmulatorAccount(page: Page): Promise<void> {
  const tree = page.getByRole('tree', { name: 'Account tree' });
  const account = tree.getByRole('treeitem', { name: new RegExp(EMULATOR_ACCOUNT_NAME) });
  await expect(account).toBeVisible({ timeout: 15_000 });
  if (await tree.getByText(FIRESTORE_TREE_ITEM_LABEL, { exact: true }).count()) return;
  await account.click();
  await expect(tree.getByText(FIRESTORE_TREE_ITEM_LABEL, { exact: true })).toBeVisible();
}

export async function openFirestore(page: Page): Promise<void> {
  await expandEmulatorAccount(page);
  const tree = page.getByRole('tree', { name: 'Account tree' });
  await expect(tree.getByText(FIRESTORE_TREE_ITEM_LABEL, { exact: true })).toBeVisible();
  await tree.getByText(FIRESTORE_TREE_ITEM_LABEL, { exact: true }).click();
}

export async function openAuthentication(page: Page): Promise<void> {
  await expandEmulatorAccount(page);
  const tree = page.getByRole('tree', { name: 'Account tree' });
  await expect(tree.getByRole('treeitem', { name: /Authentication/ })).toBeVisible();
  await tree.getByRole('treeitem', { name: /Authentication/ }).click();
}

export async function openJavaScriptQuery(page: Page): Promise<void> {
  await expandEmulatorAccount(page);
  const tree = page.getByRole('tree', { name: 'Account tree' });
  await expect(tree.getByRole('treeitem', { name: /JavaScript Query/ })).toBeVisible();
  await tree.getByRole('treeitem', { name: /JavaScript Query/ }).click();
}

export async function openFdql(page: Page): Promise<void> {
  await expandEmulatorAccount(page);
  const tree = page.getByRole('tree', { name: 'Account tree' });
  await expect(tree.getByRole('treeitem', { name: /FDQL/ })).toBeVisible();
  await tree.getByRole('treeitem', { name: /FDQL/ }).click();
}

export function uniqueSmokeId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
