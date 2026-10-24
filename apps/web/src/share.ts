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

async function transform(bytes: Uint8Array<ArrayBuffer>, direction: 'compress' | 'decompress') {
  const stream =
    direction === 'compress'
      ? new CompressionStream('deflate-raw')
      : new DecompressionStream('deflate-raw');
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
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
