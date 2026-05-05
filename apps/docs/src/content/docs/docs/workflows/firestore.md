---
title: Firestore
description: Firestore browsing, querying, document edits, and collection jobs.
---

Firestore is the deepest Firebase Desk surface.

## Browse

- Load root collections per connection.
- Expand documents and nested subcollections.
- Filter the workspace tree.
- Open collections or documents into tabs.
- Use back/forward tab interaction history.

## Query

- Run collection queries from the active tab.
- Set field filters, sort direction, and limits.
- Page through large result sets.
- Switch result views between table, tree, and JSON.
- Inspect document size estimates, metadata, and nested values.

![Firestore query results in table view with an orders collection selected.](/firebase-desk/screenshots/workspace.png)

## Write

- Create collections by creating the first document.
- Create documents with generated or manual IDs.
- Edit whole document JSON.
- Patch fields from context menus.
- Delete documents with optional subcollection handling.
- Resolve save conflicts and stale field edits.

![Document JSON editor opened for a Firestore order document.](/firebase-desk/screenshots/document-edit.png)

## Jobs

Collection jobs support copy, duplicate, export, import, and delete. Jobs run through the jobs drawer, emit status/progress, and create Activity entries.

## Activity

Firestore queries, writes, conflicts, and collection jobs create Activity entries with connection and path context. Use Activity when you need to confirm which environment a write touched or reopen a target after switching tabs.
