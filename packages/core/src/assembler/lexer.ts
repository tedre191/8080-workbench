export type TokenKind = 'ident' | 'number' | 'string' | 'punct' | 'dollar';

export interface Token {
  kind: TokenKind;
  // Source text (strings: the unquoted contents).
  text: string;
  // Numeric value for `number` tokens.
  value?: number;
  // 0-based column in the line.
  col: number;
}

export class AsmError extends Error {
  constructor(
    message: string,
    readonly col?: number,
  ) {
    super(message);
  }
}

const IDENT_START = /[A-Za-z_.?@]/;
const IDENT_PART = /[A-Za-z0-9_.?@$]/;
const PUNCT2 = ['<<', '>>', '==', '!=', '<=', '>='];
const PUNCT1 = '+-*/%&|^~(),:=<>!';
const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '0': '\0',
  '\\': '\\',
  "'": "'",
  '"': '"',
};

// Numbers: 42, 2Ah, 0x2A, $2A, 101010b, 52o (or 52q), 42d. Hex with an h
// suffix must start with a digit (0FFh), or it would read as a name.
function parseNumber(text: string) {
  const t = text.replace(/_/g, '').toLowerCase();
  if (t.startsWith('0x')) return parseDigits(t.slice(2), 16);
  if (t.startsWith('$')) return parseDigits(t.slice(1), 16);
  if (t.endsWith('h')) return parseDigits(t.slice(0, -1), 16);
  if (/^[01]+b$/.test(t)) return parseDigits(t.slice(0, -1), 2);
  if (t.endsWith('o') || t.endsWith('q')) return parseDigits(t.slice(0, -1), 8);
  if (t.endsWith('d')) return parseDigits(t.slice(0, -1), 10);
  return parseDigits(t, 10);
}

function parseDigits(digits: string, radix: number) {
  if (digits === '') return undefined;
  let value = 0;
  for (const ch of digits) {
    const digit = parseInt(ch, radix);
    if (Number.isNaN(digit)) return undefined;
    value = value * radix + digit;
  }
  return value;
}

// Split a line into tokens. A comment (from ; to the end) is dropped.
export function lex(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  // Advance past characters matching `pattern` and return them.
  const readWhile = (pattern: RegExp) => {
    const start = i;
    while (i < line.length && pattern.test(line[i])) i++;
    return line.slice(start, i);
  };

  while (i < line.length) {
    const ch = line[i];
    const col = i;
    if (ch === ';') break;

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
    } else if (ch === '"' || ch === "'") {
      const [text, end] = readString(line, i);
      tokens.push({ kind: 'string', text, col });
      i = end;
    } else if (/[0-9]/.test(ch) || (ch === '$' && /[0-9a-f]/i.test(line[i + 1] ?? ''))) {
      i++;
      const text = ch + readWhile(/[0-9A-Za-z_]/);
      const value = parseNumber(text);
      if (value === undefined) throw new AsmError(`invalid number '${text}'`, col);
      tokens.push({ kind: 'number', text, value, col });
    } else if (ch === '$') {
      tokens.push({ kind: 'dollar', text: '$', col });
      i++;
    } else if (IDENT_START.test(ch)) {
      i++;
      tokens.push({ kind: 'ident', text: ch + readWhile(IDENT_PART), col });
    } else if (PUNCT2.includes(line.slice(i, i + 2))) {
      tokens.push({ kind: 'punct', text: line.slice(i, i + 2), col });
      i += 2;
    } else if (PUNCT1.includes(ch)) {
      tokens.push({ kind: 'punct', text: ch, col });
      i++;
    } else {
      throw new AsmError(`unexpected character '${ch}'`, col);
    }
  }
  return tokens;
}

// Read a quoted string starting at `start`. Returns its text and the index
// after the closing quote. A doubled quote ('') stands for one quote, and
// backslash escapes like \n work too.
function readString(line: string, start: number): [string, number] {
  const quote = line[start];
  let text = '';
  let i = start + 1;
  for (;;) {
    if (i >= line.length) throw new AsmError('unterminated string', start);
    const ch = line[i];
    if (ch === quote && line[i + 1] === quote) {
      text += quote;
      i += 2;
    } else if (ch === quote) {
      return [text, i + 1];
    } else if (ch === '\\' && line[i + 1] in ESCAPES) {
      text += ESCAPES[line[i + 1]];
      i += 2;
    } else {
      // Each character becomes one byte, so it has to fit in one.
      const code = line.codePointAt(i)!;
      if (code > 0xff) {
        throw new AsmError(`character '${String.fromCodePoint(code)}' doesn't fit in a byte`, i);
      }
      text += ch;
      i++;
    }
  }
}
