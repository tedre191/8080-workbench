// The code editor: a transparent textarea over a syntax-highlighted copy of
// the text, with line numbers that double as breakpoint toggles,
// autocomplete and automatic indentation.

import type { AssembleResult } from '@i8080/core';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { complete, scanSymbols, type CompletionResult } from '../completion';
import { cx } from '../cx';
import { column, indent, newline, outdent, type Edit } from '../editing';
import { highlightLine } from '../highlight';
import type { Session } from '../session';
import { CompletionPopup } from './CompletionPopup';

interface Props {
  session: Session;
  source: string;
  live: AssembleResult; // the current text, assembled: for errors and symbol values
  onChange(source: string): void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

// These match the editor's CSS.
const LINE_HEIGHT = 20;
const PADDING_TOP = 8;
const PADDING_LEFT = 14;
const POPUP_WIDTH = 320;

const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

interface Suggestions {
  result: CompletionResult;
  selected: number;
  position: { x: number; y: number };
}

export function Editor({ session, source, live, onChange, inputRef }: Props) {
  const ownTextarea = useRef<HTMLTextAreaElement>(null);
  const textarea = inputRef ?? ownTextarea;
  const scroller = useRef<HTMLDivElement>(null);
  const codeArea = useRef<HTMLDivElement>(null);
  const charMeasure = useRef<HTMLSpanElement>(null);
  const [charWidth, setCharWidth] = useState(7.8);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  // Where to put the selection after we change the text ourselves.
  const nextSelection = useRef<[number, number] | null>(null);

  const lines = useMemo(() => source.split('\n'), [source]);
  const highlighted = useMemo(() => lines.map(highlightLine), [lines]);

  const program = session.program;
  const errors = new Map(live.errors.map((error) => [error.line, error.message]));
  const linesWithCode = useMemo(
    () =>
      new Set(
        program?.listing.filter((entry) => entry.bytes.length > 0).map((entry) => entry.line),
      ),
    [program],
  );
  // Only mark the current line if the machine is running this exact text.
  const currentLine =
    session.programSource === source
      ? program?.addressToLine.get(session.machine.cpu.pc)
      : undefined;

  useLayoutEffect(() => {
    const width = charMeasure.current?.getBoundingClientRect().width;
    if (width) setCharWidth(width / 64);
  }, []);

  useLayoutEffect(() => {
    if (nextSelection.current && textarea.current) {
      textarea.current.setSelectionRange(...nextSelection.current);
      nextSelection.current = null;
    }
    // Runs after each change to the text, so `source` is the trigger.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [source, textarea]);

  const apply = (edit: Edit) => {
    nextSelection.current = [edit.start, edit.end];
    onChange(edit.text);
  };

  // Place the list under the word being completed, but inside the visible area.
  const suggestionPosition = (text: string, from: number) => {
    const line = text.slice(0, from).split('\n').length - 1;
    let x = PADDING_LEFT + column(text, from) * charWidth - 6;
    if (scroller.current && codeArea.current) {
      const { scrollLeft, clientWidth } = scroller.current;
      const visibleRight = scrollLeft + clientWidth - codeArea.current.offsetLeft;
      x = Math.max(scrollLeft, Math.min(x, visibleRight - POPUP_WIDTH - 8));
    }
    return { x, y: PADDING_TOP + (line + 1) * LINE_HEIGHT + 2 };
  };

  const showSuggestions = (
    text: string,
    cursor: number,
    { explicit = false, onlyRegisters = false } = {},
  ) => {
    const result = complete(text, cursor, scanSymbols(text, live.symbols), { explicit });
    if (!result || (onlyRegisters && !result.registersOnly)) {
      setSuggestions(null);
      return;
    }
    setSuggestions({ result, selected: 0, position: suggestionPosition(text, result.from) });
  };

  const acceptSuggestion = (index: number) => {
    if (!suggestions) return;
    const { from, to, items } = suggestions.result;
    const insert = items[index].insert;
    const text = source.slice(0, from) + insert + source.slice(to);
    const cursor = from + insert.length;
    apply({ text, start: cursor, end: cursor });

    // After an instruction like "MOV ", offer its registers straight away.
    if (insert.endsWith(' ')) showSuggestions(text, cursor, { onlyRegisters: true });
    else setSuggestions(null);
  };

  const onInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    const cursor = event.target.selectionStart;
    onChange(text);

    const typedOneChar = text.length === source.length + 1;
    const typed = typedOneChar ? text[cursor - 1] : '';
    if (/[\w.?@$]/.test(typed)) {
      showSuggestions(text, cursor);
    } else if (typed === ' ' || typed === ',') {
      showSuggestions(text, cursor, { onlyRegisters: true });
    } else if (suggestions && text.length < source.length) {
      showSuggestions(text, cursor); // backspace narrows the list
    } else {
      setSuggestions(null);
    }
  };

  // Keys for the open suggestion list. Returns true if the key was used.
  const onSuggestionKey = (event: React.KeyboardEvent, open: Suggestions) => {
    const count = open.result.items.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSuggestions({ ...open, selected: (open.selected + step + count) % count });
        return true;
      }
      case 'Enter':
      case 'Tab':
        acceptSuggestion(open.selected);
        return true;
      case 'Escape':
        event.stopPropagation();
        setSuggestions(null);
        return true;
    }
    if (NAVIGATION_KEYS.has(event.key)) setSuggestions(null);
    return false;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions && onSuggestionKey(event, suggestions)) {
      event.preventDefault();
      return;
    }

    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    const modified = event.ctrlKey || event.metaKey || event.altKey;
    if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
      event.preventDefault();
      showSuggestions(source, start, { explicit: true });
    } else if (!modified && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      apply(newline(source, start, end));
    } else if (!modified && event.key === 'Tab') {
      event.preventDefault();
      apply(event.shiftKey ? outdent(source, start, end) : indent(source, start, end));
    }
  };

  return (
    <div className="editor">
      <div className="editor-scroll" ref={scroller}>
        <div className="editor-gutter">
          {lines.map((_, i) => {
            const line = i + 1;
            return (
              <button
                key={line}
                className={cx(
                  'gutter-line',
                  session.lineBreakpoints.has(line) && 'has-bp',
                  line === currentLine && 'is-pc',
                  errors.has(line) && 'has-error',
                  linesWithCode.has(line) && 'is-code',
                )}
                title={
                  errors.get(line) ?? (linesWithCode.has(line) ? 'Toggle breakpoint' : undefined)
                }
                tabIndex={-1}
                onClick={() => session.toggleLineBreakpoint(line)}
              >
                {line}
              </button>
            );
          })}
        </div>

        <div className="editor-code" ref={codeArea}>
          <span ref={charMeasure} className="editor-measure" aria-hidden="true">
            {'x'.repeat(64)}
          </span>
          <pre className="editor-highlight" aria-hidden="true">
            {highlighted.map((content, i) => (
              <div
                key={i}
                className={cx(
                  'code-line',
                  i + 1 === currentLine && 'is-pc',
                  errors.has(i + 1) && 'has-error',
                )}
              >
                {content}
                {'\n'}
              </div>
            ))}
          </pre>
          <textarea
            ref={textarea}
            className="editor-input"
            value={source}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            wrap="off"
            aria-label="Assembly source. Ctrl+Space for suggestions."
            aria-autocomplete="list"
            aria-controls={suggestions ? 'completion-list' : undefined}
            aria-activedescendant={suggestions ? `completion-${suggestions.selected}` : undefined}
            onChange={onInput}
            onKeyDown={onKeyDown}
            onBlur={() => setSuggestions(null)}
            onMouseDown={() => setSuggestions(null)}
            style={{ height: `calc(${lines.length} * var(--code-lh) + 2 * var(--pad-code))` }}
          />
          {suggestions && (
            <CompletionPopup
              items={suggestions.result.items}
              selected={suggestions.selected}
              {...suggestions.position}
              onPick={acceptSuggestion}
              onHover={(selected) => setSuggestions({ ...suggestions, selected })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
