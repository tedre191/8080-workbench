import type { Device, Machine, PortHandler } from '../machine';
import type { Terminal } from './terminal';

export interface CpmOptions {
  bdosPort?: number; // the BDOS stub calls into this device here (default FEh)
  exitPort?: number; // the warm-boot stub signals exit here (default FFh)
  bdosAddress?: number; // where the BDOS stub goes; also the top of memory (default FF00h)
}

// Just enough of CP/M to run console programs, such as the classic CPU
// exercisers. CP/M programs call the operating system with CALL 5 and a
// function number in C; this device answers those calls.
//
// `loadCom` puts three tiny stubs in memory:
//   0000h   OUT exitPort; HLT     a program that jumps to 0 has finished
//   0005h   JMP bdosAddress       the entry point programs CALL
//   bdos    OUT bdosPort; RET     hands the call to this device
//
// Supported functions: 0 exit, 1 read a key, 2 print a character, 6 direct
// console I/O, 9 print a string ending in '$', 11 key waiting?, 12 version.
export class CpmBdos implements Device {
  readonly name = 'CP/M BDOS';
  readonly bdosPort: number;
  readonly exitPort: number;
  readonly bdosAddress: number;
  calls = 0; // BDOS calls since the last loadCom
  private machine?: Machine;
  private readonly bdosHandler: PortHandler = { out: () => this.handleCall() };
  private readonly exitHandler: PortHandler = {
    out: () => this.machine?.stop('Program exited (CP/M warm boot)'),
  };

  constructor(
    readonly terminal: Terminal,
    options: CpmOptions = {},
  ) {
    this.bdosPort = options.bdosPort ?? 0xfe;
    this.exitPort = options.exitPort ?? 0xff;
    this.bdosAddress = options.bdosAddress ?? 0xff00;
  }

  attach(machine: Machine) {
    this.machine = machine;
    machine.mapPort(this.bdosPort, this.bdosHandler);
    machine.mapPort(this.exitPort, this.exitHandler);
  }

  detach(machine: Machine) {
    machine.unmapPort(this.bdosPort, this.bdosHandler);
    machine.unmapPort(this.exitPort, this.exitHandler);
    this.machine = undefined;
  }

  // The largest .COM program that fits between 0100h and the stack.
  get maxComSize() {
    return this.bdosAddress - 2 - 0x100;
  }

  // Load a .COM program at 0100h, where CP/M programs start.
  loadCom(program: ArrayLike<number>) {
    const machine = this.machine;
    if (!machine) throw new Error('CpmBdos is not attached to a machine');
    if (program.length > this.maxComSize) {
      throw new RangeError(
        `a .COM program can be at most ${this.maxComSize} bytes, not ${program.length}`,
      );
    }
    machine.reset();
    this.calls = 0;

    const OUT = 0xd3;
    const HLT = 0x76;
    const JMP = 0xc3;
    const RET = 0xc9;
    const bdos = this.bdosAddress;
    machine.load(0x0000, [OUT, this.exitPort, HLT]);
    machine.load(0x0005, [JMP, bdos & 0xff, bdos >> 8]);
    machine.load(bdos, [OUT, this.bdosPort, RET]);

    machine.load(0x0100, program);
    machine.cpu.pc = 0x0100;
    // Start the stack just below the BDOS, holding a return address of 0, so
    // a program that ends with RET exits.
    machine.cpu.sp = (bdos - 2) & 0xffff;
    machine.load(machine.cpu.sp, [0, 0]);
  }

  private handleCall() {
    const machine = this.machine!;
    const { cpu } = machine;
    const terminal = this.terminal;
    // CP/M returns results in both A and L.
    const returnValue = (value: number) => (cpu.a = cpu.l = value);
    this.calls++;

    switch (cpu.c) {
      case 0: // exit
        machine.stop('Program exited (BDOS reset)');
        break;

      case 1: {
        // Read a key and echo it. With no key waiting, run the stub again,
        // which keeps the program waiting.
        const key = terminal.readByte();
        if (key === undefined) {
          cpu.pc = this.bdosAddress;
          break;
        }
        terminal.print(String.fromCharCode(key));
        returnValue(key);
        break;
      }

      case 2: // print the character in E
        terminal.print(String.fromCharCode(cpu.e));
        break;

      case 6: // E = FFh: read a key without waiting (0 if none); otherwise print E
        if (cpu.e === 0xff) returnValue(terminal.readByte() ?? 0);
        else terminal.print(String.fromCharCode(cpu.e));
        break;

      case 9: // print the string at DE, which ends with '$'
        terminal.print(this.readDollarString(cpu.de));
        break;

      case 11: // is a key waiting?
        returnValue(terminal.inputPending > 0 ? 0xff : 0);
        break;

      case 12: // version: CP/M 2.2
        cpu.hl = 0x0022;
        cpu.a = cpu.l;
        cpu.b = cpu.h;
        break;

      default: // not supported: answer 0, like a BDOS that knows nothing
        returnValue(0);
    }
  }

  private readDollarString(address: number) {
    let text = '';
    for (let i = 0; i < 0x10000; i++) {
      const ch = this.machine!.peek(address + i);
      if (ch === 0x24) break; // '$'
      text += String.fromCharCode(ch);
    }
    return text;
  }
}
