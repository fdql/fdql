---
name: docs-update
description: Update Firebase Desk README, Astro/Starlight docs, browser demo copy, and screenshots when app features or meaningful behavior changes; inspect real feature sources before editing docs.
---

# Docs Update

Use this skill when Firebase Desk docs, README content, docs screenshots, landing page, or browser demo framing need to reflect current app behavior.

## Workflow

1. Read `references/feature-sources.md` for the source-to-docs map.
2. Inspect the real app source for the changed feature before writing docs.
3. Update only factual docs content in:
   - `README.md`
   - `apps/docs/src/pages/index.astro`
   - `apps/docs/src/pages/demo.astro`
   - `apps/docs/src/content/docs/docs/index.md`
   - `apps/docs/src/content/docs/docs/getting-started.md`
   - `apps/docs/src/content/docs/docs/features.md`
   - `apps/docs/src/content/docs/docs/safety.md`
   - `apps/docs/src/content/docs/docs/troubleshooting.md`
   - `apps/docs/src/content/docs/docs/roadmap.md`
   - `apps/docs/src/content/docs/docs/workflows/*.md`
4. If screenshots need updating, capture them from the app. Do not invent screenshots.
5. Run `pnpm build` before screenshot capture when desktop source changed.
6. Run `pnpm docs:screenshots` to update:
   - `apps/docs/src/assets/screenshots/first-run.png`
   - `apps/docs/src/assets/screenshots/workspace.png`
   - `apps/docs/src/assets/screenshots/auth.png`
7. Run `pnpm docs:build` and relevant root checks.
8. Run `pnpm docs:smoke` when landing page, Starlight docs, search, or browser demo behavior changes.
9. Use `pnpm docs:dev` when checking the local docs site; it builds and serves the browser demo iframe path.

## Rules

- Keep docs concise and user-facing.
- Prefer current UI labels over internal names.
- Keep the landing page custom and product-led; do not make it look like a default docs template.
- Keep Starlight for docs pages and Pagefind search.
- Document mock mode, emulator mode, and production mode distinctly.
- Browser demo docs must state that it is mock-only and refresh-reset.
- Mention safety limits for production writes and unsigned builds.
- Update the screenshot capture script when a new docs screenshot is needed.
- Do not add generated docs that cannot be traced to current source behavior.
