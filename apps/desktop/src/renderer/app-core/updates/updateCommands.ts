import type { ActivityLogAppendInput, SettingsRepository } from '@firebase-desk/repo-contracts';
import { messageFromError } from '../shared/errors.ts';
import type { UpdateCheckResult } from './updateState.ts';
import type { UpdateStore } from './updateStore.ts';
import { updateCheckStarted, updateCheckSucceeded, updateDismissed } from './updateTransitions.ts';

export interface UpdateApi {
  readonly checkForUpdates?:
    | ((request: { readonly force?: boolean | undefined; }) => Promise<
      UpdateCheckResult
    >)
    | undefined;
  readonly openExternalUrl?: ((request: { readonly url: string; }) => Promise<void>) | undefined;
}

export interface UpdateCommandEnvironment {
  readonly now: () => number;
  readonly onStatus?: ((message: string) => void) | undefined;
  readonly recordActivity?: ((input: ActivityLogAppendInput) => Promise<void> | void) | undefined;
  readonly settings: SettingsRepository;
  readonly updateApi: UpdateApi | null;
}

export interface CheckForUpdatesInput {
  readonly force?: boolean | undefined;
}

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function checkForUpdatesCommand(
  store: UpdateStore,
  env: UpdateCommandEnvironment,
  input: CheckForUpdatesInput = {},
): Promise<void> {
  if (!env.updateApi?.checkForUpdates) return;
  if (store.get().status === 'checking') return;
  const snapshot = await env.settings.load();
  if (!input.force && !isCheckDue(snapshot.updates.lastCheckedAt, env.now())) return;
  if (store.get().status === 'checking') return;

  store.update((state) => updateCheckStarted(state, Boolean(input.force)));
  const result = await checkSafely(env, Boolean(input.force));
  const nextUpdates = { ...snapshot.updates, lastCheckedAt: result.checkedAt };
  await env.settings.save({ updates: nextUpdates });
  store.update((state) => updateCheckSucceeded(state, result, nextUpdates.dismissedVersion));
  reportUpdateResult(env, result, Boolean(input.force));
}

export async function dismissUpdateCommand(
  store: UpdateStore,
  env: Pick<UpdateCommandEnvironment, 'onStatus' | 'settings'>,
): Promise<void> {
  const state = store.get();
  const dismissedVersion = state.status === 'available' ? state.info.latestVersion : null;
  if (dismissedVersion) {
    const snapshot = await env.settings.load();
    await env.settings.save({
      updates: { ...snapshot.updates, dismissedVersion },
    });
  }
  store.update((current) => updateDismissed(current, dismissedVersion));
  env.onStatus?.(
    dismissedVersion ? `Dismissed update ${dismissedVersion}` : 'Dismissed update notice',
  );
}

export async function openUpdateReleaseCommand(
  store: UpdateStore,
  env: Pick<UpdateCommandEnvironment, 'onStatus' | 'updateApi'>,
): Promise<void> {
  if (!env.updateApi?.openExternalUrl) throw new Error('Update link is unavailable.');
  const state = store.get();
  if (state.status !== 'available' && state.status !== 'current') return;
  await env.updateApi.openExternalUrl({ url: state.info.releaseUrl });
  env.onStatus?.(`Opened release ${state.info.latestVersion}`);
}

function isCheckDue(lastCheckedAt: string | null, now: number): boolean {
  if (!lastCheckedAt) return true;
  const checkedAt = Date.parse(lastCheckedAt);
  if (!Number.isFinite(checkedAt)) return true;
  return now - checkedAt >= UPDATE_CHECK_INTERVAL_MS;
}

async function checkSafely(
  env: Pick<UpdateCommandEnvironment, 'now' | 'updateApi'>,
  force: boolean,
): Promise<UpdateCheckResult> {
  try {
    return await env.updateApi!.checkForUpdates!({ force });
  } catch (error) {
    return {
      checkedAt: new Date(env.now()).toISOString(),
      message: messageFromError(error, 'Could not check for updates.'),
      status: 'failed',
    };
  }
}

function reportUpdateResult(
  env: UpdateCommandEnvironment,
  result: UpdateCheckResult,
  forced: boolean,
): void {
  if (result.status === 'available') {
    env.onStatus?.(`Update ${result.latestVersion} available`);
    return;
  }
  if (result.status === 'current') {
    if (forced) env.onStatus?.(`Firebase Desk ${result.currentVersion} is current`);
    return;
  }
  env.onStatus?.(`Update check failed: ${result.message}`);
  void env.recordActivity?.({
    action: 'Check for updates',
    area: 'app',
    error: { message: result.message },
    status: 'failure',
    summary: result.message,
    target: { type: 'workspace' },
  });
}
