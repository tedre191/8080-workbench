// Intel 8080 CPU core.
//
// The CPU knows nothing about memory layout or devices; everything goes
// through a `Bus`. Timing is tracked in T-states (clock cycles) and is
// accurate per instruction, including taken/not-taken conditional calls and
// returns.

// Everything the CPU can talk to.
export interface Bus {
  read(addr: number): number;
  write(addr: number, value: number): void;
  input(port: number): number;
  output(port: number, value: number): void;
  // Called when the CPU accepts an interrupt (the 8080's INTA cycle), so
  // whoever requested it can withdraw the request or make the next one.
  acknowledgeInterrupt?(): void;
}

// Bit positions of the flags in the PSW byte: S Z 0 AC 0 P 1 CY.
export const FLAG_S = 0x80;
export const FLAG_Z = 0x40;
export const FLAG_AC = 0x10;
export const FLAG_P = 0x04;
export const FLAG_CY = 0x01;

// Plain, serialisable snapshot of the CPU state.
export interface CpuState {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  sp: number;
  pc: number;
  // Flags packed as the PSW low byte.
  f: number;
  inte: boolean;
  halted: boolean;
  cycles: number;
}

// Parity lookup: true when the byte has an even number of 1 bits.
const PARITY: boolean[] = Array.from({ length: 256 }, (_, v) => {
  let bits = 0;
  for (let i = 0; i < 8; i++) bits += (v >> i) & 1;
  return (bits & 1) === 0;
});

export class Cpu8080 {
  // Registers.
  a = 0;
  b = 0;
  c = 0;
  d = 0;
  e = 0;
  h = 0;
  l = 0;
  sp = 0;
  pc = 0;

  // Flags, kept unpacked for speed.
  sf = false;
  zf = false;
  acf = false;
  pf = false;
  cf = false;

  // Interrupt enable flip-flop.
  inte = false;
  halted = false;
  // Total T-states executed since reset.
  cycles = 0;

  // EI takes effect only after the following instruction.
  private eiDelay = false;
  // Opcode supplied by the interrupting device, or -1 when none pending.
  private pendingInterrupt = -1;

  constructor(public bus: Bus) {}

  reset(): void {
    this.pc = 0;
    this.inte = false;
    this.halted = false;
    this.eiDelay = false;
    this.pendingInterrupt = -1;
    this.cycles = 0;
  }

  // Register pairs & flags

  get bc(): number {
    return (this.b << 8) | this.c;
  }
  set bc(v: number) {
    this.b = (v >> 8) & 0xff;
    this.c = v & 0xff;
  }
  get de(): number {
    return (this.d << 8) | this.e;
  }
  set de(v: number) {
    this.d = (v >> 8) & 0xff;
    this.e = v & 0xff;
  }
  get hl(): number {
    return (this.h << 8) | this.l;
  }
  set hl(v: number) {
    this.h = (v >> 8) & 0xff;
    this.l = v & 0xff;
  }

  // Flags packed into the PSW byte (bit 1 always set, bits 3 and 5 clear).
  get f(): number {
    return (
      (this.sf ? FLAG_S : 0) |
      (this.zf ? FLAG_Z : 0) |
      (this.acf ? FLAG_AC : 0) |
      (this.pf ? FLAG_P : 0) |
      0x02 |
      (this.cf ? FLAG_CY : 0)
    );
  }
  set f(v: number) {
    this.sf = (v & FLAG_S) !== 0;
    this.zf = (v & FLAG_Z) !== 0;
    this.acf = (v & FLAG_AC) !== 0;
    this.pf = (v & FLAG_P) !== 0;
    this.cf = (v & FLAG_CY) !== 0;
  }

  getState(): CpuState {
    const { a, b, c, d, e, h, l, sp, pc, f, inte, halted, cycles } = this;
    return { a, b, c, d, e, h, l, sp, pc, f, inte, halted, cycles };
  }

  setState(s: Partial<CpuState>): void {
    if (s.a !== undefined) this.a = s.a & 0xff;
    if (s.b !== undefined) this.b = s.b & 0xff;
    if (s.c !== undefined) this.c = s.c & 0xff;
    if (s.d !== undefined) this.d = s.d & 0xff;
    if (s.e !== undefined) this.e = s.e & 0xff;
    if (s.h !== undefined) this.h = s.h & 0xff;
    if (s.l !== undefined) this.l = s.l & 0xff;
    if (s.sp !== undefined) this.sp = s.sp & 0xffff;
    if (s.pc !== undefined) this.pc = s.pc & 0xffff;
    if (s.f !== undefined) this.f = s.f;
    if (s.inte !== undefined) this.inte = s.inte;
    if (s.halted !== undefined) this.halted = s.halted;
    if (s.cycles !== undefined) this.cycles = s.cycles;
  }

  // Interrupts

  // Request an interrupt. `opcode` is the instruction the device places on
  // the data bus during acknowledge, normally an RST (`0xC7 | n << 3`).
  // The request is latched until the CPU accepts it (INTE set, at an
  // instruction boundary) or it's withdrawn.
  interrupt(opcode: number): void {
    this.pendingInterrupt = opcode & 0xff;
  }

  // Withdraw a requested interrupt that hasn't been accepted yet.
  clearInterrupt(): void {
    this.pendingInterrupt = -1;
  }

  get interruptPending(): boolean {
    return this.pendingInterrupt !== -1;
  }

  // Execution

  // Execute one instruction (or service an interrupt). Returns T-states used.
  step(): number {
    if (this.pendingInterrupt !== -1 && this.inte && !this.eiDelay) {
      const op = this.pendingInterrupt;
      this.pendingInterrupt = -1;
      this.inte = false;
      this.halted = false;
      this.bus.acknowledgeInterrupt?.();
      return this.execute(op);
    }
    this.eiDelay = false;
    if (this.halted) {
      this.cycles += 4;
      return 4;
    }
    const op = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return this.execute(op);
  }

  private next8(): number {
    const v = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  private next16(): number {
    const lo = this.bus.read(this.pc);
    const hi = this.bus.read((this.pc + 1) & 0xffff);
    this.pc = (this.pc + 2) & 0xffff;
    return (hi << 8) | lo;
  }

  private read16(addr: number): number {
    return this.bus.read(addr) | (this.bus.read((addr + 1) & 0xffff) << 8);
  }

  private write16(addr: number, v: number): void {
    this.bus.write(addr, v & 0xff);
    this.bus.write((addr + 1) & 0xffff, (v >> 8) & 0xff);
  }

  private push(v: number): void {
    this.sp = (this.sp - 2) & 0xffff;
    this.write16(this.sp, v);
  }

  private pop(): number {
    const v = this.read16(this.sp);
    this.sp = (this.sp + 2) & 0xffff;
    return v;
  }

  private szp(v: number): void {
    this.sf = (v & 0x80) !== 0;
    this.zf = v === 0;
    this.pf = PARITY[v];
  }

  private add(v: number, carry: number): void {
    const r = this.a + v + carry;
    this.acf = ((this.a ^ v ^ r) & 0x10) !== 0;
    this.cf = r > 0xff;
    this.a = r & 0xff;
    this.szp(this.a);
  }

  // Shared by SUB/SBB/CMP. Returns the result without storing it.
  private sub(v: number, borrow: number): number {
    const r = this.a - v - borrow;
    // The 8080 subtracts by adding the complement, so AC is the carry out of
    // bit 3 of A + ~v + !borrow.
    this.acf = (this.a & 0x0f) + (~v & 0x0f) + (borrow ^ 1) > 0x0f;
    this.cf = r < 0;
    const res = r & 0xff;
    this.szp(res);
    return res;
  }

  private ana(v: number): void {
    // AC reflects the OR of bit 3 of the operands (8080 quirk, unlike 8085).
    this.acf = ((this.a | v) & 0x08) !== 0;
    this.a &= v;
    this.cf = false;
    this.szp(this.a);
  }

  private xra(v: number): void {
    this.a ^= v;
    this.acf = false;
    this.cf = false;
    this.szp(this.a);
  }

  private ora(v: number): void {
    this.a |= v;
    this.acf = false;
    this.cf = false;
    this.szp(this.a);
  }

  private inr(v: number): number {
    const r = (v + 1) & 0xff;
    this.acf = (r & 0x0f) === 0;
    this.szp(r);
    return r;
  }

  private dcr(v: number): number {
    const r = (v - 1) & 0xff;
    this.acf = (r & 0x0f) !== 0x0f;
    this.szp(r);
    return r;
  }

  private dad(v: number): void {
    const r = this.hl + v;
    this.cf = r > 0xffff;
    this.hl = r & 0xffff;
  }

  private daa(): void {
    let correction = 0;
    let carry = this.cf;
    const lo = this.a & 0x0f;
    const hi = this.a >> 4;
    if (lo > 9 || this.acf) correction |= 0x06;
    if (hi > 9 || this.cf || (hi >= 9 && lo > 9)) {
      correction |= 0x60;
      carry = true;
    }
    this.add(correction, 0);
    this.cf = carry;
  }

  private cond(cc: number): boolean {
    switch (cc) {
      case 0:
        return !this.zf;
      case 1:
        return this.zf;
      case 2:
        return !this.cf;
      case 3:
        return this.cf;
      case 4:
        return !this.pf;
      case 5:
        return this.pf;
      case 6:
        return !this.sf;
      default:
        return this.sf;
    }
  }

  private jmpIf(take: boolean): void {
    const addr = this.next16();
    if (take) this.pc = addr;
  }

  // Conditional CALL: 11 T-states not taken, 17 taken.
  private callIf(take: boolean): number {
    const addr = this.next16();
    if (!take) return 11;
    this.push(this.pc);
    this.pc = addr;
    return 17;
  }

  // Conditional RET: 5 T-states not taken, 11 taken.
  private retIf(take: boolean): number {
    if (!take) return 5;
    this.pc = this.pop();
    return 11;
  }

  private rst(n: number): void {
    this.push(this.pc);
    this.pc = n << 3;
  }

  // Execute a single already-fetched opcode. Returns T-states used.
  execute(op: number): number {
    let t: number;
    const bus = this.bus;
    // One line per opcode reads best here, so the formatter leaves it alone.
    // prettier-ignore
    switch (op) {
      // 0x00-0x3F
      case 0x00: case 0x08: case 0x10: case 0x18:
      case 0x20: case 0x28: case 0x30: case 0x38:
        t = 4; break; // NOP (and undocumented aliases)

      case 0x01: this.c = this.next8(); this.b = this.next8(); t = 10; break; // LXI B
      case 0x11: this.e = this.next8(); this.d = this.next8(); t = 10; break; // LXI D
      case 0x21: this.l = this.next8(); this.h = this.next8(); t = 10; break; // LXI H
      case 0x31: this.sp = this.next16(); t = 10; break; // LXI SP

      case 0x02: bus.write(this.bc, this.a); t = 7; break; // STAX B
      case 0x12: bus.write(this.de, this.a); t = 7; break; // STAX D
      case 0x0a: this.a = bus.read(this.bc); t = 7; break; // LDAX B
      case 0x1a: this.a = bus.read(this.de); t = 7; break; // LDAX D

      case 0x22: this.write16(this.next16(), this.hl); t = 16; break; // SHLD
      case 0x2a: this.hl = this.read16(this.next16()); t = 16; break; // LHLD
      case 0x32: bus.write(this.next16(), this.a); t = 13; break; // STA
      case 0x3a: this.a = bus.read(this.next16()); t = 13; break; // LDA

      case 0x03: this.bc = (this.bc + 1) & 0xffff; t = 5; break; // INX B
      case 0x13: this.de = (this.de + 1) & 0xffff; t = 5; break; // INX D
      case 0x23: this.hl = (this.hl + 1) & 0xffff; t = 5; break; // INX H
      case 0x33: this.sp = (this.sp + 1) & 0xffff; t = 5; break; // INX SP
      case 0x0b: this.bc = (this.bc - 1) & 0xffff; t = 5; break; // DCX B
      case 0x1b: this.de = (this.de - 1) & 0xffff; t = 5; break; // DCX D
      case 0x2b: this.hl = (this.hl - 1) & 0xffff; t = 5; break; // DCX H
      case 0x3b: this.sp = (this.sp - 1) & 0xffff; t = 5; break; // DCX SP

      case 0x09: this.dad(this.bc); t = 10; break; // DAD B
      case 0x19: this.dad(this.de); t = 10; break; // DAD D
      case 0x29: this.dad(this.hl); t = 10; break; // DAD H
      case 0x39: this.dad(this.sp); t = 10; break; // DAD SP

      case 0x04: this.b = this.inr(this.b); t = 5; break;
      case 0x0c: this.c = this.inr(this.c); t = 5; break;
      case 0x14: this.d = this.inr(this.d); t = 5; break;
      case 0x1c: this.e = this.inr(this.e); t = 5; break;
      case 0x24: this.h = this.inr(this.h); t = 5; break;
      case 0x2c: this.l = this.inr(this.l); t = 5; break;
      case 0x34: { const hl = this.hl; bus.write(hl, this.inr(bus.read(hl))); t = 10; break; }
      case 0x3c: this.a = this.inr(this.a); t = 5; break;

      case 0x05: this.b = this.dcr(this.b); t = 5; break;
      case 0x0d: this.c = this.dcr(this.c); t = 5; break;
      case 0x15: this.d = this.dcr(this.d); t = 5; break;
      case 0x1d: this.e = this.dcr(this.e); t = 5; break;
      case 0x25: this.h = this.dcr(this.h); t = 5; break;
      case 0x2d: this.l = this.dcr(this.l); t = 5; break;
      case 0x35: { const hl = this.hl; bus.write(hl, this.dcr(bus.read(hl))); t = 10; break; }
      case 0x3d: this.a = this.dcr(this.a); t = 5; break;

      case 0x06: this.b = this.next8(); t = 7; break; // MVI
      case 0x0e: this.c = this.next8(); t = 7; break;
      case 0x16: this.d = this.next8(); t = 7; break;
      case 0x1e: this.e = this.next8(); t = 7; break;
      case 0x26: this.h = this.next8(); t = 7; break;
      case 0x2e: this.l = this.next8(); t = 7; break;
      case 0x36: bus.write(this.hl, this.next8()); t = 10; break;
      case 0x3e: this.a = this.next8(); t = 7; break;

      case 0x07: // RLC
        this.cf = (this.a & 0x80) !== 0;
        this.a = ((this.a << 1) | (this.cf ? 1 : 0)) & 0xff;
        t = 4; break;
      case 0x0f: // RRC
        this.cf = (this.a & 0x01) !== 0;
        this.a = (this.a >> 1) | (this.cf ? 0x80 : 0);
        t = 4; break;
      case 0x17: { // RAL
        const c = this.cf ? 1 : 0;
        this.cf = (this.a & 0x80) !== 0;
        this.a = ((this.a << 1) | c) & 0xff;
        t = 4; break;
      }
      case 0x1f: { // RAR
        const c = this.cf ? 0x80 : 0;
        this.cf = (this.a & 0x01) !== 0;
        this.a = (this.a >> 1) | c;
        t = 4; break;
      }
      case 0x27: this.daa(); t = 4; break; // DAA
      case 0x2f: this.a ^= 0xff; t = 4; break; // CMA
      case 0x37: this.cf = true; t = 4; break; // STC
      case 0x3f: this.cf = !this.cf; t = 4; break; // CMC

      // 0x40-0x7F: MOV / HLT
      case 0x40: t = 5; break;
      case 0x41: this.b = this.c; t = 5; break;
      case 0x42: this.b = this.d; t = 5; break;
      case 0x43: this.b = this.e; t = 5; break;
      case 0x44: this.b = this.h; t = 5; break;
      case 0x45: this.b = this.l; t = 5; break;
      case 0x46: this.b = bus.read(this.hl); t = 7; break;
      case 0x47: this.b = this.a; t = 5; break;
      case 0x48: this.c = this.b; t = 5; break;
      case 0x49: t = 5; break;
      case 0x4a: this.c = this.d; t = 5; break;
      case 0x4b: this.c = this.e; t = 5; break;
      case 0x4c: this.c = this.h; t = 5; break;
      case 0x4d: this.c = this.l; t = 5; break;
      case 0x4e: this.c = bus.read(this.hl); t = 7; break;
      case 0x4f: this.c = this.a; t = 5; break;
      case 0x50: this.d = this.b; t = 5; break;
      case 0x51: this.d = this.c; t = 5; break;
      case 0x52: t = 5; break;
      case 0x53: this.d = this.e; t = 5; break;
      case 0x54: this.d = this.h; t = 5; break;
      case 0x55: this.d = this.l; t = 5; break;
      case 0x56: this.d = bus.read(this.hl); t = 7; break;
      case 0x57: this.d = this.a; t = 5; break;
      case 0x58: this.e = this.b; t = 5; break;
      case 0x59: this.e = this.c; t = 5; break;
      case 0x5a: this.e = this.d; t = 5; break;
      case 0x5b: t = 5; break;
      case 0x5c: this.e = this.h; t = 5; break;
      case 0x5d: this.e = this.l; t = 5; break;
      case 0x5e: this.e = bus.read(this.hl); t = 7; break;
      case 0x5f: this.e = this.a; t = 5; break;
      case 0x60: this.h = this.b; t = 5; break;
      case 0x61: this.h = this.c; t = 5; break;
      case 0x62: this.h = this.d; t = 5; break;
      case 0x63: this.h = this.e; t = 5; break;
      case 0x64: t = 5; break;
      case 0x65: this.h = this.l; t = 5; break;
      case 0x66: this.h = bus.read(this.hl); t = 7; break;
      case 0x67: this.h = this.a; t = 5; break;
      case 0x68: this.l = this.b; t = 5; break;
      case 0x69: this.l = this.c; t = 5; break;
      case 0x6a: this.l = this.d; t = 5; break;
      case 0x6b: this.l = this.e; t = 5; break;
      case 0x6c: this.l = this.h; t = 5; break;
      case 0x6d: t = 5; break;
      case 0x6e: this.l = bus.read(this.hl); t = 7; break;
      case 0x6f: this.l = this.a; t = 5; break;
      case 0x70: bus.write(this.hl, this.b); t = 7; break;
      case 0x71: bus.write(this.hl, this.c); t = 7; break;
      case 0x72: bus.write(this.hl, this.d); t = 7; break;
      case 0x73: bus.write(this.hl, this.e); t = 7; break;
      case 0x74: bus.write(this.hl, this.h); t = 7; break;
      case 0x75: bus.write(this.hl, this.l); t = 7; break;
      case 0x76: this.halted = true; t = 7; break; // HLT
      case 0x77: bus.write(this.hl, this.a); t = 7; break;
      case 0x78: this.a = this.b; t = 5; break;
      case 0x79: this.a = this.c; t = 5; break;
      case 0x7a: this.a = this.d; t = 5; break;
      case 0x7b: this.a = this.e; t = 5; break;
      case 0x7c: this.a = this.h; t = 5; break;
      case 0x7d: this.a = this.l; t = 5; break;
      case 0x7e: this.a = bus.read(this.hl); t = 7; break;
      case 0x7f: t = 5; break;

      // 0x80-0xBF: ALU with register/memory
      case 0x80: this.add(this.b, 0); t = 4; break;
      case 0x81: this.add(this.c, 0); t = 4; break;
      case 0x82: this.add(this.d, 0); t = 4; break;
      case 0x83: this.add(this.e, 0); t = 4; break;
      case 0x84: this.add(this.h, 0); t = 4; break;
      case 0x85: this.add(this.l, 0); t = 4; break;
      case 0x86: this.add(bus.read(this.hl), 0); t = 7; break;
      case 0x87: this.add(this.a, 0); t = 4; break;
      case 0x88: this.add(this.b, this.cf ? 1 : 0); t = 4; break;
      case 0x89: this.add(this.c, this.cf ? 1 : 0); t = 4; break;
      case 0x8a: this.add(this.d, this.cf ? 1 : 0); t = 4; break;
      case 0x8b: this.add(this.e, this.cf ? 1 : 0); t = 4; break;
      case 0x8c: this.add(this.h, this.cf ? 1 : 0); t = 4; break;
      case 0x8d: this.add(this.l, this.cf ? 1 : 0); t = 4; break;
      case 0x8e: this.add(bus.read(this.hl), this.cf ? 1 : 0); t = 7; break;
      case 0x8f: this.add(this.a, this.cf ? 1 : 0); t = 4; break;
      case 0x90: this.a = this.sub(this.b, 0); t = 4; break;
      case 0x91: this.a = this.sub(this.c, 0); t = 4; break;
      case 0x92: this.a = this.sub(this.d, 0); t = 4; break;
      case 0x93: this.a = this.sub(this.e, 0); t = 4; break;
      case 0x94: this.a = this.sub(this.h, 0); t = 4; break;
      case 0x95: this.a = this.sub(this.l, 0); t = 4; break;
      case 0x96: this.a = this.sub(bus.read(this.hl), 0); t = 7; break;
      case 0x97: this.a = this.sub(this.a, 0); t = 4; break;
      case 0x98: this.a = this.sub(this.b, this.cf ? 1 : 0); t = 4; break;
      case 0x99: this.a = this.sub(this.c, this.cf ? 1 : 0); t = 4; break;
      case 0x9a: this.a = this.sub(this.d, this.cf ? 1 : 0); t = 4; break;
      case 0x9b: this.a = this.sub(this.e, this.cf ? 1 : 0); t = 4; break;
      case 0x9c: this.a = this.sub(this.h, this.cf ? 1 : 0); t = 4; break;
      case 0x9d: this.a = this.sub(this.l, this.cf ? 1 : 0); t = 4; break;
      case 0x9e: this.a = this.sub(bus.read(this.hl), this.cf ? 1 : 0); t = 7; break;
      case 0x9f: this.a = this.sub(this.a, this.cf ? 1 : 0); t = 4; break;
      case 0xa0: this.ana(this.b); t = 4; break;
      case 0xa1: this.ana(this.c); t = 4; break;
      case 0xa2: this.ana(this.d); t = 4; break;
      case 0xa3: this.ana(this.e); t = 4; break;
      case 0xa4: this.ana(this.h); t = 4; break;
      case 0xa5: this.ana(this.l); t = 4; break;
      case 0xa6: this.ana(bus.read(this.hl)); t = 7; break;
      case 0xa7: this.ana(this.a); t = 4; break;
      case 0xa8: this.xra(this.b); t = 4; break;
      case 0xa9: this.xra(this.c); t = 4; break;
      case 0xaa: this.xra(this.d); t = 4; break;
      case 0xab: this.xra(this.e); t = 4; break;
      case 0xac: this.xra(this.h); t = 4; break;
      case 0xad: this.xra(this.l); t = 4; break;
      case 0xae: this.xra(bus.read(this.hl)); t = 7; break;
      case 0xaf: this.xra(this.a); t = 4; break;
      case 0xb0: this.ora(this.b); t = 4; break;
      case 0xb1: this.ora(this.c); t = 4; break;
      case 0xb2: this.ora(this.d); t = 4; break;
      case 0xb3: this.ora(this.e); t = 4; break;
      case 0xb4: this.ora(this.h); t = 4; break;
      case 0xb5: this.ora(this.l); t = 4; break;
      case 0xb6: this.ora(bus.read(this.hl)); t = 7; break;
      case 0xb7: this.ora(this.a); t = 4; break;
      case 0xb8: this.sub(this.b, 0); t = 4; break;
      case 0xb9: this.sub(this.c, 0); t = 4; break;
      case 0xba: this.sub(this.d, 0); t = 4; break;
      case 0xbb: this.sub(this.e, 0); t = 4; break;
      case 0xbc: this.sub(this.h, 0); t = 4; break;
      case 0xbd: this.sub(this.l, 0); t = 4; break;
      case 0xbe: this.sub(bus.read(this.hl), 0); t = 7; break;
      case 0xbf: this.sub(this.a, 0); t = 4; break;

      // 0xC0-0xFF
      case 0xc0: case 0xc8: case 0xd0: case 0xd8:
      case 0xe0: case 0xe8: case 0xf0: case 0xf8:
        t = this.retIf(this.cond((op >> 3) & 7)); break; // Rcc
      case 0xc2: case 0xca: case 0xd2: case 0xda:
      case 0xe2: case 0xea: case 0xf2: case 0xfa:
        this.jmpIf(this.cond((op >> 3) & 7)); t = 10; break; // Jcc
      case 0xc4: case 0xcc: case 0xd4: case 0xdc:
      case 0xe4: case 0xec: case 0xf4: case 0xfc:
        t = this.callIf(this.cond((op >> 3) & 7)); break; // Ccc
      case 0xc7: case 0xcf: case 0xd7: case 0xdf:
      case 0xe7: case 0xef: case 0xf7: case 0xff:
        this.rst((op >> 3) & 7); t = 11; break; // RST n

      case 0xc1: this.bc = this.pop(); t = 10; break; // POP B
      case 0xd1: this.de = this.pop(); t = 10; break; // POP D
      case 0xe1: this.hl = this.pop(); t = 10; break; // POP H
      case 0xf1: { const v = this.pop(); this.a = v >> 8; this.f = v & 0xff; t = 10; break; } // POP PSW
      case 0xc5: this.push(this.bc); t = 11; break; // PUSH B
      case 0xd5: this.push(this.de); t = 11; break; // PUSH D
      case 0xe5: this.push(this.hl); t = 11; break; // PUSH H
      case 0xf5: this.push((this.a << 8) | this.f); t = 11; break; // PUSH PSW

      case 0xc3: case 0xcb: this.pc = this.next16(); t = 10; break; // JMP
      case 0xc9: case 0xd9: this.pc = this.pop(); t = 10; break; // RET
      case 0xcd: case 0xdd: case 0xed: case 0xfd: { // CALL
        const addr = this.next16();
        this.push(this.pc);
        this.pc = addr;
        t = 17; break;
      }

      case 0xc6: this.add(this.next8(), 0); t = 7; break; // ADI
      case 0xce: this.add(this.next8(), this.cf ? 1 : 0); t = 7; break; // ACI
      case 0xd6: this.a = this.sub(this.next8(), 0); t = 7; break; // SUI
      case 0xde: this.a = this.sub(this.next8(), this.cf ? 1 : 0); t = 7; break; // SBI
      case 0xe6: this.ana(this.next8()); t = 7; break; // ANI
      case 0xee: this.xra(this.next8()); t = 7; break; // XRI
      case 0xf6: this.ora(this.next8()); t = 7; break; // ORI
      case 0xfe: this.sub(this.next8(), 0); t = 7; break; // CPI

      case 0xd3: bus.output(this.next8(), this.a); t = 10; break; // OUT
      case 0xdb: this.a = bus.input(this.next8()) & 0xff; t = 10; break; // IN

      case 0xe3: { // XTHL
        const v = this.read16(this.sp);
        this.write16(this.sp, this.hl);
        this.hl = v;
        t = 18; break;
      }
      case 0xe9: this.pc = this.hl; t = 5; break; // PCHL
      case 0xeb: { // XCHG
        const d = this.d, e = this.e;
        this.d = this.h; this.e = this.l;
        this.h = d; this.l = e;
        t = 4; break;
      }
      case 0xf9: this.sp = this.hl; t = 5; break; // SPHL
      case 0xf3: this.inte = false; t = 4; break; // DI
      case 0xfb: this.inte = true; this.eiDelay = true; t = 4; break; // EI

      default:
        // Unreachable: every opcode is handled above.
        throw new Error(`unhandled opcode 0x${op.toString(16)}`);
    }
    this.cycles += t;
    return t;
  }
}
