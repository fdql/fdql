import type { BackgroundJobEvent } from '@firebase-desk/repo-contracts/jobs';
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  Menu,
  type MenuItemConstructorOptions,
  nativeTheme,
  Notification,
  shell,
} from 'electron';
import {
  MAIN_WINDOW_DEFAULT_HEIGHT,
  MAIN_WINDOW_DEFAULT_WIDTH,
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
} from './main-window-constants.ts';
import {
  backgroundJobNotificationForEvent,
  isInternalAppNavigation,
  type NativeContextMenuAction,
  nativeContextMenuActions,
  shouldOpenExternally,
} from './native-app-policy.ts';

interface BackgroundJobNotifierDeps {
  readonly focusApp: () => void;
  readonly isAppFocused: () => boolean;
  readonly isNotificationSupported: () => boolean;
  readonly showNotification: (
    notification: { readonly body: string; readonly title: string; },
    onClick: () => void,
  ) => void;
}

const MAX_NOTIFIED_BACKGROUND_JOB_IDS = 500;
const WINDOWS_APP_USER_MODEL_ID = 'dev.firebase-desk.app';

export function installNativeAppBehavior(): void {
  nativeTheme.themeSource = 'system';
  installPlatformAppIdentity();
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()));
}

export function mainWindowDefaults(): BrowserWindowConstructorOptions {
  return {
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    title: 'Firebase Desk',
    ...(process.platform === 'darwin'
      ? {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 12, y: 13 },
      }
      : {}),
    width: MAIN_WINDOW_DEFAULT_WIDTH,
  };
}

export function installNativeWindowBehavior(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url, window.webContents.getURL())) {
      openExternalSafely(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (!shouldOpenExternally(url, currentUrl)) {
      if (!isInternalAppNavigation(url, currentUrl)) event.preventDefault();
      return;
    }
    event.preventDefault();
    openExternalSafely(url);
  });

  window.webContents.on('context-menu', (_event, params) => {
    const actions = nativeContextMenuActions(params, isDevelopmentRuntime());
    if (actions.length === 0) return;
    Menu.buildFromTemplate(contextMenuTemplate(actions, params, window)).popup({ window });
  });
}

export function createBackgroundJobNotifier(
  deps: BackgroundJobNotifierDeps = defaultBackgroundJobNotifierDeps(),
): (event: BackgroundJobEvent) => void {
  const notifiedJobIds = new Set<string>();
  return (event) => {
    if (event.type === 'job-removed') {
      notifiedJobIds.delete(event.id);
      return;
    }
    if (event.type === 'job-updated' && event.job.acknowledgedAt) {
      notifiedJobIds.delete(event.job.id);
      return;
    }
    const notification = backgroundJobNotificationForEvent(event);
    if (!notification || notifiedJobIds.has(notification.jobId)) return;
    rememberNotifiedBackgroundJobId(notifiedJobIds, notification.jobId);
    if (deps.isAppFocused() || !deps.isNotificationSupported()) return;
    deps.showNotification(notification, deps.focusApp);
  };
}

function rememberNotifiedBackgroundJobId(ids: Set<string>, id: string): void {
  ids.add(id);
  if (ids.size <= MAX_NOTIFIED_BACKGROUND_JOB_IDS) return;
  const oldestId = ids.values().next().value;
  if (typeof oldestId === 'string') ids.delete(oldestId);
}

function applicationMenuTemplate(): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';
  const isDev = isDevelopmentRuntime();
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        } satisfies MenuItemConstructorOptions,
      ]
      : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev
          ? [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
          ] satisfies MenuItemConstructorOptions[]
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' } satisfies MenuItemConstructorOptions] : []),
        { role: 'close' },
      ],
    },
  ];
  return template;
}

function contextMenuTemplate(
  actions: ReadonlyArray<NativeContextMenuAction>,
  params: ContextMenuParams,
  window: BrowserWindow,
): MenuItemConstructorOptions[] {
  return actions.map((action) => contextMenuItem(action, params, window));
}

function contextMenuItem(
  action: NativeContextMenuAction,
  params: ContextMenuParams,
  window: BrowserWindow,
): MenuItemConstructorOptions {
  if (action === 'separator') return { type: 'separator' };
  if (action === 'open-link') {
    return {
      click: () => {
        if (params.linkURL) openExternalSafely(params.linkURL);
      },
      label: 'Open Link in Browser',
    };
  }
  if (action === 'inspect') {
    return {
      click: () => window.webContents.inspectElement(params.x, params.y),
      label: 'Inspect Element',
    };
  }
  if (action === 'paste-and-match-style') return { role: 'pasteAndMatchStyle' };
  if (action === 'select-all') return { role: 'selectAll' };
  return { role: action };
}

function defaultBackgroundJobNotifierDeps(): BackgroundJobNotifierDeps {
  return {
    focusApp,
    isAppFocused: () => Boolean(BrowserWindow.getFocusedWindow()),
    isNotificationSupported: () => Notification.isSupported(),
    showNotification: ({ body, title }, onClick) => {
      try {
        const notification = new Notification({ body, title });
        notification.on('click', onClick);
        notification.show();
      } catch {
        // Native notification support varies by platform/session.
      }
    },
  };
}

function focusApp(): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function openExternalSafely(url: string): void {
  void shell.openExternal(url).catch(() => undefined);
}

function isDevelopmentRuntime(): boolean {
  return !app.isPackaged || Boolean(process.env['ELECTRON_RENDERER_URL']);
}

function installPlatformAppIdentity(): void {
  if (process.platform !== 'win32') return;
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
}
