import type { DataMode, SettingsRepository } from '@firebase-desk/repo-contracts';

export interface DataModeConfig {
  readonly dataMode: DataMode;
}

export function readDataModeSwitch(argv: ReadonlyArray<string> = process.argv): DataMode | null {
  for (const arg of argv) {
    if (arg === '--data-mode=mock' || arg === '--mock') return 'mock';
    if (arg === '--data-mode=live' || arg === '--live') return 'live';
    if (arg.startsWith('--data-mode=')) {
      const value = arg.slice('--data-mode='.length);
      if (value === 'mock' || value === 'live') return value;
    }
  }
  return null;
}

export async function resolveDataMode(
  settingsRepository: Pick<SettingsRepository, 'load'>,
  argv: ReadonlyArray<string> = process.argv,
): Promise<DataModeConfig> {
  return {
    dataMode: readDataModeSwitch(argv) ?? (await settingsRepository.load()).dataMode ?? 'mock',
  };
}
