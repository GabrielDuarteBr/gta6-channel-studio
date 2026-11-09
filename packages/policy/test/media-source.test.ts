import { describe, expect, it } from 'vitest';
import { assertMediaImportAllowed, isBlockedMediaHost, PolicyViolation } from '../src';

describe('assertMediaImportAllowed', () => {
  it.each([
    'https://www.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://m.youtube.com/shorts/abc',
    'https://rr3---sn-abc.googlevideo.com/videoplayback?x=1',
    'https://i.ytimg.com/vi/abc/maxresdefault.jpg',
    'https://WWW.YOUTUBE.COM./watch?v=abc',
    'https://www.youtube-nocookie.com/embed/abc',
  ])('recusa %s', (url) => {
    expect(() => assertMediaImportAllowed(url)).toThrow(PolicyViolation);
  });

  it('recusa http, URLs inválidas e credenciais embutidas', () => {
    expect(() => assertMediaImportAllowed('http://drive.google.com/x')).toThrow(PolicyViolation);
    expect(() => assertMediaImportAllowed('não é url')).toThrow(PolicyViolation);
    expect(() => assertMediaImportAllowed('https://user:pass@example.com/a.mp4')).toThrow(
      PolicyViolation,
    );
  });

  it('não confunde domínios parecidos', () => {
    expect(isBlockedMediaHost('notyoutube.com')).toBe(false);
    expect(isBlockedMediaHost('youtube.com.evil.example')).toBe(false);
  });

  it('aceita pasta compartilhada de parceiro e material de imprensa', () => {
    expect(assertMediaImportAllowed('https://drive.google.com/drive/folders/abc').hostname).toBe(
      'drive.google.com',
    );
    expect(assertMediaImportAllowed('https://www.dropbox.com/s/abc/clip.mp4').hostname).toBe(
      'www.dropbox.com',
    );
  });

  it('a violação carrega o identificador da regra', () => {
    try {
      assertMediaImportAllowed('https://youtu.be/x');
    } catch (e) {
      expect((e as PolicyViolation).rule).toBe('NO_YOUTUBE_DOWNLOAD');
    }
  });
});
