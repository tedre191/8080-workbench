// Plays the Sound device through WebAudio: an oscillator for each waveform
// and a loop of noise, all running all the time, with only the one in use
// turned up.
//
// The emulator runs a frame's worth of instructions at once, so notes from
// one frame would all start together. Instead, each change is played at its
// emulated time plus a little delay, which keeps short notes their length.

import { Sound, WAVEFORMS, type SoundState, type Waveform } from '@i8080/core';

// How far behind the emulator the sound plays, in seconds.
const LATENCY = 0.06;
// If the emulator gets further ahead or behind than this, start the clocks over.
const MAX_AHEAD = 0.3;
// Roughly equal loudness for each waveform at full volume.
const LEVELS: Record<Waveform, number> = {
  square: 0.1,
  triangle: 0.3,
  sawtooth: 0.12,
  noise: 0.15,
};
// Noise is pitched by playing it slower: a note this high or higher plays it
// at full speed, a new random level every sample.
export const NOISE_TOP_HZ = 2000;
const MUTE_KEY = 'i8080.muted';

const SILENCE: SoundState = { note: 0, waveform: 'square', volume: 15 };

interface Voice {
  gain: GainNode;
  setFrequency(hz: number, time: number): void;
  // Drop changes scheduled after `time`.
  cancel(time: number): void;
}

export class Speaker {
  muted = readMuted();
  private context?: AudioContext;
  private master?: GainNode;
  private voices = new Map<Waveform, Voice>();
  private state = SILENCE;
  // Audio time minus emulated time, while playing in time.
  private offset?: number;

  constructor() {
    if (typeof window === 'undefined') return;
    // Browsers only let a page start audio from a click or a key press.
    window.addEventListener('pointerdown', this.unlock, true);
    window.addEventListener('keydown', this.unlock, true);
  }

  // Play `state` from emulated time `seconds`, or straight away if it's
  // undefined (when the emulator isn't running in real time).
  play(state: SoundState, seconds?: number) {
    this.state = state;
    const context = this.context;
    if (!context) return;
    this.apply(state, seconds === undefined ? context.currentTime : this.timeFor(seconds));
  }

  // Play `state` straight away, dropping changes still waiting to be played
  // in time. For when the machine stops or changes speed: what's heard is
  // what the chip holds.
  playNow(state: SoundState) {
    this.offset = undefined;
    this.state = state;
    const context = this.context;
    if (!context) return;
    for (const voice of this.voices.values()) voice.cancel(context.currentTime);
    this.apply(state, context.currentTime);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Storage unavailable: the setting just won't be remembered.
    }
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.01);
    }
  }

  private unlock = () => {
    if (!this.context) this.start();
    else if (this.context.state === 'suspended') void this.context.resume();
  };

  private start() {
    const context = new AudioContext();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(context.destination);

    for (const waveform of WAVEFORMS) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      this.voices.set(
        waveform,
        waveform === 'noise' ? noise(context, gain) : tone(context, gain, waveform),
      );
    }
    // Something may already be playing.
    this.apply(this.state, context.currentTime);
  }

  private timeFor(seconds: number) {
    const now = this.context!.currentTime;
    let time = this.offset === undefined ? -1 : this.offset + seconds;
    if (time < now || time > now + MAX_AHEAD) {
      this.offset = now + LATENCY - seconds;
      time = now + LATENCY;
    }
    return time;
  }

  private apply({ note, waveform, volume }: SoundState, time: number) {
    const hz = Sound.frequency(note);
    for (const [kind, voice] of this.voices) {
      const on = note > 0 && kind === waveform;
      if (on) voice.setFrequency(hz, time);
      // A few milliseconds of smoothing, so notes start and stop without clicks.
      voice.gain.gain.setTargetAtTime(on ? (LEVELS[kind] * volume) / 15 : 0, time, 0.002);
    }
  }
}

function tone(context: AudioContext, output: GainNode, type: OscillatorType): Voice {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.connect(output);
  oscillator.start();
  return {
    gain: output,
    setFrequency: (hz, time) => oscillator.frequency.setValueAtTime(hz, time),
    cancel: (time) => {
      output.gain.cancelScheduledValues(time);
      oscillator.frequency.cancelScheduledValues(time);
    },
  };
}

function noise(context: AudioContext, output: GainNode): Voice {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(output);
  source.start();
  return {
    gain: output,
    setFrequency: (hz, time) =>
      source.playbackRate.setValueAtTime(Math.min(1, hz / NOISE_TOP_HZ), time),
    cancel: (time) => {
      output.gain.cancelScheduledValues(time);
      source.playbackRate.cancelScheduledValues(time);
    },
  };
}

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
