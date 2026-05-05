---
title: Troubleshooting
description: Common Firebase Desk setup and workflow checks.
---

## Demo does not load

The browser demo is a static build inside the docs site. Rebuild docs with `pnpm docs:build`, then serve `apps/docs/.build/site` and open `/firebase-desk/demo/`.

## Firestore tree is empty

- Confirm the active connection is the expected account.
- Refresh the Firestore node.
- For emulators, check `FIRESTORE_EMULATOR_HOST` or the host configured in the account.
- Try mock mode to separate UI behavior from Firebase setup.

## Auth users do not show

- Confirm the Auth emulator host or production credentials.
- Check the selected connection.
- Clear the user filter.
- Try loading more users if pagination is available.

## JavaScript Query fails

- Check that the script targets the selected connection.
- Review logs and error output in the result panel.
- Re-run against emulator/mock data before production.

## Settings do not persist

Open Settings and check the local data location in the desktop app. The browser demo intentionally resets because it uses in-memory mock repositories.
