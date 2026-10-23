// Short reference documentation for every 8080 instruction and assembler
// directive, for editors (completion, hover help) and learning tools.
//
// Syntax placeholders: r = B C D E H L M A, rp = register pair,
// d8/d16 = immediate data, addr = 16-bit address, port = I/O port, n = 0-7.
import { CONDITIONS, OPCODES } from './opcodes';

export interface InstructionDoc {
  // e.g. `MVI r, d8`
  syntax: string;
  summary: string;
  // Flags affected, in plain words.
  flags: string;
}

const ALL = 'S Z AC P CY';

const CONDITION_TEXT: Record<(typeof CONDITIONS)[number], string> = {
  NZ: 'not zero (Z = 0)',
  Z: 'zero (Z = 1)',
  NC: 'no carry (CY = 0)',
  C: 'carry (CY = 1)',
  PO: 'parity odd (P = 0)',
  PE: 'parity even (P = 1)',
  P: 'plus (S = 0)',
  M: 'minus (S = 1)',
};

const docs: Record<string, InstructionDoc> = {
  MOV: {
    syntax: 'MOV r, r',
    summary: 'Copy a register (or memory at HL, as M) to another.',
    flags: 'none',
  },
  MVI: {
    syntax: 'MVI r, d8',
    summary: 'Load an 8-bit constant into a register or memory at HL.',
    flags: 'none',
  },
  LXI: {
    syntax: 'LXI rp, d16',
    summary: 'Load a 16-bit constant into BC, DE, HL or SP.',
    flags: 'none',
  },
  LDA: { syntax: 'LDA addr', summary: 'Load A from memory.', flags: 'none' },
  STA: { syntax: 'STA addr', summary: 'Store A to memory.', flags: 'none' },
  LHLD: { syntax: 'LHLD addr', summary: 'Load L from addr and H from addr+1.', flags: 'none' },
  SHLD: { syntax: 'SHLD addr', summary: 'Store L to addr and H to addr+1.', flags: 'none' },
  LDAX: { syntax: 'LDAX B|D', summary: 'Load A from the address in BC or DE.', flags: 'none' },
  STAX: { syntax: 'STAX B|D', summary: 'Store A to the address in BC or DE.', flags: 'none' },
  XCHG: { syntax: 'XCHG', summary: 'Swap DE and HL.', flags: 'none' },

  ADD: { syntax: 'ADD r', summary: 'A = A + r.', flags: ALL },
  ADI: { syntax: 'ADI d8', summary: 'A = A + d8.', flags: ALL },
  ADC: { syntax: 'ADC r', summary: 'A = A + r + carry.', flags: ALL },
  ACI: { syntax: 'ACI d8', summary: 'A = A + d8 + carry.', flags: ALL },
  SUB: { syntax: 'SUB r', summary: 'A = A − r.', flags: ALL },
  SUI: { syntax: 'SUI d8', summary: 'A = A − d8.', flags: ALL },
  SBB: { syntax: 'SBB r', summary: 'A = A − r − borrow.', flags: ALL },
  SBI: { syntax: 'SBI d8', summary: 'A = A − d8 − borrow.', flags: ALL },
  INR: {
    syntax: 'INR r',
    summary: 'Increment a register or memory at HL.',
    flags: 'S Z AC P (not CY)',
  },
  DCR: {
    syntax: 'DCR r',
    summary: 'Decrement a register or memory at HL.',
    flags: 'S Z AC P (not CY)',
  },
  INX: { syntax: 'INX rp', summary: 'Increment a register pair.', flags: 'none' },
  DCX: { syntax: 'DCX rp', summary: 'Decrement a register pair.', flags: 'none' },
  DAD: { syntax: 'DAD rp', summary: 'HL = HL + rp (16-bit add).', flags: 'CY only' },
  DAA: { syntax: 'DAA', summary: 'Adjust A to packed BCD after an addition.', flags: ALL },

  ANA: { syntax: 'ANA r', summary: 'A = A AND r.', flags: 'S Z AC P, CY cleared' },
  ANI: { syntax: 'ANI d8', summary: 'A = A AND d8.', flags: 'S Z AC P, CY cleared' },
  XRA: {
    syntax: 'XRA r',
    summary: 'A = A XOR r. XRA A is a quick way to clear A.',
    flags: 'S Z P, AC and CY cleared',
  },
  XRI: { syntax: 'XRI d8', summary: 'A = A XOR d8.', flags: 'S Z P, AC and CY cleared' },
  ORA: {
    syntax: 'ORA r',
    summary: 'A = A OR r. ORA A sets flags from A without changing it.',
    flags: 'S Z P, AC and CY cleared',
  },
  ORI: { syntax: 'ORI d8', summary: 'A = A OR d8.', flags: 'S Z P, AC and CY cleared' },
  CMP: {
    syntax: 'CMP r',
    summary: 'Compare A with r (subtract, discard result). Z if equal, CY if A < r.',
    flags: ALL,
  },
  CPI: { syntax: 'CPI d8', summary: 'Compare A with d8. Z if equal, CY if A < d8.', flags: ALL },

  RLC: { syntax: 'RLC', summary: 'Rotate A left; bit 7 goes to bit 0 and CY.', flags: 'CY only' },
  RRC: { syntax: 'RRC', summary: 'Rotate A right; bit 0 goes to bit 7 and CY.', flags: 'CY only' },
  RAL: { syntax: 'RAL', summary: 'Rotate A left through carry.', flags: 'CY only' },
  RAR: { syntax: 'RAR', summary: 'Rotate A right through carry.', flags: 'CY only' },
  CMA: { syntax: 'CMA', summary: 'Complement A (A = NOT A).', flags: 'none' },
  CMC: { syntax: 'CMC', summary: 'Complement the carry flag.', flags: 'CY only' },
  STC: { syntax: 'STC', summary: 'Set the carry flag.', flags: 'CY only' },

  JMP: { syntax: 'JMP addr', summary: 'Jump to addr.', flags: 'none' },
  CALL: {
    syntax: 'CALL addr',
    summary: 'Push the return address and jump to addr.',
    flags: 'none',
  },
  RET: { syntax: 'RET', summary: 'Return: pop the program counter.', flags: 'none' },
  RST: {
    syntax: 'RST n',
    summary: 'Call address n × 8. Interrupting devices usually supply this.',
    flags: 'none',
  },
  PCHL: { syntax: 'PCHL', summary: 'Jump to the address in HL.', flags: 'none' },

  PUSH: {
    syntax: 'PUSH B|D|H|PSW',
    summary: 'Push a register pair (PSW = A and flags).',
    flags: 'none',
  },
  POP: {
    syntax: 'POP B|D|H|PSW',
    summary: 'Pop a register pair (POP PSW restores flags).',
    flags: 'POP PSW sets all',
  },
  XTHL: { syntax: 'XTHL', summary: 'Swap HL with the word on top of the stack.', flags: 'none' },
  SPHL: { syntax: 'SPHL', summary: 'SP = HL.', flags: 'none' },

  IN: { syntax: 'IN port', summary: 'Read a byte from an I/O port into A.', flags: 'none' },
  OUT: { syntax: 'OUT port', summary: 'Write A to an I/O port.', flags: 'none' },
  EI: { syntax: 'EI', summary: 'Enable interrupts (after the next instruction).', flags: 'none' },
  DI: { syntax: 'DI', summary: 'Disable interrupts.', flags: 'none' },
  HLT: {
    syntax: 'HLT',
    summary: 'Halt until an interrupt (or forever if interrupts are off).',
    flags: 'none',
  },
  NOP: { syntax: 'NOP', summary: 'Do nothing for 4 T-states.', flags: 'none' },
};

for (const cc of CONDITIONS) {
  const when = CONDITION_TEXT[cc];
  docs['J' + cc] = { syntax: `J${cc} addr`, summary: `Jump to addr if ${when}.`, flags: 'none' };
  docs['C' + cc] = { syntax: `C${cc} addr`, summary: `Call addr if ${when}.`, flags: 'none' };
  docs['R' + cc] = { syntax: `R${cc}`, summary: `Return if ${when}.`, flags: 'none' };
}

export const INSTRUCTION_DOCS: Readonly<Record<string, InstructionDoc>> = docs;

const TIMING = new Map<string, { min: number; max: number }>();
for (const op of OPCODES) {
  if (op.undocumented) continue;
  const t = TIMING.get(op.mnemonic) ?? { min: Infinity, max: 0 };
  TIMING.set(op.mnemonic, {
    min: Math.min(t.min, op.cycles),
    max: Math.max(t.max, op.cyclesTaken),
  });
}

// Fastest and slowest timing of a mnemonic in T-states, across its operand
// forms (`MOV r,r` is 5, `MOV r,M` is 7) and taken/not-taken branches.
function instructionTiming(mnemonic: string): { min: number; max: number } | undefined {
  return TIMING.get(mnemonic.toUpperCase());
}

// `"7"` or `"5–11"`: a mnemonic's timing for display.
export function formatTiming(mnemonic: string): string {
  const t = instructionTiming(mnemonic);
  if (!t) return '';
  return t.min === t.max ? String(t.min) : `${t.min}–${t.max}`;
}

export interface DirectiveDoc {
  syntax: string;
  summary: string;
}

export const DIRECTIVE_DOCS: Readonly<Record<string, DirectiveDoc>> = {
  ORG: { syntax: 'ORG addr', summary: 'Assemble the following code starting at addr.' },
  EQU: { syntax: 'name EQU value', summary: 'Define a constant. Also written name = value.' },
  SET: { syntax: 'name SET value', summary: 'Define a constant that may be redefined later.' },
  DB: { syntax: 'DB value, "text", …', summary: 'Emit bytes and strings.' },
  DW: { syntax: 'DW value, …', summary: 'Emit 16-bit words, low byte first.' },
  DS: { syntax: 'DS count[, fill]', summary: 'Reserve count bytes (optionally filled).' },
  END: { syntax: 'END [entry]', summary: 'End of source; optionally set the entry point.' },
};
