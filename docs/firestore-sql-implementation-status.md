# Firestore SQL Implementation Status

This tracks implementation against the dialect and product specs:

- [Dialect contract](./firestore-sql-dialect.md)
- [Product and execution behavior](./firestore-sql.md)

Status values:

- `Shipped`: available in the app or package and covered by tests.
- `Partial`: syntax or infrastructure exists, but behavior is incomplete.
- `Spec only`: defined in docs, not implemented.
- `Deferred`: intentionally outside the current product slice.

## User Surface

| Area                          | Status    | Notes                                                                                                      |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| Dedicated Firestore SQL tab   | Shipped   | Editor, context aliases, Prepare, Run, Cancel, and Output tabs for results, issues, and JS Query snippets. |
| Mock runtime                  | Shipped   | Uses repo mock fixtures and in-memory runtime.                                                             |
| Live Admin runtime            | Shipped   | Uses Firebase Admin reads through repo-firebase.                                                           |
| Browser demo support          | Shipped   | Runs through mock repositories.                                                                            |
| Read-only product policy      | Shipped   | Write commands are blocked in the SQL tab.                                                                 |
| Human execution-plan language | Spec only | Language is defined; raw planner shape is hidden from the SQL tab until this is ready.                     |
| Result lineage UI             | Partial   | Runtime keeps lineage in events; UI does not expose source-row exploration yet.                            |

## Dialect And Parser

| Area                                 | Status   | Notes                                                              |
| ------------------------------------ | -------- | ------------------------------------------------------------------ |
| Case-insensitive keywords            | Shipped  | Formatter emits lowercase keywords.                                |
| Single and double quoted strings     | Shipped  | Formatter emits double quotes.                                     |
| Comments ignored                     | Shipped  | Comments are not preserved by formatter.                           |
| Backticked field/source segments     | Shipped  | Required for collection ids outside normal identifier rules.       |
| `select`                             | Shipped  | Parser, analyzer, planner, executor.                               |
| Top-level `union all`                | Shipped  | No global order/limit over union.                                  |
| Predicate subqueries                 | Partial  | Parser coverage exists for examples; execution support is limited. |
| Recursive CTE syntax                 | Partial  | Parser/planner diagnostic only, no execution.                      |
| `delete`, `update`, `insert` syntax  | Partial  | Parser/analyzer coverage exists; SQL tab blocks execution.         |
| `describe`, `discover schema` syntax | Partial  | Parser coverage exists; product execution is not implemented.      |
| Aggregation syntax                   | Partial  | Parser/planner diagnostics exist; SQL tab blocks execution.        |
| Direct `__name__` syntax             | Deferred | Use `id(alias)`.                                                   |

## Read Execution

| Area                             | Status  | Notes                                                                               |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| Root collection reads            | Shipped | Mock and live.                                                                      |
| `collection("path")`             | Shipped | Collection path validation in analyzer.                                             |
| `collection_group("id")`         | Shipped | Collection group id validation in analyzer.                                         |
| `subcollection(parent, name)`    | Partial | Runtime path exists; product behavior needs broader coverage.                       |
| `subcollections(parent)`         | Partial | Runtime path exists; product behavior needs broader coverage.                       |
| `unnest(array)`                  | Shipped | Local expansion.                                                                    |
| `entries(map)`                   | Shipped | Local map entry expansion with `key()` and `value()`.                               |
| Field projection pushdown        | Shipped | Live runtime uses Firestore `.select(...)`; metadata-only reads use `.select()`.    |
| Safe limit pushdown              | Shipped | Applied when the limit can be pushed without changing semantics.                    |
| Local filters                    | Shipped | Comparisons, boolean logic, null/missing helpers, and supported scalar expressions. |
| Firestore-native filter pushdown | Partial | Planned classification exists; broad native pushdown needs more work.               |
| Local sorting                    | Shipped | Sorting runs locally.                                                               |
| Read budget, timeout, cancel     | Shipped | Stops with partial stats/result state.                                              |
| Per-run lookup cache             | Partial | Planned as policy; deeper join strategy cache needs implementation.                 |

## Joins

| Area                                  | Status    | Notes                                                                                       |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| Inner equality joins                  | Shipped   | Local execution.                                                                            |
| Left equality joins                   | Shipped   | Local execution with join miss stats.                                                       |
| Document id joins through `id(alias)` | Partial   | Syntax and local matching exist; direct Firestore document lookup strategy is not complete. |
| Reference joins through `ref(alias)`  | Partial   | Syntax exists; execution needs full strategy support.                                       |
| Field equality joins                  | Shipped   | Local execution.                                                                            |
| Firestore query join strategy         | Spec only | Needs implementation and plan language output.                                              |
| Local scan join warning               | Partial   | Hidden scan warnings exist for broad reads; join-specific warning needs refinement.         |

## Snippets

| Area                           | Status   | Notes                                 |
| ------------------------------ | -------- | ------------------------------------- |
| Firebase Desk JS Query snippet | Shipped  | Generated from prepared read queries. |
| Admin JS/TS snippets           | Deferred | Planned extension.                    |
| Web SDK snippets               | Deferred | Planned extension.                    |

## Write Work

| Area                               | Status    | Notes                                                            |
| ---------------------------------- | --------- | ---------------------------------------------------------------- |
| SQL writes in user UI              | Deferred  | First user-facing release is read-only.                          |
| Write parser coverage              | Partial   | Syntax exists.                                                   |
| In-memory write executor prototype | Partial   | Prototype exists below the product surface.                      |
| Live write executor                | Spec only | Must be implemented with explicit safety states before exposure. |

## Maintenance Rules

- Update this file when a Firestore SQL feature lands, is intentionally deferred, or changes scope.
- Keep status factual. Do not use roadmap language in the status column.
- Add tests before marking package/runtime behavior as `Shipped`.
- Update the website beta page when user-visible support changes.
