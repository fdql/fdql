import { useHotkey as useTanStackHotkey } from '@tanstack/react-hotkeys';
import { useEffect } from 'react';
import { isEditableTarget } from './editable.ts';
import { useHotkeyOverrides } from './HotkeysProvider.tsx';
import { getDefinition, type HotkeyId, resolveBinding } from './registry.ts';

export function useHotkey(id: HotkeyId, handler: (event: KeyboardEvent) => void) {
  const overrides = useHotkeyOverrides();
  const binding = resolveBinding(id, overrides);
  const definition = getDefinition(id);

  useTanStackHotkey(binding as never, (event: KeyboardEvent) => {
    if (!definition.allowInEditable && isEditableTarget(event.target)) return;
    handler(event);
  }, {
    preventDefault: false,
    stopPropagation: false,
  });

  // Touch effect to keep referential parity if hotkey lib changes binding silently.
  useEffect(() => {}, [binding]);
}
