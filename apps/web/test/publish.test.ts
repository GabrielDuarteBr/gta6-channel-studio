import { describe, expect, it } from 'vitest';
import { manualPackageText, parseYouTubeVideoId } from '@/server/publish';

describe('pacote manual', () => {
  it('lê o id do vídeo dos formatos de link do YouTube', () => {
    expect(parseYouTubeVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=abcdefghijk&t=3')).toBe(
      'abcdefghijk',
    );
    expect(parseYouTubeVideoId('https://youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    expect(parseYouTubeVideoId('https://studio.youtube.com/video/abcdefghijk/edit')).toBe(
      'abcdefghijk',
    );
    expect(parseYouTubeVideoId('abcdefghijk')).toBe('abcdefghijk');
    expect(parseYouTubeVideoId('https://exemplo.com/watch?v=abcdefghijk')).toBeNull();
    expect(parseYouTubeVideoId('não é link')).toBeNull();
  });

  it('texto do pacote lembra privado, programado e conteúdo sintético', () => {
    const txt = manualPackageText({
      title: 'Trailer 3',
      description: 'Descrição\nFontes:\n• IGN: https://ign.com',
      tags: ['GTA 6', 'Radar Neon'],
      publishAt: new Date('2026-11-20T21:00:00Z'),
    });
    expect(txt).toContain('Trailer 3');
    expect(txt).toContain('GTA 6, Radar Neon');
    expect(txt).toContain('Privado → Programar');
    expect(txt).toContain('18:00');
    expect(txt).toMatch(/sintético": marque SIM/);
  });
});
