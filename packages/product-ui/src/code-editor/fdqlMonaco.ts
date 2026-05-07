import {
  createFdqlLanguageService,
  FDQL_LANGUAGE_ID,
  type FdqlCompletionItem,
} from '@firebase-desk/fdql-language';
import type { editor as MonacoEditorTypes, languages as MonacoLanguages } from 'monaco-editor';

type MonacoEditorApiModule = typeof import('monaco-editor');

const markerOwner = 'fdql';
const diagnosticDelayMs = 250;
const editorLanguageService = createFdqlLanguageService({
  defaultProviderContext: { fs: { projectId: 'editor' } },
});
let registered = false;

export function registerFdqlLanguage(monaco: MonacoEditorApiModule): void {
  if (registered) return;
  registered = true;
  monaco.languages.register?.({ id: FDQL_LANGUAGE_ID });
  monaco.languages.setLanguageConfiguration?.(FDQL_LANGUAGE_ID, {
    autoClosingPairs: [
      { close: '"', open: '"' },
      { close: "'", open: "'" },
      { close: ')', open: '(' },
      { close: ']', open: '[' },
      { close: '}', open: '{' },
    ],
    brackets: [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ],
    comments: { lineComment: '//' },
  });
  monaco.languages.setMonarchTokensProvider?.(FDQL_LANGUAGE_ID, {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\$[A-Za-z_][A-Za-z0-9_]*/, 'variable'],
        [/\b(?:true|false|null)\b/, 'constant'],
        [/\b\d+(?:\.\d+)?\b/, 'number'],
        [
          /\b(?:set|alias|from|as|then|return|union|all|by|where|order|limit|asc|desc)\b/,
          'keyword',
        ],
        [/\b(?:and|or|not|in)\b/, 'operator.keyword'],
        [/\b[A-Za-z_][A-Za-z0-9_]*(?=\.)/, 'namespace'],
        [/\b[A-Za-z_][A-Za-z0-9_]*(?=\()/, 'function'],
        [/[=!<>]+/, 'operator'],
        [/[{}[\]()]/, '@brackets'],
      ],
    },
  });
  monaco.languages.registerCompletionItemProvider?.(FDQL_LANGUAGE_ID, {
    triggerCharacters: ['.', '$', ' ', '\n'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        endColumn: word.endColumn,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        startLineNumber: position.lineNumber,
      };
      return {
        suggestions: editorLanguageService.getCompletions({
          column: position.column,
          line: position.lineNumber,
          source: model.getValue(),
        }).map((item) => monacoCompletion(monaco, item, range)),
      };
    },
  });
}

export function attachFdqlDiagnostics(
  monaco: MonacoEditorApiModule,
  editor: MonacoEditorTypes.IStandaloneCodeEditor,
): { dispose(): void; } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const update = () => {
    const model = editor.getModel();
    if (!model || model.getLanguageId() !== FDQL_LANGUAGE_ID) return;
    monaco.editor.setModelMarkers(
      model,
      markerOwner,
      editorLanguageService.getDiagnostics(model.getValue()).map((diagnostic) => ({
        endColumn: diagnostic.endColumn,
        endLineNumber: diagnostic.endLine,
        message: diagnostic.message,
        severity: diagnostic.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Warning,
        source: diagnostic.code,
        startColumn: diagnostic.column,
        startLineNumber: diagnostic.line,
      })),
    );
  };
  const schedule = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(update, diagnosticDelayMs);
  };
  update();
  const disposable = editor.onDidChangeModelContent(schedule);
  return {
    dispose() {
      if (timeoutId) clearTimeout(timeoutId);
      disposable.dispose();
      const model = editor.getModel();
      if (model) monaco.editor.setModelMarkers(model, markerOwner, []);
    },
  };
}

function monacoCompletion(
  monaco: MonacoEditorApiModule,
  item: FdqlCompletionItem,
  range: MonacoLanguages.CompletionItem['range'],
): MonacoLanguages.CompletionItem {
  const completion: MonacoLanguages.CompletionItem = {
    insertText: item.insertText,
    kind: completionKind(monaco, item.kind),
    label: item.label,
    range,
  };
  if (item.detail) completion.detail = item.detail;
  if (item.documentation) completion.documentation = item.documentation;
  if (item.insertText.includes('$')) {
    completion.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  }
  return completion;
}

function completionKind(
  monaco: MonacoEditorApiModule,
  kind: FdqlCompletionItem['kind'],
): MonacoLanguages.CompletionItemKind {
  if (kind === 'alias') return monaco.languages.CompletionItemKind.Variable;
  if (kind === 'field') return monaco.languages.CompletionItemKind.Field;
  if (kind === 'function') return monaco.languages.CompletionItemKind.Function;
  if (kind === 'setting') return monaco.languages.CompletionItemKind.Property;
  if (kind === 'stage') return monaco.languages.CompletionItemKind.Keyword;
  if (kind === 'snippet') return monaco.languages.CompletionItemKind.Snippet;
  return monaco.languages.CompletionItemKind.Keyword;
}
