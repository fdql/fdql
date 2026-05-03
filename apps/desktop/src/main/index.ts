import { app, BrowserWindow, screen } from 'electron';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipc/registry.ts';
import {
  installNativeAppBehavior,
  installNativeWindowBehavior,
  mainWindowDefaults,
} from './native-app.ts';
import {
  loadMainWindowState,
  trackMainWindowState,
  windowOptionsFromState,
} from './window-state-store.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const userDataDir = process.env['FIREBASE_DESK_USER_DATA_DIR'];

if (userDataDir) app.setPath('userData', userDataDir);

async function createWindow(): Promise<void> {
  const userDataPath = app.getPath('userData');
  const windowState = await loadMainWindowState(userDataPath);
  const window = new BrowserWindow({
    ...mainWindowDefaults(),
    ...windowOptionsFromState(
      windowState,
      screen.getAllDisplays().map((display) => display.workArea),
    ),
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  installNativeWindowBehavior(window);
  trackMainWindowState(window, userDataPath);
  if (windowState?.maximized) window.maximize();

  if (process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await window.loadFile(resolve(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  installNativeAppBehavior();
  registerIpcHandlers();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
