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

// "A4", or "–" when silent.
function noteName(note: number) {
  return note === 0 ? '–' : NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
}

// "A4, 440 Hz, square, volume 8, 50% left", or "silent".
function describeVoice({ note, waveform, volume, pan }: SoundState) {
  if (note === 0) return 'silent';
  const side =
    pan === 0 ? 'centre' : `${Math.round(Math.abs(pan) / 1.27)}% ${pan < 0 ? 'left' : 'right'}`;
  const hz = Math.round(Sound.frequency(note));
  return `${noteName(note)}, ${hz} Hz, ${waveform}, volume ${volume}, ${side}`;
}

// How much time the scope shows across its width.
const SCOPE_SECONDS = 0.02;
// How often the speaker's noise changes level at full pitch: a typical
// audio sample rate.
const NOISE_SAMPLE_HZ = 48_000;
// Each voice's colour in the scope, as CSS variables.
const VOICE_COLOURS = ['--verdigris', '--gold', '--sp'];

// The waveform's level, -1 to 1, at `phase` (0 to 1) through a cycle.
function level(waveform: Exclude<Waveform, 'noise'>, phase: number) {
  if (waveform === 'square') return phase < 0.5 ? 1 : -1;
  if (waveform === 'triangle') return 1 - 4 * Math.abs(phase - 0.5);
  return 2 * phase - 1;
}

// Draw one voice's waveform across the scope.
function drawVoice(
  context: CanvasRenderingContext2D,
  width: number,
  middle: number,
  voice: SoundState,
) {
  const { note, waveform, volume } = voice;
  const hz = Sound.frequency(note);
  const amplitude = (volume / 15) * (middle - 3);
  // Noise holds each random level for a while: longer at lower notes.
  const hold = 1 / (NOISE_SAMPLE_HZ * Math.min(1, hz / NOISE_TOP_HZ));
  let noiseUntil = -1;
  let noise = 0;
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
}

// An oscilloscope view of what the sound chip's voices are playing, each in
// its own colour. It's drawn from the chip's state rather than the audio, so
// it shows even when muted.
function SoundScope({ voices }: { voices: readonly SoundState[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);

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

    context.lineWidth = 1.25;
    context.lineJoin = 'round';
    voices.forEach((voice, i) => {
      if (voice.note === 0 || voice.volume === 0) return;
      context.strokeStyle = style.getPropertyValue(VOICE_COLOURS[i % VOICE_COLOURS.length]);
      drawVoice(context, width, middle, voice);
    });
  }, [voices]);

  const label = voices.map((voice, i) => `voice ${i}: ${describeVoice(voice)}`).join('; ');
  return (
    <div className="scope-box">
      <canvas ref={canvas} className="scope" role="img" aria-label={`Sound waveforms: ${label}`} />
      <span className="scope-note mono" aria-hidden="true">
        {voices.map((voice, i) => (
          <span key={i} style={{ color: `var(${VOICE_COLOURS[i % VOICE_COLOURS.length]})` }}>
            {noteName(voice.note)}
          </span>
        ))}
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
            Sound <span className="muted">OUT 40h–4Bh</span>
          </h3>
          <SoundScope voices={session.sound.voices} />
        </section>
      </div>
    </div>
  );
}
