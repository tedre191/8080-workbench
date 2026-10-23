import { cx } from '../cx';
import { SPEEDS, type Session } from '../session';

interface Props {
  session: Session;
}

function Led({ on, label, title }: { on: boolean; label?: string; title?: string }) {
  return (
    <span className="led-cell" title={title}>
      <span className={cx('led', on && 'on')} />
      {label !== undefined && <span className="led-label">{label}</span>}
    </span>
  );
}

function LedBank({ value, bits, name }: { value: number; bits: number; name: string }) {
  const cells = [];
  for (let i = bits - 1; i >= 0; i--) {
    cells.push(<Led key={i} on={((value >> i) & 1) === 1} label={String(i)} />);
    // A small gap after every group of four, like the Altair's front panel.
    if (i % 4 === 0 && i !== 0) cells.push(<span key={`gap-${i}`} className="led-gap" />);
  }
  return (
    <div
      className="led-bank"
      role="img"
      aria-label={`${name} ${value.toString(16).toUpperCase()}h`}
    >
      <span className="bank-name">{name}</span>
      <div className="bank-leds">{cells}</div>
    </div>
  );
}

function formatHz(hz: number) {
  if (hz >= 1e8) return `${(hz / 1e6).toFixed(0)} MHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(1)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
  return `${hz.toFixed(0)} Hz`;
}

export function FrontPanel({ session }: Props) {
  const { machine, running } = session;
  const cpu = machine.cpu;

  return (
    <header className="front-panel">
      <div className="badge">
        <span className="badge-chip" aria-hidden="true" />
        <span className="badge-text">
          <strong>8080</strong> workbench
        </span>
      </div>

      <div className="panel-lights">
        <LedBank name="Address" value={cpu.pc} bits={16} />
        <LedBank name="Data" value={machine.peek(cpu.pc)} bits={8} />
        <div className="led-bank status-bank">
          <span className="bank-name">Status</span>
          <div className="bank-leds">
            <Led on={running} label="run" title="Running" />
            <Led on={cpu.halted} label="hlt" title="Halted" />
            <Led on={cpu.inte} label="inte" title="Interrupts enabled" />
          </div>
        </div>
      </div>

      <div className="controls">
        <div className="control-row">
          {running ? (
            <button className="btn primary" onClick={() => session.pause()} title="Pause (F5)">
              Pause
            </button>
          ) : (
            <button className="btn primary" onClick={() => session.run()} title="Run (F5)">
              Run
            </button>
          )}
          <button className="btn" onClick={() => session.step()} title="Step one instruction (F11)">
            Step
          </button>
          <button className="btn" onClick={() => session.stepOver()} title="Step over calls (F10)">
            Step over
          </button>
          <button
            className="btn"
            onClick={() => session.stepOut()}
            title="Run until return (Shift+F11)"
          >
            Step out
          </button>
          <span className="divider" />
          <button
            className="btn"
            onClick={() => session.restart()}
            title="Reload the program and reset the machine"
          >
            Restart
          </button>
        </div>
        <div className="control-row">
          <div className="segmented" role="radiogroup" aria-label="Clock speed">
            {SPEEDS.map((speed) => (
              <button
                key={speed.id}
                role="radio"
                aria-checked={session.speed === speed.id}
                className={cx(session.speed === speed.id && 'active')}
                title={speed.title}
                onClick={() => session.setSpeed(speed.id)}
              >
                {speed.label}
              </button>
            ))}
          </div>
          <span
            className="clock-readout"
            title={running ? 'Effective clock rate' : 'Clock cycles (T-states) since restart'}
          >
            {running ? formatHz(session.measuredHz) : `${cpu.cycles.toLocaleString()} cycles`}
          </span>
        </div>
      </div>
    </header>
  );
}
