// The code editor: a transparent textarea over a syntax-highlighted copy of
// the text, with line numbers that double as breakpoint toggles,
// autocomplete and automatic indentation.

import type { AssembleResult } from '@i8080/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { complete, scanSymbols, type CompletionResult } from '../completion';
import { cx } from '../cx';
import { indent, newline, outdent, type Edit } from '../editing';
import { highlightLine } from '../highlight';
import type { Session } from '../session';
import { CompletionPopup } from './CompletionPopup';

interface Props {
  session: Session;
  source: string;
  live: AssembleResult; // the current text, assembled: for errors and symbol values
  onChange(source: string): void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  // Wrap long lines to the width of the pane, instead of scrolling sideways.
  wrap: boolean;
}

// These match the editor's CSS.
const LINE_HEIGHT = 20;
const POPUP_WIDTH = 320;

const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

// True while `replaceText` is changing the text, so the input event it causes
// isn't mistaken for typing.
let replacing = false;

// Change the textarea's text to `text` as if it were typed, so the browser's
// undo history keeps working. (Setting `value` from code clears it.) Only the
// part that differs is replaced. `onChange` is the fallback for browsers
// without `insertText`.
export function replaceText(
  textarea: HTMLTextAreaElement,
  text: string,
  onChange: (text: string) => void,
) {
  const old = textarea.value;
  let start = 0;
  while (start < old.length && start < text.length && old[start] === text[start]) start++;
  let end = 0;
  while (
    end < old.length - start &&
    end < text.length - start &&
    old.at(-1 - end) === text.at(-1 - end)
  ) {
    end++;
  }
  if (start === old.length && start === text.length) return;

  textarea.focus();
  textarea.setSelectionRange(start, old.length - end);
  replacing = true;
  try {
    const insert = text.slice(start, text.length - end);
    const inserted = insert
      ? document.execCommand('insertText', false, insert)
      : document.execCommand('delete');
    if (!inserted || textarea.value !== text) onChange(text);
  } finally {
    replacing = false;
  }
}

interface Suggestions {
  result: CompletionResult;
  selected: number;
}

// Where the character at `column` of a highlighted line is drawn, as a
// rectangle on the page, or undefined for an empty line. (The highlighted copy
// of the text is drawn exactly where the textarea's text is.)
function characterRect(line: Element, column: number): DOMRect | undefined {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let last: Text | undefined;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // Every line ends with a newline that isn't part of the source.
    const length = node.data.endsWith('\n') ? node.data.length - 1 : node.data.length;
    if (column < length) {
      const range = document.createRange();
      range.setStart(node, column);
      range.setEnd(node, column + 1);
      return range.getBoundingClientRect();
    }
    column -= length;
    if (length > 0) last = node;
  }
  if (!last) return undefined;
  // Past the end of the line: just after its last character.
  const end = last.data.endsWith('\n') ? last.data.length - 1 : last.data.length;
  const range = document.createRange();
  range.setStart(last, end - 1);
  range.setEnd(last, end);
  const rect = range.getBoundingClientRect();
  return new DOMRect(rect.right, rect.top, 0, rect.height);
}

export function Editor({ session, source, live, onChange, inputRef, wrap }: Props) {
  const ownTextarea = useRef<HTMLTextAreaElement>(null);
  const textarea = inputRef ?? ownTextarea;
  const scroller = useRef<HTMLDivElement>(null);
  const codeArea = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  // Each line's height when wrapping, so the line numbers can line up.
  const [lineHeights, setLineHeights] = useState<number[] | null>(null);
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

  // Keep the current line in view whenever the UI follows each instruction:
  // when paused, stepping, or running slowly. Only when the line moves within
  // the same program, though, not when one is loaded: that happens as you
  // type, and the page should open at the top.
  const followsPc = session.highlightsChanges;
  const shown = useRef<{ program: AssembleResult | null; line?: number }>(undefined);
  useEffect(() => {
    if (!followsPc) return;
    const last = shown.current;
    shown.current = { program, line: currentLine };
    if (!last || last.program !== program || last.line === currentLine) return;
    const line = currentLine && highlight.current?.children[currentLine - 1];
    const element = scroller.current;
    if (!line || !element) return;
    const { offsetTop: top, offsetHeight: height } = line as HTMLElement;
    const visible =
      top >= element.scrollTop && top + height <= element.scrollTop + element.clientHeight;
    if (!visible) element.scrollTop = top - element.clientHeight / 3;
  }, [currentLine, followsPc, program]);

  // When wrapping, measure how tall each line is drawn, whenever the text or
  // the pane's width changes.
  useLayoutEffect(() => {
    if (!wrap) return;
    const pre = highlight.current!;
    const measure = () => {
      const heights = Array.from(pre.children, (line) => (line as HTMLElement).offsetHeight);
      setLineHeights((before) =>
        before?.length === heights.length && before.every((h, i) => h === heights[i])
          ? before
          : heights,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pre);
    return () => observer.disconnect();
    // `highlighted` isn't read, but the lines need measuring again when it changes.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [wrap, highlighted]);

  // Place the suggestion list under the word being completed, but inside the
  // visible area. This is measured once the new text has been drawn.
  const suggestionFrom = suggestions?.result.from;
  useLayoutEffect(() => {
    if (suggestionFrom === undefined) return;
    const before = source.slice(0, suggestionFrom);
    const lineIndex = before.split('\n').length - 1;
    const column = suggestionFrom - (before.lastIndexOf('\n') + 1);
    const line = highlight.current!.children[lineIndex];
    const area = codeArea.current!.getBoundingClientRect();
    const char = characterRect(line, column);
    const lineRect = line.getBoundingClientRect();
    let x = (char ? char.left : lineRect.left) - area.left - 6;
    const y = (char ? char.bottom : lineRect.top + LINE_HEIGHT) - area.top + 2;
    const { scrollLeft, clientWidth } = scroller.current!;
    const visibleRight = scrollLeft + clientWidth - codeArea.current!.offsetLeft;
    x = Math.max(scrollLeft, Math.min(x, visibleRight - POPUP_WIDTH - 8));
    setPopupPosition({ x, y });
  }, [suggestionFrom, source]);

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
    replaceText(textarea.current!, edit.text, onChange);
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
    setSuggestions({ result, selected: 0 });
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
    // Our own edits (see `replaceText`) handle suggestions themselves.
    if (replacing) return;

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
    <div className={cx('editor', wrap && 'wrap')}>
      <div className="editor-scroll" ref={scroller}>
        <div className="editor-gutter">
          {lines.map((_, i) => {
            const line = i + 1;
            // A wrapped line's number stays at the top of its rows.
            const height = (wrap && lineHeights?.[i]) || LINE_HEIGHT;
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
                style={
                  height > LINE_HEIGHT ? { height, paddingBottom: height - LINE_HEIGHT } : undefined
                }
                onClick={() => session.toggleLineBreakpoint(line)}
              >
                {line}
              </button>
            );
          })}
        </div>

        <div className="editor-code" ref={codeArea}>
          <pre ref={highlight} className="editor-highlight" aria-hidden="true">
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
            wrap={wrap ? 'soft' : 'off'}
            aria-label="Assembly source. Ctrl+Space for suggestions."
            aria-autocomplete="list"
            aria-controls={suggestions ? 'completion-list' : undefined}
            aria-activedescendant={suggestions ? `completion-${suggestions.selected}` : undefined}
            onChange={onInput}
            onKeyDown={onKeyDown}
            onBlur={() => setSuggestions(null)}
            onMouseDown={() => setSuggestions(null)}
            style={
              wrap
                ? undefined
                : { height: `calc(${lines.length} * var(--code-lh) + 2 * var(--pad-code))` }
            }
          />
          {suggestions && (
            <CompletionPopup
              items={suggestions.result.items}
              selected={suggestions.selected}
              {...popupPosition}
              onPick={acceptSuggestion}
              onHover={(selected) => setSuggestions({ ...suggestions, selected })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
