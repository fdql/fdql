---
name: docs-update
description: Update Firebase Desk README and GitHub Pages docs when app features or meaningful behavior changes; inspect real feature sources, refresh docs, and capture real mock-mode screenshots.
---

# Docs Update

Use this skill when Firebase Desk docs, README content, docs screenshots, or docs site pages need to reflect current app behavior.

## Workflow

1. Read `references/feature-sources.md` for the source-to-docs map.
2. Inspect the real app source for the changed feature before writing docs.
3. Update only factual docs content in:
   - `README.md`
   - `apps/docs/src/index.html`
   - `apps/docs/src/getting-started.html`
   - `apps/docs/src/features.html`
   - `apps/docs/src/safety.html`
   - `apps/docs/src/troubleshooting.html`
   - `apps/docs/src/roadmap.html`
4. If screenshots need updating, capture them from the app. Do not invent screenshots.
5. Run `pnpm build` before screenshot capture when desktop source changed.
6. Run `pnpm docs:screenshots` to update:
   - `apps/docs/src/assets/screenshots/first-run.png`
   - `apps/docs/src/assets/screenshots/workspace.png`
   - `apps/docs/src/assets/screenshots/auth.png`
7. Run `pnpm docs:build` and relevant root checks.

## Rules

- Keep docs concise and user-facing.
- Prefer current UI labels over internal names.
- Document mock mode, emulator mode, and production mode distinctly.
- Mention safety limits for production writes and unsigned builds.
- Update the screenshot capture script when a new docs screenshot is needed.
- Do not add generated docs that cannot be traced to current source behavior.
