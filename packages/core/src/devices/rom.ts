import type { Device, Machine, MemoryRegion } from '../machine';

// Read-only memory. Writes are silently ignored, as on real hardware.
export class Rom implements Device {
  readonly name: string;
  readonly data: Uint8Array;
  private region?: MemoryRegion;

  constructor(
    readonly start: number,
    contents: ArrayLike<number> | number,
    name = 'ROM',
  ) {
    this.data = typeof contents === 'number' ? new Uint8Array(contents) : Uint8Array.from(contents);
    this.name = name;
  }

  attach(machine: Machine) {
    this.region = machine.mapMemory(this.start, this.data.length, {
      read: (address) => this.data[address - this.start],
      write: () => {},
    });
  }

  detach(machine: Machine) {
    if (this.region) machine.unmapMemory(this.region);
  }
}
