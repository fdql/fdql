---
title: Collection jobs
description: Copy, duplicate, export, import, and delete Firestore collections.
---

Collection jobs are long-running Firestore workflows surfaced in a dedicated drawer.

## Job types

- Copy collection between paths or connections.
- Duplicate a collection under a new path.
- Export collection data.
- Import collection data.
- Delete a collection, with explicit destructive confirmation.

## Job drawer

The jobs drawer shows status, progress, summaries, issue states, cancellation, completed-job cleanup, and recent job history.

![Jobs drawer showing a collection copy job with progress and status.](/firebase-desk/screenshots/jobs.png)

## Activity

Job starts, completions, failures, interruptions, and cancellations are recorded in [Activity](../activity/) so you can audit what happened after switching tabs.
