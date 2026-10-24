import { useEffect, useRef } from 'react';
import type { Session } from '../session';

const KEYS: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27 };

// The byte a key press sends to the terminal, if any (Ctrl+letter sends a control code).
export function terminalKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): number | undefined {
  const { key } = event;
  if (event.metaKey || event.altKey) return undefined;
  if (event.ctrlKey) {
    // Ctrl+A is 1, Ctrl+B is 2, ... Ctrl+Z is 26.
    return /^[a-z]$/i.test(key) ? key.toUpperCase().charCodeAt(0) - 64 : undefined;
  }
  if (key in KEYS) return KEYS[key];
  return key.length === 1 ? key.charCodeAt(0) & 0xff : undefined;
}

export function TerminalView({ session }: { session: Session }) {
  const ref = useRef<HTMLDivElement>(null);
  const touchInput = useRef<HTMLTextAreaElement>(null);
  const text = session.terminalText;

  // Keep the newest output in view.
  useEffect(() => {
    if (text === '') return;
    const element = ref.current!;
    element.scrollTop = element.scrollHeight;
  }, [text]);

  // Typing on an on-screen keyboard. Keys that `onKeyDown` knows are sent and
  // cancelled there. The rest (Android keyboards report most keys as
  // "Unidentified") arrive as edits to the hidden text field: whatever text
  // lands in it is sent and cleared, once the keyboard has finished composing
  // a word. Enter and Backspace leave nothing in the field, so they're caught
  // as they happen.
  useEffect(() => {
    const input = touchInput.current!;
    const send = () => {
      for (const char of input.value) session.terminal.send(char.charCodeAt(0) & 0xff);
      input.value = '';
    };
    const onBeforeInput = (event: InputEvent) => {
      const key =
        event.inputType === 'deleteContentBackward'
          ? KEYS.Backspace
          : event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph'
            ? KEYS.Enter
            : undefined;
      if (key === undefined) return;
      event.preventDefault();
      session.terminal.send(key);
    };
    const onInput = (event: Event) => {
      if (!(event as InputEvent).isComposing) send();
    };
    input.addEventListener('beforeinput', onBeforeInput);
    input.addEventListener('input', onInput);
    input.addEventListener('compositionend', send);
    return () => {
      input.removeEventListener('beforeinput', onBeforeInput);
      input.removeEventListener('input', onInput);
      input.removeEventListener('compositionend', send);
    };
  }, [session]);

  // A touch screen has no keyboard until a text field has focus, so a tap on
  // the terminal focuses the hidden one.
  const onPointerUp = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch') touchInput.current!.focus({ preventScroll: true });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const byte = terminalKey(event);
    if (byte === undefined) return;
    event.preventDefault();
    event.stopPropagation(); // handled here, so the app doesn't forward it again
    session.terminal.send(byte);
  };

  return (
    <div
      ref={ref}
      className="terminal"
      tabIndex={0}
      role="log"
      aria-label="Terminal. Focus it and type to send keys."
      onKeyDown={onKeyDown}
      onPointerUp={onPointerUp}
      onPaste={(event) => {
        event.preventDefault();
        session.terminal.send(event.clipboardData.getData('text').replace(/\r?\n/g, '\r'));
      }}
    >
      <textarea
        ref={touchInput}
        className="terminal-touch-input"
        tabIndex={-1}
        aria-label="Type to the terminal"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {text}
      <span className="cursor" />
      {!text && (
        <span className="terminal-hint">
          Program output appears here. While running, typing sends keys.
        </span>
      )}
    </div>
  );
}
