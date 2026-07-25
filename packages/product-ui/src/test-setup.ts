import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

class TestResizeObserver implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, 'ResizeObserver', { value: TestResizeObserver });
}

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? function scrollIntoView() {};

if (!document.queryCommandSupported) {
  Object.defineProperty(document, 'queryCommandSupported', {
    configurable: true,
    value: () => false,
  });
}

vi.mock('monaco-editor/editor/editor.api.js', () => ({
  editor: {},
  languages: {},
}));
vi.mock('monaco-editor/editor/contrib/suggest/browser/suggestController.js', () => ({}));
vi.mock('monaco-editor/languages/definitions/javascript/register.js', () => ({}));
vi.mock('monaco-editor/languages/definitions/typescript/register.js', () => ({}));
vi.mock('monaco-editor/language/json/monaco.contribution.js', () => ({}));
vi.mock('monaco-editor/language/typescript/monaco.contribution.js', () => ({
  javascriptDefaults: { addExtraLib: () => ({ dispose: () => {} }) },
  typescriptDefaults: { addExtraLib: () => ({ dispose: () => {} }) },
}));

afterEach(() => {
  cleanup();
});
