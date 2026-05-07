# FDQL Architecture

This document defines implementation constraints for FDQL. The language spec is [fdql.md](./fdql.md). The read status tracker is [fdql-read-implementation.md](./fdql-read-implementation.md).

## Goals

- Keep FDQL provider-extensible.
- Keep `@firebase-desk/fdql-core` provider-neutral and Firebase-free.
- Keep `@firebase-desk/fdql` as the bundled facade for first-party providers.
- Make provider work explicit and dialect-owned.
- Keep local pipeline stages provider-neutral.
- Keep integrated execution, generated scripts, and future tools driven from the same AST/plan semantics.

## Package Boundaries

`packages/fdql-core` owns:

- parsing
- AST and diagnostics
- provider-neutral compile orchestration
- provider-neutral read plans
- provider dialect contracts
- provider runtime contracts
- provider-neutral executor stages
- local expression evaluation

`packages/fdql-core` must not import:

- Firebase SDKs or Admin SDKs
- `@firebase-desk/fdql`
- `@firebase-desk/fdql-firestore`
- Electron APIs
- repo-firebase, repo-mocks, IPC schemas, or UI packages
- provider implementations that require external SDKs

`packages/fdql-firestore` owns the Firestore dialect. It may import `@firebase-desk/fdql-core`, but it must not import Firebase/Admin SDKs, repo packages, UI, IPC, or apps.

`packages/fdql` owns the public facade. It may import `@firebase-desk/fdql-core` and first-party provider packages, and it registers built-in first-party dialects for app-facing compilation.

`packages/fdql-language` owns editor-agnostic language services. It may import the FDQL facade for built-in provider metadata, but it must not import React, Monaco, VS Code, Electron, Firebase SDKs, Admin SDKs, repo packages, IPC schemas, or apps. Monaco and future VS Code adapters should consume this package instead of reimplementing FDQL keywords, completions, snippets, and diagnostics.

Provider SDK code belongs in provider repository packages. For Firestore, live Admin SDK code belongs in `packages/repo-firebase`.

## File Layout

Core FDQL orchestration files:

- `parser.ts`: syntax and source ranges
- `compiler.ts`: provider-neutral compile orchestration
- `executor.ts`: provider-neutral execution orchestration
- `evaluator.ts`: local expression evaluation and provider function delegation
- `provider.ts`: dialect and runtime contracts
- `types.ts`: public AST, plan, diagnostics, runtime, stats, and lineage types

Provider package files:

- `packages/fdql-firestore/src/fs-dialect.ts`: Firestore dialect semantics
- `packages/fdql-firestore/src/fs-dialect.test.ts`: Firestore dialect tests
- `packages/fdql-firestore/src/test-helpers/firestore-runtime.ts`: Firestore test runtime helpers only
- `packages/fdql-core/src/test-helpers/provider.ts`: fake provider helpers for core tests only

Do not leave old files, type names, or test names behind after a provider refactor.

## Provider Model

A provider has two parts:

- dialect: compile-time semantics
- runtime: execution-time reads

Dialect responsibilities:

- namespace ownership, for example `fs`
- source alias resolution, for example `fs.collection(...)`
- provider command validation, for example `fs where`
- provider order/limit semantics
- provider metadata/value functions, for example `fs.id(row)`
- provider-specific diagnostics
- bounded-read detection when the provider can prove it

Runtime responsibilities:

- execute `FdqlProviderReadRequest`
- return provider rows as async iterables
- enforce provider request limits and field masks where possible
- expose provider context on rows
- never mutate data in read execution

The executor dispatches provider reads through a provider runtime registry keyed by namespace.

## Provider Type Adapters

FDQL has one shared value model. Providers adapt their SDK/database values into that model.

Dialect responsibilities:

- declare supported value kinds for provider clauses
- validate provider filters, ordering, aggregates, and writes against those value kinds
- define provider-specific constructors, for example `fs.ref(...)`
- expose provider metadata functions, for example `fs.id(row)`
- reject values the provider cannot compile instead of falling back to local work

Runtime responsibilities:

- normalize provider rows into FDQL values before local stages run
- preserve provider context needed by references and metadata functions
- encode FDQL values back to provider values only inside provider runtime code
- avoid leaking SDK classes into executor, evaluator, UI, or IPC contracts

Core FDQL constructors such as `timestamp(...)`, `bytes(...)`, and `geoPoint(...)` belong to the local evaluator. Provider-prefixed constructors belong to dialects.

## Parser Rules

The parser should stay mostly provider-neutral.

It may parse:

- provider source calls as normal calls
- provider commands as namespace-prefixed stages, for example `fs where`
- provider function calls as dot calls, for example `fs.id(...)`
- local stages without provider knowledge

It must not hardcode Firestore-only grammar outside generic syntax. Firestore-specific validation belongs in the Firestore dialect.

## Compiler Rules

The compiler is orchestration, not a Firestore compiler.

Rules:

- `compileFdqlRead(source, { providers, defaultProviderContext })` uses a provider dialect registry.
- Provider registration is explicit. Core FDQL must not install Firestore as a hidden default.
- Provider context is namespace-scoped, for example `{ fs: { projectId: "local" } }`.
- Unknown namespaces produce stable diagnostics.
- Provider source aliases are resolved by their dialect.
- Provider clauses are validated by their dialect.
- Local stages compile against provider-neutral row bindings.
- Local expressions delegate provider-prefixed calls to the matching dialect.
- A provider clause that cannot compile to that provider is invalid. Do not silently move it to a local stage.

## Executor Rules

The executor is provider-neutral after planning.

Rules:

- `executeFdql(plan, { providers }, options)` dispatches reads by provider namespace.
- Runtime dialect registration is explicit. Core FDQL must not infer Firestore dialects.
- Local stages operate on `FdqlProviderRow` and plain row objects.
- `filter`, `with`, `take`, `sort by`, `unwind`, `aggregate`, `return`, and `union all` must not assume Firestore.
- Metadata/value calls such as `fs.id(row)` are delegated through dialect evaluation.
- Stats use provider-neutral names such as `providerReads`.
- Read events include provider namespace and source id/path, not Firestore-specific fields.
- Unsupported provider/runtime capability should produce diagnostics or failed events, not thrown user-facing crashes.

## Firestore Placement

Allowed Firestore-specific files:

- `packages/fdql-firestore`
- Firestore-specific facade tests
- `packages/repo-firebase`
- Firestore fixture/runtime code in `packages/repo-mocks`

Firestore-specific code outside those places needs a package-boundary reason.

`packages/fdql-core/src/compiler.ts` and `executor.ts` must not import the Firestore dialect. The `@firebase-desk/fdql` facade registers Firestore for app-facing use; core tests register fake providers explicitly.

`parser.ts` and `evaluator.ts` should not import Firestore directly. The parser reads generic syntax. The evaluator delegates provider-prefixed calls through the dialect registry.

## Naming Rules

Use provider-neutral names in shared FDQL code:

- provider source, not native source
- provider read, not native read
- provider row, not Firestore document
- provider reads, not per-project reads
- provider where/order/limit, not provider-specific AST stage names

Use `fs` or Firestore naming only inside Firestore-specific files, tests, fixtures, or repository packages.

No stale aliases should remain after refactors. Rename types, tests, filenames, helpers, diagnostics text, and docs together.

## Test Helpers

Fake providers belong under `packages/fdql-core/src/test-helpers`.

Rules:

- test helpers are not exported from package index files
- test helpers are excluded from package build output
- fake providers should prove provider extensibility without adding production providers
- Firestore test runtimes stay in `fdql-firestore` test helpers or Firestore repo packages, not exported core executor APIs
- Firestore dialect behavior needs direct unit tests
- provider registry dispatch needs executor tests with at least one non-Firestore provider

## Function Style

FDQL implementation should stay function-first.

Rules:

- no new classes for FDQL package, repos, IPC wrappers, or runtimes
- factories return plain objects
- stable dependencies come before request/options args
- use keyed object args when inputs have multiple fields
- keep helpers small and scoped to the owning module

## UI And IPC

IPC and UI contracts should stay provider-neutral unless displaying Firestore-specific user text.

Rules:

- IPC schemas validate provider-neutral FDQL request/event shapes
- UI reads result rows, issues, stats, and stop state through repo contracts
- Row lineage uses provider-neutral `{ provider, rowPath, source, readContribution }`
- UI should not infer provider internals from Firestore-specific fields
- Firestore-specific labels are allowed only when the selected provider is Firestore

## Review Checklist

Before landing FDQL changes, check:

- Does shared FDQL code import Firebase or repo packages?
- Did provider-specific logic land in a dialect or provider repo?
- Are local stages provider-neutral?
- Are diagnostics stable and source-located where possible?
- Are shared names provider-neutral?
- Are fake providers kept in test helpers?
- Are new provider semantics reflected in `docs/fdql.md`?
- Is implementation status reflected in `docs/fdql-read-implementation.md`?
