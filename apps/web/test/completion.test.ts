import { describe, expect, it } from 'vitest';
import { complete, scanSymbols } from '../src/completion';

// Complete at the `|` marker.
function at(text: string, explicit = false) {
  const cursor = text.indexOf('|');
  const source = text.replace('|', '');
  return complete(source, cursor, scanSymbols(source), { explicit });
}
const labels = (text: string, explicit = false) =>
  at(text, explicit)?.items.map((i) => i.label) ?? null;

describe('completion', () => {
  it('offers mnemonics at the start of a statement', () => {
    expect(labels('  MV|')).toEqual(['MVI']);
    expect(labels('loop: DC|')).toEqual(['DCR', 'DCX', 'ADC']);
    expect(labels('loop    DC|')).toEqual(['DCR', 'DCX', 'ADC']);
    expect(labels('  O|')!.slice(0, 4)).toEqual(['ORA', 'ORI', 'OUT', 'ORG']);
  });

  it('matches the case being typed', () => {
    const r = at('  mv|')!;
    expect(r.items[0].insert).toBe('mvi ');
    expect(labels('  lxi |')).toEqual(['b', 'd', 'h', 'sp']);
    expect(labels('  LXI S|')).toEqual(['SP']);
  });

  it('offers EQU after a column-0 name', () => {
    expect(labels('COUNT EQ|')).toContain('EQU');
    expect(labels('  EQ|')).toBeNull();
  });

  it('offers registers allowed by the instruction', () => {
    expect(labels('  MOV |')).toEqual(['B', 'C', 'D', 'E', 'H', 'L', 'M', 'A']);
    expect(labels('  MOV M, |')).toEqual(['B', 'C', 'D', 'E', 'H', 'L', 'A']);
    expect(labels('  LXI |')).toEqual(['B', 'D', 'H', 'SP']);
    expect(labels('  PUSH |')).toEqual(['B', 'D', 'H', 'PSW']);
    expect(at('  PUSH |')!.registersOnly).toBe(true);
  });

  it('offers symbols for address and data operands', () => {
    const src = 'COUNT EQU 3\nloop: NOP\nlast NOP\n  JMP l|';
    expect(labels(src)).toEqual(['loop', 'last', 'low']);
    expect(labels('VAL = 1\n  MVI A, V|')).toEqual(['VAL']);
    expect(labels('  MVI A, |')).toBeNull(); // no prefix, not explicit
    expect(labels('x: NOP\n  MVI A, |', true)).toEqual(['x', 'HIGH', 'LOW']);
  });

  it('stays quiet in comments, strings and numbers', () => {
    expect(labels('  NOP ; mv|')).toBeNull();
    expect(labels('  DB "mv|')).toBeNull();
    expect(labels('  MVI A, 0F|')).toBeNull();
  });

  it('replaces the whole word under the cursor', () => {
    const r = at('  MV|I A, 1')!;
    expect([r.from, r.to]).toEqual([2, 5]);
  });

  it('includes values from the last assemble', () => {
    const syms = scanSymbols('loop: NOP', new Map([['loop', 0x1234]]));
    expect(syms).toEqual([{ name: 'loop', kind: 'label', value: 0x1234 }]);
  });
});
