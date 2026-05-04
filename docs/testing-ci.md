# Testing And CI

This doc explains how testing runs in CI, release, and package validation. Test authoring policy lives in `.github/skills/writing-tests/SKILL.md`.

## Test Automation Topology

- Package test scripts extend `packages/config-vitest`.
- Root test scripts run through turbo with caching.
- CI uses coverage-producing unit/integration runs before build.
- E2E CI starts Firebase emulators, seeds data, launches Electron against the emulator profile, and uploads traces/screenshots on failure.
- Release/package workflows build desktop artifacts and run packaged smoke checks on the built app.
- CI and E2E automation must not require production Firebase credentials.

## GitHub Actions From Day One

### Required Workflows

- `ci.yml`: install (pnpm), run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, publish the coverage summary, then `pnpm build`.
- `e2e.yml`: install, build affected workspaces, start Firebase emulators, seed data, run `pnpm test:e2e`, upload traces/screenshots on failure.
- `release-policy.yml`: on PRs to `main`, require exactly one `release:*` label. Normal PRs must not edit package versions. `automation:release-bump` PRs may only edit root and desktop package versions.
- `release-bump.yml`: on push to `main`, inspect merged PR release labels since the latest stable tag, open or update `release/bump`, label it `automation:release-bump`, and enable squash auto-merge. It uses `RELEASE_BOT_TOKEN` because `GITHUB_TOKEN`-created events do not trigger follow-up workflows.
- `release.yml`: on PR, merge to `main`, tag, or ad-hoc dispatch, run CI checks and `pnpm package` for the desktop app. PRs always package Linux, and package macOS/Windows when the PR has the `package-all` label or touches package-sensitive paths (`apps/desktop/**`, `e2e/**`, release workflows, package scripts, or lockfile). `automation:release-bump` PRs emit matching fast no-op package checks. Linux, macOS, and Windows all run the packaged smoke check against the built app. PR and ad-hoc runs upload temporary workflow artifacts with retention. Merges to `main` with a desktop version change create `vX.Y.Z`, publish the stable release, and update `latest`. Manually pushed version tags publish or repair stable releases with release assets, SHA-256 checksums, `release-manifest.json`, and package manager manifest artifacts.

### Required Scripts (root `package.json`, delegated via turbo/pnpm filters)

- `pnpm format`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm typecheck:scripts`
- `pnpm test`
- `pnpm test:boundaries`
- `pnpm test:desktop-packaging`
- `pnpm test:release-version`
- `pnpm test:coverage`
- `pnpm test:e2e`
- `pnpm build`
- `pnpm package`
- `pnpm test:packaged` to launch the most recently built packaged app on the current OS and fail if it exits early.
- `pnpm package:smoke` to build the desktop app for the current OS and immediately run the packaged smoke check.
- `pnpm package:linux:docker` for local Docker reproduction of the Linux release package smoke. The wrapper uses `linux/amd64` and the Docker capability required by Chromium's sandbox.
- `pnpm dev` (desktop app dev server)

### Desktop Packaging Dependencies

- Workspace packages in `apps/desktop/package.json` must be listed in `apps/desktop/src/main/packaging/main-externalize-deps.ts`.
- `@firebase-desk/*` packages export TypeScript source for development. Packaged Electron must bundle them into main/preload/renderer output and must not load them from `node_modules`.
- `apps/desktop/electron-builder.yml` excludes `node_modules/@firebase-desk/**` from `app.asar`; do not rely on workspace package files being present at runtime.
- Main-process third-party runtime deps must be direct `apps/desktop` dependencies.
- `firebase-admin` is bundled into the main-process output because the packaged pnpm layout does not preserve its transitive runtime dependency resolution when it is kept external in `app.asar/node_modules`.
- `scripts/check-package-boundaries.ts` is a repo-level architecture guard for low-level workspace package imports; keep it out of app-scoped test folders.
- `scripts/check-desktop-packaging-contract.ts` is a repo-level guard for the desktop packaging dependency contract.
- `scripts/tsconfig.json` keeps repo-level TypeScript scripts typechecked without pushing those invariants back into app test suites.

### Policy

- Pull requests must pass lint, typecheck, unit tests, and build.
- Pull requests must package Linux before merge. Pull requests that touch desktop packaging, packaged e2e, release workflows, package scripts, or the lockfile must also package macOS and Windows before merge; use the `package-all` label to force the full matrix.
- E2E emulator workflow must exist early, even if first specs are smoke tests.
- Release workflow must exist before the first packaged build is considered done.
- PR package outputs are workflow artifacts only, not GitHub Release assets.
- PR and manual package artifacts use short retention; main and tag artifacts use longer retention.
- Normal PRs must use exactly one release label: `release:patch`, `release:minor`, `release:major`, or `release:none`.
- Normal PRs must not change root or desktop package versions.
- `release:none` means no release.
- Release bump PRs use `automation:release-bump` and may only change root and desktop package versions.
- Merges to `main` with a desktop version change publish `vX.Y.Z` automatically and update the rolling published prerelease `latest`; keep the `latest` tag stable and update assets instead of deleting/recreating the release.
- Merges to `main` without a desktop version change do not publish a rolling release.
- Version tags create or repair separate published stable releases.
- Version tags must match `apps/desktop/package.json`.
- Unsigned builds are published intentionally with SHA-256 checksums; binary signing is not planned.
- Package-manager distribution starts with self-owned Homebrew and Scoop manifests generated from versioned releases.
- First release phase validates unsigned app warnings and install/open smoke on each OS before Firebase feature work continues.
