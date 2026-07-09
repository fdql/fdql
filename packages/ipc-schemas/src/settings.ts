import { defaultDensity, densityNames } from '@firebase-desk/design-tokens';
import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  DEFAULT_FIRESTORE_WRITE_SETTINGS,
  DEFAULT_FIRST_RUN_GUIDE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  FIRESTORE_ARRAY_FIELD_TYPES,
  FIRESTORE_FIELD_STALE_BEHAVIORS,
  FIRESTORE_PRIMITIVE_FIELD_TYPES,
} from '@firebase-desk/repo-contracts';
import { z } from 'zod';
import { ActivityLogSettingsSchema } from './activity.ts';

export const HotkeyOverridesSchema = z.record(z.string(), z.string());

export const DataModeSchema = z.enum(['mock', 'live']);
export const DensityNameSchema = z.enum(densityNames);

export const ResultTableLayoutSchema = z.object({
  columnOrder: z.array(z.string()),
  columnSizing: z.record(z.string(), z.number().int().nonnegative()),
});

export const ResultTableLayoutsSchema = z.record(z.string(), ResultTableLayoutSchema);

export const FirestorePrimitiveFieldTypeSchema = z.enum(FIRESTORE_PRIMITIVE_FIELD_TYPES);

export const FirestoreFieldTypeSchema = z.union([
  FirestorePrimitiveFieldTypeSchema,
  z.enum(FIRESTORE_ARRAY_FIELD_TYPES),
]);

export const FirestoreFieldCatalogEntrySchema = z.object({
  count: z.number().int().nonnegative(),
  field: z.string(),
  types: z.array(FirestoreFieldTypeSchema),
});

export const FirestoreFieldCatalogsSchema = z.record(
  z.string(),
  z.array(FirestoreFieldCatalogEntrySchema),
);

export const FirestoreWriteSettingsSchema = z.object({
  fieldStaleBehavior: z.enum(FIRESTORE_FIELD_STALE_BEHAVIORS),
});

export const UpdateSettingsSchema = z.object({
  dismissedVersion: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
});

export const FirstRunGuideSettingsSchema = z.object({
  completedAt: z.string().nullable(),
});

export const SettingsSnapshotSchema = z.object({
  activityLog: ActivityLogSettingsSchema.default(DEFAULT_ACTIVITY_LOG_SETTINGS),
  sidebarWidth: z.number().int().nonnegative(),
  inspectorWidth: z.number().int().nonnegative(),
  theme: z.enum(['system', 'light', 'dark']),
  density: DensityNameSchema.default(defaultDensity),
  dataMode: DataModeSchema,
  firstRunGuide: FirstRunGuideSettingsSchema.default(DEFAULT_FIRST_RUN_GUIDE_SETTINGS),
  hotkeyOverrides: HotkeyOverridesSchema,
  resultTableLayouts: ResultTableLayoutsSchema.default({}),
  firestoreFieldCatalogs: FirestoreFieldCatalogsSchema.default({}),
  firestoreWrites: FirestoreWriteSettingsSchema.default(DEFAULT_FIRESTORE_WRITE_SETTINGS),
  updates: UpdateSettingsSchema.default(DEFAULT_UPDATE_SETTINGS),
  workspaceState: z.unknown().nullable().default(null),
  workspaceStateClearedAt: z.number().finite().nonnegative().nullable().optional(),
});

export const SettingsPatchSchema = z.object({
  activityLog: ActivityLogSettingsSchema.optional(),
  sidebarWidth: z.number().int().nonnegative().optional(),
  inspectorWidth: z.number().int().nonnegative().optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  density: DensityNameSchema.optional(),
  dataMode: DataModeSchema.optional(),
  firstRunGuide: FirstRunGuideSettingsSchema.optional(),
  hotkeyOverrides: HotkeyOverridesSchema.optional(),
  resultTableLayouts: ResultTableLayoutsSchema.optional(),
  firestoreFieldCatalogs: FirestoreFieldCatalogsSchema.optional(),
  firestoreWrites: FirestoreWriteSettingsSchema.optional(),
  updates: UpdateSettingsSchema.optional(),
  workspaceState: z.unknown().nullable().optional(),
  workspaceStateClearedAt: z.number().finite().nonnegative().nullable().optional(),
});

export const SettingsFileSchema = z.object({
  version: z.literal(1),
  snapshot: SettingsSnapshotSchema,
});
