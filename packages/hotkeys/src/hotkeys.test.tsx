import type { SettingsRepository } from '@firebase-desk/repo-contracts';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isEditableTarget } from './editable.ts';
import { HotkeysProvider, useHotkeyOverrides } from './HotkeysProvider.tsx';
import { resolveBinding } from './registry.ts';
import { useHotkey } from './useHotkey.ts';

const tanstackHotkeys = vi.hoisted(() => ({
  useHotkey: vi.fn(),
}));

vi.mock('@tanstack/react-hotkeys', () => ({
  HotkeysProvider: ({ children }: { readonly children: unknown; }) => children,
  useHotkey: tanstackHotkeys.useHotkey,
}));

describe('hotkeys', () => {
  beforeEach(() => {
    tanstackHotkeys.useHotkey.mockClear();
  });

  it('resolves overrides and detects editable targets', () => {
    expect(resolveBinding('tab.close', { 'tab.close': 'mod+shift+w' })).toBe('mod+shift+w');
    expect(resolveBinding('tab.close', {})).toBe('mod+w');

    const input = document.createElement('input');
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(div)).toBe(true);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
  });

  it('keeps defaults and reports failed override loads', async () => {
    const onError = vi.fn();
    const settings = settingsRepository({
      getHotkeyOverrides: vi.fn().mockRejectedValue(new Error('settings unavailable')),
    });

    render(
      <HotkeysProvider settings={settings} onError={onError}>
        <OverrideProbe />
      </HotkeysProvider>,
    );

    expect(screen.getByText('none')).toBeTruthy();
    await waitFor(() => expect(onError).toHaveBeenCalledWith('settings unavailable'));
  });

  it('loads overrides into context', async () => {
    const settings = settingsRepository({
      getHotkeyOverrides: vi.fn().mockResolvedValue({ 'tab.close': 'mod+shift+w' }),
    });

    render(
      <HotkeysProvider settings={settings}>
        <OverrideProbe />
      </HotkeysProvider>,
    );

    expect(await screen.findByText('mod+shift+w')).toBeTruthy();
  });

  it('suppresses editable targets unless the definition allows them', () => {
    const onGlobal = vi.fn();
    const onAllowed = vi.fn();

    render(
      <>
        <HotkeyProbe id='tree.focusFilter' onFire={onGlobal} />
        <HotkeyProbe id='query.run' onFire={onAllowed} />
      </>,
    );

    const input = document.createElement('input');
    const globalCallback = tanstackHotkeys.useHotkey.mock.calls[0]?.[1] as HotkeyCallback;
    const allowedCallback = tanstackHotkeys.useHotkey.mock.calls[1]?.[1] as HotkeyCallback;
    const event = { target: input } as unknown as KeyboardEvent;

    globalCallback(event);
    allowedCallback(event);

    expect(onGlobal).not.toHaveBeenCalled();
    expect(onAllowed).toHaveBeenCalledWith(event);
  });

  it('suppresses global hotkeys when focus is inside an editor wrapper', () => {
    const onGlobal = vi.fn();
    render(<HotkeyProbe id='tree.focusFilter' onFire={onGlobal} />);

    const editor = document.createElement('div');
    editor.className = 'monaco-editor';
    const target = document.createElement('div');
    editor.append(target);
    document.body.append(editor);

    const globalCallback = tanstackHotkeys.useHotkey.mock.calls[0]?.[1] as HotkeyCallback;
    const event = {
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    globalCallback(event);

    expect(onGlobal).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    editor.remove();
  });

  it('suppresses global hotkeys when an editable element has focus', () => {
    const onGlobal = vi.fn();
    render(<HotkeyProbe id='tree.focusFilter' onFire={onGlobal} />);

    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();

    const globalCallback = tanstackHotkeys.useHotkey.mock.calls[0]?.[1] as HotkeyCallback;
    const event = {
      target: document.body,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    globalCallback(event);

    expect(onGlobal).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    input.remove();
  });

  it('lets callers decide when to prevent default behavior', () => {
    render(<HotkeyProbe id='tree.focusFilter' onFire={vi.fn()} />);

    expect(tanstackHotkeys.useHotkey.mock.calls[0]?.[2]).toEqual({
      preventDefault: false,
      stopPropagation: false,
    });
  });
});

type HotkeyCallback = (event: KeyboardEvent) => void;

function OverrideProbe() {
  const overrides = useHotkeyOverrides();
  return <output>{overrides['tab.close'] ?? 'none'}</output>;
}

function HotkeyProbe({ id, onFire }: {
  readonly id: Parameters<typeof useHotkey>[0];
  readonly onFire: (event: KeyboardEvent) => void;
}) {
  useHotkey(id, onFire);
  return null;
}

function settingsRepository(
  overrides: Partial<SettingsRepository>,
): SettingsRepository {
  return {
    getHotkeyOverrides: vi.fn().mockResolvedValue({}),
    load: vi.fn(),
    save: vi.fn(),
    setHotkeyOverrides: vi.fn(),
    ...overrides,
  };
}
