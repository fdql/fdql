# Package Managers

Firebase Desk starts package-manager distribution with self-owned manifests generated from stable version releases.

## Channels

- GitHub Releases remain the source of binaries and checksums.
- `latest` mirrors the newest versioned `main` release for smoke testing.
- Merging the generated `automation:release-bump` PR creates `vX.Y.Z` tags and stable releases.
- Manually pushed `vX.Y.Z` tags can publish or repair stable releases.
- Generated package-manager manifests are workflow artifacts on stable version releases.

## First Targets

- Homebrew tap: `viniciusrmcarneiro/homebrew-tap`.
- Scoop bucket: `viniciusrmcarneiro/scoop-bucket`.
- winget comes after one successful stable release.

## Release Requirements

- Root and desktop package versions must match.
- Normal PRs to `main` must use exactly one release label and must not edit package versions.
- `release:none` means no package-manager update is expected.
- Tag `vX.Y.Z` must match desktop version `X.Y.Z`.
- Each release must include package assets, `SHA256SUMS*.txt`, and `release-manifest.json`.

## Unsigned Builds

Package managers provide checksums and easier updates, not code signing. macOS Gatekeeper and Windows SmartScreen warnings are still expected until signing policy changes.
