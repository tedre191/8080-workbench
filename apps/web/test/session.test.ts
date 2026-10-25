import { describe, expect, it } from 'vitest';
import { Session } from '../src/session';

describe('session', () => {
  it("won't open a binary bigger than memory or a CP/M program can be", () => {
    const session = new Session();
    session.openBinary({ name: 'big.bin', bytes: new Uint8Array(0x10001), format: 'raw' });
    expect(session.binary).toBeNull();
    expect(session.status).toMatchObject({ tone: 'error' });

    const tooBig = session.cpm.maxComSize + 1;
    session.openBinary({ name: 'BIG.COM', bytes: new Uint8Array(tooBig), format: 'com' });
    expect(session.binary).toBeNull();

    session.openBinary({ name: 'full.bin', bytes: new Uint8Array(0x10000), format: 'raw' });
    expect(session.binary?.name).toBe('full.bin');
  });
});
