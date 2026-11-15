import { describe, expect, it } from 'vitest';
import { assertKey, ImageError, MemoryObjectStore, sniffImage } from '../src';
import { fakeJpeg, fakePng, fakeWebp } from './fixtures';

describe('leitura de imagem pelos bytes', () => {
  it('PNG, JPEG e WebP com largura e altura', () => {
    expect(sniffImage(fakePng(1280, 720))).toEqual({
      mime: 'image/png',
      ext: 'png',
      width: 1280,
      height: 720,
    });
    expect(sniffImage(fakeJpeg(1920, 1080))).toMatchObject({
      ext: 'jpg',
      width: 1920,
      height: 1080,
    });
    expect(sniffImage(fakeWebp(1024, 1536))).toMatchObject({
      ext: 'webp',
      width: 1024,
      height: 1536,
    });
  });

  it('recusa o que não é imagem, pequena demais e grande demais', () => {
    expect(() => sniffImage(new TextEncoder().encode('<html>oi</html>'))).toThrow(ImageError);
    expect(() => sniffImage(fakePng(200, 200))).toThrow(/pequena demais/);
    expect(() => sniffImage(fakePng(9000, 1000))).toThrow(/grande demais/);
    expect(() => sniffImage(new Uint8Array(21 * 1024 * 1024))).toThrow(/20 MB/);
  });
});

describe('chaves do armazenamento', () => {
  it('só library/ e productions/, sem ".."', async () => {
    expect(() => assertKey('library/ab/abc.png')).not.toThrow();
    expect(() => assertKey('../etc/passwd')).toThrow();
    expect(() => assertKey('library/../x')).toThrow();
    expect(() => assertKey('outra/coisa.png')).toThrow();
    const store = new MemoryObjectStore();
    await store.put('library/aa/x.png', new Uint8Array([1, 2]), 'image/png');
    expect(await store.head('library/aa/x.png')).toEqual({ size: 2 });
    expect(await store.head('library/aa/y.png')).toBeNull();
  });
});
