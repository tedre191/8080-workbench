import { describe, expect, it } from 'vitest';
import { assemble, disassembleOne, OPCODES } from '../src/index';

const bytesOf = (src: string) => {
  const r = assemble(src);
  expect(r.errors).toEqual([]);
  return [...r.segments.flatMap((s) => [...s.bytes])];
};

describe('assembler', () => {
  it('round-trips every documented opcode through the disassembler', () => {
    for (const info of OPCODES) {
      if (info.undocumented) continue;
      const mem = [info.opcode, 0x34, 0x12];
      const text = disassembleOne((a) => mem[a] ?? 0, 0).text;
      const out = bytesOf(`  ${text}`);
      expect(out, text).toEqual(mem.slice(0, info.length));
    }
  });

  it('handles labels, forward references and EQU', () => {
    const src = `
        ORG 100h
COUNT   EQU 3
start:  MVI B, COUNT
loop    DCR B
        JNZ loop
        JMP done
        DB 'Hi', 0
done:   HLT
        END start`;
    const r = assemble(src);
    expect(r.errors).toEqual([]);
    expect(r.entry).toBe(0x100);
    expect(r.symbols.get('done')).toBe(0x10c);
    expect(r.labels.get(0x102)).toBe('loop');
    expect([...r.segments[0].bytes]).toEqual([
      0x06, 0x03, 0x05, 0xc2, 0x02, 0x01, 0xc3, 0x0c, 0x01, 0x48, 0x69, 0x00, 0x76,
    ]);
    expect(r.addressToLine.get(0x10c)).toBe(9);
  });

  it('evaluates expressions and number formats', () => {
    expect(bytesOf(`DB 10, 0Ah, 0x0A, $0A, 1010b, 12o, 'A', -1`)).toEqual([
      10, 10, 10, 10, 10, 10, 65, 255,
    ]);
    expect(bytesOf(`DB HIGH 1234h, LOW 1234h, (1+2)*3, 1 << 4, 7 AND 3, 15 % 4`)).toEqual([
      0x12, 0x34, 9, 16, 3, 3,
    ]);
    expect(bytesOf(` ORG 10h\n DW $, $+2`)).toEqual([0x10, 0, 0x12, 0]);
    expect(bytesOf(`X = 5\n DB X*2`)).toEqual([10]);
  });

  it('supports RST, DS and string escapes', () => {
    expect(bytesOf(' RST 7\n RST 0')).toEqual([0xff, 0xc7]);
    const r = assemble(' DB 1\n DS 3\n DB 2');
    expect(r.segments.map((s) => s.address)).toEqual([0, 4]);
    expect(bytesOf(' DS 2, 0AAh')).toEqual([0xaa, 0xaa]);
    expect(bytesOf(` DB "a\\n"`)).toEqual([97, 10]);
  });

  it('reports useful errors with line numbers', () => {
    const r = assemble(' MOV A\n JMP nowhere\n MVI A, 300\nfoo: NOP\nfoo: NOP\n BLAH');
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 5, 6]);
    expect(r.errors[1].message).toMatch(/undefined symbol 'nowhere'/);
  });

  it('reports a bad END operand as an error', () => {
    expect(assemble(' NOP\n END nowhere').errors[0]).toMatchObject({ line: 2 });
  });

  it('gives forward-referencing constants the right $', () => {
    expect(assemble(' ORG 10h\nHERE EQU $ + later\nlater: DB HERE').symbols.get('HERE')).toBe(0x20);
  });

  it('rejects register names as labels', () => {
    expect(assemble('B: NOP').ok).toBe(false);
  });

  it('gives a SET symbol its value at each line', () => {
    expect(bytesOf('X SET 1\n DB X\nX SET X + 1\n DB X\nX SET 7\n DB X')).toEqual([1, 2, 7]);
  });

  it("rejects characters that don't fit in a byte", () => {
    expect(bytesOf(' DB "é"')).toEqual([0xe9]);
    const r = assemble(' DB "a😀"\nafter: NOP');
    expect(r.errors[0]).toMatchObject({ line: 1, message: "character '😀' doesn't fit in a byte" });
    expect(assemble(" MVI A, '€'").ok).toBe(false);
  });
});
