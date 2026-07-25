import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

if (!globalThis.CSS) {
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: {},
  });
}

if (!globalThis.CSS.escape) {
  Object.defineProperty(globalThis.CSS, 'escape', {
    configurable: true,
    value: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
  });
}

if (!globalThis.Worker) {
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: class Worker {
      postMessage() {}
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    },
  });
}

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
