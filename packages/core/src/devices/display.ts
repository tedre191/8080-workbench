import type { Device, Machine, MemoryRegion } from '../machine';

export interface DisplayOptions {
  // Base address of video memory. Default 0xF000.
  address?: number;
  width?: number;
  height?: number;
}

// A memory-mapped colour display: one byte per pixel, row-major, starting at
// `address`. Each byte is an index into a 16-colour palette (low nibble).
export class Display implements Device {
  readonly name = 'Display';
  readonly address: number;
  readonly width: number;
  readonly height: number;
  readonly vram: Uint8Array;
  // Incremented whenever video memory changes; UIs can poll it cheaply.
  version = 0;
  private region?: MemoryRegion;

  // The classic CGA-ish 16-colour palette, as 0xRRGGBB.
  static readonly PALETTE = [
    0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa, 0x555555,
    0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
  ];

  constructor(options: DisplayOptions = {}) {
    this.address = options.address ?? 0xf000;
    this.width = options.width ?? 32;
    this.height = options.height ?? 32;
    this.vram = new Uint8Array(this.width * this.height);
  }

  attach(machine: Machine) {
    this.region = machine.mapMemory(this.address, this.vram.length, {
      read: (address) => this.vram[address - this.address],
      write: (address, value) => {
        this.vram[address - this.address] = value;
        this.version++;
      },
    });
  }

  detach(machine: Machine) {
    if (this.region) machine.unmapMemory(this.region);
  }

  // Blank the screen. (A machine reset leaves video memory alone, like real RAM.)
  clear() {
    this.vram.fill(0);
    this.version++;
  }
}
