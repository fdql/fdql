---
title: Feature reference
description: Complete Firebase Desk feature inventory.
---

## Top workflows

1. **Multi-project workspace**: manage emulator, staging, production, and mock projects in one tree.
2. **Per-tab environment context**: Firestore, Auth, and JavaScript Query tabs keep their selected connection.
3. **Mock-first exploration**: sample data works without Firebase credentials and powers the hosted browser demo.
4. **Firestore tree**: root collections, documents, nested subcollections, refresh states, loading states, and errors.
5. **Firestore query builder**: path, filters, sort, limit, run, reset, pagination, and stale-result markers.
6. **Result views**: table, nested tree, and JSON views for Firestore query output.
7. **Document detail**: selected-document inspector with encoded Firestore values and subcollection controls.
8. **Document writes**: create, save JSON, patch fields, generate IDs, and delete documents.
9. **Conflict handling**: document-changed and stale-field flows are visible instead of hidden.
10. **Collection jobs**: copy, duplicate, export, import, and delete collection workflows.
11. **Jobs drawer**: job status, progress counters, cancellation, cleanup, issue acknowledgement, and history.
12. **Auth users**: list, search/filter, paginate, inspect, and edit custom claims.
13. **JavaScript Query**: run scripts, cancel runs, stream logs/output, inspect arrays, objects, documents, and errors.
14. **Firestore SQL beta**: read-only SQL tab with joins, projections, live stats, cancel, and generated JavaScript Query snippets.
15. **Activity log**: local audit trail for operations, issues, metadata, exports, and target reopening.
16. **Command palette and hotkeys**: keyboard-first access to tabs, query/run actions, theme, and settings.

## Workspace

- Add emulator accounts.
- Add production service-account accounts in the desktop app.
- Validate service account JSON.
- Pick service account files in the desktop app.
- Edit account display names and emulator hosts.
- Remove accounts from the workspace tree.
- Show emulator badges.
- Show live/mock data mode.
- Persist sidebar width.
- Collapse and expand the sidebar.
- Filter workspace tree items.
- Open Firestore, Authentication, and JavaScript Query from the tree.
- Refresh Firestore nodes.
- Use tab back/forward interaction history.
- Reorder tabs.
- Close current, other, left, right, or all tabs.
- Sort tabs by project.
- Restore workspace tabs, drafts, scripts, and filters.

## Firestore

- Load root collections.
- Load documents for a collection.
- Load subcollections for a document.
- Open collection paths in current or new tabs.
- Open documents in new tabs.
- Build filters with field, operator, and JSON/string value parsing.
- Sort by field and direction.
- Set query limits.
- Load additional pages.
- Switch table/tree/JSON result views.
- Inspect nested maps and arrays.
- Render Firestore timestamp, geo point, reference, bytes, vector, scalar, null, and nested values.
- Track field catalogs from query results.
- Preserve table layout metadata.
- Create collections through first-document creation.
- Create documents with generated or manual IDs.
- Edit document JSON.
- Patch individual fields.
- Delete documents.
- Include or omit subcollections during delete workflows.
- Handle write conflicts.
- Configure stale field edit behavior.
- Mark results stale after relevant writes.
- Estimate document size.
- Show empty, loading, success, and error states.

## Firestore SQL beta

- Open a dedicated SQL tab from the workspace tree or command palette.
- Prepare a query before running it.
- Run read-only `select` queries.
- Run top-level `union all`.
- Join collections with inner or left equality joins.
- Expand arrays with `unnest()`.
- Expand maps with `entries()`, `key()`, and `value()`.
- Read document metadata with `id()`, `path()`, and `project_id()`.
- Use context aliases for project targets.
- Review issues for unsupported commands and failed preparation.
- Stream rows into a result table.
- Track reads, scanned rows, output rows, and join misses.
- Cancel an active run.
- Pick between result rows, issues, and generated Firebase Desk JavaScript Query snippets in the output tabs.
- Keep SQL writes disabled in the product UI.

## Authentication

- List Auth users.
- Search/filter users.
- Load more paginated users.
- Select users from the table.
- Inspect UID, email, display name, disabled state, provider, and custom claims.
- Edit custom claims.
- Clear auth selection when changing tab connection.
- Record Auth operations in Activity.

## JavaScript Query

- Run scripts against the active connection.
- Cancel active runs.
- Persist script source per tab.
- Stream logs.
- Stream yielded output.
- Render returned arrays and objects.
- Render document-like values.
- Render query-snapshot-like table output.
- Display errors with message, code, name, and stack.
- Display empty-result states.
- Record script run success/failure in Activity.

## Jobs

- Start copy collection jobs.
- Start duplicate collection jobs.
- Start export collection jobs.
- Start import collection jobs.
- Start delete collection jobs.
- Pick export/import files in the desktop app.
- Show read, written, deleted, skipped, failed, and total progress counters.
- Cancel non-final jobs.
- Clear completed jobs.
- Acknowledge failed/interrupted jobs.

## Activity

- Record Firestore, Auth, JavaScript Query, jobs, projects, settings, workspace, and app events.
- Track success, failure, conflict, and cancelled statuses.
- Show unread issue badges for failures and conflicts.
- Search Activity entries.
- Filter Activity by area and status.
- Expand Activity detail.
- Inspect target, metadata, payload, error, and duration detail.
- Export Activity entries.
- Clear Activity with confirmation.
- Open Firestore/Auth targets from Activity entries.
- Configure metadata-only or full-payload detail capture.
- Prune older entries by local retention size.

## Settings and app chrome

- Light, dark, and system appearance modes.
- Compact and comfortable density.
- Mock/live data source setting.
- Activity logging enable/disable.
- Activity detail mode.
- Activity retention size.
- Firestore stale field edit behavior.
- Clear Firestore field catalog and table layout metadata.
- Open local data folder in desktop app.
- Show credential storage summary.
- Show app version and license.
- Manual update checks in desktop app.
- Dismiss update notices.
- Show render error boundary with retry.
- Show boot splash and retryable boot failures.
- Browser demo mode locks to sample data and hides live-only actions.
