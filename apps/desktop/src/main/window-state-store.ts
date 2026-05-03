import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { MAIN_WINDOW_MIN_HEIGHT, MAIN_WINDOW_MIN_WIDTH } from './main-window-constants.ts';
import { writeJsonAtomic } from './storage/atomic-write.ts';

export interface MainWindowState {
  readonly bounds: Rectangle;
  readonly maximized: boolean;
}

export interface DisplayArea {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

const WindowStateFileSchema = z.object({
  state: z.object({
    bounds: z.object({
      height: z.number().int().positive(),
      width: z.number().int().positive(),
      x: z.number().int(),
      y: z.number().int(),
    }),
    maximized: z.boolean(),
  }),
  version: z.literal(1),
});

export async function loadMainWindowState(userDataPath: string): Promise<MainWindowState | null> {
  let raw: string;
  try {
    raw = await readFile(windowStatePath(userDataPath), 'utf8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return null;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }

  const parsed = WindowStateFileSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return normalizeWindowState(parsed.data.state);
}

export async function saveMainWindowState(
  userDataPath: string,
  state: MainWindowState,
): Promise<void> {
  await writeJsonAtomic(windowStatePath(userDataPath), {
    state: normalizeWindowState(state),
    version: 1,
  });
}

export function windowOptionsFromState(
  state: MainWindowState | null,
  displayAreas: ReadonlyArray<DisplayArea> = [],
): BrowserWindowConstructorOptions {
  if (!state) return {};
  const { bounds } = normalizeWindowState(state);
  if (displayAreas.length > 0 && !overlapsAnyDisplay(bounds, displayAreas)) {
    return { height: bounds.height, width: bounds.width };
  }
  return bounds;
}

export function trackMainWindowState(window: BrowserWindow, userDataPath: string): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveMainWindowStateSafely(userDataPath, snapshotWindowState(window));
    }, 250);
  };
  const saveNow = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    saveMainWindowStateSafely(userDataPath, snapshotWindowState(window));
  };
  window.on('move', scheduleSave);
  window.on('resize', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', saveNow);
}

function snapshotWindowState(window: BrowserWindow): MainWindowState {
  const maximized = window.isMaximized();
  return {
    bounds: maximized ? window.getNormalBounds() : window.getBounds(),
    maximized,
  };
}

function saveMainWindowStateSafely(userDataPath: string, state: MainWindowState): void {
  void saveMainWindowState(userDataPath, state).catch(() => undefined);
}

function normalizeWindowState(state: MainWindowState): MainWindowState {
  return {
    bounds: {
      ...state.bounds,
      height: Math.max(MAIN_WINDOW_MIN_HEIGHT, state.bounds.height),
      width: Math.max(MAIN_WINDOW_MIN_WIDTH, state.bounds.width),
    },
    maximized: state.maximized,
  };
}

function overlapsAnyDisplay(bounds: Rectangle, displayAreas: ReadonlyArray<DisplayArea>): boolean {
  return displayAreas.some((display) =>
    bounds.x < display.x + display.width
    && bounds.x + bounds.width > display.x
    && bounds.y < display.y + display.height
    && bounds.y + bounds.height > display.y
  );
}

function windowStatePath(userDataPath: string): string {
  return join(userDataPath, 'window-state.json');
}

function isNodeErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === code;
}
