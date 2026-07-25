# FDQL Transition Plan

Working tracker for the clean rename and FDQL launch. Git history may retain the old name; the
current source tree, runtime identity, documentation, and published assets should not.

## Status

- [x] GitHub organization `fdql`
- [x] npm organization `@fdql`
- [x] Domains `fdql.io` and `fdql.dev`
- [x] Cloudflare security, renewal, and email routing
- [x] Visual Studio Marketplace publisher `fdql`
- [x] Desktop application name `FDQL Studio`
- [x] Brand architecture confirmed
- [x] Repository transferred and renamed to `fdql/fdql`
- [ ] Source and runtime renamed
- [ ] Public npm packages published through CI
- [ ] Website and redirects live
- [ ] Desktop runtime and releases renamed
- [ ] Legacy-name audit clean

Owners used below:

- **User**: account, billing, domain, or GitHub settings
- **Codex**: repository changes and verification
- **Both**: product decision first, implementation second

## 1. Confirm Brand Architecture

Owner: **Both**. Blocks the mechanical rename and public package names.

- [x] Expand `FDQL` as **Federated Data Query Language**.
- [x] Define FDQL as a provider-neutral pipeline language and runtime for querying, transforming,
      and updating data through pluggable data-source adapters.
- [x] Use `FDQL` for the language, framework, and umbrella organization.
- [x] Name the desktop application `FDQL Studio`.
- [x] Name the monorepo `fdql`.
- [x] Use this initial public package map:
  - `fdql`: friendly main package and optional CLI
  - `@fdql/core`: parser, planner, and provider-neutral runtime contracts
  - `@fdql/firestore`: Firestore provider
  - `@fdql/language`: editor/language-service integration, if independently useful
- [x] Keep every other workspace package private unless it becomes independently useful.

Exit condition: public names and package responsibilities are written down and unambiguous.

## 2. Move and Rename the Repository

Owner: **User** for GitHub settings, then **Codex** for local configuration.

- [x] Transfer the repository to the `fdql` GitHub organization.
- [x] Rename the repository to `fdql`.
- [x] Confirm the active `main` ruleset, Actions permissions, environments, secret names, labels,
      Pages configuration, and release assets transferred.
- [x] Update the local `origin` URL to `git@github.com:fdql/fdql.git`.
- [x] Confirm issues, releases, tags, and Actions history remain available.

Exit condition: GitHub organization, repository URL, and local remote all use the new identity.

## 3. Rename the Current Source Tree and Runtime

Owner: **Codex**.

Current audit: the old identity appears across 24 package manifests and hundreds of source,
test, documentation, workflow, and generated-reference files.

- [ ] Rename root and workspace package names from the old scope to `@fdql`.
- [ ] Update imports, dependency declarations, scripts, filters, TypeScript references, and the
      lockfile.
- [ ] Replace repository URLs, documentation links, release URLs, and source metadata.
- [ ] Rename desktop product strings to `FDQL Studio`.
- [ ] Replace Electron and installer identity:
  - application ID
  - product and executable names
  - artifact names
  - Linux package metadata
  - OS integration identifiers
- [ ] Rename current settings, storage, fixture, cache, and generated-data identifiers. No
      migration layer is needed because the app is not in production.
- [ ] Rename directories and files where the old identity is part of the public or runtime name.
- [ ] Regenerate icons or brand assets after visual identity is decided.
- [ ] Update architectural documentation so FDQL is provider-neutral and the desktop app is a
      consumer.

Exit condition: the application builds and runs using only the chosen current identities.

## 4. Publish the FDQL Packages

Owner: **Both**.

This can run in parallel with website work after sections 1–3 establish stable package names.

- [ ] Make each public package independently useful; do not publish placeholders.
- [ ] Define compiled outputs, exports, types, files, license, repository, keywords, and supported
      Node versions.
- [ ] Decide versioning policy for the initial packages.
- [ ] Add package build and package-content checks.
- [ ] Add npm publishing through GitHub Actions using trusted publishing where supported.
- [ ] Require tests, typecheck, build, and package smoke checks before publishing.
- [ ] Publish prerelease versions first.
- [ ] Verify clean installs in a temporary consumer project.
- [ ] Publish the first stable versions when APIs are ready.
- [ ] Publish unscoped `fdql` only when it provides a real API or CLI.

Exit condition: consumers can install documented packages from npm without relying on monorepo
source files.

## 5. Launch the Web Identity

Owner: **Codex** for site changes, **User** for Cloudflare/GitHub settings.

- [ ] Use `https://fdql.io` as the canonical site.
- [ ] Redirect `https://fdql.dev` permanently to `https://fdql.io`.
- [ ] Choose documentation location. Recommended default: `https://docs.fdql.io`.
- [ ] Replace the current GitHub Pages base path and old repository links.
- [ ] Configure DNS, GitHub Pages custom domains, HTTPS, and canonical metadata.
- [ ] Publish a minimal homepage: purpose, example, install command, documentation, and GitHub.
- [ ] Add `security@fdql.io` and a support/contact route where appropriate.
- [ ] Test apex, `www`, documentation, redirects, HTTPS, and social preview metadata.

Exit condition: both domains resolve intentionally and all public links use `fdql.io`.

## 6. Rebuild Release and Distribution Identity

Owner: **Codex** for automation, **User** for GitHub settings or credentials.

- [ ] Update CI package filters and invariant checks.
- [ ] Update release notes, manifests, download URLs, filenames, and checksums.
- [ ] Confirm GitHub release workflows target the renamed repository.
- [ ] Decide whether desktop versioning stays independent from npm package versions.
- [ ] Recreate the rolling release under the new product identity.
- [ ] Update Homebrew, Scoop, winget, and other future distribution names before publishing them.
- [ ] Reserve VS Code extension names only when a functional extension exists; publish through the
      `fdql` publisher.

Exit condition: source, npm, desktop, and editor releases have clear and non-conflicting names.

## 7. Verify and Remove Legacy

Owner: **Codex**, with **User** confirming external accounts.

- [ ] Run formatting, lint, typecheck, tests, build, packaging, and relevant end-to-end checks.
- [ ] Install and open packaged desktop builds on supported operating systems.
- [ ] Test npm packages from packed tarballs and from the public registry.
- [ ] Search the current tree for old names, scopes, URLs, application IDs, and storage keys.
- [ ] Check GitHub, npm, domains, Marketplace, release downloads, and documentation manually.
- [ ] Remove transitional aliases, compatibility shims, and temporary redirect code.
- [ ] Remove or rewrite this tracker so the old identity does not remain in the current tree.

Exit condition: only Git history retains the previous identity.

## Deferred Until There Is Demand

- Social accounts beyond channels that will be actively maintained
- Docker Hub organization
- Open VSX namespace
- Additional domains
- Trademark registration
- Paid email hosting
