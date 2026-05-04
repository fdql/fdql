# Firebase Desk Feature Sources

Use these entry points when updating docs.

## App Shell And Onboarding

- `apps/desktop/src/renderer/app/AppHeader.tsx`
- `apps/desktop/src/renderer/app/AppStatusBar.tsx`
- `apps/desktop/src/renderer/app/AppWorkspacePanel.tsx`
- `apps/desktop/src/renderer/app/FirstRunGuideDialog.tsx`
- `apps/desktop/src/renderer/app/ProjectSwitcher.tsx`
- `apps/desktop/src/renderer/app/RepositoryProvider.tsx`
- `apps/desktop/src/renderer/app/UpdateNotice.tsx`
- `apps/desktop/src/renderer/app/commandPaletteModel.ts`
- `apps/desktop/src/renderer/app/hooks/useAppShellController.ts`
- `apps/desktop/src/renderer/app/hooks/useAppShellHotkeys.ts`
- `apps/desktop/src/renderer/app/appShellOrchestrator.ts`
- `apps/desktop/src/renderer/app-core/activity/`
- `apps/desktop/src/renderer/app-core/jobs/`
- `apps/desktop/src/renderer/app-core/updates/`
- `packages/hotkeys/src/registry.ts`
- `packages/product-ui/src/activity/ActivityDrawer.tsx`
- `packages/product-ui/src/jobs/JobsDrawer.tsx`
- `packages/product-ui/src/settings-dialog/SettingsDialog.tsx`
- `apps/desktop/src/main/app/data-mode.ts`
- `packages/repo-contracts/src/settings.ts`
- `packages/repo-mocks/src/settings.ts`

## Workspace And Navigation

- `apps/desktop/src/renderer/app/WorkspaceTabView.tsx`
- `apps/desktop/src/renderer/app/workspaceModel.ts`
- `apps/desktop/src/renderer/app-core/workspace/`
- `packages/product-ui/src/features/projects/AccountTree.tsx`
- `packages/product-ui/src/features/tabs/WorkspaceTabStrip.tsx`

## Firestore

- `packages/product-ui/src/features/firestore/`
- `apps/desktop/src/renderer/app/hooks/useFirestoreTabState.ts`
- `apps/desktop/src/renderer/app-core/firestore/`
- `apps/desktop/src/main/ipc/firestore-handlers.ts`
- `packages/repo-mocks/src/fixtures/index.ts`

## Authentication

- `packages/product-ui/src/features/auth/AuthUsersSurface.tsx`
- `apps/desktop/src/renderer/app/hooks/useAuthTabState.ts`
- `apps/desktop/src/renderer/app-core/auth/`
- `apps/desktop/src/main/ipc/auth-handlers.ts`
- `packages/repo-mocks/src/fixtures/index.ts`

## JavaScript Query

- `packages/product-ui/src/features/js-query/`
- `apps/desktop/src/renderer/app/hooks/useJsTabState.ts`
- `packages/script-runner/src/`
- `apps/desktop/src/main/ipc/script-handlers.ts`

## Docs And Screenshots

- `apps/docs/src/`
- `e2e/scripts/capture-doc-screenshots.mjs`
- `package.json` scripts `docs:build` and `docs:screenshots`
