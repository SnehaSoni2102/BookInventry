import dns from 'node:dns/promises';
import net from 'node:net';

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return true;
}

export class UnsafeUrlError extends Error {}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  allowPrivate?: boolean;
}

/** Resolves the host and refuses anything that is not a public http(s) address. */
async function assertSafeUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError(`Unsupported protocol ${url.protocol}`);
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError('URL resolves to a non-public address');
  }
  return url;
}

/**
 * Downloads an image with SSRF protection: public addresses only (re-checked on every redirect),
 * at most `maxRedirects` redirects, a size cap and a timeout. The caller still has to decode the bytes.
 * (A DNS-rebinding race between the check and the connection remains theoretically possible; the cover
 * job only ever stores re-encoded image output, never returns the response to a user.)
 */
export async function safeFetchImage(rawUrl: string, opts: SafeFetchOptions): Promise<Buffer> {
  let current = rawUrl;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const url = await assertSafeUrl(current, opts.allowPrivate ?? false);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { Accept: 'image/*' },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirect without location');
      current = new URL(loc, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error(`Not an image (${type || 'no content-type'})`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > opts.maxBytes) throw new Error('Image too large');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > opts.maxBytes) throw new Error('Image too large');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Too many redirects');
}
