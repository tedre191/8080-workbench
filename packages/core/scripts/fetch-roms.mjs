// Downloads the classic Intel 8080 CPU exerciser programs (CP/M .COM files)
// into test/roms and verifies their checksums. They're copyrighted by their
// authors, so they're fetched rather than committed.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/superzazu/8080/master/cpu_tests/';
const ROMS = {
  'TST8080.COM': '9561c6fb6c99efe3de00eb77e4044fd102151058b39ac2d7bce10483838a08e7',
  '8080PRE.COM': '18eb3c79cba42c0718f160be6a1853cb64cdce7aa47d65780189a57bdd98c4e0',
  'CPUTEST.COM': 'e61a9a75348c774486c2207080ea4effbf6c2367fdace31b0731081a4144030b',
  '8080EXM.COM': '6e3286e11bb1a8f47b8ee1280b4a067be813193363e3223c99b0d21912f44aeb',
};

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'roms');
await mkdir(dir, { recursive: true });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

for (const [name, hash] of Object.entries(ROMS)) {
  const path = join(dir, name);
  try {
    if (sha256(await readFile(path)) === hash) {
      console.log(`✓ ${name} (cached)`);
      continue;
    }
  } catch {}
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== hash) throw new Error(`${name}: checksum mismatch`);
  await writeFile(path, buf);
  console.log(`↓ ${name} (${buf.length} bytes)`);
}
