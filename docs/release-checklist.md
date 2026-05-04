# Release Checklist

Use this for unsigned releases. Normal PRs declare release intent with one `release:*` label and never edit versions. After merge, `release-bump.yml` opens the version-only release PR. When that PR merges, `release.yml` publishes the stable release. `latest` mirrors the newest versioned `main` release. Signing/notarization/code-signing are intentionally out of scope.

## Release Automation Setup

- [ ] Labels exist: `release:patch`, `release:minor`, `release:major`, `release:none`, `automation:release-bump`.
- [ ] Repo secret `RELEASE_BOT_TOKEN` exists.
- [ ] `RELEASE_BOT_TOKEN` is a fine-grained PAT or GitHub App token, not `GITHUB_TOKEN`.
- [ ] Token has access only to this repo.
- [ ] Token permissions: contents read/write, pull requests read/write, issues read/write.
- [ ] Repo auto-merge is enabled.
- [ ] `main` requires PRs and required check `release-policy`.
- [ ] `main` blocks force pushes.

## Before Merge

- [ ] `ci.yml` green.
- [ ] `e2e.yml` green.
- [ ] `release-policy.yml` green.
- [ ] PR has exactly one release label: `release:patch`, `release:minor`, `release:major`, or `release:none`.
- [ ] PR does not change root or desktop package versions.
- [ ] `release.yml` PR package job green.
- [ ] PR package artifacts uploaded with expected channel, OS, architecture, and target names.
- [ ] PR package artifacts include matching `SHA256SUMS*.txt` files.
- [ ] Linux packaged smoke passed.
- [ ] macOS packaged smoke passed if the PR ran the full matrix.
- [ ] Windows unpacked-app check passed if the PR ran the full matrix.

## Main Release

- [ ] Merge to `main`.
- [ ] Confirm `release-bump.yml` opens or updates `Release vX.Y.Z` when merged PRs need a release.
- [ ] Confirm release bump PR has label `automation:release-bump`.
- [ ] Confirm release bump PR only changes root and desktop package versions.
- [ ] Confirm release bump PR auto-merges.
- [ ] `release.yml` package job green on macOS, Windows, and Linux.
- [ ] Version tag `vX.Y.Z` created from `apps/desktop/package.json`.
- [ ] Stable GitHub release `vX.Y.Z` created or updated.
- [ ] `release-manifest.json` attached to `vX.Y.Z`.
- [ ] Package manager manifest workflow artifact exists.
- [ ] `latest` tag exists.
- [ ] `latest` prerelease created or updated.
- [ ] Release assets attached for macOS, Windows, and Linux targets on `vX.Y.Z` and `latest`.
- [ ] Matching `SHA256SUMS*.txt` assets attached for macOS, Windows, and Linux packages.
- [ ] Download each `vX.Y.Z` asset.
- [ ] Verify every downloaded asset against the matching `SHA256SUMS*.txt` file.
- [ ] Install/open macOS asset.
- [ ] Install/open Windows asset.
- [ ] Install/open Linux asset.

## First Release

- [ ] Confirm root and desktop package versions are `0.0.1`.
- [ ] Merge the release PR.
- [ ] Confirm `release.yml` creates tag `v0.0.1`.
- [ ] Confirm `release.yml` creates a published GitHub release for `v0.0.1`.
- [ ] Download each versioned asset.
- [ ] Verify every downloaded asset against the matching `SHA256SUMS*.txt` file.
- [ ] Install/open macOS asset.
- [ ] Install/open Windows asset.
- [ ] Install/open Linux asset.
- [ ] Confirm release notes mention unsigned binaries and checksum verification.
- [ ] Confirm assets are publicly downloadable.
- [ ] Confirm `release-manifest.json` is attached.
- [ ] Confirm package manager manifest workflow artifact exists.

## Later Distribution

- [ ] Self-owned Homebrew tap cask.
- [ ] Self-owned Scoop bucket manifest.
- [ ] winget manifest.
- [ ] Linux package manager path, if demand justifies it.
- [ ] Public download copy and support policy.
