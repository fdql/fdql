/**
 * Helper that detects whether the currently focused element is editable.
 * Used by `useHotkey` to skip handlers unless the binding opts in via `allowInEditable`.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return isEditableElement(target) || isEditableElement(document.activeElement);
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest('.monaco-editor')) return true;
  return false;
}
