import { describe, expect, it } from 'vitest';
import { disassembleOne, findPreviousInstructions } from '../src/index';

// NOP; LXI H,1234h; MVI A,5; NOP; HLT  at 0, 1, 4, 6, 7
const mem = [0x00, 0x21, 0x34, 0x12, 0x3e, 0x05, 0x00, 0x76];
const read = (a: number) => mem[a] ?? 0;

describe('disassembleOne', () => {
  it('formats operands and names known addresses', () => {
    expect(disassembleOne(read, 1).text).toBe('LXI H,1234h');
    expect(disassembleOne(read, 4).text).toBe('MVI A,05h');
    const call = [0xcd, 0x00, 0xf0];
    const ins = disassembleOne((a) => call[a], 0, { symbols: new Map([[0xf000, 'draw']]) });
    expect(ins.text).toBe('CALL draw');
    expect(ins.target).toBe(0xf000);
  });
});

describe('findPreviousInstructions', () => {
  it('finds the instruction boundary n instructions back', () => {
    expect(findPreviousInstructions(read, 7, 1)).toBe(6);
    expect(findPreviousInstructions(read, 7, 3)).toBe(1);
    expect(findPreviousInstructions(read, 4, 3)).toBe(0); // only 2 instructions before 4
    expect(findPreviousInstructions(read, 0, 3)).toBe(0); // never wraps below 0
  });
});
