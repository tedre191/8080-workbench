import { Display, hex8 } from '@i8080/core';
import { useEffect, useRef } from 'react';
import { cx } from '../cx';
import type { Session } from '../session';

// Draws video memory, one canvas pixel per byte (the CSS scales it up).
function DisplayCanvas({ session }: { session: Session }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const display = session.display;
  const { version } = display; // changes whenever video memory is written

  useEffect(() => {
    const context = canvas.current!.getContext('2d')!;
    const image = context.createImageData(display.width, display.height);
    display.vram.forEach((colorIndex, pixel) => {
      const rgb = Display.PALETTE[colorIndex & 0x0f];
      image.data.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, 255], pixel * 4);
    });
    context.putImageData(image, 0, 0);
    // `version` isn't read above, but it changes whenever video memory does.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [version, display]);

  return (
    <canvas
      ref={canvas}
      className="display"
      width={display.width}
      height={display.height}
      aria-label="Display output"
    />
  );
}

// LEDs, switches, timer and display, each labelled with how a program reaches it.
export function Devices({ session }: { session: Session }) {
  const leds = session.leds.value;
  const switches = session.switches.value;
  const timer = session.timer;
  const bits = [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div className="devices">
      <div className="device-stack">
        <section className="device">
          <h3>
            LEDs <span className="muted">OUT 20h</span>
          </h3>
          <div className="big-leds">
            {bits.map((bit) => (
              <span key={bit} className={cx('big-led', ((leds >> bit) & 1) === 1 && 'on')} />
            ))}
          </div>
          <div className="muted mono">
            {hex8(leds)}h = {leds}
          </div>
        </section>

        <section className="device">
          <h3>
            Switches <span className="muted">IN 21h</span>
          </h3>
          <div className="switches">
            {bits.map((bit) => {
              const on = ((switches >> bit) & 1) === 1;
              return (
                <button
                  key={bit}
                  className={cx('switch', on && 'on')}
                  aria-pressed={on}
                  aria-label={`Switch ${bit}`}
                  onClick={() => session.switches.toggle(bit)}
                >
                  <span className="switch-lever" />
                  <span className="switch-label">{bit}</span>
                </button>
              );
            })}
          </div>
          <div className="muted mono">
            {hex8(switches)}h = {switches}
          </div>
        </section>

        <section className="device">
          <h3>
            Timer <span className="muted">OUT 30h, ms</span>
          </h3>
          <p className="mono">
            {timer.periodMs ? `RST 1 every ${timer.periodMs} ms` : 'Stopped'}, {timer.ticks} ticks
          </p>
        </section>
      </div>

      <section className="device">
        <h3>
          Display <span className="muted">F000h</span>
        </h3>
        <DisplayCanvas session={session} />
      </section>
    </div>
  );
}
