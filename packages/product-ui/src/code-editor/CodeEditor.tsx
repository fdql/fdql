import { FDQL_LANGUAGE_ID } from '@firebase-desk/fdql-language';
import type { editor as MonacoEditorTypes } from 'monaco-editor';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { useAppearance } from '../appearance/AppearanceProvider.tsx';
import { attachFdqlDiagnostics, registerFdqlLanguage } from './fdqlMonaco.ts';

type MonacoEditorApiModule = typeof import('monaco-editor');
type MonacoExtraLibDefaults = {
  readonly addExtraLib: (
    content: string,
    filePath?: string,
  ) => { dispose(): void; };
};
interface MonacoTypeScriptContribution {
  readonly javascriptDefaults: MonacoExtraLibDefaults;
  readonly typescriptDefaults: MonacoExtraLibDefaults;
}

export interface CodeEditorExtraLib {
  readonly content: string;
  readonly filePath: string;
}

export interface CodeEditorCursorTarget {
  readonly column: number;
  readonly key: number | string;
  readonly line: number;
}

const MonacoEditor = lazy(async () => {
  const module = await loadMonacoReact();
  return { default: module.default };
});

const MonacoDiffEditor = lazy(async () => {
  const module = await loadMonacoReact();
  return { default: module.DiffEditor };
});

export interface CodeEditorProps {
  readonly ariaLabel?: string;
  readonly extraLibs?: ReadonlyArray<CodeEditorExtraLib> | undefined;
  readonly height?: string;
  readonly language: string;
  readonly onChange?: (value: string) => void;
  readonly readOnly?: boolean;
  readonly revealCursorTarget?: CodeEditorCursorTarget | null | undefined;
  readonly value: string;
}

export function CodeEditor(
  {
    ariaLabel,
    extraLibs,
    height = '100%',
    language,
    onChange,
    readOnly = false,
    revealCursorTarget = null,
    value,
  }: CodeEditorProps,
) {
  const { resolvedTheme } = useAppearance();
  const diagnosticsSubscription = useRef<{ dispose(): void; } | null>(null);
  const editorRef = useRef<MonacoEditorTypes.IStandaloneCodeEditor | null>(null);
  const options: MonacoEditorTypes.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false },
    readOnly,
  };
  if (ariaLabel) options.ariaLabel = ariaLabel;

  useEffect(() => () => diagnosticsSubscription.current?.dispose(), []);
  useEffect(() => {
    if (!revealCursorTarget) return;
    const editor = editorRef.current;
    if (!editor) return;
    const position = {
      column: revealCursorTarget.column,
      lineNumber: revealCursorTarget.line,
    };
    editor.focus();
    editor.revealPositionInCenter(position);
    editor.setPosition(position);
  }, [revealCursorTarget]);

  return (
    <Suspense fallback={<div role='status'>Loading editor</div>}>
      <MonacoEditor
        beforeMount={(monaco) => {
          if (language === FDQL_LANGUAGE_ID) registerFdqlLanguage(monaco);
          registerExtraLibs(extraLibs ?? []);
          exposeMonacoForDiagnostics(monaco);
        }}
        height={height}
        language={language}
        options={options}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
        value={value}
        onChange={(nextValue) => onChange?.(nextValue ?? '')}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          diagnosticsSubscription.current?.dispose();
          diagnosticsSubscription.current = language === FDQL_LANGUAGE_ID
            ? attachFdqlDiagnostics(monaco, editor)
            : null;
        }}
      />
    </Suspense>
  );
}

export interface DiffCodeEditorProps {
  readonly height?: string;
  readonly language: string;
  readonly modified: string;
  readonly onModifiedChange?: (value: string) => void;
  readonly original: string;
}

export function DiffCodeEditor(
  {
    height = '100%',
    language,
    modified,
    onModifiedChange,
    original,
  }: DiffCodeEditorProps,
) {
  const { resolvedTheme } = useAppearance();
  const contentSubscription = useRef<{ dispose(): void; } | null>(null);
  const onModifiedChangeRef = useRef(onModifiedChange);

  useEffect(() => () => contentSubscription.current?.dispose(), []);
  useEffect(() => {
    onModifiedChangeRef.current = onModifiedChange;
  }, [onModifiedChange]);

  return (
    <Suspense fallback={<div role='status'>Loading editor</div>}>
      <MonacoDiffEditor
        beforeMount={exposeMonacoForDiagnostics}
        height={height}
        language={language}
        modified={modified}
        original={original}
        options={{
          minimap: { enabled: false },
          originalEditable: false,
          readOnly: false,
          renderSideBySide: true,
        }}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
        onMount={(editor: MonacoEditorTypes.IStandaloneDiffEditor) => {
          contentSubscription.current?.dispose();
          const modifiedEditor = editor.getModifiedEditor();
          contentSubscription.current = modifiedEditor.onDidChangeModelContent(() => {
            onModifiedChangeRef.current?.(modifiedEditor.getValue());
          });
        }}
      />
    </Suspense>
  );
}

async function loadMonacoReact(): Promise<typeof import('@monaco-editor/react')> {
  const [module, monaco, , , , typeScriptContribution] = await Promise.all([
    import('@monaco-editor/react'),
    // @ts-expect-error Monaco does not publish declarations for this ESM entry.
    import('monaco-editor/esm/vs/editor/editor.api'),
    // @ts-expect-error Monaco does not publish declarations for this ESM entry.
    import('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'),
    // @ts-expect-error Monaco does not publish declarations for this ESM entry.
    import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'),
    // @ts-expect-error Monaco does not publish declarations for this ESM entry.
    import('monaco-editor/esm/vs/language/json/monaco.contribution'),
    // @ts-expect-error Monaco does not publish declarations for this ESM entry.
    import('monaco-editor/esm/vs/language/typescript/monaco.contribution'),
  ]);
  monacoTypeScriptContribution = typeScriptContribution as MonacoTypeScriptContribution;
  module.loader.config({ monaco });
  return module;
}

let monacoTypeScriptContribution: MonacoTypeScriptContribution | null = null;
const registeredExtraLibs = new Map<string, {
  readonly content: string;
  readonly disposables: ReadonlyArray<{ dispose(): void; }>;
}>();

function registerExtraLibs(
  extraLibs: ReadonlyArray<CodeEditorExtraLib>,
): void {
  const defaults = monacoTypeScriptContribution;
  if (!defaults) return;
  for (const extraLib of extraLibs) {
    const registered = registeredExtraLibs.get(extraLib.filePath);
    if (registered?.content === extraLib.content) continue;
    for (const disposable of registered?.disposables ?? []) disposable.dispose();
    registeredExtraLibs.set(extraLib.filePath, {
      content: extraLib.content,
      disposables: [
        defaults.javascriptDefaults.addExtraLib(extraLib.content, extraLib.filePath),
        defaults.typescriptDefaults.addExtraLib(extraLib.content, extraLib.filePath),
      ],
    });
  }
}

function exposeMonacoForDiagnostics(monaco: MonacoEditorApiModule): void {
  (globalThis as typeof globalThis & { monaco?: MonacoEditorApiModule; }).monaco = monaco;
}
