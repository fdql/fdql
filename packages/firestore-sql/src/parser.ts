import { createToken, Lexer } from 'chevrotain';
import type { IToken, TokenType } from 'chevrotain';

export interface ParseDiagnostic {
  readonly code: string;
  readonly column: number;
  readonly line: number;
  readonly message: string;
}

export interface FieldSegment {
  readonly quoted?: boolean;
  readonly text: string;
}

export type LiteralValue = boolean | null | number | string;

export type FirestoreSqlExpression =
  | ArrayExpression
  | BinaryExpression
  | CallExpression
  | CaseExpression
  | ExistsSubqueryExpression
  | FieldPathExpression
  | LiteralExpression
  | ParameterExpression
  | TupleExpression
  | UnaryExpression
  | WildcardExpression;

export interface ArrayExpression {
  readonly items: readonly FirestoreSqlExpression[];
  readonly kind: 'array';
}

export interface BinaryExpression {
  readonly kind: 'binary';
  readonly left: FirestoreSqlExpression;
  readonly operator: string;
  readonly right: FirestoreSqlExpression;
}

export interface CallExpression {
  readonly args: readonly FirestoreSqlExpression[];
  readonly distinct?: boolean;
  readonly kind: 'call';
  readonly name: string;
}

export interface CaseExpression {
  readonly cases: readonly CaseBranch[];
  readonly else?: FirestoreSqlExpression;
  readonly kind: 'case';
}

export interface CaseBranch {
  readonly result: FirestoreSqlExpression;
  readonly when: FirestoreSqlExpression;
}

export interface ExistsSubqueryExpression {
  readonly kind: 'existsSubquery';
  readonly negated?: boolean;
  readonly subquery: SelectStatement | UnionAllStatement;
}

export interface FieldPathExpression {
  readonly kind: 'fieldPath';
  readonly parts: readonly FieldSegment[];
}

export interface LiteralExpression {
  readonly kind: 'literal';
  readonly value: LiteralValue;
  readonly valueType: 'boolean' | 'null' | 'number' | 'string';
}

export interface ParameterExpression {
  readonly kind: 'parameter';
  readonly name: string;
}

export interface TupleExpression {
  readonly items: readonly FirestoreSqlExpression[];
  readonly kind: 'tuple';
}

export interface UnaryExpression {
  readonly expression: FirestoreSqlExpression;
  readonly kind: 'unary';
  readonly operator: string;
}

export interface WildcardExpression {
  readonly kind: 'wildcard';
}

export interface SelectColumn {
  readonly alias?: string;
  readonly expression: FirestoreSqlExpression;
}

export interface OrderByItem {
  readonly direction?: 'asc' | 'desc';
  readonly expression: FirestoreSqlExpression;
}

export interface ExecutionClauses {
  readonly limit?: number;
  readonly pageSize?: number;
  readonly readBudget?: number;
  readonly timeoutMs?: number;
  readonly writeBatchSize?: number;
  readonly writeMode?: 'batch' | 'bulk_writer';
}

export type FirestoreSqlSource = CollectionSource | FunctionSource | ProjectSource;

export interface CollectionSource {
  readonly alias?: string;
  readonly kind: 'collection';
  readonly name: string;
  readonly quoted?: boolean;
}

export interface FunctionSource {
  readonly alias?: string;
  readonly args: readonly FirestoreSqlExpression[];
  readonly kind: 'function';
  readonly name: string;
}

export interface ProjectSource {
  readonly alias?: string;
  readonly kind: 'project';
  readonly project: FirestoreSqlExpression;
  readonly source: CollectionSource | FunctionSource;
}

export interface JoinClause {
  readonly condition?: FirestoreSqlExpression;
  readonly source: FirestoreSqlSource;
  readonly type: 'cross' | 'inner' | 'join' | 'left';
}

export interface SelectStatement {
  readonly columns: readonly SelectColumn[];
  readonly execution?: ExecutionClauses;
  readonly from: FirestoreSqlSource;
  readonly groupBy?: readonly FirestoreSqlExpression[];
  readonly having?: FirestoreSqlExpression;
  readonly joins: readonly JoinClause[];
  readonly kind: 'select';
  readonly orderBy?: readonly OrderByItem[];
  readonly where?: FirestoreSqlExpression;
}

export interface UnionAllStatement {
  readonly branches: readonly SelectStatement[];
  readonly kind: 'unionAll';
}

export interface RecursiveCteStatement {
  readonly cte: {
    readonly columns: readonly string[];
    readonly name: string;
    readonly query: SelectStatement | UnionAllStatement;
  };
  readonly kind: 'recursiveCte';
  readonly query: SelectStatement;
}

export interface DeleteStatement {
  readonly execution?: ExecutionClauses;
  readonly from: FirestoreSqlSource;
  readonly joins: readonly JoinClause[];
  readonly kind: 'delete';
  readonly targetAlias?: string;
  readonly using?: {
    readonly joins: readonly JoinClause[];
    readonly source: FirestoreSqlSource;
  };
  readonly where?: FirestoreSqlExpression;
}

export interface Assignment {
  readonly target: FirestoreSqlExpression;
  readonly value: FirestoreSqlExpression;
}

export interface UpdateStatement {
  readonly execution?: ExecutionClauses;
  readonly from?: {
    readonly joins: readonly JoinClause[];
    readonly source: FirestoreSqlSource;
  };
  readonly kind: 'update';
  readonly set: readonly Assignment[];
  readonly target: FirestoreSqlSource | TargetAlias;
  readonly where?: FirestoreSqlExpression;
}

export interface TargetAlias {
  readonly kind: 'targetAlias';
  readonly name: string;
}

export type InsertTarget = InsertDocumentIdTarget | InsertFieldTarget;

export interface InsertDocumentIdTarget {
  readonly kind: 'documentId';
}

export interface InsertFieldTarget {
  readonly kind: 'field';
  readonly name: string;
  readonly path: readonly FieldSegment[];
}

export interface InsertStatement {
  readonly conflict?: 'fail' | 'merge' | 'overwrite';
  readonly execution?: ExecutionClauses;
  readonly kind: 'insert';
  readonly source?: SelectStatement | UnionAllStatement;
  readonly target: FirestoreSqlSource;
  readonly targets: readonly InsertTarget[];
  readonly values?: readonly FirestoreSqlExpression[];
}

export interface DiscoverSchemaStatement {
  readonly kind: 'discoverSchema';
  readonly limit?: number;
  readonly source: FirestoreSqlSource;
}

export interface DescribeStatement {
  readonly kind: 'describe';
  readonly source: FirestoreSqlSource;
}

export interface ScriptStatement {
  readonly kind: 'script';
  readonly statements: readonly FirestoreSqlStatement[];
}

export type FirestoreSqlStatement =
  | DeleteStatement
  | DescribeStatement
  | DiscoverSchemaStatement
  | InsertStatement
  | RecursiveCteStatement
  | ScriptStatement
  | SelectStatement
  | UnionAllStatement
  | UpdateStatement;

export type ParseResult =
  | {
    readonly ast: FirestoreSqlStatement;
    readonly diagnostics: readonly [];
    readonly ok: true;
  }
  | {
    readonly ast?: FirestoreSqlStatement;
    readonly diagnostics: readonly ParseDiagnostic[];
    readonly ok: false;
  };

type Mutable<T> = { -readonly [K in keyof T]: T[K]; };

const Whitespace = createToken({
  group: Lexer.SKIPPED,
  line_breaks: true,
  name: 'Whitespace',
  pattern: /\s+/,
});
const LineComment = createToken({
  group: Lexer.SKIPPED,
  name: 'LineComment',
  pattern: /--[^\n\r]*/,
});
const BlockComment = createToken({
  group: Lexer.SKIPPED,
  line_breaks: true,
  name: 'BlockComment',
  pattern: /\/\*[\s\S]*?\*\//,
});
const Identifier = createToken({ name: 'Identifier', pattern: /[A-Za-z_][A-Za-z0-9_]*/ });
const BacktickIdentifier = createToken({ name: 'BacktickIdentifier', pattern: /`(?:``|[^`])*`/ });
const Parameter = createToken({ name: 'Parameter', pattern: /\$[A-Za-z_][A-Za-z0-9_]*/ });
const AtId = createToken({ name: 'AtId', pattern: /@id/i });
const NumberLiteral = createToken({ name: 'NumberLiteral', pattern: /(?:\d+\.\d+|\d+)/ });
const StringLiteral = createToken({
  line_breaks: false,
  name: 'StringLiteral',
  pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
});

function keyword(name: string, text: string): TokenType {
  return createToken({ longer_alt: Identifier, name, pattern: new RegExp(text, 'i') });
}

const Select = keyword('Select', 'select');
const From = keyword('From', 'from');
const Where = keyword('Where', 'where');
const Order = keyword('Order', 'order');
const By = keyword('By', 'by');
const Limit = keyword('Limit', 'limit');
const Page = keyword('Page', 'page');
const Size = keyword('Size', 'size');
const Write = keyword('Write', 'write');
const Mode = keyword('Mode', 'mode');
const Batch = keyword('Batch', 'batch');
const Insert = keyword('Insert', 'insert');
const Into = keyword('Into', 'into');
const Values = keyword('Values', 'values');
const On = keyword('On', 'on');
const Conflict = keyword('Conflict', 'conflict');
const Delete = keyword('Delete', 'delete');
const Update = keyword('Update', 'update');
const Set = keyword('Set', 'set');
const Using = keyword('Using', 'using');
const Join = keyword('Join', 'join');
const Left = keyword('Left', 'left');
const Inner = keyword('Inner', 'inner');
const Cross = keyword('Cross', 'cross');
const Union = keyword('Union', 'union');
const All = keyword('All', 'all');
const Group = keyword('Group', 'group');
const Having = keyword('Having', 'having');
const As = keyword('As', 'as');
const Distinct = keyword('Distinct', 'distinct');
const And = keyword('And', 'and');
const Or = keyword('Or', 'or');
const Not = keyword('Not', 'not');
const In = keyword('In', 'in');
const Is = keyword('Is', 'is');
const Null = keyword('Null', 'null');
const True = keyword('True', 'true');
const False = keyword('False', 'false');
const Case = keyword('Case', 'case');
const When = keyword('When', 'when');
const Then = keyword('Then', 'then');
const Else = keyword('Else', 'else');
const End = keyword('End', 'end');
const Exists = keyword('Exists', 'exists');
const With = keyword('With', 'with');
const Recursive = keyword('Recursive', 'recursive');
const Discover = keyword('Discover', 'discover');
const Schema = keyword('Schema', 'schema');
const For = keyword('For', 'for');
const Describe = keyword('Describe', 'describe');
const Project = keyword('Project', 'project');
const Asc = keyword('Asc', 'asc');
const Desc = keyword('Desc', 'desc');
const Fail = keyword('Fail', 'fail');
const Merge = keyword('Merge', 'merge');
const Overwrite = keyword('Overwrite', 'overwrite');
const BulkWriter = keyword('BulkWriter', 'bulk_writer');

const NotEqual = createToken({ name: 'NotEqual', pattern: /!=/ });
const LessEqual = createToken({ name: 'LessEqual', pattern: /<=/ });
const GreaterEqual = createToken({ name: 'GreaterEqual', pattern: />=/ });
const DoubleEqual = createToken({ name: 'DoubleEqual', pattern: /==/ });
const Equal = createToken({ name: 'Equal', pattern: /=/ });
const Less = createToken({ name: 'Less', pattern: /</ });
const Greater = createToken({ name: 'Greater', pattern: />/ });
const Plus = createToken({ name: 'Plus', pattern: /\+/ });
const Minus = createToken({ name: 'Minus', pattern: /-/ });
const Star = createToken({ name: 'Star', pattern: /\*/ });
const Slash = createToken({ name: 'Slash', pattern: /\// });
const Dot = createToken({ name: 'Dot', pattern: /\./ });
const Comma = createToken({ name: 'Comma', pattern: /,/ });
const LParen = createToken({ name: 'LParen', pattern: /\(/ });
const RParen = createToken({ name: 'RParen', pattern: /\)/ });
const LSquare = createToken({ name: 'LSquare', pattern: /\[/ });
const RSquare = createToken({ name: 'RSquare', pattern: /]/ });
const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ });

const tokenVocabulary: TokenType[] = [
  Whitespace,
  LineComment,
  BlockComment,
  Select,
  From,
  Where,
  Order,
  By,
  Limit,
  Page,
  Size,
  Write,
  Mode,
  Batch,
  Insert,
  Into,
  Values,
  On,
  Conflict,
  Delete,
  Update,
  Set,
  Using,
  Join,
  Left,
  Inner,
  Cross,
  Union,
  All,
  Group,
  Having,
  Asc,
  As,
  Distinct,
  And,
  Or,
  Not,
  In,
  Is,
  Null,
  True,
  False,
  Case,
  When,
  Then,
  Else,
  End,
  Exists,
  With,
  Recursive,
  Discover,
  Schema,
  For,
  Describe,
  Project,
  Desc,
  Fail,
  Merge,
  Overwrite,
  BulkWriter,
  NotEqual,
  LessEqual,
  GreaterEqual,
  DoubleEqual,
  Equal,
  Less,
  Greater,
  Plus,
  Minus,
  Star,
  Slash,
  Dot,
  Comma,
  LParen,
  RParen,
  LSquare,
  RSquare,
  Semicolon,
  AtId,
  Parameter,
  NumberLiteral,
  StringLiteral,
  BacktickIdentifier,
  Identifier,
];

const firestoreSqlLexer = new Lexer(tokenVocabulary, {
  positionTracking: 'full',
});

class ParseFailure extends Error {
  readonly code: string;
  readonly token?: IToken;

  constructor(code: string, message: string, token?: IToken) {
    super(message);
    this.code = code;
    if (token) this.token = token;
  }
}

class SqlParser {
  private index = 0;
  private readonly tokens: readonly IToken[];

  constructor(tokens: readonly IToken[]) {
    this.tokens = tokens;
  }

  parse(): FirestoreSqlStatement {
    const statements: FirestoreSqlStatement[] = [];
    this.skipSemicolons();

    do {
      statements.push(this.parseStatement());
      this.skipSemicolons();
    } while (!this.isAtEnd() && this.startsStatement(this.current()));

    this.expectEnd();
    return statements.length === 1 ? required(statements[0]) : { kind: 'script', statements };
  }

  private parseStatement(): FirestoreSqlStatement {
    if (this.match(With)) return this.parseRecursiveCte();
    if (this.check(Select)) return this.parseSelectOrUnion();
    if (this.match(Delete)) return this.parseDelete();
    if (this.match(Update)) return this.parseUpdate();
    if (this.match(Insert)) return this.parseInsert();
    if (this.match(Discover)) return this.parseDiscoverSchema();
    if (this.match(Describe)) return this.parseDescribe();

    this.unexpected(this.current(), 'Expected a Firestore SQL command.');
  }

  private parseSelectOrUnion(): SelectStatement | UnionAllStatement {
    const branches = [this.parseSelect()];
    while (this.match(Union)) {
      this.consume(All, 'Expected all after union.');
      branches.push(this.parseSelect());
    }
    if (branches.length === 1) return required(branches[0]);

    const expectedColumnCount = required(branches[0]).columns.length;
    const mismatchedBranch = branches.find((branch) =>
      branch.columns.length !== expectedColumnCount
    );
    if (mismatchedBranch) {
      throw new ParseFailure(
        'UNION_BRANCH_COLUMN_COUNT',
        `Union branch column count ${mismatchedBranch.columns.length} does not match first branch count ${expectedColumnCount}.`,
        this.previous(),
      );
    }

    return { branches, kind: 'unionAll' };
  }

  private parseSelect(): SelectStatement {
    this.consume(Select, 'Expected select.');
    const columns = this.parseSelectColumns();
    this.consume(From, 'Expected from after select list.');
    const from = this.parseSource({ allowAlias: true });
    const joins = this.parseJoins();
    const statement: Mutable<SelectStatement> = { columns, from, joins, kind: 'select' };

    if (this.match(Where)) statement.where = this.parseExpression();
    if (this.match(Group)) {
      this.consume(By, 'Expected by after group.');
      statement.groupBy = this.parseExpressionList();
    }
    if (this.match(Having)) statement.having = this.parseExpression();
    if (this.match(Order)) {
      this.consume(By, 'Expected by after order.');
      statement.orderBy = this.parseOrderBy();
    }

    const execution = this.parseExecutionClauses({ allowWrite: false });
    if (execution) statement.execution = execution;
    return statement;
  }

  private parseRecursiveCte(): RecursiveCteStatement {
    this.consume(Recursive, 'Expected recursive after with.');
    const name = this.consumeName('Expected recursive CTE name.');
    this.consume(LParen, 'Expected CTE column list.');
    const columns = this.parseNameList();
    this.consume(RParen, 'Expected ) after CTE column list.');
    this.consume(As, 'Expected as after CTE column list.');
    this.consume(LParen, 'Expected ( before CTE query.');
    const query = this.parseSelectOrUnion();
    this.consume(RParen, 'Expected ) after CTE query.');
    const outer = this.parseSelect();
    return { cte: { columns, name, query }, kind: 'recursiveCte', query: outer };
  }

  private parseDelete(): DeleteStatement {
    let targetAlias: string | undefined;
    if (!this.match(From)) {
      targetAlias = this.consumeName('Expected delete target alias.');
      this.consume(From, 'Expected from after delete target alias.');
    }

    const from = this.parseSource({ allowAlias: true });
    const joins = this.parseJoins();
    const statement: Mutable<DeleteStatement> = { from, joins, kind: 'delete' };
    if (targetAlias) statement.targetAlias = targetAlias;

    if (this.match(Using)) {
      const source = this.parseSource({ allowAlias: true });
      statement.using = {
        joins: this.parseJoins(),
        source,
      };
    }
    if (this.match(Where)) statement.where = this.parseExpression();
    const execution = this.parseExecutionClauses({ allowWrite: true });
    if (execution) statement.execution = execution;
    return statement;
  }

  private parseUpdate(): UpdateStatement {
    const target = this.check(Identifier) && this.checkNext(From)
      ? ({ kind: 'targetAlias', name: this.advance().image } satisfies TargetAlias)
      : this.parseSource({ allowAlias: true });

    const statement: Mutable<UpdateStatement> = { kind: 'update', set: [], target };

    if (this.match(From)) {
      const source = this.parseSource({ allowAlias: true });
      statement.from = { joins: this.parseJoins(), source };
    }

    this.consume(Set, 'Expected set in update statement.');
    statement.set = this.parseAssignments();
    if (this.match(Where)) statement.where = this.parseExpression();
    const execution = this.parseExecutionClauses({ allowWrite: true });
    if (execution) statement.execution = execution;
    return statement;
  }

  private parseInsert(): InsertStatement {
    this.consume(Into, 'Expected into after insert.');
    const target = this.parseInsertDestination();
    this.consume(LParen, 'Expected insert target list.');
    const targets = this.parseInsertTargets();
    this.consume(RParen, 'Expected ) after insert target list.');

    const statement: Mutable<InsertStatement> = { kind: 'insert', target, targets };
    this.parseInsertOptions(statement);

    if (this.match(Values)) {
      this.consume(LParen, 'Expected values tuple.');
      const values = this.parseExpressionList();
      this.consume(RParen, 'Expected ) after values tuple.');
      if (values.length !== targets.length) {
        throw new ParseFailure(
          'INSERT_TARGET_VALUE_COUNT',
          `Insert target count ${targets.length} does not match values count ${values.length}.`,
          this.previous(),
        );
      }
      statement.values = values;
      this.validateInsertConflictPolicy(statement);
      return statement;
    }

    if (this.check(Select)) {
      const source = this.parseSelect();
      const sourceColumnCount = source.columns.length;
      if (sourceColumnCount !== targets.length) {
        throw new ParseFailure(
          'INSERT_TARGET_VALUE_COUNT',
          `Insert target count ${targets.length} does not match select output count ${
            sourceColumnCount ?? 0
          }.`,
          this.previous(),
        );
      }
      statement.source = source;
      this.validateInsertConflictPolicy(statement);
      return statement;
    }

    this.unexpected(this.current(), 'Expected values or select after insert target.');
  }

  private validateInsertConflictPolicy(statement: InsertStatement): void {
    if (
      statement.targets.some((targetItem) => targetItem.kind === 'documentId')
      && !statement.conflict
    ) {
      throw new ParseFailure(
        'INSERT_EXPLICIT_ID_CONFLICT_POLICY',
        'Insert statements with @id require an explicit conflict policy.',
        this.previous(),
      );
    }
  }

  private parseInsertOptions(statement: Mutable<InsertStatement>): void {
    while (true) {
      if (this.match(On)) {
        this.consume(Conflict, 'Expected conflict after on.');
        statement.conflict = this.parseConflictPolicy();
        continue;
      }

      const execution = this.parseExecutionClauses({
        allowLimit: false,
        allowPageSize: false,
        allowWrite: true,
      });
      if (execution) {
        statement.execution = mergeExecution(statement.execution, execution);
        continue;
      }

      return;
    }
  }

  private parseDiscoverSchema(): DiscoverSchemaStatement {
    this.consume(Schema, 'Expected schema after discover.');
    this.consume(For, 'Expected for after discover schema.');
    const source = this.parseSource({ allowAlias: false });
    const statement: Mutable<DiscoverSchemaStatement> = { kind: 'discoverSchema', source };
    if (this.match(Limit)) statement.limit = this.consumeInteger('Expected limit value.');
    return statement;
  }

  private parseDescribe(): DescribeStatement {
    return { kind: 'describe', source: this.parseSource({ allowAlias: false }) };
  }

  private parseSelectColumns(): readonly SelectColumn[] {
    const columns: SelectColumn[] = [];
    do {
      const expression = this.parseExpression();
      const column: Mutable<SelectColumn> = { expression };
      if (this.match(As)) column.alias = this.consumeName('Expected select alias.');
      columns.push(column);
    } while (this.match(Comma));
    return columns;
  }

  private parseSource(options: { readonly allowAlias: boolean; }): FirestoreSqlSource {
    let source: FirestoreSqlSource;
    if (this.match(Project)) {
      this.consume(LParen, 'Expected ( after project.');
      const project = this.parseExpression();
      this.consume(RParen, 'Expected ) after project.');
      this.consume(Dot, 'Expected . after project(...).');
      const inner = this.parseSourceBody();
      source = { kind: 'project', project, source: inner };
    } else {
      source = this.parseSourceBody();
    }

    if (options.allowAlias && this.canStartAlias()) {
      source = withSourceAlias(source, this.advance().image);
    }
    return source;
  }

  private parseInsertDestination(): FirestoreSqlSource {
    if (!this.match(Project)) {
      const nameToken = this.consumeIdentifierLike('Expected insert destination collection.');
      return collectionSource(identifierText(nameToken), isToken(nameToken, BacktickIdentifier));
    }

    this.consume(LParen, 'Expected ( after project.');
    const project = this.parseExpression();
    this.consume(RParen, 'Expected ) after project.');
    this.consume(Dot, 'Expected . after project(...).');

    const nameToken = this.consumeIdentifierLike('Expected insert destination collection.');
    return {
      kind: 'project',
      project,
      source: collectionSource(identifierText(nameToken), isToken(nameToken, BacktickIdentifier)),
    };
  }

  private parseSourceBody(): CollectionSource | FunctionSource {
    if (this.check(LParen)) {
      this.unexpected(this.current(), 'Parenthesized source queries are not supported.');
    }

    const nameToken = this.consumeIdentifierLike('Expected collection or source function name.');
    const name = identifierText(nameToken);
    if (this.match(LParen)) {
      const args = this.check(RParen) ? [] : this.parseExpressionList();
      this.consume(RParen, 'Expected ) after source function arguments.');
      return { args, kind: 'function', name };
    }
    return collectionSource(name, isToken(nameToken, BacktickIdentifier));
  }

  private parseJoins(): readonly JoinClause[] {
    const joins: JoinClause[] = [];

    while (this.canStartJoin()) {
      let type: JoinClause['type'] = 'join';
      if (this.match(Left)) type = 'left';
      else if (this.match(Inner)) type = 'inner';
      else if (this.match(Cross)) type = 'cross';

      this.consume(Join, 'Expected join.');
      const source = this.parseSource({ allowAlias: true });
      const join: Mutable<JoinClause> = { source, type };
      if (this.match(On)) join.condition = this.parseExpression();
      joins.push(join);
    }

    return joins;
  }

  private parseAssignments(): readonly Assignment[] {
    const assignments: Assignment[] = [];
    do {
      const target = this.parseExpression(4);
      if (!this.match(Equal) && !this.match(DoubleEqual)) {
        this.unexpected(this.current(), 'Expected = in assignment.');
      }
      assignments.push({ target, value: this.parseExpression() });
    } while (this.match(Comma));
    return assignments;
  }

  private parseInsertTargets(): readonly InsertTarget[] {
    const targets: InsertTarget[] = [];
    do {
      if (this.match(AtId)) {
        targets.push({ kind: 'documentId' });
        continue;
      }

      const path = this.parseFieldSegments('Expected insert target field.');
      targets.push({ kind: 'field', name: path.map((part) => part.text).join('.'), path });
    } while (this.match(Comma));
    return targets;
  }

  private parseOrderBy(): readonly OrderByItem[] {
    const items: OrderByItem[] = [];
    do {
      const item: Mutable<OrderByItem> = { expression: this.parseExpression() };
      if (this.match(Asc)) item.direction = 'asc';
      else if (this.match(Desc)) item.direction = 'desc';
      items.push(item);
    } while (this.match(Comma));
    return items;
  }

  private parseExecutionClauses(options: {
    readonly allowLimit?: boolean;
    readonly allowPageSize?: boolean;
    readonly allowWrite: boolean;
  }): ExecutionClauses | undefined {
    const allowLimit = options.allowLimit ?? true;
    const allowPageSize = options.allowPageSize ?? true;
    const execution: Mutable<ExecutionClauses> = {};
    let matched = false;

    while (true) {
      if (allowLimit && this.match(Limit)) {
        execution.limit = this.consumeInteger('Expected limit value.');
        matched = true;
        continue;
      }

      if (allowPageSize && this.match(Page)) {
        this.consume(Size, 'Expected size after page.');
        execution.pageSize = this.consumeInteger('Expected page size value.');
        matched = true;
        continue;
      }

      if (options.allowWrite && this.match(Write)) {
        if (this.match(Batch)) {
          this.consume(Size, 'Expected size after write batch.');
          execution.writeBatchSize = this.consumeInteger('Expected write batch size value.');
          matched = true;
          continue;
        }

        this.consume(Mode, 'Expected batch size or mode after write.');
        execution.writeMode = this.parseWriteMode();
        matched = true;
        continue;
      }

      return matched ? execution : undefined;
    }
  }

  private parseExpressionList(): readonly FirestoreSqlExpression[] {
    const expressions: FirestoreSqlExpression[] = [];
    do {
      expressions.push(this.parseExpression());
    } while (this.match(Comma));
    return expressions;
  }

  private parseNameList(): readonly string[] {
    const names: string[] = [];
    do {
      names.push(this.consumeName('Expected name.'));
    } while (this.match(Comma));
    return names;
  }

  private parseExpression(minPrecedence = 1): FirestoreSqlExpression {
    let left = this.parsePrefixExpression();

    while (true) {
      const operator = this.currentBinaryOperator();
      if (!operator || operator.precedence < minPrecedence) return left;

      this.advanceOperator(operator);
      const right = this.parseExpression(operator.precedence + 1);
      left = { kind: 'binary', left, operator: operator.text, right };
    }
  }

  private parsePrefixExpression(): FirestoreSqlExpression {
    if (this.match(Not)) {
      if (this.match(Exists)) return this.parseExists(true);
      return { expression: this.parseExpression(6), kind: 'unary', operator: 'not' };
    }
    if (this.match(Minus)) {
      return { expression: this.parseExpression(6), kind: 'unary', operator: '-' };
    }
    if (this.match(Exists)) return this.parseExists(false);
    if (this.match(Case)) return this.parseCaseExpression();
    return this.parsePrimaryExpression();
  }

  private parsePrimaryExpression(): FirestoreSqlExpression {
    if (this.match(Null)) return { kind: 'literal', value: null, valueType: 'null' };
    if (this.match(True)) return { kind: 'literal', value: true, valueType: 'boolean' };
    if (this.match(False)) return { kind: 'literal', value: false, valueType: 'boolean' };
    if (this.match(NumberLiteral)) {
      return {
        kind: 'literal',
        value: Number(required(this.previous()).image),
        valueType: 'number',
      };
    }
    if (this.match(StringLiteral)) {
      return {
        kind: 'literal',
        value: parseSqlString(required(this.previous()).image),
        valueType: 'string',
      };
    }
    if (this.match(Parameter)) {
      return { kind: 'parameter', name: required(this.previous()).image.slice(1) };
    }
    if (this.match(Star)) return { kind: 'wildcard' };
    if (this.check(AtId)) {
      this.unexpected(this.current(), '@id is only valid in an insert target list.');
    }

    if (this.match(LParen)) {
      const expressions = this.check(RParen) ? [] : this.parseExpressionList();
      this.consume(RParen, 'Expected ) after expression.');
      return expressions.length === 1
        ? required(expressions[0])
        : { items: expressions, kind: 'tuple' };
    }

    if (this.match(LSquare)) {
      const items = this.check(RSquare) ? [] : this.parseExpressionList();
      this.consume(RSquare, 'Expected ] after array literal.');
      return { items, kind: 'array' };
    }

    if (this.canStartIdentifierLike(this.current())) return this.parseCallOrPath();
    this.unexpected(this.current(), 'Expected expression.');
  }

  private parseCallOrPath(): FirestoreSqlExpression {
    const first = identifierText(this.advance());
    if (this.match(LParen)) {
      const call: Mutable<CallExpression> = { args: [], kind: 'call', name: first };
      if (!this.check(RParen)) {
        if (this.match(Distinct)) call.distinct = true;
        if (this.match(Star)) call.args = [{ kind: 'wildcard' }];
        else call.args = this.parseExpressionList();
      }
      this.consume(RParen, 'Expected ) after function call.');
      return call;
    }

    const parts: FieldSegment[] = [fieldSegment(first, false)];
    while (this.match(Dot)) {
      const segment = this.consumeIdentifierLike('Expected field path segment after dot.');
      parts.push(fieldSegment(identifierText(segment), isToken(segment, BacktickIdentifier)));
    }
    return { kind: 'fieldPath', parts };
  }

  private parseFieldSegments(message: string): readonly FieldSegment[] {
    const first = this.consumeIdentifierLike(message);
    const parts: FieldSegment[] = [
      fieldSegment(identifierText(first), isToken(first, BacktickIdentifier)),
    ];
    while (this.match(Dot)) {
      const segment = this.consumeIdentifierLike('Expected path segment after dot.');
      parts.push(fieldSegment(identifierText(segment), isToken(segment, BacktickIdentifier)));
    }
    return parts;
  }

  private parseExists(negated: boolean): FirestoreSqlExpression {
    this.consume(LParen, 'Expected ( after exists.');
    if (this.check(Select)) {
      const subquery = this.parseSelect();
      this.consume(RParen, 'Expected ) after exists subquery.');
      return negated
        ? { kind: 'existsSubquery', negated: true, subquery }
        : { kind: 'existsSubquery', subquery };
    }

    const args = this.check(RParen) ? [] : this.parseExpressionList();
    this.consume(RParen, 'Expected ) after exists arguments.');
    const call: CallExpression = { args, kind: 'call', name: 'exists' };
    return negated ? { expression: call, kind: 'unary', operator: 'not' } : call;
  }

  private parseCaseExpression(): CaseExpression {
    const branches: CaseBranch[] = [];
    while (this.match(When)) {
      const when = this.parseExpression();
      this.consume(Then, 'Expected then in case expression.');
      branches.push({ result: this.parseExpression(), when });
    }

    let elseExpression: FirestoreSqlExpression | undefined;
    if (this.match(Else)) elseExpression = this.parseExpression();
    this.consume(End, 'Expected end after case expression.');
    return elseExpression
      ? { cases: branches, else: elseExpression, kind: 'case' }
      : { cases: branches, kind: 'case' };
  }

  private currentBinaryOperator():
    | {
      readonly precedence: number;
      readonly text: string;
      readonly tokenCount?: 2;
    }
    | undefined
  {
    if (this.check(Or)) return { precedence: 1, text: 'or' };
    if (this.check(And)) return { precedence: 2, text: 'and' };
    if (this.check(Not) && this.checkNext(In)) {
      return { precedence: 3, text: 'not in', tokenCount: 2 };
    }
    if (this.check(In)) return { precedence: 3, text: 'in' };
    if (this.check(Is) && this.checkNext(Not) && this.checkNext(Null, 2)) {
      return { precedence: 3, text: 'is not', tokenCount: 2 };
    }
    if (this.check(Is)) return { precedence: 3, text: 'is' };
    if (this.check(Equal) || this.check(DoubleEqual)) return { precedence: 3, text: '=' };
    if (this.check(NotEqual)) return { precedence: 3, text: '!=' };
    if (this.check(Less)) return { precedence: 3, text: '<' };
    if (this.check(LessEqual)) return { precedence: 3, text: '<=' };
    if (this.check(Greater)) return { precedence: 3, text: '>' };
    if (this.check(GreaterEqual)) return { precedence: 3, text: '>=' };
    if (this.check(Plus)) return { precedence: 4, text: '+' };
    if (this.check(Minus)) return { precedence: 4, text: '-' };
    if (this.check(Star)) return { precedence: 5, text: '*' };
    if (this.check(Slash)) return { precedence: 5, text: '/' };
    return undefined;
  }

  private advanceOperator(operator: { readonly tokenCount?: 2; readonly text: string; }): void {
    if (operator.text === 'is not') {
      this.advance();
      this.advance();
      return;
    }
    if (operator.tokenCount === 2) {
      this.advance();
      this.advance();
      return;
    }
    this.advance();
  }

  private parseConflictPolicy(): 'fail' | 'merge' | 'overwrite' {
    if (this.match(Fail)) return 'fail';
    if (this.match(Merge)) return 'merge';
    if (this.match(Overwrite)) return 'overwrite';
    this.unexpected(this.current(), 'Expected insert conflict policy.');
  }

  private parseWriteMode(): 'batch' | 'bulk_writer' {
    if (this.match(Batch)) return 'batch';
    if (this.match(BulkWriter)) return 'bulk_writer';
    this.unexpected(this.current(), 'Expected write mode.');
  }

  private startsStatement(token: IToken | undefined): boolean {
    return Boolean(
      token
        && (isToken(token, Select)
          || isToken(token, Delete)
          || isToken(token, Update)
          || isToken(token, Insert)
          || isToken(token, Discover)
          || isToken(token, Describe)
          || isToken(token, With)),
    );
  }

  private canStartJoin(): boolean {
    return this.check(Join) || this.check(Left) || this.check(Inner) || this.check(Cross);
  }

  private canStartAlias(): boolean {
    const token = this.current();
    return Boolean(token && isToken(token, Identifier) && !this.isClauseStarter(token));
  }

  private isClauseStarter(token: IToken): boolean {
    return [
      Where,
      Order,
      Limit,
      Page,
      Write,
      Group,
      Having,
      Join,
      Left,
      Inner,
      Cross,
      On,
      Using,
      Set,
      Values,
      Union,
      RParen,
    ].some((tokenType) => isToken(token, tokenType));
  }

  private canStartIdentifierLike(token: IToken | undefined): boolean {
    return Boolean(
      token
        && (isToken(token, Identifier)
          || isToken(token, BacktickIdentifier)
          || isToken(token, Project)
          || isToken(token, Batch)
          || isToken(token, BulkWriter)),
    );
  }

  private consumeName(message: string): string {
    return identifierText(this.consumeIdentifierLike(message));
  }

  private consumeIdentifierLike(message: string): IToken {
    const token = this.current();
    if (this.canStartIdentifierLike(token)) return this.advance();
    this.unexpected(token, message);
  }

  private consumeInteger(message: string): number {
    const token = this.consume(NumberLiteral, message);
    const value = Number(token.image);
    if (!Number.isInteger(value)) throw new ParseFailure('UNEXPECTED_TOKEN', message, token);
    return value;
  }

  private consume(tokenType: TokenType, message: string): IToken {
    if (this.check(tokenType)) return this.advance();
    this.unexpected(this.current(), message);
  }

  private match(tokenType: TokenType): boolean {
    if (!this.check(tokenType)) return false;
    this.advance();
    return true;
  }

  private check(tokenType: TokenType): boolean {
    const token = this.current();
    return Boolean(token && isToken(token, tokenType));
  }

  private checkNext(tokenType: TokenType, offset = 1): boolean {
    const token = this.tokens[this.index + offset];
    return Boolean(token && isToken(token, tokenType));
  }

  private advance(): IToken {
    const token = this.current();
    if (!token) {
      throw new ParseFailure('UNEXPECTED_TOKEN', 'Unexpected end of input.', this.previous());
    }
    this.index += 1;
    return token;
  }

  private current(): IToken | undefined {
    return this.tokens[this.index];
  }

  private previous(): IToken | undefined {
    return this.tokens[this.index - 1];
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private skipSemicolons(): void {
    while (this.match(Semicolon)) {
      // empty
    }
  }

  private expectEnd(): void {
    if (!this.isAtEnd()) this.unexpected(this.current(), 'Unexpected token after statement.');
  }

  private unexpected(token: IToken | undefined, message: string): never {
    throw new ParseFailure('UNEXPECTED_TOKEN', message, token ?? this.previous());
  }
}

export function parseFirestoreSql(input: string): ParseResult {
  const lexed = firestoreSqlLexer.tokenize(input);
  const lexError = lexed.errors[0];
  if (lexError) {
    return {
      diagnostics: [
        {
          code: 'UNEXPECTED_TOKEN',
          column: lexError.column ?? 1,
          line: lexError.line ?? 1,
          message: lexError.message,
        },
      ],
      ok: false,
    };
  }

  try {
    return {
      ast: new SqlParser(lexed.tokens).parse(),
      diagnostics: [],
      ok: true,
    };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return {
        diagnostics: [diagnosticFromFailure(error)],
        ok: false,
      };
    }
    throw error;
  }
}

export function formatFirestoreSql(ast: FirestoreSqlStatement): string {
  return formatStatement(ast);
}

function formatStatement(statement: FirestoreSqlStatement): string {
  switch (statement.kind) {
    case 'delete':
      return formatDelete(statement);
    case 'describe':
      return `describe ${formatSource(statement.source)}`;
    case 'discoverSchema':
      return `discover schema for ${formatSource(statement.source)}${
        statement.limit === undefined ? '' : ` limit ${statement.limit}`
      }`;
    case 'insert':
      return formatInsert(statement);
    case 'recursiveCte':
      return `with recursive ${statement.cte.name}(${statement.cte.columns.join(', ')}) as (${
        formatStatement(
          statement.cte.query,
        )
      }) ${formatStatement(statement.query)}`;
    case 'script':
      return statement.statements.map(formatStatement).join('\n');
    case 'select':
      return formatSelect(statement);
    case 'unionAll':
      return statement.branches.map(formatSelect).join(' union all ');
    case 'update':
      return formatUpdate(statement);
  }
}

function formatSelect(statement: SelectStatement): string {
  return [
    `select ${statement.columns.map(formatColumn).join(', ')}`,
    `from ${formatSource(statement.from)}`,
    ...statement.joins.map(formatJoin),
    statement.where ? `where ${formatExpression(statement.where)}` : '',
    statement.groupBy ? `group by ${statement.groupBy.map(formatExpression).join(', ')}` : '',
    statement.having ? `having ${formatExpression(statement.having)}` : '',
    statement.orderBy ? `order by ${statement.orderBy.map(formatOrderByItem).join(', ')}` : '',
    statement.execution ? formatExecution(statement.execution) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function formatDelete(statement: DeleteStatement): string {
  return [
    statement.targetAlias ? `delete ${statement.targetAlias}` : 'delete',
    `from ${formatSource(statement.from)}`,
    ...statement.joins.map(formatJoin),
    statement.using
      ? `using ${formatSource(statement.using.source)} ${
        statement.using.joins.map(formatJoin).join(' ')
      }`.trim()
      : '',
    statement.where ? `where ${formatExpression(statement.where)}` : '',
    statement.execution ? formatExecution(statement.execution) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function formatUpdate(statement: UpdateStatement): string {
  return [
    `update ${formatTarget(statement.target)}`,
    statement.from
      ? `from ${formatSource(statement.from.source)} ${
        statement.from.joins.map(formatJoin).join(' ')
      }`.trim()
      : '',
    `set ${
      statement.set.map((item) =>
        `${formatExpression(item.target)} = ${formatExpression(item.value)}`
      ).join(', ')
    }`,
    statement.where ? `where ${formatExpression(statement.where)}` : '',
    statement.execution ? formatExecution(statement.execution) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function formatInsert(statement: InsertStatement): string {
  return [
    `insert into ${formatSource(statement.target)}(${
      statement.targets.map(formatInsertTarget).join(', ')
    })`,
    statement.conflict ? `on conflict ${statement.conflict}` : '',
    statement.execution ? formatExecution(statement.execution) : '',
    statement.values ? `values (${statement.values.map(formatExpression).join(', ')})` : '',
    statement.source ? formatStatement(statement.source) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function formatColumn(column: SelectColumn): string {
  return column.alias
    ? `${formatExpression(column.expression)} as ${column.alias}`
    : formatExpression(column.expression);
}

function formatOrderByItem(item: OrderByItem): string {
  return `${formatExpression(item.expression)}${item.direction ? ` ${item.direction}` : ''}`;
}

function formatTarget(target: FirestoreSqlSource | TargetAlias): string {
  return target.kind === 'targetAlias' ? target.name : formatSource(target);
}

function formatJoin(join: JoinClause): string {
  return `${join.type === 'join' ? '' : `${join.type} `}join ${formatSource(join.source)}${
    join.condition ? ` on ${formatExpression(join.condition)}` : ''
  }`;
}

function formatExecution(execution: ExecutionClauses): string {
  return [
    execution.limit === undefined ? '' : `limit ${execution.limit}`,
    execution.pageSize === undefined ? '' : `page size ${execution.pageSize}`,
    execution.writeBatchSize === undefined ? '' : `write batch size ${execution.writeBatchSize}`,
    execution.writeMode === undefined ? '' : `write mode ${execution.writeMode}`,
  ]
    .filter(Boolean)
    .join(' ');
}

function formatSource(source: FirestoreSqlSource): string {
  const alias = source.alias ? ` ${source.alias}` : '';
  switch (source.kind) {
    case 'collection':
      return `${source.quoted ? formatBacktick(source.name) : source.name}${alias}`;
    case 'function':
      return `${source.name}(${source.args.map(formatExpression).join(', ')})${alias}`;
    case 'project':
      return `project(${formatExpression(source.project)}).${
        formatSourceBody(source.source)
      }${alias}`;
  }
}

function formatSourceBody(source: CollectionSource | FunctionSource): string {
  switch (source.kind) {
    case 'collection':
      return source.quoted ? formatBacktick(source.name) : source.name;
    case 'function':
      return `${source.name}(${source.args.map(formatExpression).join(', ')})`;
  }
}

function formatInsertTarget(target: InsertTarget): string {
  return target.kind === 'documentId' ? '@id' : target.path.map(formatFieldSegment).join('.');
}

function formatExpression(expression: FirestoreSqlExpression): string {
  return formatExpressionWithContext(expression, 0);
}

function formatExpressionWithContext(
  expression: FirestoreSqlExpression,
  parentPrecedence: number,
  side?: 'left' | 'right',
): string {
  const precedence = expressionPrecedence(expression);
  let text: string;

  switch (expression.kind) {
    case 'array':
      text = `[${expression.items.map(formatExpression).join(', ')}]`;
      break;
    case 'binary':
      text = `${
        formatExpressionWithContext(expression.left, precedence, 'left')
      } ${expression.operator} ${
        formatExpressionWithContext(expression.right, precedence, 'right')
      }`;
      break;
    case 'call':
      text = `${expression.name}(${expression.distinct ? 'distinct ' : ''}${
        expression.args.map(formatExpression).join(', ')
      })`;
      break;
    case 'case':
      text = `case ${
        expression.cases
          .map((branch) =>
            `when ${formatExpression(branch.when)} then ${formatExpression(branch.result)}`
          )
          .join(' ')
      }${expression.else ? ` else ${formatExpression(expression.else)}` : ''} end`;
      break;
    case 'existsSubquery':
      text = `${expression.negated ? 'not ' : ''}exists (${formatStatement(expression.subquery)})`;
      break;
    case 'fieldPath':
      text = expression.parts.map(formatFieldSegment).join('.');
      break;
    case 'literal':
      text = formatLiteral(expression);
      break;
    case 'parameter':
      text = `$${expression.name}`;
      break;
    case 'tuple':
      text = `(${expression.items.map(formatExpression).join(', ')})`;
      break;
    case 'unary':
      text = `${expression.operator} ${
        formatExpressionWithContext(expression.expression, precedence)
      }`;
      break;
    case 'wildcard':
      text = '*';
      break;
  }

  return needsExpressionParens(expression, precedence, parentPrecedence, side) ? `(${text})` : text;
}

function needsExpressionParens(
  expression: FirestoreSqlExpression,
  precedence: number,
  parentPrecedence: number,
  side: 'left' | 'right' | undefined,
): boolean {
  return (
    precedence < parentPrecedence
    || (side === 'right' && expression.kind === 'binary' && precedence === parentPrecedence)
  );
}

function expressionPrecedence(expression: FirestoreSqlExpression): number {
  switch (expression.kind) {
    case 'binary':
      return binaryOperatorPrecedence(expression.operator);
    case 'unary':
      return 6;
    default:
      return 7;
  }
}

function binaryOperatorPrecedence(operator: string): number {
  switch (operator) {
    case 'or':
      return 1;
    case 'and':
      return 2;
    case '!=':
    case '<':
    case '<=':
    case '=':
    case '>':
    case '>=':
    case 'in':
    case 'is':
    case 'is not':
    case 'not in':
      return 3;
    case '+':
    case '-':
      return 4;
    case '*':
    case '/':
      return 5;
    default:
      return 7;
  }
}

function formatFieldSegment(segment: FieldSegment): string {
  return segment.quoted ? formatBacktick(segment.text) : segment.text;
}

function formatLiteral(expression: LiteralExpression): string {
  switch (expression.valueType) {
    case 'boolean':
      return expression.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'number':
      return String(expression.value);
    case 'string':
      return `"${String(expression.value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }
}

function parseSqlString(value: string): string {
  const body = value.slice(1, -1);
  return body.replaceAll(/\\(["'\\])/g, '$1');
}

function formatBacktick(value: string): string {
  return `\`${value.replaceAll('`', '``')}\``;
}

function withSourceAlias(source: FirestoreSqlSource, alias: string): FirestoreSqlSource {
  switch (source.kind) {
    case 'collection':
      return { ...source, alias };
    case 'function':
      return { ...source, alias };
    case 'project':
      return { ...source, alias };
  }
}

function collectionSource(name: string, quoted: boolean): CollectionSource {
  return quoted ? { kind: 'collection', name, quoted: true } : { kind: 'collection', name };
}

function fieldSegment(text: string, quoted: boolean): FieldSegment {
  return quoted ? { quoted: true, text } : { text };
}

function mergeExecution(
  existing: ExecutionClauses | undefined,
  next: ExecutionClauses,
): ExecutionClauses {
  return { ...existing, ...next };
}

function diagnosticFromFailure(error: ParseFailure): ParseDiagnostic {
  const token = error.token;
  return {
    code: error.code,
    column: token?.startColumn ?? 1,
    line: token?.startLine ?? 1,
    message: error.message,
  };
}

function identifierText(token: IToken): string {
  if (isToken(token, BacktickIdentifier)) return token.image.slice(1, -1).replaceAll('``', '`');
  return token.image;
}

function isToken(token: IToken, tokenType: TokenType): boolean {
  return token.tokenType === tokenType;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected value.');
  return value;
}
