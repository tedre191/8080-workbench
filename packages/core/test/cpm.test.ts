// Runs the classic 8080 CPU exercisers under the CP/M BDOS shim.
// Fetch them first with `pnpm fetch-roms`.
//
// 8080EXM takes ~23 billion cycles, so it only runs with I8080_EXM=1
// (`pnpm test:exm`).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CpmBdos, Machine, Terminal } from '../src/index';

const ROMS = join(import.meta.dirname, 'roms');

function runCom(file: string, maxCycles = 50_000_000_000) {
  const m = new Machine();
  m.traceEnabled = false;
  const tty = m.add(new Terminal());
  const cpm = m.add(new CpmBdos(tty));
  let out = '';
  tty.onOutput.on((b) => (out += String.fromCharCode(b)));
  cpm.loadCom(readFileSync(join(ROMS, file)));

  const start = performance.now();
  const r = m.run({ cycles: maxCycles });
  const ms = performance.now() - start;
  const mhz = m.cycles / ms / 1000;
  console.log(
    `${file}: ${m.cycles.toLocaleString()} cycles in ${ms.toFixed(0)} ms (${mhz.toFixed(0)} MHz)\n${out}`,
  );
  // Reference cycle counts come from harnesses that trap BDOS calls at 0x0005
  // directly; our stub goes through a JMP there (10 T-states per call).
  return { out, stop: r, cycles: m.cycles - cpm.calls * 10 };
}

const has = (f: string) => existsSync(join(ROMS, f));

it('refuses a .COM program that would run into the stack', () => {
  const m = new Machine();
  const cpm = m.add(new CpmBdos(m.add(new Terminal())));
  expect(() => cpm.loadCom(new Uint8Array(cpm.maxComSize + 1))).toThrow(RangeError);
  expect(() => cpm.loadCom(new Uint8Array(cpm.maxComSize))).not.toThrow();
});

describe('CP/M CPU exercisers', () => {
  it.skipIf(!has('TST8080.COM'))('TST8080 (Microcosm diagnostic)', () => {
    const { out, stop } = runCom('TST8080.COM');
    expect(stop.kind).toBe('stop');
    expect(out).toContain('CPU IS OPERATIONAL');
  });

  it.skipIf(!has('8080PRE.COM'))('8080PRE (preliminary exerciser)', () => {
    const { out, stop } = runCom('8080PRE.COM');
    expect(stop.kind).toBe('stop');
    expect(out).toContain('8080 Preliminary tests complete');
  });

  it.skipIf(!has('CPUTEST.COM'))('CPUTEST (SuperSoft diagnostics II)', () => {
    const { out, stop, cycles } = runCom('CPUTEST.COM');
    expect(stop.kind).toBe('stop');
    expect(out).toContain('CPU TESTS OK');
    expect(cycles).toBe(255_653_383);
  });

  it.skipIf(!has('8080EXM.COM') || !process.env.I8080_EXM)(
    '8080EXM (full instruction exerciser)',
    () => {
      const { out, stop, cycles } = runCom('8080EXM.COM');
      expect(stop.kind).toBe('stop');
      expect(out).not.toContain('ERROR');
      expect(out.match(/PASS!/g)?.length).toBe(25);
      expect(cycles).toBe(23_803_381_171);
    },
    30 * 60_000,
  );
});
