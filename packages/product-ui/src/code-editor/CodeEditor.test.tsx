import { FDQL_LANGUAGE_ID } from '@firebase-desk/fdql-language';
import { MockSettingsRepository } from '@firebase-desk/repo-mocks';
import { render, screen } from '@testing-library/react';
import type { editor as MonacoEditorTypes } from 'monaco-editor';
import { describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '../appearance/AppearanceProvider.tsx';
import { CodeEditor, DiffCodeEditor } from './CodeEditor.tsx';

const monacoMock = vi.hoisted(() => ({
  diffContentListener: null as (() => void) | null,
  editorContentListener: null as (() => void) | null,
  editorLanguage: 'json',
  editorOptions: null as unknown,
  editorValue: '',
  focusEditor: vi.fn(),
  javascriptContribution: vi.fn(),
  javascriptAddExtraLib: vi.fn(() => ({ dispose: vi.fn() })),
  loaderConfig: vi.fn(),
  modifiedValue: '',
  registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerLanguage: vi.fn(),
  revealPositionInCenter: vi.fn(),
  setEditorPosition: vi.fn(),
  setLanguageConfiguration: vi.fn(),
  setModelMarkers: vi.fn(),
  setMonarchTokensProvider: vi.fn(),
  typescriptAddExtraLib: vi.fn(() => ({ dispose: vi.fn() })),
  typescriptContribution: vi.fn(),
}));
const monacoApiMock = vi.hoisted(() => ({
  editor: {
    setModelMarkers: monacoMock.setModelMarkers,
  },
  languages: {
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    CompletionItemKind: {
      Function: 1,
      Keyword: 2,
      Property: 3,
      Snippet: 4,
      Variable: 5,
      Field: 6,
    },
    register: monacoMock.registerLanguage,
    registerCompletionItemProvider: monacoMock.registerCompletionItemProvider,
    setLanguageConfiguration: monacoMock.setLanguageConfiguration,
    setMonarchTokensProvider: monacoMock.setMonarchTokensProvider,
    typescript: {
      javascriptDefaults: { addExtraLib: monacoMock.javascriptAddExtraLib },
      typescriptDefaults: { addExtraLib: monacoMock.typescriptAddExtraLib },
    },
  },
  MarkerSeverity: { Error: 8, Warning: 4 },
}));

vi.mock('monaco-editor/esm/vs/editor/editor.api', () => monacoApiMock);
vi.mock('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution', () => {
  monacoMock.javascriptContribution();
  return {};
});
vi.mock('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution', () => {
  monacoMock.typescriptContribution();
  return {};
});
vi.mock('monaco-editor/esm/vs/language/typescript/monaco.contribution', () => ({
  javascriptDefaults: { addExtraLib: monacoMock.javascriptAddExtraLib },
  typescriptDefaults: { addExtraLib: monacoMock.typescriptAddExtraLib },
}));

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    default: (
      {
        beforeMount,
        language,
        onMount,
        options,
        theme,
        value,
      }: {
        readonly beforeMount?: (monaco: typeof monacoApiMock) => void;
        readonly language: string;
        readonly onMount?: (
          editor: MonacoEditorTypes.IStandaloneCodeEditor,
          monaco: typeof monacoApiMock,
        ) => void;
        readonly options?: {
          readonly acceptSuggestionOnEnter?: string;
          readonly ariaLabel?: string;
          readonly quickSuggestions?: boolean;
        };
        readonly theme: string;
        readonly value: string;
      },
    ) => {
      React.useEffect(() => {
        monacoMock.editorLanguage = language;
        monacoMock.editorOptions = options ?? null;
        monacoMock.editorValue = value;
        beforeMount?.(monacoApiMock);
        onMount?.({
          focus: monacoMock.focusEditor,
          getModel: () => ({
            getLanguageId: () => monacoMock.editorLanguage,
            getValue: () => monacoMock.editorValue,
            getWordUntilPosition: () => ({ endColumn: 1, startColumn: 1, word: '' }),
          }),
          onDidChangeModelContent: (listener: () => void) => {
            monacoMock.editorContentListener = listener;
            return {
              dispose: () => {
                if (monacoMock.editorContentListener === listener) {
                  monacoMock.editorContentListener = null;
                }
              },
            };
          },
          revealPositionInCenter: monacoMock.revealPositionInCenter,
          setPosition: monacoMock.setEditorPosition,
        } as unknown as MonacoEditorTypes.IStandaloneCodeEditor, monacoApiMock);
      }, [beforeMount, language, onMount, value]);
      return (
        <textarea
          aria-label={options?.ariaLabel}
          data-language={language}
          data-testid='monaco'
          data-theme={theme}
          readOnly
          value={value}
        />
      );
    },
    DiffEditor: (
      {
        modified,
        beforeMount,
        onMount,
        theme,
      }: {
        readonly beforeMount?: (monaco: typeof monacoApiMock) => void;
        readonly modified: string;
        readonly onMount?: (editor: MonacoEditorTypes.IStandaloneDiffEditor) => void;
        readonly theme: string;
      },
    ) => {
      const mounted = React.useRef(false);
      monacoMock.modifiedValue = modified;
      React.useEffect(() => {
        if (mounted.current) return;
        mounted.current = true;
        beforeMount?.(monacoApiMock);
        onMount?.({
          getModifiedEditor: () => ({
            getValue: () => monacoMock.modifiedValue,
            onDidChangeModelContent: (listener: () => void) => {
              monacoMock.diffContentListener = listener;
              return {
                dispose: () => {
                  if (monacoMock.diffContentListener === listener) {
                    monacoMock.diffContentListener = null;
                  }
                },
              };
            },
          }),
        } as MonacoEditorTypes.IStandaloneDiffEditor);
      }, []);
      return <textarea data-testid='monaco-diff' data-theme={theme} readOnly value={modified} />;
    },
    loader: { config: monacoMock.loaderConfig },
  };
});

describe('CodeEditor', () => {
  it('configures Monaco to use the bundled editor package', async () => {
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor language='json' value='{}' />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');

    expect(monacoMock.loaderConfig).toHaveBeenCalledWith({
      monaco: monacoApiMock,
    });
  });

  it('registers JavaScript and TypeScript tokenization contributions', async () => {
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor language='javascript' value='yield 1;' />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');

    expect(monacoMock.javascriptContribution).toHaveBeenCalledTimes(1);
    expect(monacoMock.typescriptContribution).toHaveBeenCalledTimes(1);
  });

  it('registers editor extra libs with Monaco language defaults', async () => {
    const extraLib = {
      content: 'declare const admin: { firestore(): unknown };',
      filePath: 'file:///test/firebase-desk-js-query.d.ts',
    };
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor extraLibs={[extraLib]} language='javascript' value='admin.' />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');

    expect(monacoMock.javascriptAddExtraLib).toHaveBeenCalledWith(
      extraLib.content,
      extraLib.filePath,
    );
    expect(monacoMock.typescriptAddExtraLib).toHaveBeenCalledWith(
      extraLib.content,
      extraLib.filePath,
    );
  });

  it('registers FDQL language services with Monaco', async () => {
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor language={FDQL_LANGUAGE_ID} value='return *' />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');

    expect(monacoMock.registerLanguage).toHaveBeenCalledWith({ id: FDQL_LANGUAGE_ID });
    expect(monacoMock.setLanguageConfiguration).toHaveBeenCalledWith(
      FDQL_LANGUAGE_ID,
      expect.any(Object),
    );
    expect(monacoMock.setMonarchTokensProvider).toHaveBeenCalledWith(
      FDQL_LANGUAGE_ID,
      expect.any(Object),
    );
    expect(monacoMock.registerCompletionItemProvider).toHaveBeenCalledWith(
      FDQL_LANGUAGE_ID,
      expect.objectContaining({
        provideCompletionItems: expect.any(Function),
        triggerCharacters: ['.', '$'],
      }),
    );
  });

  it('keeps FDQL autocomplete manual-friendly', async () => {
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor language={FDQL_LANGUAGE_ID} value='then ' />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');

    expect(monacoMock.editorOptions).toEqual(
      expect.objectContaining({
        acceptSuggestionOnEnter: 'on',
        quickSuggestions: false,
      }),
    );
    expect(monacoMock.registerCompletionItemProvider).toHaveBeenCalledWith(
      FDQL_LANGUAGE_ID,
      expect.objectContaining({
        triggerCharacters: ['.', '$'],
      }),
    );
  });

  it('uses plain FDQL completions by default', async () => {
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor language={FDQL_LANGUAGE_ID} value='then ' />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');
    type CompletionProvider = {
      provideCompletionItems: (
        model: unknown,
        position: { lineNumber: number; column: number; },
      ) => {
        suggestions: ReadonlyArray<
          { readonly insertText: string; readonly insertTextRules?: number; }
        >;
      };
    };
    const calls = monacoMock.registerCompletionItemProvider.mock.calls as unknown as Array<
      [string, CompletionProvider]
    >;
    const fdqlProviderCalls = calls.filter((call) => call[0] === FDQL_LANGUAGE_ID);
    const provider = fdqlProviderCalls.at(-1)![1];

    const result = provider.provideCompletionItems(
      {
        getValue: () => 'then ',
        getWordUntilPosition: () => ({ endColumn: 6, startColumn: 6, word: '' }),
      },
      { column: 6, lineNumber: 1 },
    );

    expect(result.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ insertText: 'filter ' }),
        expect.objectContaining({ insertText: 'lookup one ' }),
      ]),
    );
    expect(result.suggestions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ insertText: 'then filter' }),
        expect.objectContaining({ insertTextRules: 4 }),
      ]),
    );
  });

  it('sets and clears FDQL diagnostics markers', async () => {
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor
          language={FDQL_LANGUAGE_ID}
          value={`set readBudget = 5000
alias $orders = fs.collection("orders")
from $orders as o
fs limit 1
return fs.id(o) as id`}
        />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');

    expect(monacoMock.setModelMarkers).toHaveBeenCalledWith(
      expect.any(Object),
      'fdql',
      expect.arrayContaining([
        expect.objectContaining({
          source: 'FDQL_INVALID_SET_KEY',
        }),
      ]),
    );

    try {
      vi.useFakeTimers();
      monacoMock.setModelMarkers.mockClear();
      monacoMock.editorValue = `alias $orders = fs.collection("orders")
from $orders as o
fs limit 1
return fs.id(o) as id`;
      monacoMock.editorContentListener?.();
      vi.advanceTimersByTime(250);

      expect(monacoMock.setModelMarkers).toHaveBeenLastCalledWith(
        expect.any(Object),
        'fdql',
        [],
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets FDQL field mask warnings as Monaco warning markers', async () => {
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor
          language={FDQL_LANGUAGE_ID}
          value={`set fs.projectId = "local"
alias $orders = fs.collection("orders", ["status"])
from $orders as o
return o.total`}
        />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');

    expect(monacoMock.setModelMarkers).toHaveBeenCalledWith(
      expect.any(Object),
      'fdql',
      expect.arrayContaining([
        expect.objectContaining({
          severity: monacoApiMock.MarkerSeverity.Warning,
          source: 'FDQL_FIELD_NOT_IN_MASK',
        }),
      ]),
    );
  });

  it('exposes Monaco when mounted for integration diagnostics', async () => {
    delete (globalThis as typeof globalThis & { monaco?: unknown; }).monaco;
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor language='json' value='{}' />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');

    expect((globalThis as typeof globalThis & { monaco?: unknown; }).monaco).toBe(
      monacoApiMock,
    );
    delete (globalThis as typeof globalThis & { monaco?: unknown; }).monaco;
  });

  it('passes resolved appearance to Monaco', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor language='json' value='{}' />
      </AppearanceProvider>,
    );
    expect((await screen.findByTestId('monaco')).getAttribute('data-theme')).toBe('vs-dark');
  });

  it('passes an accessible label to Monaco', async () => {
    render(
      <AppearanceProvider settings={new MockSettingsRepository()}>
        <CodeEditor ariaLabel='Document JSON' language='json' value='{}' />
      </AppearanceProvider>,
    );
    expect(await screen.findByLabelText('Document JSON')).toBeTruthy();
  });

  it('reveals requested cursor targets in Monaco', async () => {
    const settings = new MockSettingsRepository();
    const { rerender } = render(
      <AppearanceProvider settings={settings}>
        <CodeEditor
          language={FDQL_LANGUAGE_ID}
          revealCursorTarget={{ column: 4, key: 1, line: 3 }}
          value='return *'
        />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco');

    expect(monacoMock.focusEditor).toHaveBeenCalled();
    expect(monacoMock.revealPositionInCenter).toHaveBeenCalledWith({ column: 4, lineNumber: 3 });
    expect(monacoMock.setEditorPosition).toHaveBeenCalledWith({ column: 4, lineNumber: 3 });

    rerender(
      <AppearanceProvider settings={settings}>
        <CodeEditor
          language={FDQL_LANGUAGE_ID}
          revealCursorTarget={{ column: 2, key: 2, line: 5 }}
          value='return *'
        />
      </AppearanceProvider>,
    );

    expect(monacoMock.setEditorPosition).toHaveBeenLastCalledWith({ column: 2, lineNumber: 5 });
  });

  it('calls the latest diff change handler after rerender', async () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const settings = new MockSettingsRepository();
    const { rerender } = render(
      <AppearanceProvider settings={settings}>
        <DiffCodeEditor
          language='json'
          modified='{"draft":1}'
          original='{"remote":1}'
          onModifiedChange={firstHandler}
        />
      </AppearanceProvider>,
    );
    await screen.findByTestId('monaco-diff');

    rerender(
      <AppearanceProvider settings={settings}>
        <DiffCodeEditor
          language='json'
          modified='{"draft":2}'
          original='{"remote":1}'
          onModifiedChange={secondHandler}
        />
      </AppearanceProvider>,
    );
    monacoMock.modifiedValue = '{"draft":3}';
    monacoMock.diffContentListener?.();

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledWith('{"draft":3}');
  });
});
