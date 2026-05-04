import type { SettingsRepository } from '@firebase-desk/repo-contracts';
import { resolveDataMode } from '../app/data-mode.ts';
import { checkForUpdates, isAllowedReleaseUrl } from '../updates/update-checker.ts';
import type { IpcHandlerMap } from './handler-types.ts';

export interface AppHandlerDeps {
  readonly appVersion: string;
  readonly dataDirectory: string;
  readonly openExternalUrl: (url: string) => Promise<void>;
  readonly openDataDirectory: () => Promise<string>;
  readonly settingsRepository: SettingsRepository;
}

export function createAppHandlers(
  deps: AppHandlerDeps,
): Pick<
  IpcHandlerMap,
  | 'app.checkForUpdates'
  | 'app.config'
  | 'app.openDataDirectory'
  | 'app.openExternalUrl'
  | 'health.check'
> {
  return {
    'health.check': () => ({
      pong: 'pong' as const,
      receivedAt: new Date().toISOString(),
      appVersion: deps.appVersion,
    }),
    'app.config': async () => ({
      ...await resolveDataMode(deps.settingsRepository),
      appVersion: deps.appVersion,
      dataDirectory: deps.dataDirectory,
    }),
    'app.openDataDirectory': async () => {
      const errorMessage = await deps.openDataDirectory();
      if (errorMessage) throw new Error(errorMessage);
    },
    'app.checkForUpdates': async (_request) => {
      // `force` controls renderer throttling; main checks GitHub whenever invoked.
      return await checkForUpdates({ currentVersion: deps.appVersion });
    },
    'app.openExternalUrl': async ({ url }) => {
      if (!isAllowedReleaseUrl(url)) throw new Error('External URL is not allowed.');
      await deps.openExternalUrl(url);
    },
  };
}
