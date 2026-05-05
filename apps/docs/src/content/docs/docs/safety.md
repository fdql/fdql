---
title: Safety
description: Data safety model for Firebase Desk.
---

Firebase Desk favors explicit user actions over hidden background work.

## Target visibility

- Project names are visible in the workspace tree.
- Emulator projects show emulator markers.
- Live mode shows live state in app chrome.
- Tabs keep their connection ID.

## Write controls

- Firestore writes are initiated by visible commands.
- Destructive actions use confirmation dialogs.
- Stale field edits can save-and-notify, confirm, or block based on settings.
- Document conflicts are surfaced instead of swallowed.

## Local data

The desktop app stores preferences, workspace state, Activity settings, and project metadata locally. Mock mode reads no Firebase credentials.

## Browser demo

The hosted demo is static and mock-only. It cannot switch to live mode, open local folders, read service account files, or call Firebase.
