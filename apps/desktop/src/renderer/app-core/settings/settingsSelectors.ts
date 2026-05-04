import type { SettingsPatch } from '@firebase-desk/repo-contracts';

export function settingsPatchMetadata(patch: SettingsPatch): Record<string, unknown> {
  return {
    changedKeys: Object.keys(patch),
    ...(patch.dataMode ? { dataMode: patch.dataMode } : {}),
    ...(patch.density ? { density: patch.density } : {}),
    ...(patch.firstRunGuide
      ? { firstRunGuideCompleted: Boolean(patch.firstRunGuide.completedAt) }
      : {}),
    ...(patch.activityLog
      ? {
        activityLog: {
          detailMode: patch.activityLog.detailMode,
          enabled: patch.activityLog.enabled,
          maxBytes: patch.activityLog.maxBytes,
        },
      }
      : {}),
    ...(patch.firestoreWrites
      ? {
        firestoreWrites: {
          fieldStaleBehavior: patch.firestoreWrites.fieldStaleBehavior,
        },
      }
      : {}),
    ...(patch.theme ? { theme: patch.theme } : {}),
  };
}

export function settingsPatchSummary(patch: SettingsPatch): string {
  if (patch.dataMode) return `Data mode changed to ${patch.dataMode}`;
  if (patch.density) return `Density changed to ${patch.density}`;
  if (patch.firstRunGuide) return 'First-run guide changed';
  if (patch.activityLog) return 'Activity settings changed';
  if (patch.firestoreWrites) return 'Firestore write settings changed';
  if (patch.theme) return `Theme changed to ${patch.theme}`;
  return 'Settings changed';
}
