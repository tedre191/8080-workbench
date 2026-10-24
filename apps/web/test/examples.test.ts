// The example programs must assemble and behave as their comments say.
import { assemble, Display, Leds, Machine, Sound, Switches, Terminal, Timer } from '@i8080/core';
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
  const sound = m.add(new Sound());
  const r = assemble(source(name));
  expect(r.errors).toEqual([]);
  for (const s of r.segments) m.load(s.address, s.bytes);
  m.cpu.pc = r.entry;
  let out = '';
  tty.onOutput.on((b) => (out += String.fromCharCode(b)));
  return { m, tty, leds, display, sound, symbols: r.symbols, out: () => out };
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
      const { m, display, leds, sound, out } = start();
      const notes: number[] = [];
      sound.onChange.on((change) => notes.push(change.note));
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
      expect(sound.state.note).toBe(84); // the blip, until the next step
      m.run({ cycles: 180 * MS });
      expect(sound.state.note).toBe(0);
      expect(notes).toContain(84);
    });

    it('steers, refuses to reverse, and crashes into walls', () => {
      const { m, tty, display, sound, out } = start();
      tty.send('a'); // reversing: ignored
      m.run({ cycles: 180 * MS + 10 * MS });
      expect(display.vram[px(11, 16)]).toBe(14);
      tty.send('w');
      m.run({ cycles: 180 * MS });
      expect(display.vram[px(11, 15)]).toBe(14);
      // Keep going up into the top wall (15 more steps).
      m.run({ cycles: 17 * 180 * MS });
      expect(out()).toMatch(/Crash! Final score \d+/);
      expect(sound.state).toMatchObject({ waveform: 'noise' }); // fading out
      tty.send('w'); // pressed during the crash: ignored
      m.run({ cycles: 600 * MS });
      expect(sound.state).toEqual({ note: 0, waveform: 'square', volume: 15 });
      expect(out()).toContain('Press any key to play again.');
      expect(out().match(/Go!/g)?.length).toBe(1);
      tty.send(' ');
      m.run({ cycles: 40 * MS });
      expect(out().match(/Go!/g)?.length).toBe(2);
    });
  });

  describe('simon', () => {
    const MS = 2000; // T-states per millisecond at 2 MHz
    const px = (x: number, y: number) => y * 32 + x;
    const pads = [px(1, 1), px(17, 1), px(1, 17), px(17, 17)];

    it('plays a growing sequence and buzzes at a mistake', () => {
      const { m, tty, leds, display, sound, symbols, out } = boot('simon');
      const notes: number[] = []; // each note started
      let playing = 0;
      sound.onChange.on((change) => {
        if (change.note > 0 && playing === 0) notes.push(change.note);
        playing = change.note;
      });
      const seq = (i: number) => m.peek(symbols.get('seq')! + i);
      const v = display.vram;

      m.run({ cycles: 20 * MS });
      expect(out()).toContain('Press any key to start.');
      expect(pads.map((p) => v[p])).toEqual([2, 4, 6, 1]); // all dim
      expect(v[px(15, 1)]).toBe(0); // the gap between pads

      // The intro runs round the pads, then round 1 plays one pad.
      tty.send(' ');
      m.run({ cycles: 2000 * MS });
      expect(leds.value).toBe(1);
      expect(notes).toEqual([64, 69, 61, 52, [64, 69, 61, 52][seq(0)]]);

      // Answer right: round 2 replays both pads.
      tty.send('qwas'[seq(0)]);
      m.run({ cycles: 2000 * MS });
      expect(leds.value).toBe(2);

      // Answer wrong: the low sawtooth buzz, all pads lit, then the score.
      tty.send('1234'[(seq(0) + 1) & 3]);
      m.run({ cycles: 100 * MS });
      expect(sound.state).toMatchObject({ note: 31, waveform: 'sawtooth' });
      expect(pads.map((p) => v[p])).toEqual([10, 12, 14, 9]);
      m.run({ cycles: 2500 * MS });
      expect(out()).toContain('Wrong! Rounds completed: 1');
      expect(out()).toContain('Press any key to play again.');
      expect(sound.state).toEqual({ note: 0, waveform: 'square', volume: 15 });
      expect(pads.map((p) => v[p])).toEqual([2, 4, 6, 1]);
    });

    it("doesn't start again from a key pressed during the buzz", () => {
      const { m, tty, symbols, out } = boot('simon');
      m.run({ cycles: 20 * MS });
      tty.send(' ');
      m.run({ cycles: 2000 * MS });
      const wrong = (m.peek(symbols.get('seq')!) + 1) & 3;
      tty.send('qwas'[wrong]);
      m.run({ cycles: 100 * MS });
      tty.send('q'); // during the buzz
      m.run({ cycles: 3000 * MS });
      expect(out().match(/Go!/g)?.length).toBe(1);
      tty.send(' ');
      m.run({ cycles: 1000 * MS });
      expect(out().match(/Go!/g)?.length).toBe(2);
    });
  });

  describe('cracktro', () => {
    const MS = 2000; // T-states per millisecond at 2 MHz

    it('plays the tune and draws a moving plasma', () => {
      const { m, leds, display, sound, out } = boot('cracktro');
      // What plays each tick, sampled between ticks (the player sets the
      // waveform and the note a few cycles apart).
      const played: string[] = [];
      const listen = (ms: number) => {
        for (let t = 0; t < ms; t += 20) {
          m.run({ cycles: 20 * MS });
          const { note, waveform } = sound.state;
          if (note > 0 && played.at(-1) !== `${waveform} ${note}`) {
            played.push(`${waveform} ${note}`);
          }
        }
      };

      m.run({ cycles: 30 * MS }); // the first tick, at 20 ms: row 0, a kick
      expect(out()).toContain('W O R K B E N C H');
      expect(leds.value).toBe(0x7f); // the beat meter, full and falling
      const { note, waveform } = sound.state;
      played.push(`${waveform} ${note}`);
      listen(600);
      // Row 0: the kick falls an octave, then the bass. Row 1: an A minor
      // arpeggio, A C E. Row 4: the snare.
      expect(played.slice(0, 6)).toEqual([
        'square 45',
        'square 33',
        'sawtooth 45',
        'square 69',
        'square 72',
        'square 76',
      ]);
      expect(played).toContain('noise 100');

      const colours = new Set(display.vram);
      expect(colours.size).toBeGreaterThanOrEqual(6); // of the ramp's 8
      const before = display.vram.slice();
      m.run({ cycles: 500 * MS });
      expect(display.vram).not.toEqual(before);
    });
  });
});
