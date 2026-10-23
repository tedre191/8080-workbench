import { FLAG_AC, FLAG_CY, FLAG_P, FLAG_S, FLAG_Z, hex16, hex8, type CpuState } from '@i8080/core';
import { cx } from '../cx';
import type { Session } from '../session';
import { HexField } from './HexField';

const FLAGS = [
  { name: 'S', bit: FLAG_S, title: 'Sign' },
  { name: 'Z', bit: FLAG_Z, title: 'Zero' },
  { name: 'AC', bit: FLAG_AC, title: 'Auxiliary carry' },
  { name: 'P', bit: FLAG_P, title: 'Parity (even)' },
  { name: 'CY', bit: FLAG_CY, title: 'Carry' },
];

type Register8 = 'a' | 'b' | 'c' | 'd' | 'e' | 'h' | 'l';

// Registers and flags, editable while paused. Values the last step changed
// are highlighted.
export function Registers({ session }: { session: Session }) {
  const cpu = session.machine.cpu;
  const now = cpu.getState();
  // While running, every value changes all the time, so highlight nothing.
  const before = session.running ? now : session.prevCpu;
  const locked = session.running;

  const register = (name: string, key: Register8) => (
    <Register
      name={name}
      value={now[key]}
      digits={2}
      changed={now[key] !== before[key]}
      locked={locked}
      onChange={(value) => session.setCpu({ [key]: value })}
    />
  );

  const pair = (high: Register8, low: Register8) => {
    const value = (now[high] << 8) | now[low];
    const name = (high + low).toUpperCase();
    return (
      <div className="reg-pair">
        {register(high.toUpperCase(), high)}
        {register(low.toUpperCase(), low)}
        <span
          className="reg-wide"
          title={`${name} as a 16-bit value, and the byte at that address`}
        >
          {hex16(value)} <span className="reg-deref">→{hex8(session.machine.peek(value))}</span>
        </span>
      </div>
    );
  };

  const printable = now.a >= 0x20 && now.a < 0x7f;

  return (
    <div className="registers">
      <div className="reg-pair">
        {register('A', 'a')}
        <Register
          name="F"
          value={now.f}
          digits={2}
          changed={now.f !== before.f}
          locked={locked}
          onChange={(f) => session.setCpu({ f })}
        />
        <span className="reg-wide" title="A in decimal and as a character">
          {now.a} {printable && `'${String.fromCharCode(now.a)}'`}
        </span>
      </div>
      {pair('b', 'c')}
      {pair('d', 'e')}
      {pair('h', 'l')}

      <div className="reg16-row">
        <Register
          name="SP"
          value={now.sp}
          digits={4}
          changed={now.sp !== before.sp}
          locked={locked}
          onChange={(sp) => session.setCpu({ sp })}
        />
        <Register
          name="PC"
          className="pc"
          value={now.pc}
          digits={4}
          locked={locked}
          onChange={(pc) => session.setCpu({ pc, halted: false })}
        />
      </div>

      <Flags session={session} now={now} before={before} locked={locked} />
    </div>
  );
}

interface RegisterProps {
  name: string;
  value: number;
  digits: 2 | 4;
  changed?: boolean;
  locked: boolean;
  className?: string;
  onChange(value: number): void;
}

function Register({ name, value, digits, changed, locked, className, onChange }: RegisterProps) {
  return (
    <div className={cx('reg', changed && 'changed', className)}>
      <span className="reg-name">{name}</span>
      <HexField
        label={`Register ${name}`}
        value={value}
        digits={digits}
        disabled={locked}
        onCommit={onChange}
      />
    </div>
  );
}

function Flags({
  session,
  now,
  before,
  locked,
}: {
  session: Session;
  now: CpuState;
  before: CpuState;
  locked: boolean;
}) {
  return (
    <div className="flags" role="group" aria-label="Flags">
      {FLAGS.map((flag) => {
        const on = (now.f & flag.bit) !== 0;
        const changed = on !== ((before.f & flag.bit) !== 0);
        return (
          <button
            key={flag.name}
            className={cx('flag', on && 'on', changed && 'changed')}
            aria-pressed={on}
            title={`${flag.title}: click to toggle`}
            disabled={locked}
            onClick={() => session.setCpu({ f: now.f ^ flag.bit })}
          >
            {flag.name}
          </button>
        );
      })}
      <button
        className={cx('flag', now.inte && 'on')}
        aria-pressed={now.inte}
        title="Interrupts enabled: click to toggle"
        disabled={locked}
        onClick={() => session.setCpu({ inte: !now.inte })}
      >
        INTE
      </button>
    </div>
  );
}
