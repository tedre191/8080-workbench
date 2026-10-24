import { Display, hex8, Sound, type SoundState, type Waveform } from '@i8080/core';
import { useEffect, useRef } from 'react';
import { cx } from '../cx';
import type { Session } from '../session';
import { NOISE_TOP_HZ } from '../speaker';

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

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// "A4 · 440 Hz", or "Silent".
function describeNote(note: number) {
  if (note === 0) return 'Silent';
  const name = NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
  return `${name} · ${Math.round(Sound.frequency(note))} Hz`;
}

// "A4 · 440 Hz · square · volume 8", or "Silent".
function describeSound({ note, waveform, volume }: SoundState) {
  return note === 0 ? 'Silent' : `${describeNote(note)} · ${waveform} · volume ${volume}`;
}

// How much time the scope shows across its width.
const SCOPE_SECONDS = 0.02;
// How often the speaker's noise changes level at full pitch: a typical
// audio sample rate.
const NOISE_SAMPLE_HZ = 48_000;

// The waveform's level, -1 to 1, at `phase` (0 to 1) through a cycle.
function level(waveform: Exclude<Waveform, 'noise'>, phase: number) {
  if (waveform === 'square') return phase < 0.5 ? 1 : -1;
  if (waveform === 'triangle') return 1 - 4 * Math.abs(phase - 0.5);
  return 2 * phase - 1;
}

// An oscilloscope view of what the sound chip is playing, drawn from its
// state rather than the audio, so it shows even when muted.
function SoundScope({ state }: { state: SoundState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { note, waveform, volume } = state;

  useEffect(() => {
    const element = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    const { clientWidth: width, clientHeight: height } = element;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    const context = element.getContext('2d')!;
    context.scale(ratio, ratio);
    const style = getComputedStyle(element);
    const middle = height / 2;

    context.strokeStyle = style.getPropertyValue('--rule');
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, middle);
    context.lineTo(width, middle);
    context.stroke();
    if (note === 0 || volume === 0) return;

    const hz = Sound.frequency(note);
    const amplitude = (volume / 15) * (middle - 3);
    // Noise holds each random level for a while: longer at lower notes.
    const hold = 1 / (NOISE_SAMPLE_HZ * Math.min(1, hz / NOISE_TOP_HZ));
    let noiseUntil = -1;
    let noise = 0;
    context.strokeStyle = style.getPropertyValue('--verdigris');
    context.lineWidth = 1.5;
    context.lineJoin = 'round';
    context.beginPath();
    for (let x = 0; x <= width; x += 0.5) {
      const time = (x / width) * SCOPE_SECONDS;
      let value;
      if (waveform === 'noise') {
        if (time >= noiseUntil) {
          noise = Math.random() * 2 - 1;
          noiseUntil = time + hold;
        }
        value = noise;
      } else {
        value = level(waveform, (time * hz) % 1);
      }
      context.lineTo(x, middle - amplitude * value);
    }
    context.stroke();
  }, [note, waveform, volume]);

  return (
    <div className="scope-box">
      <canvas
        ref={canvas}
        className="scope"
        role="img"
        aria-label={`Sound waveform: ${describeSound(state)}`}
      />
      <span className="scope-note mono" aria-hidden="true">
        {describeNote(note)}
      </span>
    </div>
  );
}

// LEDs, switches, timer, display and sound, each labelled with how a program reaches it.
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

      <div className="device-stack fixed">
        <section className="device">
          <h3>
            Display <span className="muted">F000h</span>
          </h3>
          <DisplayCanvas session={session} />
        </section>

        <section className="device">
          <h3>
            Sound <span className="muted">OUT 40h–42h</span>
          </h3>
          <SoundScope state={session.sound.state} />
        </section>
      </div>
    </div>
  );
}
