# Firestore SQL Spec

## Goal

Define a Firestore-aware SQL dialect for Firebase Desk.

This is not general SQL support and not a Firestore replacement. The dialect should make Firestore data easier to inspect, join, aggregate, and mutate while keeping execution behavior explicit.

## Principles

- Query text should look like SQL where SQL is a good fit.
- Firestore-native stages and local stages must be visible in the execution plan.
- Firestore types must be expressible without guessing string intent.
- Reads, writes, cache hits, cache misses, pages, and partial failures must be observable while a query runs.
- Schema is optional. Discovery and user-defined schema improve planning, autocomplete, and validation.
- SQL execution should stay honest about Firestore limits, indexes, batches, and partial writes.

## Query Classes

Supported query classes:

- `select`
- `delete`
- `update`
- `update ... from`
- `insert ... values`
- `insert ... select`
- `describe`
- `discover schema`

## Product Scope

Core product surface:

- `select`
- top-level `union all`
- joins
- computed select fields
- aggregation
- read budgets, live read stats, and cache
- execution plan
- source exploration and lineage
- subcollection sources
- direct subcollection discovery
- project context aliases
- cross-project `select`
- `delete`
- cross-project `delete`
- `update`
- `update ... from`
- cross-project `update`
- `insert`
- `insert ... select`
- cross-project `insert`
- schema `describe`
- schema discovery
- generated Firebase Desk JS Query snippets

Planned extensions:

- generated standalone Firebase Admin JS snippets
- generated standalone Firebase Admin TS snippets
- parenthesized select subqueries
- `union distinct`
- global `order by` and `limit` over union results
- recursive subcollection discovery
- transaction-aware execution for supported write plans
- Firebase Web SDK snippets
- saved shared schema packs
- reusable query context profiles
- recursive CTEs

## Collections

Collection query:

```sql
select *
from orders o
where o.status = "paid"
order by o.createdAt desc
limit 100
```

Explicit collection path:

```sql
select *
from collection("customers/cus_123/orders") o
where o.status = "paid"
```

Collection group query:

```sql
select *
from collection_group("orders") o
where o.status = "paid"
```

Subcollection query from parent rows:

```sql
select id(c) as customerId, id(o) as orderId, o.status
from customers c
cross join subcollection(c, "orders") o
where o.status = "paid"
```

Subcollection discovery:

```sql
select path(c) as customerPath, id(sc) as subcollectionId, path(sc) as subcollectionPath
from customers c
cross join subcollections(c) sc
```

Query every direct subcollection under parent rows:

```sql
select path(c) as customerPath, id(sc) as collectionId, path(doc) as documentPath
from customers c
cross join subcollections(c) sc
cross join subcollection(c, id(sc)) doc
```

Subcollection rules:

- `collection("orders")` and `orders` are equivalent for root collections.
- `collection("customers/cus_123/orders")` targets one explicit subcollection path.
- `collection(...)` must resolve to a Firestore collection path.
- `collection_group("orders")` targets all subcollections named `orders`.
- `collection_group(...)` accepts a collection id, not a path.
- `subcollection(parentAlias, "orders")` targets the named subcollection under each parent document.
- `subcollection(parentAlias, nameExpression)` supports a discovered collection id, for example `id(sc)`.
- `subcollections(parentAlias)` lists direct subcollections under each parent document.
- `subcollection()` runs per loaded parent page.
- `subcollections()` runs per loaded parent page.
- Filters on a `subcollection()` alias can be pushed into each per-parent Firestore query when they only reference that alias.
- `cross join subcollection(...)` emits one row per matching child document.
- `left join subcollection(...)` preserves parent rows with a null child when no child documents match.
- `subcollections()` returns metadata rows, not documents.
- Metadata rows use the same metadata functions as documents.
- Subcollection list calls should be tracked separately from document reads.
- Use `collection_group()` when the parent document does not matter.
- Use `subcollection()` when the parent document is part of the result, filter, lineage, update, or delete.

Document metadata:

```sql
select id(o), path(o), ref(o), parent_path(o)
from orders o
where id(o) in ("ord_1024", "ord_1025")
```

## Projects

Queries run against the selected Firebase Desk project target by default. The product should also support explicit cross-project sources for `select`, `insert`, `update`, and `delete`.

Explicit project collection:

```sql
select *
from project("prod").orders o
where o.status = "paid"
```

Explicit project subcollection:

```sql
select *
from project("prod").collection("customers/cus_123/orders") o
```

Explicit project collection group:

```sql
select *
from project("prod").collection_group("orders") o
```

Project context aliases:

```text
source = prod
target = staging
```

```sql
select id(src) as orderId, src.status, dst.status as targetStatus
from project($source).orders src
left join project($target).orders dst on id(dst) = id(src)
```

The aliases are query settings, not SQL declarations. The user can change `source` and `target` from the query context UI without editing the query text.

Cross-project join:

```sql
select id(prod) as orderId, prod.status, stage.status as stagingStatus
from project("prod").orders prod
left join project("staging").orders stage on id(stage) = id(prod)
```

Cross-project update:

```sql
update project("staging").orders stage
from project("prod").orders prod
set
  copiedStatus = prod.status,
  copiedAt = now()
where id(stage) = id(prod)
```

Cross-project delete:

```sql
delete from project("staging").orders stage
using project("prod").orders prod
where id(stage) = id(prod)
  and prod.deleted = true
limit 1000
page size 100
write batch size 400
```

Project rules:

- `project("...")` resolves a configured Firebase Desk project target, including emulator or production targets.
- `project($alias)` resolves a query context alias to a configured Firebase Desk project target.
- The default source project is the currently selected tab project.
- Every source alias has one project target.
- Context aliases are external query settings and must be shown in the execution plan with their resolved project target.
- Missing context aliases are validation errors.
- Context aliases can be reused by saved queries.
- Results, lineage, read stats, write stats, and cache keys must include project target.
- Budgets are shown as total and per project.
- Cross-project `select` can read from multiple project targets.
- Cross-project `insert`, `update`, and `delete` write to exactly one target alias per statement.
- Cross-project writes are not atomic across project targets.
- Cross-project writes can use paginated reads plus write batches or BulkWriter.

## Field Paths

Map fields use dot paths:

```sql
select o.customer.email, o.shipping.address.city
from orders o
where o.customer.tier = "gold"
```

Firestore field names containing dots, spaces, or reserved words use backticks:

```sql
select o.`billing.total`, o.`created by`
from orders o
```

Path rules:

- `o.customer.email` means nested map fields.
- A backticked path segment means one Firestore field name, for example `billing.total`.
- Metadata is only available through functions, not reserved pseudo-fields.
- `id`, `path`, `ref`, `parent_path`, and `project_id` are normal field names when accessed as fields.
- `o.id` means the document field named `id`.
- `o.path` means the document field named `path`.
- Subcollection metadata rows do not expose pseudo-fields. Use `id(sc)`, `path(sc)`, and `project_id(sc)`.
- `id(value)` returns document id or metadata row id.
- `path(value)` returns full document path or metadata row path.
- `ref(value)` returns document reference for a document row and collection reference for a subcollection metadata row.
- `parent_path(value)` returns the parent document path when available.
- `parent_ref(value)` returns the parent document reference when available.
- `project_id(value)` returns the Firebase Desk project target id.
- `id(documentAlias)` maps to Firestore `FieldPath.documentId()` / `__name__` when used in native document filters or ordering.

## Firestore Types

Plain literals:

```sql
null
true
false
"paid"
123
123.45
```

Typed Firestore literals:

```sql
timestamp("2026-01-01T00:00:00Z")
geopoint(-37.8136, 144.9631)
ref("users/u_123")
bytes_base64("SGVsbG8=")
vector([0.12, 0.48, 0.92])
int(10)
double(10)
```

Convenience date helpers:

```sql
date("2026-01-01")
now()
```

`date()` is not a Firestore stored type. It produces a timestamp boundary value. The planner must show the concrete timestamp used.

## Operators

Comparison:

```sql
=
!=
<
<=
>
>=
```

Set membership:

```sql
where o.status in ("paid", "refunded")
where o.status not in ("draft", "test")
```

Null and missing fields:

```sql
where o.deletedAt is null
where exists(o.customer.email)
where missing(o.customer.email)
```

Firestore-native array operators:

```sql
where array_contains(o.tags, "vip")
where array_contains_any(o.tags, ("vip", "trial"))
```

Planner classification examples:

```text
o.status = "paid"                         native when used on base query
o.createdAt >= timestamp("...")           native when indexable
array_contains(o.tags, "vip")             native
exists(o.items, item...)                  not supported syntax
exists(select 1 from unnest(o.items) ...) local
entries(o.rounds)                         local
missing(o.customer.email)                 local
```

## Missing, Null, and Type Rules

Firestore documents can have missing fields. Missing is not the same as explicit `null`.

Rules:

- `field is null` matches explicit `null`.
- `field is not null` matches present non-null values.
- `missing(field)` matches an absent field.
- `exists(field)` matches a present field, including explicit `null`.
- `coalesce(value, fallback)` treats missing and `null` as absent.
- Comparisons against missing values are false.
- Comparisons against `null` are false except `is null` and `is not null`.
- Math with missing, `null`, or non-number operands returns `null` and records a local expression warning.
- `where` predicates that evaluate to missing, `null`, or non-boolean are false.
- `count(*)` counts rows.
- `count(field)` counts present non-null values.
- `count(distinct field)` ignores missing and `null`.
- `sum`, `avg`, `min`, and `max` ignore missing and `null`.
- Numeric aggregates over non-number values produce a planner warning when schema is known, otherwise a runtime warning.
- Local sort places missing values last. `null` sorts before non-null values in ascending order and after non-null values in descending order.
- Native Firestore stages may have different edge behavior; the planner must either compile an equivalent native query or show a warning.

## Arrays

Use `unnest()` to expose array elements as rows.

Filter documents that have at least one matching item:

```sql
select id(o)
from orders o
where exists (
  select 1
  from unnest(o.items) item
  where item.total > 1
)
```

Filter documents by item code:

```sql
select id(o)
from orders o
where exists (
  select 1
  from unnest(o.items) item
  where item.code in ("a1", "a2")
)
```

Expose item rows:

```sql
select id(o), item.code, item.total
from orders o
cross join unnest(o.items) item
where item.total > 1
```

Every item matches:

```sql
select id(o)
from orders o
where not exists (
  select 1
  from unnest(o.items) item
  where item.qty <= 0
)
```

Array rules:

- `unnest()` is local.
- `array_contains()` and `array_contains_any()` may compile to native Firestore filters.
- Local array predicates run after the base Firestore query page is loaded.
- `cross join unnest()` can multiply output rows.
- `left join unnest()` preserves the source row when the array is missing or empty.

## Maps

Use `entries()` to expose map entries as rows.

Given this document shape:

```json
{
  "rounds": {
    "id-1": { "description": "blah 1" },
    "id-2": { "description": "blah 2" }
  }
}
```

Expand keyed map entries:

```sql
select
  id(g) as gameId,
  key(r) as roundId,
  r.description
from games g
cross join entries(g.rounds) r
```

Filter by map key:

```sql
select id(g), key(r), r.description
from games g
cross join entries(g.rounds) r
where key(r) in ("id-1", "id-2")
```

Use repeated ids inside values when present:

```sql
select
  id(g) as gameId,
  key(r) as roundKey,
  r.id as roundFieldId,
  r.description
from games g
cross join entries(g.rounds) r
```

Map rules:

- `entries(map)` is local.
- `entries()` returns entry rows, not documents.
- `key(entry)` returns the map key.
- `value(entry)` returns the map value.
- Field access on an entry row proxies to the map value, so `r.description` is equivalent to `value(r).description`.
- `key(entry)` is the source of truth for the map key.
- A repeated id field inside the value is just data and may differ from `key(entry)`.
- `cross join entries(...)` emits one row per map entry.
- `left join entries(...)` preserves the source row with a null entry when the map is missing or empty.
- Map entry expansion can feed `select`, local filters, joins, aggregation, source exploration, and generated snippets.
- Writes target the parent document field path, not a separate document.

## Select Fields

Projection:

```sql
select id(o), o.status, o.total
from orders o
```

Computed fields:

```sql
select
  id(o) as orderId,
  o.total,
  o.total * 1.1 as totalWithTax,
  coalesce(o.customer.email, "unknown") as customerEmail,
  case when o.total >= 100 then "high" else "normal" end as valueBand
from orders o
```

Initial functions:

- `coalesce(value, fallback)`
- `lower(value)`
- `upper(value)`
- `concat(...)`
- `round(value, digits)`
- `date_trunc(unit, timestamp)`
- `now()`
- `id(value)`
- `path(value)`
- `ref(value)`
- `parent_path(value)`
- `parent_ref(value)`
- `project_id(value)`
- `key(entry)`
- `value(entry)`

Computed fields are local unless the planner can prove they are only projection aliases.

## Joins

Document id join:

```sql
select id(o), u.email
from orders o
left join users u on id(u) = o.userId
```

Reference join:

```sql
select id(o), u.email
from orders o
left join users u on ref(u) = o.userRef
```

Field join:

```sql
select id(o), u.email
from orders o
left join users u
  on u.companyId = o.companyId
 and u.email = o.customerEmail
```

Collection group join:

```sql
select id(o), p.status
from orders o
left join collection_group("payments") p
  on p.orderId = id(o)
```

Join types:

- `inner join`
- `left join`
- `cross join unnest(...)`
- `left join unnest(...)`
- `cross join entries(...)`
- `left join entries(...)`
- `cross join subcollection(...)`
- `left join subcollection(...)`

Join strategies:

- document id lookup
- document reference lookup
- indexed equality lookup
- multi-field equality lookup
- collection group equality lookup
- local array expansion
- local map entry expansion
- per-parent subcollection query
- cross-project lookup

Rules:

- Joins run after the base query page is loaded.
- Join lookups stream per page.
- Duplicate matches produce duplicate result rows for `select`.
- `update ... from` must reject duplicate joined matches for one target row unless a future conflict policy is defined.
- Cross-project joins are allowed for `select`, `update`, and `delete`.
- The execution plan must show lookup strategy, expected index needs, and cache policy.

## Union

The core dialect supports top-level `union all` between `select` statements.

```sql
select id(o) as orderId, o.status, "prod" as source
from project("prod").orders o
where o.status = "paid"

union all

select id(o) as orderId, o.status, "staging" as source
from project("staging").orders o
where o.status = "paid"
```

Rules:

- `union all` is allowed only at the top level in the core dialect.
- Each branch is a full `select` statement.
- Branches must return the same number of columns.
- Column names come from the first branch.
- Unknown or incompatible column types produce planner warnings, not parser errors.
- Each branch has its own native Firestore plan and local stages.
- Branches may target different projects.
- Budgets apply globally and per branch/project.
- Results stream with branch lineage.
- Per-branch `order by` is allowed when it can run inside the branch.
- No global ordering is implied across streamed union output.
- Plain `union` / distinct union is a planned extension.
- Parenthesized union subqueries are a planned extension.
- Global `order by` and `limit` over union results are a planned extension because they require final local buffering.

## Aggregation

Basic aggregation:

```sql
select
  o.status,
  count(*) as orders,
  sum(o.total) as revenue,
  avg(o.total) as avgOrder,
  count(distinct o.customerId) as customers
from orders o
where o.createdAt >= timestamp("2026-01-01T00:00:00Z")
group by o.status
```

Aggregation over joins:

```sql
select
  u.tier,
  count(*) as orders,
  sum(o.total) as revenue
from orders o
left join users u on id(u) = o.userId
where o.status = "paid"
group by u.tier
having count(*) > 10
```

Initial aggregate functions:

- `count(*)`
- `count(field)`
- `count(distinct field)`
- `sum(field)`
- `avg(field)`
- `min(field)`
- `max(field)`

Rules:

- Native aggregation may be used when the repository can compile it directly to Firestore.
- Grouped aggregation is local unless Firestore support exists for the exact plan.
- Aggregation should stream partial results.
- Aggregation results must expose source rows used by the selected result group.
- Source exploration should show base document, joined documents, computed values, cache hits, and filter/aggregation lineage.

## Recursive CTEs

Recursive CTEs are a planned design area for tree and graph traversal. They are not Firestore-native; they would execute as a local iterative pipeline over Firestore queries, joins, refs, subcollections, maps, or arrays.

Useful cases:

- walk parent/child document relationships
- follow document reference fields
- traverse nested subcollections
- expand keyed maps that model child records
- build organization, category, account, or game trees

Candidate shape:

```sql
with recursive tree(accountId, accountPath, depth) as (
  select id(a), path(a), 0
  from accounts a
  where id(a) = "root"

  union all

  select id(child), path(child), tree.depth + 1
  from tree
  join accounts child on child.parentId = tree.accountId
  where tree.depth < 5
)
select *
from tree
```

Design rules to settle before implementation:

- require a max depth from SQL, query context, or both
- define cycle detection, likely by explicit key expression
- expose iteration count, per-iteration reads, and stopped reason
- make recursive work visible in the execution plan
- decide whether recursion can drive writes or only `select`
- keep budgets enforced across all iterations
- avoid implying Firestore can run recursive queries natively

## Budgets

Budgets and execution controls can be query context settings or statement clauses. Query context provides defaults. Statement clauses override those defaults for one command.

Recommended UI settings:

- read budget
- write budget
- page size
- write batch size
- write mode: batch or BulkWriter
- timeout
- cache mode

Command session defaults are configured outside SQL:

```text
read_budget = 5000
write_budget = 2000
page_size = 100
write_batch_size = 400
write_mode = batch
timeout = 60s
cache_mode = session
```

Live execution stats:

```text
Reads: 1,240 / 5,000
Writes: 0 / 0
Project reads: prod 900, staging 340
Project writes: staging 0
Write batches: 0
Subcollection list calls: 42
Pages: 13
Rows scanned: 1,200
Rows output: 184
Join misses: 37
Cache hits: 812
Cache misses: 94
Elapsed: 8.2s
```

When a budget is hit, execution stops and returns partial results with a clear stopped status.

## Execution Clauses

Statement-level execution clauses sit at the end of the command.

Select:

```sql
select *
from orders o
where o.status = "paid"
limit 500
page size 100
```

Delete:

```sql
delete from project("staging").orders o
where o.status = "test"
limit 1000
page size 100
write batch size 400
```

Update:

```sql
update project("staging").orders o
set archived = true
where o.status = "closed"
limit 1000
page size 100
write batch size 400
```

Insert from select:

```sql
insert into project("staging").archivedOrders(@id, sourceId, status)
write batch size 400
select id(o), id(o), o.status
from project("prod").orders o
where o.status = "closed"
limit 1000
page size 100
```

Rules:

- `limit n` caps output rows for `select`.
- `limit n` caps source rows produced by the read pipeline for `delete`, `update`, and `insert ... select`.
- `page size n` controls source read pagination.
- `write batch size n` controls write commit chunking.
- `write mode batch` or `write mode bulk_writer` can override the query context write mode.
- Write operations stop when the source pipeline stops.
- `limit` is not a write limit. It only affects writes because fewer source rows are read.
- `insert ... values` does not use pagination clauses because the values list is already the full write set.
- Local joins and local filters may require reading more source rows than the final source limit emits.
- The execution plan must show whether each value came from query context or statement clauses.

## Write Execution

Write execution options belong in query context by default. Statement clauses override them for a single command.

Query context options:

- read page size
- write batch size
- write mode: batch or BulkWriter
- max pending writes
- write budget
- stop on first write error

Command-level clauses:

```sql
insert into project("staging").archivedOrders(@id, sourceId, status)
write batch size 400
write mode batch
select id(o), id(o), o.status
from project("prod").orders o
where o.status = "closed"
limit 1000
page size 100
```

Rules:

- Cross-project `insert ... select`, `update ... from`, and `delete ... using` can stream source pages and commit writes per batch.
- Batching is an execution option, not a separate command.
- The planner must show read page size, write batch size, write mode, write budget, and target project.
- Write batches are committed sequentially unless the selected write mode supports controlled concurrency.
- Partial completion is possible after a committed batch.
- Live stats must show source pages read, write batches attempted, committed writes, failed writes, retries, and stopped reason.
- Batch size must respect Firestore write limits.

## Cache

Cache layers:

- run cache: dedupe lookups during one query run; always on
- session cache: optional, persists while app is open
- configured cache: optional, user-defined by collection or criteria

Examples:

```text
plans/*                          cache all plan docs
users where companyId = "acme"    cache matching user docs
project("prod").plans/*           cache prod plan docs
```

Rules:

- The execution plan must show cache mode per source.
- Live stats must show cache hits and misses.
- Cached data must show age/freshness.
- Cache keys must include project target, collection path, query shape, and lookup key.
- User can clear cache.
- User can disable cache for a query.
- Writes must invalidate or mark affected cached entries stale.

## Execution Plan

Before running, show parsed stages.

Example:

```text
Budget: 5,000 reads
Cache: session

1. Stream orders
   filter: status = "paid"
   order: createdAt desc
   page size: 100
   max rows: 500
   native filters: status
   native order: createdAt

2. Join users
   type: left join
   lookup: users where companyId = order.companyId and email = order.customerEmail
   strategy: indexed equality lookup
   cache: session key users(companyId,email)

3. Compute fields
   totalWithTax = total * 1.1

4. Aggregate
   group by: user.tier
   metrics: count(*), sum(total)

5. Output
   stream partial groups
   expose source rows per group
```

The plan should classify stages:

- native Firestore query
- native Firestore aggregation
- local filter
- local join
- local compute
- local aggregation
- local map entry expansion
- union branch
- cross-project read
- cross-project write
- subcollection query
- subcollection discovery
- write batch

## Generated Scripts

Firebase Desk SQL should be able to generate runnable JS/TS snippets from the planned query. This is code generation, not JS execution inside SQL.

Primary target:

- Firebase Desk JavaScript Query

Additional targets:

- Firebase Admin JS
- Firebase Admin TS
- Firebase Web SDK

Example SQL:

```sql
select
  id(o) as orderId,
  o.total * 1.1 as totalWithTax,
  coalesce(o.customer.email, "unknown") as customerEmail
from orders o
where o.status = "paid"
```

Generated Firebase Desk JS Query shape:

```js
const query = db.collection("orders").where("status", "==", "paid");

for await (const doc of streamQuery(query)) {
  const o = doc.data();

  yield {
    orderId: doc.id,
    totalWithTax: o.total * 1.1,
    customerEmail: o.customer?.email ?? "unknown",
  };
}
```

Generation rules:

- Generate from the execution plan, not directly from raw SQL text.
- Generated code must preserve native query stages, local stages, joins, budgets, and write behavior.
- Generated code should label native Firestore query work and local work with short comments.
- `id(value)` compiles to `doc.id` or `FieldPath.documentId()` depending on position.
- `path(value)`, `ref(value)`, `parent_path(value)`, `parent_ref(value)`, and `project_id(value)` compile to metadata helpers.
- `key(entry)` and `value(entry)` compile to map-entry helper access.
- `select` generation should emit streamed rows or aggregate output.
- `delete` generation should emit document ref collection plus batched/BulkWriter deletion.
- `update` generation should emit document ref collection plus patch writes.
- `insert` generation should preserve `@id` destination document-id behavior.
- The snippet should be editable by the user after generation.
- The snippet is an export/view of the plan. SQL execution does not depend on generated code.

## Schema

Schema discovery:

```sql
discover schema for orders limit 500
discover schema for collection("customers/cus_123/orders") limit 500
discover schema for collection_group("orders") limit 1000
discover schema for project("prod").collection_group("orders") limit 1000
describe orders
```

User-defined partial schema:

```sql
schema orders {
  id string
  status string
  total double
  createdAt timestamp
  userId string
  userRef ref users
  items array<map<{
    code string
    qty int
    total double
  }>>
}
```

Schema use:

- autocomplete
- type validation
- join validation
- typed literal hints
- native/local plan warnings
- result formatting
- computed field validation

Schema must never be required to run a query.

## Delete

Simple delete:

```sql
delete from orders o
where o.status = "test"
```

Explicit subcollection delete:

```sql
delete from collection("customers/cus_123/orders") o
where o.status = "test"
```

Delete with join filter:

```sql
delete from orders o
using users u
where o.userId = id(u)
  and u.disabled = true
```

Dynamic subcollection delete:

```sql
delete o
from customers c
cross join subcollection(c, "orders") o
where c.disabled = true
  and o.status = "test"
```

Cross-project delete:

```sql
delete from project("staging").orders stage
using project("prod").orders prod
where id(stage) = id(prod)
  and prod.deleted = true
```

Rules:

- For `delete from source alias`, the deleted target is the `from` alias.
- Use `delete alias from ...` when the target is produced by a join, `subcollection()`, or another source expression.
- The target alias must resolve to Firestore document refs.
- The target alias may be in the selected project or an explicit `project("...")` source.
- The source pipeline identifies document refs to delete.
- Execution uses batches or BulkWriter depending on repository implementation.
- Delete can stream source pages and commit per configured write batch.
- Live stats show attempted, succeeded, failed, retries, and partial failure details.

## Update

Simple update:

```sql
update orders o
set
  archived = true,
  archivedAt = now()
where o.status = "closed"
```

Explicit subcollection update:

```sql
update collection("customers/cus_123/orders") o
set
  archived = true,
  archivedAt = now()
where o.status = "closed"
```

Firestore write helpers:

```sql
update orders o
set
  updatedAt = server_timestamp(),
  retryCount = increment(1),
  tags = array_union("archived"),
  staleTag = array_remove("active"),
  temporaryNote = delete_field()
where o.status = "closed"
```

Static keyed map update:

```sql
update games g
set
  rounds.`id-1`.description = "changed"
where id(g) = "game_1"
```

Parameterized keyed map update:

```text
roundId = id-1
```

```sql
update games g
set
  field_path("rounds", $roundId, "description") = "changed"
where id(g) = "game_1"
```

This updates one map entry: `rounds.id-1.description`.

Entry-driven keyed map update:

```sql
update g
from games g
cross join entries(g.rounds) r
set
  field_path("rounds", key(r), "description") = "changed"
where id(g) = "game_1"
  and key(r) in ("id-1", "id-2")
```

This updates the matched map entries only: `rounds.id-1.description` and `rounds.id-2.description`.

Update from:

```sql
update orders o
from users u
set
  customerEmail = u.email,
  customerTier = u.tier
where o.userId = id(u)
```

Dynamic subcollection update:

```sql
update o
from customers c
cross join subcollection(c, "orders") o
set
  archived = true,
  archivedAt = now()
where c.disabled = true
  and o.status = "closed"
```

Cross-project update:

```sql
update project("staging").orders stage
from project("prod").orders prod
set
  copiedStatus = prod.status,
  copiedAt = now()
where id(stage) = id(prod)
limit 1000
page size 100
write batch size 400
```

Rules:

- `set` is patch/update semantics, not document overwrite.
- Field paths may target nested map fields.
- Backticked path segments support literal map keys that contain dots, spaces, or reserved words.
- `field_path(...)` builds a dynamic update path from string expressions.
- `$roundId` style values are query parameters supplied by the query context UI.
- `field_path("rounds", $roundId, "description")` targets exactly one field path for each source row.
- `field_path("rounds", key(r), "description")` targets one field path per matched map entry row.
- Dynamic field paths are local write planning and cannot be Firestore-native filters.
- Use `update alias from ...` when the target is produced by a join, `subcollection()`, or another source expression.
- The target alias must resolve to Firestore document refs.
- The target alias may be in the selected project or an explicit `project("...")` source.
- Duplicate joined matches for one target document are an error.
- Update can stream source pages and commit per configured write batch.
- Failed writes are reported per document.
- There is no implicit rollback after completed writes.

## Insert

Insert with explicit id:

```sql
insert into tags(@id, name, kind)
on conflict fail
values ("vip", "VIP", "customer")
```

Insert with generated id:

```sql
insert into tags(name, kind)
values ("VIP", "customer")
```

Cross-project insert:

```sql
insert into project("staging").tags(@id, name, kind)
on conflict fail
values ("vip", "VIP", "customer")
```

Insert from select:

```sql
insert into archivedOrders(@id, sourceId, status, total, archivedAt)
on conflict fail
select
  id(o),
  id(o),
  o.status,
  o.total,
  now()
from orders o
where o.status = "closed"
```

Cross-project insert from select:

```sql
insert into project("staging").archivedOrders(@id, sourceId, status, total, archivedAt)
on conflict fail
write batch size 400
select
  id(o),
  id(o),
  o.status,
  o.total,
  now()
from project("prod").orders o
where o.status = "closed"
limit 1000
page size 100
```

Conflict policy is required when the destination id is explicit:

```sql
insert into archivedOrders(@id, sourceId, status)
on conflict fail
select id(o), id(o), o.status
from orders o
```

Insert document id rules:

- `id` is a normal document field.
- Omit `@id` to request a generated Firestore document id.
- `@id` maps the corresponding input expression to the Firestore document id.
- `@id` is only valid in an insert target list.
- `@id` does not create an `id` field in the stored document.
- `@id` consumes one `values` or `select` output expression.
- Every normal target field must match one `values` or `select` output expression in order.
- The expression mapped to `@id` may use literals, query parameters, or source aliases from `insert ... select`.

Initial conflict policies:

- `fail`
- `merge`
- `overwrite`

Rules:

- Generated document ids avoid conflict policy.
- Explicit document ids require conflict policy.
- `merge` is patch semantics.
- `overwrite` replaces the destination document.
- The insert target may be in the selected project or an explicit `project("...")` source.
- `insert ... select` may read from other projects.
- Cross-project `insert ... select` is not atomic across project targets.
- `insert ... select` can stream source pages and commit per configured write batch.
- Live stats show attempted, succeeded, failed, and conflict counts.

## Result Exploration

Every query result should keep lineage metadata while it is in memory.

For a selected output row or aggregate group, the UI can expose:

- base documents
- joined documents
- unnested array items
- map entry rows
- union branch metadata
- subcollection metadata rows
- computed field inputs and outputs
- local filters passed/failed
- join misses
- cache hit/miss per lookup
- read cost contribution
- write target and write result for mutation commands

For aggregation, selecting a group should show the source rows used to produce that group.

## Non-Goals

- Full PostgreSQL compatibility.
- Supporting non-Firestore SQL databases.
- Arbitrary SQL functions.
- Arbitrary inline JS/TS execution inside SQL expressions.
- Rollback generation.
- Hidden local scans in production without an explicit plan warning.
- Pretending local joins or local aggregation are Firestore-native.
