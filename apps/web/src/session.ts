// The workbench's model: the emulated machine, what program is loaded, and
// the run loop. React components read from it directly and re-render when
// `bump()` is called (see useSyncExternalStore in App.tsx).

import {
  assemble,
  CpmBdos,
  Display,
  hex16,
  hex8,
  Leds,
  Machine,
  Sound,
  Switches,
  Terminal,
  Timer,
  type AssembleResult,
  type CpuState,
  type SoundChange,
  type StopReason,
} from '@i8080/core';
import { writePref } from './prefs';
import { Speaker } from './speaker';

export type Speed = 'slow' | 'medium' | 'real' | 'max';

// Every speed except Max is a clock rate; Max runs at the fastest clock rate
// this computer keeps up with. At the two slow ones the run loop steps one
// instruction at a time, so the UI can highlight what each changed. At every
// speed the timer and sound keep real time, like hardware with its CPU clock
// turned down or up: at the slow speeds a timer may be due again before its
// interrupt handler has finished.
export const SPEEDS: { id: Speed; label: string; title: string; hz?: number }[] = [
  {
    id: 'slow',
    label: '30 Hz',
    hz: 30,
    title: '30 clock cycles a second: about 4 instructions. The timer keeps real time.',
  },
  {
    id: 'medium',
    label: '500 Hz',
    hz: 500,
    title: '500 clock cycles a second: about 70 instructions. The timer keeps real time.',
  },
  { id: 'real', label: '2 MHz', hz: 2_000_000, title: 'Real Altair speed' },
  {
    id: 'max',
    label: 'Max',
    title: 'As fast as this computer can go. The timer and sound keep real time.',
  },
];

// Where the chosen speed is remembered between visits.
export const SPEED_KEY = 'i8080.speed';

// Below this rate, run one instruction at a time and highlight its changes.
const STEP_BY_STEP_BELOW_HZ = 1000;

const CLOCK_HZ = 2_000_000;
// Max adapts its clock rate between these, starting from the first.
const MAX_START_HZ = 50_000_000;
const MAX_LOWEST_HZ = 100_000;
const MAX_HIGHEST_HZ = 1_000_000_000;
// How Max steers its rate, each frame: slower after falling behind, faster
// after keeping up with time to spare.
const MAX_SLOWER = 0.9;
const MAX_FASTER = 1.02;
// If Max falls this far behind real time, it gives the time up.
const MAX_LAG_SECONDS = 0.5;
// How much of each 60 fps frame Max may spend emulating, in ms.
const FRAME_WORK_MS = 12;
// Instructions run in slices of this many cycles, to check the time between.
const SLICE_CYCLES = 250_000;
// How long a step over or out may run before it moves to the frame loop, so
// the page stays responsive while a subroutine waits for a key.
const QUICK_STEP_CYCLES = 200_000;
const MAX_TERMINAL_CHARS = 64 * 1024;

export interface Status {
  tone: 'info' | 'stop' | 'error' | 'ok';
  text: string;
  // A button to show after the text, such as Undo.
  action?: { label: string; run(): void };
}

// A program loaded as machine code instead of source. CP/M .COM programs
// load at 0100h with CP/M console support; raw images load at 0000h.
export interface BinaryImage {
  name: string;
  bytes: Uint8Array;
  format: 'com' | 'raw';
}

export class Session {
  readonly machine = new Machine();
  readonly terminal = this.machine.add(new Terminal());
  readonly cpm = this.machine.add(new CpmBdos(this.terminal));
  readonly leds = this.machine.add(new Leds());
  readonly switches = this.machine.add(new Switches());
  readonly timer = this.machine.add(new Timer({ clockHz: CLOCK_HZ }));
  readonly display = this.machine.add(new Display());
  readonly sound = this.machine.add(new Sound());
  readonly speaker = new Speaker(this.sound.voices.length);

  // What's loaded: either an assembled program or a binary.
  program: AssembleResult | null = null;
  programSource = '';
  binary: BinaryImage | null = null;

  // Breakpoints by source line, so they survive reassembly.
  lineBreakpoints = new Set<number>();

  running = false;
  // While running: the condition a step over or out is waiting for, or null for a plain run.
  stepping: ((machine: Machine) => boolean) | null = null;
  speed: Speed = 'real';
  status: Status = { tone: 'info', text: '' };
  terminalText = '';
  measuredHz = 0;

  // The state before the last step, to highlight what changed.
  prevCpu: CpuState = this.machine.cpu.getState();
  prevRam = new Uint8Array(0x10000);

  private version = 0;
  private listeners = new Set<() => void>();
  private frameRequest = 0;
  private lastFrameTime = 0;
  // Clock cycles due but not yet run. Negative when the last instruction ran
  // past the time it was given, so the average rate comes out exact.
  private cyclesOwed = 0;
  private rateSample = { time: 0, clock: 0 };
  // Max's current clock rate.
  private maxHz = MAX_START_HZ;
  // For converting cycles to emulated seconds: the clock rate since `cycles`,
  // when `seconds` had passed.
  private timeBase = { cycles: 0, seconds: 0, hz: CLOCK_HZ };
  private resuming = false; // the first instruction may be on the breakpoint we stopped at

  constructor() {
    this.terminal.onOutput.on((byte) => this.printToTerminal(byte));
    this.switches.onChange.on(() => this.bump());
    this.sound.onChange.on((change) => this.playSound(change));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  bump() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  // Opening programs

  openSource(source: string) {
    this.binary = null;
    this.program = assemble(source);
    this.programSource = source;
    this.restart();
  }

  openBinary(image: BinaryImage) {
    const limit = image.format === 'com' ? this.cpm.maxComSize : 0x10000;
    if (image.bytes.length > limit) {
      const where = image.format === 'com' ? 'a CP/M program' : 'memory';
      this.setStatus({
        tone: 'error',
        text: `Can't open ${image.name}: ${image.bytes.length} bytes is more than fits in ${where} (${limit})`,
      });
      return;
    }
    this.binary = image;
    this.program = null;
    this.programSource = '';
    this.machine.breakpoints.clear();
    this.restart();
  }

  // Called shortly after the user stops typing. Code with errors is ignored,
  // so the last working version keeps running. If the bytes didn't change
  // (say, only a comment was edited), the machine is left alone.
  sync(result: AssembleResult, source: string) {
    if (!result.ok || this.binary) return;

    const codeChanged = !this.program?.ok || !sameImage(this.program, result);
    this.program = result;
    this.programSource = source;

    if (codeChanged) {
      this.restart();
    } else {
      this.applyLineBreakpoints();
      this.bump();
    }
  }

  // Reload the program into a clean machine. Unlike a hardware reset, memory
  // is reloaded too, so the program's variables start over. If the program
  // was running, it keeps running.
  restart() {
    // A step over or out that was still going isn't a run to resume.
    const wasRunning = this.running && !this.stepping;
    this.pause();
    this.machine.ram.fill(0);
    this.display.clear();
    this.machine.reset();
    this.timeBase = { cycles: 0, seconds: 0, hz: this.timeBase.hz };
    this.terminalText = '';

    const { binary, program } = this;
    if (binary?.format === 'com') {
      this.cpm.loadCom(binary.bytes);
      this.status = {
        tone: 'ok',
        text: `${binary.name}: CP/M program, ${binary.bytes.length} bytes at 0100h`,
      };
    } else if (binary) {
      this.machine.load(0, binary.bytes);
      this.status = { tone: 'ok', text: `${binary.name}: ${binary.bytes.length} bytes at 0000h` };
    } else if (program?.ok) {
      for (const segment of program.segments) this.machine.load(segment.address, segment.bytes);
      this.machine.cpu.pc = program.entry;
      this.applyLineBreakpoints();
      this.status = {
        tone: 'ok',
        text: `Loaded ${programSize(program)} bytes, entry ${hex16(program.entry)}h`,
      };
    } else if (program) {
      const error = program.errors[0];
      this.status = { tone: 'error', text: `Can't load: line ${error.line}: ${error.message}` };
    }

    this.snapshot();
    this.bump();
    if (wasRunning && (binary || program?.ok)) this.run();
  }

  // Whether the UI should highlight what the last instruction changed: when
  // paused, or when running slowly enough to follow one instruction at a time.
  get highlightsChanges() {
    const hz = SPEEDS.find((speed) => speed.id === this.speed)?.hz;
    return !this.running || (hz !== undefined && hz < STEP_BY_STEP_BELOW_HZ);
  }

  // Breakpoints

  addressOfLine(line: number) {
    return this.program?.listing.find((entry) => entry.line === line && entry.bytes.length > 0)
      ?.address;
  }

  toggleLineBreakpoint(line: number) {
    const address = this.addressOfLine(line);
    if (address === undefined) return;

    if (this.lineBreakpoints.has(line)) {
      this.lineBreakpoints.delete(line);
      this.machine.breakpoints.delete(address);
    } else {
      this.lineBreakpoints.add(line);
      this.machine.breakpoints.add(address);
    }
    this.bump();
  }

  toggleBreakpoint(address: number) {
    const isSet = this.machine.toggleBreakpoint(address);
    const line = this.program?.addressToLine.get(address);
    if (line !== undefined) {
      if (isSet) this.lineBreakpoints.add(line);
      else this.lineBreakpoints.delete(line);
    }
    this.bump();
  }

  // Keep breakpoints on the same code when lines are inserted or deleted.
  editSource(before: string, after: string) {
    this.lineBreakpoints = shiftLines(this.lineBreakpoints, before, after);
  }

  clearBreakpoints() {
    this.machine.breakpoints.clear();
    this.lineBreakpoints.clear();
    this.bump();
  }

  private applyLineBreakpoints() {
    this.machine.breakpoints.clear();
    for (const line of this.lineBreakpoints) {
      const address = this.addressOfLine(line);
      if (address === undefined) this.lineBreakpoints.delete(line);
      else this.machine.breakpoints.add(address);
    }
  }

  // Running

  run() {
    if (this.running) return;
    this.snapshot();
    this.startRunning();
    this.status = { tone: 'info', text: 'Running' };
    this.bump();
  }

  private startRunning() {
    this.running = true;
    this.resuming = true;
    this.cyclesOwed = 0;
    this.lastFrameTime = performance.now();
    this.rateSample = { time: this.lastFrameTime, clock: this.clock() };
    this.frameRequest = requestAnimationFrame(this.onFrame);
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    this.stepping = null;
    cancelAnimationFrame(this.frameRequest);
    this.speaker.playNow(this.sound.voices);
    this.status = { tone: 'info', text: `Paused at ${hex16(this.machine.cpu.pc)}h` };
    this.bump();
  }

  step() {
    this.debugStep(() => this.machine.step());
  }

  stepOver() {
    const until = this.machine.stepOverCondition();
    if (until) this.runUntil(until, 'Stepping over');
    else this.step();
  }

  stepOut() {
    this.runUntil(this.machine.stepOutCondition(), 'Stepping out');
  }

  // Run at full speed until `until` is true. Most steps finish at once; one
  // that doesn't (say, a call that waits for a key) carries on in the frame
  // loop, where it can be paused.
  private runUntil(until: (machine: Machine) => boolean, what: string) {
    this.pause();
    this.snapshot();
    const stop = this.machine.run({
      cycles: QUICK_STEP_CYCLES,
      skipBreakpointAtStart: true,
      until,
    });
    if (stop.kind === 'budget') {
      this.stepping = until;
      this.startRunning();
      this.resuming = false;
      this.status = { tone: 'info', text: `${what}… (Esc or F5 to stop)` };
    } else {
      this.status = this.describe(stop);
    }
    this.bump();
  }

  private debugStep(action: () => StopReason | null) {
    this.pause();
    this.snapshot();
    const stop = action();
    this.status = stop
      ? this.describe(stop)
      : { tone: 'info', text: `At ${hex16(this.machine.cpu.pc)}h` };
    this.bump();
  }

  private onFrame = (now: number) => {
    if (!this.running) return;

    // Cap the elapsed time so a backgrounded tab doesn't run seconds at once.
    const elapsedMs = Math.min(now - this.lastFrameTime, 100);
    this.lastFrameTime = now;
    const stop = this.runFor(elapsedMs);
    this.measureRate(now);

    if (stop.kind === 'budget') {
      this.frameRequest = requestAnimationFrame(this.onFrame);
    } else {
      this.running = false;
      this.stepping = null;
      this.speaker.playNow(this.sound.voices);
      this.status = this.describe(stop);
    }
    this.bump();
  };

  // Run the amount of emulated time that fits in `elapsedMs` at the current speed.
  private runFor(elapsedMs: number): StopReason {
    // Only the very first instruction after Run may skip its breakpoint.
    let skipBreakpointAtStart = this.resuming;
    this.resuming = false;

    // Steps over and out run flat out, whatever the speed setting.
    const until = this.stepping;
    if (until) {
      const deadline = performance.now() + FRAME_WORK_MS;
      let stop: StopReason = { kind: 'budget' };
      while (stop.kind === 'budget' && performance.now() < deadline) {
        stop = this.machine.run({ cycles: SLICE_CYCLES, skipBreakpointAtStart, until });
        skipBreakpointAtStart = false;
      }
      return stop;
    }
    if (this.speed === 'max') return this.runMax(elapsedMs, skipBreakpointAtStart);

    const hz = SPEEDS.find((speed) => speed.id === this.speed)!.hz!;

    this.cyclesOwed += (elapsedMs / 1000) * hz;
    if (hz >= STEP_BY_STEP_BELOW_HZ) {
      const before = this.machine.cycles;
      const stop = this.machine.run({
        cycles: Math.max(0, Math.floor(this.cyclesOwed)),
        skipBreakpointAtStart,
      });
      this.cyclesOwed -= this.machine.cycles - before;
      return stop;
    }

    // Slow: one instruction at a time while cycles are owed, snapshotting
    // before each so the UI highlights what it changed.
    let stop: StopReason = { kind: 'budget' };
    while (this.cyclesOwed > 0 && stop.kind === 'budget') {
      this.snapshot();
      const before = this.machine.cycles;
      stop = this.machine.run({ cycles: 1, skipBreakpointAtStart }); // one instruction
      skipBreakpointAtStart = false;
      this.cyclesOwed -= this.machine.cycles - before;
    }
    return stop;
  }

  // Max: run the cycles the current rate owes for `elapsedMs`, plus any
  // still owed from frames that ran out of time. The rate steers itself to
  // what this computer keeps up with: down a little after a frame that ends
  // behind, so the debt gets paid off, and up a little after one that ends
  // caught up with time to spare while the CPU was busy. (A program waiting
  // in HLT runs no instructions, so it says nothing about how fast this
  // computer is.) Only after a real stall, like a background tab, is the time
  // it's behind given up.
  private runMax(elapsedMs: number, skipBreakpointAtStart: boolean): StopReason {
    this.cyclesOwed += (this.maxHz * elapsedMs) / 1000;
    const deadline = performance.now() + FRAME_WORK_MS;
    const start = this.machine.cycles;
    let done = 0;
    let stop: StopReason = { kind: 'budget' };
    while (stop.kind === 'budget' && done < this.cyclesOwed && performance.now() < deadline) {
      const cycles = Math.max(1, Math.min(SLICE_CYCLES, Math.floor(this.cyclesOwed - done)));
      stop = this.machine.run({ cycles, skipBreakpointAtStart });
      skipBreakpointAtStart = false;
      done = this.machine.cycles - start;
    }
    this.cyclesOwed -= done;

    if (stop.kind === 'budget' && elapsedMs > 0) {
      let hz = this.maxHz;
      if (this.cyclesOwed > this.maxHz * MAX_LAG_SECONDS) {
        this.cyclesOwed = 0;
        hz *= MAX_SLOWER;
      } else if (this.cyclesOwed > 0) {
        hz *= MAX_SLOWER;
      } else if (!this.machine.cpu.halted && performance.now() < deadline - 4) {
        hz *= MAX_FASTER;
      }
      this.maxHz = Math.min(MAX_HIGHEST_HZ, Math.max(MAX_LOWEST_HZ, hz));
      this.setClockRate(this.maxHz);
    }
    return stop;
  }

  // The rate the machine's clock runs at in real time: what the timer
  // counts its milliseconds in, and how sound is kept in time.
  private setClockRate(hz: number) {
    const { cycles } = this.machine;
    this.timeBase = { cycles, seconds: this.secondsAt(cycles), hz };
    this.timer.setClockHz(hz);
  }

  // Emulated time at clock cycle `cycles`, in seconds.
  private secondsAt(cycles: number) {
    const { timeBase } = this;
    return timeBase.seconds + (cycles - timeBase.cycles) / timeBase.hz;
  }

  // The emulated clock: cycles run, plus cycles due but not yet run. An
  // instruction finishes all at once after its 4-18 cycles, but the clock
  // itself ticks steadily, so this is what the rate readout measures.
  private clock() {
    return this.machine.cycles + this.cyclesOwed;
  }

  // Update `measuredHz` twice a second.
  private measureRate(now: number) {
    const elapsedMs = now - this.rateSample.time;
    if (elapsedMs < 500) return;
    this.measuredHz = ((this.clock() - this.rateSample.clock) * 1000) / elapsedMs;
    this.rateSample = { time: now, clock: this.clock() };
  }

  private describe(stop: StopReason): Status {
    const pc = hex16(this.machine.cpu.pc);
    switch (stop.kind) {
      case 'breakpoint':
        return { tone: 'stop', text: `Breakpoint at ${pc}h` };
      case 'watchpoint': {
        const what =
          stop.access === 'read' || stop.access === 'write'
            ? `${stop.access} of ${hex16(stop.address)}h`
            : `${stop.access.toUpperCase()} port ${hex8(stop.address)}h`;
        return {
          tone: 'stop',
          text: `Watchpoint: ${what} = ${hex8(stop.value)}h at ${hex16(stop.pc)}h`,
        };
      }
      case 'halt': {
        const hint = this.machine.cpu.inte ? '' : ' with interrupts off';
        return { tone: 'stop', text: `Halted at ${hex16(stop.pc - 1)}h${hint}` };
      }
      case 'stop':
        return { tone: 'stop', text: stop.message ?? `Stopped at ${pc}h` };
      case 'error':
        return { tone: 'error', text: `Emulator error: ${String(stop.error)}` };
      default:
        return { tone: 'info', text: `At ${pc}h` };
    }
  }

  // Small setters for the UI

  setStatus(status: Status) {
    this.status = status;
    this.bump();
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
    writePref(SPEED_KEY, speed);
    this.cyclesOwed = 0;
    this.setClockRate(speed === 'max' ? this.maxHz : SPEEDS.find((s) => s.id === speed)!.hz!);
    // Sound scheduled for real-time playback would play after newer changes.
    if (this.running) this.speaker.playNow(this.sound.voices);
    this.bump();
  }

  setMuted(muted: boolean) {
    this.speaker.setMuted(muted);
    this.bump();
  }

  setCpu(changes: Partial<CpuState>) {
    this.machine.cpu.setState(changes);
    this.bump();
  }

  poke(address: number, value: number) {
    this.machine.poke(address, value);
    this.bump();
  }

  update(change: (machine: Machine) => void) {
    change(this.machine);
    this.bump();
  }

  clearTerminal() {
    this.terminalText = '';
    this.bump();
  }

  // The speakers play what the sound chip holds, paused or not, so stepping
  // through an OUT is heard, and a note left on keeps sounding. While running,
  // each change keeps its emulated timing; when stepping, it plays at once.
  private playSound(change: SoundChange) {
    const inTime = this.running && !this.stepping;
    this.speaker.play(change.voice, change, inTime ? this.secondsAt(change.cycles) : undefined);
  }

  private snapshot() {
    this.prevCpu = this.machine.cpu.getState();
    this.prevRam.set(this.machine.ram);
  }

  private printToTerminal(byte: number) {
    let text = this.terminalText;
    switch (byte) {
      case 0x08: // backspace
      case 0x7f: // delete
        text = text.slice(0, -1);
        break;
      case 0x0c: // form feed: clear the screen
        text = '';
        break;
      case 0x0d: // carriage return: ignored, since programs send CR LF and LF starts the new line
        return;
      default:
        if (byte === 0x0a || byte === 0x09 || byte >= 0x20) text += String.fromCharCode(byte);
    }
    if (text.length > MAX_TERMINAL_CHARS) text = text.slice(-MAX_TERMINAL_CHARS / 2);
    this.terminalText = text;

    // While running, the frame loop refreshes the UI; when stepping, do it here.
    if (!this.running) this.bump();
  }
}

function programSize(program: AssembleResult) {
  let size = 0;
  for (const segment of program.segments) size += segment.bytes.length;
  return size;
}

// True if two assembled programs have the same bytes at the same addresses.
function sameImage(a: AssembleResult, b: AssembleResult) {
  if (a.entry !== b.entry || a.segments.length !== b.segments.length) return false;
  for (let i = 0; i < a.segments.length; i++) {
    const x = a.segments[i];
    const y = b.segments[i];
    if (x.address !== y.address || x.bytes.length !== y.bytes.length) return false;
    for (let j = 0; j < x.bytes.length; j++) if (x.bytes[j] !== y.bytes[j]) return false;
  }
  return true;
}

// Move line numbers to follow an edit. Lines above the edited region keep
// their number, lines below it move by the number of lines added or removed,
// and lines inside it stay put if they still exist.
export function shiftLines(lines: ReadonlySet<number>, before: string, after: string) {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const added = newLines.length - oldLines.length;
  if (added === 0) return new Set(lines);

  // Count unchanged lines at the top and bottom.
  let top = 0;
  while (top < oldLines.length && top < newLines.length && oldLines[top] === newLines[top]) top++;
  let bottom = 0;
  const maxBottom = Math.min(oldLines.length, newLines.length) - top;
  while (bottom < maxBottom && oldLines.at(-1 - bottom) === newLines.at(-1 - bottom)) bottom++;

  const result = new Set<number>();
  for (const line of lines) {
    if (line <= top) result.add(line);
    else if (line > oldLines.length - bottom) result.add(line + added);
    else if (line <= newLines.length - bottom) result.add(line);
  }
  return result;
}
