// Content for the Reference tab. Instruction rows are generated from the
// core library's tables so they always match the assembler; only the
// grouping, the condition table and the snippets are written by hand.
import { CONDITIONS, DIRECTIVE_DOCS, formatTiming, INSTRUCTION_DOCS } from '@i8080/core';

export interface InstructionRow {
  // e.g. `MVI r, d8`, or `Jcc addr` for a family of conditional instructions.
  syntax: string;
  summary: string;
  flags: string;
  cycles: string;
  // Every mnemonic the row covers, for search.
  mnemonics: string[];
}

export interface InstructionGroup {
  title: string;
  rows: InstructionRow[];
}

// Conditional families shown as one row each: `Jcc` stands for JZ, JNZ, JC...
const FAMILIES: Record<string, { syntax: string; summary: string }> = {
  J: { syntax: 'Jcc addr', summary: 'Jump to addr if the condition holds.' },
  C: { syntax: 'Ccc addr', summary: 'Call addr if the condition holds.' },
  R: { syntax: 'Rcc', summary: 'Return if the condition holds.' },
};

const GROUPS: [title: string, mnemonics: string[]][] = [
  ['Move and load', ['MOV', 'MVI', 'LXI', 'LDA', 'STA', 'LHLD', 'SHLD', 'LDAX', 'STAX', 'XCHG']],
  [
    'Arithmetic',
    [
      'ADD',
      'ADI',
      'ADC',
      'ACI',
      'SUB',
      'SUI',
      'SBB',
      'SBI',
      'INR',
      'DCR',
      'INX',
      'DCX',
      'DAD',
      'DAA',
    ],
  ],
  [
    'Logic and compare',
    ['ANA', 'ANI', 'ORA', 'ORI', 'XRA', 'XRI', 'CMP', 'CPI', 'CMA', 'STC', 'CMC'],
  ],
  ['Rotate', ['RLC', 'RRC', 'RAL', 'RAR']],
  ['Jump, call and return', ['JMP', 'J*', 'CALL', 'C*', 'RET', 'R*', 'RST', 'PCHL']],
  ['Stack', ['PUSH', 'POP', 'XTHL', 'SPHL']],
  ['I/O and control', ['IN', 'OUT', 'EI', 'DI', 'HLT', 'NOP']],
];

function row(mnemonic: string): InstructionRow {
  if (mnemonic.endsWith('*')) {
    const prefix = mnemonic[0];
    const family = FAMILIES[prefix];
    const members = CONDITIONS.map((cc) => prefix + cc);
    return { ...family, flags: 'none', cycles: formatTiming(members[0]), mnemonics: members };
  }
  const doc = INSTRUCTION_DOCS[mnemonic];
  return {
    syntax: doc.syntax,
    summary: doc.summary,
    flags: doc.flags,
    cycles: formatTiming(mnemonic),
    mnemonics: [mnemonic],
  };
}

export const INSTRUCTION_GROUPS: InstructionGroup[] = GROUPS.map(([title, ms]) => ({
  title,
  rows: ms.map(row),
}));

export const OPERAND_KEY: [string, string][] = [
  ['r', 'A B C D E H L, or M for the byte at the address in HL'],
  ['rp', 'register pair: B (BC), D (DE), H (HL), SP; PUSH/POP use PSW (A + flags) instead of SP'],
  ['d8, d16', '8- or 16-bit value: a number, label, constant or expression'],
  ['addr', 'a 16-bit address, usually a label'],
  ['port', 'I/O port number, 0–255'],
];

export interface ConditionRow {
  cc: string;
  flag: string;
  // What it means right after `CMP x` / `CPI x`.
  afterCompare: string;
}

export const CONDITION_ROWS: ConditionRow[] = [
  { cc: 'Z', flag: 'Z = 1', afterCompare: 'A = x' },
  { cc: 'NZ', flag: 'Z = 0', afterCompare: 'A ≠ x' },
  { cc: 'C', flag: 'CY = 1', afterCompare: 'A < x (unsigned)' },
  { cc: 'NC', flag: 'CY = 0', afterCompare: 'A ≥ x (unsigned)' },
  { cc: 'M', flag: 'S = 1', afterCompare: 'A − x is negative (bit 7 set)' },
  { cc: 'P', flag: 'S = 0', afterCompare: 'A − x is positive or zero' },
  { cc: 'PE', flag: 'P = 1', afterCompare: 'result has even parity' },
  { cc: 'PO', flag: 'P = 0', afterCompare: 'result has odd parity' },
];

export const FLAG_ROWS: [string, string][] = [
  ['S', 'Sign: bit 7 of the result'],
  ['Z', 'Zero: the result was 0'],
  ['AC', 'Auxiliary carry out of bit 3, used by DAA'],
  ['P', 'Parity: the result has an even number of 1 bits'],
  ['CY', 'Carry out of bit 7, or a borrow on subtract and compare'],
];

export const SYNTAX_ROWS: [string, string][] = [
  ['label:', 'Names the address of the next instruction. The colon is optional in column 0.'],
  ['; text', 'Comment, to the end of the line.'],
  ['42  2Ah  0x2A  $2A', 'Decimal and hex. Hex with h must start with a digit: 0FFh, not FFh.'],
  ['101010b  52o', 'Binary and octal.'],
  ['\'A\'  "Hi"', 'A character is its ASCII code; strings work in DB.'],
  ['$', 'The address of the current instruction.'],
  ['+ - * / % << >> & | ^ ~', 'Arithmetic and bitwise operators, with parentheses.'],
  ['HIGH x  LOW x', 'The high or low byte of a 16-bit value.'],
  ...Object.values(DIRECTIVE_DOCS).map((doc): [string, string] => [doc.syntax, doc.summary]),
];

export interface Snippet {
  title: string;
  // What it's for, in a sentence.
  note: string;
  code: string;
  // A whole program (it uses ORG 0), so it opens as a new program rather than being inserted.
  program?: boolean;
}

// Common patterns, each assembling on its own (a test checks).
export const SNIPPETS: Snippet[] = [
  {
    title: 'Counted loop',
    note: 'Repeat something up to 255 times, counting down in B.',
    code: `        MVI B, 10           ; repeat 10 times
loop:   ; ...your code...
        DCR B
        JNZ loop`,
  },
  {
    title: '16-bit loop or delay',
    note: 'Count BC down from up to 65535. DCX sets no flags, so test for zero by hand.',
    code: `        LXI B, 1000         ; 1000 x 24 T-states = 12 ms at 2 MHz
delay:  DCX B
        MOV A, B
        ORA C
        JNZ delay`,
  },
  {
    title: 'Compare and branch',
    note: 'Compare A with a value and go three ways.',
    code: `        CPI 10              ; compare A with 10
        JZ equal            ; A = 10
        JC less             ; A < 10
more:   ; A > 10
        JMP done
less:   ; A < 10
        JMP done
equal:  ; A = 10
done:`,
  },
  {
    title: 'Print a string',
    note: 'Send a zero-terminated string to the terminal.',
    code: `        LXI H, message
        CALL print
        HLT

; Print the zero-terminated string at HL.
print:  MOV A, M
        ORA A
        RZ
        OUT 11h             ; terminal data port
        INX H
        JMP print

message:
        DB "Hello!", 10, 0`,
  },
  {
    title: 'Wait for a key',
    note: 'Poll the terminal until a key arrives, then read it into A.',
    code: `waitkey:
        IN 10h              ; terminal status
        ANI 01h             ; bit 0: a key is waiting
        JZ waitkey
        IN 11h              ; A = the key`,
  },
  {
    title: 'Switches to LEDs',
    note: 'Read the switches and show them on the LEDs.',
    code: `        IN 21h              ; A = switch positions
        OUT 20h             ; light the LEDs to match`,
  },
  {
    title: 'Plot a pixel',
    note: 'Set the pixel at (x, y) on the 32x32 display to a colour.',
    code: `        MVI B, 5            ; y
        MVI C, 7            ; x
        MVI E, 14           ; colour (14 = yellow)
        MOV L, B            ; HL = F000h + y * 32 + x
        MVI H, 0
        DAD H               ; y * 2
        DAD H               ; y * 4
        DAD H               ; y * 8
        DAD H               ; y * 16
        DAD H               ; y * 32
        MOV A, L
        ORA C               ; low 5 bits are free, so OR adds x
        MOV L, A
        MOV A, H
        ADI HIGH 0F000h
        MOV H, A
        MOV M, E`,
  },
  {
    title: 'Play a note',
    note: 'Play middle C for about a quarter of a second, then stop.',
    code: `        MVI A, 60           ; MIDI note 60 = middle C (69 = A 440 Hz)
        OUT 40h             ; start the note
        LXI B, 21000        ; about 250 ms at 2 MHz
delay:  DCX B
        MOV A, B
        ORA C
        JNZ delay
        XRA A
        OUT 40h             ; note 0 = silence`,
  },
  {
    title: 'Multiply by 10',
    note: 'Multiply A by a constant with shifts (adding A to itself) and adds.',
    code: `        MOV B, A
        ADD A               ; A * 2
        ADD A               ; A * 4
        ADD B               ; A * 5
        ADD A               ; A * 10`,
  },
  {
    title: 'Program with a timer interrupt',
    note: 'A whole program: the timer calls RST 1 (address 0008h) every 100 ms.',
    program: true,
    code: `        ORG 0
        JMP main

        ORG 08h             ; RST 1 lands here
tick:   PUSH PSW            ; save what the handler changes
        ; ...handle the tick...
        POP PSW
        EI                  ; interrupts are off on entry
        RET

main:   LXI SP, 0E000h
        MVI A, 100          ; tick every 100 ms
        OUT 30h
        EI
wait:   HLT                 ; sleep until an interrupt
        JMP wait`,
  },
];
