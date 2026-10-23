import { AsmError, type Token } from './lexer';

// Thrown when an expression references a symbol that isn't defined (yet).
export class UndefinedSymbol extends AsmError {
  constructor(
    readonly symbol: string,
    col?: number,
  ) {
    super(`undefined symbol '${symbol}'`, col);
  }
}

export interface EvalContext {
  // Value of `$`.
  pc: number;
  lookup(name: string): number | undefined;
}

type Binary = (a: number, b: number) => number;

// Precedence levels, lowest first. Word operators are Intel-style.
const LEVELS: Record<string, Binary>[] = [
  { '|': (a, b) => a | b, OR: (a, b) => a | b, '^': (a, b) => a ^ b, XOR: (a, b) => a ^ b },
  { '&': (a, b) => a & b, AND: (a, b) => a & b },
  {
    '==': (a, b) => (a === b ? 1 : 0),
    EQ: (a, b) => (a === b ? 1 : 0),
    '!=': (a, b) => (a !== b ? 1 : 0),
    NE: (a, b) => (a !== b ? 1 : 0),
    '<': (a, b) => (a < b ? 1 : 0),
    LT: (a, b) => (a < b ? 1 : 0),
    '<=': (a, b) => (a <= b ? 1 : 0),
    LE: (a, b) => (a <= b ? 1 : 0),
    '>': (a, b) => (a > b ? 1 : 0),
    GT: (a, b) => (a > b ? 1 : 0),
    '>=': (a, b) => (a >= b ? 1 : 0),
    GE: (a, b) => (a >= b ? 1 : 0),
  },
  {
    '<<': (a, b) => a << b,
    SHL: (a, b) => a << b,
    '>>': (a, b) => a >>> b,
    SHR: (a, b) => a >>> b,
  },
  { '+': (a, b) => a + b, '-': (a, b) => a - b },
  {
    '*': (a, b) => a * b,
    '/': (a, b) => {
      if (b === 0) throw new AsmError('division by zero');
      return Math.trunc(a / b);
    },
    '%': (a, b) => {
      if (b === 0) throw new AsmError('division by zero');
      return a % b;
    },
    MOD: (a, b) => {
      if (b === 0) throw new AsmError('division by zero');
      return a % b;
    },
  },
];

// Evaluate a list of tokens as one expression, by recursive descent: each
// precedence level parses the level above it on either side of its operators.
export function evaluate(tokens: Token[], context: EvalContext): number {
  if (tokens.length === 0) throw new AsmError('missing expression');
  let next = 0; // index of the next token to read

  // The next token, if it could be an operator (symbols and words like AND).
  const peekOperator = () => {
    const token = tokens[next];
    if (token?.kind === 'punct') return token.text;
    if (token?.kind === 'ident') return token.text.toUpperCase();
    return undefined;
  };

  const parseLevel = (level: number): number => {
    if (level === LEVELS.length) return parseUnary();
    let left = parseLevel(level + 1);
    for (;;) {
      const operator = peekOperator();
      const apply = operator === undefined ? undefined : LEVELS[level][operator];
      if (!apply) return left;
      next++;
      left = apply(left, parseLevel(level + 1));
    }
  };

  const parseUnary = (): number => {
    const operator = peekOperator();
    switch (operator) {
      case '-':
        next++;
        return -parseUnary();
      case '+':
        next++;
        return parseUnary();
      case '~':
      case 'NOT':
        next++;
        return ~parseUnary();
      case '!':
        next++;
        return parseUnary() === 0 ? 1 : 0;
      case 'HIGH':
        next++;
        return (parseUnary() >> 8) & 0xff;
      case 'LOW':
        next++;
        return parseUnary() & 0xff;
    }
    return parseValue();
  };

  const parseValue = (): number => {
    const token = tokens[next++];
    if (!token) throw new AsmError('unexpected end of expression');
    switch (token.kind) {
      case 'number':
        return token.value!;
      case 'dollar':
        return context.pc;
      case 'string':
        return characterValue(token);
      case 'ident': {
        const value = context.lookup(token.text);
        if (value === undefined) throw new UndefinedSymbol(token.text, token.col);
        return value;
      }
      case 'punct':
        if (token.text === '(') {
          const value = parseLevel(0);
          const close = tokens[next++];
          if (close?.text !== ')') throw new AsmError("expected ')'", token.col);
          return value;
        }
    }
    throw new AsmError(`unexpected '${token.text}'`, token.col);
  };

  const value = parseLevel(0);
  const extra = tokens[next];
  if (extra) throw new AsmError(`unexpected '${extra.text}'`, extra.col);
  return value;
}

// 'A' is 41h; 'AB' is 4142h.
function characterValue(token: Token) {
  if (token.text.length === 0 || token.text.length > 2) {
    throw new AsmError('string in expression must be 1 or 2 characters', token.col);
  }
  let value = 0;
  for (const ch of token.text) value = (value << 8) | (ch.charCodeAt(0) & 0xff);
  return value;
}
