import type { Device, InterruptLine, Machine, PortHandler } from '../machine';

export interface TimerOptions {
  // Control port: OUT 0 stops, OUT n starts with a period of n ms. Default 0x30.
  port?: number;
  // CPU clock frequency, used to convert ms to T-states. Default 2 MHz.
  // A host that runs the CPU at another rate can change it with setClockHz.
  clockHz?: number;
  // Opcode raised on each tick. Default RST 1 (0xCF).
  interruptOpcode?: number;
}

// A programmable periodic interrupt source.
//
//   OUT port, n   start ticking every n milliseconds (0 = stop)
//   IN  port      number of ticks so far (low byte)
export class Timer implements Device {
  readonly name = 'Timer';
  readonly port: number;
  clockHz: number;
  interruptOpcode: number;
  periodMs = 0;
  ticks = 0;
  private cancel?: () => void;
  private nextTick = 0; // the cycle the next tick is due at, maybe a fraction
  private machine?: Machine;
  // Raised on each tick until the CPU accepts the interrupt.
  private line?: InterruptLine;
  private readonly handler: PortHandler = {
    out: (_port, value) => this.start(value),
    in: () => this.ticks & 0xff,
  };

  constructor(options: TimerOptions = {}) {
    this.port = options.port ?? 0x30;
    this.clockHz = checkClockHz(options.clockHz ?? 2_000_000);
    this.interruptOpcode = options.interruptOpcode ?? 0xcf;
  }

  attach(machine: Machine) {
    this.machine = machine;
    this.line = machine.interruptLine({ releaseOnAcknowledge: true });
    machine.mapPort(this.port, this.handler);
  }

  detach(machine: Machine) {
    this.stop();
    if (this.line) machine.releaseInterruptLine(this.line);
    machine.unmapPort(this.port, this.handler);
    this.machine = undefined;
    this.line = undefined;
  }

  reset() {
    // Machine.reset() already clears scheduled events and interrupt lines.
    this.cancel = undefined;
    this.periodMs = 0;
    this.ticks = 0;
  }

  start(periodMs: number) {
    this.stop();
    this.periodMs = periodMs;
    if (periodMs > 0 && this.machine) this.scheduleTick(this.machine.cycles + this.period());
  }

  // Change the clock rate the period is measured in, as when the CPU runs
  // faster or slower than its nominal clock. A tick already on its way
  // arrives after the same share of its period.
  setClockHz(clockHz: number) {
    checkClockHz(clockHz);
    if (clockHz === this.clockHz) return;
    const old = this.clockHz;
    this.clockHz = clockHz;
    if (!this.cancel || !this.machine) return;
    const now = this.machine.cycles;
    const remaining = Math.max(0, this.nextTick - now);
    this.cancel();
    this.scheduleTick(now + (remaining * clockHz) / old);
  }

  // The period in clock cycles. It may be a fraction, or less than one.
  private period() {
    return (this.clockHz * this.periodMs) / 1000;
  }

  // Tick at cycle `time`, then every period after it. Each period counts
  // from when the last tick was due, not from when it fired: a tick can only
  // fire between instructions, so it may be a few cycles late. Due times
  // keep their fractions, so the rate comes out exact in the long run.
  private scheduleTick(time: number) {
    const machine = this.machine;
    if (!machine) return;
    this.nextTick = time;
    this.cancel = machine.scheduleAt(Math.ceil(time), () => {
      this.ticks++;
      this.line?.raise(this.interruptOpcode);
      this.scheduleTick(time + this.period());
    });
  }

  stop() {
    this.cancel?.();
    this.cancel = undefined;
    this.periodMs = 0;
  }
}

// A clock rate of 0 (or less) would make every tick due at once, forever.
function checkClockHz(clockHz: number) {
  if (!(clockHz > 0) || !Number.isFinite(clockHz)) {
    throw new RangeError(`the timer's clock rate must be above 0 Hz, not ${clockHz}`);
  }
  return clockHz;
}
