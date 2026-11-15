/** Cabeçalhos mínimos de imagem (o leitor só olha o começo do arquivo). */
export function fakePng(width: number, height: number, salt = 0): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b[40] = salt;
  return b;
}

export function fakeJpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 (len 16), SOF0 (len 17) com altura/largura
  const b = new Uint8Array(64);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  new DataView(b.buffer).setUint16(25, height);
  new DataView(b.buffer).setUint16(27, width);
  return b;
}

export function fakeWebp(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  const enc = new TextEncoder();
  b.set(enc.encode('RIFF'), 0);
  b.set(enc.encode('WEBP'), 8);
  b.set(enc.encode('VP8X'), 12);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  b.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return b;
}
