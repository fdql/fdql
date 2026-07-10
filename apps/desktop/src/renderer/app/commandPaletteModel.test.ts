import { describe, expect, it, vi } from 'vitest';
import { defaultFirestoreInspectorUiState } from '../app-core/firestore/query/firestoreQueryState.ts';
import { createCommandPaletteModel } from './commandPaletteModel.ts';
import type { WorkspaceTab } from './stores/tabsStore.ts';
import { DEFAULT_FIRESTORE_DRAFT } from './workspaceModel.ts';

describe('createCommandPaletteModel', () => {
  it('creates tab and workspace commands', () => {
    const onSelectTab = vi.fn();
    const onOpenTab = vi.fn();
    const onChangeTheme = vi.fn();
    const commands = createCommandPaletteModel({
      onChangeTheme,
      onFocusTreeFilter: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenTab,
      onRunQuery: vi.fn(),
      onRunScript: vi.fn(),
      onSelectTab,
      resolvedTheme: 'dark',
      tabs: [tab('tab-1', '//orders//')],
    });

    commands.find((command) => command.id === 'switch-tab-1')?.onSelect();
    commands.find((command) => command.id === 'new-firestore')?.onSelect();
    commands.find((command) => command.id === 'theme')?.onSelect();

    expect(onSelectTab).toHaveBeenCalledWith('tab-1');
    expect(onOpenTab).toHaveBeenCalledWith('firestore-query');
    expect(onChangeTheme).toHaveBeenCalledWith('light');
    expect(commands.find((command) => command.id === 'switch-tab-1')?.label).toBe(
      'Switch to orders',
    );
  });
});

function tab(id: string, path: string): WorkspaceTab {
  return {
    connectionId: 'emu',
    draft: { ...DEFAULT_FIRESTORE_DRAFT, path },
    id,
    inspectorUi: defaultFirestoreInspectorUiState(),
    inspectorWidth: 360,
    kind: 'firestore-query',
  };
}
