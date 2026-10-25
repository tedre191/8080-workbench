// The Reference tab as Markdown, for docs/REFERENCE.md, so it can be read on
// GitHub. A test checks that file is up to date, and
// `pnpm --filter @i8080/web test -u` rewrites it.
import { Display } from '@i8080/core';
import {
  CONDITION_ROWS,
  FLAG_ROWS,
  INSTRUCTION_GROUPS,
  machineRows,
  OPERAND_KEY,
  SNIPPETS,
  SYNTAX_ROWS,
  type MachineDevices,
} from './reference';

// Table cells can't hold a raw `|`, even inside code.
const cell = (text: string) => text.replaceAll('|', '\\|');
const code = (text: string) => '`' + cell(text) + '`';

function table(head: string[], rows: string[][]) {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

const keyValue = (head: [string, string], rows: [string, string][]) =>
  table(
    head,
    rows.map(([term, meaning]) => [code(term), cell(meaning)]),
  );

export function referenceMarkdown(devices: MachineDevices) {
  const hex = (rgb: number) => rgb.toString(16).padStart(6, '0').toUpperCase();
  const sections = [
    '# 8080 Workbench reference',
    'This is the Reference tab of the workbench (F1), generated from the same tables.',
    '## Instructions',
    keyValue(['Operand', 'Means'], OPERAND_KEY),
    'Cycles are clock cycles (T-states).',
    ...INSTRUCTION_GROUPS.flatMap((group) => [
      `### ${group.title}`,
      table(
        ['Syntax', 'Does', 'Flags', 'Cycles'],
        group.rows.map((row) => [code(row.syntax), cell(row.summary), cell(row.flags), row.cycles]),
      ),
    ]),
    '## Flags and conditions',
    keyValue(['Flag', 'Means'], FLAG_ROWS),
    '### Conditions for Jcc, Ccc and Rcc',
    table(
      ['cc', 'When', 'After CMP x or CPI x'],
      CONDITION_ROWS.map((row) => [code(row.cc), row.flag, cell(row.afterCompare)]),
    ),
    '## Assembler syntax',
    keyValue(['Syntax', 'Means'], SYNTAX_ROWS),
    '## This machine',
    keyValue(['Port or address', 'Does'], machineRows(devices)),
    '### Display colours',
    table(
      ['Colour', 'RGB'],
      Display.PALETTE.map((rgb, i) => [String(i), `\`#${hex(rgb)}\``]),
    ),
    '## Snippets',
    ...SNIPPETS.flatMap((snippet) => [
      `### ${snippet.title}`,
      snippet.note,
      '```asm\n' + snippet.code + '\n```',
    ]),
  ];
  return sections.join('\n\n') + '\n';
}
