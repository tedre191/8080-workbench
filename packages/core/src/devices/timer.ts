import type { Device, Machine } from '../machine';

export interface TimerOptions {
  // Control port: OUT 0 stops, OUT n starts with a period of n ms. Default 0x30.
  port?: number;
  // CPU clock frequency, used to convert ms to T-states. Default 2 MHz.
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
  readonly clockHz: number;
  interruptOpcode: number;
  periodMs = 0;
  ticks = 0;
  private cancel?: () => void;
  private machine?: Machine;

  constructor(options: TimerOptions = {}) {
    this.port = options.port ?? 0x30;
    this.clockHz = options.clockHz ?? 2_000_000;
    this.interruptOpcode = options.interruptOpcode ?? 0xcf;
  }

  attach(machine: Machine) {
    this.machine = machine;
    machine.mapPort(this.port, {
      out: (_port, value) => this.start(value),
      in: () => this.ticks & 0xff,
    });
  }

  detach(machine: Machine) {
    this.stop();
    machine.unmapPort(this.port);
    this.machine = undefined;
  }

  reset() {
    // Machine.reset() already clears scheduled events.
    this.cancel = undefined;
    this.periodMs = 0;
    this.ticks = 0;
  }

  start(periodMs: number) {
    this.stop();
    this.periodMs = periodMs;
    if (periodMs <= 0 || !this.machine) return;
    const machine = this.machine;
    const period = Math.max(1, Math.round((this.clockHz * periodMs) / 1000));
    const tick = () => {
      this.ticks++;
      machine.interrupt(this.interruptOpcode);
      this.cancel = machine.schedule(period, tick);
    };
    this.cancel = machine.schedule(period, tick);
  }

  stop() {
    this.cancel?.();
    this.cancel = undefined;
    this.periodMs = 0;
  }
}
