import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { readShareLink, shareLink } from '../src/share';

describe('share links', () => {
  it('round-trip a program through the URL', async () => {
    const program = { name: 'Snake & co', source: EXAMPLES[0].source + '\n; ünïcode ✓\n' };
    const link = await shareLink(program, 'https://example.com/8080/?x=1#old');
    expect(link.startsWith('https://example.com/8080/?x=1#name=')).toBe(true);
    expect(await readShareLink(new URL(link).hash)).toEqual(program);
  });

  it('ignore fragments without a program, or with a damaged one', async () => {
    expect(await readShareLink('')).toBeNull();
    expect(await readShareLink('#name=x')).toBeNull();
    expect(await readShareLink('#code=not-really-deflate')).toBeNull();
  });
});
