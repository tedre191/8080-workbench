import { hex16, hex8 } from '@i8080/core';
import { useState } from 'react';
import type { Session } from '../session';
import { resolveAddress } from './AddressInput';

export function Breakpoints({ session }: { session: Session }) {
  return (
    <div className="breakpoints">
      <BreakpointList session={session} />
      <WatchpointList session={session} />
    </div>
  );
}

function BreakpointList({ session }: { session: Session }) {
  const { breakpoints } = session.machine;
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const address = resolveAddress(text.trim(), session.program?.symbols);
    if (address === undefined) {
      setError(`"${text}" isn't an address or label`);
      return;
    }
    if (!breakpoints.has(address)) session.toggleBreakpoint(address);
    setText('');
    setError('');
  };

  return (
    <section>
      <h3>Breakpoints</h3>
      <p className="muted">
        Click a line number in the source or the dot in the disassembly to toggle one.
      </p>
      <form className="inline-form" onSubmit={add}>
        <input
          aria-label="Breakpoint address"
          autoComplete="off"
          data-1p-ignore
          placeholder="Address or label"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="btn small">Add</button>
        {breakpoints.size > 0 && (
          <button type="button" className="btn small" onClick={() => session.clearBreakpoints()}>
            Remove all
          </button>
        )}
      </form>
      {error && <p className="form-error">{error}</p>}
      <ul className="bp-list">
        {[...breakpoints]
          .sort((a, b) => a - b)
          .map((address) => (
            <li key={address}>
              <span className="bp-mark" />
              <span className="mono">{hex16(address)}</span>
              <span>{session.program?.labels.get(address)}</span>
              <button className="btn small" onClick={() => session.toggleBreakpoint(address)}>
                Remove
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}

type WatchKind = 'write' | 'read' | 'access' | 'out' | 'in';

function WatchpointList({ session }: { session: Session }) {
  const { watchpointList, portWatchList } = session.machine;
  const [kind, setKind] = useState<WatchKind>('write');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const isPort = kind === 'in' || kind === 'out';

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    // An address, a label, or a range like F000-F3FF.
    const [first, last = first] = text
      .split('-')
      .map((part) => resolveAddress(part.trim(), session.program?.symbols));
    if (first === undefined || last === undefined) {
      setError(`"${text}" isn't an address, label or range like 2000-20FF`);
      return;
    }

    session.update((machine) => {
      if (isPort) {
        machine.addPortWatch({ port: first & 0xff, in: kind === 'in', out: kind === 'out' });
      } else {
        const start = Math.min(first, last);
        const end = Math.max(first, last);
        machine.addWatchpoint({ start, end, read: kind !== 'write', write: kind !== 'read' });
      }
    });
    setText('');
    setError('');
  };

  return (
    <section>
      <h3>Watchpoints</h3>
      <p className="muted">Stop when memory or a port is accessed.</p>
      <form className="inline-form" onSubmit={add}>
        <select
          aria-label="Watch type"
          value={kind}
          onChange={(event) => setKind(event.target.value as WatchKind)}
        >
          <option value="write">Memory write</option>
          <option value="read">Memory read</option>
          <option value="access">Memory read/write</option>
          <option value="out">Port OUT</option>
          <option value="in">Port IN</option>
        </select>
        <input
          aria-label="Watch address"
          autoComplete="off"
          data-1p-ignore
          placeholder={isPort ? 'Port, e.g. 20' : 'e.g. count or F000-F3FF'}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="btn small">Add</button>
      </form>
      {error && <p className="form-error">{error}</p>}
      <ul className="bp-list">
        {watchpointList.map((watch, i) => (
          <li key={`memory-${i}`}>
            <span className="mono">
              {hex16(watch.start)}
              {watch.end !== watch.start && `–${hex16(watch.end)}`}
            </span>
            <span>{watch.read && watch.write ? 'read/write' : watch.read ? 'read' : 'write'}</span>
            <button
              className="btn small"
              onClick={() => session.update((m) => m.removeWatchpoint(watch))}
            >
              Remove
            </button>
          </li>
        ))}
        {portWatchList.map((watch, i) => (
          <li key={`port-${i}`}>
            <span className="mono">port {hex8(watch.port)}h</span>
            <span>{watch.in ? 'IN' : 'OUT'}</span>
            <button
              className="btn small"
              onClick={() => session.update((m) => m.removePortWatch(watch))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
