# Firebase Desk Query Language Spec

## Goal

Firebase Desk Query Language (FDQL) is a pipeline query language for Firebase Desk.

The query text is the execution plan. Provider-native commands are namespace-prefixed. Provider value/source functions use dot-call syntax. `set` changes engine context before execution. Unprefixed stages run in Firebase Desk.

Initial provider namespace:

- `fs`: Firestore-native reads, filters, ordering, limits, metadata predicates, supported Firestore aggregations, and explicit Firestore writes.

Implementation status is tracked separately in [FDQL Read Implementation](./fdql-read-implementation.md). The current product slice is read-only; write syntax and Firestore aggregate helpers remain spec work until implemented there.

Reserved provider namespaces:

- `ddb`: DynamoDB
- `s3`: Amazon S3
- `gcs`: Google Cloud Storage

Reserved namespaces have no semantics until a provider dialect defines them. Using an unknown namespace is a diagnostic, not a fallback to Firestore or local execution.

## Principles

- Provider-native work must be explicit.
- Firebase Desk local work must be explicit.
- No hidden provider scans.
- Query stages run in written order.
- Stages preserve row shape unless the stage explicitly reshapes or expands it.
- The same FDQL plan drives integrated execution and generated scripts.

## Provider Semantics

FDQL separates provider work from Firebase Desk local work.

Provider namespaces own:

- source functions such as `fs.collection(...)`
- provider commands such as `fs where`, `fs order by`, and `fs limit`
- provider metadata/value functions such as `fs.id(row)` and `fs.ref(...)`
- provider-specific diagnostics for clauses that cannot compile to that provider

Firebase Desk owns:

- query preamble rules
- local stages such as `then filter`, `then with`, `then unwind`, `then aggregate`, `then sort by`, `then take`, and `return`
- local functions such as `timestamp(...)`, `lower(...)`, `entries(...)`, `mapGet(...)`, and aggregate helpers
- execution stats, read budgets, timeout, cancellation, lineage, and result shaping

Rules:

- Provider commands use spaced syntax: `fs where`, `fs order by`, `fs limit`.
- Provider functions use dot-call syntax: `fs.collection(...)`, `fs.id(...)`, `fs.ref(...)`.
- A provider source alias can only be produced by that provider dialect.
- A provider command applies to the current provider source or lookup source.
- A provider command must compile to provider-native work. FDQL must not silently convert `fs where` into local `filter`.
- Local stages operate on rows already loaded or produced by earlier stages.
- Core value constructors are unprefixed.
- Provider metadata functions are valid local expressions when the row binding belongs to that provider.
- Provider field validation belongs to the provider dialect. Firestore rules do not automatically apply to future providers.
- Unknown provider namespaces and unknown provider functions are diagnostics.
- Engine context is provider-scoped. Firestore defaults live under `fs`, for example `{ fs: { projectId } }`.

Example split:

```sql
alias $drivers = fs.collection("drivers", ["firstName"])

from $drivers as d
fs where d.active = true
fs limit 100

then filter lower(d.firstName) = "vini"

return fs.id(d) as id, d.firstName
```

Meaning:

```text
fs provider:
  read drivers
  push active == true
  cap provider read at 100

Firebase Desk:
  evaluate lower(firstName) == "vini"
  emit id and firstName
```

## FDQL Type System

FDQL has a provider-neutral value model. Providers map native values into this model before local stages run.

Core value kinds:

| Kind        | Notes                                                                |
| ----------- | -------------------------------------------------------------------- |
| `missing`   | Field or path does not exist. Distinct from `null`. No literal form. |
| `null`      | Explicit null value.                                                 |
| `boolean`   | `true` or `false`.                                                   |
| `number`    | FDQL numeric value. Providers may restrict precision or range.       |
| `string`    | Text value.                                                          |
| `array`     | Ordered values.                                                      |
| `map`       | String-keyed object values.                                          |
| `timestamp` | Instant value. Construct with `timestamp(...)`.                      |
| `bytes`     | Binary value. Construct with `bytes(...)`.                           |
| `geoPoint`  | Latitude/longitude value. Construct with `geoPoint(lat, lng)`.       |

Core constructors:

```sql
timestamp("2025-10-01T00:00:00.000Z")
bytes("base64:SGVsbG8=")
geoPoint(-37.8136, 144.9631)
```

Provider-specific constructors:

```sql
fs.ref("drivers/driver_1")
ddb.binary("base64:SGVsbG8=")
s3.etag("686897696a7c876b7e")
```

Rules:

- Core literals and constructors can be used in local expressions and provider clauses.
- Provider dialects decide which core values can compile to native filters, ordering, writes, and aggregates.
- Provider-specific constructors must stay namespace-prefixed.
- Provider runtimes must normalize native values into FDQL values before local stages evaluate them.
- Local comparison, grouping, sorting, rendering, and result JSON use FDQL value semantics, not provider SDK classes.
- `missing` is produced by field access and map lookup. It is not equal to `null`.
- Provider-owned values such as Firestore document references use `providerValue` internally.
- Provider values can compare or group only when the provider supplies a stable equality key.
- Provider values can sort only when the provider supplies a stable order key.

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
- `set` is only valid before aliases, the first pipeline, or a write stage.
- `set` keys must use `namespace.key` syntax.
- `set` values are not row fields and are not emitted in results.
- `set` keys are not visible as `$` aliases.
- `set` values must be literals, arrays, or maps.
- Aliases cannot reference `set` values. Declare an `alias` for values used in query expressions.
- The write `set` clause in `fs update` is not a query preamble declaration.

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
- `fs.collection("drivers")` uses the selected Firestore project from engine context and default Firestore database.
- `fs.project("project-1").collection("drivers")` uses the named project and default database.
- `fs.project("project-1").db("db2").collection("drivers")` uses the named project and named database.
- `fs.db("db2").collection("drivers")` uses the selected Firestore project from engine context and named database.
- Source functions accept an optional field mask array as their final argument.
- If database is omitted, Firestore uses `(default)`.
- If a Firestore source omits `fs.project(...)` and no selected Firestore project exists, the query is invalid.

## Basic Shape

```sql
set fdql.readBudget = 5000
set fdql.timeout = 60s

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
fs create
fs set
fs update
fs delete
```

Provider stages must compile to that provider. If they cannot, the query is invalid. FDQL must not silently fall back from `fs where` to local filtering.

Rules:

- Provider commands use spaced syntax, for example `fs where`, `fs order by`, and `fs limit`.
- Provider functions use dot-call syntax, for example `fs.collection(...)`, `fs.id(...)`, and `fs.ref(...)`.
- A provider command must not be written as a dot-call, so `fs.orderBy` is invalid.
- Write commands are provider commands and must be terminal.

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
- Source-free direct write commands do not require `from`.
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
```

Rules:

- Field mask entries are strings, so dotted or awkward field paths do not need identifier escaping.
- Top-level source alias field masks must be literal arrays.
- Field masks can include at most 150 fields.
- Current read implementation does not support dynamic field masks.
- Planned pipeline source functions may use current row expressions for field masks when those source functions are implemented.
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

## Firestore Provider Clauses

`fs where` accepts Firestore provider predicates only.

```sql
fs where d.active = true
fs where d.status in ("active", "pending")
fs where d.status = "active" or d.status = "pending"
fs where d.active = true and (d.status = "active" or d.status = "pending")
fs where d.createdAt >= timestamp("2025-10-01T00:00:00.000Z")
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

Singleton stages:

- `fs limit` can appear once for the current provider source.
- `fs order by` can appear once for the current provider source.
- `return` can appear once in the pipeline.
- Duplicate singleton provider stages are diagnostics; FDQL must not silently overwrite the earlier clause.

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

then lookup one $teams as team cache run
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
- `cache run`, `cache persistent`, `cache persistent 60s`, or `cache off` on a lookup overrides `set fdql.cache` for that lookup only.
- Lookup cache defaults to the query-level `set fdql.cache` value when omitted.
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
fs where r.createdAt >= timestamp("2025-10-01T00:00:00.000Z")
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
- Group key expressions must produce primitive/group-safe FDQL values: string, number, boolean, timestamp, bytes, geoPoint, provider values with equality keys, `null`, or missing.
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
- Missing keys return missing.
- `mapGet` does not scan or fetch provider data.

## Nested Map And Array Pipelines

FDQL can combine bounded provider reads with local map entry expansion, array expansion, local caps, and correlated lookups.

```sql
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

return
  eventDriver.steamId,
  driver,
  event.slug,
  event.name,
  event.schedule.startsAt
```

Execution shape:

```text
Firestore:
  read 20 admin-events ordered by schedule.startsAt desc
  load only name, slug, schedule, entriesById

Firebase Desk:
  expand entriesById into entry rows
  expand each entry.value.drivers array into eventDriver rows
  keep the first 25 expanded rows

Firestore per expanded row:
  lookup one drivers document by document id

Firebase Desk:
  return event, nested driver entry, and lookup data
```

Rules:

- `entries(event.entriesById)` returns local `{ key, value }` map-entry values.
- `then unwind entry.value.drivers as eventDriver` expands an array from each map entry.
- `then take 25` caps expanded local rows before lookup reads.
- `lookup one` runs after the local expansions and can reference `eventDriver`.
- If the related `drivers` document id is not the Steam ID, use a provider field predicate instead:

```sql
then lookup one $drivers as driver
  fs where driver.steamId = eventDriver.steamId
```

## Subcollections

This is target syntax, not current read implementation.

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

## Firestore Writes

FDQL write commands are terminal Firestore commands.

Supported operations:

```text
fs create
fs set
fs update
fs delete
```

Rules:

- A write query has one terminal write command.
- `return` is a read terminal stage. It cannot appear after a write command.
- Source-free direct writes can start with `fs create`, `fs set`, `fs update`, or `fs delete` after the query preamble.
- A write command writes to one Firestore target project/database per query.
- Cross-project reads can feed one write target.
- Cross-project writes are not atomic across project/database boundaries.
- Firestore write commands never silently recurse into subcollections.
- There is no implicit rollback and no generated inverse mutation.
- Live write execution must report attempted, committed, failed, skipped, and stopped counts.

### Write Targets

Document row target:

```sql
alias $orders = fs.collection("orders")

from $orders as o
fs where o.status = "paid"
fs limit 500

fs update o
  set
    status = "archived",
    archivedAt = fs.serverTimestamp()
```

Collection target plus id:

```sql
alias $orders = fs.collection("orders")

fs update $orders id "ord_1"
  set
    status = "paid"
```

Dynamic subcollection target:

```sql
alias $customers = fs.collection("customers")

from $customers as c
fs where fs.id(c) = "cus_123"

fs create fs.subcollection(c, "orders") id "ord_1"
  data {
    status: "draft",
    createdAt: fs.serverTimestamp()
  }
```

Rules:

- `fs update rowAlias` and `fs delete rowAlias` target the document represented by that row binding.
- `fs create`, `fs set`, and direct `fs update`/`fs delete` target a collection source plus `id`.
- `fs create` can use `id expression` or `autoId`.
- `fs set`, direct `fs update`, and direct `fs delete` require `id expression`.
- `fs.collectionGroup(...)` cannot be a direct write target.
- Documents read from `fs.collectionGroup(...)` can be updated or deleted by row alias.
- Write target source aliases must not have field masks.
- Field masks never affect written data.

### Create

Create fails if the destination document already exists.

Explicit id:

```sql
alias $tags = fs.collection("tags")

fs create $tags id "paid"
  data {
    name: "Paid",
    kind: "status"
  }
```

Auto id:

```sql
alias $events = fs.collection("events")

fs create $events autoId
  data {
    type: "manual",
    createdAt: fs.serverTimestamp()
  }
```

Copy across projects:

```sql
alias $prodOrders = fs.project("prod").collection("orders")
alias $archive = fs.project("staging").collection("archivedOrders")

from $prodOrders as o
fs where o.status = "paid"
fs limit 500

fs create $archive id fs.id(o)
  data {
    sourceId: fs.id(o),
    status: o.status,
    total: o.total,
    archivedAt: fs.serverTimestamp()
  }
```

Rules:

- `fs create` maps to Firestore create semantics.
- The destination document must not exist.
- `autoId` must be explicit.
- `fs.deleteField()` is invalid in create data.

### Set

Set writes a full document or a merge patch. The mode is mandatory.

Merge:

```sql
alias $profiles = fs.collection("profiles")

fs set $profiles id "usr_1" merge
  data {
    lastSeenAt: fs.serverTimestamp(),
    loginCount: fs.increment(1)
  }
```

Overwrite:

```sql
alias $settings = fs.collection("settings")

fs set $settings id "global" overwrite
  data {
    version: 3,
    flags: {
      beta: true
    }
  }
```

Rules:

- `merge` maps to Firestore set with merge.
- `overwrite` replaces the destination document.
- `merge` and `overwrite` must be written explicitly.
- `fs.deleteField()` is valid only with `merge`.
- `overwrite` must not contain `fs.deleteField()`.

### Update

Update patches an existing document.

Pipeline update:

```sql
alias $orders = fs.collection("orders")

from $orders as o
fs where o.status = "paid"
fs limit 500

fs update o
  set
    status = "archived",
    archivedAt = fs.serverTimestamp(),
    archiveCount = fs.increment(1),
    temporaryNote = fs.deleteField()
```

Update from lookup:

```sql
alias $drivers = fs.collection("drivers")
alias $teams = fs.collection("teams")

from $drivers as d
fs where d.active = true
fs limit 500

then lookup one $teams as team
  fs where fs.id(team) = d.teamId

fs update d
  set
    teamName = team.name,
    syncedAt = fs.serverTimestamp()
```

Dynamic map update:

```sql
alias $games = fs.collection("games")

from $games as g
fs limit 50

then unwind entries(g.roundsById) as round
then filter round.value.sequence = 1

fs update g
  set
    fs.fieldPath("roundsById", round.key, "reviewed") = true,
    fs.fieldPath("roundsById", round.key, "reviewedAt") = fs.serverTimestamp()
```

Rules:

- `fs update` maps to Firestore update semantics.
- The destination document must exist.
- Assignments are patch field paths, not document replacement.
- Static assignment targets such as `profile.firstName` are nested Firestore field paths.
- Use `fs.fieldPath(...)` for dynamic paths and awkward literal segments.
- `fs.deleteField()` is valid in update assignments.
- If one input row maps to the same target document more than once, the query is invalid unless a future conflict policy is defined.

### Delete

Delete removes a document.

Pipeline delete:

```sql
alias $sessions = fs.collection("sessions")

from $sessions as s
fs where s.expiresAt < timestamp("2026-01-01T00:00:00.000Z")
fs limit 1000

fs delete s
```

Direct delete:

```sql
alias $orders = fs.collection("orders")

fs delete $orders id "ord_1"
```

Recursive delete:

```sql
alias $customers = fs.collection("customers")

from $customers as c
fs where c.status = "deleted"
fs limit 100

fs delete recursive c
```

Rules:

- `fs delete rowAlias` deletes only that document.
- Direct `fs delete $collection id expression` maps to Firestore document delete.
- Firestore document delete does not delete subcollections.
- `fs delete recursive rowAlias` is the only recursive delete form.
- Recursive delete must list subcollections and child documents explicitly during execution.
- Recursive delete consumes read and write budgets.

### Write Data And Field Paths

Data maps:

```sql
data {
  status: "paid",
  "billing.total": 42,
  nested: {
    enabled: true
  }
}
```

Patch assignments:

```sql
set
  status = "paid",
  fs.fieldPath("billing.total") = 42,
  fs.fieldPath("roundsById", round.key, "description") = round.value.description
```

Rules:

- Map keys can be identifiers or strings.
- String map keys are literal field names.
- Assignment targets are Firestore field paths.
- `a.b` in an assignment target means nested field path `a`, then `b`.
- `fs.fieldPath("a.b")` means one literal segment named `a.b`.
- `fs.fieldPath("a", "b")` means nested field path `a`, then `b`.
- Assignment target aliases are omitted because the write target is already explicit.

### Write Helpers

Supported Firestore write helper values:

```text
fs.serverTimestamp()
fs.increment(number)
fs.arrayUnion(value, ...)
fs.arrayRemove(value, ...)
fs.deleteField()
```

Rules:

- Write helpers are valid only inside write `data` maps or update assignments.
- `fs.deleteField()` is valid only in `fs update` and `fs set ... merge`.
- Helper arguments must be serializable Firestore values or current row expressions that resolve to Firestore values.
- Unknown helper functions are diagnostics.

### Write Execution Controls

Write controls use query preamble `set` declarations.

```sql
set fdql.readBudget = 5000
set fdql.writeBudget = 1000
set fdql.timeout = 60s
set fdql.writeBatchSize = 400
set fdql.writeMode = "batch"
set fdql.stopOnWriteError = false
```

Rules:

- `fdql.readBudget` caps source reads.
- `fdql.writeBudget` caps attempted write operations.
- `fdql.timeout` stops reads and writes with a clear stopped status.
- `fdql.writeBatchSize` controls commit chunking where the runtime supports batches.
- `fdql.writeMode` can be `"batch"` or `"bulkWriter"`.
- `batch` commits sequential Firestore write batches.
- `bulkWriter` uses provider/runtime controlled concurrency and retry behavior when available.
- Batch size must respect Firestore limits.
- `fdql.stopOnWriteError = true` stops after the first write failure.
- `fdql.stopOnWriteError = false` continues where the runtime can safely continue.
- Partial completion is possible after any committed batch or successful BulkWriter write.
- Stats must show read pages, write batches, attempted writes, committed writes, failed writes, skipped writes, retries, and stop reason.

## Budgets And Execution Controls

Execution controls come from Firebase Desk runtime context and optional pre-pipeline `set` declarations.

Example query:

```sql
set fdql.readBudget = 5000
set fdql.timeout = 60s
set fdql.cache = persistent
set fdql.cacheTtl = 24h
set fdql.allowUnboundedReads = false

alias $events = fs.collection("events")

from $events as event
fs limit 500
return fs.id(event)
```

Rules:

- Runtime context provides defaults.
- `set` overrides runtime context defaults for one query.
- `set` must be declared before aliases and before the pipeline.
- `set` cannot appear after `from`, `then`, `lookup`, `unwind`, `aggregate`, `return`, or a write command.
- Supported `set` keys are namespace-defined.
- Initial read keys: `fdql.readBudget`, `fdql.timeout`, `fdql.cache`, `fdql.cacheTtl`, `fdql.allowUnboundedReads`, `fs.projectId`, and `fs.databaseId`.
- Initial write keys: `fdql.writeBudget`, `fdql.writeBatchSize`, `fdql.writeMode`, and `fdql.stopOnWriteError`.
- Unknown `set` keys are diagnostics, not ignored.
- Unscoped `set` keys are invalid; use `namespace.key`.
- `set` values do not need `$` prefixes because they are not aliases.
- Read budget, timeout, cache mode, and provider scan permissions are internal execution context values.
- Read budget stops execution and returns partial results with a clear stopped state.
- Stats must show reads, rows scanned, rows output, lookup counts, cache hits/misses/writes/evictions, and stop reason.

## Cache

Cache modes:

```text
off
run
persistent
```

Rules:

- Run cache dedupes repeated lookup reads during one query run.
- Persistent cache dedupes lookup reads across runs using the app profile cache database.
- Persistent cache TTL uses `set fdql.cacheTtl = 60s|10m|6h|30d`; default is `24h`; maximum is `30d`.
- Lookup stages can override query-level cache with `cache off`, `cache run`, `cache persistent`, or `cache persistent 60s`.
- Cache modes are bare keywords, not strings.
- Cache must be visible in execution stats.
- Provider-native results and lookup results must not silently come from stale cache.
- Failed, cancelled, timed out, budget-stopped, or partial provider reads must not be persisted.
- Persistent cache size is capped at 256 MB and evicts least-recently-used entries.
- Cache keys are canonical JSON hashed with SHA-256. Field mask order and provider `and`/`or` predicate order must not create different keys.
- Cache keys include provider, connection/profile context, project, database, source, field mask, provider predicates, provider ordering, provider limit, and correlated lookup values.
- Cache keys exclude aliases, row alias names, comments, whitespace, page size, read budget, timeout, and local pipeline stages.

Manual cache commands:

```fdql
clear cache
clear cache provider fs
clear cache provider fs project "project-id"
```

Manual cache commands run through the FDQL Run action. They are standalone commands, not
pipeline stages, and clear only the current app profile cache. Provider and project selectors
narrow the cleared entries.

## Generated Scripts

Generated scripts must be produced from the FDQL pipeline AST, not raw query text.

Rules:

- Generated scripts must preserve provider stages and local stages.
- Generated scripts must label provider-native work and local work.
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
FDQL_DUPLICATE_STAGE
FDQL_UNQUALIFIED_PROVIDER_FIELD
FDQL_INVALID_FIELD_MASK
FDQL_UNSUPPORTED_FS_WHERE
FDQL_UNSUPPORTED_FS_ORDER_BY
FDQL_UNBOUNDED_PROVIDER_READ
FDQL_LOCAL_EXPRESSION_IN_PROVIDER_CLAUSE
FDQL_UNSUPPORTED_PROVIDER_WHERE
FDQL_UNSUPPORTED_PROVIDER_ORDER_BY
FDQL_LOOKUP_CARDINALITY_ERROR
FDQL_AMBIGUOUS_FIELD
FDQL_UNKNOWN_BINDING
FDQL_BUDGET_EXCEEDED
FDQL_WRITE_NOT_TERMINAL
FDQL_RETURN_AFTER_WRITE
FDQL_MULTIPLE_WRITE_TARGETS
FDQL_INVALID_WRITE_TARGET
FDQL_WRITE_TARGET_FIELD_MASK
FDQL_WRITE_REQUIRES_ID
FDQL_INVALID_WRITE_MODE
FDQL_UNKNOWN_WRITE_HELPER
FDQL_INVALID_WRITE_HELPER
FDQL_WRITE_CONFLICT
FDQL_WRITE_FAILED
```

Rules:

- Provider validation errors happen before execution.
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
- Implicit rollback or generated inverse mutations.
- Hidden recursive deletes.
