// A hex view of all 64K. Only the rows on screen are rendered.

import { hex16, type Machine } from '@i8080/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../cx';
import type { Session } from '../session';
import { AddressInput, resolveAddress } from './AddressInput';
import { HexField } from './HexField';

const ROW_HEIGHT = 24; // also the size of each byte, so they're big enough to tap
// 16 bytes to a row, or 8 when the pane is too narrow to show 16 and their text.
const WIDE_ROW_BYTES = 16;
const NARROW_ROW_BYTES = 8;
const WIDE_ROW_WIDTH = 558; // a 16-byte row, in pixels
const NARROW_ROW_WIDTH = 330;

type Follow = 'none' | 'pc' | 'sp' | 'hl' | 'de' | 'bc';

export function Memory({ session }: { session: Session }) {
  const cpu = session.machine.cpu;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [view, setView] = useState({ width: 600, height: 300 });
  const [follow, setFollow] = useState<Follow>('none');
  // The bytes are one tab stop, moved between with the arrow keys: this byte
  // takes focus, or the first one on screen if it's scrolled away.
  const [focusAddress, setFocusAddress] = useState(0);
  const moveFocus = useRef(false);
  const rowBytes = view.width >= WIDE_ROW_WIDTH ? WIDE_ROW_BYTES : NARROW_ROW_BYTES;
  const rowCount = 0x10000 / rowBytes;

  useEffect(() => {
    const element = scroller.current!;
    const observer = new ResizeObserver(() =>
      setView({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // When the row length changes, keep the same address at the top.
  const lastRowBytes = useRef(rowBytes);
  useLayoutEffect(() => {
    const element = scroller.current!;
    const topAddress = Math.floor(element.scrollTop / ROW_HEIGHT) * lastRowBytes.current;
    lastRowBytes.current = rowBytes;
    element.scrollTop = Math.floor(topAddress / rowBytes) * ROW_HEIGHT;
  }, [rowBytes]);

  // When following a register, scroll to it whenever it moves off screen.
  const followed = follow === 'none' ? undefined : cpu[follow];
  useEffect(() => {
    const element = scroller.current!;
    if (followed === undefined) return;
    const y = Math.floor(followed / rowBytes) * ROW_HEIGHT;
    const visible =
      y >= element.scrollTop && y <= element.scrollTop + element.clientHeight - ROW_HEIGHT;
    if (!visible) scrollToAddress(element, followed, rowBytes);
  }, [followed, rowBytes]);

  const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
  const lastRow = Math.min(firstRow + Math.ceil(view.height / ROW_HEIGHT) + 1, rowCount);
  const onScreen = focusAddress >= firstRow * rowBytes && focusAddress < lastRow * rowBytes;
  const tabStop = onScreen ? focusAddress : firstRow * rowBytes;
  const rows = [];
  for (let row = firstRow; row < lastRow; row++) {
    rows.push(
      <MemoryRow
        key={row}
        session={session}
        address={row * rowBytes}
        rowBytes={rowBytes}
        tabStop={tabStop}
        onFocusByte={setFocusAddress}
      />,
    );
  }

  // After an arrow key, focus the byte it moved to once its row is drawn.
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    const byte = scroller.current!.querySelector<HTMLElement>(`[data-address="${focusAddress}"]`);
    if (!byte) return; // not drawn yet: the scroll to it is still coming
    moveFocus.current = false;
    byte.focus({ preventScroll: true });
    // `scrollTop` isn't read, but the byte may only be drawn after a scroll.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [focusAddress, scrollTop]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!(event.target instanceof HTMLButtonElement)) return; // not while editing a byte
    const pageRows = Math.max(1, Math.floor(view.height / ROW_HEIGHT) - 1);
    const rowStart = focusAddress - (focusAddress % rowBytes);
    const ctrl = event.ctrlKey || event.metaKey;
    const moves: Record<string, number> = {
      ArrowLeft: focusAddress - 1,
      ArrowRight: focusAddress + 1,
      ArrowUp: focusAddress - rowBytes,
      ArrowDown: focusAddress + rowBytes,
      PageUp: focusAddress - pageRows * rowBytes,
      PageDown: focusAddress + pageRows * rowBytes,
      Home: ctrl ? 0 : rowStart,
      End: ctrl ? 0xffff : rowStart + rowBytes - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const address = Math.max(0, Math.min(0xffff, moves[event.key]));
    moveFocus.current = true;
    setFocusAddress(address);

    // Scroll just enough to show its row.
    const element = scroller.current!;
    const y = Math.floor(address / rowBytes) * ROW_HEIGHT;
    if (y < element.scrollTop) element.scrollTop = y;
    else if (y + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = y + ROW_HEIGHT - element.clientHeight;
    }
  };

  return (
    <div className="memory">
      <div className="panel-tools">
        <AddressInput
          onGo={(address) => {
            setFollow('none');
            scrollToAddress(scroller.current!, address, rowBytes);
          }}
          resolve={(text) => resolveAddress(text, session.program?.symbols)}
        />
        <label className="select small">
          <span>Follow</span>
          <select value={follow} onChange={(event) => setFollow(event.target.value as Follow)}>
            <option value="none">nothing</option>
            <option value="pc">PC</option>
            <option value="sp">SP</option>
            <option value="hl">HL</option>
            <option value="de">DE</option>
            <option value="bc">BC</option>
          </select>
        </label>
        <span className="legend">
          <span className="key is-pc">PC</span>
          <span className="key is-sp">SP</span>
          <span className="key is-hl">HL</span>
          <span className="key changed">changed</span>
        </span>
      </div>
      <div
        className="mem-scroll"
        ref={scroller}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        <div
          className="mem-spacer"
          style={{
            height: rowCount * ROW_HEIGHT,
            minWidth: rowBytes === WIDE_ROW_BYTES ? WIDE_ROW_WIDTH : NARROW_ROW_WIDTH,
          }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}

// Scroll so the row holding `address` is near the top.
function scrollToAddress(element: HTMLElement, address: number, rowBytes: number) {
  const row = Math.floor(address / rowBytes);
  element.scrollTop = Math.max(0, (row - 2) * ROW_HEIGHT);
}

function MemoryRow({
  session,
  address,
  rowBytes,
  tabStop,
  onFocusByte,
}: {
  session: Session;
  address: number;
  rowBytes: number;
  tabStop: number;
  onFocusByte(address: number): void;
}) {
  const machine = session.machine;
  const bytes = [];
  let text = '';
  for (let i = 0; i < rowBytes; i++) {
    const byteAddress = address + i;
    const value = machine.peek(byteAddress);
    text += value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : '·';
    bytes.push(
      <HexField
        key={i}
        label={`Byte at ${hex16(byteAddress)}`}
        value={value}
        digits={2}
        className={byteClass(session, machine, byteAddress, value)}
        address={byteAddress}
        tabIndex={byteAddress === tabStop ? 0 : -1}
        onFocus={() => onFocusByte(byteAddress)}
        onCommit={(newValue) => session.poke(byteAddress, newValue)}
      />,
    );
  }

  return (
    <div className="mem-row" style={{ top: (address / rowBytes) * ROW_HEIGHT }}>
      <span className="addr">{hex16(address)}</span>
      <span className="mem-bytes">{bytes}</span>
      <span className="ascii">{text}</span>
    </div>
  );
}

function byteClass(session: Session, machine: Machine, address: number, value: number) {
  const { cpu } = machine;
  const changed = session.highlightsChanges && machine.ram[address] !== session.prevRam[address];
  return cx(
    'byte',
    address === cpu.pc && 'is-pc',
    address === cpu.sp && 'is-sp',
    address === cpu.hl && 'is-hl',
    changed && 'changed',
    machine.breakpoints.has(address) && 'has-bp',
    value === 0 && 'zero',
  );
}
