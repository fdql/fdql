import { type AppearanceMode, type DensityName } from '@firebase-desk/design-tokens';
import type {
  ActivityLogDetailMode,
  DataMode,
  FirestoreFieldStaleBehavior,
  SettingsPatch,
  SettingsSnapshot,
} from '@firebase-desk/repo-contracts';
import { normalizeFirestoreWriteSettings } from '@firebase-desk/repo-contracts';
import { Button, Dialog, DialogContent, InlineAlert, Input } from '@firebase-desk/ui';
import { Database, FolderOpen, Trash2 } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useAppearance } from '../appearance/AppearanceProvider.tsx';
import { messageFromError } from '../shared/errors.ts';

export interface SettingsDialogProps {
  readonly appVersion: string;
  readonly dataModeHelpText?: string | undefined;
  readonly dataModeOptions?: readonly DataMode[] | undefined;
  readonly dataDirectoryPath?: string | null | undefined;
  readonly density?: DensityName | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenDataDirectory?: () => Promise<void>;
  readonly onDensityChange?: (density: DensityName) => void;
  readonly onSettingsSaved?: (patch: SettingsPatch, snapshot: SettingsSnapshot) => void;
  readonly open: boolean;
}

const modes: ReadonlyArray<AppearanceMode> = ['system', 'light', 'dark'];
const dataModes: ReadonlyArray<DataMode> = ['live', 'mock'];
const densities: ReadonlyArray<DensityName> = ['compact', 'comfortable'];
const activityDetailModes: ReadonlyArray<ActivityLogDetailMode> = ['metadata', 'fullPayload'];
const fieldStaleBehaviors: ReadonlyArray<FirestoreFieldStaleBehavior> = [
  'save-and-notify',
  'confirm',
  'block',
];
const BYTES_PER_MB = 1024 * 1024;

export function SettingsDialog(
  {
    appVersion,
    dataModeHelpText,
    dataModeOptions = dataModes,
    dataDirectoryPath,
    density,
    onDensityChange,
    onOpenChange,
    onOpenDataDirectory,
    onSettingsSaved,
    open,
  }: SettingsDialogProps,
) {
  const appearance = useAppearance();
  const [settingsSnapshot, setSettingsSnapshot] = useState<SettingsSnapshot | null>(null);
  const settingsSnapshotRef = useRef<SettingsSnapshot | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [activityRetentionMb, setActivityRetentionMb] = useState('5');
  const [savingDataMode, setSavingDataMode] = useState<DataMode | null>(null);
  const dataDirectoryLabel = dataDirectoryPath === undefined
    ? 'Loading'
    : dataDirectoryPath ?? 'Unavailable';

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSettingsError(null);
    appearance.settings.load()
      .then((snapshot) => {
        if (!cancelled) {
          applySettingsSnapshot(snapshot);
          setActivityRetentionMb(formatMegabytes(snapshot.activityLog.maxBytes));
        }
      })
      .catch((caught) => {
        if (!cancelled) setSettingsError(messageFromError(caught, 'Could not load settings.'));
      });
    return () => {
      cancelled = true;
    };
  }, [appearance.settings, open]);

  async function handleAppearanceModeChange(mode: AppearanceMode) {
    setSettingsError(null);
    try {
      await appearance.setMode(mode);
      const snapshot = await appearance.settings.load();
      applySettingsSnapshot(snapshot);
      onSettingsSaved?.({ theme: mode }, snapshot);
    } catch (caught) {
      setSettingsError(messageFromError(caught, 'Could not save settings.'));
    }
  }

  async function handleDataModeChange(dataMode: DataMode) {
    setSettingsError(null);
    setSavingDataMode(dataMode);
    try {
      const patch = { dataMode };
      const snapshot = await appearance.settings.save(patch);
      applySettingsSnapshot(snapshot);
      onSettingsSaved?.(patch, snapshot);
    } catch (caught) {
      setSettingsError(messageFromError(caught, 'Could not save settings.'));
    } finally {
      setSavingDataMode(null);
    }
  }

  async function handleActivityLogChange(
    patch: Partial<SettingsSnapshot['activityLog']>,
  ) {
    const currentSnapshot = settingsSnapshotRef.current ?? settingsSnapshot;
    if (!currentSnapshot) return;
    setSettingsError(null);
    const activityLog = { ...currentSnapshot.activityLog, ...patch };
    const patchToSave = { activityLog };
    const optimisticSnapshot = { ...currentSnapshot, activityLog };
    applySettingsSnapshot(optimisticSnapshot);
    try {
      const next = await appearance.settings.save(patchToSave);
      applySettingsSnapshot(next);
      setActivityRetentionMb(formatMegabytes(next.activityLog.maxBytes));
      onSettingsSaved?.(patchToSave, next);
    } catch (caught) {
      applySettingsSnapshot(currentSnapshot);
      setSettingsError(messageFromError(caught, 'Could not save settings.'));
    }
  }

  async function handleFirestoreWritesChange(
    patch: Partial<SettingsSnapshot['firestoreWrites']>,
  ) {
    const currentSnapshot = settingsSnapshotRef.current ?? settingsSnapshot;
    if (!currentSnapshot) return;
    setSettingsError(null);
    const firestoreWrites = {
      ...normalizeFirestoreWriteSettings(currentSnapshot.firestoreWrites),
      ...patch,
    };
    const patchToSave = { firestoreWrites };
    const optimisticSnapshot = { ...currentSnapshot, firestoreWrites };
    applySettingsSnapshot(optimisticSnapshot);
    try {
      const next = await appearance.settings.save(patchToSave);
      applySettingsSnapshot(next);
      onSettingsSaved?.(patchToSave, next);
    } catch (caught) {
      applySettingsSnapshot(currentSnapshot);
      setSettingsError(messageFromError(caught, 'Could not save settings.'));
    }
  }

  async function handleDeleteFirestoreMetadata(key: string) {
    const currentSnapshot = settingsSnapshotRef.current ?? settingsSnapshot;
    if (!currentSnapshot) return;
    setSettingsError(null);
    const patchToSave = {
      firestoreFieldCatalogs: omitRecordKey(currentSnapshot.firestoreFieldCatalogs, key),
      resultTableLayouts: omitRecordKey(currentSnapshot.resultTableLayouts, key),
    };
    const optimisticSnapshot = { ...currentSnapshot, ...patchToSave };
    applySettingsSnapshot(optimisticSnapshot);
    try {
      const next = await appearance.settings.save(patchToSave);
      applySettingsSnapshot(next);
      onSettingsSaved?.(patchToSave, next);
    } catch (caught) {
      applySettingsSnapshot(currentSnapshot);
      setSettingsError(messageFromError(caught, 'Could not delete Firestore metadata.'));
    }
  }

  async function handleClearFirestoreMetadata() {
    const currentSnapshot = settingsSnapshotRef.current ?? settingsSnapshot;
    if (!currentSnapshot) return;
    setSettingsError(null);
    const patchToSave = {
      firestoreFieldCatalogs: {},
      resultTableLayouts: {},
    };
    const optimisticSnapshot = { ...currentSnapshot, ...patchToSave };
    applySettingsSnapshot(optimisticSnapshot);
    try {
      const next = await appearance.settings.save(patchToSave);
      applySettingsSnapshot(next);
      onSettingsSaved?.(patchToSave, next);
    } catch (caught) {
      applySettingsSnapshot(currentSnapshot);
      setSettingsError(messageFromError(caught, 'Could not clear Firestore metadata.'));
    }
  }

  function applySettingsSnapshot(snapshot: SettingsSnapshot) {
    const normalizedSnapshot = {
      ...snapshot,
      firestoreWrites: normalizeFirestoreWriteSettings(snapshot.firestoreWrites),
    };
    settingsSnapshotRef.current = normalizedSnapshot;
    setSettingsSnapshot(normalizedSnapshot);
  }

  function handleActivityRetentionBlur() {
    const maxBytes = Math.max(1, Math.round(Number(activityRetentionMb) || 5)) * BYTES_PER_MB;
    void handleActivityLogChange({ maxBytes });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        description='Configure Firebase Desk preferences and app info.'
        stickyHeader
        title='Settings'
      >
        <div className='grid gap-2'>
          <div className='text-sm font-medium text-text-primary'>Appearance</div>
          <div className='flex gap-1'>
            {modes.map((mode) => (
              <Button
                key={mode}
                data-state={appearance.mode === mode ? 'active' : 'inactive'}
                variant={appearance.mode === mode ? 'primary' : 'secondary'}
                onClick={() => void handleAppearanceModeChange(mode)}
              >
                {mode}
              </Button>
            ))}
          </div>
        </div>
        {settingsSnapshot
          ? (
            <div className='grid gap-2'>
              <div className='text-sm font-medium text-text-primary'>Data source</div>
              <div className='flex gap-1'>
                {dataModeOptions.map((dataMode) => (
                  <Button
                    key={dataMode}
                    aria-label={`${dataMode} data mode`}
                    data-state={settingsSnapshot.dataMode === dataMode ? 'active' : 'inactive'}
                    disabled={Boolean(savingDataMode)}
                    variant={settingsSnapshot.dataMode === dataMode ? 'primary' : 'secondary'}
                    onClick={() => void handleDataModeChange(dataMode)}
                  >
                    {savingDataMode === dataMode ? 'saving' : dataMode}
                  </Button>
                ))}
              </div>
              <div className='text-xs text-text-secondary'>
                {dataModeHelpText ?? 'Changes apply immediately.'}
              </div>
            </div>
          )
          : null}
        {settingsSnapshot
          ? (
            <div className='grid gap-2'>
              <div className='text-sm font-medium text-text-primary'>Activity</div>
              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  aria-label='Activity logging'
                  variant={settingsSnapshot.activityLog.enabled ? 'primary' : 'secondary'}
                  onClick={() =>
                    void handleActivityLogChange({
                      enabled: !settingsSnapshot.activityLog.enabled,
                    })}
                >
                  {settingsSnapshot.activityLog.enabled ? 'enabled' : 'disabled'}
                </Button>
                <select
                  aria-label='Activity detail'
                  className='h-[var(--density-control-height)] rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary'
                  value={settingsSnapshot.activityLog.detailMode}
                  onChange={(event) =>
                    void handleActivityLogChange({
                      detailMode: event.currentTarget.value as ActivityLogDetailMode,
                    })}
                >
                  {activityDetailModes.map((mode) => <option key={mode} value={mode}>{mode}
                  </option>)}
                </select>
                <label className='flex items-center gap-2 text-sm text-text-secondary'>
                  <span>Max MB</span>
                  <Input
                    aria-label='Activity retention MB'
                    className='w-24'
                    min={1}
                    type='number'
                    value={activityRetentionMb}
                    onBlur={handleActivityRetentionBlur}
                    onChange={(event) => setActivityRetentionMb(event.currentTarget.value)}
                  />
                </label>
              </div>
              <div className='text-xs text-text-secondary'>
                Metadata is default. Full payload stores submitted write data locally.
              </div>
            </div>
          )
          : null}
        {settingsSnapshot
          ? (
            <div className='grid gap-2'>
              <div className='text-sm font-medium text-text-primary'>Firestore writes</div>
              <select
                aria-label='Stale field edits'
                className='h-[var(--density-control-height)] rounded-md border border-border bg-bg-panel px-2 text-sm text-text-primary'
                value={normalizeFirestoreWriteSettings(settingsSnapshot.firestoreWrites)
                  .fieldStaleBehavior}
                onChange={(event) =>
                  void handleFirestoreWritesChange({
                    fieldStaleBehavior: event.currentTarget.value as FirestoreFieldStaleBehavior,
                  })}
              >
                {fieldStaleBehaviors.map((behavior) => (
                  <option key={behavior} value={behavior}>{behavior}</option>
                ))}
              </select>
              <div className='text-xs text-text-secondary'>
                Controls field edits when the document changed elsewhere.
              </div>
            </div>
          )
          : null}
        {density && onDensityChange
          ? (
            <div className='grid gap-2'>
              <div className='text-sm font-medium text-text-primary'>Density</div>
              <div className='flex gap-1'>
                {densities.map((densityName) => (
                  <Button
                    key={densityName}
                    aria-label={`${densityName} density`}
                    data-state={density === densityName ? 'active' : 'inactive'}
                    variant={density === densityName ? 'primary' : 'secondary'}
                    onClick={() => onDensityChange(densityName)}
                  >
                    {densityName}
                  </Button>
                ))}
              </div>
            </div>
          )
          : null}
        {settingsSnapshot
          ? (
            <FirestoreMetadataSettings
              rows={firestoreMetadataRows(settingsSnapshot)}
              onClear={() => void handleClearFirestoreMetadata()}
              onDelete={(key) => void handleDeleteFirestoreMetadata(key)}
            />
          )
          : null}
        {settingsError ? <InlineAlert variant='danger'>{settingsError}</InlineAlert> : null}
        <SettingsSummary snapshot={settingsSnapshot} />
        {dataDirectoryPath !== undefined || onOpenDataDirectory
          ? (
            <DataLocationSettings
              dataDirectoryLabel={dataDirectoryLabel}
              dataDirectoryPath={dataDirectoryPath}
              onOpenDataDirectory={onOpenDataDirectory}
            />
          )
          : null}
        <CredentialStorageSummary snapshot={settingsSnapshot} />
        <div className='grid gap-1 rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm'>
          <div className='font-medium text-text-primary'>Data safety</div>
          <div className='text-text-secondary'>
            Account and target stay explicit before Firebase writes are enabled.
          </div>
        </div>
        <div className='grid gap-1 rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm'>
          <div className='font-medium text-text-primary'>About</div>
          <SettingRow label='Version' value={appVersion} />
          <SettingRow label='License' value='MIT' />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface FirestoreMetadataRow {
  readonly fieldCount: number;
  readonly hasLayout: boolean;
  readonly key: string;
}

function FirestoreMetadataSettings(
  {
    onClear,
    onDelete,
    rows,
  }: {
    readonly onClear: () => void;
    readonly onDelete: (key: string) => void;
    readonly rows: ReadonlyArray<FirestoreMetadataRow>;
  },
) {
  return (
    <div className='grid gap-2 rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2 font-medium text-text-primary'>
          <Database size={14} aria-hidden='true' />
          <span>Firestore metadata</span>
        </div>
        <Button
          aria-label='Clear Firestore metadata'
          disabled={rows.length === 0}
          size='xs'
          variant='danger'
          onClick={onClear}
        >
          <Trash2 size={13} aria-hidden='true' />
          Clear all
        </Button>
      </div>
      <div className='text-xs text-text-secondary'>
        Local field catalogs and table layouts saved from collection views.
      </div>
      {rows.length === 0
        ? <div className='text-xs text-text-muted'>No saved Firestore metadata.</div>
        : (
          <div aria-label='Saved Firestore metadata' className='grid max-h-56 overflow-auto'>
            {rows.map((row) => (
              <div
                key={row.key}
                className='grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-border-subtle py-2 first:border-t-0'
              >
                <div className='min-w-0'>
                  <code className='block truncate font-mono text-xs text-text-primary'>
                    {row.key}
                  </code>
                  <div className='text-xs text-text-muted'>
                    {row.fieldCount} fields, {row.hasLayout ? 'table layout' : 'no layout'}
                  </div>
                </div>
                <Button
                  aria-label={`Delete Firestore metadata for ${row.key}`}
                  size='xs'
                  variant='ghost'
                  onClick={() => onDelete(row.key)}
                >
                  <Trash2 size={13} aria-hidden='true' />
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

interface DataLocationSettingsProps {
  readonly dataDirectoryLabel: string;
  readonly dataDirectoryPath: string | null | undefined;
  readonly onOpenDataDirectory?: (() => Promise<void>) | undefined;
}

interface DataDirectoryActionState {
  readonly error: string | null;
}

function DataLocationSettings(
  { dataDirectoryLabel, dataDirectoryPath, onOpenDataDirectory }: DataLocationSettingsProps,
) {
  const [state, openDataDirectoryAction, isOpeningDataDirectory] = useActionState(
    async (): Promise<DataDirectoryActionState> => {
      if (!onOpenDataDirectory) return { error: null };
      try {
        await onOpenDataDirectory();
        return { error: null };
      } catch (caught) {
        return {
          error: messageFromError(caught, 'Could not open data location.'),
        };
      }
    },
    { error: null },
  );

  return (
    <div className='grid gap-2 rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm'>
      <div className='font-medium text-text-primary'>Local data</div>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
        <code
          aria-label='Data storage folder'
          className='min-w-0 flex-1 break-all rounded border border-border-subtle bg-bg-panel px-2 py-1 font-mono text-xs text-text-secondary'
          title={dataDirectoryPath ?? undefined}
        >
          {dataDirectoryLabel}
        </code>
        <form action={openDataDirectoryAction}>
          <Button
            disabled={!dataDirectoryPath || !onOpenDataDirectory || isOpeningDataDirectory}
            type='submit'
            variant='secondary'
          >
            <FolderOpen size={14} aria-hidden='true' />
            {isOpeningDataDirectory ? 'Opening' : 'Open location'}
          </Button>
        </form>
      </div>
      {state.error ? <InlineAlert variant='danger'>{state.error}</InlineAlert> : null}
    </div>
  );
}

function SettingsSummary({ snapshot }: { readonly snapshot: SettingsSnapshot | null; }) {
  if (!snapshot) {
    return (
      <div className='grid gap-1 rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm'>
        <div className='font-medium text-text-primary'>Saved settings</div>
        <div className='text-text-secondary'>Loading</div>
      </div>
    );
  }
  return (
    <div className='grid gap-1 rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm'>
      <div className='font-medium text-text-primary'>Saved settings</div>
      <SettingRow label='Sidebar' value={`${snapshot.sidebarWidth}px`} />
      <SettingRow label='Inspector' value={`${snapshot.inspectorWidth}px`} />
      <SettingRow label='Data source' value={snapshot.dataMode} />
      <SettingRow
        label='Activity'
        value={`${snapshot.activityLog.detailMode}, ${
          formatMegabytes(snapshot.activityLog.maxBytes)
        } MB`}
      />
      <SettingRow
        label='Field stale edits'
        value={normalizeFirestoreWriteSettings(snapshot.firestoreWrites).fieldStaleBehavior}
      />
      <SettingRow
        label='Hotkeys'
        value={`${Object.keys(snapshot.hotkeyOverrides).length} overrides`}
      />
    </div>
  );
}

function firestoreMetadataRows(snapshot: SettingsSnapshot): FirestoreMetadataRow[] {
  const keys = new Set([
    ...Object.keys(snapshot.firestoreFieldCatalogs),
    ...Object.keys(snapshot.resultTableLayouts),
  ]);
  const sortedKeys = mergeSortStrings(Array.from(keys));
  return sortedKeys.map((key) => ({
    fieldCount: snapshot.firestoreFieldCatalogs[key]?.length ?? 0,
    hasLayout: Boolean(snapshot.resultTableLayouts[key]),
    key,
  }));
}

function mergeSortStrings(values: ReadonlyArray<string>): string[] {
  if (values.length < 2) return [...values];
  const midpoint = Math.floor(values.length / 2);
  return mergeStrings(
    mergeSortStrings(values.slice(0, midpoint)),
    mergeSortStrings(values.slice(midpoint)),
  );
}

function mergeStrings(left: ReadonlyArray<string>, right: ReadonlyArray<string>): string[] {
  const merged: string[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftValue = left[leftIndex]!;
    const rightValue = right[rightIndex]!;
    if (leftValue.localeCompare(rightValue) <= 0) {
      merged.push(leftValue);
      leftIndex += 1;
    } else {
      merged.push(rightValue);
      rightIndex += 1;
    }
  }
  return merged.concat(left.slice(leftIndex), right.slice(rightIndex));
}

function omitRecordKey<TValue>(
  record: Readonly<Record<string, TValue>>,
  keyToDelete: string,
): Record<string, TValue> {
  const next = { ...record };
  delete next[keyToDelete];
  return next;
}

function CredentialStorageSummary({ snapshot }: { readonly snapshot: SettingsSnapshot | null; }) {
  const dataMode = snapshot?.dataMode;
  const copy = dataMode === 'live'
    ? 'Live mode can read production service account files. Credentials are stored in the local data folder and encrypted when OS storage is available.'
    : dataMode === 'mock'
    ? 'Mock mode uses local fixtures. No Firebase credentials are read.'
    : 'Loading credential storage details.';
  return (
    <div className='grid gap-1 rounded-md border border-border-subtle bg-bg-subtle p-3 text-sm'>
      <div className='font-medium text-text-primary'>Credential storage</div>
      <div className='text-text-secondary'>{copy}</div>
    </div>
  );
}

function formatMegabytes(bytes: number): string {
  return String(Math.max(1, Math.round(bytes / BYTES_PER_MB)));
}

function SettingRow({ label, value }: { readonly label: string; readonly value: string; }) {
  return (
    <div className='flex items-center justify-between gap-3 text-sm'>
      <span className='text-text-muted'>{label}</span>
      <span className='font-mono text-xs text-text-secondary'>{value}</span>
    </div>
  );
}
