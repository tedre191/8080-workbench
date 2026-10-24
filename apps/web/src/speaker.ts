// Plays the Sound device through WebAudio. Each voice has an oscillator for
// each waveform and a loop of noise, all running all the time with only the
// one in use turned up, then a stereo panner.
//
// The emulator runs a frame's worth of instructions at once, so notes from
// one frame would all start together. Instead, each change is played at its
// emulated time plus a little delay, which keeps short notes their length.

import { Sound, WAVEFORMS, type SoundState, type Waveform } from '@i8080/core';
import { readPref, writePref } from './prefs';

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
// A few milliseconds of smoothing, so changes don't click.
const SMOOTHING = 0.002;

const QUIET: SoundState = { note: 0, waveform: 'square', volume: 15, pan: 0 };

// One waveform's source in a voice.
interface Source {
  gain: GainNode;
  setFrequency(hz: number, time: number): void;
  // Drop changes scheduled after `time`.
  cancel(time: number): void;
}

interface VoicePlayer {
  sources: Map<Waveform, Source>;
  panner: StereoPannerNode;
}

export class Speaker {
  muted = readPref(MUTE_KEY) === '1';
  private context?: AudioContext;
  private master?: GainNode;
  private players: VoicePlayer[] = [];
  private states: SoundState[];
  // Audio time minus emulated time, while playing in time.
  private offset?: number;

  constructor(voices: number) {
    this.states = Array.from({ length: voices }, () => QUIET);
    if (typeof window === 'undefined') return;
    // Browsers only let a page start audio from a click or a key press.
    window.addEventListener('pointerdown', this.unlock, true);
    window.addEventListener('keydown', this.unlock, true);
  }

  // Play `state` on `voice` from emulated time `seconds`, or straight away if
  // it's undefined (when stepping rather than running).
  play(voice: number, state: SoundState, seconds?: number) {
    this.states[voice] = state;
    const context = this.context;
    if (!context) return;
    const time = seconds === undefined ? context.currentTime : this.timeFor(seconds);
    this.apply(voice, state, time);
  }

  // Play `states`, a state for each voice, straight away, dropping changes
  // still waiting to be played in time. For when the machine stops or
  // changes speed: what's heard is what the chip holds.
  playNow(states: readonly SoundState[]) {
    this.offset = undefined;
    this.states = [...states];
    const context = this.context;
    if (!context) return;
    this.states.forEach((state, voice) => {
      const { sources, panner } = this.players[voice];
      for (const source of sources.values()) source.cancel(context.currentTime);
      panner.pan.cancelScheduledValues(context.currentTime);
      this.apply(voice, state, context.currentTime);
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    writePref(MUTE_KEY, muted ? '1' : '0');
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
    const noiseBuffer = makeNoise(context);

    this.players = this.states.map(() => {
      const panner = context.createStereoPanner();
      panner.connect(this.master!);
      const sources = new Map<Waveform, Source>();
      for (const waveform of WAVEFORMS) {
        const gain = context.createGain();
        gain.gain.value = 0;
        gain.connect(panner);
        sources.set(
          waveform,
          waveform === 'noise' ? noise(context, noiseBuffer, gain) : tone(context, gain, waveform),
        );
      }
      return { sources, panner };
    });
    // Something may already be playing.
    this.states.forEach((state, voice) => this.apply(voice, state, context.currentTime));
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

  private apply(voice: number, { note, waveform, volume, pan }: SoundState, time: number) {
    const { sources, panner } = this.players[voice];
    const hz = Sound.frequency(note);
    for (const [kind, source] of sources) {
      const on = note > 0 && kind === waveform;
      if (on) source.setFrequency(hz, time);
      source.gain.gain.setTargetAtTime(on ? (LEVELS[kind] * volume) / 15 : 0, time, SMOOTHING);
    }
    panner.pan.setTargetAtTime(Math.max(-1, pan / 127), time, SMOOTHING);
  }
}

function tone(context: AudioContext, output: GainNode, type: OscillatorType): Source {
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

// A second of white noise, shared by every voice's noise source.
function makeNoise(context: AudioContext) {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}

function noise(context: AudioContext, buffer: AudioBuffer, output: GainNode): Source {
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
