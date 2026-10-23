import { OPCODES } from '@i8080/core';
import type { ReactNode } from 'react';

const MNEMONICS = new Set(OPCODES.map((opcode) => opcode.mnemonic));
const DIRECTIVES = new Set([
  'ORG',
  'EQU',
  'SET',
  'DB',
  'DW',
  'DS',
  'END',
  'DEFB',
  'DEFW',
  'DEFS',
  'BYTE',
  'WORD',
]);
const REGISTERS = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L', 'M', 'SP', 'PSW']);

// One alternative per kind of token; the capture group says which matched.
const COMMENT = String.raw`(;.*$)`;
const STRING = String.raw`("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)`;
const NUMBER = String.raw`(\$[0-9A-Fa-f]+\b|0x[0-9A-Fa-f]+\b|\b[0-9][0-9A-Fa-f]*[HhBbOoQqDd]?\b)`;
const WORD = String.raw`([A-Za-z_.?@][\w.?@$]*)`;
const ANYTHING_ELSE = String.raw`(\s+|.)`;
const TOKEN = new RegExp([COMMENT, STRING, NUMBER, WORD, ANYTHING_ELSE].join('|'), 'g');

// Syntax-highlight one line of 8080 assembly.
export function highlightLine(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  for (const match of line.matchAll(TOKEN)) {
    const [text, comment, string, number, word] = match;
    let className: string | undefined;
    if (comment) className = 'tk-comment';
    else if (string) className = 'tk-string';
    else if (number) className = 'tk-number';
    else if (word) className = wordClass(word, line, match.index);

    parts.push(
      className ? (
        <span key={parts.length} className={className}>
          {text}
        </span>
      ) : (
        text
      ),
    );
  }
  return parts;
}

function wordClass(word: string, line: string, index: number) {
  const name = word.toUpperCase().replace(/^\./, '');
  if (line[index + word.length] === ':') return 'tk-label';
  if (MNEMONICS.has(name)) return 'tk-op';
  if (DIRECTIVES.has(name)) return 'tk-dir';
  if (REGISTERS.has(name)) return 'tk-reg';
  if (index === 0) return 'tk-label'; // a label without a colon
  return 'tk-sym';
}
