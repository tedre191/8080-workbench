import { assemble, Display, Machine, OPCODES } from '@i8080/core';
import { describe, expect, it } from 'vitest';
import { INSTRUCTION_GROUPS, SNIPPETS } from '../src/reference';

describe('reference', () => {
  it('covers every documented instruction exactly once', () => {
    const listed = INSTRUCTION_GROUPS.flatMap((g) => g.rows.flatMap((r) => r.mnemonics));
    const all = [...new Set(OPCODES.filter((o) => !o.undocumented).map((o) => o.mnemonic))];
    expect([...listed].sort()).toEqual([...all].sort());
  });

  it('has a summary and timing for every row', () => {
    for (const row of INSTRUCTION_GROUPS.flatMap((g) => g.rows)) {
      expect(row.summary, row.syntax).not.toBe('');
      expect(row.cycles, row.syntax).toMatch(/^\d+(–\d+)?$/);
    }
  });

  for (const s of SNIPPETS) {
    it(`snippet "${s.title}" assembles on its own`, () => {
      expect(assemble(s.code).errors).toEqual([]);
    });
  }

  // Run a snippet (followed by HLT) on a fresh machine.
  function run(title: string, setup: (m: Machine) => void = () => {}) {
    const code = SNIPPETS.find((s) => s.title === title)!.code;
    const m = new Machine();
    const display = m.add(new Display());
    for (const seg of assemble(code + '\n        HLT').segments) m.load(seg.address, seg.bytes);
    setup(m);
    expect(m.run({ cycles: 100_000 }).kind).toBe('halt');
    return { m, display };
  }

  it('"Plot a pixel" plots at (7, 5)', () => {
    const { display } = run('Plot a pixel');
    expect(display.vram[5 * 32 + 7]).toBe(14);
    expect(display.vram.filter((v) => v !== 0).length).toBe(1);
  });

  it('"Multiply by 10" multiplies', () => {
    const { m } = run('Multiply by 10', (machine) => (machine.cpu.a = 7));
    expect(m.cpu.a).toBe(70);
  });
});
