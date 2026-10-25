import { useState } from 'react';

interface Props {
  onGo(address: number): void;
  resolve(text: string): number | undefined;
}

// A "Go to…" box that takes a hex address or a label.
export function AddressInput({ onGo, resolve }: Props) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const address = resolve(text.trim());
    setInvalid(address === undefined);
    if (address !== undefined) onGo(address);
  };

  return (
    <form className="addr-input" onSubmit={submit}>
      <input
        aria-label="Go to address or label"
        autoComplete="off"
        data-1p-ignore
        placeholder="Go to…"
        value={text}
        className={invalid ? 'bad' : ''}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
      />
    </form>
  );
}

// Read user input as a label (ignoring case) or a hex address like 1F00, 1F00h, 0x1F00 or $1F00.
export function resolveAddress(text: string, symbols?: Map<string, number>) {
  if (!text) return undefined;
  for (const [name, value] of symbols ?? []) {
    if (name.toLowerCase() === text.toLowerCase()) return value & 0xffff;
  }
  const digits = text.replace(/^0x|^\$|h$/gi, '');
  return /^[0-9a-f]{1,4}$/i.test(digits) ? parseInt(digits, 16) : undefined;
}
