/**
 * Lê tipo e tamanho de uma imagem pelos bytes (PNG, JPEG, WebP), sem confiar na extensão
 * nem no Content-Type de quem enviou.
 */
export interface ImageInfo {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  ext: 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
}

export class ImageError extends Error {
  override name = 'ImageError';
}

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 8192;
export const MIN_IMAGE_SIDE = 320;

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function png(b: Uint8Array): ImageInfo | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v) || ascii(b, 12, 4) !== 'IHDR') return null;
  return { mime: 'image/png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(b, i + 2);
    // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { mime: 'image/jpeg', ext: 'jpg', height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webp(b: Uint8Array): ImageInfo | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X') {
    return { mime: 'image/webp', ext: 'webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  if (chunk === 'VP8 ') {
    return {
      mime: 'image/webp',
      ext: 'webp',
      width: u16le(b, 26) & 0x3fff,
      height: u16le(b, 28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return {
      mime: 'image/webp',
      ext: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

/** Identifica e valida (tamanho do arquivo e das bordas). Lança ImageError em português. */
export function sniffImage(bytes: Uint8Array): ImageInfo {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageError('imagem maior que 20 MB');
  }
  const info = png(bytes) ?? jpeg(bytes) ?? webp(bytes);
  if (!info) throw new ImageError('arquivo não é PNG, JPEG nem WebP');
  if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) {
    throw new ImageError(`imagem grande demais (${info.width}×${info.height}; máximo 8192)`);
  }
  if (info.width < MIN_IMAGE_SIDE || info.height < MIN_IMAGE_SIDE) {
    throw new ImageError(
      `imagem pequena demais (${info.width}×${info.height}; mínimo 320 px de cada lado)`,
    );
  }
  return info;
}
