import type { DensityName } from '@firebase-desk/design-tokens';
import { SettingsDialog } from '@firebase-desk/product-ui';
import type {
  ProjectAddInput,
  ProjectSummary,
  ProjectUpdatePatch,
} from '@firebase-desk/repo-contracts';
import type { ComponentProps } from 'react';
import { CredentialWarningToast } from './CredentialWarningToast.tsx';
import { DestructiveActionDialog } from './DestructiveActionDialog.tsx';
import { AddProjectDialog } from './dialogs/AddProjectDialog.tsx';
import { EditProjectDialog } from './dialogs/EditProjectDialog.tsx';
import { FirstRunGuideDialog } from './FirstRunGuideDialog.tsx';
import type { DestructiveAction } from './hooks/useDestructiveActionController.ts';
import type { RepositorySet } from './RepositoryProvider.tsx';

interface AppDialogsProps {
  readonly addProjectOpen: boolean;
  readonly appVersion: string;
  readonly canOpenDataDirectory: boolean;
  readonly credentialWarning: string | null;
  readonly dataDirectoryPath: string | null | undefined;
  readonly density: DensityName;
  readonly destructiveAction: DestructiveAction | null;
  readonly editingProject: ProjectSummary | null;
  readonly firstRunGuideError: string | null;
  readonly firstRunGuideOpen: boolean;
  readonly firstRunGuideSaving: boolean;
  readonly projectsRepository: RepositorySet['projects'];
  readonly settingsOpen: boolean;
  readonly onAddProjectOpenChange: (open: boolean) => void;
  readonly onCredentialWarningDismiss: () => void;
  readonly onDensityChange: (density: DensityName) => void;
  readonly onDestructiveActionOpenChange: (open: boolean) => void;
  readonly onEditProjectOpenChange: (open: boolean) => void;
  readonly onFirstRunGuideKeepMock: () => void;
  readonly onFirstRunGuideOpenChange: (open: boolean) => void;
  readonly onFirstRunGuideOpenSettings: () => void;
  readonly onFirstRunGuideSwitchToLive: () => void;
  readonly onOpenDataDirectory: () => Promise<void>;
  readonly onProjectAdded: (project: ProjectSummary) => void;
  readonly onProjectAddSubmit: (input: ProjectAddInput) => Promise<ProjectSummary>;
  readonly onProjectUpdateSubmit: (
    id: string,
    patch: ProjectUpdatePatch,
  ) => Promise<ProjectSummary>;
  readonly onSettingsOpenChange: (open: boolean) => void;
  readonly onSettingsSaved: NonNullable<ComponentProps<typeof SettingsDialog>['onSettingsSaved']>;
}

export function AppDialogs(
  {
    addProjectOpen,
    appVersion,
    canOpenDataDirectory,
    credentialWarning,
    dataDirectoryPath,
    density,
    destructiveAction,
    editingProject,
    firstRunGuideError,
    firstRunGuideOpen,
    firstRunGuideSaving,
    projectsRepository,
    settingsOpen,
    onAddProjectOpenChange,
    onCredentialWarningDismiss,
    onDensityChange,
    onDestructiveActionOpenChange,
    onEditProjectOpenChange,
    onFirstRunGuideKeepMock,
    onFirstRunGuideOpenChange,
    onFirstRunGuideOpenSettings,
    onFirstRunGuideSwitchToLive,
    onOpenDataDirectory,
    onProjectAdded,
    onProjectAddSubmit,
    onProjectUpdateSubmit,
    onSettingsOpenChange,
    onSettingsSaved,
  }: AppDialogsProps,
) {
  return (
    <>
      <SettingsDialog
        appVersion={appVersion}
        {...(canOpenDataDirectory
          ? {
            dataDirectoryPath,
            onOpenDataDirectory,
          }
          : {})}
        density={density}
        open={settingsOpen}
        onDensityChange={onDensityChange}
        onOpenChange={onSettingsOpenChange}
        onSettingsSaved={onSettingsSaved}
      />
      <FirstRunGuideDialog
        errorMessage={firstRunGuideError}
        open={firstRunGuideOpen}
        saving={firstRunGuideSaving}
        onKeepMock={onFirstRunGuideKeepMock}
        onOpenChange={onFirstRunGuideOpenChange}
        onOpenSettings={onFirstRunGuideOpenSettings}
        onSwitchToLive={onFirstRunGuideSwitchToLive}
      />
      <DestructiveActionDialog
        action={destructiveAction}
        onOpenChange={onDestructiveActionOpenChange}
      />
      <AddProjectDialog
        open={addProjectOpen}
        projects={projectsRepository}
        onOpenChange={onAddProjectOpenChange}
        onProjectAdded={onProjectAdded}
        onSubmit={onProjectAddSubmit}
      />
      <EditProjectDialog
        open={Boolean(editingProject)}
        project={editingProject}
        onOpenChange={onEditProjectOpenChange}
        onSubmit={onProjectUpdateSubmit}
      />
      <CredentialWarningToast
        message={credentialWarning}
        onDismiss={onCredentialWarningDismiss}
      />
    </>
  );
}
