# FDQL Read Implementation Tracker

Last updated: 2026-05-07

Source spec: [FDQL](./fdql.md)

Architecture constraints: [FDQL Architecture](./fdql-architecture.md)

Scope: read features only. Write operations are out of this tracker. This document tracks implementation status only; language semantics live in the spec and package constraints live in the architecture doc.

## Status Legend

- Done: implemented in parser/compiler/runtime and covered by tests.
- Partial: works for a narrow path, but does not match the spec yet.
- Missing: not implemented.

## Registered Decisions

- Keep FDQL read-only for the next work. Writes stay out of this tracker.
- Read correctness polish is complete for current read paths: deterministic app-level cancel/timeout stops, diagnostic context, exact Firestore field paths, and issue-click navigation.
- Subcollection reads and Firestore aggregate reads are implemented.
- Treat subcollection reads as dynamic provider source expressions, not only top-level aliases, because they depend on the current row.
- Provider split is complete: `fdql-core` is provider-neutral, `fdql-firestore` owns Firestore dialect semantics, and `fdql` is the bundled facade.
- Keep expression completeness incremental around real read workflows.
- Keep editor/language improvements incremental and driven by implemented syntax.

Current priority order:

1. Language/editor follow-up: context-aware completions, field hints, and diagnostics for masked-out fields.
2. Lineage/source exploration for lookup, unwind, union, and aggregate output.

## Current Read Slice

| Area            | Status  | Notes                                                                                                                                                          |
| --------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FDQL tab        | Done    | Dedicated tab, Run/Cancel, source persistence, Results/Issues.                                                                                                 |
| Result views    | Done    | Table, Tree, lazy JSON, rows/reads/scanned/elapsed stats.                                                                                                      |
| IPC             | Done    | `fdql.compile`, `fdql.run`, `fdql.cancel`, event stream.                                                                                                       |
| Mock repository | Done    | Uses existing fixture collections through a Firestore mock runtime owned by `repo-mocks`.                                                                      |
| Live repository | Done    | Uses paged Admin SDK reads for collections, collection groups, static/dynamic subcollection paths, field masks, where/order/limit, named DBs, cancel/timeout.  |
| Parser          | Partial | Source-located statement parser supports the current read surface, but it is not a full grammar and aliases remain one-line declarations.                      |
| Compiler        | Partial | Builds the current provider read/local-stage surface with explicit provider registration. Missing spec-only read features still fail diagnostics.              |
| Executor        | Partial | Dispatches through provider runtimes. Provider read events stream during reads; final output rows are still emitted after each branch local pipeline finishes. |
| Providers       | Done    | Core is provider-neutral; Firestore lives in `fdql-firestore` plus repo adapters; test-only `mem` provider proves non-Firestore dispatch.                      |
| E2E             | Partial | Covers bounded reads, field projection, result views, budget stop, lookup, unwind, aggregate, union, collection group, and duplicate singleton diagnostics.    |

## Source-Verified Current Surface

Checked against `packages/fdql-core`, `packages/fdql-firestore`, `packages/repo-firebase`, `packages/repo-mocks`, and FDQL E2E coverage.

Current parser/compiler accepts:

- Standalone `clear cache`, `clear cache provider fs`, and `clear cache provider fs project "..."` through the command-aware compile path.
- `set*`, then `alias*`, then one read pipeline.
- Line-oriented `set`, `alias`, `from`, and provider clause statements. Source alias declarations must fit on one line today.
- Top-level `union all` between read pipelines, with the first branch preamble shared into later branches.
- Top-level `from` sources through declared `$` aliases and `from fs.aggregate $source`.
- Lookup sources through declared `$` aliases or provider source calls.
- `from $source as rowAlias`.
- Provider clauses: `namespace where`, `namespace order by`, `namespace limit`.
- Local stages: `then filter`, `then take`, `then sort by`, `then with`, `then lookup one`, `then lookup required one`, `then lookup many`, `then fs.aggregate`, `then unwind`, `then aggregate`, `return`.
- Lookup/provider aggregate cache suffixes: `cache off`, `cache run`, `cache persistent`, `cache persistent 60s`.
- Expressions: literals, arrays, maps, `$aliases`, qualified fields, function calls, `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `and`, `or`, unary `not`, parentheses, and `*`.

Current Firestore dialect accepts:

- Source functions: `fs.collection(...)`, `fs.collectionGroup(...)`, `fs.subcollection(...)`, `fs.project(...)`, `fs.db(...)`.
- Source field masks as literal arrays on source alias declarations. Strings use dotted Firestore paths; `fs.fieldPath(...)` gives exact segments.
- Settings: `set fs.projectId = "..."`, `set fs.databaseId = "..."`.
- Value/metadata functions: `fs.id(row)`, `fs.path(row)`, `fs.projectId(row)`, `fs.ref(rowOrPath)`, `fs.fieldPath(...)`, `fs.arrayContains(field, value)`.
- Provider predicates with provider field/id on the left. Lookup predicates may reference previous row bindings on the value side.
- Firestore provider aggregates: `from fs.aggregate $source` and `then fs.aggregate $source` with `fs.count`, `fs.sum`, `fs.avg`, `fs.min`, and `fs.max`.

Current implementation does not parse or execute:

- FDQL writes.
- `fs.subcollections(...)`.
- Dynamic field masks.
- Final global stages after `union all`.

## Implemented Read Syntax

```fdql
set fdql.readBudget = 5000
set fdql.timeout = 60s
set fdql.cache = persistent
set fdql.cacheTtl = 24h
set fdql.allowUnboundedReads = false

alias $drivers = fs.project("prod").db("db2").collection("drivers", ["firstName", "teamId", "metadata"])
alias $teams = fs.project("prod").db("db2").collection("teams", ["name"])
alias $rounds = fs.project("prod").db("db2").collection("rounds", ["driverId", "createdAt"])
alias $orders = fs.collectionGroup("orders", [])

from $drivers as d
fs where d.active = true
fs where fs.id(d) = "drv_1"
fs order by d.createdAt desc
fs limit 25

then filter lower(d.firstName) = "vini"

then lookup one $teams as team cache run
  fs where fs.id(team) = d.teamId

then lookup many $rounds as rounds cache off
  fs where rounds.driverId = fs.id(d)
  fs order by rounds.createdAt desc
  fs limit 20

then unwind entries(d.metadata) as entry
then sort by d.firstName asc
then take 10
then with
  fs.id(d) as id,
  d.firstName,
  team.name as teamName,
  rounds,
  entry.key as metadataKey

return id, firstName, teamName, metadataKey, rounds
```

Representative nested map/array workflow:

```fdql
alias $events = fs.collection("admin-events", ["name", "slug", "schedule", "entriesById"])
alias $drivers = fs.collection("drivers", ["firstName", "lastName", "steamId"])

from $events as event
fs order by event.schedule.startsAt desc
fs limit 20

then unwind entries(event.entriesById) as entry
then unwind entry.value.drivers as eventDriver
then take 25
then lookup one $drivers as driver
  fs where fs.id(driver) = eventDriver.steamId

return eventDriver.steamId, driver, event.slug, event.name, event.schedule.startsAt
```

```fdql
from $drivers as d
fs limit 100

then aggregate
  by d.teamId as teamId
  yield count() as total

then sort by total desc

return teamId, total
```

```fdql
from $drivers as d
fs limit 10
return fs.id(d) as id, d.firstName

union all

from $orders as o
fs limit 10
return fs.id(o) as id, o.status
```

Implemented expression/runtime basics:

- literals, arrays, maps, `$aliases`
- qualified field paths like `d.firstName`
- comparisons: `=`, `!=`, `<`, `<=`, `>`, `>=`
- `and`, `or`, unary `not`
- `in`, `not in`
- `is null`, `is not null`, `is missing`, `is not missing`, `exists(...)`, `missing(...)`
- `case when ... then ... else ... end`
- numeric math: `+`, `-`, `*`, `/`, `%`, unary `-`
- `fs.id(row)`, `fs.path(row)`, `fs.projectId(row)`, `fs.parentPath(row)`, `fs.databaseId(row)`
- `timestamp(value)`
- `fs.arrayContains(field, value)`, `fs.arrayContainsAny(field, values)`
- `lower(value)`
- `entries(map)`
- `mapGet(map, key)`
- `count()`, `sum(...)`, `avg(...)`, `min(...)`, `max(...)` inside local aggregate stages
- explicit `return`, including binding-level `return *` and `return ...binding`
- field masks, including `[]` metadata-only reads
- collection paths, collection groups, explicit project, named database

## P0 Gaps

These block the read implementation from being honest at production scale.

| Feature                          | Status  | Notes                                                                                                                                                                                                 |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live streaming/pages             | Done    | Live repo uses cursor pages and caps each page by configured page size and remaining read budget/provider limit.                                                                                      |
| Read budget in live repo         | Done    | Runtime read requests cap Firestore page reads before docs are fetched.                                                                                                                               |
| Cancel in live repo              | Done    | App-level cancellation stops output deterministically and ignores late SDK page results. Admin SDK network abort is not guaranteed.                                                                   |
| Timeout in live repo             | Done    | Page reads race against deadline and stop output deterministically, preserving partial rows/stats with timeout status.                                                                                |
| Cache modes                      | Done    | `off`, `run`, and `persistent` are implemented for lookup reads and pipeline provider aggregates with TTL, hashed canonical keys, stats, desktop SQLite storage, and `clear cache` command execution. |
| Output row streaming             | Partial | Read events stream as provider rows arrive, but final row events are emitted after the branch source read and local stages finish.                                                                    |
| Provider query validation parity | Partial | Firestore dialect validates documented hard operator/value/order constraints before execution. Missing-index errors still come from Firestore.                                                        |
| Field path fidelity              | Done    | Field masks carry segment arrays. Live Firestore maps `fs.fieldPath(...)` in masks/where/order to Admin `FieldPath`; mock support is limited to masks and normal field paths.                         |

## P1 Spec Features Not Implemented

| Feature                                   | Status  | Notes                                                                                                                                           |
| ----------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `lookup one`                              | Done    | Optional; missing correlated values/no match attach `null`; supports lookup-local cache override.                                               |
| `lookup required one`                     | Done    | Drops rows when correlated values are missing or no match exists.                                                                               |
| `lookup many`                             | Done    | Optional; missing correlated values attach `[]`, counts lookup reads separately, supports cache override.                                       |
| `fs.aggregate`                            | Done    | Native provider aggregate at `from` or `then`; `yield` creates flat bindings or map bindings; supports cache on pipeline aggregates.            |
| `fs.subcollection(parent, name, fields?)` | Done    | Supports static paths, dynamic lookup/aggregate sources, and reusable templates with `of parent`.                                               |
| `fs.subcollections(parent)`               | Missing | Deferred child-collection-name discovery.                                                                                                       |
| `unwind array`                            | Done    | Expands arrays into one row per item.                                                                                                           |
| `unwind entries(map)`                     | Done    | `entries(map)` emits `{ key, value }` rows for keyed-map workflows.                                                                             |
| `union all`                               | Done    | Executes top-level branches with shared preamble aliases/settings.                                                                              |
| `sort by`                                 | Done    | Local row sort before later local stages or return.                                                                                             |
| `return ...binding`                       | Done    | Spreads map/object bindings and provider loaded data; missing emits no field, non-map values fall back to normal projection, collisions suffix. |
| `aggregate`                               | Done    | Local grouping with count/sum/avg/min/max.                                                                                                      |
| Firestore aggregations                    | Done    | `fs.count`, `fs.sum`, `fs.avg` use native aggregation; `fs.min`, `fs.max` use bounded ordered reads.                                            |

## P2 Expression Gaps

| Expression                | Status | Notes                                                                 |
| ------------------------- | ------ | --------------------------------------------------------------------- |
| `not in`                  | Done   | Local and Firestore-native, with Firestore `not-in` constraints.      |
| `is null` / `is not null` | Done   | Local and Firestore-native null checks.                               |
| `exists` / `missing`      | Done   | Local helpers backed by missing/null-aware FDQL values.               |
| `fs.arrayContainsAny`     | Done   | Firestore-native operator.                                            |
| `case`                    | Done   | Local searched case expression.                                       |
| math expressions          | Done   | Numeric-only `+`, `-`, `*`, `/`, `%`, and unary `-`.                  |
| `mapGet(map, key)`        | Done   | Local dynamic map lookup; missing keys return missing.                |
| `entries(map)`            | Done   | Local helper for map-entry unwind.                                    |
| `timestamp(value)`        | Done   | Core constructor.                                                     |
| `bytes(value)`            | Done   | Core constructor.                                                     |
| `geoPoint(lat, lng)`      | Done   | Core constructor.                                                     |
| `fs.ref(row)`             | Done   | Firestore document reference provider value.                          |
| `fs.ref(path)`            | Done   | Firestore document reference provider value constructor.              |
| `fs.fieldPath(...)`       | Done   | Exact field-path segments for masks and live Firestore filters/order. |
| `fs.parentPath(row)`      | Done   | Parent collection path metadata helper.                               |
| `fs.databaseId(row)`      | Done   | Returns named database id or `(default)`.                             |

## P3 Product/Quality Gaps

| Area                | Status                     | Notes                                                                                                                                      |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Full grammar        | Partial                    | Parser now uses source-located statements, but expression and pipeline grammar still need broader syntax coverage.                         |
| Source-located AST  | Done                       | Top-level declarations and stages carry source columns/ranges; parser expression diagnostics use source columns.                           |
| Execution locations | Done                       | Execution diagnostics preserve line/column and provider/source/row/stage context; Issues can focus the editor position.                    |
| Editor language     | Done                       | FDQL has a reusable language service plus Monaco language id, highlighting, bracket/comment rules, completions, and diagnostics.           |
| FDQL type model     | Done                       | Core/runtime values are tagged internally and encoded at output.                                                                           |
| Provider adapters   | Done                       | Firestore values normalize/encode in provider repos; core FDQL has no Firestore-shaped runtime API.                                        |
| Type inference      | Missing                    | Compiler does not infer expression, stage, or result column types.                                                                         |
| Row-shape analysis  | Partial                    | Compiler validates root row bindings; nested unknown fields are runtime missing values and compiler does not prove row shape.              |
| Lineage UI          | Partial                    | Events carry provider-neutral row lineage, but UI does not expose source exploration.                                                      |
| More E2E            | Partial                    | Covers main read paths plus nested map/array lookup cache, field-path fidelity, and issue-click navigation. Still needs named DB coverage. |
| Generated scripts   | Not planned for current UI | Spec mentions generated scripts, but current product slice intentionally has no JS snippet panel. Revisit before implementing.             |

## Suggested Next Order

1. Improve context-aware editor assistance.
2. Add lineage/source exploration for aggregate and expanded rows.
