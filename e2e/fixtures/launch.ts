import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = resolve(fixtureDir, '../../apps/desktop');
const MAIN_ENTRY = resolve(DESKTOP_DIR, '.build/out/main/index.js');

export { DESKTOP_DIR };

export interface LaunchDesktopOptions {
  readonly args?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly userDataDir?: string;
}

export function createDesktopEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  env['FIRESTORE_EMULATOR_HOST'] = process.env['FIRESTORE_EMULATOR_HOST'] ?? '127.0.0.1:8080';
  env['FIREBASE_AUTH_EMULATOR_HOST'] = process.env['FIREBASE_AUTH_EMULATOR_HOST']
    ?? '127.0.0.1:9099';
  env['GCLOUD_PROJECT'] = process.env['GCLOUD_PROJECT'] ?? 'demo-local';
  return env;
}

export async function launchDesktop(
  options: LaunchDesktopOptions = {},
): Promise<ElectronApplication> {
  const env = { ...createDesktopEnv() };
  if (options.userDataDir) env['FIREBASE_DESK_USER_DATA_DIR'] = options.userDataDir;
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  return electron.launch({
    args: [MAIN_ENTRY, ...(options.args ?? [])],
    cwd: DESKTOP_DIR,
    env,
  });
}
