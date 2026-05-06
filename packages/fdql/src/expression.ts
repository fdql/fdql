import { createToken, type IToken, Lexer, type TokenType } from 'chevrotain';
import type {
  FdqlArrayExpression,
  FdqlBinaryExpression,
  FdqlDiagnostic,
  FdqlExpression,
  FdqlMapEntry,
} from './types.ts';

const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /\s+/, group: Lexer.SKIPPED });
const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
});
const NumberLiteral = createToken({ name: 'NumberLiteral', pattern: /-?(?:0|[1-9]\d*)(?:\.\d+)?/ });
const GreaterEqual = createToken({ name: 'GreaterEqual', pattern: />=/ });
const LessEqual = createToken({ name: 'LessEqual', pattern: /<=/ });
const NotEqual = createToken({ name: 'NotEqual', pattern: /!=|<>/ });
const Equal = createToken({ name: 'Equal', pattern: /=/ });
const Greater = createToken({ name: 'Greater', pattern: />/ });
const Less = createToken({ name: 'Less', pattern: /</ });
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
  GreaterEqual,
  LessEqual,
  NotEqual,
  Equal,
  Greater,
  Less,
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
): { readonly diagnostics: readonly FdqlDiagnostic[]; readonly expression?: FdqlExpression; } {
  const lexed = lexer.tokenize(source);
  if (lexed.errors.length) {
    return {
      diagnostics: lexed.errors.map((error) => ({
        code: 'FDQL_PARSE_ERROR',
        column: error.column,
        line,
        message: error.message,
        severity: 'error' as const,
      })),
    };
  }
  const parser = createExpressionParser(lexed.tokens, line);
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

function createExpressionParser(tokens: readonly IToken[], line: number): ExpressionParser {
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
    let left = parseUnary();
    while (true) {
      const token = peek();
      const operator = comparisonOperator(token);
      if (!token || !operator) break;
      consume();
      const right = parseUnary();
      if (!left || !right) return left;
      left = binaryExpression(left, operator, right);
    }
    return left;
  }

  function parseUnary(): FdqlExpression | undefined {
    if (matchIdentifier('not')) {
      return {
        expression: parseUnary() ?? literalExpression(null),
        kind: 'unary',
        operator: 'not',
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
      return literalExpression(Number(token.image));
    }
    if (isToken(token, StringLiteral)) {
      consume();
      return literalExpression(parseStringToken(token.image));
    }
    if (isToken(token, DollarIdentifier)) {
      consume();
      return { kind: 'alias', name: token.image };
    }
    if (matchIdentifier('true')) return literalExpression(true);
    if (matchIdentifier('false')) return literalExpression(false);
    if (matchIdentifier('null')) return literalExpression(null);
    if (isToken(token, LParen)) return parseParenthesized();
    if (isToken(token, LBracket)) return parseArray();
    if (isToken(token, LBrace)) return parseMap();
    if (isToken(token, Star)) {
      consume();
      return { kind: 'wildcard' };
    }
    if (isToken(token, Identifier)) return parseIdentifierExpression();
    fail(`Unexpected token ${token.image}.`, token);
    consume();
    return undefined;
  }

  function parseParenthesized(): FdqlExpression | undefined {
    consumeExpected(LParen);
    const items: FdqlExpression[] = [];
    if (!isToken(peek(), RParen)) {
      do {
        const item = parseOr();
        if (item) items.push(item);
      } while (match(Comma));
    }
    consumeExpected(RParen);
    if (items.length === 1) return items[0];
    return { items, kind: 'array' };
  }

  function parseArray(): FdqlArrayExpression {
    consumeExpected(LBracket);
    const items: FdqlExpression[] = [];
    if (!isToken(peek(), RBracket)) {
      do {
        const item = parseOr();
        if (item) items.push(item);
      } while (match(Comma));
    }
    consumeExpected(RBracket);
    return { items, kind: 'array' };
  }

  function parseMap(): FdqlExpression {
    consumeExpected(LBrace);
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
    consumeExpected(RBrace);
    return { entries, kind: 'map' };
  }

  function parseIdentifierExpression(): FdqlExpression {
    const parts = [consume()?.image ?? ''];
    let args: FdqlExpression[] | null = null;
    if (match(LParen)) args = parseCallArgs();
    while (match(Dot)) {
      const next = consumeExpected(Identifier);
      parts.push(next?.image ?? '');
      if (match(LParen)) {
        args = [...(args ?? []), ...parseCallArgs()];
      }
    }
    if (args) return { args, kind: 'call', name: parts.join('.') };
    return { kind: 'field', path: parts };
  }

  function parseCallArgs(): FdqlExpression[] {
    const args: FdqlExpression[] = [];
    if (!isToken(peek(), RParen)) {
      do {
        const arg = parseOr();
        if (arg) args.push(arg);
      } while (match(Comma));
    }
    consumeExpected(RParen);
    return args;
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
    if (!token || !isToken(token, Identifier) || token.image.toLowerCase() !== value) return false;
    index += 1;
    return true;
  }

  function consumeExpected(tokenType: TokenType): IToken | undefined {
    const token = peek();
    if (isToken(token, tokenType)) return consume();
    fail(`Expected ${tokenType.name}.`, token);
    return undefined;
  }

  function consume(): IToken | undefined {
    const token = peek();
    index += 1;
    return token;
  }

  function peek(): IToken | undefined {
    return tokens[index];
  }

  function fail(message: string, token?: IToken): void {
    diagnostics.push({
      code: 'FDQL_PARSE_ERROR',
      column: token?.startColumn,
      line,
      message,
      severity: 'error',
    });
  }

  return { diagnostics, parse };
}

function binaryExpression(
  left: FdqlExpression,
  operator: FdqlBinaryExpression['operator'],
  right: FdqlExpression,
): FdqlBinaryExpression {
  return { kind: 'binary', left, operator, right };
}

function literalExpression(value: null | boolean | number | string): FdqlExpression {
  return { kind: 'literal', value };
}

function isToken(token: IToken | undefined, tokenType: TokenType): boolean {
  return token?.tokenType === tokenType;
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
