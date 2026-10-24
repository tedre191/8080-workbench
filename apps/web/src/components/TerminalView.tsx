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
  const text = session.terminalText;

  // Keep the newest output in view.
  useEffect(() => {
    if (text === '') return;
    const element = ref.current!;
    element.scrollTop = element.scrollHeight;
  }, [text]);

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
      onPaste={(event) => {
        event.preventDefault();
        session.terminal.send(event.clipboardData.getData('text').replace(/\r?\n/g, '\r'));
      }}
    >
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
