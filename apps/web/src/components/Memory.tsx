// A hex view of all 64K. Only the rows on screen are rendered.

import { hex16, type Machine } from '@i8080/core';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../cx';
import type { Session } from '../session';
import { AddressInput, resolveAddress } from './AddressInput';
import { HexField } from './HexField';

const ROW_HEIGHT = 24; // also the size of each byte, so they're big enough to tap
const BYTES_PER_ROW = 16;
const ROW_COUNT = 0x10000 / BYTES_PER_ROW;

type Follow = 'none' | 'pc' | 'sp' | 'hl' | 'de' | 'bc';

export function Memory({ session }: { session: Session }) {
  const cpu = session.machine.cpu;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(300);
  const [follow, setFollow] = useState<Follow>('none');

  useEffect(() => {
    const element = scroller.current!;
    const observer = new ResizeObserver(() => setViewHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // When following a register, scroll to it whenever it moves off screen.
  const followed = follow === 'none' ? undefined : cpu[follow];
  useEffect(() => {
    const element = scroller.current!;
    if (followed === undefined) return;
    const y = Math.floor(followed / BYTES_PER_ROW) * ROW_HEIGHT;
    const visible =
      y >= element.scrollTop && y <= element.scrollTop + element.clientHeight - ROW_HEIGHT;
    if (!visible) scrollToAddress(element, followed);
  }, [followed]);

  const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
  const lastRow = Math.min(firstRow + Math.ceil(viewHeight / ROW_HEIGHT) + 1, ROW_COUNT);
  const rows = [];
  for (let row = firstRow; row < lastRow; row++) {
    rows.push(<MemoryRow key={row} session={session} address={row * BYTES_PER_ROW} />);
  }

  return (
    <div className="memory">
      <div className="panel-tools">
        <AddressInput
          onGo={(address) => {
            setFollow('none');
            scrollToAddress(scroller.current!, address);
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
      >
        <div className="mem-spacer" style={{ height: ROW_COUNT * ROW_HEIGHT }}>
          {rows}
        </div>
      </div>
    </div>
  );
}

// Scroll so the row holding `address` is near the top.
function scrollToAddress(element: HTMLElement, address: number) {
  const row = Math.floor(address / BYTES_PER_ROW);
  element.scrollTop = Math.max(0, (row - 2) * ROW_HEIGHT);
}

function MemoryRow({ session, address }: { session: Session; address: number }) {
  const machine = session.machine;
  const bytes = [];
  let text = '';
  for (let i = 0; i < BYTES_PER_ROW; i++) {
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
        onCommit={(newValue) => session.poke(byteAddress, newValue)}
      />,
    );
  }

  return (
    <div className="mem-row" style={{ top: (address / BYTES_PER_ROW) * ROW_HEIGHT }}>
      <span className="addr">{hex16(address)}</span>
      <span className="mem-bytes">{bytes}</span>
      <span className="ascii">{text}</span>
    </div>
  );
}

function byteClass(session: Session, machine: Machine, address: number, value: number) {
  const { cpu } = machine;
  const changed = !session.running && machine.ram[address] !== session.prevRam[address];
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
