import type { IpcResponse } from '@firebase-desk/ipc-schemas';

export type UpdateCheckResult = IpcResponse<'app.checkForUpdates'>;

export interface UpdateCheckerDeps {
  readonly currentVersion: string;
  readonly fetch?: FetchLike | undefined;
  readonly now?: (() => Date) | undefined;
}

interface FetchLike {
  (url: string, init?: { readonly headers?: Record<string, string>; }): Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly json: () => Promise<unknown>;
  }>;
}

interface ReleaseMetadata {
  readonly assets: ReadonlyArray<ReleaseAssetMetadata>;
  readonly htmlUrl: string;
  readonly isDraft: boolean;
  readonly isPrerelease: boolean;
  readonly tagName: string;
}

interface ReleaseAssetMetadata {
  readonly downloadUrl: string;
  readonly name: string;
}

interface ReleaseManifest {
  readonly appId: 'dev.firebase-desk.app';
  readonly releaseUrl: string | null;
  readonly schemaVersion: 1;
  readonly version: string;
}

const releaseApiUrl =
  'https://api.github.com/repos/viniciusrmcarneiro/firebase-desk/releases/latest';
const releasePathPrefix = '/viniciusrmcarneiro/firebase-desk/releases/';
const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Firebase-Desk',
};

export async function checkForUpdates(
  deps: UpdateCheckerDeps,
): Promise<UpdateCheckResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString();
  if (!fetchImpl) return failedResult(checkedAt, 'Update checks are unavailable.');

  try {
    const currentVersion = normalizeStableVersion(deps.currentVersion);
    if (!currentVersion) {
      throw new Error(`Current version is not stable semver: ${deps.currentVersion}`);
    }

    const release = parseReleaseMetadata(await fetchJson(fetchImpl, releaseApiUrl));
    if (release.isDraft || release.isPrerelease) {
      throw new Error('Newest release is not a stable published release.');
    }

    const latestVersion = normalizeStableVersion(release.tagName);
    if (!latestVersion) {
      throw new Error(`Newest release tag is not stable semver: ${release.tagName}`);
    }

    const manifest = await readReleaseManifest(fetchImpl, release.assets);
    const releaseUrl = manifest?.releaseUrl ?? release.htmlUrl;
    if (!isAllowedReleaseUrl(releaseUrl)) throw new Error('Release URL is not allowed.');
    if (manifest && manifest.version !== latestVersion) {
      throw new Error('Release manifest version does not match release tag.');
    }

    return {
      checkedAt,
      currentVersion,
      latestVersion,
      releaseUrl,
      status: compareStableVersions(latestVersion, currentVersion) > 0 ? 'available' : 'current',
    };
  } catch (error) {
    return failedResult(checkedAt, messageFromError(error, 'Could not check for updates.'));
  }
}

export function compareStableVersions(left: string, right: string): number {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

export function normalizeStableVersion(value: string): string | null {
  const parts = parseStableVersion(value);
  return parts ? parts.join('.') : null;
}

export function isAllowedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && (url.pathname.startsWith(`${releasePathPrefix}tag/`)
        || url.pathname.startsWith(`${releasePathPrefix}download/`));
  } catch {
    return false;
  }
}

async function readReleaseManifest(
  fetchImpl: FetchLike,
  assets: ReadonlyArray<ReleaseAssetMetadata>,
): Promise<ReleaseManifest | null> {
  const asset = assets.find((item) => item.name === 'release-manifest.json');
  if (!asset) return null;
  if (!isAllowedReleaseUrl(asset.downloadUrl)) {
    throw new Error('Release manifest URL is not allowed.');
  }
  return parseReleaseManifest(await fetchJson(fetchImpl, asset.downloadUrl));
}

async function fetchJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const response = await fetchImpl(url, { headers: githubHeaders });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  return await response.json();
}

function parseReleaseMetadata(value: unknown): ReleaseMetadata {
  const record = expectRecord(value, 'Release metadata is invalid.');
  const assets = Array.isArray(record.assets) ? record.assets : [];
  return {
    assets: assets.map(parseReleaseAssetMetadata),
    htmlUrl: expectString(record.html_url, 'Release URL is invalid.'),
    isDraft: expectBoolean(record.draft, 'Release draft flag is invalid.'),
    isPrerelease: expectBoolean(record.prerelease, 'Release prerelease flag is invalid.'),
    tagName: expectString(record.tag_name, 'Release tag is invalid.'),
  };
}

function parseReleaseAssetMetadata(value: unknown): ReleaseAssetMetadata {
  const record = expectRecord(value, 'Release asset metadata is invalid.');
  return {
    downloadUrl: expectString(record.browser_download_url, 'Release asset URL is invalid.'),
    name: expectString(record.name, 'Release asset name is invalid.'),
  };
}

function parseReleaseManifest(value: unknown): ReleaseManifest {
  const record = expectRecord(value, 'Release manifest is invalid.');
  const manifest = {
    appId: record.appId,
    releaseUrl: record.releaseUrl,
    schemaVersion: record.schemaVersion,
    version: record.version,
  };
  if (
    manifest.appId !== 'dev.firebase-desk.app'
    || manifest.schemaVersion !== 1
    || typeof manifest.version !== 'string'
    || !(manifest.releaseUrl === null || typeof manifest.releaseUrl === 'string')
  ) {
    throw new Error('Release manifest is invalid.');
  }
  if (manifest.releaseUrl && !isAllowedReleaseUrl(manifest.releaseUrl)) {
    throw new Error('Release manifest URL is not allowed.');
  }
  return manifest as ReleaseManifest;
}

function parseStableVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function expectString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message);
  return value;
}

function expectBoolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new Error(message);
  return value;
}

function failedResult(checkedAt: string, message: string): UpdateCheckResult {
  return { checkedAt, message, status: 'failed' };
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
