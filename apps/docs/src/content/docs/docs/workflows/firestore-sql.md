---
title: Firestore SQL beta
description: Read-only SQL workspace for Firestore inspection, joins, plans, and generated Firebase Desk JS Query snippets.
---

Firestore SQL is a beta read-only workspace for exploring Firestore data with SQL-shaped queries.

It is useful when the question is easier to express as a query than as a tree click path: selecting a few fields, comparing collections, joining related documents, expanding arrays or maps, and turning the result into a Firebase Desk JavaScript Query snippet.

## What works now

- `select` from collections, explicit collection paths, and collection groups.
- Top-level `union all`.
- Inner and left equality joins.
- Local expansion with `unnest(array)` and `entries(map)`.
- Metadata functions such as `id(alias)`, `path(alias)`, and `project_id(alias)`.
- Map entry helpers: `key(entry)` and `value(entry)`.
- Computed output fields.
- Read budget, timeout, cancel, live stats, and partial results.
- Firestore field projection for selected/filter fields where safe.
- Metadata-only reads for queries such as `select id(e)`.
- Generated Firebase Desk JavaScript Query snippets.

## Current limits

- The SQL tab is read-only. `insert`, `update`, and `delete` syntax is blocked in the product UI.
- Aggregation is specified, but not user-facing in the first beta.
- Recursive CTE syntax is specified, but not executable.
- The current plan panel still exposes the internal planner shape. A clearer execution-plan language is specified and planned for the UI.
- Some join strategies run locally even when the syntax looks like SQL. The plan and stats should be treated as part of the query.

## Collection names

Normal collection ids can be used directly:

```sql
select id(o), o.status
from orders o
limit 25
```

Collection ids outside normal identifier rules use backticks or `collection("...")`:

```sql
select e.slug
from `admin-events` e
limit 10
```

```sql
select e.slug
from collection("admin-events") e
limit 10
```

## Joins

```sql
select id(o) as orderId, o.status, c.email
from orders o
left join customers c on c.name = o.customer
where o.status = "paid"
limit 25
```

In beta, joins are driven by Firebase Desk. Firestore performs reads; Firebase Desk does the matching, tracks join misses, and streams rows into the result table.

## Maps and arrays

Use `entries()` for keyed maps:

```sql
select
  id(g) as gameId,
  key(r) as roundId,
  value(r).description as roundDescription
from games g
cross join entries(g.rounds) r
```

Use `unnest()` for arrays:

```sql
select id(o) as orderId, item.sku, item.price
from orders o
cross join unnest(o.items) item
```

## Safety model

Firestore SQL beta should make read work easier without pretending Firestore is a relational database.

- Read budgets stop broad scans.
- Cancel stops active runs.
- Result stats show reads, scanned rows, output rows, and join misses.
- Production use is allowed, but broad reads should be planned and monitored.
- Writes stay out of the SQL tab until the safety model is explicit enough.

## Tracking

The repo tracks implementation separately from the dialect spec:

- [Dialect contract](https://github.com/viniciusrmcarneiro/firebase-desk/blob/main/docs/firestore-sql-dialect.md): language contract.
- [Product behavior](https://github.com/viniciusrmcarneiro/firebase-desk/blob/main/docs/firestore-sql.md): product behavior and execution-plan language.
- [Implementation status](https://github.com/viniciusrmcarneiro/firebase-desk/blob/main/docs/firestore-sql-implementation-status.md): shipped, partial, spec-only, and deferred work.
