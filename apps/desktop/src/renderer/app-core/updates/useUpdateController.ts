import type { ActivityLogAppendInput, SettingsRepository } from '@firebase-desk/repo-contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { messageFromError } from '../shared/errors.ts';
import { useAppCoreStore } from '../shared/reactStore.ts';
import {
  checkForUpdatesCommand,
  dismissUpdateCommand,
  openUpdateReleaseCommand,
  type UpdateApi,
  type UpdateCommandEnvironment,
} from './updateCommands.ts';
import { createUpdateStore, type UpdateStore } from './updateStore.ts';

export interface UpdateNoticeModel {
  readonly checkedAt?: string | undefined;
  readonly latestVersion?: string | undefined;
  readonly message: string;
  readonly status: 'available' | 'failed';
}

export interface UseUpdateControllerInput {
  readonly now?: (() => number) | undefined;
  readonly onStatus?: ((message: string) => void) | undefined;
  readonly recordActivity?: ((input: ActivityLogAppendInput) => Promise<void> | void) | undefined;
  readonly settings: SettingsRepository;
  readonly store?: UpdateStore | undefined;
  readonly updateApi: UpdateApi | null;
}

export function useUpdateController(
  {
    now = Date.now,
    onStatus,
    recordActivity,
    settings,
    store: inputStore,
    updateApi,
  }: UseUpdateControllerInput,
) {
  const [ownedStore] = useState(createUpdateStore);
  const store = inputStore ?? ownedStore;
  const state = useAppCoreStore(store);
  const canCheck = Boolean(updateApi?.checkForUpdates && updateApi.openExternalUrl);

  const env = useMemo<UpdateCommandEnvironment>(() => ({
    now,
    onStatus,
    recordActivity,
    settings,
    updateApi,
  }), [now, onStatus, recordActivity, settings, updateApi]);

  const check = useCallback((force = true) => {
    void checkForUpdatesCommand(store, env, { force }).catch((error: unknown) => {
      onStatus?.(messageFromError(error, 'Could not check for updates.'));
    });
  }, [env, onStatus, store]);

  const dismiss = useCallback(() => {
    void dismissUpdateCommand(store, env).catch((error: unknown) => {
      onStatus?.(messageFromError(error, 'Could not dismiss update notice.'));
    });
  }, [env, onStatus, store]);

  const openRelease = useCallback(() => {
    void openUpdateReleaseCommand(store, env).catch((error: unknown) => {
      onStatus?.(messageFromError(error, 'Could not open release.'));
    });
  }, [env, onStatus, store]);

  useEffect(() => {
    if (!canCheck) return;
    void checkForUpdatesCommand(store, env, { force: false }).catch((error: unknown) => {
      onStatus?.(messageFromError(error, 'Could not check for updates.'));
    });
  }, [canCheck, env, onStatus, store]);

  return {
    canCheck,
    check,
    dismiss,
    isChecking: state.status === 'checking',
    notice: noticeForState(state),
    openRelease,
    state,
    statusLabel: statusLabelForState(state),
  };
}

function noticeForState(state: ReturnType<UpdateStore['get']>): UpdateNoticeModel | null {
  if (state.status === 'available') {
    return {
      checkedAt: state.info.checkedAt,
      latestVersion: state.info.latestVersion,
      message: `Update ${state.info.latestVersion} available`,
      status: 'available',
    };
  }
  if (state.status === 'failed') {
    return {
      checkedAt: state.checkedAt,
      message: `Update check failed: ${state.message}`,
      status: 'failed',
    };
  }
  return null;
}

function statusLabelForState(state: ReturnType<UpdateStore['get']>): string | null {
  return state.status === 'current' && state.checkedManually ? 'Up to date' : null;
}
