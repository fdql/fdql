# Firestore SQL Dialect

This document defines the Firestore SQL language surface for Firebase Desk.

It is the source of truth for parsing, formatting, syntax diagnostics, and semantic validation. Product behavior, execution strategy, UI, and execution-plan display language live in `docs/firestore-sql.md`.

Implementation status is tracked in `docs/firestore-sql-implementation-status.md`.

## Design Rules

- Keywords are case-insensitive.
- Identifiers, aliases, collection ids, field names, project aliases, and casing are preserved.
- Single-quoted and double-quoted strings are accepted.
- The formatter emits double-quoted strings.
- Comments are ignored by the parser and not preserved by the formatter.
- Metadata is only exposed through functions such as `id(alias)` and `path(alias)`.
- `id`, `path`, `ref`, `parent_path`, and `project_id` are normal document fields when used as field paths.
- `__name__` is not a user-facing dialect feature. Use `id(alias)`.
- Context aliases such as `$prod` are query settings, not SQL declarations.
- Command-session defaults are outside SQL. Statement execution clauses are inside SQL.

## Lexical Rules

### Whitespace

Whitespace separates tokens and is otherwise insignificant.

### Comments

Line comments:

```sql
-- comment
select * from orders
```

Block comments:

```sql
/* comment */
select * from orders
```

Comments can appear between tokens. Comments cannot appear inside tokens or string literals.

### Keywords

Reserved keywords:

```text
all
and
as
asc
batch
bulk_writer
by
case
cross
delete
desc
describe
discover
else
end
exists
fail
from
group
having
if_missing
ignore
in
inner
insert
into
is
join
left
limit
not
null
on
or
order
page
recursive
schema
select
set
size
then
union
update
using
values
when
where
with
write
```

Unquoted aliases and normal identifiers should not use reserved keywords.

### Identifiers

Normal identifier:

```text
[A-Za-z_][A-Za-z0-9_]*
```

Examples:

```sql
orders
orderItems
_private
```

Backticked identifier segment:

```sql
`billing.total`
`created by`
`select`
```

Backticks quote one field or source segment. They do not create a dotted path.

### Source Names

Bare source names in `from`, `join`, `update`, `delete`, and `insert into` use normal identifier rules. Firestore collection ids outside normal identifier rules must use a backticked source segment or `collection("...")`.

Accepted:

```sql
select *
from orders
```

```sql
select e.slug
from `admin-events` e
```

```sql
select e.slug
from collection("admin-events") e
```

Rejected:

```sql
select *
from admin-events
```

Reason: `admin-events` is not a normal identifier. Use a backticked source segment:

```sql
select e.slug
from `admin-events` e
```

Backticked source segments should use a normal alias for field access. Do not use `` `admin-events`.slug `` as an alias workaround.

Or use an explicit collection source:

```sql
select e.slug
from collection("admin-events") e
```

### Strings

Accepted:

```sql
"paid"
'paid'
"customer \"A\""
'customer ''A'''
```

Formatter output:

```sql
"paid"
```

### Numbers

Accepted:

```sql
0
123
123.45
-10
-10.25
```

The parser preserves integer vs decimal shape where needed for typed literals.

### Parameters

Context parameter:

```sql
$source
$target
```

Context parameters are valid only where the dialect accepts a parameter expression. The main required use is `project($alias)`.

Document-id target marker:

```sql
@id
```

`@id` is valid only in an `insert into` target list.

## Statement Grammar

Compact grammar notation:

- `[]` means optional.
- `{}` means zero or more.
- `|` means alternative.
- Literal keywords are lowercase in this document, but accepted case-insensitively.

Common helper rules:

```ebnf
identifier_list := identifier { "," identifier }
expression_list := expression { "," expression }
order_list := order_item { "," order_item }
order_item := expression [ "asc" | "desc" ]
assignment_list := assignment { "," assignment }
assignment := field_path "=" expression
values_clause := "values" "(" expression_list ")"
integer := digit { digit }
```

### Script

```ebnf
script := statement { ";" statement } [ ";" ]
```

### Statement

```ebnf
statement :=
    select_statement
  | union_all_statement
  | recursive_cte_statement
  | delete_statement
  | update_statement
  | insert_statement
  | describe_statement
  | discover_schema_statement
```

## Select

```ebnf
select_statement :=
  "select" select_list
  "from" source
  { join_clause }
  [ "where" expression ]
  [ "group" "by" expression_list ]
  [ "having" expression ]
  [ "order" "by" order_list ]
  [ execution_clauses ]
```

Examples:

```sql
select *
from orders o
where o.status = "paid"
order by o.createdAt desc
limit 100
```

```sql
select id(o) as orderId, o.status
from project($source).orders o
```

### Select List

```ebnf
select_list := select_item { "," select_item }
select_item := expression [ "as" identifier ] | wildcard
wildcard := "*" | field_path "." "*"
```

Examples:

```sql
select *
from orders
```

```sql
select o.*, id(o) as orderId
from orders o
```

Rules:

- `*` returns all fields from the primary row source.
- `alias.*` returns all fields from that alias.
- `alias.*` requires a known source alias.
- Computed expressions should use `as` when a stable output name matters.

## Union All

Only top-level `union all` is part of the core dialect.

```ebnf
union_all_statement :=
  select_statement "union" "all" select_statement { "union" "all" select_statement }
```

Example:

```sql
select id(o) as orderId, o.status, "prod" as source
from project("prod").orders o

union all

select id(o) as orderId, o.status, "staging" as source
from project("staging").orders o
```

Rules:

- Each branch is a full `select_statement`.
- Branches must return the same number of columns.
- Output column names come from the first branch.
- Plain `union` is not accepted.
- Nested or parenthesized `union all` is not accepted.
- Global `order by` or `limit` after all branches is not accepted.

## Recursive CTE

Recursive CTE syntax is part of the dialect.

```ebnf
recursive_cte_statement :=
  "with" "recursive" identifier "(" identifier_list ")" "as"
  "(" union_all_statement ")"
  select_statement
```

Example:

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

Rules:

- The CTE name becomes a source name for the outer query and recursive member.
- The CTE column list must match the branch output count.
- Recursive execution must still obey query budgets.
- The execution plan must show iteration count and stop reason.

## Sources

```ebnf
source :=
    collection_source [ alias ]
  | function_source [ alias ]
  | project_source [ alias ]
  | cte_source [ alias ]
```

Alias:

```ebnf
alias := identifier
```

### Collection Source

```ebnf
collection_source := source_name | "`" source_segment "`"
```

Examples:

```sql
from orders o
from `admin-events` e
```

Rules:

- `collection("orders")` and `orders` are equivalent.
- Collection source names preserve casing.
- Collection ids outside normal identifier rules must use backticks or `collection("...")`.
- Backticked source names should use a normal alias for field access.

### Source Functions

Root or explicit collection path:

```sql
from collection("orders") o
from collection("customers/cus_123/orders") o
```

Collection group:

```sql
from collection_group("orders") o
```

Subcollection documents:

```sql
from customers c
cross join subcollection(c, "orders") o
```

Direct subcollection metadata rows:

```sql
from customers c
cross join subcollections(c) sc
```

Local array expansion:

```sql
from orders o
cross join unnest(o.items) item
```

Local map expansion:

```sql
from games g
cross join entries(g.rounds) r
```

Source function rules:

- `collection(path)` accepts a string expression that resolves to a collection path.
- A collection path has an odd number of slash-separated segments.
- `collection_group(id)` accepts a collection id, not a path.
- `collection_group("a/b")` is invalid.
- `subcollection(parent, name)` accepts a document alias and a collection id expression.
- `subcollections(parent)` accepts a document alias.
- `unnest(array)` accepts an array expression.
- `entries(map)` accepts a map expression.

### Project Source

```ebnf
project_source := "project" "(" project_expression ")" "." source_body
project_expression := string | parameter
```

Examples:

```sql
from project("prod").orders o
from project($source).collection_group("orders") o
from project($target).collection("customers/cus_123/orders") o
```

Rules:

- `project("prod")` resolves a configured Firebase Desk project target.
- `project($source)` resolves a query context alias.
- Missing project context aliases are semantic errors.
- Every source alias resolves to exactly one project target.

## Joins

```ebnf
join_clause :=
    [ "inner" ] "join" source "on" expression
  | "left" "join" source "on" expression
  | "cross" "join" local_source
  | "left" "join" local_source
```

Examples:

```sql
select id(o), u.email
from orders o
left join users u on id(u) = o.userId
```

```sql
select id(o), u.email
from orders o
left join users u on ref(u) = o.userRef
```

```sql
select id(o), u.email
from orders o
left join users u
  on u.companyId = o.companyId
 and u.email = o.customerEmail
```

Rules:

- Normal `join` is equivalent to `inner join`.
- Normal collection joins require `on`.
- `cross join` is only for local source expansion.
- `left join` with local sources preserves the left row when the local source is empty.
- Duplicate matches produce duplicate rows for `select`.
- Join aliases must be unique within the statement.

## Expressions

### Precedence

Highest to lowest:

```text
function call, field path, parenthesized expression
unary +, unary -, not
*, /
+, -
=, !=, <, <=, >, >=, in, not in, is null, is not null
and
or
```

### Field Paths

```ebnf
field_path := field_segment { "." field_segment }
field_segment := identifier | backticked_identifier
```

Examples:

```sql
o.customer.email
o.`billing.total`
o.`created by`
```

Rules:

- `o.customer.email` means nested map field access.
- `` o.`billing.total` `` means one Firestore field named `billing.total`.
- `o.id` means the document field named `id`.
- `id(o)` means the Firestore document id.
- Unqualified field paths bind to the primary source when unambiguous.
- Qualified field paths require a known alias.

### Literals

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
date("2026-01-01")
now()
```

Rules:

- `timestamp()` returns a Firestore timestamp literal.
- `date()` returns a timestamp boundary value.
- `ref()` returns a Firestore document reference literal.
- `int()` and `double()` force numeric type intent.

### Arrays And Tuples

Array literal:

```sql
["vip", "trial"]
```

Tuple expression:

```sql
("vip", "trial")
```

Rules:

- Use array literals for stored array values.
- Use tuple expressions for `in` and `array_contains_any` argument lists.

### Maps

Map literals are reserved for later. Map fields are accessed through field paths and expanded with `entries(map)`.

### Operators

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

Null:

```sql
where o.deletedAt is null
where o.deletedAt is not null
```

Boolean:

```sql
where o.status = "paid" and o.total > 100
where o.status = "paid" or o.status = "refunded"
where not missing(o.status)
```

Math:

```sql
select o.total * 1.1 as totalWithTax
from orders o
```

### Case

```sql
case
  when o.total >= 100 then "high"
  else "normal"
end
```

Case rules:

- `case` expressions are local unless a future planner proves otherwise.
- Every `when` condition must evaluate to boolean.
- Missing or `null` conditions behave as false.

### Predicate Subqueries

Exists:

```sql
where exists (
  select 1
  from unnest(o.items) item
  where item.total > 1
)
```

Not exists:

```sql
where not exists (
  select 1
  from unnest(o.items) item
  where item.qty <= 0
)
```

In subquery:

```sql
where o.userId in (
  select id(u)
  from users u
  where u.plan = "pro"
)
```

Rules:

- Predicate subqueries are allowed in `exists`, `not exists`, and `in`.
- Predicate subqueries may reference outer aliases.
- Correlated subqueries must be visible in the execution plan.
- Derived table sources such as `from (select ...) x` are reserved and not part of this dialect.

## Functions

### Metadata Functions

```sql
id(value)
path(value)
ref(value)
parent_path(value)
parent_ref(value)
project_id(value)
```

Rules:

- `id(documentAlias)` returns the Firestore document id.
- `id(metadataAlias)` returns the metadata row id.
- `path(value)` returns full document path or metadata row path.
- `ref(value)` returns document reference or collection reference depending on row kind.
- `parent_path(value)` returns parent document path when available.
- `parent_ref(value)` returns parent document reference when available.
- `project_id(value)` returns the Firebase Desk project target id.
- Metadata functions accept an alias or metadata row expression.

### Map Entry Functions

```sql
key(entry)
value(entry)
```

Examples:

```sql
select
  id(g) as gameId,
  key(r) as roundId,
  value(r).description as roundDescription
from games g
cross join entries(g.rounds) r
```

```sql
select
  key(r) as roundId,
  r.description
from games g
cross join entries(g.rounds) r
where key(r) in ("id-1", "id-2")
```

Rules:

- `key(entry)` returns the map key from `entries(map)`.
- `value(entry)` returns the map value.
- Field access on an entry row proxies to `value(entry)`.

### Scalar Functions

Initial scalar functions:

```sql
coalesce(value, fallback)
lower(value)
upper(value)
concat(...)
round(value, digits)
date_trunc(unit, timestamp)
now()
```

### Firestore Predicate Helpers

```sql
exists(field)
missing(field)
array_contains(arrayField, value)
array_contains_any(arrayField, tuple)
```

Rules:

- `exists(field)` on a field path checks field presence.
- `missing(field)` checks field absence.
- `array_contains()` may compile to a Firestore-native array filter.
- `array_contains_any()` may compile to a Firestore-native array filter.

### Write Helper Functions

Write helpers are valid only in write assignments or insert values.

Initial write helpers:

```sql
server_timestamp()
increment(value)
array_union(...)
array_remove(...)
delete_field()
```

Rules:

- Write helpers are invalid in `select` output, filters, joins, grouping, ordering, and read-only expressions.
- The analyzer must return a stable diagnostic for write helpers outside write contexts.

## Aggregation

Aggregate functions:

```sql
count(*)
count(field)
count(distinct field)
sum(field)
avg(field)
min(field)
max(field)
```

Rules:

- Aggregate expressions require aggregate context.
- Non-aggregate output expressions with aggregate functions require `group by`.
- `having` applies after aggregation.
- Local vs Firestore-native aggregation is an execution decision, not syntax.

## Execution Clauses

Execution clauses sit at the end of the command unless an insert statement places write clauses before the source `select`.

```ebnf
execution_clauses :=
  [ "limit" integer ]
  [ "page" "size" integer ]
  [ "write" "batch" "size" integer ]
  [ "write" "mode" ( "batch" | "bulk_writer" ) ]
```

Select:

```sql
select *
from orders
limit 500
page size 100
```

Delete:

```sql
delete from orders o
where o.status = "test"
limit 1000
page size 100
write batch size 400
```

Insert from select:

```sql
insert into project("staging").archivedOrders(@id, sourceId, status)
on conflict fail
write batch size 400
select id(o), id(o), o.status
from project("prod").orders o
where o.status = "closed"
limit 1000
page size 100
```

Rules:

- `limit` caps output rows for `select`.
- `limit` caps source rows for `delete`, `update`, and `insert ... select`.
- `limit` is not a write-count cap.
- `page size` controls source read pagination.
- `write batch size` controls write commit chunking.
- `write mode batch` and `write mode bulk_writer` override query context for one command.
- `insert ... values` does not accept pagination clauses.

## Delete

```ebnf
delete_statement :=
  "delete" [ identifier ]
  "from" source
  { join_clause }
  [ "using" source { join_clause } ]
  [ "where" expression ]
  [ execution_clauses ]
```

Examples:

```sql
delete from orders o
where o.status = "test"
limit 100
```

```sql
delete o
from customers c
cross join subcollection(c, "orders") o
where o.status = "test"
```

Rules:

- `delete from source` deletes the primary source.
- `delete alias from ...` deletes the named source alias.
- The delete target alias must exist.
- Cross-project delete writes to exactly one target project.

## Update

```ebnf
update_statement :=
  "update" update_target
  [ "from" source { join_clause } ]
  "set" assignment_list
  [ "where" expression ]
  [ execution_clauses ]
```

Examples:

```sql
update orders o
set archived = true
where o.status = "closed"
```

```sql
update project("staging").orders stage
from project("prod").orders prod
set copiedStatus = prod.status
where id(stage) = id(prod)
```

Rules:

- `update source set ...` updates the primary source.
- `update alias from ... set ...` updates the named source alias.
- Assignment targets are document field paths, not metadata functions.
- Dynamic map-entry updates must resolve to a parent document field path.
- The update target alias must exist.
- Cross-project update writes to exactly one target project.

## Insert

```ebnf
insert_statement :=
  "insert" "into" source "(" insert_target_list ")"
  [ conflict_clause ]
  [ write_execution_clauses ]
  ( values_clause | select_statement )

insert_target_list := insert_target { "," insert_target }
insert_target := "@id" | field_path
conflict_clause := "on" "conflict" ( "fail" | "ignore" | "if_missing" )
write_execution_clauses :=
  [ "write" "batch" "size" integer ]
  [ "write" "mode" ( "batch" | "bulk_writer" ) ]
```

Insert values:

```sql
insert into orders(@id, status, total)
values ("ord_1", "paid", 125)
```

Insert a normal document field named `id`:

```sql
insert into orders(id, status)
values ("ord_1", "paid")
```

Insert from select:

```sql
insert into project("staging").archivedOrders(@id, sourceId, status)
on conflict fail
write batch size 400
select id(o), id(o), o.status
from project("prod").orders o
where o.status = "closed"
limit 1000
page size 100
```

Rules:

- `@id` targets the Firestore document id.
- `@id` does not create a document field named `id`.
- `id` as a normal insert target creates a document field named `id`.
- `@id` consumes one values/select expression by position.
- Every normal target field consumes one values/select expression by position.
- Target count must equal value/select output count.
- The expression mapped to `@id` may use literals, parameters, or source aliases from `insert ... select`.
- `insert ... select` may read from projects different from the insert target project.
- Cross-project insert writes to exactly one target project.

## Describe And Discover Schema

Describe:

```sql
describe orders
describe collection_group("orders")
```

Discover schema:

```sql
discover schema for orders limit 500
discover schema for collection("customers/cus_123/orders") limit 500
discover schema for project("prod").collection_group("orders") limit 1000
```

Rules:

- `describe` reads a known schema definition.
- `discover schema` samples source documents.
- `discover schema` accepts `limit`.
- Schema commands do not accept joins.

## Semantic Rules

Alias rules:

- Every source alias in one statement scope must be unique.
- Referencing an unknown alias is an error.
- Unqualified field paths bind to the primary source when unambiguous.
- Ambiguous unqualified fields should produce a semantic warning or error depending on schema knowledge.

Project rules:

- `$alias` parameters in `project($alias)` must exist in query context.
- A source without `project(...)` uses the selected tab project.
- Cross-project writes must have exactly one write target project.

Source-shape rules:

- `collection("a/b/c")` is valid because it resolves to a collection path.
- `collection("a/b")` is invalid because it resolves to a document path.
- `collection_group("orders")` is valid.
- `collection_group("customers/orders")` is invalid.

Function context rules:

- Metadata functions are allowed in select, filter, join, order, grouping, and write source expressions.
- Source functions are allowed only in source positions.
- Aggregate functions are allowed only in aggregate contexts.
- Write helpers are allowed only in write assignment or insert value contexts.

## Formatting Rules

Canonical formatting:

- SQL keywords are lowercase.
- Function names are lowercase.
- Strings use double quotes.
- Backticked field/source segments remain backticked.
- Identifier and alias casing is preserved.
- Comments are not preserved.
- Whitespace is normalized.
- `as` is emitted for aliased select columns.
- `@id` is emitted literally.
- Formatter output must parse back to an equivalent AST.

Examples:

```sql
SELECT ID(o) AS orderId FROM orders o
```

formats as:

```sql
select id(o) as orderId from orders o
```

## Diagnostics

Diagnostics must include:

- `code`
- `message`
- `severity`
- `line`
- `column`

Stable diagnostic code groups:

```text
PARSE_UNEXPECTED_TOKEN
PARSE_UNTERMINATED_STRING
PARSE_INVALID_NUMBER
PARSE_INVALID_SOURCE
PARSE_INVALID_EXECUTION_CLAUSE
SEMANTIC_DUPLICATE_ALIAS
SEMANTIC_UNKNOWN_ALIAS
SEMANTIC_AMBIGUOUS_FIELD
SEMANTIC_MISSING_PROJECT_ALIAS
SEMANTIC_INVALID_COLLECTION_PATH
SEMANTIC_INVALID_COLLECTION_GROUP
SEMANTIC_INVALID_TARGET_ALIAS
SEMANTIC_TARGET_VALUE_COUNT_MISMATCH
SEMANTIC_INVALID_ID_TARGET
SEMANTIC_INVALID_FUNCTION_CONTEXT
SEMANTIC_INVALID_WRITE_TARGET_PROJECT
SEMANTIC_UNSUPPORTED_STATEMENT_CONTEXT
```

Rules:

- Parser diagnostics should report syntax shape.
- Analyzer diagnostics should report meaning and context.
- Unsupported execution should be a planner/runtime diagnostic, not a parser failure, when syntax is valid dialect SQL.

## Rejected Syntax

Rejected:

```sql
select *
from admin-events
```

Use:

```sql
select e.slug
from `admin-events` e
```

Rejected:

```sql
select *
from collection_group("customers/orders")
```

Reason: collection groups use collection ids, not paths.

Rejected:

```sql
select server_timestamp()
from orders
```

Reason: write helpers are not valid read expressions.

Rejected:

```sql
select *
from orders
union
select *
from archivedOrders
```

Reason: only `union all` is part of this dialect.

## Reserved For Later

These are intentionally outside the current dialect contract:

- plain `union`
- global `order by` after `union all`
- global `limit` after `union all`
- derived table sources: `from (select ...) x`
- arbitrary inline JavaScript or TypeScript expressions
- map literals
- full PostgreSQL compatibility
- full MySQL compatibility
- direct `__name__` pseudo-field syntax
