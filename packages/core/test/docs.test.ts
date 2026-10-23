import { expect, it } from 'vitest';
import { formatTiming, INSTRUCTION_DOCS, OPCODES } from '../src/index';

it('documents every documented mnemonic', () => {
  const mnemonics = new Set(OPCODES.filter((o) => !o.undocumented).map((o) => o.mnemonic));
  expect([...mnemonics].filter((m) => !INSTRUCTION_DOCS[m])).toEqual([]);
});

it('formats timing across operand forms and branches', () => {
  expect(formatTiming('MOV')).toBe('5–7');
  expect(formatTiming('CZ')).toBe('11–17');
  expect(formatTiming('XCHG')).toBe('4');
});
