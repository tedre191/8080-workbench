import cracktro from './cracktro.asm?raw';
import display from './display.asm?raw';
import hello from './hello.asm?raw';
import interrupts from './interrupts.asm?raw';
import leds from './leds.asm?raw';
import piano from './piano.asm?raw';
import primes from './primes.asm?raw';
import simon from './simon.asm?raw';
import snake from './snake.asm?raw';

export interface Example {
  id: string;
  name: string;
  source: string;
  // Open the Devices tab when this example is loaded.
  usesDevices?: boolean;
}

export const EXAMPLES: Example[] = [
  { id: 'hello', name: 'Hello & echo', source: hello },
  { id: 'primes', name: 'Primes', source: primes },
  { id: 'leds', name: 'LED counter', source: leds, usesDevices: true },
  { id: 'display', name: 'Display pattern', source: display, usesDevices: true },
  { id: 'interrupts', name: 'Timer interrupts', source: interrupts, usesDevices: true },
  { id: 'snake', name: 'Snake', source: snake, usesDevices: true },
  { id: 'simon', name: 'Simon', source: simon, usesDevices: true },
  { id: 'cracktro', name: 'Cracktro', source: cracktro, usesDevices: true },
  { id: 'piano', name: 'Keyboard piano', source: piano, usesDevices: true },
];

// Where the classic CPU test programs are downloaded from when opened.
const CPU_TESTS_URL = 'https://raw.githubusercontent.com/superzazu/8080/master/cpu_tests/';

// The classic 8080 CPU test programs (CP/M .COM files), fetched on demand.
export const CPU_TESTS: { name: string; url: string; note: string }[] = [
  { name: 'TST8080.COM', note: 'Microcosm Associates CPU diagnostic (1980). Finishes instantly.' },
  { name: '8080PRE.COM', note: 'Preliminary instruction exerciser. Finishes instantly.' },
  { name: 'CPUTEST.COM', note: 'SuperSoft Diagnostics II (1981). A few seconds at Max speed.' },
  {
    name: '8080EXM.COM',
    note: 'Full instruction exerciser: 23 billion cycles, about a minute at Max speed.',
  },
].map((test) => ({ ...test, url: CPU_TESTS_URL + test.name }));
