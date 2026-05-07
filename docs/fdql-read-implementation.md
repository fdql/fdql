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
- Subcollection reads are implemented before Firestore aggregate reads.
- Treat subcollection reads as dynamic provider source expressions, not only top-level aliases, because they depend on the current row.
- Provider split is complete: `fdql-core` is provider-neutral, `fdql-firestore` owns Firestore dialect semantics, and `fdql` is the bundled facade.
- Add provider-native Firestore aggregate reads after subcollections.
- Add expression completeness after provider read shape is stronger.
- Keep editor/language improvements incremental and driven by implemented syntax.

Current priority order:

1. Firestore native aggregate reads: `lookup aggregate` plus `fs.count`, `fs.sum`, `fs.avg`, `fs.min`, `fs.max`.
2. Expression completeness: `is null`, `is missing`, `exists`, `not in`, `case`, math, and `fs.arrayContainsAny`.
3. Firestore provider validation parity: operator/value/index-shape diagnostics before execution.
4. Language/editor follow-up: context-aware completions, field hints, and diagnostics for masked-out fields.
5. Lineage/source exploration for lookup, unwind, union, and aggregate output.

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
- Top-level `from` sources only through declared `$` aliases.
- Lookup sources through declared `$` aliases or provider source calls.
- `from $source as rowAlias`.
- Provider clauses: `namespace where`, `namespace order by`, `namespace limit`.
- Local stages: `then filter`, `then take`, `then sort by`, `then with`, `then lookup one`, `then lookup required one`, `then lookup many`, `then unwind`, `then aggregate`, `return`.
- Lookup cache suffixes: `cache off`, `cache run`, `cache persistent`, `cache persistent 60s`.
- Expressions: literals, arrays, maps, `$aliases`, qualified fields, function calls, `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `and`, `or`, unary `not`, parentheses, and `*`.

Current Firestore dialect accepts:

- Source functions: `fs.collection(...)`, `fs.collectionGroup(...)`, `fs.subcollection(...)`, `fs.project(...)`, `fs.db(...)`.
- Source field masks as literal arrays on source alias declarations. Strings use dotted Firestore paths; `fs.fieldPath(...)` gives exact segments.
- Settings: `set fs.projectId = "..."`, `set fs.databaseId = "..."`.
- Value/metadata functions: `fs.id(row)`, `fs.path(row)`, `fs.projectId(row)`, `fs.ref(rowOrPath)`, `fs.fieldPath(...)`, `fs.arrayContains(field, value)`.
- Provider predicates with provider field/id on the left. Lookup predicates may reference previous row bindings on the value side.

Current implementation does not parse or execute:

- FDQL writes.
- `lookup aggregate`.
- `fs.subcollections(...)`.
- Firestore aggregate helpers such as `fs.count()`.
- Dynamic field masks.
- Final global stages after `union all`.
- `not in`, `is null`, `case`, or math expressions.
- `fs.parentPath(row)` and `fs.databaseId(row)` metadata helpers.

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
  count() as total

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
- `in`
- `fs.id(row)`, `fs.path(row)`, `fs.projectId(row)`
- `timestamp(value)`
- `fs.arrayContains(field, value)`
- `lower(value)`
- `entries(map)`
- `mapGet(map, key)`
- `count()`, `sum(...)`, `avg(...)`, `min(...)`, `max(...)` inside local aggregate stages
- `return *`
- field masks, including `[]` metadata-only reads
- collection paths, collection groups, explicit project, named database

## P0 Gaps

These block the read implementation from being honest at production scale.

| Feature                          | Status  | Notes                                                                                                                                                                         |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live streaming/pages             | Done    | Live repo uses cursor pages and caps each page by configured page size and remaining read budget/provider limit.                                                              |
| Read budget in live repo         | Done    | Runtime read requests cap Firestore page reads before docs are fetched.                                                                                                       |
| Cancel in live repo              | Done    | App-level cancellation stops output deterministically and ignores late SDK page results. Admin SDK network abort is not guaranteed.                                           |
| Timeout in live repo             | Done    | Page reads race against deadline and stop output deterministically, preserving partial rows/stats with timeout status.                                                        |
| Cache modes                      | Done    | `off`, `run`, and `persistent` are implemented for lookup reads with TTL, hashed canonical keys, stats, desktop SQLite storage, and `clear cache` command execution.          |
| Output row streaming             | Partial | Read events stream as provider rows arrive, but final row events are emitted after the branch source read and local stages finish.                                            |
| Provider query validation parity | Partial | Firestore dialect validates simple provider shapes. Needs stronger Firestore limit/operator/index-shape diagnostics.                                                          |
| Field path fidelity              | Done    | Field masks carry segment arrays. Live Firestore maps `fs.fieldPath(...)` in masks/where/order to Admin `FieldPath`; mock support is limited to masks and normal field paths. |

## P1 Spec Features Not Implemented

| Feature                                   | Status  | Notes                                                                                                     |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `lookup one`                              | Done    | Optional; missing correlated values/no match attach `null`; supports lookup-local cache override.         |
| `lookup required one`                     | Done    | Drops rows when correlated values are missing or no match exists.                                         |
| `lookup many`                             | Done    | Optional; missing correlated values attach `[]`, counts lookup reads separately, supports cache override. |
| `lookup aggregate`                        | Missing | Spec-only. Needs parser/compiler/runtime support and provider aggregate execution.                        |
| `fs.subcollection(parent, name, fields?)` | Done    | Supports static paths, dynamic lookup sources, and reusable templates with `of parent`.                   |
| `fs.subcollections(parent)`               | Missing | Deferred child-collection-name discovery.                                                                 |
| `unwind array`                            | Done    | Expands arrays into one row per item.                                                                     |
| `unwind entries(map)`                     | Done    | `entries(map)` emits `{ key, value }` rows for keyed-map workflows.                                       |
| `union all`                               | Done    | Executes top-level branches with shared preamble aliases/settings.                                        |
| `sort by`                                 | Done    | Local row sort before later local stages or return.                                                       |
| `aggregate`                               | Done    | Local grouping with count/sum/avg/min/max.                                                                |
| Firestore aggregations                    | Missing | `fs.count`, `fs.sum`, `fs.avg`, `fs.min`, `fs.max` are not implemented. Local `aggregate` is implemented. |

## P2 Expression Gaps

| Expression                | Status  | Notes                                                                 |
| ------------------------- | ------- | --------------------------------------------------------------------- |
| `not in`                  | Missing | Parser supports unary `not`, not `not in` as one operator.            |
| `is null` / `is not null` | Missing | Needs parser and Firestore/local semantics.                           |
| `exists` / `missing`      | Partial | Runtime now distinguishes missing from null; syntax still missing.    |
| `fs.arrayContainsAny`     | Missing | Firestore-native operator.                                            |
| `case`                    | Missing | Local expression only.                                                |
| math expressions          | Missing | `+`, `-`, `*`, `/`, `%` not parsed.                                   |
| `mapGet(map, key)`        | Done    | Local dynamic map lookup; missing keys return missing.                |
| `entries(map)`            | Done    | Local helper for map-entry unwind.                                    |
| `timestamp(value)`        | Done    | Core constructor.                                                     |
| `bytes(value)`            | Done    | Core constructor.                                                     |
| `geoPoint(lat, lng)`      | Done    | Core constructor.                                                     |
| `fs.ref(row)`             | Done    | Firestore document reference provider value.                          |
| `fs.ref(path)`            | Done    | Firestore document reference provider value constructor.              |
| `fs.fieldPath(...)`       | Done    | Exact field-path segments for masks and live Firestore filters/order. |
| `fs.parentPath(row)`      | Missing | Metadata function from spec.                                          |
| `fs.databaseId(row)`      | Missing | Useful with named database reads.                                     |

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
| Row-shape analysis  | Missing                    | Unknown fields are runtime missing values; compiler does not prove row shape.                                                              |
| Lineage UI          | Partial                    | Events carry provider-neutral row lineage, but UI does not expose source exploration.                                                      |
| More E2E            | Partial                    | Covers main read paths plus nested map/array lookup cache, field-path fidelity, and issue-click navigation. Still needs named DB coverage. |
| Generated scripts   | Not planned for current UI | Spec mentions generated scripts, but current product slice intentionally has no JS snippet panel. Revisit before implementing.             |

## Suggested Next Order

1. Add Firestore native aggregate reads.
2. Complete common read expressions.
3. Tighten Firestore provider validation diagnostics.
4. Improve context-aware editor assistance.
5. Add lineage/source exploration for aggregate and expanded rows.
