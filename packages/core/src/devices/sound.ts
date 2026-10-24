import { Emitter } from '../emitter';
import type { Device, Machine } from '../machine';

export interface SoundOptions {
  // First of three ports: note, waveform, volume. Default 0x40.
  port?: number;
}

export type Waveform = 'square' | 'triangle' | 'sawtooth' | 'noise';

export interface SoundState {
  note: number; // MIDI note number, 0 = silent
  waveform: Waveform;
  volume: number; // 0-15
}

// A change to the sound, with the clock cycle it happened at (when the OUT
// instruction started), so a player can keep notes in time however the
// emulator's work is spread over frames.
export interface SoundChange extends SoundState {
  cycles: number;
}

export const WAVEFORMS: readonly Waveform[] = ['square', 'triangle', 'sawtooth', 'noise'];

// A one-voice sound chip. It makes no sound itself: it reports changes
// through `onChange`, and the host plays them (the workbench uses WebAudio).
//
//   OUT port,   n   play MIDI note n (60 = middle C, 69 = A 440 Hz); 0 = silence
//   OUT port+1, w   waveform: 0 square, 1 triangle, 2 sawtooth, 3 noise
//   OUT port+2, v   volume, 0-15
//   IN  port        the note playing
export class Sound implements Device {
  readonly name = 'Sound';
  readonly port: number;
  readonly onChange = new Emitter<SoundChange>();
  state: SoundState = { note: 0, waveform: 'square', volume: 15 };
  private machine?: Machine;

  constructor(options: SoundOptions = {}) {
    this.port = options.port ?? 0x40;
  }

  // The frequency of MIDI note `note`, in Hz.
  static frequency(note: number) {
    return 440 * 2 ** ((note - 69) / 12);
  }

  attach(machine: Machine) {
    this.machine = machine;
    machine.mapPort(this.port, {
      out: (_port, value) => this.set({ note: value & 0x7f }),
      in: () => this.state.note,
    });
    machine.mapPort(this.port + 1, {
      out: (_port, value) => this.set({ waveform: WAVEFORMS[value & 3] }),
    });
    machine.mapPort(this.port + 2, {
      out: (_port, value) => this.set({ volume: Math.min(value, 15) }),
    });
  }

  detach(machine: Machine) {
    machine.unmapPort([this.port, this.port + 1, this.port + 2]);
    this.machine = undefined;
  }

  reset() {
    this.set({ note: 0, waveform: 'square', volume: 15 });
  }

  private set(changes: Partial<SoundState>) {
    this.state = { ...this.state, ...changes };
    this.onChange.emit({ ...this.state, cycles: this.machine?.cycles ?? 0 });
  }
}
