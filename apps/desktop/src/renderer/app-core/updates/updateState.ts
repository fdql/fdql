export interface UpdateInfo {
  readonly checkedAt: string;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly releaseUrl: string;
}

export type UpdateState =
  | { readonly status: 'idle'; }
  | { readonly forced: boolean; readonly status: 'checking'; }
  | { readonly info: UpdateInfo; readonly status: 'available'; }
  | { readonly checkedManually: boolean; readonly info: UpdateInfo; readonly status: 'current'; }
  | { readonly checkedAt: string; readonly message: string; readonly status: 'failed'; }
  | { readonly dismissedVersion: string | null; readonly status: 'dismissed'; };

export type UpdateCheckResult =
  | ({ readonly status: 'available'; } & UpdateInfo)
  | ({ readonly status: 'current'; } & UpdateInfo)
  | { readonly checkedAt: string; readonly message: string; readonly status: 'failed'; };

export function createInitialUpdateState(): UpdateState {
  return { status: 'idle' };
}
