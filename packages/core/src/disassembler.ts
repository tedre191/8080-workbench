import { OPCODES, type OpcodeInfo } from './opcodes';

export interface DisassembledInstruction {
  address: number;
  bytes: number[];
  info: OpcodeInfo;
  // e.g. `MVI A,3Fh`
  text: string;
  // Immediate operand value, if any.
  operand?: number;
  // Branch/call target, if the instruction transfers control to a fixed address.
  target?: number;
}

export interface DisassembleOptions {
  // Map from address to label, used to name branch targets and addresses.
  symbols?: ReadonlyMap<number, string>;
}

export const hex8 = (v: number): string => (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
export const hex16 = (v: number): string =>
  (v & 0xffff).toString(16).toUpperCase().padStart(4, '0');

// Hex in assembler syntax: always starts with a digit, ends in `h`.
function asmHex(v: number, digits: number): string {
  const s = v.toString(16).toUpperCase().padStart(digits, '0');
  return (/^[A-F]/.test(s) ? '0' : '') + s + 'h';
}

// Disassemble one instruction. `read` lets you disassemble from anything:
// a Machine (`a => m.peek(a)`), a Uint8Array, etc.
export function disassembleOne(
  read: (addr: number) => number,
  address: number,
  opts: DisassembleOptions = {},
): DisassembledInstruction {
  const op = read(address & 0xffff);
  const info = OPCODES[op];
  const bytes = [op];
  for (let i = 1; i < info.length; i++) bytes.push(read((address + i) & 0xffff));

  let operand: number | undefined;
  let target: number | undefined;
  if (info.length === 2) operand = bytes[1];
  else if (info.length === 3) operand = bytes[1] | (bytes[2] << 8);

  if (info.flow === 'jump' || info.flow === 'call') target = operand;
  if (info.flow === 'rst') target = op & 0x38;

  const ops = info.operands.map((o) => {
    if (o === 'd8' || o === 'port') return asmHex(operand!, 2);
    if (o === 'd16' || o === 'a16') return opts.symbols?.get(operand!) ?? asmHex(operand!, 4);
    return o;
  });
  const text = info.mnemonic + (ops.length ? ' ' + ops.join(',') : '');
  return { address: address & 0xffff, bytes, info, text, operand, target };
}

// Disassemble `count` consecutive instructions starting at `address`.
export function disassemble(
  read: (addr: number) => number,
  address: number,
  count: number,
  opts: DisassembleOptions = {},
): DisassembledInstruction[] {
  const out: DisassembledInstruction[] = [];
  let addr = address & 0xffff;
  for (let i = 0; i < count; i++) {
    const ins = disassembleOne(read, addr, opts);
    out.push(ins);
    addr = (addr + ins.info.length) & 0xffff;
  }
  return out;
}

// Find the address `count` instructions before `address`, for scrolling a
// disassembly backwards. 8080 code can't be decoded backwards, so this tries
// start points further back and uses the first whose instructions land
// exactly on `address`. Never goes below address 0.
export function findPreviousInstructions(
  read: (addr: number) => number,
  address: number,
  count: number,
): number {
  for (let back = Math.min(count * 3, address); back > 0; back--) {
    const starts: number[] = [];
    let offset = 0;
    while (offset < back) {
      const at = address - back + offset;
      starts.push(at);
      offset += OPCODES[read(at)].length;
    }
    if (offset === back) return starts[Math.max(0, starts.length - count)];
  }
  return address;
}
