import { describe, expect, it } from 'vitest';
import { indent, indentAfter, newline, outdent } from '../src/editing';
import { shiftLines } from '../src/session';

describe('indentAfter', () => {
  it('lines instructions up after labels', () => {
    expect(indentAfter('loop:')).toBe(' '.repeat(8));
    expect(indentAfter('loop:   DCR B')).toBe(' '.repeat(8));
    expect(indentAfter('dly2    DCX H')).toBe(' '.repeat(8));
    expect(indentAfter('isprime:  MVI D, 2')).toBe(' '.repeat(10));
  });

  it('keeps the current indentation', () => {
    expect(indentAfter('        MOV A, B')).toBe(' '.repeat(8));
    expect(indentAfter('\tMOV A, B')).toBe(' '.repeat(8));
    expect(indentAfter('    ')).toBe(' '.repeat(4));
  });

  it('stays in column 0 for constants and top-level comments', () => {
    expect(indentAfter('COUNT   EQU 3')).toBe('');
    expect(indentAfter('X = 5')).toBe('');
    expect(indentAfter('; A comment')).toBe('');
    expect(indentAfter('')).toBe('');
  });
});

describe('editing commands', () => {
  it('newline indents and places the caret', () => {
    const e = newline('loop:\nnext', 5, 5);
    expect(e.text).toBe('loop:\n        \nnext');
    expect(e.start).toBe(14);
  });

  it('tab pads to the next tab stop', () => {
    expect(indent('ab', 2, 2)).toEqual({ text: 'ab      ', start: 8, end: 8 });
    expect(indent('loop:', 5, 5).text).toBe('loop:   ');
  });

  it('indents and outdents selected lines', () => {
    const src = 'NOP\nNOP';
    const e = indent(src, 0, src.length);
    expect(e.text).toBe('        NOP\n        NOP');
    expect(outdent(e.text, e.start, e.end).text).toBe(src);
    expect(outdent('  MOV A,B', 5, 5)).toEqual({ text: 'MOV A,B', start: 3, end: 3 });
  });
});

describe('shiftLines', () => {
  it('moves breakpoints below an inserted or removed line', () => {
    const before = 'a\nb\nc\nd';
    expect([...shiftLines(new Set([1, 3]), before, 'a\nnew\nb\nc\nd')]).toEqual([1, 4]);
    expect([...shiftLines(new Set([1, 3]), before, 'a\nc\nd')]).toEqual([1, 2]);
    // A newline typed at the start of line 3 moves its code (and breakpoint) down.
    expect([...shiftLines(new Set([3]), before, 'a\nb\n\nc\nd')]).toEqual([4]);
  });
});
