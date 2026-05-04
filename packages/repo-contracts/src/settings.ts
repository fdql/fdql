import { defaultDensity, type DensityName } from '@firebase-desk/design-tokens';
import type { ActivityLogSettings } from './activity.ts';

/**
 * Future map of user-defined hotkey overrides.
 * Keys are central registry IDs (see @firebase-desk/hotkeys); values are accelerator strings.
 * Phase 2 ships the plumbing only; the rebinding UI is deferred.
 */
export type HotkeyOverrides = Readonly<Record<string, string>>;

export type DataMode = 'mock' | 'live';

export interface ResultTableLayout {
  readonly columnOrder: string[];
  readonly columnSizing: Record<string, number>;
}

export type ResultTableLayouts = Record<string, ResultTableLayout>;

export const FIRESTORE_PRIMITIVE_FIELD_TYPES = [
  'boolean',
  'bytes',
  'geoPoint',
  'null',
  'number',
  'reference',
  'string',
  'timestamp',
] as const;

export type FirestorePrimitiveFieldType = (typeof FIRESTORE_PRIMITIVE_FIELD_TYPES)[number];

export type FirestoreFieldType =
  | FirestorePrimitiveFieldType
  | `array<${FirestorePrimitiveFieldType | 'mixed'}>`;

export const FIRESTORE_ARRAY_FIELD_TYPES = [
  'array<boolean>',
  'array<bytes>',
  'array<geoPoint>',
  'array<mixed>',
  'array<null>',
  'array<number>',
  'array<reference>',
  'array<string>',
  'array<timestamp>',
] as const satisfies ReadonlyArray<`array<${FirestorePrimitiveFieldType | 'mixed'}>`>;

export interface FirestoreFieldCatalogEntry {
  readonly count: number;
  readonly field: string;
  readonly types: FirestoreFieldType[];
}

export type FirestoreFieldCatalogs = Record<string, FirestoreFieldCatalogEntry[]>;

export const FIRESTORE_FIELD_STALE_BEHAVIORS = [
  'save-and-notify',
  'confirm',
  'block',
] as const;

export type FirestoreFieldStaleBehavior = (typeof FIRESTORE_FIELD_STALE_BEHAVIORS)[number];

export interface FirestoreWriteSettings {
  readonly fieldStaleBehavior: FirestoreFieldStaleBehavior;
}

export const DEFAULT_FIRESTORE_WRITE_SETTINGS: FirestoreWriteSettings = {
  fieldStaleBehavior: 'save-and-notify',
};

export interface UpdateSettings {
  readonly dismissedVersion: string | null;
  readonly lastCheckedAt: string | null;
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  dismissedVersion: null,
  lastCheckedAt: null,
};

export function isFirestoreFieldStaleBehavior(
  value: unknown,
): value is FirestoreFieldStaleBehavior {
  return typeof value === 'string'
    && (FIRESTORE_FIELD_STALE_BEHAVIORS as ReadonlyArray<string>).includes(value);
}

export function normalizeFirestoreWriteSettings(
  settings: Partial<FirestoreWriteSettings> | null | undefined,
): FirestoreWriteSettings {
  return {
    fieldStaleBehavior: isFirestoreFieldStaleBehavior(settings?.fieldStaleBehavior)
      ? settings.fieldStaleBehavior
      : DEFAULT_FIRESTORE_WRITE_SETTINGS.fieldStaleBehavior,
  };
}

export interface SettingsSnapshot {
  readonly activityLog: ActivityLogSettings;
  readonly sidebarWidth: number;
  readonly inspectorWidth: number;
  readonly theme: 'system' | 'light' | 'dark';
  readonly density: DensityName;
  readonly dataMode: DataMode;
  readonly hotkeyOverrides: HotkeyOverrides;
  readonly resultTableLayouts: ResultTableLayouts;
  readonly firestoreFieldCatalogs: FirestoreFieldCatalogs;
  readonly firestoreWrites: FirestoreWriteSettings;
  readonly updates: UpdateSettings;
  readonly workspaceState: unknown | null;
}

export interface SettingsPatch {
  readonly activityLog?: ActivityLogSettings | undefined;
  readonly sidebarWidth?: number | undefined;
  readonly inspectorWidth?: number | undefined;
  readonly theme?: SettingsSnapshot['theme'] | undefined;
  readonly density?: DensityName | undefined;
  readonly dataMode?: DataMode | undefined;
  readonly hotkeyOverrides?: HotkeyOverrides | undefined;
  readonly resultTableLayouts?: ResultTableLayouts | undefined;
  readonly firestoreFieldCatalogs?: FirestoreFieldCatalogs | undefined;
  readonly firestoreWrites?: FirestoreWriteSettings | undefined;
  readonly updates?: UpdateSettings | undefined;
  readonly workspaceState?: unknown | null | undefined;
}

export const DEFAULT_DENSITY: DensityName = defaultDensity;

export interface SettingsRepository {
  load(): Promise<SettingsSnapshot>;
  save(patch: SettingsPatch): Promise<SettingsSnapshot>;
  getHotkeyOverrides(): Promise<HotkeyOverrides>;
  setHotkeyOverrides(overrides: HotkeyOverrides): Promise<void>;
}
