import { disassembleOne, hex16 } from '@i8080/core';
import type { Session } from '../session';

const ENTRIES_SHOWN = 64;

// The most recently executed instructions, newest at the bottom.
export function Trace({ session }: { session: Session }) {
  if (session.running) return <p className="muted pad">The trace is shown while paused.</p>;

  const machine = session.machine;
  const addresses = machine.trace().slice(-ENTRIES_SHOWN);
  if (addresses.length === 0) {
    return (
      <p className="muted pad">Nothing has run yet. Step or run the program to record a trace.</p>
    );
  }

  const labels = session.program?.labels;
  const read = (address: number) => machine.peek(address);
  return (
    <ol className="trace">
      {addresses.map((address, i) => (
        <li key={i} className={i === addresses.length - 1 ? 'last' : ''}>
          <span className="addr">{hex16(address)}</span>
          <span className="label">{labels?.get(address)}</span>
          <span>{disassembleOne(read, address, { symbols: labels }).text}</span>
        </li>
      ))}
    </ol>
  );
}
