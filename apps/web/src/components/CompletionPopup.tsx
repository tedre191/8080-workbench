import { useEffect, useRef } from 'react';
import type { CompletionItem, CompletionKind } from '../completion';

const KIND_LABEL: Record<CompletionKind, string> = {
  instruction: 'op',
  directive: 'dir',
  register: 'reg',
  symbol: 'sym',
  operator: 'fn',
};

interface Props {
  items: CompletionItem[];
  selected: number;
  x: number;
  y: number;
  onPick(index: number): void;
  onHover(index: number): void;
}

export function CompletionPopup({ items, selected, x, y, onPick, onHover }: Props) {
  const list = useRef<HTMLUListElement>(null);
  const item = items[selected];

  // Keep the selected item in view while moving through the list with the arrow keys.
  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    // Keep focus in the textarea while clicking the popup.
    <div
      className="completion"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <ul
        ref={list}
        className="completion-list"
        role="listbox"
        id="completion-list"
        aria-label="Suggestions"
      >
        {items.map((option, i) => (
          <li
            key={option.kind + option.label}
            id={`completion-${i}`}
            role="option"
            aria-selected={i === selected}
            className={'completion-item kind-' + option.kind}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(i)}
          >
            <span className="completion-kind">{KIND_LABEL[option.kind]}</span>
            <span className="completion-label">{option.label}</span>
            <span className="completion-detail">{option.detail}</span>
          </li>
        ))}
      </ul>
      {item?.doc && (
        <div className="completion-doc">
          <div className="completion-doc-syntax">{item.detail}</div>
          {item.doc.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
