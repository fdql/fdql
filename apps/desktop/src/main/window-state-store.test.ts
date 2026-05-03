import type { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadMainWindowState,
  saveMainWindowState,
  trackMainWindowState,
  windowOptionsFromState,
} from './window-state-store.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('window state store', () => {
  it('saves and restores usable main window bounds', async () => {
    const userDataPath = await makeTempDir();

    await saveMainWindowState(userDataPath, {
      bounds: { height: 100, width: 200, x: 44, y: 55 },
      maximized: true,
    });

    await expect(loadMainWindowState(userDataPath)).resolves.toEqual({
      bounds: { height: 640, width: 960, x: 44, y: 55 },
      maximized: true,
    });
  });

  it('ignores invalid persisted window state', async () => {
    const userDataPath = await makeTempDir();
    await writeFile(join(userDataPath, 'window-state.json'), JSON.stringify({ bad: true }));

    await expect(loadMainWindowState(userDataPath)).resolves.toBe(null);
  });

  it('throws unexpected persisted window state read errors', async () => {
    const userDataPath = await makeTempDir();
    await mkdir(join(userDataPath, 'window-state.json'));

    await expect(loadMainWindowState(userDataPath)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('handles tracked save failures', async () => {
    const userDataPath = await makeTempDir();
    const blockedUserDataPath = join(userDataPath, 'blocked');
    await writeFile(blockedUserDataPath, 'not a directory');
    const window = new FakeBrowserWindow();

    trackMainWindowState(window as unknown as BrowserWindow, blockedUserDataPath);
    window.emit('close');

    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('maps restored state to BrowserWindow options', () => {
    expect(windowOptionsFromState({
      bounds: { height: 700, width: 1000, x: 10, y: 20 },
      maximized: false,
    }, [{ height: 900, width: 1440, x: 0, y: 0 }])).toEqual({
      height: 700,
      width: 1000,
      x: 10,
      y: 20,
    });
  });

  it('drops off-screen coordinates when restoring window options', () => {
    expect(windowOptionsFromState({
      bounds: { height: 700, width: 1000, x: 5000, y: 5000 },
      maximized: false,
    }, [{ height: 900, width: 1440, x: 0, y: 0 }])).toEqual({
      height: 700,
      width: 1000,
    });
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'firebase-desk-window-state-'));
  tempDirs.push(dir);
  return dir;
}

class FakeBrowserWindow extends EventEmitter {
  getBounds() {
    return { height: 700, width: 1000, x: 10, y: 20 };
  }

  getNormalBounds() {
    return this.getBounds();
  }

  isMaximized() {
    return false;
  }
}
