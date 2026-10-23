import { Emitter } from '../emitter';
import type { Device, Machine } from '../machine';

// Eight LEDs latched from an output port.
export class Leds implements Device {
  readonly name = 'LEDs';
  value = 0;
  readonly onChange = new Emitter<number>();

  constructor(readonly port = 0x20) {}

  attach(machine: Machine) {
    machine.mapPort(this.port, {
      out: (_port, value) => {
        this.value = value;
        this.onChange.emit(value);
      },
      in: () => this.value,
    });
  }

  detach(machine: Machine) {
    machine.unmapPort(this.port);
  }

  reset() {
    this.value = 0;
    this.onChange.emit(0);
  }
}

// Eight toggle switches read from an input port (like the Altair sense switches).
export class Switches implements Device {
  readonly name = 'Switches';
  value = 0;
  readonly onChange = new Emitter<number>();

  constructor(readonly port = 0x21) {}

  attach(machine: Machine) {
    machine.mapPort(this.port, { in: () => this.value });
  }

  detach(machine: Machine) {
    machine.unmapPort(this.port);
  }

  set(value: number) {
    this.value = value & 0xff;
    this.onChange.emit(this.value);
  }

  toggle(bit: number) {
    this.set(this.value ^ (1 << bit));
  }
}
