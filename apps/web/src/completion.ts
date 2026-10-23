// Autocomplete for 8080 assembly. Looks at the line up to the cursor to work
// out what's being typed (an instruction, or an operand of one) and suggests
// instructions, directives, the registers an instruction accepts, and the
// labels and constants defined in the program.

import { DIRECTIVE_DOCS, formatTiming, INSTRUCTION_DOCS, OPCODES } from '@i8080/core';

export type CompletionKind = 'instruction' | 'directive' | 'register' | 'symbol' | 'operator';

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  detail: string; // shown next to the label: syntax, value...
  doc?: string; // shown for the selected item
  insert: string;
}

export interface CompletionResult {
  // The text from `from` to `to` is replaced when an item is picked.
  from: number;
  to: number;
  prefix: string;
  items: CompletionItem[];
  registersOnly: boolean;
}

export interface SymbolInfo {
  name: string;
  kind: 'label' | 'constant';
  value?: number;
}

const NAME = '[A-Za-z_.?@][\\w.?@$]*'; // a label, constant or mnemonic
const WORD_BEFORE_CURSOR = new RegExp(`${NAME}$`);
const WORD_AFTER_CURSOR = /^[\w.?@$]*/;
const LABEL_WITH_COLON = new RegExp(`^\\s*(${NAME})\\s*:`);
const CONSTANT = new RegExp(`^\\s*(${NAME})\\s*(?:=|\\s(?:EQU|SET)\\b)`, 'i');
const WORD_IN_COLUMN_0 = new RegExp(`^(${NAME})`);
const WORD_AND_REST = new RegExp(`^(${NAME})\\s+(.*)$`);

const REGISTER_DOCS: Record<string, string> = {
  A: 'Accumulator',
  B: 'Register B (or pair BC)',
  C: 'Register C',
  D: 'Register D (or pair DE)',
  E: 'Register E',
  H: 'Register H (or pair HL)',
  L: 'Register L',
  M: 'Memory at the address in HL',
  SP: 'Stack pointer',
  PSW: 'A and the flags',
};
const isRegister = (operand: string) => operand in REGISTER_DOCS;

// The operand forms each instruction accepts, e.g. MOV: [B,C], [B,D], ... [A,A].
const OPERAND_FORMS = new Map<string, string[][]>();
for (const op of OPCODES) {
  if (op.undocumented) continue;
  const forms = OPERAND_FORMS.get(op.mnemonic) ?? [];
  forms.push([...op.operands]);
  OPERAND_FORMS.set(op.mnemonic, forms);
}
OPERAND_FORMS.set('RST', [['n']]); // its operand is a number 0-7

const KEYWORDS = new Set([
  ...OPERAND_FORMS.keys(),
  ...Object.keys(DIRECTIVE_DOCS),
  ...['HIGH', 'LOW', 'NOT', 'AND', 'OR', 'XOR', 'MOD', 'SHL', 'SHR'],
]);

const INSTRUCTIONS: CompletionItem[] = [...OPERAND_FORMS.keys()].sort().map((name) => {
  const doc = INSTRUCTION_DOCS[name];
  const takesOperands = OPERAND_FORMS.get(name)!.some((form) => form.length > 0);
  return {
    label: name,
    kind: 'instruction',
    detail: doc.syntax,
    doc: `${doc.summary}\nFlags: ${doc.flags}. ${formatTiming(name)} T-states.`,
    insert: takesOperands ? name + ' ' : name,
  };
});

const DIRECTIVES: CompletionItem[] = Object.entries(DIRECTIVE_DOCS).map(([name, doc]) => ({
  label: name,
  kind: 'directive',
  detail: doc.syntax,
  doc: doc.summary,
  insert: name === 'END' ? name : name + ' ',
}));

const OPERATORS: CompletionItem[] = [
  {
    label: 'HIGH',
    kind: 'operator',
    detail: 'HIGH expr',
    doc: 'The high byte of a 16-bit value.',
    insert: 'HIGH ',
  },
  {
    label: 'LOW',
    kind: 'operator',
    detail: 'LOW expr',
    doc: 'The low byte of a 16-bit value.',
    insert: 'LOW ',
  },
];

// Labels and constants defined in the source, with values from the last
// successful assembly if available.
export function scanSymbols(source: string, values?: ReadonlyMap<string, number>): SymbolInfo[] {
  const found = new Map<string, SymbolInfo>();
  const add = (name: string, kind: SymbolInfo['kind']) =>
    found.set(name.toUpperCase(), { name, kind });

  for (const fullLine of source.split('\n')) {
    const line = fullLine.replace(/;.*/, '');
    const label = LABEL_WITH_COLON.exec(line);
    const constant = CONSTANT.exec(line);
    const firstWord = WORD_IN_COLUMN_0.exec(line);
    if (label) add(label[1], 'label');
    else if (constant) add(constant[1], 'constant');
    else if (firstWord && !KEYWORDS.has(firstWord[1].toUpperCase())) add(firstWord[1], 'label');
  }

  if (values) {
    for (const [name, value] of values) {
      const symbol = found.get(name.toUpperCase());
      if (symbol) symbol.value = value;
    }
  }
  return [...found.values()];
}

// What the cursor is in: the instruction name, or operand number `index`
// of `mnemonic` (with `typed` the operands before it).
type Position =
  | { at: 'mnemonic'; allowEqu: boolean }
  | { at: 'operand'; mnemonic: string; index: number; typed: string[]; lowercase: boolean };

function findPosition(lineBeforeWord: string): Position | null {
  // "label:" at the start changes nothing, so blank it out.
  const line = lineBeforeWord.replace(LABEL_WITH_COLON, (label) => ' '.repeat(label.length));
  if (line.trim() === '') return { at: 'mnemonic', allowEqu: false };

  const startsInColumn0 = !/^\s/.test(line);
  const match = WORD_AND_REST.exec(line.trimStart());
  if (!match) return null;
  const [, first, rest] = match;

  if (
    KEYWORDS.has(first.toUpperCase()) &&
    first.toUpperCase() !== 'HIGH' &&
    first.toUpperCase() !== 'LOW'
  ) {
    return operandPosition(first, rest);
  }

  // A word in column 0 that isn't an instruction is a label without a colon,
  // or a constant's name. What follows is the instruction, or EQU.
  if (!startsInColumn0) return null;
  if (rest === '') return { at: 'mnemonic', allowEqu: true };
  const next = WORD_AND_REST.exec(rest);
  return next ? operandPosition(next[1], next[2]) : null;
}

function operandPosition(mnemonic: string, operands: string): Position {
  return {
    at: 'operand',
    mnemonic: mnemonic.toUpperCase(),
    index: countTopLevelCommas(operands),
    typed: operands.split(',').map((operand) => operand.trim().toUpperCase()),
    lowercase: mnemonic === mnemonic.toLowerCase(),
  };
}

function countTopLevelCommas(text: string) {
  let commas = 0;
  let depth = 0;
  let quote = '';
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) commas++;
  }
  return commas;
}

function inCommentOrString(line: string) {
  let quote = '';
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ';') return true;
  }
  return quote !== '';
}

// Suggestions for an operand: the registers that fit, and/or values.
function operandItems(position: Extract<Position, { at: 'operand' }>, symbols: SymbolInfo[]) {
  const forms = OPERAND_FORMS.get(position.mnemonic);
  if (!forms) return { items: valueItems(symbols), registersOnly: false }; // a directive

  // Keep the forms that match the registers typed so far (any value fits a value slot).
  const { index, typed } = position;
  const possible = forms.filter(
    (form) =>
      form.length > index &&
      typed.slice(0, index).every((t, i) => !isRegister(form[i]) || form[i] === t),
  );

  const registers = new Set<string>();
  let takesValue = false;
  for (const form of possible) {
    if (isRegister(form[index])) registers.add(form[index]);
    else takesValue = true;
  }

  const items: CompletionItem[] = [...registers].map((name) => ({
    label: name,
    kind: 'register',
    detail: 'register',
    doc: REGISTER_DOCS[name],
    insert: name,
  }));
  if (takesValue) items.push(...valueItems(symbols));
  return { items, registersOnly: registers.size > 0 && !takesValue };
}

function valueItems(symbols: SymbolInfo[]): CompletionItem[] {
  const symbolItems = symbols.map((symbol): CompletionItem => ({
    label: symbol.name,
    kind: 'symbol',
    detail: symbol.value !== undefined ? `= ${hex(symbol.value)}` : symbol.kind,
    doc:
      symbol.kind === 'label'
        ? 'Label defined in this program.'
        : 'Constant defined in this program.',
    insert: symbol.name,
  }));
  return [...symbolItems, ...OPERATORS];
}

// Items starting with the prefix first, then items containing it.
function filterByPrefix(items: CompletionItem[], prefix: string) {
  const p = prefix.toUpperCase();
  const startsWith = items.filter((item) => item.label.toUpperCase().startsWith(p));
  const contains = items.filter(
    (item) => !item.label.toUpperCase().startsWith(p) && item.label.toUpperCase().includes(p),
  );
  return [...startsWith, ...contains];
}

// Suggestions for the cursor position, or null if there's nothing to suggest.
// `explicit` means the user asked (Ctrl+Space) rather than just typing.
export function complete(
  source: string,
  cursor: number,
  symbols: SymbolInfo[],
  { explicit = false } = {},
): CompletionResult | null {
  const lineStart = source.lastIndexOf('\n', cursor - 1) + 1;
  const line = source.slice(lineStart, cursor);
  if (inCommentOrString(line)) return null;

  const prefix = WORD_BEFORE_CURSOR.exec(line)?.[0] ?? '';
  const lineBeforeWord = line.slice(0, line.length - prefix.length);
  if (/[0-9]$/.test(lineBeforeWord)) return null; // the letters of a number like 0FFh

  const position = findPosition(lineBeforeWord);
  if (!position) return null;

  let items: CompletionItem[];
  let registersOnly = false;
  if (position.at === 'mnemonic') {
    items = [...INSTRUCTIONS, ...DIRECTIVES];
    if (!position.allowEqu) {
      items = items.filter((item) => item.label !== 'EQU' && item.label !== 'SET');
    }
  } else {
    ({ items, registersOnly } = operandItems(position, symbols));
  }

  // Pop up unasked only while typing a word, or for a short list of registers.
  if (!prefix && !explicit && !registersOnly) return null;

  items = filterByPrefix(items, prefix);
  // Nothing to suggest if the only match is exactly what's already typed.
  if (items.length === 0) return null;
  if (items.length === 1 && items[0].insert.trim() === prefix && !explicit) return null;

  // Follow the case being typed: `mv` suggests `mvi`, and `lxi ` suggests `b`.
  const lowercase = prefix
    ? prefix === prefix.toLowerCase()
    : position.at === 'operand' && position.lowercase;
  if (lowercase) items = items.map(toLowercase);

  const to = cursor + WORD_AFTER_CURSOR.exec(source.slice(cursor))![0].length;
  return { from: cursor - prefix.length, to, prefix, items: items.slice(0, 50), registersOnly };
}

function toLowercase(item: CompletionItem): CompletionItem {
  if (item.kind === 'symbol') return item; // symbols keep the case they were defined with
  return { ...item, label: item.label.toLowerCase(), insert: item.insert.toLowerCase() };
}

function hex(value: number) {
  const digits = (value & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return (/^[A-F]/.test(digits) ? '0' : '') + digits + 'h';
}
