import { useState } from 'react';
import { cx } from '../cx';

interface Props {
  value: number;
  digits: 2 | 4;
  onCommit(value: number): void;
  className?: string;
  label: string;
  disabled?: boolean;
  // For a grid of fields with one tab stop, like the memory view.
  tabIndex?: number;
  onFocus?(): void;
  address?: number; // set as data-address, to find the field again
}

// A hex value that turns into an input when clicked.
export function HexField({
  value,
  digits,
  onCommit,
  className,
  label,
  disabled,
  tabIndex,
  onFocus,
  address,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = value.toString(16).toUpperCase().padStart(digits, '0');

  if (draft === null) {
    return (
      <button
        className={cx('hexfield', className)}
        aria-label={`${label}: ${text}h. Click to edit`}
        disabled={disabled}
        tabIndex={tabIndex}
        data-address={address}
        onFocus={onFocus}
        onClick={() => setDraft(text)}
      >
        {text}
      </button>
    );
  }
  const commit = () => {
    const parsed = parseInt(draft, 16);
    if (!Number.isNaN(parsed)) onCommit(parsed & (digits === 2 ? 0xff : 0xffff));
    setDraft(null);
  };
  return (
    <input
      className={cx('hexfield', 'editing', className)}
      aria-label={label}
      autoFocus
      autoComplete="off"
      data-1p-ignore
      value={draft}
      maxLength={digits}
      size={digits}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setDraft(event.target.value.replace(/[^0-9a-f]/gi, ''))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}
