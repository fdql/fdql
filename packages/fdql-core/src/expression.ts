import { createToken, type IToken, Lexer, type TokenType } from 'chevrotain';
import type {
  FdqlArrayExpression,
  FdqlBinaryExpression,
  FdqlCaseBranch,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlMapEntry,
  FdqlSourceRange,
} from './types.ts';

const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /\s+/, group: Lexer.SKIPPED });
const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
});
const NumberLiteral = createToken({ name: 'NumberLiteral', pattern: /(?:0|[1-9]\d*)(?:\.\d+)?/ });
const Plus = createToken({ name: 'Plus', pattern: /\+/ });
const Minus = createToken({ name: 'Minus', pattern: /-/ });
const GreaterEqual = createToken({ name: 'GreaterEqual', pattern: />=/ });
const LessEqual = createToken({ name: 'LessEqual', pattern: /<=/ });
const NotEqual = createToken({ name: 'NotEqual', pattern: /!=|<>/ });
const Equal = createToken({ name: 'Equal', pattern: /=/ });
const Greater = createToken({ name: 'Greater', pattern: />/ });
const Less = createToken({ name: 'Less', pattern: /</ });
const Slash = createToken({ name: 'Slash', pattern: /\// });
const Percent = createToken({ name: 'Percent', pattern: /%/ });
const LParen = createToken({ name: 'LParen', pattern: /\(/ });
const RParen = createToken({ name: 'RParen', pattern: /\)/ });
const LBracket = createToken({ name: 'LBracket', pattern: /\[/ });
const RBracket = createToken({ name: 'RBracket', pattern: /\]/ });
const LBrace = createToken({ name: 'LBrace', pattern: /\{/ });
const RBrace = createToken({ name: 'RBrace', pattern: /\}/ });
const Comma = createToken({ name: 'Comma', pattern: /,/ });
const Colon = createToken({ name: 'Colon', pattern: /:/ });
const Dot = createToken({ name: 'Dot', pattern: /\./ });
const Star = createToken({ name: 'Star', pattern: /\*/ });
const DollarIdentifier = createToken({
  name: 'DollarIdentifier',
  pattern: /\$[A-Za-z_][A-Za-z0-9_]*/,
});
const Identifier = createToken({ name: 'Identifier', pattern: /[A-Za-z_][A-Za-z0-9_]*/ });

const tokenTypes = [
  WhiteSpace,
  StringLiteral,
  NumberLiteral,
  Plus,
  Minus,
  GreaterEqual,
  LessEqual,
  NotEqual,
  Equal,
  Greater,
  Less,
  Slash,
  Percent,
  LParen,
  RParen,
  LBracket,
  RBracket,
  LBrace,
  RBrace,
  Comma,
  Colon,
  Dot,
  Star,
  DollarIdentifier,
  Identifier,
];

const lexer = new Lexer(tokenTypes);

export function parseExpression(
  source: string,
  line: number,
  columnOffset = 1,
): { readonly diagnostics: readonly FdqlDiagnostic[]; readonly expression?: FdqlExpression; } {
  const lexed = lexer.tokenize(source);
  if (lexed.errors.length) {
    return {
      diagnostics: lexed.errors.map((error) => ({
        code: 'FDQL_PARSE_ERROR',
        column: shiftColumn(error.column, columnOffset),
        line,
        message: error.message,
        severity: 'error' as const,
      })),
    };
  }
  const parser = createExpressionParser(lexed.tokens, line, columnOffset);
  const expression = parser.parse();
  return { diagnostics: parser.diagnostics, ...(expression ? { expression } : {}) };
}

export function splitTopLevel(source: string, delimiter = ','): readonly string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: QuoteChar = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    quote = nextQuote(quote, source, index);
    if (quote) continue;
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === delimiter && depth === 0) {
      const part = source.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

export function findTopLevelAs(source: string): number {
  let depth = 0;
  let quote: QuoteChar = null;
  for (let index = 0; index < source.length - 3; index += 1) {
    const char = source[index] ?? '';
    quote = nextQuote(quote, source, index);
    if (quote) continue;
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (
      depth === 0
      && /\s/i.test(char)
      && source.slice(index + 1, index + 3).toLowerCase() === 'as'
      && /\s/i.test(source[index + 3] ?? '')
    ) {
      return index;
    }
  }
  return -1;
}

interface ExpressionParser {
  readonly diagnostics: readonly FdqlDiagnostic[];
  parse(): FdqlExpression | undefined;
}

function createExpressionParser(
  tokens: readonly IToken[],
  line: number,
  columnOffset: number,
): ExpressionParser {
  let index = 0;
  const diagnostics: FdqlDiagnostic[] = [];

  function parse(): FdqlExpression | undefined {
    const expression = parseOr();
    if (peek()) {
      fail(`Unexpected token ${peek()?.image ?? ''}.`, peek());
    }
    return expression;
  }

  function parseOr(): FdqlExpression | undefined {
    let left = parseAnd();
    while (matchIdentifier('or')) {
      const right = parseAnd();
      if (!left || !right) return left;
      left = binaryExpression(left, 'or', right);
    }
    return left;
  }

  function parseAnd(): FdqlExpression | undefined {
    let left = parseComparison();
    while (matchIdentifier('and')) {
      const right = parseComparison();
      if (!left || !right) return left;
      left = binaryExpression(left, 'and', right);
    }
    return left;
  }

  function parseComparison(): FdqlExpression | undefined {
    let left = parseAdditive();
    while (true) {
      const token = peek();
      if (isIdentifierToken(token, 'is')) {
        consume();
        const not = matchIdentifier('not');
        const kindToken = peek();
        const kind = isIdentifierToken(kindToken, 'null')
          ? 'null'
          : isIdentifierToken(kindToken, 'missing')
          ? 'missing'
          : null;
        if (!kind) {
          fail('Expected null or missing after is.', kindToken);
          return left;
        }
        consume();
        if (!left) return left;
        left = {
          expression: left,
          kind: 'postfix',
          operator: `is ${not ? 'not ' : ''}${kind}` as
            | 'is missing'
            | 'is not missing'
            | 'is not null'
            | 'is null',
          ...rangeProp(spanRange(left.range, tokenRange(kindToken))),
        };
        continue;
      }
      if (isIdentifierToken(token, 'not') && isIdentifierToken(peek(1), 'in')) {
        const notToken = consume();
        const inToken = consume();
        const right = parseAdditive();
        if (!left || !right) return left;
        left = binaryExpression(left, 'not in', right, tokenRange(notToken, inToken));
        continue;
      }
      const operator = comparisonOperator(token);
      if (!token || !operator) break;
      consume();
      const right = parseAdditive();
      if (!left || !right) return left;
      left = binaryExpression(left, operator, right);
    }
    return left;
  }

  function parseAdditive(): FdqlExpression | undefined {
    let left = parseMultiplicative();
    while (true) {
      const token = peek();
      const operator = isToken(token, Plus) ? '+' : isToken(token, Minus) ? '-' : null;
      if (!token || !operator) break;
      consume();
      const right = parseMultiplicative();
      if (!left || !right) return left;
      left = binaryExpression(left, operator, right);
    }
    return left;
  }

  function parseMultiplicative(): FdqlExpression | undefined {
    let left = parseUnary();
    while (true) {
      const token = peek();
      const operator = isToken(token, Star)
        ? '*'
        : isToken(token, Slash)
        ? '/'
        : isToken(token, Percent)
        ? '%'
        : null;
      if (!token || !operator) break;
      consume();
      const right = parseUnary();
      if (!left || !right) return left;
      left = binaryExpression(left, operator, right);
    }
    return left;
  }

  function parseUnary(): FdqlExpression | undefined {
    const token = peek();
    if (token && isToken(token, Identifier) && token.image.toLowerCase() === 'not') {
      consume();
      const expression = parseUnary() ?? literalExpression(null);
      return {
        expression,
        kind: 'unary',
        operator: 'not',
        ...rangeProp(spanRange(tokenRange(token), expression.range)),
      };
    }
    if (token && isToken(token, Minus)) {
      consume();
      const expression = parseUnary() ?? literalExpression(null);
      return {
        expression,
        kind: 'unary',
        operator: 'negate',
        ...rangeProp(spanRange(tokenRange(token), expression.range)),
      };
    }
    return parsePrimary();
  }

  function parsePrimary(): FdqlExpression | undefined {
    const token = peek();
    if (!token) {
      fail('Expected expression.');
      return undefined;
    }
    if (isToken(token, NumberLiteral)) {
      consume();
      return literalExpression(Number(token.image), tokenRange(token));
    }
    if (isToken(token, StringLiteral)) {
      consume();
      return literalExpression(parseStringToken(token.image), tokenRange(token));
    }
    if (isToken(token, DollarIdentifier)) {
      consume();
      return { kind: 'alias', name: token.image, ...rangeProp(tokenRange(token)) };
    }
    if (isIdentifierToken(token, 'true')) {
      consume();
      return literalExpression(true, tokenRange(token));
    }
    if (isIdentifierToken(token, 'false')) {
      consume();
      return literalExpression(false, tokenRange(token));
    }
    if (isIdentifierToken(token, 'null')) {
      consume();
      return literalExpression(null, tokenRange(token));
    }
    if (isIdentifierToken(token, 'case')) return parseCase();
    if (isToken(token, LParen)) return parseParenthesized();
    if (isToken(token, LBracket)) return parseArray();
    if (isToken(token, LBrace)) return parseMap();
    if (isToken(token, Star)) {
      consume();
      return { kind: 'wildcard', ...rangeProp(tokenRange(token)) };
    }
    if (isToken(token, Identifier)) return parseIdentifierExpression();
    fail(`Unexpected token ${token.image}.`, token);
    consume();
    return undefined;
  }

  function parseCase(): FdqlExpression {
    const start = consumeExpected(Identifier);
    const branches: FdqlCaseBranch[] = [];
    while (matchIdentifier('when')) {
      const condition = parseOr() ?? literalExpression(null);
      consumeExpectedIdentifier('then');
      const value = parseOr() ?? literalExpression(null);
      branches.push({ condition, value });
    }
    let elseExpression: FdqlExpression | undefined;
    if (matchIdentifier('else')) {
      elseExpression = parseOr() ?? literalExpression(null);
    }
    const end = consumeExpectedIdentifier('end');
    if (branches.length === 0) {
      fail('Case expression needs at least one when branch.', start);
    }
    return {
      branches,
      ...(elseExpression ? { elseExpression } : {}),
      kind: 'case',
      ...rangeProp(tokenRange(start, end)),
    };
  }

  function parseParenthesized(): FdqlExpression | undefined {
    const start = consumeExpected(LParen);
    const items: FdqlExpression[] = [];
    if (!isToken(peek(), RParen)) {
      do {
        const item = parseOr();
        if (item) items.push(item);
      } while (match(Comma));
    }
    const end = consumeExpected(RParen);
    if (items.length === 1) return items[0];
    return { items, kind: 'array', ...rangeProp(tokenRange(start, end)) };
  }

  function parseArray(): FdqlArrayExpression {
    const start = consumeExpected(LBracket);
    const items: FdqlExpression[] = [];
    if (!isToken(peek(), RBracket)) {
      do {
        const item = parseOr();
        if (item) items.push(item);
      } while (match(Comma));
    }
    const end = consumeExpected(RBracket);
    return { items, kind: 'array', ...rangeProp(tokenRange(start, end)) };
  }

  function parseMap(): FdqlExpression {
    const start = consumeExpected(LBrace);
    const entries: FdqlMapEntry[] = [];
    if (!isToken(peek(), RBrace)) {
      do {
        const keyToken = consume();
        const key = keyToken && isToken(keyToken, StringLiteral)
          ? parseStringToken(keyToken.image)
          : keyToken?.image ?? '';
        consumeExpected(Colon);
        entries.push({ key, value: parseOr() ?? literalExpression(null) });
      } while (match(Comma));
    }
    const end = consumeExpected(RBrace);
    return { entries, kind: 'map', ...rangeProp(tokenRange(start, end)) };
  }

  function parseIdentifierExpression(): FdqlExpression {
    const start = consume();
    let end = start;
    let nameEnd = start;
    const parts = [start?.image ?? ''];
    let args: FdqlExpression[] | null = null;
    if (match(LParen)) {
      const parsedArgs = parseCallArgs();
      args = parsedArgs.args;
      end = parsedArgs.endToken ?? end;
    }
    while (match(Dot)) {
      const next = consumeExpected(Identifier);
      end = next ?? end;
      nameEnd = next ?? nameEnd;
      parts.push(next?.image ?? '');
      if (match(LParen)) {
        const parsedArgs = parseCallArgs();
        args = [...(args ?? []), ...parsedArgs.args];
        end = parsedArgs.endToken ?? end;
      }
    }
    if (args) {
      return {
        args,
        kind: 'call',
        name: parts.join('.'),
        ...rangeProp(tokenRange(start, end)),
        ...(tokenRange(start, nameEnd) ? { nameRange: tokenRange(start, nameEnd) } : {}),
      };
    }
    return { kind: 'field', path: parts, ...rangeProp(tokenRange(start, end)) };
  }

  function parseCallArgs(): {
    readonly args: FdqlExpression[];
    readonly endToken?: IToken | undefined;
  } {
    const args: FdqlExpression[] = [];
    if (!isToken(peek(), RParen)) {
      do {
        const arg = parseOr();
        if (arg) args.push(arg);
      } while (match(Comma));
    }
    const endToken = consumeExpected(RParen);
    return { args, ...(endToken ? { endToken } : {}) };
  }

  function comparisonOperator(token: IToken | undefined): FdqlBinaryExpression['operator'] | null {
    if (!token) return null;
    if (isToken(token, Equal)) return '=';
    if (isToken(token, NotEqual)) return '!=';
    if (isToken(token, Less)) return '<';
    if (isToken(token, LessEqual)) return '<=';
    if (isToken(token, Greater)) return '>';
    if (isToken(token, GreaterEqual)) return '>=';
    if (token.image.toLowerCase() === 'in') return 'in';
    return null;
  }

  function match(tokenType: TokenType): boolean {
    if (!isToken(peek(), tokenType)) return false;
    index += 1;
    return true;
  }

  function matchIdentifier(value: string): boolean {
    const token = peek();
    if (!isIdentifierToken(token, value)) return false;
    index += 1;
    return true;
  }

  function consumeExpected(tokenType: TokenType): IToken | undefined {
    const token = peek();
    if (isToken(token, tokenType)) return consume();
    fail(`Expected ${tokenType.name}.`, token);
    return undefined;
  }

  function consumeExpectedIdentifier(value: string): IToken | undefined {
    const token = peek();
    if (isIdentifierToken(token, value)) return consume();
    fail(`Expected ${value}.`, token);
    return undefined;
  }

  function consume(): IToken | undefined {
    const token = peek();
    index += 1;
    return token;
  }

  function peek(offset = 0): IToken | undefined {
    return tokens[index + offset];
  }

  function fail(message: string, token?: IToken): void {
    diagnostics.push({
      code: 'FDQL_PARSE_ERROR',
      column: shiftColumn(token?.startColumn, columnOffset),
      line,
      message,
      severity: 'error',
    });
  }

  function tokenRange(
    start: IToken | undefined,
    end: IToken | undefined = start,
  ): FdqlSourceRange | undefined {
    if (!start) return undefined;
    return {
      endColumn: (shiftColumn(end?.endColumn ?? start.endColumn, columnOffset) ?? 0) + 1,
      endLine: line,
      startColumn: shiftColumn(start.startColumn, columnOffset) ?? 0,
      startLine: line,
    };
  }

  return { diagnostics, parse };
}

function shiftColumn(column: number | undefined, columnOffset: number): number | undefined {
  return column === undefined ? undefined : column + columnOffset - 1;
}

function binaryExpression(
  left: FdqlExpression,
  operator: FdqlBinaryExpression['operator'],
  right: FdqlExpression,
  operatorRange?: FdqlSourceRange | undefined,
): FdqlBinaryExpression {
  return {
    kind: 'binary',
    left,
    operator,
    ...rangeProp(spanRange(spanRange(left.range, operatorRange), right.range)),
    right,
  };
}

function literalExpression(
  value: null | boolean | number | string,
  range?: FdqlSourceRange | undefined,
): FdqlExpression {
  return { kind: 'literal', ...rangeProp(range), value };
}

function isToken(token: IToken | undefined, tokenType: TokenType): boolean {
  return token?.tokenType === tokenType;
}

function isIdentifierToken(token: IToken | undefined, value: string): boolean {
  return Boolean(token && isToken(token, Identifier) && token.image.toLowerCase() === value);
}

function rangeProp(range: FdqlSourceRange | undefined): { readonly range?: FdqlSourceRange; } {
  return range ? { range } : {};
}

function spanRange(
  left: FdqlSourceRange | undefined,
  right: FdqlSourceRange | undefined,
): FdqlSourceRange | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    endColumn: right.endColumn,
    endLine: right.endLine,
    startColumn: left.startColumn,
    startLine: left.startLine,
  };
}

function parseStringToken(image: string): string {
  if (image.startsWith('"')) return JSON.parse(image) as string;
  const jsonSafe = `"${image.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return JSON.parse(jsonSafe) as string;
}

type QuoteChar = '"' | "'" | null;

function nextQuote(quote: QuoteChar, source: string, index: number): QuoteChar {
  const char = source[index];
  if ((char !== '"' && char !== "'") || isEscaped(source, index)) return quote;
  if (quote === char) return null;
  return quote ?? char;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
