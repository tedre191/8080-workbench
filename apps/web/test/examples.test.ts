// The example programs must assemble and behave as their comments say.
import { assemble, Display, Leds, Machine, Switches, Terminal, Timer } from '@i8080/core';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';

const source = (id: string) => EXAMPLES.find((e) => e.id === id)!.source;

function boot(name: string) {
  const m = new Machine();
  const tty = m.add(new Terminal());
  const leds = m.add(new Leds());
  m.add(new Switches());
  m.add(new Timer());
  const display = m.add(new Display());
  const r = assemble(source(name));
  expect(r.errors).toEqual([]);
  for (const s of r.segments) m.load(s.address, s.bytes);
  m.cpu.pc = r.entry;
  let out = '';
  tty.onOutput.on((b) => (out += String.fromCharCode(b)));
  return { m, tty, leds, display, out: () => out };
}

describe('examples', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name} assembles`, () => expect(assemble(ex.source).errors).toEqual([]));
  }

  it('primes prints the primes below 250', () => {
    const { m, out } = boot('primes');
    expect(m.run({ cycles: 50_000_000 }).kind).toBe('halt');
    const nums = out().split('\n')[1].trim().split(' ').map(Number);
    expect(nums.slice(0, 6)).toEqual([2, 3, 5, 7, 11, 13]);
    expect(nums.at(-1)).toBe(241);
    expect(nums.length).toBe(53);
  });

  it('hello greets and echoes', () => {
    const { m, tty, out } = boot('hello');
    m.run({ cycles: 10_000 });
    tty.send('ok\r');
    m.run({ cycles: 10_000 });
    expect(out()).toMatch(/^Hello, 8080!\n.*ok\n$/s);
  });

  it('interrupts counts timer ticks on the LEDs', () => {
    const { m, leds } = boot('interrupts');
    m.run({ cycles: 2_000_000 * 0.55 }); // 550 ms
    expect(leds.value).toBe(5);
  });

  describe('snake', () => {
    const MS = 2000; // T-states per millisecond at 2 MHz
    const px = (x: number, y: number) => y * 32 + x;

    function start() {
      const g = boot('snake');
      g.m.run({ cycles: 100 * MS });
      expect(g.out()).toContain('Press any key to start.');
      g.tty.send(' ');
      g.m.run({ cycles: 30 * MS }); // clearing the screen takes ~18 ms
      expect(g.out()).toContain('Go!');
      return g;
    }

    it('moves one pixel per tick and eats food', () => {
      const { m, display, leds, out } = start();
      const v = display.vram;
      expect([v[px(8, 16)], v[px(9, 16)], v[px(10, 16)]]).toEqual([10, 10, 14]);
      // Put food two pixels ahead (clear any random food first).
      for (let i = 0; i < v.length; i++) if (v[i] === 12) m.poke(0xf000 + i, 0);
      m.poke(0xf000 + px(12, 16), 12);
      m.run({ cycles: 2 * 180 * MS + 20 * MS });
      expect(v[px(12, 16)]).toBe(14); // head is on the food
      // Step 1 moved the tail from x=8 to 9; step 2 ate, so the tail stayed.
      expect([v[px(8, 16)], v[px(9, 16)]]).toEqual([0, 10]);
      expect(leds.value).toBe(1);
      expect(out()).toContain('Yum! Score 1');
      expect(v.filter((c) => c === 12).length).toBe(1); // new food placed
    });

    it('steers, refuses to reverse, and crashes into walls', () => {
      const { m, tty, display, out } = start();
      tty.send('a'); // reversing: ignored
      m.run({ cycles: 180 * MS + 10 * MS });
      expect(display.vram[px(11, 16)]).toBe(14);
      tty.send('w');
      m.run({ cycles: 180 * MS });
      expect(display.vram[px(11, 15)]).toBe(14);
      // Keep going up into the top wall (15 more steps).
      m.run({ cycles: 17 * 180 * MS });
      expect(out()).toMatch(/Crash! Final score \d+/);
      tty.send(' ');
      m.run({ cycles: 40 * MS });
      expect(out().match(/Go!/g)?.length).toBe(2);
    });
  });
});
