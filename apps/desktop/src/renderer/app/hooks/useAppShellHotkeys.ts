import { useHotkey } from '@firebase-desk/hotkeys';
import type { WorkspaceTabKind } from '../stores/tabsStore.ts';

interface UseAppShellHotkeysInput {
  readonly activeTabKind: WorkspaceTabKind | null;
  readonly onBack: () => void;
  readonly onCloseTab: () => void;
  readonly onFocusSearch: () => void;
  readonly onForward: () => void;
  readonly onNewTab: () => void;
  readonly onOpenSettings: () => void;
  readonly onRunQuery: () => void;
  readonly onRunFdql: () => void;
  readonly onRunScript: () => void;
}

export function useAppShellHotkeys(
  {
    activeTabKind,
    onBack,
    onCloseTab,
    onFocusSearch,
    onForward,
    onNewTab,
    onOpenSettings,
    onRunFdql,
    onRunQuery,
    onRunScript,
  }: UseAppShellHotkeysInput,
) {
  useHotkey('settings.open', (event) => {
    event.preventDefault();
    onOpenSettings();
  });
  useHotkey('tab.new', (event) => {
    event.preventDefault();
    onNewTab();
  });
  useHotkey('tab.close', (event) => {
    event.preventDefault();
    onCloseTab();
  });
  useHotkey('history.back', (event) => {
    event.preventDefault();
    onBack();
  });
  useHotkey('history.forward', (event) => {
    event.preventDefault();
    onForward();
  });
  useHotkey('tree.focusFilter', (event) => {
    event.preventDefault();
    onFocusSearch();
  });
  useHotkey('query.run', (event) => {
    if (
      activeTabKind !== 'firestore-query'
      && activeTabKind !== 'js-query'
      && activeTabKind !== 'fdql'
    ) return;
    event.preventDefault();
    if (activeTabKind === 'firestore-query') onRunQuery();
    else if (activeTabKind === 'js-query') onRunScript();
    else onRunFdql();
  });
}
