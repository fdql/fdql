import { CommandPalette } from '@firebase-desk/product-ui';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@firebase-desk/ui';
import type { ActivityStore } from '../app-core/activity/activityStore.ts';
import { AppDialogs } from './AppDialogs.tsx';
import { AppHeader } from './AppHeader.tsx';
import { AppSidebar } from './AppSidebar.tsx';
import { AppWorkspacePanel } from './AppWorkspacePanel.tsx';
import { useAppShellController } from './hooks/useAppShellController.ts';
import { DEFAULT_SIDEBAR_WIDTH, MIN_WORKSPACE_WIDTH } from './workspaceModel.ts';
import { WorkspaceTabView } from './WorkspaceTabView.tsx';

export interface AppShellProps {
  readonly appVersion: string;
  readonly activityStore?: ActivityStore | undefined;
  readonly dataMode?: 'live' | 'mock';
  readonly demoMode?: boolean | undefined;
  readonly initialSidebarWidth?: number;
}

export function AppShell(
  {
    activityStore,
    appVersion,
    dataMode = 'mock',
    demoMode = false,
    initialSidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  }: AppShellProps,
) {
  const controller = useAppShellController({
    activityStore,
    appVersion,
    dataMode,
    demoMode,
    initialSidebarWidth,
  });
  const activeView = controller.tabView ? <WorkspaceTabView {...controller.tabView} /> : null;

  return (
    <div className='relative grid h-full overflow-hidden grid-rows-[40px_minmax(0,1fr)] bg-bg-app text-text-primary'>
      <AppHeader {...controller.header} />
      <ResizablePanelGroup direction='horizontal' className='h-full min-h-0 overflow-hidden'>
        <ResizablePanel
          className='h-full overflow-hidden'
          defaultSize={controller.layout.sidebarCollapsed
            ? '40px'
            : `${controller.layout.sidebarDefaultWidth}px`}
          groupResizeBehavior='preserve-pixel-size'
          maxSize={controller.layout.sidebarMaxSize}
          minSize={controller.layout.sidebarMinSize}
          onResize={(size) => controller.layout.onSidebarResize(size.inPixels)}
        >
          <AppSidebar {...controller.sidebar} />
        </ResizablePanel>
        <ResizableHandle className='h-full w-px' />
        <ResizablePanel className='h-full overflow-hidden' minSize={`${MIN_WORKSPACE_WIDTH}px`}>
          <AppWorkspacePanel {...controller.workspace} activeView={activeView} />
        </ResizablePanel>
      </ResizablePanelGroup>
      <AppDialogs {...controller.dialogs} />
      <CommandPalette commands={controller.commands} />
    </div>
  );
}
