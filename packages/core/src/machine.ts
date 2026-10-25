// A complete 8080 system: the CPU, 64K of memory, 256 I/O ports, and the
// devices plugged into them. The machine is also where the debugger hooks
// live: breakpoints, watchpoints and an execution trace.

import { Cpu8080, type Bus } from './cpu';
import { OPCODES } from './opcodes';

export interface MemoryHandler {
  read(address: number): number;
  write(address: number, value: number): void;
  // A read without side effects, for debuggers. Defaults to `read`.
  peek?(address: number): number;
}

export interface PortHandler {
  in?(port: number): number;
  out?(port: number, value: number): void;
}

// Anything that plugs into the machine: a serial port, a display, a timer...
export interface Device {
  readonly name: string;
  attach(machine: Machine): void;
  detach?(machine: Machine): void;
  reset?(): void;
}

// A mapped memory range. `end` is inclusive.
export interface MemoryRegion {
  start: number;
  end: number;
  handler: MemoryHandler;
}

export type StopReason =
  | { kind: 'budget' } // ran all the cycles it was given
  | { kind: 'breakpoint'; pc: number }
  | {
      kind: 'watchpoint';
      access: 'read' | 'write' | 'in' | 'out';
      address: number;
      value: number;
      pc: number;
    }
  | { kind: 'halt'; pc: number } // halted with interrupts off: nothing can wake it
  | { kind: 'stop'; message?: string } // someone called machine.stop()
  | { kind: 'condition' } // the `until` callback returned true
  | { kind: 'error'; error: unknown };

// Stop when memory in `start`..`end` (inclusive) is read or written.
export interface Watchpoint {
  start: number;
  end: number;
  read: boolean;
  write: boolean;
}

export interface PortWatch {
  port: number;
  in: boolean;
  out: boolean;
}

export interface RunOptions {
  // How many clock cycles (T-states) to run at most.
  cycles: number;
  // Checked after every instruction; return true to stop.
  until?: (machine: Machine) => boolean;
  // Don't stop at a breakpoint on the very first instruction. Use this to
  // continue after stopping at one.
  skipBreakpointAtStart?: boolean;
}

// A device's interrupt request line. The device raises it with the
// instruction to run, normally an RST, and it stays raised until the device
// lowers it: a serial port, say, while a byte is waiting to be read. A line
// made with `releaseOnAcknowledge` lowers itself as soon as the CPU accepts
// the interrupt instead, for one interrupt per event, like a timer's tick.
export class InterruptLine {
  active = false;
  opcode = 0xff;

  constructor(
    private readonly onChange: () => void,
    readonly releaseOnAcknowledge: boolean,
  ) {}

  // `opcode` must be a one-byte instruction: the CPU takes only that byte
  // from the device, so an instruction with operands would read them from
  // memory instead.
  raise(opcode = this.opcode) {
    if (OPCODES[opcode & 0xff].length !== 1) {
      throw new RangeError('an interrupt must supply a one-byte instruction, such as RST');
    }
    if (this.active && opcode === this.opcode) return;
    this.opcode = opcode & 0xff;
    this.active = true;
    this.onChange();
  }

  lower() {
    if (!this.active) return;
    this.active = false;
    this.onChange();
  }
}

interface ScheduledEvent {
  time: number;
  callback: () => void;
}

const TRACE_SIZE = 1024; // must be a power of two

export class Machine implements Bus {
  readonly cpu = new Cpu8080(this);
  // Plain RAM, used for every address no device has claimed.
  readonly ram = new Uint8Array(0x10000);
  // What IN returns from a port nothing is connected to (a floating bus reads as all ones).
  unmappedPortValue = 0xff;

  readonly breakpoints = new Set<number>();
  traceEnabled = true;

  private devices: Device[] = [];
  // For each 256-byte page, the regions mapped over it (newest first), or null for plain RAM.
  private pages: (MemoryRegion[] | null)[] = new Array(256).fill(null);
  private inputs: (PortHandler | null)[] = new Array(256).fill(null);
  private outputs: (PortHandler | null)[] = new Array(256).fill(null);

  private interruptLines: InterruptLine[] = [];
  // The line whose interrupt the CPU has been offered.
  private offeredLine: InterruptLine | null = null;
  // For `interrupt()`: one request at a time, gone once accepted.
  private oneShotLine = this.interruptLine({ releaseOnAcknowledge: true });

  private events: ScheduledEvent[] = []; // sorted by time
  private nextEventTime = Infinity;

  private watchpoints: Watchpoint[] = [];
  private portWatches: PortWatch[] = [];
  private watching = false;
  private stopRequest: StopReason | null = null;
  private instructionAddress = 0; // for watchpoint reports

  private traceBuffer = new Uint16Array(TRACE_SIZE);
  private traceLength = 0;
  private traceNext = 0;

  // The bus, as seen by the CPU

  read(address: number) {
    const region = this.regionAt(address);
    const value = region ? region.handler.read(address) & 0xff : this.ram[address];
    if (this.watching) this.checkWatchpoints(address, value, 'read');
    return value;
  }

  write(address: number, value: number) {
    if (this.watching) this.checkWatchpoints(address, value, 'write');
    const region = this.regionAt(address);
    if (region) region.handler.write(address, value);
    else this.ram[address] = value;
  }

  input(port: number) {
    const handler = this.inputs[port];
    const value = handler?.in ? handler.in(port) & 0xff : this.unmappedPortValue;
    if (this.watching) this.checkPortWatches(port, value, 'in');
    return value;
  }

  output(port: number, value: number) {
    if (this.watching) this.checkPortWatches(port, value, 'out');
    this.outputs[port]?.out?.(port, value);
  }

  private regionAt(address: number) {
    const regions = this.pages[address >> 8];
    if (!regions) return undefined;
    // A plain loop: this runs on every access to mapped memory.
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      if (address >= region.start && address <= region.end) return region;
    }
    return undefined;
  }

  // Memory access for debuggers and loaders: no watchpoints, no side effects

  peek(address: number) {
    address &= 0xffff;
    const region = this.regionAt(address);
    if (!region) return this.ram[address];
    const { handler } = region;
    return (handler.peek ? handler.peek(address) : handler.read(address)) & 0xff;
  }

  peek16(address: number) {
    return this.peek(address) | (this.peek(address + 1) << 8);
  }

  poke(address: number, value: number) {
    const watching = this.watching;
    this.watching = false;
    this.write(address & 0xffff, value & 0xff);
    this.watching = watching;
  }

  // Copy bytes into memory. Writes to ROM are ignored, as on real hardware.
  load(address: number, bytes: ArrayLike<number>) {
    for (let i = 0; i < bytes.length; i++) this.poke(address + i, bytes[i]);
  }

  // Devices

  add<T extends Device>(device: T): T {
    this.devices.push(device);
    device.attach(this);
    return device;
  }

  remove(device: Device) {
    if (!this.devices.includes(device)) return;
    this.devices = this.devices.filter((d) => d !== device);
    device.detach?.(this);
  }

  // Claim `length` bytes from `start`. A newer mapping hides an older one.
  mapMemory(start: number, length: number, handler: MemoryHandler): MemoryRegion {
    const end = start + length - 1;
    if (start < 0 || length <= 0 || end > 0xffff) {
      throw new RangeError('memory region out of range');
    }

    const region = { start, end, handler };
    for (let page = start >> 8; page <= end >> 8; page++) {
      this.pages[page] = [region, ...(this.pages[page] ?? [])];
    }
    return region;
  }

  unmapMemory(region: MemoryRegion) {
    for (let page = region.start >> 8; page <= region.end >> 8; page++) {
      const rest = (this.pages[page] ?? []).filter((r) => r !== region);
      this.pages[page] = rest.length > 0 ? rest : null;
    }
  }

  // Claim one or more ports. A handler with only `in` or only `out` claims
  // just that direction, so an input and an output device can share a port.
  // Claiming a direction another handler already has is an error.
  mapPort(ports: number | number[], handler: PortHandler) {
    const list = [ports].flat().map((port) => port & 0xff);
    for (const port of list) {
      const taken =
        (handler.in && this.inputs[port] && this.inputs[port] !== handler) ||
        (handler.out && this.outputs[port] && this.outputs[port] !== handler);
      if (taken) throw new Error(`port ${port.toString(16).toUpperCase()}h is already in use`);
    }
    for (const port of list) {
      if (handler.in) this.inputs[port] = handler;
      if (handler.out) this.outputs[port] = handler;
    }
  }

  // Release ports. With a handler, only what that handler claimed is
  // released, so a device sharing a port with another leaves it connected.
  unmapPort(ports: number | number[], handler?: PortHandler) {
    for (const port of [ports].flat()) {
      const p = port & 0xff;
      if (!handler || this.inputs[p] === handler) this.inputs[p] = null;
      if (!handler || this.outputs[p] === handler) this.outputs[p] = null;
    }
  }

  // Time and interrupts. Time is measured in clock cycles (T-states).

  get cycles() {
    return this.cpu.cycles;
  }

  // Of those, the cycles spent halted, waiting for an interrupt.
  haltedCycles = 0;

  // Call `callback` after `delay` cycles. Returns a function that cancels it.
  schedule(delay: number, callback: () => void) {
    return this.scheduleAt(this.cpu.cycles + delay, callback);
  }

  scheduleAt(time: number, callback: () => void) {
    const event = { time, callback };
    // Keep the list sorted; events due at the same time run in the order they were added.
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > time) i--;
    this.events.splice(i, 0, event);
    this.nextEventTime = this.events[0].time;

    return () => {
      this.events = this.events.filter((e) => e !== event);
      this.nextEventTime = this.events[0]?.time ?? Infinity;
    };
  }

  private runDueEvents() {
    while (this.events.length > 0 && this.events[0].time <= this.cpu.cycles) {
      this.events.shift()!.callback();
    }
    this.nextEventTime = this.events[0]?.time ?? Infinity;
  }

  // Interrupts. Each device has its own request line. When several are
  // raised, the CPU is offered the highest RST, the way Intel's 8214
  // priority chip ranked them; the others wait their turn, none is lost.

  // A new interrupt request line, for a device to raise and lower.
  interruptLine({ releaseOnAcknowledge = false } = {}) {
    const line = new InterruptLine(() => this.updateInterrupts(), releaseOnAcknowledge);
    this.interruptLines.push(line);
    return line;
  }

  // Remove a line made by `interruptLine`, as when its device is detached.
  releaseInterruptLine(line: InterruptLine) {
    this.interruptLines = this.interruptLines.filter((l) => l !== line);
    if (this.offeredLine === line) this.offeredLine = null;
    this.updateInterrupts();
  }

  // Request one interrupt. `opcode` is the instruction the device supplies,
  // normally an RST (0xC7 + 8n). The default, 0xFF, is RST 7. The request is
  // gone once the CPU accepts it.
  interrupt(opcode = 0xff) {
    this.oneShotLine.raise(opcode);
  }

  // Offer the CPU the interrupt of the highest raised line, if any.
  private updateInterrupts() {
    let best: InterruptLine | null = null;
    for (const line of this.interruptLines) {
      if (line.active && (!best || line.opcode > best.opcode)) best = line;
    }
    this.offeredLine = best;
    if (best) this.cpu.interrupt(best.opcode);
    else this.cpu.clearInterrupt();
  }

  // The CPU accepted the interrupt it was offered.
  acknowledgeInterrupt() {
    const line = this.offeredLine;
    if (line?.releaseOnAcknowledge) line.active = false;
    // The CPU has dropped its request; offer the next one (it waits until
    // the handler turns interrupts back on).
    this.updateInterrupts();
  }

  // Breakpoints, watchpoints and the trace

  toggleBreakpoint(address: number) {
    address &= 0xffff;
    if (this.breakpoints.has(address)) this.breakpoints.delete(address);
    else this.breakpoints.add(address);
    return this.breakpoints.has(address);
  }

  get watchpointList(): readonly Watchpoint[] {
    return this.watchpoints;
  }

  addWatchpoint(watchpoint: Watchpoint) {
    this.watchpoints.push(watchpoint);
    this.updateWatching();
  }

  removeWatchpoint(watchpoint: Watchpoint) {
    this.watchpoints = this.watchpoints.filter((w) => w !== watchpoint);
    this.updateWatching();
  }

  get portWatchList(): readonly PortWatch[] {
    return this.portWatches;
  }

  addPortWatch(watch: PortWatch) {
    this.portWatches.push(watch);
    this.updateWatching();
  }

  removePortWatch(watch: PortWatch) {
    this.portWatches = this.portWatches.filter((w) => w !== watch);
    this.updateWatching();
  }

  // Watchpoints slow every memory access down, so only check when there are some.
  private updateWatching() {
    this.watching = this.watchpoints.length > 0 || this.portWatches.length > 0;
  }

  private checkWatchpoints(address: number, value: number, access: 'read' | 'write') {
    const hit = this.watchpoints.some(
      (w) => address >= w.start && address <= w.end && (access === 'read' ? w.read : w.write),
    );
    if (hit) {
      this.requestStop({ kind: 'watchpoint', access, address, value, pc: this.instructionAddress });
    }
  }

  private checkPortWatches(port: number, value: number, access: 'in' | 'out') {
    const hit = this.portWatches.some((w) => w.port === port && (access === 'in' ? w.in : w.out));
    if (hit) {
      this.requestStop({
        kind: 'watchpoint',
        access,
        address: port,
        value,
        pc: this.instructionAddress,
      });
    }
  }

  // Make a running `run()` return after the current instruction.
  stop(message?: string) {
    this.requestStop({ kind: 'stop', message });
  }

  private requestStop(reason: StopReason) {
    this.stopRequest ??= reason; // the first reason wins
  }

  // Addresses of the most recently executed instructions, oldest first.
  trace() {
    const addresses: number[] = [];
    for (let i = this.traceLength; i > 0; i--) {
      addresses.push(this.traceBuffer[(this.traceNext - i) & (TRACE_SIZE - 1)]);
    }
    return addresses;
  }

  private recordTrace(address: number) {
    this.traceBuffer[this.traceNext] = address;
    this.traceNext = (this.traceNext + 1) & (TRACE_SIZE - 1);
    this.traceLength = Math.min(this.traceLength + 1, TRACE_SIZE);
  }

  // Running

  // Reset the CPU and every device. Memory and breakpoints are kept.
  reset() {
    this.cpu.reset();
    for (const line of this.interruptLines) line.active = false;
    this.offeredLine = null;
    this.events = [];
    this.nextEventTime = Infinity;
    this.stopRequest = null;
    this.traceLength = 0;
    this.traceNext = 0;
    this.haltedCycles = 0;
    for (const device of this.devices) device.reset?.();
  }

  // Run until the cycle budget is used up or something stops it.
  run({ cycles, until, skipBreakpointAtStart = false }: RunOptions): StopReason {
    const cpu = this.cpu;
    const endTime = cpu.cycles + cycles;
    let skipBreakpoint = skipBreakpointAtStart;
    this.stopRequest = null;

    try {
      while (cpu.cycles < endTime) {
        if (cpu.cycles >= this.nextEventTime) this.runDueEvents();

        if (cpu.halted) {
          // Only an interrupt wakes a halted CPU, and only if interrupts are enabled.
          if (!cpu.inte) return { kind: 'halt', pc: cpu.pc };
          if (!cpu.interruptPending) {
            // Nothing happens until an interrupt: from a scheduled event, or
            // from outside, like a key arriving. Skip ahead to the next event,
            // or wait out the budget.
            const wakeTime = Math.max(cpu.cycles, Math.min(this.nextEventTime, endTime));
            this.haltedCycles += wakeTime - cpu.cycles;
            cpu.cycles = wakeTime;
            if (this.stopRequest) return this.stopRequest;
            continue;
          }
        }

        if (this.breakpoints.has(cpu.pc) && !skipBreakpoint && !cpu.halted) {
          return { kind: 'breakpoint', pc: cpu.pc };
        }
        skipBreakpoint = false;

        this.instructionAddress = cpu.pc;
        if (this.traceEnabled) this.recordTrace(cpu.pc);
        cpu.step();

        if (this.stopRequest) return this.stopRequest;
        if (until?.(this)) return { kind: 'condition' };
      }
    } catch (error) {
      return { kind: 'error', error };
    }
    return { kind: 'budget' };
  }

  // Run one instruction. Returns null, or why it stopped (a watchpoint, say).
  step() {
    return orNull(this.run({ cycles: 1, skipBreakpointAtStart: true }), 'budget');
  }

  // Like `step`, but runs a whole CALL or RST until it returns. `budget`
  // stops a subroutine that never returns from hanging the caller.
  stepOver(budget = 50_000_000) {
    const until = this.stepOverCondition();
    if (!until) return this.step();
    return orNull(this.run({ cycles: budget, skipBreakpointAtStart: true, until }), 'condition');
  }

  // Run until the current subroutine returns: a return instruction that
  // leaves the stack higher than where we started (allowing for it wrapping
  // past FFFFh, as with a stack set up by LXI SP,0).
  stepOut(budget = 50_000_000) {
    const until = this.stepOutCondition();
    return orNull(this.run({ cycles: budget, skipBreakpointAtStart: true, until }), 'condition');
  }

  // The `until` condition `stepOver` runs with, or null if the instruction at
  // PC isn't a CALL or RST. For running a step over in slices, say one per
  // animation frame: pass it to every `run`.
  stepOverCondition(): ((machine: Machine) => boolean) | null {
    const instruction = OPCODES[this.peek(this.cpu.pc)];
    if (instruction.flow !== 'call' && instruction.flow !== 'rst') return null;

    const returnAddress = (this.cpu.pc + instruction.length) & 0xffff;
    const stack = this.cpu.sp;
    return ({ cpu }) => cpu.pc === returnAddress && cpu.sp === stack;
  }

  // The `until` condition `stepOut` runs with. It must see every instruction
  // from now on, so pass it to every `run` until it returns true.
  stepOutCondition(): (machine: Machine) => boolean {
    const stack = this.cpu.sp;
    const isReturn = (machine: Machine) => OPCODES[machine.peek(machine.cpu.pc)].flow === 'ret';
    let atReturn = isReturn(this);

    return (machine) => {
      const rise = (machine.cpu.sp - stack) & 0xffff;
      const justReturned = atReturn && rise > 0 && rise < 0x8000;
      atReturn = isReturn(machine);
      return justReturned;
    };
  }
}

// The step functions return null when they finished normally.
function orNull(stop: StopReason, normal: StopReason['kind']) {
  return stop.kind === normal ? null : stop;
}
