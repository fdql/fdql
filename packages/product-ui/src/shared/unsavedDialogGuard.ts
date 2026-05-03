export function confirmDiscardUnsavedChanges(message: string): boolean {
  return globalThis.confirm?.(message) ?? true;
}
