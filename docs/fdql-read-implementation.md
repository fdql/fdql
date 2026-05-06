# FDQL Read Implementation Tracker

Last updated: 2026-05-07

Source spec: [FDQL](./fdql.md)

Scope: read features only. Write operations are out of this tracker.

## Status Legend

- Done: implemented in parser/compiler/runtime and covered by tests.
- Partial: works for a narrow path, but does not match the spec yet.
- Missing: not implemented.

## Current Read Slice

| Area            | Status  | Notes                                                                                   |
| --------------- | ------- | --------------------------------------------------------------------------------------- |
| FDQL tab        | Done    | Dedicated tab, Run/Cancel, source persistence, Results/Issues.                          |
| Result views    | Done    | Table, Tree, lazy JSON, rows/reads/scanned/elapsed stats.                               |
| IPC             | Done    | `fdql.compile`, `fdql.run`, `fdql.cancel`, event stream.                                |
| Mock repository | Done    | Uses existing fixture collections through in-memory runtime.                            |
| Live repository | Partial | Uses paged Admin SDK collection/collection group reads for the first read source shape. |
| Parser          | Partial | Statement grammar keeps existing syntax and now records source columns/ranges.          |
| Compiler        | Partial | Builds one native read source plus local stages.                                        |
| Executor        | Partial | Streams rows after runtime returns docs. Supports basic local stages.                   |
| E2E             | Partial | Covers bounded reads, field projection, and duplicate singleton diagnostics.            |

## Implemented Read Syntax

```fdql
set readBudget = 5000
set timeout = "60s"
set cache = "off"
set allowUnboundedReads = false

alias $drivers = fs.project("prod").db("db2").collection("drivers", ["firstName"])
alias $orders = fs.collectionGroup("orders", [])

from $drivers as d
fs where d.active = true
fs where fs.id(d) = "drv_1"
fs order by d.createdAt desc
fs limit 25

then filter lower(d.firstName) = "vini"
then take 10
then with fs.id(d) as id, d.firstName

then lookup one $teams as team
  fs where fs.id(team) = d.teamId

then lookup many $rounds as rounds
  fs where rounds.driverId = fs.id(d)
  fs order by rounds.createdAt desc
  fs limit 20

return id, d.firstName
```

Implemented expression/runtime basics:

- literals, arrays, maps, `$aliases`
- qualified field paths like `d.firstName`
- comparisons: `=`, `!=`, `<`, `<=`, `>`, `>=`
- `and`, `or`, unary `not`
- `in`
- `fs.id(row)`, `fs.path(row)`, `fs.projectId(row)`
- `fs.timestamp(value)`
- `fs.arrayContains(field, value)`
- `lower(value)`
- `return *`
- field masks, including `[]` metadata-only reads
- collection paths, collection groups, explicit project, named database

## P0 Gaps

These block the read implementation from being honest at production scale.

| Feature                          | Status  | Notes                                                                                                                            |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Live streaming/pages             | Done    | Live repo uses cursor pages and caps each page by configured page size and remaining read budget/native limit.                   |
| Read budget in live repo         | Done    | Runtime read requests cap Firestore page reads before docs are fetched.                                                          |
| Cancel in live repo              | Partial | Cancel is observed between pages/rows, but not while a Firestore page request is already in flight.                              |
| Timeout in live repo             | Partial | Same issue as cancel.                                                                                                            |
| Cache modes                      | Missing | `set cache = ...` parses/compiles, but runtime does not dedupe or cache reads.                                                   |
| Provider query validation parity | Partial | Compiler validates simple native shapes. Needs stronger Firestore limit/operator/index-shape diagnostics.                        |
| Field path fidelity              | Partial | Live field masks split on `.`, so literal dotted field names are not represented yet. Need explicit field-path segment handling. |

## P1 Spec Features Not Implemented

| Feature                                   | Status  | Notes                                                                        |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `lookup one`                              | Done    | Attaches one document or `null`; reports an error if multiple docs are read. |
| `lookup many`                             | Done    | Attaches an array and counts lookup reads separately.                        |
| `lookup expand`                           | Missing | Needs row multiplication and lineage.                                        |
| `lookup aggregate`                        | Missing | Needs provider aggregate execution.                                          |
| `fs.subcollection(parent, name, fields?)` | Missing | Needed for document-relative reads.                                          |
| `fs.subcollections(parent)`               | Missing | Needed for subcollection discovery.                                          |
| `unwind array`                            | Missing | Needed for local array expansion.                                            |
| `unwind entries(map)`                     | Missing | Needed for keyed-map workflows.                                              |
| `union all`                               | Missing | Parser has no branch AST or executor support.                                |
| `sort by`                                 | Missing | Local sort stage is in the spec but not parser/executor.                     |
| `aggregate`                               | Missing | Local grouping/aggregation not implemented.                                  |
| Firestore aggregations                    | Missing | `fs.count`, `fs.sum`, `fs.avg`, `fs.min`, `fs.max` not implemented.          |

## P2 Expression Gaps

| Expression                | Status  | Notes                                                      |
| ------------------------- | ------- | ---------------------------------------------------------- |
| `not in`                  | Missing | Parser supports unary `not`, not `not in` as one operator. |
| `is null` / `is not null` | Missing | Needs parser and Firestore/local semantics.                |
| `exists` / `missing`      | Missing | Needs clear distinction between missing and null.          |
| `fs.arrayContainsAny`     | Missing | Firestore-native operator.                                 |
| `case`                    | Missing | Local expression only.                                     |
| math expressions          | Missing | `+`, `-`, `*`, `/`, `%` not parsed.                        |
| `mapGet(map, key)`        | Missing | Spec exists, evaluator does not implement it.              |
| `entries(map)`            | Missing | Needed by `unwind entries(...)`.                           |
| `fs.ref(row)`             | Missing | Metadata function from spec.                               |
| `fs.parentPath(row)`      | Missing | Metadata function from spec.                               |
| `fs.databaseId(row)`      | Missing | Useful with named database reads.                          |

## P3 Product/Quality Gaps

| Area               | Status                     | Notes                                                                                                                          |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Full grammar       | Partial                    | Parser now uses source-located statements, but expression and pipeline grammar still need broader syntax coverage.             |
| Source-located AST | Done                       | Top-level declarations and stages carry source columns/ranges; parser expression diagnostics use source columns.               |
| Row-shape analysis | Missing                    | Unknown fields are mostly runtime `undefined`; compiler does not prove row shape.                                              |
| Lineage UI         | Partial                    | Events carry basic document lineage, but UI does not expose source exploration.                                                |
| More E2E           | Partial                    | Need coverage for tree/json views, cancel, timeout, budget stop, collection group, named DB, and future lookup/unwind/union.   |
| Generated scripts  | Not planned for current UI | Spec mentions generated scripts, but current product slice intentionally has no JS snippet panel. Revisit before implementing. |

## Suggested Next Order

1. Implement `unwind` plus `entries(map)` and `mapGet`.
2. Implement `union all`.
3. Implement local `sort by` and `aggregate`.
4. Implement Firestore aggregation lookups.
5. Add E2E per completed feature.
