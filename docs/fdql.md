# Firebase Desk Query Language Spec

## Goal

Firebase Desk Query Language (FDQL) is a pipeline query language for Firebase Desk.

The query text is the execution plan. Provider-native commands are namespace-prefixed. Provider value/source functions use dot-call syntax. `set` changes engine context before execution. Unprefixed stages run in Firebase Desk.

Initial provider namespace:

- `fs`: Firestore-native reads, filters, ordering, limits, metadata predicates, and supported Firestore aggregations.

Reserved provider namespaces:

- `ddb`: DynamoDB
- `s3`: Amazon S3
- `gcs`: Google Cloud Storage

## Principles

- Native provider work must be explicit.
- Firebase Desk local work must be explicit.
- No hidden Firestore collection scans.
- Query stages run in written order.
- Stages preserve row shape unless the stage explicitly reshapes or expands it.
- The same FDQL plan drives integrated execution and generated scripts.

## Query Preamble

`set` and `alias` declarations come before the pipeline.

Order:

```text
set*
alias*
pipeline
```

Rules:

- `set` changes engine context values for the query.
- `set` is only valid before the first `from`.
- `set` values are not row fields and are not emitted in results.
- `set` keys are not visible as `$` aliases.
- Aliases cannot reference `set` values. Declare an `alias` for values used in query expressions.

## Alias Declarations

Aliases are declared before the pipeline.

```sql
alias $prod = "project-1"
alias $driverFields = ["firstName", "lastName", "steamId"]
alias $drivers = fs.collection("drivers", ["firstName", "lastName", "steamId"])
alias $prodDrivers = fs.project($prod).collection("drivers")
alias $prodDb2Drivers = fs.project($prod).db("db2").collection("drivers", ["firstName"])
alias $db2Drivers = fs.db("db2").collection("drivers")
```

Rules:

- Alias declarations are query-local.
- Alias names must start with `$`.
- Aliases can hold primitive values, arrays, maps, or provider sources.
- Source aliases are not row aliases. Row aliases do not use `$` and are declared with `as` in `from` and `lookup`.
- `fs.collection("drivers")` uses the selected project and default Firestore database.
- `fs.project("project-1").collection("drivers")` uses the named project and default database.
- `fs.project("project-1").db("db2").collection("drivers")` uses the named project and named database.
- `fs.db("db2").collection("drivers")` uses the selected project and named database.
- Source functions accept an optional field mask array as their final argument.
- If database is omitted, Firestore uses `(default)`.

## Basic Shape

```sql
set readBudget = 5000
set timeout = "60s"

alias $drivers = fs.collection("drivers", ["firstName"])

from $drivers as d
fs where d.active = true
fs order by d.createdAt desc
fs limit 100

then filter lower(d.firstName) = "vini"
then take 25

return fs.id(d) as id, d.firstName
```

Execution:

```text
Firestore:
  collection drivers
  where active == true
  field mask firstName
  order by createdAt desc
  limit 100

Firebase Desk:
  filter lower(firstName) == "vini"
  take 25
  return id, firstName
```

## Stage Kinds

### Provider Stages

Provider stages are namespace-prefixed commands.

```text
fs where
fs order by
fs limit
```

Provider stages must compile to that provider. If they cannot, the query is invalid. FDQL must not silently fall back from `fs where` to local filtering.

Rules:

- Provider commands use spaced syntax, for example `fs where`, `fs order by`, and `fs limit`.
- Provider functions use dot-call syntax, for example `fs.collection(...)`, `fs.id(...)`, and `fs.timestamp(...)`.
- A provider command must not be written as a dot-call, so `fs.orderBy` is invalid.

### Local Stages

Unprefixed stages run inside Firebase Desk.

```text
filter
sort by
take
with
aggregate
return
lookup
unwind
union all
```

Local stages operate on rows already loaded or produced by earlier stages.

## Source Syntax

Root collection:

```sql
alias $drivers = fs.collection("drivers", ["firstName", "lastName", "steamId"])

from $drivers as d
```

Explicit collection path:

```sql
alias $customerOrders = fs.collection("customers/cus_123/orders", ["status", "total"])

from $customerOrders as o
```

Collection group:

```sql
alias $ordersGroup = fs.collectionGroup("orders", ["status", "createdAt"])

from $ordersGroup as o
```

Project target:

```sql
alias $prod = "prod"
alias $prodDrivers = fs.project($prod).collection("drivers", ["firstName"])
alias $prodOrdersGroup = fs.project($prod).collectionGroup("orders", ["status"])

from $prodDrivers as d
```

Rules:

- `from` accepts a declared source alias.
- Collection ids outside normal identifier rules use `fs.collection("...")`.
- `fs.collectionGroup("orders")` accepts a collection id, not a path.
- Source rows must have a row alias in `from`.
- A pipeline can have one `from`.
- A second `from` in the same pipeline is invalid. Use `lookup` for related reads or `union all` for separate branches.
- If a field mask is supplied, only those document fields are loaded.
- If a field mask is omitted, Firebase Desk loads the full document.
- An empty field mask array loads document metadata only.
- `$` aliases must be declared before they are used.

## Field Masks

Field masks are part of source creation.

```sql
alias $drivers = fs.collection("drivers", ["firstName", "lastName", "steamId"])
alias $metadataOnlyDrivers = fs.collection("drivers", [])
alias $driverFields = ["firstName", "lastName", "steamId"]

then lookup many fs.subcollection(c, "orders", c.orderFields) as orders
```

Rules:

- Field mask entries are strings, so dotted or awkward field paths do not need identifier escaping.
- Top-level source alias field masks must be literal arrays.
- Field masks can include at most 150 fields.
- Primary aliases can hold field arrays, but top-level source aliases must not use dynamic field masks.
- Source functions used inside the pipeline may use current row expressions for field masks.
- Field masks apply to the documents loaded by that source.
- Metadata functions still work when no document fields are loaded.
- Fields used only by Firestore-native `fs where` or `fs order by` do not need to be in the field mask.
- Fields used by later local stages must be in the field mask, unless the source loads the full document.
- `return` remains output projection. Field masks only control what Firestore sends back.

## Field Binding

Provider clauses operate against one current provider source.

Qualified field:

```sql
fs where d.active = true
```

Lookup field:

```sql
alias $roundsSource = fs.collection("rounds")

then lookup many $roundsSource as rounds
  fs where rounds.driverId = fs.id(d)
```

Rules:

- Provider fields must be qualified with the current provider row alias.
- Unqualified provider fields are invalid.
- Qualified fields may refer to the current provider source or previous row bindings.
- Previous row bindings must be explicit when they are not metadata function arguments.
- `with` controls which previous row bindings are available to later stages.

## Native Firestore Clauses

`fs where` accepts Firestore-native predicates only.

```sql
fs where d.active = true
fs where d.status in ("active", "pending")
fs where d.status = "active" or d.status = "pending"
fs where d.active = true and (d.status = "active" or d.status = "pending")
fs where d.createdAt >= fs.timestamp("2025-10-01T00:00:00.000Z")
fs where fs.arrayContains(d.tags, "admin")
fs where fs.id(d) = $driverId
```

Rules:

- `fs where` must use Firestore-supported operators and value shapes.
- `and`, `or`, and parentheses are valid when Firestore can compile the filter.
- Firestore `or`, `in`, and `arrayContainsAny` limits apply.
- `fs.id(rowAlias)` inside an `fs` clause means the Firestore document id for that document row binding.
- Correlated values are allowed on the value side in lookup stages.
- Local expressions such as `lower(d.name) = "vini"` are invalid in `fs where`; use `filter`.

`fs order by` maps to Firestore ordering:

```sql
fs order by d.createdAt desc
```

`fs limit` caps provider reads for the current provider source:

```sql
fs limit 100
```

Provider read bounds:

- Provider reads should have an explicit bound or an obviously bounded predicate.
- `fs limit` is the normal read bound.
- `fs where fs.id(rowAlias) = value` is bounded by document id.
- Query context read budget is a safety stop, not a semantic result limit.
- Unbounded provider reads should be blocked unless query context explicitly allows them.

## Local Filtering And Output Limits

Local filter:

```sql
then filter lower(d.firstName) = "vini"
```

Local sort:

```sql
then sort by d.firstName asc
```

Local output cap:

```sql
then take 25
```

Rules:

- `fs limit` caps Firestore reads.
- `take` caps output rows from the current local pipeline.
- `filter` can use local functions, computed expressions, and values from previous stages.

## Row Shape

Every stage receives a row and emits zero or more rows.

Default behavior:

- `fs where`, `fs order by`, `fs limit`, `filter`, `sort by`, `take`, and `lookup` preserve existing fields.
- `lookup` adds a field.
- `unwind` adds a field and expands rows.
- `with` replaces row shape.
- `aggregate` replaces row shape.
- `return` produces final output shape.

Reshape with `with`:

```sql
alias $drivers = fs.collection("drivers", ["firstName"])

from $drivers as d
fs where d.active = true
fs limit 100

then with
  d,
  fs.id(d) as driverId,
  lower(d.firstName) as firstNameKey

return driverId, firstNameKey
```

After `with`, only the listed fields exist.

## Return

`return` is the final projection.

```sql
return
  fs.id(d) as id,
  d.firstName,
  d.lastName
```

Rules:

- `return` accepts local expressions.
- `return *` returns the current row shape.
- Firestore metadata functions such as `fs.id(d)`, `fs.path(d)`, `fs.ref(d)`, `fs.parentPath(d)`, and `fs.projectId(d)` are valid for Firestore document row bindings.
- In `from $drivers as d`, `d` is the document row binding. `fs.id(d)` returns that document id.
- In `lookup one $teams as team`, `team` is the joined document row binding or `null`. `fs.id(team)` returns the joined document id when present.
- `fs.id(...)` is not called with a source alias such as `$drivers`; it is called with the row alias created by `as`.

## Lookup

`lookup` runs provider-native work from each input row and attaches or expands the result.

### Lookup One

Attach one document or `null`:

```sql
alias $drivers = fs.collection("drivers", ["firstName", "teamId"])
alias $teams = fs.collection("teams", ["name"])

from $drivers as d
fs where d.active = true
fs limit 100

then lookup one $teams as team
  fs where fs.id(team) = d.teamId

return fs.id(d), d.firstName, team.name as teamName
```

### Lookup Many

Attach an array:

```sql
alias $drivers = fs.collection("drivers")
alias $roundsSource = fs.collection("rounds")

from $drivers as d
fs where d.active = true
fs limit 100

then lookup many $roundsSource as rounds
  fs where rounds.driverId = fs.id(d)
  fs order by rounds.createdAt desc
  fs limit 20

return fs.id(d), d.firstName, rounds
```

### Lookup Expand

Multiply rows directly:

```sql
alias $drivers = fs.collection("drivers")
alias $roundsSource = fs.collection("rounds")

from $drivers as d
fs where d.active = true
fs limit 100

then lookup expand $roundsSource as round
  fs where round.driverId = fs.id(d)
  fs limit 20

return fs.id(d) as driverId, fs.id(round) as roundId
```

### Lookup Aggregate

Attach an aggregate object:

```sql
alias $drivers = fs.collection("drivers")
alias $roundsSource = fs.collection("rounds")

from $drivers as d
fs where d.active = true
fs limit 100

then lookup aggregate $roundsSource as roundStats from round
  fs where round.driverId = fs.id(d)
  yield fs.count() as total, fs.max(round.createdAt) as lastRoundAt

return fs.id(d), d.firstName, roundStats.total, roundStats.lastRoundAt
```

Rules:

- Lookup clauses are provider-native.
- Lookup row aliases are available inside their provider clauses.
- Correlated references must use previous row fields or metadata functions such as `fs.id(d)`.
- `lookup one` must produce at most one value or report a diagnostic.
- `lookup many` attaches an array and preserves the input row.
- `lookup expand` emits one row per matched value.
- `lookup aggregate $source as outputAlias from rowAlias` attaches one object.
- `yield` is the aggregate projection inside `lookup aggregate`; it is not the final query output.

## Firestore Aggregation

Supported `fs` aggregate functions:

```text
fs.count()
fs.sum(field)
fs.avg(field)
fs.min(field)
fs.max(field)
```

Firestore supports `count`, `sum`, and `average` as aggregation queries. FDQL names the average helper `fs.avg`.

Firebase Desk can implement `fs.min(field)` and `fs.max(field)` as provider-native ordered lookups:

```text
fs.min(r.createdAt) -> order by r.createdAt asc, limit 1
fs.max(r.createdAt) -> order by r.createdAt desc, limit 1
```

Rules:

- `fs` aggregate expressions must compile into provider-native operations.
- Multiple aggregate fields may produce multiple provider-native operations.
- Grouping is not provider-native for Firestore. Use local aggregation after a bounded provider read.

## Local Aggregation

Local aggregation uses `aggregate`.

```sql
alias $rounds = fs.collection("rounds")

from $rounds as r
fs where r.createdAt >= fs.timestamp("2025-10-01T00:00:00.000Z")
fs limit 5000

then aggregate
  by r.driverId as driverId,
     r.category as category
  count() as totalRounds,
  min(r.createdAt) as firstRoundAt,
  max(r.createdAt) as lastRoundAt

return driverId, category, totalRounds, firstRoundAt, lastRoundAt
```

Rules:

- `aggregate` replaces the row shape.
- `by` can have one or more expressions.
- Each `by` expression must use `as`.
- Multiple `by` fields form a composite group key tuple in written order.
- `null` groups with `null`.
- Missing and `null` are distinct group key values.
- Group key expressions must produce primitive/group-safe values: string, number, boolean, timestamp, reference, `null`, or missing.
- Arrays and maps are invalid group keys.
- Local aggregate stages should stream by default.
- Pre-aggregate rows must not be retained unless source exploration requires them.
- Selecting a result group may load or expose source lineage on demand.

## Unwind

`unwind` expands arrays or map entries.

Array:

```sql
alias $orders = fs.collection("orders")

from $orders as o
fs where o.status = "paid"
fs limit 500

then unwind o.items as item

return fs.id(o) as orderId, item.sku, item.qty
```

Map:

```sql
alias $games = fs.collection("games")

from $games as g
fs where g.active = true
fs limit 500

then unwind entries(g.roundsById) as round

return
  fs.id(g) as gameId,
  round.key as roundId,
  round.value.sequence as sequence
```

Rules:

- `unwind` is local.
- Missing or empty arrays/maps produce no rows.
- `entries(map)` turns a map into entry values with `key` and `value` fields.
- `entry.key` returns the map key.
- `entry.value` returns the map value.
- Existing fields remain after `unwind` unless a later `with` removes them.

## Dynamic Map Lookup

FDQL supports dynamic map lookup:

```sql
then with
  mapGet(event.entriesById, result.entryId) as entry,
  result
```

Rules:

- `mapGet(map, key)` is local.
- Missing keys return `null`.
- `mapGet` does not scan or fetch provider data.

## Subcollections

Lookup subcollection documents:

```sql
alias $customers = fs.collection("customers")

from $customers as c
fs limit 100

then lookup many fs.subcollection(c, "orders", ["status"]) as orders
  fs where orders.status = "paid"
  fs limit 20
```

Discover direct subcollections:

```sql
alias $customers = fs.collection("customers")

from $customers as c
fs limit 100

then lookup many fs.subcollections(c) as childCollections
```

Rules:

- `fs.subcollection(parent, name, fields?)` reads `parent/{id}/name`.
- `fs.subcollections(parent)` lists direct child collection metadata.
- Subcollection lookup must show read counts per parent.

## Union All

Top-level union:

```sql
alias $prodOrders = fs.project("prod").collection("orders")
alias $stagingOrders = fs.project("staging").collection("orders")

from $prodOrders as o
fs where o.status = "paid"
return fs.id(o) as orderId, "prod" as source

union all

from $stagingOrders as o
fs where o.status = "paid"
return fs.id(o) as orderId, "staging" as source
```

Rules:

- Each branch is a full FDQL pipeline.
- Output field names should match.
- Results keep union branch lineage.
- Global `sort by` or `take` after union requires an explicit final pipeline stage.

## Budgets And Execution Controls

Execution controls come from Firebase Desk runtime context and optional pre-pipeline `set` declarations.

Example query:

```sql
set readBudget = 5000
set timeout = "60s"
set cache = "run"
set allowUnboundedReads = false

alias $events = fs.collection("events")

from $events as event
fs limit 500
return fs.id(event)
```

Rules:

- Runtime context provides defaults.
- `set` overrides runtime context defaults for one query.
- `set` must be declared before aliases and before the pipeline.
- `set` cannot appear after `from`, `then`, `lookup`, `unwind`, `aggregate`, or `return`.
- Supported `set` keys are engine-defined.
- Initial supported keys: `readBudget`, `timeout`, `cache`, and `allowUnboundedReads`.
- Unknown `set` keys are diagnostics, not ignored.
- `set` values do not need `$` prefixes because they are not aliases.
- Read budget, timeout, cache mode, and provider scan permissions are internal execution context values.
- Read budget stops execution and returns partial results with a clear stopped state.
- Stats must show reads, rows scanned, rows output, lookup counts, cache hits/misses, and stop reason.

## Cache

Cache modes:

```text
run
session
off
```

Rules:

- Run cache dedupes repeated lookup reads during one query run.
- Session cache persists while the app is open.
- Cache must be visible in execution stats.
- Provider-native results and lookup results must not silently come from stale cache.

## Generated Scripts

Generated scripts must be produced from the FDQL pipeline AST, not raw query text.

Rules:

- Generated scripts must preserve provider stages and local stages.
- Generated scripts must label native provider work and local work.
- Generated scripts must include warnings for expensive lookup patterns.
- Integrated execution and generated scripts must not interpret the query differently.

## Diagnostics

Stable diagnostic classes:

```text
FDQL_PARSE_ERROR
FDQL_UNKNOWN_NAMESPACE
FDQL_UNKNOWN_STAGE
FDQL_INVALID_ALIAS_NAME
FDQL_UNDECLARED_ALIAS
FDQL_INVALID_SET
FDQL_UNKNOWN_SET_KEY
FDQL_MULTIPLE_FROM
FDQL_UNQUALIFIED_PROVIDER_FIELD
FDQL_INVALID_FIELD_MASK
FDQL_UNSUPPORTED_FS_WHERE
FDQL_UNSUPPORTED_FS_ORDER_BY
FDQL_UNBOUNDED_PROVIDER_READ
FDQL_LOCAL_EXPRESSION_IN_FS_CLAUSE
FDQL_LOOKUP_CARDINALITY_ERROR
FDQL_AMBIGUOUS_FIELD
FDQL_UNKNOWN_BINDING
FDQL_BUDGET_EXCEEDED
```

Rules:

- Native-provider validation errors happen before execution.
- Unknown row fields should report diagnostics when schema or row shape proves they are invalid.
- Unbounded provider reads should be blocked unless runtime context explicitly allows them.
- Diagnostics must include line and column when possible.

## Result Lineage

FDQL execution keeps lineage while results are in memory.

Lineage should include:

- provider source
- document path/id
- lookup source
- unwind source
- union branch
- aggregate group key
- read contribution
- cache hit/miss

For aggregate groups, source exploration should be on demand to avoid retaining all pre-aggregate rows.

## Non-Goals

- Hidden provider scans.
- Pretending local stages are provider-native.
- Arbitrary inline JS/TS execution inside FDQL expressions.
- Cross-provider writes.
- Transaction semantics across provider namespaces.
