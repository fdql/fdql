import type { FirestoreSqlContext } from '@firebase-desk/repo-contracts';
import type { SettingsRepository } from '@firebase-desk/repo-contracts';
import { useEffect, useRef, useState } from 'react';
import { restoreWorkspaceTabsCommand } from '../../app-core/workspace/workspaceCommands.ts';
import { type TabsState, tabsStore } from '../stores/tabsStore.ts';
import {
  loadPersistedWorkspaceStateResult,
  savePersistedWorkspaceState,
  type WorkspacePersistenceFailure,
} from '../workspacePersistence.ts';

export interface PersistedWorkspaceSnapshot {
  readonly authFilter?: string | undefined;
  readonly fdqlSources?: Readonly<Record<string, string>> | undefined;
  readonly scripts?: Readonly<Record<string, string>> | undefined;
  readonly sqlContexts?: Readonly<Record<string, FirestoreSqlContext>> | undefined;
  readonly sqlSources?: Readonly<Record<string, string>> | undefined;
}

export interface PersistedWorkspaceStateResult {
  readonly persistenceEnabled: boolean;
  readonly recoveryDiagnostic: string | null;
  readonly restored: boolean;
  readonly snapshot: PersistedWorkspaceSnapshot | null;
}

export interface WorkspacePersistenceSnapshot {
  readonly authFilter: string;
  readonly fdqlSources?: Readonly<Record<string, string>> | undefined;
  readonly scripts: Readonly<Record<string, string>>;
  readonly sqlContexts?: Readonly<Record<string, FirestoreSqlContext>> | undefined;
  readonly sqlSources?: Readonly<Record<string, string>> | undefined;
  readonly tabsState: TabsState;
}

interface PendingWorkspacePersistenceSnapshot {
  readonly recordedAtMs: number;
  readonly snapshot: WorkspacePersistenceSnapshot;
}

export function usePersistedWorkspaceState(
  options: {
    readonly onError?: (error: WorkspacePersistenceFailure) => void;
    readonly settings:
      & Pick<SettingsRepository, 'load'>
      & Partial<Pick<SettingsRepository, 'save'>>;
  },
): PersistedWorkspaceStateResult {
  const { onError, settings } = options;
  const [result, setResult] = useState<PersistedWorkspaceStateResult>({
    restored: false,
    persistenceEnabled: true,
    recoveryDiagnostic: null,
    snapshot: null,
  });
  const restoredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const tabsStateAtLoadStart = tabsStore.state;
    void loadPersistedWorkspaceStateResult(settings).then((loadResult) => {
      if (cancelled) return;
      if (loadResult.error) onError?.(loadResult.error);
      let restoredSnapshot: PersistedWorkspaceSnapshot | null = null;
      if (!restoredRef.current) {
        restoredRef.current = true;
        const persistedWorkspace = loadResult.snapshot;
        const shouldRestore = Boolean(persistedWorkspace)
          && tabsStore.state === tabsStateAtLoadStart
          && tabsStore.state.tabs.length === 0;
        restoredSnapshot = shouldRestore ? persistedWorkspace : null;
        if (persistedWorkspace && shouldRestore) {
          const restoreResult = restoreWorkspaceTabsCommand(persistedWorkspace.tabsState);
          tabsStore.setState(() => restoreResult.state);
          if (loadResult.migrated && settings.save) {
            const { version: _version, ...migratedState } = persistedWorkspace;
            void savePersistedWorkspaceState(
              settings as typeof settings & Pick<SettingsRepository, 'save'>,
              migratedState,
            ).then((error) => {
              if (error) onError?.(error);
            });
          }
        }
      }
      setResult({
        persistenceEnabled: loadResult.unsupportedVersion === undefined,
        recoveryDiagnostic: loadResult.recoveryDiagnostic ?? null,
        restored: true,
        snapshot: restoredSnapshot,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [onError, settings]);

  return result;
}

export function usePersistWorkspaceSnapshot(
  snapshot: WorkspacePersistenceSnapshot,
  options: {
    readonly debounceMs?: number | undefined;
    readonly enabled: boolean;
    readonly onError?: (error: WorkspacePersistenceFailure) => void;
    readonly skipInitialSave?: boolean | undefined;
    readonly settings: Pick<SettingsRepository, 'save'>;
  },
): void {
  const { onError, settings } = options;
  const skippedInitialSaveRef = useRef(false);
  const lastQueuedSnapshotKeyRef = useRef<string | null>(null);
  const pendingSnapshotRef = useRef<PendingWorkspacePersistenceSnapshot | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSaveOptionsRef = useRef({ onError, settings });
  const lastRecordedAtMsRef = useRef(0);
  latestSaveOptionsRef.current = { onError, settings };

  useEffect(() => {
    function clearPendingSave() {
      if (!saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (!options.enabled) {
      skippedInitialSaveRef.current = false;
      lastQueuedSnapshotKeyRef.current = null;
      pendingSnapshotRef.current = null;
      clearPendingSave();
      return;
    }
    const snapshotKey = JSON.stringify(snapshot);
    if (!skippedInitialSaveRef.current) {
      skippedInitialSaveRef.current = true;
      if (options.skipInitialSave ?? true) {
        lastQueuedSnapshotKeyRef.current = snapshotKey;
        return;
      }
    }
    if (lastQueuedSnapshotKeyRef.current === snapshotKey) return;
    lastQueuedSnapshotKeyRef.current = snapshotKey;
    pendingSnapshotRef.current = { recordedAtMs: nextRecordedAtMs(), snapshot };
    clearPendingSave();
    if (!snapshot.tabsState.tabs.length) {
      const pendingSnapshot = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      if (!pendingSnapshot) return;
      void savePersistedWorkspaceState(settings, pendingSnapshot.snapshot, {
        recordedAtMs: pendingSnapshot.recordedAtMs,
      }).then((error) => {
        if (error) latestSaveOptionsRef.current.onError?.(error);
      });
      return;
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const pendingSnapshot = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      if (!pendingSnapshot) return;
      void savePersistedWorkspaceState(settings, pendingSnapshot.snapshot, {
        recordedAtMs: pendingSnapshot.recordedAtMs,
      }).then((error) => {
        if (error) latestSaveOptionsRef.current.onError?.(error);
      });
    }, options.debounceMs ?? 300);
  }, [onError, options.debounceMs, options.enabled, settings, snapshot]);

  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pendingSnapshot = pendingSnapshotRef.current;
    pendingSnapshotRef.current = null;
    if (!pendingSnapshot) return;
    const latest = latestSaveOptionsRef.current;
    void savePersistedWorkspaceState(latest.settings, pendingSnapshot.snapshot, {
      recordedAtMs: pendingSnapshot.recordedAtMs,
    }).then((error) => {
      if (error) latest.onError?.(error);
    });
  }, []);

  function nextRecordedAtMs(): number {
    const recordedAtMs = Math.max(Date.now(), lastRecordedAtMsRef.current + 1);
    lastRecordedAtMsRef.current = recordedAtMs;
    return recordedAtMs;
  }
}
