import { describe, expect, it } from 'vitest';
import {
  assemble,
  Display,
  Leds,
  Machine,
  Rom,
  Sound,
  Switches,
  Terminal,
  Timer,
  type Device,
} from '../src/index';

function machineWith(src: string) {
  const m = new Machine();
  const r = assemble(src);
  expect(r.errors).toEqual([]);
  for (const s of r.segments) m.load(s.address, s.bytes);
  m.cpu.pc = r.entry;
  return { m, r };
}

describe('CPU', () => {
  it('executes every opcode without throwing', () => {
    const m = new Machine();
    for (let op = 0; op < 256; op++) {
      m.cpu.pc = 0;
      m.cpu.sp = 0x8000;
      m.cpu.halted = false;
      m.ram[0] = op;
      expect(() => m.cpu.step()).not.toThrow();
    }
  });

  it('computes flags for ADD/SUB/DAA', () => {
    const { m } = machineWith(' MVI A, 99h\n ADI 1\n DAA\n HLT');
    m.run({ cycles: 1000 });
    expect(m.cpu.a).toBe(0x00);
    expect(m.cpu.cf).toBe(true);
    expect(m.cpu.zf).toBe(true);
  });

  it('pushes PSW with the fixed bits set correctly', () => {
    const { m } = machineWith(' LXI SP, 100h\n MVI A, 0\n ORA A\n PUSH PSW\n HLT');
    m.run({ cycles: 1000 });
    expect(m.peek(0xfe)).toBe(0x46); // Z, P and the always-one bit
  });

  it('counts conditional call/return timing', () => {
    const { m } = machineWith(' LXI SP, 100h\n XRA A\n CNZ 0\n CZ subr\n HLT\nsubr: RNZ\n RZ');
    m.run({ cycles: 1000 });
    // LXI 10 + XRA 4 + CNZ(not) 11 + CZ(taken) 17 + RNZ(not) 5 + RZ(taken) 11 + HLT 7
    expect(m.cycles).toBe(65);
  });
});

describe('Machine', () => {
  it('stops at breakpoints and resumes past them', () => {
    const { m, r } = machineWith(' NOP\nhere: NOP\n NOP\n HLT');
    m.breakpoints.add(r.symbols.get('here')!);
    expect(m.run({ cycles: 1000 })).toEqual({ kind: 'breakpoint', pc: 1 });
    expect(m.run({ cycles: 1000, skipBreakpointAtStart: true }).kind).toBe('halt');
  });

  it('stops at memory and port watchpoints', () => {
    const { m } = machineWith(' MVI A, 5\n STA 2000h\n OUT 7\n HLT');
    m.addWatchpoint({ start: 0x2000, end: 0x2000, read: false, write: true });
    expect(m.run({ cycles: 1000 })).toMatchObject({
      kind: 'watchpoint',
      access: 'write',
      address: 0x2000,
      value: 5,
      pc: 2,
    });
    m.addPortWatch({ port: 7, in: false, out: true });
    expect(m.run({ cycles: 1000 })).toMatchObject({
      kind: 'watchpoint',
      access: 'out',
      address: 7,
    });
  });

  it('steps over and out of calls', () => {
    const { m } = machineWith(' LXI SP, 100h\n CALL subr\n HLT\nsubr: NOP\n NOP\n RET');
    m.step();
    expect(m.stepOver()).toBeNull();
    expect(m.cpu.pc).toBe(6);
    m.reset();
    m.cpu.sp = 0x100;
    m.step(); // LXI
    m.step(); // CALL -> in sub
    expect(m.cpu.pc).toBe(7);
    expect(m.stepOut()).toBeNull();
    expect(m.cpu.pc).toBe(6);
  });

  it('steps out when the stack wraps past FFFFh', () => {
    // LXI SP,0 puts the stack at the top of memory: SP is FFFEh in the call.
    const { m } = machineWith(' LXI SP, 0\n CALL subr\n HLT\nsubr: NOP\n RET');
    m.step();
    m.step();
    expect(m.cpu.sp).toBe(0xfffe);
    expect(m.stepOut()).toBeNull();
    expect(m.cpu.pc).toBe(6);
    expect(m.cpu.sp).toBe(0);
  });

  it('steps over and out in slices', () => {
    const source = ' LXI SP, 100h\n CALL subr\n HLT\nsubr: MVI B, 50\nloop: DCR B\n JNZ loop\n RET';
    const { m } = machineWith(source);
    m.step();
    const over = m.stepOverCondition()!;
    let stop;
    do stop = m.run({ cycles: 30, skipBreakpointAtStart: true, until: over });
    while (stop.kind === 'budget');
    expect(stop.kind).toBe('condition');
    expect(m.cpu.pc).toBe(6);

    m.reset();
    m.cpu.sp = 0x100;
    m.step(); // LXI
    m.step(); // CALL -> in sub
    const out = m.stepOutCondition();
    do stop = m.run({ cycles: 30, skipBreakpointAtStart: true, until: out });
    while (stop.kind === 'budget');
    expect(stop.kind).toBe('condition');
    expect(m.cpu.pc).toBe(6);
    expect(m.stepOverCondition()).toBeNull(); // HLT isn't a call
  });

  it('records an execution trace', () => {
    const { m } = machineWith(' NOP\n NOP\n HLT');
    m.run({ cycles: 100 });
    expect(m.trace()).toEqual([0, 1, 2]);
  });

  it('services interrupts and wakes from HLT', () => {
    const { m } = machineWith(`
        ORG 0
        JMP main
        ORG 8
        INR B           ; RST 1 handler
        EI
        RET
main:   LXI SP, 1000h
        EI
wait:   HLT
        JMP wait`);
    // Halted with interrupts on, it waits: something may still interrupt.
    expect(m.run({ cycles: 200 }).kind).toBe('budget');
    expect(m.cpu.halted).toBe(true);
    expect(m.cycles).toBeGreaterThanOrEqual(200);
    m.interrupt(0xcf);
    m.run({ cycles: 200 });
    expect(m.cpu.b).toBe(1);
    expect(m.cpu.halted).toBe(true);
    // With interrupts off, nothing can wake it.
    m.cpu.inte = false;
    expect(m.run({ cycles: 200 })).toEqual({ kind: 'halt', pc: m.cpu.pc });
  });

  it('maps memory regions and lets later mappings win', () => {
    const m = new Machine();
    m.ram[0x1000] = 99;
    const rom = m.add(new Rom(0x1000, [1, 2, 3]));
    m.write(0x1000, 42); // ignored by ROM
    expect(m.read(0x1000)).toBe(1);
    expect(m.read(0x1003)).toBe(0); // falls through to RAM
    m.remove(rom);
    expect(m.read(0x1000)).toBe(99);
  });

  it('runs scheduled events at the right time', () => {
    const { m } = machineWith(' JMP 0');
    const seen: number[] = [];
    m.schedule(100, () => seen.push(m.cycles));
    m.run({ cycles: 1000 });
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeGreaterThanOrEqual(100);
    expect(seen[0]).toBeLessThan(110);
  });

  it('refuses a port already in use, and unmaps only what a handler claimed', () => {
    const m = new Machine();
    const input = { in: () => 1 };
    const output = { out: () => {} };
    m.mapPort(0x50, input);
    m.mapPort(0x50, output); // the other direction is free
    expect(() => m.mapPort(0x50, { in: () => 2 })).toThrow(/port 50h is already in use/);
    m.unmapPort(0x50, output);
    expect(m.input(0x50)).toBe(1);
    m.unmapPort(0x50);
    expect(m.input(0x50)).toBe(0xff);
  });

  it('only accepts one-byte interrupt instructions', () => {
    const m = new Machine();
    expect(() => m.interrupt(0xcd)).toThrow(RangeError); // CALL needs an address
    expect(() => m.interrupt(0xcf)).not.toThrow();
  });

  it('accepts custom devices', () => {
    class Doubler implements Device {
      name = 'Doubler';
      last = 0;
      attach(m: Machine) {
        m.mapPort(0x40, { out: (_, v) => (this.last = v), in: () => this.last * 2 });
      }
    }
    const { m } = machineWith(' MVI A, 21\n OUT 40h\n IN 40h\n HLT');
    m.add(new Doubler());
    m.run({ cycles: 1000 });
    expect(m.cpu.a).toBe(42);
  });
});

describe('devices', () => {
  it('terminal echoes through the ACIA ports', () => {
    const { m } = machineWith(`
loop:   IN 10h
        ANI 1
        JZ loop
        IN 11h
        OUT 11h
        JMP loop`);
    const tty = m.add(new Terminal());
    let out = '';
    tty.onOutput.on((b) => (out += String.fromCharCode(b)));
    tty.send('hey');
    m.run({ cycles: 2000 });
    expect(out).toBe('hey');
  });

  it('leds, switches and display', () => {
    const { m } = machineWith(' IN 21h\n OUT 20h\n STA 0F005h\n HLT');
    const leds = m.add(new Leds());
    const sw = m.add(new Switches());
    const disp = m.add(new Display());
    sw.set(0x5a);
    m.run({ cycles: 1000 });
    expect(leds.value).toBe(0x5a);
    expect(disp.vram[5]).toBe(0x5a);
  });

  it('terminal interrupts until every waiting key is read', () => {
    const { m } = machineWith(`
        ORG 0
        JMP main
        ORG 38h         ; RST 7: read one key per interrupt
        IN 11h
        MOV M, A
        INX H
        EI
        RET
main:   LXI SP, 1000h
        LXI H, 2000h
        MVI A, 80h      ; interrupt when a key arrives
        OUT 10h
        EI
wait:   HLT
        JMP wait`);
    const tty = m.add(new Terminal());
    m.run({ cycles: 200 });
    tty.send('abc'); // three keys before the handler can run
    m.run({ cycles: 1000 });
    expect([0, 1, 2, 3].map((i) => m.peek(0x2000 + i))).toEqual([0x61, 0x62, 0x63, 0]);
    expect(m.cpu.hl).toBe(0x2003); // one interrupt per key, no more
    expect(m.cpu.halted).toBe(true);
  });

  it('services the highest RST first and loses no interrupt', () => {
    const { m } = machineWith(`
        ORG 0
        JMP main
        ORG 08h         ; RST 1, the timer: log a 1
        MVI M, 1
        INX H
        EI
        RET
        ORG 38h         ; RST 7, the terminal: read the key, log a 7
        IN 11h
        MVI M, 7
        INX H
        EI
        RET
main:   LXI SP, 1000h
        LXI H, 2000h
        MVI A, 80h
        OUT 10h
        MVI A, 2        ; a tick every 2 ms
        OUT 30h
spin:   LDA 3000h       ; interrupts off until the test says go
        ORA A
        JZ spin
        EI
idle:   HLT
        JMP idle`);
    const tty = m.add(new Terminal());
    m.add(new Timer());
    m.run({ cycles: 2000 * 3 }); // a tick is waiting...
    tty.send('x'); // ...and now a key
    m.run({ cycles: 100 });
    expect(m.peek(0x2000)).toBe(0); // nothing serviced yet
    m.poke(0x3000, 1);
    m.run({ cycles: 300 });
    expect([m.peek(0x2000), m.peek(0x2001)]).toEqual([7, 1]);
  });

  it('removing a device releases its interrupt line', () => {
    const { m } = machineWith(' EI\nloop: JMP loop');
    const tty = m.add(new Terminal());
    m.output(0x10, 0x80); // receive interrupts on
    tty.send('x');
    expect(m.cpu.interruptPending).toBe(true);
    m.remove(tty);
    expect(m.cpu.interruptPending).toBe(false);
    m.add(tty); // and it can be plugged in again
    m.output(0x10, 0x80);
    tty.send('y');
    expect(m.cpu.interruptPending).toBe(true);
  });

  it('timer refuses a clock rate of 0', () => {
    expect(() => new Timer({ clockHz: 0 })).toThrow(RangeError);
    expect(() => new Timer().setClockHz(0)).toThrow(RangeError);
  });

  it('timer raises periodic interrupts', () => {
    const { m } = machineWith(`
        ORG 0
        JMP main
        ORG 8
        INR B
        EI
        RET
main:   LXI SP, 1000h
        MVI A, 1        ; 1 ms period
        OUT 30h
        EI
wait:   HLT
        JMP wait`);
    m.add(new Timer());
    m.run({ cycles: 2_000_000 * 0.0105 }); // 10.5 ms at 2 MHz
    expect(m.cpu.b).toBe(10);
  });

  it("timer ticks don't drift when instructions run past them", () => {
    // XTHL takes 18 T-states, longer than the 10 T-state period, so every tick
    // fires late. Each period still counts from when the last tick was due.
    const { m } = machineWith(`
        LXI SP, 1000h
        MVI A, 1
        OUT 30h
loop:   XTHL
        JMP loop`);
    const timer = m.add(new Timer({ clockHz: 10_000 })); // 1 ms = 10 T-states
    m.run({ cycles: 17 + 1000 });
    expect(timer.ticks).toBeGreaterThanOrEqual(99);
  });

  it('timer keeps time when its period is under a clock cycle', () => {
    const { m } = machineWith(`
        MVI A, 10       ; 10 ms: 0.3 T-states at 30 Hz
        OUT 30h
loop:   JMP loop`);
    const timer = m.add(new Timer({ clockHz: 30 }));
    m.run({ cycles: 17 + 300 }); // 10 seconds
    expect(timer.ticks).toBeGreaterThanOrEqual(995);
    expect(timer.ticks).toBeLessThanOrEqual(1000);
  });

  it('timer keeps its period in ms when the clock rate changes', () => {
    const { m } = machineWith(`
        ORG 0
        JMP main
        ORG 8
        INR B
        EI
        RET
main:   LXI SP, 1000h
        MVI A, 1        ; 1 ms period: 2000 T-states at 2 MHz
        OUT 30h
        EI
wait:   HLT
        JMP wait`);
    const timer = m.add(new Timer());
    m.run({ cycles: 1000 + 34 }); // halfway to the first tick
    expect(m.cpu.b).toBe(0);
    timer.setClockHz(4_000_000); // the rest of the period now takes 2000 T-states...
    m.run({ cycles: 1900 });
    expect(m.cpu.b).toBe(0);
    m.run({ cycles: 200 });
    expect(m.cpu.b).toBe(1);
    m.run({ cycles: 4000 * 3 }); // ...and each period after it 4000
    expect(m.cpu.b).toBe(4);
  });

  it('sound reports each change with its voice and the cycle it happened at', () => {
    const { m } = machineWith(`
        MVI A, 3        ; voice 0: noise
        OUT 41h
        MVI A, 8
        OUT 42h
        MVI A, 69       ; A 440
        OUT 40h
        IN 40h
        MOV B, A
        MVI A, 0C0h     ; voice 2: panned left
        OUT 4Bh
        MVI A, 57
        OUT 48h
        HLT`);
    const sound = m.add(new Sound());
    const changes: unknown[] = [];
    sound.onChange.on((change) => changes.push(change));
    m.run({ cycles: 1000 });
    const quiet = { note: 0, waveform: 'square', volume: 15, pan: 0 };
    // Stamped with the cycle each OUT starts at.
    expect(changes).toEqual([
      { ...quiet, waveform: 'noise', voice: 0, cycles: 7 },
      { ...quiet, waveform: 'noise', volume: 8, voice: 0, cycles: 24 },
      { ...quiet, waveform: 'noise', volume: 8, note: 69, voice: 0, cycles: 41 },
      { ...quiet, pan: -64, voice: 2, cycles: 73 },
      { ...quiet, pan: -64, note: 57, voice: 2, cycles: 90 },
    ]);
    expect(m.cpu.b).toBe(69);
    expect(sound.voices[1]).toEqual(quiet);
    expect(Sound.frequency(69)).toBe(440);
    expect(Sound.frequency(81)).toBeCloseTo(880);
    m.reset();
    expect(sound.voices).toEqual([quiet, quiet, quiet]);
  });
});
