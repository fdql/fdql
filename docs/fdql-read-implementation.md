# FDQL Read Implementation Tracker

Last updated: 2026-05-07

Source spec: [FDQL](./fdql.md)

Architecture constraints: [FDQL Architecture](./fdql-architecture.md)

Scope: read features only. Write operations are out of this tracker. This document tracks implementation status only; language semantics live in the spec and package constraints live in the architecture doc.

## Status Legend

- Done: implemented in parser/compiler/runtime and covered by tests.
- Partial: works for a narrow path, but does not match the spec yet.
- Missing: not implemented.

## Current Read Slice

| Area            | Status  | Notes                                                                                                                                                       |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FDQL tab        | Done    | Dedicated tab, Run/Cancel, source persistence, Results/Issues.                                                                                              |
| Result views    | Done    | Table, Tree, lazy JSON, rows/reads/scanned/elapsed stats.                                                                                                   |
| IPC             | Done    | `fdql.compile`, `fdql.run`, `fdql.cancel`, event stream.                                                                                                    |
| Mock repository | Done    | Uses existing fixture collections through a Firestore mock runtime owned by `repo-mocks`.                                                                   |
| Live repository | Partial | Uses paged Admin SDK collection/collection group reads for the first read source shape.                                                                     |
| Parser          | Partial | Statement grammar keeps existing syntax and now records source columns/ranges.                                                                              |
| Compiler        | Partial | Builds provider read sources plus provider-neutral local stages with explicit provider registration.                                                        |
| Executor        | Partial | Dispatches reads through explicit provider/dialect registries. Read events stream during provider reads; output rows are currently buffered per branch.     |
| Providers       | Partial | Firestore is registered at repo/test boundaries; a test-only `mem` provider proves non-Firestore compile/execute dispatch.                                  |
| E2E             | Partial | Covers bounded reads, field projection, result views, budget stop, lookup, unwind, aggregate, union, collection group, and duplicate singleton diagnostics. |

## Source-Verified Current Surface

Checked against `packages/fdql-core`, `packages/fdql-firestore`, `packages/repo-firebase`, `packages/repo-mocks`, and FDQL E2E coverage.

Current parser/compiler accepts:

- `set*`, then `alias*`, then one read pipeline.
- Line-oriented `set`, `alias`, `from`, and provider clause statements. Source alias declarations must fit on one line today.
- Top-level `union all` between read pipelines, with the first branch preamble shared into later branches.
- Source aliases only through declared `$` aliases.
- `from $source as rowAlias`.
- Provider clauses: `namespace where`, `namespace order by`, `namespace limit`.
- Local stages: `then filter`, `then take`, `then sort by`, `then with`, `then lookup one`, `then lookup many`, `then unwind`, `then aggregate`, `return`.
- Expressions: literals, arrays, maps, `$aliases`, qualified fields, function calls, `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `and`, `or`, unary `not`, parentheses, and `*`.

Current Firestore dialect accepts:

- Source functions: `fs.collection(...)`, `fs.collectionGroup(...)`, `fs.project(...)`, `fs.db(...)`.
- Source field masks as literal string arrays on source alias declarations.
- Settings: `set fs.projectId = "..."`, `set fs.databaseId = "..."`.
- Value/metadata functions: `fs.id(row)`, `fs.path(row)`, `fs.projectId(row)`, `fs.ref(rowOrPath)`, `fs.arrayContains(field, value)`.
- Provider predicates with provider field/id on the left. Lookup predicates may reference previous row bindings on the value side.

Current implementation does not parse or execute:

- FDQL writes.
- `lookup expand` or `lookup aggregate`.
- `fs.subcollection(...)` or `fs.subcollections(...)`.
- Firestore aggregate helpers such as `fs.count()`.
- Dynamic field masks.
- Final global stages after `union all`.

## Implemented Read Syntax

```fdql
set fdql.readBudget = 5000
set fdql.timeout = 60s
set fdql.cache = run
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

| Feature                          | Status  | Notes                                                                                                                                                                                        |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live streaming/pages             | Done    | Live repo uses cursor pages and caps each page by configured page size and remaining read budget/provider limit.                                                                             |
| Read budget in live repo         | Done    | Runtime read requests cap Firestore page reads before docs are fetched.                                                                                                                      |
| Cancel in live repo              | Partial | Cancel is observed between pages/rows, but not while a Firestore page request is already in flight.                                                                                          |
| Timeout in live repo             | Partial | Same issue as cancel.                                                                                                                                                                        |
| Cache modes                      | Partial | `off`, `run`, and `persistent` are implemented for lookup reads with TTL, hashed canonical keys, stats, and desktop SQLite storage. Manual clear syntax is specified but not executable yet. |
| Output row streaming             | Partial | Read events stream as provider rows arrive, but final row events are emitted after the branch source read and local stages finish.                                                           |
| Provider query validation parity | Partial | Firestore dialect validates simple provider shapes. Needs stronger Firestore limit/operator/index-shape diagnostics.                                                                         |
| Field path fidelity              | Partial | Live field masks split on `.`, so literal dotted field names are not represented yet. Need explicit field-path segment handling.                                                             |

## P1 Spec Features Not Implemented

| Feature                                   | Status  | Notes                                                                                                      |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `lookup one`                              | Done    | Attaches one document or `null`; supports lookup-local `cache off` / `cache run` / `cache persistent 60s`. |
| `lookup many`                             | Done    | Attaches an array, counts lookup reads separately, and supports cache local override.                      |
| `lookup expand`                           | Missing | Needs row multiplication and lineage.                                                                      |
| `lookup aggregate`                        | Missing | Needs provider aggregate execution.                                                                        |
| `fs.subcollection(parent, name, fields?)` | Missing | Needed for document-relative reads.                                                                        |
| `fs.subcollections(parent)`               | Missing | Needed for subcollection discovery.                                                                        |
| `unwind array`                            | Done    | Expands arrays into one row per item.                                                                      |
| `unwind entries(map)`                     | Done    | `entries(map)` emits `{ key, value }` rows for keyed-map workflows.                                        |
| `union all`                               | Done    | Executes top-level branches with shared preamble aliases/settings.                                         |
| `sort by`                                 | Done    | Local row sort before later local stages or return.                                                        |
| `aggregate`                               | Done    | Local grouping with count/sum/avg/min/max.                                                                 |
| Firestore aggregations                    | Missing | `fs.count`, `fs.sum`, `fs.avg`, `fs.min`, `fs.max` not implemented.                                        |

## P2 Expression Gaps

| Expression                | Status  | Notes                                                              |
| ------------------------- | ------- | ------------------------------------------------------------------ |
| `not in`                  | Missing | Parser supports unary `not`, not `not in` as one operator.         |
| `is null` / `is not null` | Missing | Needs parser and Firestore/local semantics.                        |
| `exists` / `missing`      | Partial | Runtime now distinguishes missing from null; syntax still missing. |
| `fs.arrayContainsAny`     | Missing | Firestore-native operator.                                         |
| `case`                    | Missing | Local expression only.                                             |
| math expressions          | Missing | `+`, `-`, `*`, `/`, `%` not parsed.                                |
| `mapGet(map, key)`        | Done    | Local dynamic map lookup; missing keys return missing.             |
| `entries(map)`            | Done    | Local helper for map-entry unwind.                                 |
| `timestamp(value)`        | Done    | Core constructor.                                                  |
| `bytes(value)`            | Done    | Core constructor.                                                  |
| `geoPoint(lat, lng)`      | Done    | Core constructor.                                                  |
| `fs.ref(row)`             | Done    | Firestore document reference provider value.                       |
| `fs.ref(path)`            | Done    | Firestore document reference provider value constructor.           |
| `fs.parentPath(row)`      | Missing | Metadata function from spec.                                       |
| `fs.databaseId(row)`      | Missing | Useful with named database reads.                                  |

## P3 Product/Quality Gaps

| Area               | Status                     | Notes                                                                                                                            |
| ------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Full grammar       | Partial                    | Parser now uses source-located statements, but expression and pipeline grammar still need broader syntax coverage.               |
| Source-located AST | Done                       | Top-level declarations and stages carry source columns/ranges; parser expression diagnostics use source columns.                 |
| Editor language    | Done                       | FDQL has a reusable language service plus Monaco language id, highlighting, bracket/comment rules, completions, and diagnostics. |
| FDQL type model    | Done                       | Core/runtime values are tagged internally and encoded at output.                                                                 |
| Provider adapters  | Partial                    | Firestore values normalize/encode in provider repos; core FDQL has no Firestore-shaped runtime API.                              |
| Type inference     | Missing                    | Compiler does not infer expression, stage, or result column types.                                                               |
| Row-shape analysis | Missing                    | Unknown fields are runtime missing values; compiler does not prove row shape.                                                    |
| Lineage UI         | Partial                    | Events carry provider-neutral row lineage, but UI does not expose source exploration.                                            |
| More E2E           | Partial                    | Covers main read paths plus nested map/array lookup cache. Still needs deterministic cancel/timeout and named DB coverage.       |
| Generated scripts  | Not planned for current UI | Spec mentions generated scripts, but current product slice intentionally has no JS snippet panel. Revisit before implementing.   |

## Suggested Next Order

1. Add deterministic cancel/timeout coverage.
2. Add named database coverage.
3. Implement missing read syntax from P1/P2.
