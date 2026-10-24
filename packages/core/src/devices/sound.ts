import { Emitter } from '../emitter';
import type { Device, Machine } from '../machine';

export interface SoundOptions {
  // The first voice's first port; each voice takes four. Default 0x40.
  port?: number;
  // How many voices. Default 3.
  voices?: number;
}

export type Waveform = 'square' | 'triangle' | 'sawtooth' | 'noise';

export interface SoundState {
  note: number; // MIDI note number, 0 = silent
  waveform: Waveform;
  volume: number; // 0-15
  pan: number; // -128 (left) to 127 (right), 0 = centre
}

// A change to one voice, with the clock cycle it happened at (when the OUT
// instruction started), so a player can keep notes in time however the
// emulator's work is spread over frames.
export interface SoundChange extends SoundState {
  voice: number;
  cycles: number;
}

export const WAVEFORMS: readonly Waveform[] = ['square', 'triangle', 'sawtooth', 'noise'];

const QUIET: SoundState = { note: 0, waveform: 'square', volume: 15, pan: 0 };

// A sound chip with three voices, loosely after the AY-3-8910 found on S-100
// sound boards. It makes no sound itself: it reports changes through
// `onChange`, and the host plays them (the workbench uses WebAudio).
//
// Voice n's ports start at port + 4n (40h, 44h, 48h by default):
//
//   OUT +0, n   play MIDI note n (60 = middle C, 69 = A 440 Hz); 0 = silence
//   OUT +1, w   waveform: 0 square, 1 triangle, 2 sawtooth, 3 noise
//   OUT +2, v   volume, 0-15
//   OUT +3, p   pan, a signed byte: 80h far left, 0 centre, 7Fh far right
//   IN  +0      the note playing
export class Sound implements Device {
  readonly name = 'Sound';
  readonly port: number;
  readonly onChange = new Emitter<SoundChange>();
  // Each voice's state. Replaced, not changed, whenever a voice changes, so
  // a UI can tell a new state from an old one by identity.
  voices: readonly SoundState[];
  private machine?: Machine;

  constructor(options: SoundOptions = {}) {
    this.port = options.port ?? 0x40;
    this.voices = Array.from({ length: options.voices ?? 3 }, () => ({ ...QUIET }));
  }

  // The frequency of MIDI note `note`, in Hz.
  static frequency(note: number) {
    return 440 * 2 ** ((note - 69) / 12);
  }

  attach(machine: Machine) {
    this.machine = machine;
    this.voices.forEach((_, voice) => {
      const port = this.port + 4 * voice;
      machine.mapPort(port, {
        out: (_port, value) => this.set(voice, { note: value & 0x7f }),
        in: () => this.voices[voice].note,
      });
      machine.mapPort(port + 1, {
        out: (_port, value) => this.set(voice, { waveform: WAVEFORMS[value & 3] }),
      });
      machine.mapPort(port + 2, {
        out: (_port, value) => this.set(voice, { volume: Math.min(value, 15) }),
      });
      machine.mapPort(port + 3, {
        out: (_port, value) => this.set(voice, { pan: value < 0x80 ? value : value - 0x100 }),
      });
    });
  }

  detach(machine: Machine) {
    const ports = this.voices.flatMap((_, voice) =>
      [0, 1, 2, 3].map((i) => this.port + 4 * voice + i),
    );
    machine.unmapPort(ports);
    this.machine = undefined;
  }

  reset() {
    this.voices.forEach((_, voice) => this.set(voice, QUIET));
  }

  private set(voice: number, changes: Partial<SoundState>) {
    const state = { ...this.voices[voice], ...changes };
    this.voices = this.voices.map((old, i) => (i === voice ? state : old));
    this.onChange.emit({ ...state, voice, cycles: this.machine?.cycles ?? 0 });
  }
}
