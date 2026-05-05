---
title: JavaScript Query
description: Run admin-style JavaScript against the selected Firebase connection.
---

JavaScript Query is for developer/admin scripts that need quick inspection output, not a deployed backend.

## Runtime model

- Run a script against the active connection.
- Cancel running scripts.
- Stream logs and yielded values.
- Inspect returned values as JSON or table output.
- Keep script source per tab.

## Result types

The UI handles plain objects, arrays, document-like values, query snapshots, log entries, errors, and empty results.

![JavaScript Query editor with streamed output and log entries.](/firebase-desk/screenshots/js-query.png)

## Safety

Scripts are connection-scoped. In the browser demo they run against mock repositories only. In the desktop app, use emulator profiles first and keep production tabs visibly named.

## Activity

Script runs, cancellations, failures, and duration are recorded in Activity. Use this to keep a local trail of ad hoc admin work, especially when scripts touch staging or production data.
