---
name: writing-tests
description: 'Author or modify tests in firebase-desk (unit, integration, E2E, repo contract, packaged smoke). USE WHEN: adding a new test, editing existing tests, naming test files, deciding between unit vs integration vs E2E, choosing between repo-mocks vs real Firebase, writing Playwright Electron specs, picking test names, structuring assertions, or wiring vitest/turbo. Covers naming rules, AAA, mocking policy, role-based queries, contract test placement, and emulator-based E2E rules.'
---

# Writing Tests (firebase-desk)

This skill is the authority for writing tests in Firebase Desk. It must be enough on its own for deciding what to test, where to put it, what type to use, how to structure it, and what practices to avoid.

## When To Use

Load this before creating, renaming, restructuring, or non-trivially editing any test: unit, integration, E2E, repository contract, packaged smoke, test helper, fixture, builder, or matcher.

## Core Rules

- UI code and UI tests use repository contracts only (`packages/repo-contracts`).
- `packages/repo-mocks` is the first-class fixture for UI and feature tests.
- No automated test may require production Firebase credentials.
- Test observable behavior and normalized contract shapes, not implementation details.
- Keep tests in the owning package/app unless the test is a repo-level guard or E2E spec.
- Follow nearby test style, but do not preserve bad patterns when this skill says otherwise.
- Do not add exports only for tests. If a unit cannot be tested through a real production module boundary, refactor the boundary.

## Test-Writing Flow

1. Identify the behavior the user wants proven. Write it as a user-observable or contract-observable outcome before touching files.
2. Locate the owning package/app and read nearby tests. Copy local style, helpers, fixtures, and assertion shape.
3. Choose the narrowest test type that proves the behavior. Unit is default; integration and E2E need a reason.
4. Arrange through public inputs, repo-mocks, deterministic fixtures, or real collaborators where practical.
5. Act like the caller/user: call a public API, dispatch a command, run the adapter, or perform a user action.
6. Assert one specific outcome. Split separate outcomes into separate tests.
7. Add or reuse helpers only when they clarify the behavior or remove real duplication.
8. Run the relevant root-level check. Never use package `--filter` for validation in this repo.

## Repo Test Harness

- Each package extends `packages/config-vitest` for Vitest setup.
- Turbo runs `test` across packages with caching.
- Unit and integration tests use `*.test.*` or rare `*.integration.test.*` files inside the owning workspace.
- E2E tests live in the `e2e` workspace and use the Firebase Emulator Suite.
- Repo-level guards live under `scripts` and run through root scripts such as `pnpm test:boundaries` and `pnpm test:desktop-packaging`.

## Choosing Scope

Use the smallest test type that proves the real behavior.

- **Unit test (`*.test.*`)**: default. Use for pure functions, reducers, app-core transitions, formatting, validation, component rendering, and isolated feature behavior.
- **Component test (`*.test.*`)**: use for React rendering, user actions, loading states, empty states, and errors. Drive it through props, contracts, and `repo-mocks`.
- **Integration test (`*.integration.test.*`)**: rare. Use only when the behavior depends on real composition across units, adapters, or package boundaries. Prefer extracting pure app-core logic and testing it with a normal unit test first.
- **Repository contract test**: use when verifying implementation parity. Place it in `packages/repo-contracts` or a shared repo-contract helper. Verify `repo-mocks` and `repo-firebase` return the same normalized shapes.
- **E2E spec (`e2e/specs/*.spec.ts`)**: use for primary Electron workflows that must prove real app wiring against emulators.
- **Packaged smoke**: use when validating built app launch behavior. Assert the latest packaged app starts and does not exit early.

Avoid broad AppShell regression tests for unrelated workflows. If a workflow rule can live in app-core, test app-core directly.

## Naming And Placement

- Put unit tests beside the code under test in the owning package/app.
- Name unit test files `*.test.*`. Never use `.unit.test.*`.
- Use `.integration.test.*` rarely and only when composition is the behavior.
- Name tests by expected behavior/outcome, not steps, bug IDs, or regression labels.
- For E2E, focus names on scenarios, not implementation or bug history.
- Avoid vague names like "smoke test" or "regression test" unless the expected behavior is also named.

Good test-name shape:

- `shows an empty state when the collection has no documents`
- `returns normalized timestamp values from Firestore snapshots`
- `rejects production credentials in emulator-only E2E setup`

Avoid:

- `handles click`
- `regression for issue 123`
- `smoke test`

## Structure Tests

Use AAA unless local tests use a clearer equivalent:

1. **Arrange**: build inputs, repo fixtures, emulator seed, or UI setup.
2. **Act**: call the public API, dispatch the command, or perform the user action.
3. **Assert**: verify one behavior-visible result.

Rules:

- One specific behavior per test.
- Prefer one meaningful assertion. Multiple assertions are okay only when they describe the same single outcome.
- Prefer exact, meaningful assertions over broad snapshots.
- Do not write tests that only assert `satisfies`.
- Add helper builders only when they remove real duplication or clarify intent.
- Keep test utilities decoupled from app code.

## Module Boundary Tests

When a large implementation is split into smaller internal modules, test the actual module boundary, not private helpers.

- Name the test file after the module it tests: `compile-lookup.ts` -> `compile-lookup.test.ts`.
- The tested export must be a real production boundary used by another production module.
- Do not export private helpers, or implementation details just to make tests possible.
- Do not widen package entrypoints or public barrels for internal unit tests.
- If testing a unit requires a test-only export, the code shape is wrong; refactor the module boundary.
- Keep composer/orchestrator tests lean. They should prove units are wired together, diagnostics flow through, and the main happy path works.
- Do not duplicate every unit scenario in the composer/orchestrator test.

## Mocking Policy

- Test behavior, not implementation details.
- Do not mock functions inside the same unit.
- Mock only external services/collaborators.
- Use `@firebase-desk/repo-mocks` for UI and feature tests instead of hand-rolled Firebase-shaped objects.
- UI tests should depend on `@firebase-desk/repo-contracts`, not live Firebase packages.
- Prefer deterministic fixtures over time, network, or production Firebase dependencies.

## UI Tests

When testing components or feature workflows:

1. Set up state through repo-mocks or public props.
2. Query by role, label, text, or other user-facing semantics.
3. Drive behavior with real user actions.
4. Assert visible loading, empty, error, and success states where that state is part of the behavior.
5. Keep accessibility in mind: if a control cannot be queried like a user would find it, consider that a product bug.

## Per-Package Coverage Targets

- `packages/repo-firebase`: Firebase result normalization, IPC payload validation (via `ipc-schemas`), credential metadata.
- `packages/script-runner`: logs, returned values, empty returns, thrown errors, timeouts.
- `packages/data-format`: encode/decode round-trips for every `__type__` shape.
- `packages/repo-contracts`: contract tests for normalized shared shapes and implementation parity.
- `packages/repo-mocks`: behavior that keeps mocks contract-compatible with live repositories.

## E2E Rules

E2E tests must run only against Firebase emulators.

1. Start Firestore and Authentication emulators.
2. Seed deterministic test data.
3. Launch Electron against the emulator profile.
4. Exercise a primary flow: project target selection, Firestore tree, query, table/JSON toggle, document edit, JS Query, or Auth user lookup.
5. Assert the user-visible result.

Never require production Firebase credentials. Never connect to production Firebase.

## Good Practices

- Read nearby tests before writing new ones.
- Prefer public API inputs, user events, and visible output.
- Keep fixtures small and named for their role in the behavior.
- Use shared builders/matchers when they make intent clearer across tests.
- Cover failure, empty, and loading states when those states are part of the feature contract.
- Keep integration tests small and explicitly justified by real composition.

## Bad Practices

- Testing private implementation details.
- Mocking internal functions from the same unit.
- Creating `.unit.test.*` files.
- Naming tests after reproduction steps, issue numbers, or generic regressions.
- Adding wide AppShell tests for behavior that belongs in app-core.
- Hand-rolling repo data when `repo-mocks` already models the contract.
- Letting tests depend on production Firebase, real credentials, or nondeterministic remote state.

## Running Tests

Run root scripts only. Do not use `--filter` for checks because packages are coupled.

- `pnpm test` — unit and integration tests across the repo.
- `pnpm test:coverage` — coverage summary.
- `pnpm test:e2e` — Playwright against emulators.
- `pnpm test:boundaries` — package boundary guard.
- `pnpm test:desktop-packaging` — desktop packaging contract guard.
- `pnpm test:packaged` — launch most recent packaged app.
- `pnpm package:smoke` — package current OS build and smoke it.

## Done Checklist

- Test proves the requested behavior with the narrowest useful scope.
- File name and placement follow repo rules.
- Test name describes the expected outcome.
- Test uses public API/user behavior, not internals.
- UI tests use role-based queries and `repo-mocks` where repo data is needed.
- E2E tests use emulators and deterministic seed data.
- Relevant root-level test command passes.
