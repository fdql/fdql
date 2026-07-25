import { CommandPalette } from '@firebase-desk/product-ui';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@firebase-desk/ui';
import { useLayoutEffect, useRef } from 'react';
import type { ActivityStore } from '../app-core/activity/activityStore.ts';
import { AppDialogs } from './AppDialogs.tsx';
import { AppHeader } from './AppHeader.tsx';
import { AppSidebar } from './AppSidebar.tsx';
import { AppWorkspacePanel } from './AppWorkspacePanel.tsx';
import { useAppShellController } from './hooks/useAppShellController.ts';
import {
  COLLAPSED_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MIN_WORKSPACE_WIDTH,
} from './workspaceModel.ts';
import { WorkspaceTabView } from './WorkspaceTabView.tsx';

export interface AppShellProps {
  readonly appVersion: string;
  readonly activityStore?: ActivityStore | undefined;
  readonly dataMode?: 'live' | 'mock';
  readonly demoMode?: boolean | undefined;
  readonly initialSidebarWidth?: number;
}

interface SidebarPanelHandle {
  readonly collapse: () => void;
  readonly expand: () => void;
  readonly getSize: () => { readonly asPercentage: number; readonly inPixels: number; };
  readonly isCollapsed: () => boolean;
  readonly resize: (size: number | string) => void;
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
  const sidebarPanelRef = useRef<SidebarPanelHandle | null>(null);
  const activeView = controller.tabView ? <WorkspaceTabView {...controller.tabView} /> : null;

  useLayoutEffect(() => {
    const sidebarPanel = sidebarPanelRef.current;
    if (!sidebarPanel) return;
    if (controller.layout.sidebarCollapsed) {
      if (!sidebarPanel.isCollapsed()) sidebarPanel.collapse();
      return;
    }
    if (
      sidebarPanel.isCollapsed()
      || sidebarPanel.getSize().inPixels < MIN_SIDEBAR_WIDTH
    ) {
      sidebarPanel.resize(`${controller.layout.sidebarDefaultWidth}px`);
    }
  }, [controller.layout.sidebarCollapsed, controller.layout.sidebarDefaultWidth]);

  return (
    <div className='relative grid h-full overflow-hidden grid-rows-[40px_minmax(0,1fr)] bg-bg-app text-text-primary'>
      <AppHeader {...controller.header} />
      <ResizablePanelGroup direction='horizontal' className='h-full min-h-0 overflow-hidden'>
        <ResizablePanel
          className='h-full overflow-hidden'
          collapsedSize={`${COLLAPSED_SIDEBAR_WIDTH}px`}
          collapsible
          defaultSize={controller.layout.sidebarCollapsed
            ? `${COLLAPSED_SIDEBAR_WIDTH}px`
            : `${controller.layout.sidebarDefaultWidth}px`}
          groupResizeBehavior='preserve-pixel-size'
          minSize={controller.layout.sidebarMinSize}
          onResize={(size, _id, previousSize) =>
            controller.layout.onSidebarResize(size.inPixels, previousSize?.inPixels)}
          panelRef={(panel) => {
            sidebarPanelRef.current = panel;
          }}
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
