# @i8080/core

An Intel 8080 emulator library in TypeScript, with no dependencies: a
cycle-accurate CPU, a machine with memory and I/O maps, pluggable devices, an
assembler and a disassembler. It passes the classic CPU exercisers (TST8080,
8080PRE, CPUTEST and 8080EXM), cycle-exact against the reference counts.

It powers the 8080 Workbench, a browser-based debugger, but knows nothing
about any UI.

## Example

```ts
import { assemble, Machine, Terminal } from '@i8080/core';

const m = new Machine();
const tty = m.add(new Terminal());
tty.onOutput.on((byte) => process.stdout.write(String.fromCharCode(byte)));

const { segments, entry, errors } = assemble(`
        LXI H, msg
loop:   MOV A, M
        ORA A
        JZ done
        OUT 11h
        INX H
        JMP loop
done:   HLT
msg:    DB "Hello!", 10, 0
`);
for (const s of segments) m.load(s.address, s.bytes);
m.cpu.pc = entry;

const stop = m.run({ cycles: 1_000_000 }); // prints Hello!, then { kind: 'halt', pc: 15 }
```

## Running and debugging

`machine.run({ cycles })` executes until the cycle budget is used up or
something stops it, and returns why: `budget`, `breakpoint`, `watchpoint`,
`halt` (with interrupts off, nothing can wake the CPU), `stop` (something
called `machine.stop()`), `condition` (your `until` predicate) or `error`.
`step()`, `stepOver()` and `stepOut()` build on it. To run a step over or out
in slices without blocking (one per animation frame, say), pass
`stepOverCondition()` or `stepOutCondition()` as `until` to each `run`.

- `machine.breakpoints` is a `Set` of addresses.
- `addWatchpoint({ start, end, read, write })` stops on memory access, and
  `addPortWatch({ port, in, out })` on I/O.
- `trace()` returns the addresses of the last 1024 instructions executed.
- `peek` and `poke` read and write memory without triggering watchpoints.
- `machine.cpu` exposes the registers (`a`, `b`, … `sp`, `pc`, flags) and
  `getState()` / `setState()`.

## Devices

| Device     | Default               | What it is                                             |
| ---------- | --------------------- | ------------------------------------------------------ |
| `Terminal` | ports 10h, 11h        | Serial console in the style of a 6850 ACIA             |
| `CpmBdos`  | ports FEh, FFh        | Enough CP/M to run console `.COM` programs (`loadCom`) |
| `Leds`     | OUT 20h               | Eight LEDs                                             |
| `Switches` | IN 21h                | Eight switches                                         |
| `Timer`    | OUT 30h               | Interrupts with RST 1 every n ms                       |
| `Display`  | F000h                 | 32×32 memory-mapped pixels, 16 colours                 |
| `Sound`    | OUT 40h–4Bh           | 3 voices: note, waveform, volume, pan (`onChange`)     |
| `Rom`      | (address you give it) | Read-only memory                                       |

Ports and addresses are constructor options. A `Timer` counts its
milliseconds in clock cycles at `clockHz` (2 MHz by default); a host that runs
the CPU at another rate can call `setClockHz` to keep the timer in real time.

### Writing a device

A device has a `name` and an `attach(machine)` method. In `attach` it can:

- `machine.mapPort(port, { in, out })` to claim I/O ports,
- `machine.mapMemory(start, length, { read, write })` for memory-mapped
  hardware (later mappings win; everything unmapped is plain RAM),
- `machine.schedule(cycles, fn)` for timed events, driven by the CPU clock
  rather than wall time, so runs are repeatable,
- `machine.interrupt(opcode)` to raise an interrupt, usually an RST
  (`0xCF` is RST 1),
- `machine.stop(message)` to pause execution.

```ts
import type { Device, Machine } from '@i8080/core';

/** A random number generator on port 50h. */
class Rng implements Device {
  readonly name = 'RNG';
  attach(m: Machine) {
    m.mapPort(0x50, { in: () => Math.floor(Math.random() * 256) });
  }
  detach(m: Machine) {
    m.unmapPort(0x50);
  }
}

machine.add(new Rng());
```

Optional `reset()` and `detach()` hooks are called on machine reset and on
removal. A reset cancels scheduled events, so a device that ticks starts again
from `reset()` or when the program asks. See `src/devices/` for examples.

## Assembler

`assemble(source)` is a two-pass assembler for Intel syntax. It returns the
output `segments`, an `entry` point, `errors` with line numbers, `symbols`, and
a map from addresses to source lines for debuggers.

- Labels (`loop:`), comments (`;`), `ORG`, `EQU`/`SET`/`=`, `DB`, `DW`, `DS`
  and `END`.
- Numbers: `42`, `2Ah`, `0x2A`, `$2A`, `101010b`, `52o`, `'A'`; `$` is the
  current address.
- Expressions with `+ - * / %`, `& | ^ ~`, `<< >>`, comparisons, `HIGH`, `LOW`
  and parentheses.

`disassembleOne(read, address)` and `disassemble(read, address, count)` work on
any memory you can read a byte from. `INSTRUCTION_DOCS` and `formatTiming` give
a one-line reference and the timing for every instruction.

## Tests

```sh
pnpm fetch-roms   # download the CPU exercisers into test/roms (checksummed)
pnpm test         # unit tests plus TST8080, 8080PRE and CPUTEST
pnpm test:exm     # the full 8080EXM run: 23.8 billion cycles, about a minute
```

The exercisers come from
[superzazu/8080](https://github.com/superzazu/8080/tree/master/cpu_tests). They
are copyrighted by their authors (Microcosm Associates; SuperSoft Associates;
Ian Bartholomew and Frank Cringle), so they're downloaded, not committed.

## License

MIT
