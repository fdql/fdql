import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';

const configDir = dirname(fileURLToPath(import.meta.url));
const monacoEditorPluginFactory =
  (monacoEditorPlugin as unknown as { default?: typeof monacoEditorPlugin; }).default
    ?? monacoEditorPlugin;

export default defineConfig({
  base: './',
  root: resolve(configDir, 'src/renderer'),
  define: {
    'import.meta.env.VITE_FIREBASE_DESK_RUNTIME': JSON.stringify('demo'),
  },
  css: {
    postcss: resolve(configDir, 'postcss.config.cjs'),
  },
  plugins: [
    react(),
    monacoEditorPluginFactory({
      languageWorkers: [],
      publicPath: 'monacoeditorwork',
      customDistPath: (_root, buildOutDir) => resolve(buildOutDir, 'monacoeditorwork'),
      customWorkers: [
        { label: 'editorWorkerService', entry: 'monaco-editor/esm/vs/editor/editor.worker.js' },
        { label: 'json', entry: 'monaco-editor/esm/vs/language/json/json.worker.js' },
        { label: 'typescript', entry: 'monaco-editor/esm/vs/language/typescript/ts.worker.js' },
      ],
    }),
  ],
  build: {
    emptyOutDir: true,
    outDir: resolve(configDir, '../docs/.build/site/demo/app'),
    rollupOptions: {
      input: resolve(configDir, 'src/renderer/index.html'),
    },
  },
});
