// Indentation for the assembly editor. Labels and constants go in column 0,
// instructions at the next 8-column tab stop, using spaces.

export const TAB = 8;

// The result of an edit: the new text and where the selection ends up.
export interface Edit {
  text: string;
  start: number;
  end: number;
}

const spaces = (count: number) => ' '.repeat(Math.max(0, count));

function lineStartOf(text: string, index: number) {
  return text.lastIndexOf('\n', index - 1) + 1;
}

// The column `index` appears at on screen, counting tabs as up to 8 spaces.
export function column(text: string, index: number) {
  let col = 0;
  for (let i = lineStartOf(text, index); i < index; i++) {
    col = text[i] === '\t' ? (Math.floor(col / TAB) + 1) * TAB : col + 1;
  }
  return col;
}

// How to indent the line after `line`:
//   after `loop:` on its own          the instruction column (8)
//   after `loop:  DCR B`              the column DCR starts at
//   after `COUNT EQU 3`               column 0, for the next constant
//   otherwise                         the same indentation as `line`
export function indentAfter(line: string) {
  const code = line.replace(/;.*/, '').trimEnd();
  const indentation = /^[ \t]*/.exec(line)![0];
  if (code.trim() === '' || indentation !== '') {
    return spaces(column(indentation, indentation.length));
  }

  const match = /^([A-Za-z_.?@][\w.?@$]*:?)([ \t]*)(\S*)/.exec(code);
  if (!match) return '';
  const [, label, gap, next] = match;
  if (/^(EQU|SET)$/i.test(next) || next.startsWith('=')) return '';
  if (next === '') return label.endsWith(':') ? spaces(TAB) : '';
  return spaces(column(label + gap, label.length + gap.length));
}

// Enter: start a new line, indented to suit the one above.
export function newline(text: string, start: number, end: number): Edit {
  const insert = '\n' + indentAfter(text.slice(lineStartOf(text, start), start));
  const cursor = start + insert.length;
  return { text: text.slice(0, start) + insert + text.slice(end), start: cursor, end: cursor };
}

// Tab: pad to the next tab stop, or indent every selected line.
export function indent(text: string, start: number, end: number): Edit {
  if (text.slice(start, end).includes('\n')) {
    return changeLines(text, start, end, (line) => spaces(TAB) + line);
  }

  const padding = spaces(TAB - (column(text, start) % TAB));
  const cursor = start + padding.length;
  return { text: text.slice(0, start) + padding + text.slice(end), start: cursor, end: cursor };
}

// Shift+Tab: remove up to one tab stop of indentation from every selected line.
export function outdent(text: string, start: number, end: number): Edit {
  return changeLines(text, start, end, (line) => {
    if (line.startsWith('\t')) return line.slice(1);
    let count = 0;
    while (count < TAB && line[count] === ' ') count++;
    return line.slice(count);
  });
}

// Apply `change` to every line the selection touches, keeping the selection
// on the same text.
function changeLines(
  text: string,
  start: number,
  end: number,
  change: (line: string) => string,
): Edit {
  const blockStart = lineStartOf(text, start);
  const newlineAfter = text.indexOf('\n', end);
  const blockEnd = newlineAfter === -1 ? text.length : newlineAfter;

  const lines = text.slice(blockStart, blockEnd).split('\n');
  const changed = lines.map(change);
  const block = changed.join('\n');
  const firstLineGrowth = changed[0].length - lines[0].length;
  const totalGrowth = block.length - (blockEnd - blockStart);

  return {
    text: text.slice(0, blockStart) + block + text.slice(blockEnd),
    start: Math.max(blockStart, start + firstLineGrowth),
    end: Math.max(blockStart, end + totalGrowth),
  };
}
