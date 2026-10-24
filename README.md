# 8080 Workbench

[![CI](https://github.com/tedre191/8080-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/tedre191/8080-workbench/actions/workflows/ci.yml)

An Intel 8080 emulator in TypeScript, built for tinkering and debugging. Write
assembly in the browser and watch it run on an emulated machine with a
terminal, LEDs, switches, a timer, a small colour display and a sound chip.

**Try it: [tedre191.github.io/8080-workbench](https://tedre191.github.io/8080-workbench/)**

- **[`packages/core`](packages/core)**: the emulator as a library with no
  dependencies: a cycle-accurate CPU, a machine with pluggable devices, an
  assembler and a disassembler. It passes all four classic CPU exercisers.
- **[`apps/web`](apps/web)**: the workbench, a React app with an editor,
  disassembly, registers, memory, breakpoints, a trace and a reference.

## Getting started

You need Node 24 (see `.nvmrc`) and pnpm, which Corepack provides:

```sh
corepack enable
pnpm install
pnpm dev             # the workbench, at http://localhost:5173
```

## Using the workbench

**Programs.** The menu above the editor lists your programs, the examples and
the classic CPU test programs. **New** starts a program and **Open file…**
opens an `.asm` source, a CP/M `.COM` program or a raw binary (loaded at
0000h). Your programs are saved in the browser; rename one by editing its name,
use **Download** to save it as an `.asm` file, and **Share** to copy a link that
opens it for anyone (the source is in the link itself). Examples are templates:
editing one saves your changes as a new program.

**Editing.** There's no assemble step. The source is checked as you type, and
once you pause the new code is loaded into the machine; if it was running, it
restarts. Edits that don't change the machine code, like comments, leave the
running program alone. The editor indents for you and suggests instructions,
the registers each one accepts, and the labels and constants in your program.

**Speed.** 2 MHz is the Altair's real speed, and Max runs as fast as your
computer can. 30 Hz and 500 Hz slow the CPU down and highlight what each
instruction changes. The timer and sound keep real time at every speed, so
games play at the right pace, but at the slow speeds a timer can be due again
before its interrupt handler has finished: a program that uses it may never get
past the handler.

**Reference.** The Reference tab (F1) is a searchable cheat sheet: every
instruction with its flags and timing, what each jump condition means after a
compare, the assembler syntax, this machine's ports and colours, and snippets
you can insert at the cursor.

**Debugging.** Click a line number in the source, or the dot in the
disassembly, to set a breakpoint; breakpoints stay with their code as you
edit. Click any register, flag or memory byte to change it. When paused, values
changed by the last step are shown in green. **Restart** reloads the program
and resets the machine, memory included. While a program runs, typing anywhere
outside the editor goes to its terminal.

| Key             | Action                   |
| --------------- | ------------------------ |
| F1              | Open the reference       |
| F5              | Run / pause              |
| F11             | Step one instruction     |
| F10             | Step over CALL/RST       |
| Shift+F11       | Step out of a subroutine |
| Esc             | Stop a step over or out  |
| Ctrl+Space      | Show suggestions         |
| Tab / Shift+Tab | Indent / outdent         |

### The machine

| Device   | Where          | Notes                                                        |
| -------- | -------------- | ------------------------------------------------------------ |
| Terminal | ports 10h, 11h | Status (bit 0 = key waiting, bit 1 = ready to send) and data |
| LEDs     | OUT 20h        | One LED per bit                                              |
| Switches | IN 21h         | One switch per bit                                           |
| Timer    | OUT 30h, n     | RST 1 every n ms (0 stops)                                   |
| Display  | F000h–F3FFh    | 32×32 pixels, one byte each, 16 colours                      |
| Sound    | OUT 40h–42h    | Note (MIDI number, 0 = off), waveform (0–3), volume (0–15)   |
| CP/M     | ports FEh, FFh | Console support for `.COM` programs                          |

## Using the library

See [packages/core/README.md](packages/core/README.md) for the API and how to
write your own devices.

## Project layout

```
packages/core/          the emulator library
  src/
    cpu.ts              the CPU: all 256 opcodes, interrupts, cycle timing
    machine.ts          bus, memory and port maps, scheduler, debugger hooks
    opcodes.ts          opcode table shared by the assembler and disassembler
    docs.ts             a one-line reference for every instruction
    disassembler.ts
    assembler/          two-pass Intel-syntax assembler
    devices/            terminal, CP/M, LEDs, switches, timer, display, sound, ROM
  test/                 unit tests and the CPU exercisers
  scripts/fetch-roms.mjs
apps/web/               the workbench
  src/
    session.ts          runs the machine and connects it to React
    speaker.ts          plays the sound device through WebAudio
    programs.ts         your saved programs
    completion.ts       autocomplete
    editing.ts          auto-indent and tabs
    reference.ts        content of the Reference tab
    components/         the panels
    examples/           the example programs
  test/
```

## Development

```sh
pnpm fetch-roms      # download the CPU exercisers for the tests (once)
pnpm test            # all tests (a few seconds)
pnpm test:exm        # the full 8080EXM exerciser (about a minute)
pnpm typecheck
pnpm lint            # oxlint
pnpm format          # Prettier; CI runs pnpm format:check
pnpm build           # the workbench, into apps/web/dist
```

Keep the library free of dependencies and of UI code. New hardware goes in
`packages/core/src/devices/` with a test, then gets a view in the workbench.
Run `pnpm test:exm` after changing `cpu.ts`.

## Contributing

Issues and pull requests are welcome. Please keep changes small and focused,
add a test for new behaviour, and make sure `pnpm typecheck`, `pnpm lint`,
`pnpm test` and `pnpm format:check` pass. Dependabot proposes dependency
updates weekly.

## License

[MIT](LICENSE). The CPU test programs aren't part of this repository; they're
downloaded from [superzazu/8080](https://github.com/superzazu/8080) and keep
their authors' licenses.
