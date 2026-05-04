import type { UpdateCheckResult, UpdateState } from './updateState.ts';

export function updateCheckStarted(_state: UpdateState, forced: boolean): UpdateState {
  return { forced, status: 'checking' };
}

export function updateCheckSucceeded(
  state: UpdateState,
  result: UpdateCheckResult,
  dismissedVersion: string | null,
): UpdateState {
  if (result.status === 'failed') {
    return { checkedAt: result.checkedAt, message: result.message, status: 'failed' };
  }
  const info = {
    checkedAt: result.checkedAt,
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
    releaseUrl: result.releaseUrl,
  };
  if (result.status === 'available' && dismissedVersion === result.latestVersion) {
    return { dismissedVersion, status: 'dismissed' };
  }
  return result.status === 'available'
    ? { info, status: 'available' }
    : { checkedManually: state.status === 'checking' && state.forced, info, status: 'current' };
}

export function updateDismissed(
  _state: UpdateState,
  dismissedVersion: string | null,
): UpdateState {
  return { dismissedVersion, status: 'dismissed' };
}
