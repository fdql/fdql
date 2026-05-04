import {
  ActivityDrawer,
  WorkspaceShell,
  type WorkspaceTabModel,
  WorkspaceTabStrip,
} from '@firebase-desk/product-ui';
import { JobsDrawer } from '@firebase-desk/product-ui/jobs';
import type { ActivityLogEntry, ProjectSummary } from '@firebase-desk/repo-contracts';
import { Badge, Button, IconButton, Toolbar } from '@firebase-desk/ui';
import { Database, RefreshCw } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { AppStatusBar } from './AppStatusBar.tsx';
import { ProjectSwitcher } from './ProjectSwitcher.tsx';
import { RenderErrorBoundary } from './RenderErrorBoundary.tsx';
import type { WorkspaceTab } from './stores/tabsStore.ts';
import { UpdateNotice } from './UpdateNotice.tsx';

interface AppWorkspacePanelProps {
  readonly activeProject: ProjectSummary | null;
  readonly activeTab: WorkspaceTab | undefined;
  readonly activeTabIsRefreshing: boolean;
  readonly activeView: ReactNode;
  readonly activity: {
    readonly area: 'all' | ActivityLogEntry['area'];
    readonly buttonBadge: {
      readonly label: string;
      readonly variant: ComponentProps<typeof Badge>['variant'];
    } | null;
    readonly buttonVariant: ComponentProps<typeof Button>['variant'];
    readonly entries: ReadonlyArray<ActivityLogEntry>;
    readonly expanded: boolean;
    readonly isLoading: boolean;
    readonly open: boolean;
    readonly search: string;
    readonly status: 'all' | ActivityLogEntry['status'];
  };
  readonly lastAction: string;
  readonly jobs: {
    readonly buttonBadge: {
      readonly label: string;
      readonly variant: ComponentProps<typeof Badge>['variant'];
    } | null;
    readonly buttonVariant: ComponentProps<typeof Button>['variant'];
    readonly expanded: boolean;
    readonly isLoading: boolean;
    readonly open: boolean;
    readonly rows: ComponentProps<typeof JobsDrawer>['jobs'];
  };
  readonly projects: ReadonlyArray<ProjectSummary>;
  readonly selectedTreeItemId: string | null;
  readonly tabModels: ReadonlyArray<WorkspaceTabModel>;
  readonly tabsActiveId: string;
  readonly updateNotice: {
    readonly message: string;
    readonly status: 'available' | 'failed';
  } | null;
  readonly onActivityAreaChange: (area: 'all' | ActivityLogEntry['area']) => void;
  readonly onActivityClear: () => void;
  readonly onActivityClose: () => void;
  readonly onActivityExpandedChange: (expanded: boolean) => void;
  readonly onActivityExport: () => void;
  readonly onActivityOpenTarget: (entry: ActivityLogEntry) => void;
  readonly onActivitySearchChange: (search: string) => void;
  readonly onActivityStatusChange: (status: 'all' | ActivityLogEntry['status']) => void;
  readonly onActivityToggle: () => void;
  readonly onJobsCancel: (id: string) => void;
  readonly onJobsClearCompleted: () => void;
  readonly onJobsClose: () => void;
  readonly onJobsExpandedChange: (expanded: boolean) => void;
  readonly onJobsToggle: () => void;
  readonly onCloseAllTabs: () => void;
  readonly onCloseOtherTabs: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  readonly onCloseTabsToLeft: (tabId: string) => void;
  readonly onCloseTabsToRight: (tabId: string) => void;
  readonly onConnectionChange: (connectionId: string) => void;
  readonly onRefreshActiveTab: () => void;
  readonly onReorderTabs: (activeId: string, overId: string) => void;
  readonly onSelectTab: (tabId: string) => void;
  readonly onSortByProject: () => void;
  readonly onUpdateDismiss: () => void;
  readonly onUpdateOpenRelease: () => void;
  readonly onUpdateRetry: () => void;
  readonly onViewError: (message: string) => void;
}

export function AppWorkspacePanel(
  {
    activeProject,
    activeTab,
    activeTabIsRefreshing,
    activeView,
    activity,
    lastAction,
    jobs,
    projects,
    selectedTreeItemId,
    tabModels,
    tabsActiveId,
    updateNotice,
    onActivityAreaChange,
    onActivityClear,
    onActivityClose,
    onActivityExpandedChange,
    onActivityExport,
    onActivityOpenTarget,
    onActivitySearchChange,
    onActivityStatusChange,
    onActivityToggle,
    onJobsCancel,
    onJobsClearCompleted,
    onJobsClose,
    onJobsExpandedChange,
    onJobsToggle,
    onCloseAllTabs,
    onCloseOtherTabs,
    onCloseTab,
    onCloseTabsToLeft,
    onCloseTabsToRight,
    onConnectionChange,
    onRefreshActiveTab,
    onReorderTabs,
    onSelectTab,
    onSortByProject,
    onUpdateDismiss,
    onUpdateOpenRelease,
    onUpdateRetry,
    onViewError,
  }: AppWorkspacePanelProps,
) {
  return (
    <div className='grid h-full min-h-0 overflow-hidden grid-rows-[minmax(0,1fr)_auto_auto_auto_auto]'>
      <WorkspaceShell
        className='h-full min-h-0'
        tabStrip={
          <WorkspaceTabStrip
            activeTabId={tabsActiveId}
            projects={projects}
            tabs={tabModels}
            onCloseAllTabs={onCloseAllTabs}
            onCloseTab={onCloseTab}
            onCloseOtherTabs={onCloseOtherTabs}
            onCloseTabsToLeft={onCloseTabsToLeft}
            onCloseTabsToRight={onCloseTabsToRight}
            onReorderTabs={onReorderTabs}
            onSelectTab={onSelectTab}
            onSortByProject={onSortByProject}
          />
        }
        toolbar={
          <Toolbar aria-label='Workspace toolbar'>
            <span className='flex min-w-0 flex-1 items-center gap-2'>
              <Database size={14} aria-hidden='true' />
              <span className='truncate text-sm font-semibold text-text-primary'>
                {activeTab?.title ?? 'No tab'}
              </span>
            </span>
            {activeProject
              ? (
                <>
                  <ProjectSwitcher
                    activeProject={activeProject}
                    projects={projects}
                    onConnectionChange={onConnectionChange}
                  />
                  <IconButton
                    disabled={activeTabIsRefreshing}
                    icon={
                      <RefreshCw
                        className={activeTabIsRefreshing ? 'animate-spin' : undefined}
                        size={14}
                        aria-hidden='true'
                      />
                    }
                    label={activeTabIsRefreshing ? 'Refreshing tab' : 'Refresh tab'}
                    size='xs'
                    variant='ghost'
                    onClick={onRefreshActiveTab}
                  />
                </>
              )
              : null}
          </Toolbar>
        }
      >
        <RenderErrorBoundary
          label={activeTab?.title ?? 'Workspace'}
          resetKey={activeTab?.id ?? 'empty'}
          onError={onViewError}
        >
          {activeView}
        </RenderErrorBoundary>
      </WorkspaceShell>
      {updateNotice
        ? (
          <UpdateNotice
            message={updateNotice.message}
            status={updateNotice.status}
            onDismiss={onUpdateDismiss}
            onOpenRelease={onUpdateOpenRelease}
            onRetry={onUpdateRetry}
          />
        )
        : null}
      <ActivityDrawer
        area={activity.area}
        entries={activity.entries}
        expanded={activity.expanded}
        isLoading={activity.isLoading}
        open={activity.open}
        search={activity.search}
        status={activity.status}
        onAreaChange={onActivityAreaChange}
        onClear={onActivityClear}
        onClose={onActivityClose}
        onExport={onActivityExport}
        onExpandedChange={onActivityExpandedChange}
        onOpenTarget={onActivityOpenTarget}
        onSearchChange={onActivitySearchChange}
        onStatusChange={onActivityStatusChange}
      />
      <JobsDrawer
        expanded={jobs.expanded}
        isLoading={jobs.isLoading}
        jobs={jobs.rows}
        open={jobs.open}
        onCancel={onJobsCancel}
        onClearCompleted={onJobsClearCompleted}
        onClose={onJobsClose}
        onExpandedChange={onJobsExpandedChange}
      />
      <AppStatusBar
        activeProject={activeProject}
        activeTabTitle={activeTab?.title ?? 'No tab'}
        activityBadge={activity.buttonBadge}
        activityButtonVariant={activity.buttonVariant}
        activityOpen={activity.open}
        jobsBadge={jobs.buttonBadge}
        jobsButtonVariant={jobs.buttonVariant}
        jobsOpen={jobs.open}
        lastAction={lastAction}
        selectedTreeItemId={selectedTreeItemId}
        onActivityToggle={onActivityToggle}
        onJobsToggle={onJobsToggle}
      />
    </div>
  );
}
