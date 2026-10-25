// Links that carry a whole program: the source is compressed into the URL's
// fragment (#name=…&code=…), so sharing needs no server and the code never
// leaves the browser until someone sends the link.

export interface SharedProgram {
  name: string;
  source: string;
}

export async function shareLink(program: SharedProgram, base = location.href) {
  const code = toBase64Url(await transform(new TextEncoder().encode(program.source), 'compress'));
  const url = new URL(base);
  url.hash = new URLSearchParams({ name: program.name, code }).toString();
  return url.toString();
}

// The program in a link's fragment, or null if it has none or it's damaged.
export async function readShareLink(hash: string): Promise<SharedProgram | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('code');
  if (!code) return null;
  try {
    const source = new TextDecoder().decode(await transform(fromBase64Url(code), 'decompress'));
    return { name: params.get('name') || 'Shared program', source };
  } catch {
    return null;
  }
}

// The most a link may decompress to. Real programs are a few kilobytes; a
// crafted link could otherwise expand to gigabytes and take the tab down.
export const MAX_SHARED_BYTES = 1 << 20;

async function transform(bytes: Uint8Array<ArrayBuffer>, direction: 'compress' | 'decompress') {
  const stream =
    direction === 'compress'
      ? new CompressionStream('deflate-raw')
      : new DecompressionStream('deflate-raw');
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_SHARED_BYTES) {
      await reader.cancel();
      throw new RangeError('shared program is too big');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}
