import type { VideoPlan } from '@studio/production';
import { describe, expect, it } from 'vitest';
import { reviewContent, verdictFrom, type ReviewInput } from '../src/production/review';

const plan = {
  format: 'LONG',
  title: 'Teste',
  durationSec: 20,
  outroSec: 4,
  storyIsRumor: false,
  scenes: [
    { id: 1, start: 0, end: 5, image: null, headline: null },
    { id: 2, start: 5, end: 12, image: 'assets/a.png', headline: 'A' },
    { id: 3, start: 12, end: 20, image: 'assets/b.png', headline: null },
  ],
  captions: [{ start: 6, end: 8, text: 'A Rockstar confirmou' }],
  sourceChips: [{ start: 6, end: 9, label: 'Rockstar Newswire' }],
  rumorSpans: [{ start: 13, end: 15 }],
} as unknown as VideoPlan;

const input: ReviewInput = {
  plan,
  frames: [
    { t: 2, jpegBase64: 'A' },
    { t: 7, jpegBase64: 'B' },
    { t: 14, jpegBase64: 'C' },
  ],
  thumbnails: [
    { jpegBase64: 'T1', headline: 'UM' },
    { jpegBase64: 'T2', headline: 'DOIS' },
    { jpegBase64: 'T3', headline: 'TRÊS' },
  ],
  model: 'claude-sonnet-5-5',
  productionId: 'p',
  round: 1,
};

describe('Revisor visual: veredito', () => {
  it('problema leve não reprova; thumbnail descartada não é escolhida', () => {
    const v = verdictFrom(
      {
        summary: 'ok',
        issues: [
          {
            target: 'quadro',
            index: 1,
            kind: 'outro',
            severity: 'leve',
            detail: 'x',
            fix: 'nenhuma',
          },
          {
            target: 'thumbnail',
            index: 2,
            kind: 'thumbnail_enganosa',
            severity: 'grave',
            detail: 'y',
            fix: 'descartar_thumbnail',
          },
        ],
        bestThumbnail: 2,
      },
      input,
    );
    expect(v).toMatchObject({
      approved: true,
      rejectedThumbnails: [1],
      bestThumbnail: 0,
      replaceScenes: [],
    });
  });

  it('imagem ruim numa cena com imagem → trocar; cena só com o Zeca não tem o que trocar', () => {
    const v = verdictFrom(
      {
        summary: 'não',
        issues: [
          {
            target: 'quadro',
            index: 2,
            kind: 'marca_ou_logo',
            severity: 'grave',
            detail: 'logo',
            fix: 'trocar_imagem',
          },
          {
            target: 'quadro',
            index: 1,
            kind: 'imagem_inadequada',
            severity: 'media',
            detail: 'z',
            fix: 'trocar_imagem',
          },
        ],
        bestThumbnail: 1,
      },
      input,
    );
    expect(v.approved).toBe(false);
    expect(v.replaceScenes).toEqual([2]);
    expect(v.issues[0]).toMatchObject({ scene: 2, t: 7 });
  });

  it('todas as thumbnails descartadas: reprova (precisa variar)', () => {
    const issues = [1, 2, 3].map((index) => ({
      target: 'thumbnail' as const,
      index,
      kind: 'texto_ilegivel' as const,
      severity: 'media' as const,
      detail: 'ilegível',
      fix: 'descartar_thumbnail' as const,
    }));
    const v = verdictFrom({ summary: 'thumbs ruins', issues, bestThumbnail: 1 }, input);
    expect(v).toMatchObject({ approved: false, bestThumbnail: null });
  });

  it('o pedido leva o contexto esperado de cada quadro e as imagens', () => {
    const blocks = reviewContent(input);
    const texts = blocks.flatMap((b) => (b.type === 'text' ? [b.text] : []));
    expect(texts.join('\n')).toMatch(
      /Quadro 2 .*legenda esperada: "A Rockstar confirmou".*selo de fonte esperado/,
    );
    expect(texts.join('\n')).toMatch(/Quadro 3 .*deve ter o selo RUMOR/);
    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(6);
  });
});
