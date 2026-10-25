import bwipjs from 'bwip-js';

// bwip-js passes encoder options (like `eclevel`) through, but its typings only list the common ones.
const opts = (o: Record<string, unknown>) => o as unknown as bwipjs.RenderOptions;

/** What a label's QR encodes. Labels outlive domain changes because `parseScan` accepts any host. */
export function qrPayload(publicBaseUrl: string, code: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/b/${code}`;
}

/** QR code PNG, error correction M, quiet zone of 2 modules. */
export function qrPng(text: string, scale = 6): Promise<Buffer> {
  return bwipjs.toBuffer(opts({ bcid: 'qrcode', text, eclevel: 'M', scale, padding: 2 * scale, backgroundcolor: 'FFFFFF' }));
}

export function qrSvg(text: string): string {
  return bwipjs.toSVG(opts({ bcid: 'qrcode', text, eclevel: 'M', scale: 4, padding: 8 }));
}

export function code128Png(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: 'code128', text, scale: 3, height: 8, includetext: false, backgroundcolor: 'FFFFFF' });
}
