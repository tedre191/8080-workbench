// A two-pass assembler for Intel 8080 assembly.
//
//   label:  MVI  A, 'x'      ; comment
//   COUNT   EQU  10          ; a constant (also written COUNT = 10)
//           ORG  100h        ; assemble from 0100h
//           DB   "Hi", 13, 10, 0
//           DW   label, $+4  ; $ is the current address
//           DS   16          ; reserve 16 bytes
//
// Everything is case-insensitive. Numbers can be written 42, 2Ah, 0x2A, $2A,
// 101010b or 52o. Expressions support + - * / % & | ^ ~ << >>, comparisons,
// HIGH, LOW and parentheses. DEFB, BYTE, DEFW, WORD and DEFS are accepted as
// other names for DB, DW and DS, and directives may start with a dot.
//
// Pass 1 works out each line's address and size and defines labels. Pass 2
// evaluates operands, now that every label is known, and produces the bytes.

import { OPCODES, type OpcodeInfo } from '../opcodes';
import { evaluate, UndefinedSymbol, type EvalContext } from './expr';
import { AsmError, lex, type Token } from './lexer';

export interface AssemblerError {
  line: number; // 1-based
  column?: number; // 0-based
  message: string;
}

// A run of consecutive bytes in the output.
export interface Segment {
  address: number;
  bytes: Uint8Array;
}

export interface ListingLine {
  line: number;
  address: number;
  bytes: number[];
  source: string;
}

export interface AssembleResult {
  ok: boolean;
  errors: AssemblerError[];
  segments: Segment[];
  symbols: Map<string, number>; // every label and constant, by name
  labels: Map<number, string>; // address labels by address, for disassembly
  listing: ListingLine[]; // the address and bytes of each line
  addressToLine: Map<number, number>; // where each instruction came from
  entry: number; // from `END start`, or else the first byte of output
}

export function assemble(source: string): AssembleResult {
  const assembly = new Assembly(source);
  assembly.layOut();
  assembly.resolveForwardConstants();
  assembly.generate();
  return assembly.result();
}

const REGISTERS = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L', 'M', 'SP', 'PSW']);
const DIRECTIVES = new Set(['ORG', 'EQU', 'SET', 'DB', 'DW', 'DS', 'END']);
const ALIASES: Record<string, string> = {
  DEFB: 'DB',
  BYTE: 'DB',
  DEFW: 'DW',
  WORD: 'DW',
  DEFS: 'DS',
};

// The documented opcodes for each mnemonic, e.g. MOV has 63.
const OPCODES_BY_NAME = new Map<string, OpcodeInfo[]>();
for (const opcode of OPCODES) {
  if (opcode.undocumented) continue;
  const list = OPCODES_BY_NAME.get(opcode.mnemonic) ?? [];
  list.push(opcode);
  OPCODES_BY_NAME.set(opcode.mnemonic, list);
}

// `.org` and `defb` become ORG and DB.
function canonicalName(name: string) {
  const upper = name.toUpperCase().replace(/^\./, '');
  return ALIASES[upper] ?? upper;
}

function isKeyword(name: string) {
  const canonical = canonicalName(name);
  return OPCODES_BY_NAME.has(canonical) || DIRECTIVES.has(canonical);
}

// One line of source.
interface Statement {
  line: number;
  source: string;
  label?: Token;
  operation?: string; // the instruction or directive, e.g. MVI or ORG
  operationToken?: Token;
  operands: Token[][]; // one token list per comma-separated operand
  // Worked out in pass 1:
  address: number;
  size: number;
  opcode?: OpcodeInfo;
  failed?: boolean; // an error was already reported
}

class Assembly {
  private statements: Statement[];
  private errors: AssemblerError[] = [];
  private symbols = new Map<string, number>(); // by upper-case name
  private symbolNames = new Map<string, string>(); // upper-case name -> name as written
  private labelNames = new Set<string>(); // upper-case names that are labels, not constants
  private forwardConstants: Statement[] = []; // EQUs that use symbols defined further down
  private firstOutputAddress: number | undefined;
  private entry: number | undefined;
  private segments: { address: number; bytes: number[] }[] = [];
  private used = new Uint8Array(0x10000); // addresses already written, to catch overlaps
  private listing: ListingLine[] = [];
  private addressToLine = new Map<number, number>();

  constructor(source: string) {
    this.statements = source.split('\n').map((text, index) => {
      const line = index + 1;
      try {
        return parseLine(text, line);
      } catch (error) {
        const statement: Statement = { line, source: text, operands: [], address: 0, size: 0 };
        this.fail(statement, error);
        return statement;
      }
    });
  }

  // Pass 1: give every line an address and a size, and define the labels.
  layOut() {
    let address = 0;
    for (const statement of this.statements) {
      if (statement.failed) continue;
      const { operation } = statement;
      try {
        if (operation === 'EQU' || operation === 'SET') {
          this.defineConstant(statement, address);
          continue;
        }
        if (operation === 'ORG') {
          address = evaluate(statement.operands.flat(), this.contextAt(address)) & 0xffff;
        }
        statement.address = address;
        if (statement.label) this.defineLabel(statement.label, address);
        if (operation === 'END') break;

        statement.size = this.sizeOf(statement);
        if (statement.size > 0 && operation !== 'DS') this.firstOutputAddress ??= address;
        address = (address + statement.size) & 0xffff;
      } catch (error) {
        const tooEarly =
          error instanceof UndefinedSymbol && (operation === 'ORG' || operation === 'DS');
        this.fail(
          statement,
          error,
          tooEarly ? ` (${operation} operands must be defined earlier)` : '',
        );
      }
    }
  }

  private sizeOf(statement: Statement) {
    const { operation, operands } = statement;
    switch (operation) {
      case undefined:
      case 'ORG':
        return 0;
      case 'DS': {
        const size = evaluate(operands[0] ?? [], this.contextAt(statement.address));
        if (size < 0) throw new AsmError('DS size must not be negative');
        return size;
      }
      case 'DB':
        // A string adds one byte per character; anything else is one byte.
        return operands.reduce(
          (size, operand) => size + (isString(operand) ? operand[0].text.length : 1),
          0,
        );
      case 'DW':
        return operands.length * 2;
      default:
        statement.opcode = findOpcode(statement);
        return statement.opcode.length;
    }
  }

  private defineConstant(statement: Statement, address: number) {
    const { label, operation, operands } = statement;
    if (!label) throw new AsmError(`${operation} needs a name`, statement.operationToken?.col);
    statement.address = address;
    try {
      this.define(label, evaluate(operands.flat(), this.contextAt(address)), operation === 'SET');
    } catch (error) {
      // An EQU may use a label defined further down; try again after pass 1.
      if (error instanceof UndefinedSymbol && operation === 'EQU') {
        this.forwardConstants.push(statement);
      } else {
        throw error;
      }
    }
  }

  // Constants can depend on each other, so keep going while any get resolved.
  resolveForwardConstants() {
    let progress = true;
    while (progress && this.forwardConstants.length > 0) {
      progress = false;
      for (const statement of [...this.forwardConstants]) {
        try {
          const value = evaluate(statement.operands.flat(), this.contextAt(statement.address));
          this.define(statement.label!, value);
        } catch (error) {
          if (error instanceof UndefinedSymbol) continue;
          this.fail(statement, error);
        }
        this.forwardConstants = this.forwardConstants.filter((s) => s !== statement);
        progress = true;
      }
    }
    // Whatever is left uses a symbol that's never defined: report it.
    for (const statement of this.forwardConstants) {
      try {
        evaluate(statement.operands.flat(), this.contextAt(statement.address));
      } catch (error) {
        this.fail(statement, error);
      }
    }
  }

  // Pass 2: evaluate the operands and produce the bytes.
  generate() {
    for (const statement of this.statements) {
      if (statement.failed) continue;
      if (statement.operation === 'END') {
        this.readEntryPoint(statement);
        break;
      }

      let bytes: number[] = [];
      try {
        // A SET symbol can change value further down, so give it each new
        // value again in order: lines after it see that one, not the last.
        if (statement.operation === 'SET') this.defineConstant(statement, statement.address);
        bytes = this.encode(statement);
        if (bytes.length > 0) this.emit(statement, bytes);
      } catch (error) {
        this.fail(statement, error);
      }
      if (statement.operation || statement.label) {
        this.listing.push({
          line: statement.line,
          address: statement.address,
          bytes,
          source: statement.source,
        });
      }
    }
  }

  private readEntryPoint(statement: Statement) {
    if (statement.operands.length === 0) return;
    try {
      this.entry = this.word(statement.operands[0], statement.address);
    } catch (error) {
      this.fail(statement, error);
    }
  }

  private encode(statement: Statement): number[] {
    const { operation, operands, address, opcode } = statement;
    switch (operation) {
      case 'DS': {
        if (!operands[1]) return []; // just reserves space
        return new Array<number>(statement.size).fill(this.byte(operands[1], address));
      }
      case 'DB':
        return operands.flatMap((operand) =>
          isString(operand)
            ? [...operand[0].text].map((ch) => ch.charCodeAt(0) & 0xff)
            : [this.byte(operand, address)],
        );
      case 'DW':
        return operands.flatMap((operand) => littleEndian(this.word(operand, address)));
      case 'RST': {
        const vector = evaluate(operands[0], this.contextAt(address));
        if (vector < 0 || vector > 7) {
          throw new AsmError('RST vector must be 0-7', operands[0][0]?.col);
        }
        return [0xc7 | (vector << 3)];
      }
    }
    if (!opcode) return []; // a label on its own, ORG, EQU...

    // At most one operand is a value (the rest are registers).
    const value = operands[opcode.operands.findIndex((operand) => !REGISTERS.has(operand))];
    if (opcode.length === 2) return [opcode.opcode, this.byte(value, address)];
    if (opcode.length === 3) return [opcode.opcode, ...littleEndian(this.word(value, address))];
    return [opcode.opcode];
  }

  private emit(statement: Statement, bytes: number[]) {
    const { address } = statement;
    for (let i = 0; i < bytes.length; i++) {
      const target = (address + i) & 0xffff;
      if (this.used[target]) {
        throw new AsmError(`output overlaps earlier code at ${target.toString(16).toUpperCase()}h`);
      }
      this.used[target] = 1;
    }

    // Continue the current segment if this follows on directly; otherwise start a new one.
    const last = this.segments.at(-1);
    if (last && last.address + last.bytes.length === address) last.bytes.push(...bytes);
    else this.segments.push({ address, bytes: [...bytes] });
    this.addressToLine.set(address, statement.line);
  }

  private byte(operand: Token[], address: number) {
    const value = evaluate(operand, this.contextAt(address));
    if (value < -128 || value > 255) {
      throw new AsmError(`value ${value} doesn't fit in a byte`, operand[0]?.col);
    }
    return value & 0xff;
  }

  private word(operand: Token[], address: number) {
    const value = evaluate(operand, this.contextAt(address));
    if (value < -32768 || value > 0xffff) {
      throw new AsmError(`value ${value} doesn't fit in 16 bits`, operand[0]?.col);
    }
    return value & 0xffff;
  }

  private contextAt(address: number): EvalContext {
    return { pc: address, lookup: (name) => this.symbols.get(name.toUpperCase()) };
  }

  private defineLabel(token: Token, address: number) {
    this.define(token, address);
    this.labelNames.add(token.text.toUpperCase());
  }

  private define(token: Token, value: number, redefinable = false) {
    const key = token.text.toUpperCase();
    if (REGISTERS.has(key) || isKeyword(key)) {
      throw new AsmError(`'${token.text}' is reserved and can't be used as a label`, token.col);
    }
    if (this.symbols.has(key) && !redefinable && this.symbols.get(key) !== value) {
      throw new AsmError(`symbol '${token.text}' already defined`, token.col);
    }
    this.symbols.set(key, value);
    this.symbolNames.set(key, token.text);
  }

  // Record an assembly error against a line. Anything else is a real bug, so rethrow it.
  private fail(statement: Statement, error: unknown, note = '') {
    if (!(error instanceof AsmError)) throw error;
    statement.failed = true;
    this.errors.push({ line: statement.line, column: error.col, message: error.message + note });
  }

  result(): AssembleResult {
    const symbols = new Map<string, number>();
    for (const [key, value] of this.symbols) symbols.set(this.symbolNames.get(key)!, value);

    const labels = new Map<number, string>();
    for (const key of this.labelNames) {
      const address = this.symbols.get(key)!;
      if (!labels.has(address)) labels.set(address, this.symbolNames.get(key)!);
    }

    this.errors.sort((a, b) => a.line - b.line);
    return {
      ok: this.errors.length === 0,
      errors: this.errors,
      segments: this.segments.map((s) => ({ address: s.address, bytes: Uint8Array.from(s.bytes) })),
      symbols,
      labels,
      listing: this.listing,
      addressToLine: this.addressToLine,
      entry: this.entry ?? this.firstOutputAddress ?? 0,
    };
  }
}

// Split a line into its label, operation and operands.
function parseLine(source: string, line: number): Statement {
  const tokens = lex(source);
  const statement: Statement = { line, source, operands: [], address: 0, size: 0 };
  const [first, second] = tokens;
  let next = 0;

  if (first?.kind === 'ident') {
    const colon = second?.kind === 'punct' && second.text === ':';
    const definesConstant =
      (second?.kind === 'ident' && ['EQU', 'SET'].includes(canonicalName(second.text))) ||
      (second?.kind === 'punct' && second.text === '=');
    // In column 0, a word that isn't an instruction is a label even without a colon.
    const labelWithoutColon = first.col === 0 && !isKeyword(first.text);

    if (colon) {
      statement.label = first;
      next = 2;
    } else if (definesConstant || labelWithoutColon) {
      statement.label = first;
      next = 1;
    }
  }

  const operation = tokens[next];
  if (!operation) return statement;
  if (operation.kind === 'punct' && operation.text === '=') statement.operation = 'EQU';
  else if (operation.kind === 'ident') statement.operation = canonicalName(operation.text);
  else throw new AsmError(`expected instruction, found '${operation.text}'`, operation.col);

  statement.operationToken = operation;
  statement.operands = splitOperands(tokens.slice(next + 1));
  return statement;
}

// Split on commas, except inside parentheses.
function splitOperands(tokens: Token[]) {
  const operands: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'punct' && token.text === '(') depth++;
    if (token.kind === 'punct' && token.text === ')') depth--;
    if (token.kind === 'punct' && token.text === ',' && depth === 0) {
      operands.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0 || operands.length > 0) operands.push(current);
  return operands;
}

// Pick the opcode whose operands match: MOV A,B and MOV A,M are different opcodes.
function findOpcode(statement: Statement): OpcodeInfo {
  const name = statement.operation!;
  const token = statement.operationToken!;
  const candidates = OPCODES_BY_NAME.get(name);
  if (!candidates) throw new AsmError(`unknown instruction '${token.text}'`, token.col);

  if (name === 'RST') {
    // The vector is a value, encoded in pass 2.
    if (statement.operands.length !== 1) {
      throw new AsmError('RST takes one operand (0-7)', token.col);
    }
    return candidates[0];
  }

  const match = candidates.find(
    (candidate) =>
      candidate.operands.length === statement.operands.length &&
      candidate.operands.every((expected, i) => {
        const given = registerIn(statement.operands[i]);
        // A register slot needs that register; a value slot needs something that isn't one.
        return REGISTERS.has(expected)
          ? given === expected
          : given === undefined && statement.operands[i].length > 0;
      }),
  );
  if (match) return match;

  const forms = [...new Set(candidates.map((candidate) => candidate.operands.join(',')))].slice(
    0,
    4,
  );
  const hint = forms[0] ? ` (expected e.g. ${name} ${forms.join(' | ')})` : ' (takes no operands)';
  throw new AsmError(`invalid operands for ${name}${hint}`, token.col);
}

// The register an operand names, if it's just a register.
function registerIn(operand: Token[]) {
  if (operand.length !== 1 || operand[0].kind !== 'ident') return undefined;
  const name = operand[0].text.toUpperCase();
  return REGISTERS.has(name) ? name : undefined;
}

function isString(operand: Token[]) {
  return operand.length === 1 && operand[0].kind === 'string';
}

function littleEndian(word: number) {
  return [word & 0xff, word >> 8];
}
