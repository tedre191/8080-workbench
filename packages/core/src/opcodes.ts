// Static metadata for all 256 Intel 8080 opcodes.
//
// Shared by the disassembler and assembler so that both always agree on
// mnemonics, operand syntax and instruction lengths.

// Kind of the immediate operand that follows the opcode byte, if any.
export type ImmediateKind = 'none' | 'd8' | 'd16' | 'a16' | 'port';

export interface OpcodeInfo {
  readonly opcode: number;
  // Mnemonic, e.g. `MOV`.
  readonly mnemonic: string;
  // Operand template. Register operands are literal (`B`, `M`, `SP`, `PSW`);
  // immediates appear as `d8`, `d16`, `a16` or `port`. RST encodes its vector
  // number literally (`RST 3`).
  readonly operands: readonly string[];
  // Total instruction length in bytes (1-3).
  readonly length: 1 | 2 | 3;
  readonly immediate: ImmediateKind;
  // T-states when a condition is not taken (or the only timing).
  readonly cycles: number;
  // T-states when a conditional CALL/RET is taken.
  readonly cyclesTaken: number;
  // True for the undocumented opcodes that alias documented ones.
  readonly undocumented: boolean;
  // Control-flow class, handy for debuggers (step over, step out...).
  readonly flow: 'none' | 'jump' | 'call' | 'ret' | 'rst' | 'halt';
}

export const REGISTERS = ['B', 'C', 'D', 'E', 'H', 'L', 'M', 'A'] as const;
// Register pairs as encoded by LXI/INX/DCX/DAD.
export const PAIRS_SP = ['B', 'D', 'H', 'SP'] as const;
// Register pairs as encoded by PUSH/POP.
export const PAIRS_PSW = ['B', 'D', 'H', 'PSW'] as const;
export const CONDITIONS = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'] as const;

const ALU_REG = ['ADD', 'ADC', 'SUB', 'SBB', 'ANA', 'XRA', 'ORA', 'CMP'] as const;
const ALU_IMM = ['ADI', 'ACI', 'SUI', 'SBI', 'ANI', 'XRI', 'ORI', 'CPI'] as const;

// Instruction length for each kind of immediate operand.
const LENGTHS: Record<ImmediateKind, 1 | 2 | 3> = { none: 1, d8: 2, port: 2, d16: 3, a16: 3 };

// Builds the table. The loops follow Intel's encoding, where r is a register
// (B C D E H L M A = 0-7), rp a register pair and cc a condition.
function build(): OpcodeInfo[] {
  const table: OpcodeInfo[] = new Array(256);
  type Extra = Partial<Pick<OpcodeInfo, 'cyclesTaken' | 'undocumented' | 'flow'>>;
  const def = (
    opcode: number,
    mnemonic: string,
    operands: string[],
    cycles: number,
    extra: Extra = {},
  ) => {
    const immediate = (operands.find((operand) => operand in LENGTHS) ?? 'none') as ImmediateKind;
    table[opcode] = {
      opcode,
      mnemonic,
      operands,
      length: LENGTHS[immediate],
      immediate,
      cycles,
      cyclesTaken: extra.cyclesTaken ?? cycles,
      undocumented: extra.undocumented ?? false,
      flow: extra.flow ?? 'none',
    };
  };

  // 0x00-0x3F: miscellaneous, 16-bit loads, INR/DCR/MVI, rotates.
  for (let rp = 0; rp < 4; rp++) {
    const base = rp << 4;
    def(base | 0x01, 'LXI', [PAIRS_SP[rp], 'd16'], 10);
    def(base | 0x03, 'INX', [PAIRS_SP[rp]], 5);
    def(base | 0x09, 'DAD', [PAIRS_SP[rp]], 10);
    def(base | 0x0b, 'DCX', [PAIRS_SP[rp]], 5);
  }
  def(0x02, 'STAX', ['B'], 7);
  def(0x12, 'STAX', ['D'], 7);
  def(0x0a, 'LDAX', ['B'], 7);
  def(0x1a, 'LDAX', ['D'], 7);
  def(0x22, 'SHLD', ['a16'], 16);
  def(0x2a, 'LHLD', ['a16'], 16);
  def(0x32, 'STA', ['a16'], 13);
  def(0x3a, 'LDA', ['a16'], 13);
  for (let r = 0; r < 8; r++) {
    const memory = r === 6; // M, the byte at HL, takes longer
    def((r << 3) | 0x04, 'INR', [REGISTERS[r]], memory ? 10 : 5);
    def((r << 3) | 0x05, 'DCR', [REGISTERS[r]], memory ? 10 : 5);
    def((r << 3) | 0x06, 'MVI', [REGISTERS[r], 'd8'], memory ? 10 : 7);
  }
  const misc = ['RLC', 'RRC', 'RAL', 'RAR', 'DAA', 'CMA', 'STC', 'CMC'];
  misc.forEach((name, i) => def((i << 3) | 0x07, name, [], 4));
  def(0x00, 'NOP', [], 4);
  for (const op of [0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38]) {
    def(op, 'NOP', [], 4, { undocumented: true });
  }

  // 0x40-0x7F: MOV (and HLT in place of MOV M,M).
  for (let to = 0; to < 8; to++) {
    for (let from = 0; from < 8; from++) {
      const opcode = 0x40 | (to << 3) | from;
      if (opcode === 0x76) def(opcode, 'HLT', [], 7, { flow: 'halt' });
      else def(opcode, 'MOV', [REGISTERS[to], REGISTERS[from]], to === 6 || from === 6 ? 7 : 5);
    }
  }

  // 0x80-0xBF: register ALU operations.
  for (let operation = 0; operation < 8; operation++) {
    for (let r = 0; r < 8; r++) {
      def(0x80 | (operation << 3) | r, ALU_REG[operation], [REGISTERS[r]], r === 6 ? 7 : 4);
    }
  }

  // 0xC0-0xFF: branches, stack, immediate ALU, I/O.
  for (let cc = 0; cc < 8; cc++) {
    const base = 0xc0 | (cc << 3);
    def(base | 0x00, 'R' + CONDITIONS[cc], [], 5, { cyclesTaken: 11, flow: 'ret' });
    def(base | 0x02, 'J' + CONDITIONS[cc], ['a16'], 10, { flow: 'jump' });
    def(base | 0x04, 'C' + CONDITIONS[cc], ['a16'], 11, { cyclesTaken: 17, flow: 'call' });
    def(base | 0x06, ALU_IMM[cc], ['d8'], 7);
    def(base | 0x07, 'RST', [String(cc)], 11, { flow: 'rst' });
  }
  for (let rp = 0; rp < 4; rp++) {
    def(0xc1 | (rp << 4), 'POP', [PAIRS_PSW[rp]], 10);
    def(0xc5 | (rp << 4), 'PUSH', [PAIRS_PSW[rp]], 11);
  }
  def(0xc3, 'JMP', ['a16'], 10, { flow: 'jump' });
  def(0xcb, 'JMP', ['a16'], 10, { flow: 'jump', undocumented: true });
  def(0xc9, 'RET', [], 10, { flow: 'ret' });
  def(0xd9, 'RET', [], 10, { flow: 'ret', undocumented: true });
  def(0xcd, 'CALL', ['a16'], 17, { flow: 'call' });
  for (const op of [0xdd, 0xed, 0xfd]) {
    def(op, 'CALL', ['a16'], 17, { flow: 'call', undocumented: true });
  }
  def(0xd3, 'OUT', ['port'], 10);
  def(0xdb, 'IN', ['port'], 10);
  def(0xe3, 'XTHL', [], 18);
  def(0xe9, 'PCHL', [], 5, { flow: 'jump' });
  def(0xeb, 'XCHG', [], 4);
  def(0xf3, 'DI', [], 4);
  def(0xf9, 'SPHL', [], 5);
  def(0xfb, 'EI', [], 4);

  for (let i = 0; i < 256; i++) {
    if (!table[i]) throw new Error(`opcode table incomplete at ${i.toString(16)}`);
  }
  return table;
}

export const OPCODES: readonly OpcodeInfo[] = build();
