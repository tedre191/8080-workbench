import { Emitter } from '../emitter';
import type { Device, Machine } from '../machine';

export interface TerminalOptions {
  // Status/control port (6850 ACIA style). Default 0x10.
  statusPort?: number;
  // Data port. Default 0x11.
  dataPort?: number;
  // Opcode raised when a byte arrives and RX interrupts are enabled. Default RST 7.
  interruptOpcode?: number;
}

// A serial terminal, modelled loosely on the Motorola 6850 ACIA used by the
// Altair 88-2SIO board.
//
//   IN  status: bit 0 = receive data ready, bit 1 = transmit buffer empty
//   OUT status: 0x03 = master reset, bit 7 = enable receive interrupt
//   IN  data:   next received byte
//   OUT data:   transmit a byte
//
// Other devices (e.g. the CP/M BDOS shim) can also use it directly through
// `print` and `readByte`.
// Status register bits.
const KEY_WAITING = 0x01;
const READY_TO_SEND = 0x02;
// Control register bits.
const MASTER_RESET = 0x03;
const INTERRUPT_ON_INPUT = 0x80;

export class Terminal implements Device {
  readonly name = 'Terminal';
  readonly statusPort: number;
  readonly dataPort: number;
  interruptOpcode: number;

  // Fires with each byte the machine transmits.
  readonly onOutput = new Emitter<number>();

  private input: number[] = []; // keys waiting to be read
  private interruptOnInput = false;
  private machine?: Machine;

  constructor(options: TerminalOptions = {}) {
    this.statusPort = options.statusPort ?? 0x10;
    this.dataPort = options.dataPort ?? 0x11;
    this.interruptOpcode = options.interruptOpcode ?? 0xff;
  }

  attach(machine: Machine) {
    this.machine = machine;
    machine.mapPort(this.statusPort, {
      in: () => (this.input.length > 0 ? KEY_WAITING : 0) | READY_TO_SEND,
      out: (_port, value) => {
        if ((value & MASTER_RESET) === MASTER_RESET) this.reset();
        else this.interruptOnInput = (value & INTERRUPT_ON_INPUT) !== 0;
      },
    });
    machine.mapPort(this.dataPort, {
      in: () => this.readByte() ?? 0,
      out: (_port, value) => this.onOutput.emit(value),
    });
  }

  detach(machine: Machine) {
    machine.unmapPort([this.statusPort, this.dataPort]);
    this.machine = undefined;
  }

  // Master reset: disable interrupts and drop unread input.
  reset() {
    this.interruptOnInput = false;
    this.input = [];
  }

  // Queue input for the machine (e.g. keystrokes). Strings are sent as bytes.
  send(input: string | number | ArrayLike<number>) {
    for (const byte of toBytes(input)) this.input.push(byte & 0xff);
    if (this.interruptOnInput) this.machine?.interrupt(this.interruptOpcode);
  }

  get inputPending(): number {
    return this.input.length;
  }

  readByte(): number | undefined {
    return this.input.shift();
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
