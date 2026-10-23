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
  Switches,
  Terminal,
  Timer,
  type AssembleResult,
  type CpuState,
  type StopReason,
} from '@i8080/core';

export type Speed = 'slow' | 'medium' | 'real' | 'max';

export const SPEEDS: { id: Speed; label: string; title: string }[] = [
  { id: 'slow', label: '4 Hz', title: '4 instructions per second' },
  { id: 'medium', label: '60 Hz', title: '60 instructions per second' },
  { id: 'real', label: '2 MHz', title: 'Real Altair speed' },
  { id: 'max', label: 'Max', title: 'As fast as this computer can go' },
];

const CLOCK_HZ = 2_000_000;
const MAX_TERMINAL_CHARS = 64 * 1024;

export interface Status {
  tone: 'info' | 'stop' | 'error' | 'ok';
  text: string;
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

  // What's loaded: either an assembled program or a binary.
  program: AssembleResult | null = null;
  programSource = '';
  binary: BinaryImage | null = null;

  // Breakpoints by source line, so they survive reassembly.
  lineBreakpoints = new Set<number>();

  running = false;
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
  private stepsOwed = 0; // at the slow speeds, steps carried over to the next frame
  private rateSample = { time: 0, cycles: 0 };
  private resuming = false; // the first instruction may be on the breakpoint we stopped at

  constructor() {
    this.terminal.onOutput.on((byte) => this.printToTerminal(byte));
    this.switches.onChange.on(() => this.bump());
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
    const wasRunning = this.running;
    this.pause();
    this.machine.ram.fill(0);
    this.display.clear();
    this.machine.reset();
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
    this.running = true;
    this.resuming = true;
    this.stepsOwed = 0;
    this.lastFrameTime = performance.now();
    this.rateSample = { time: this.lastFrameTime, cycles: this.machine.cycles };
    this.status = { tone: 'info', text: 'Running' };
    this.frameRequest = requestAnimationFrame(this.onFrame);
    this.bump();
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.status = { tone: 'info', text: `Paused at ${hex16(this.machine.cpu.pc)}h` };
    this.bump();
  }

  step() {
    this.debugStep(() => this.machine.step());
  }

  stepOver() {
    this.debugStep(() => this.machine.stepOver());
  }

  stepOut() {
    this.debugStep(() => this.machine.stepOut());
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
      this.status = this.describe(stop);
    }
    this.bump();
  };

  // Run the amount of emulated time that fits in `elapsedMs` at the current speed.
  private runFor(elapsedMs: number): StopReason {
    // Only the very first instruction after Run may skip its breakpoint.
    let skipBreakpointAtStart = this.resuming;
    this.resuming = false;

    if (this.speed === 'real') {
      const cycles = Math.round((elapsedMs / 1000) * CLOCK_HZ);
      return this.machine.run({ cycles, skipBreakpointAtStart });
    }

    if (this.speed === 'max') {
      // Run in chunks until most of a 60 fps frame is used up.
      const deadline = performance.now() + 12;
      let stop: StopReason = { kind: 'budget' };
      while (stop.kind === 'budget' && performance.now() < deadline) {
        stop = this.machine.run({ cycles: 250_000, skipBreakpointAtStart });
        skipBreakpointAtStart = false;
      }
      return stop;
    }

    // Slow speeds: a whole number of single steps, snapshotting before each
    // one so the UI highlights what every instruction changed.
    const stepsPerSecond = this.speed === 'slow' ? 4 : 60;
    this.stepsOwed += (elapsedMs / 1000) * stepsPerSecond;
    let stop: StopReason = { kind: 'budget' };
    while (this.stepsOwed >= 1 && stop.kind === 'budget') {
      this.stepsOwed--;
      this.snapshot();
      stop = this.machine.run({ cycles: 1, skipBreakpointAtStart }); // one instruction
      skipBreakpointAtStart = false;
    }
    return stop;
  }

  // Update `measuredHz` twice a second.
  private measureRate(now: number) {
    const elapsedMs = now - this.rateSample.time;
    if (elapsedMs < 500) return;
    this.measuredHz = ((this.machine.cycles - this.rateSample.cycles) * 1000) / elapsedMs;
    this.rateSample = { time: now, cycles: this.machine.cycles };
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
