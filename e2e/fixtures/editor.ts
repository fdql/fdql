import { expect, type Locator, type Page } from '@playwright/test';

type MonacoModelGlobal = {
  readonly monaco?: {
    readonly editor?: {
      getModelMarkers?: (input: Record<string, never>) => Array<{
        readonly message: string;
        readonly severity: number;
        readonly source?: string;
      }>;
      readonly getModels?: () => Array<{
        getValue: () => string;
        setValue: (value: string) => void;
      }>;
    };
  };
};

const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

export async function replaceMonacoEditorValue(
  page: Page,
  scope: Locator,
  value: string,
): Promise<void> {
  const editor = scope.locator('.monaco-editor').last();
  await expect(editor).toBeVisible();
  const modelWasUpdated = await setMonacoModelValue(page, value);
  if (modelWasUpdated) return;

  await editor.click();
  await page.keyboard.press(SELECT_ALL_SHORTCUT);
  await page.keyboard.insertText(value);
  const visibleProbe = firstVisibleProbe(value);
  if (visibleProbe) await expect(editor).toContainText(visibleProbe);
}

export async function typeMonacoEditorValue(
  page: Page,
  scope: Locator,
  value: string,
): Promise<void> {
  const editor = scope.locator('.monaco-editor').last();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press(SELECT_ALL_SHORTCUT);
  await page.keyboard.insertText(value);
  const visibleProbe = firstVisibleProbe(value);
  if (visibleProbe) await expect(editor).toContainText(visibleProbe);
}

export async function monacoModelMarkers(
  page: Page,
): Promise<
  readonly { readonly message: string; readonly severity: number; readonly source: string; }[]
> {
  return await page.evaluate(() => {
    const monaco = (globalThis as MonacoModelGlobal).monaco;
    return monaco?.editor?.getModelMarkers?.({})?.map((marker) => ({
      message: marker.message,
      severity: marker.severity,
      source: marker.source ?? '',
    })) ?? [];
  });
}

async function setMonacoModelValue(page: Page, value: string): Promise<boolean> {
  return await page.evaluate((nextValue) => {
    const models = (globalThis as MonacoModelGlobal).monaco?.editor?.getModels?.() ?? [];
    const model = models[models.length - 1];
    if (!model) return false;
    model.setValue(nextValue);
    return model.getValue() === nextValue;
  }, value);
}

function firstVisibleProbe(value: string): string | null {
  return value.match(/[A-Za-z0-9_-]{4,}/)?.[0] ?? null;
}
