import { Emitter } from '../emitter';
import type { Device, InterruptLine, Machine, PortHandler } from '../machine';

export interface TerminalOptions {
  // Status/control port (6850 ACIA style). Default 0x10.
  statusPort?: number;
  // Data port. Default 0x11.
  dataPort?: number;
  // Opcode raised when a byte arrives and RX interrupts are enabled. Default RST 7.
  interruptOpcode?: number;
}

// Status register bits.
const KEY_WAITING = 0x01;
const READY_TO_SEND = 0x02;
// Control register bits.
const MASTER_RESET = 0x03;
const INTERRUPT_ON_INPUT = 0x80;

// A serial terminal, modelled loosely on the Motorola 6850 ACIA used by the
// Altair 88-2SIO board.
//
//   IN  status: bit 0 = receive data ready, bit 1 = transmit buffer empty
//   OUT status: 0x03 = master reset, bit 7 = enable receive interrupt
//   IN  data:   next received byte
//   OUT data:   transmit a byte
//
// With the receive interrupt on, the interrupt line stays raised while a
// byte is waiting, as on the real chip, so a handler that reads one byte per
// interrupt still gets every byte.
//
// Other devices (e.g. the CP/M BDOS shim) can also use it directly through
// `print` and `readByte`.
export class Terminal implements Device {
  readonly name = 'Terminal';
  readonly statusPort: number;
  readonly dataPort: number;
  interruptOpcode: number;

  // Fires with each byte the machine transmits.
  readonly onOutput = new Emitter<number>();

  private input: number[] = []; // keys waiting to be read
  private interruptOnInput = false;
  private line?: InterruptLine;
  private readonly statusHandler: PortHandler = {
    in: () => (this.input.length > 0 ? KEY_WAITING : 0) | READY_TO_SEND,
    out: (_port, value) => {
      if ((value & MASTER_RESET) === MASTER_RESET) this.reset();
      else this.interruptOnInput = (value & INTERRUPT_ON_INPUT) !== 0;
      this.updateLine();
    },
  };
  private readonly dataHandler: PortHandler = {
    in: () => this.readByte() ?? 0,
    out: (_port, value) => this.onOutput.emit(value),
  };

  constructor(options: TerminalOptions = {}) {
    this.statusPort = options.statusPort ?? 0x10;
    this.dataPort = options.dataPort ?? 0x11;
    this.interruptOpcode = options.interruptOpcode ?? 0xff;
  }

  attach(machine: Machine) {
    this.line = machine.interruptLine();
    machine.mapPort(this.statusPort, this.statusHandler);
    machine.mapPort(this.dataPort, this.dataHandler);
  }

  detach(machine: Machine) {
    if (this.line) machine.releaseInterruptLine(this.line);
    machine.unmapPort(this.statusPort, this.statusHandler);
    machine.unmapPort(this.dataPort, this.dataHandler);
    this.line = undefined;
  }

  // Master reset: disable interrupts and drop unread input.
  reset() {
    this.interruptOnInput = false;
    this.input = [];
    this.updateLine();
  }

  // Queue input for the machine (e.g. keystrokes). Strings are sent as bytes.
  send(input: string | number | ArrayLike<number>) {
    for (const byte of toBytes(input)) this.input.push(byte & 0xff);
    this.updateLine();
  }

  get inputPending(): number {
    return this.input.length;
  }

  readByte(): number | undefined {
    const byte = this.input.shift();
    this.updateLine();
    return byte;
  }

  // The interrupt line is up while interrupts are on and a byte is waiting.
  private updateLine() {
    if (this.interruptOnInput && this.input.length > 0) this.line?.raise(this.interruptOpcode);
    else this.line?.lower();
  }

  // Output text as if the machine had transmitted it.
  print(text: string) {
    for (const ch of text) this.onOutput.emit(ch.charCodeAt(0) & 0xff);
  }
}

function toBytes(input: string | number | ArrayLike<number>): number[] {
  if (typeof input === 'number') return [input];
  if (typeof input === 'string') return [...input].map((ch) => ch.charCodeAt(0));
  return Array.from(input);
}
