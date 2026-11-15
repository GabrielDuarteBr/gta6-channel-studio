import { describe, expect, it } from 'vitest';
import {
  assertAssetRenderable,
  assertDailyLimit,
  assertImagePromptAllowed,
  assertManifestInput,
  assertOriginalCommentary,
  checkScript,
  PolicyViolation,
  type RenderableAsset,
} from '../src';

const window = { launchDate: '2026-11-19', windowDays: 30 };

describe('manifesto de direitos', () => {
  it('imprensa oficial só com link de site da Rockstar/Take-Two; YouTube nunca', () => {
    expect(() =>
      assertManifestInput({
        origin: 'OFFICIAL_PRESS',
        license: 'Imprensa oficial — uso editorial',
        sourceUrl: 'https://www.rockstargames.com/newswire/article/abc',
      }),
    ).not.toThrow();
    expect(() =>
      assertManifestInput({
        origin: 'OFFICIAL_PRESS',
        license: 'Imprensa oficial',
        sourceUrl: 'https://fansite.example.com/imagem',
      }),
    ).toThrow(/não é um site oficial/);
    expect(() =>
      assertManifestInput({
        origin: 'OWNER_UPLOAD',
        license: 'Própria',
        proof: 'print',
        sourceUrl: 'https://www.youtube.com/watch?v=x',
      }),
    ).toThrow(/YouTube/);
    expect(() => assertManifestInput({ origin: 'OFFICIAL_PRESS', license: 'x' })).toThrow(
      PolicyViolation,
    );
  });

  it('parceiro sem permissão registrada não entra; upload do dono pede a origem', () => {
    expect(() =>
      assertManifestInput({ origin: 'PARTNER', license: 'cortes liberados', proof: 'dm' }),
    ).toThrow(/permissão registrada/);
    expect(() => assertManifestInput({ origin: 'OWNER_UPLOAD', license: 'Própria' })).toThrow(
      /de onde vem/,
    );
  });

  it('imagem gerada precisa de provedor e prompt limpo', () => {
    expect(() =>
      assertManifestInput({
        origin: 'IMAGE_PROVIDER',
        license: 'Gerada pelo provedor',
        provider: 'imagen',
        prompt: 'Neon tropical city at dusk, palm trees, wet streets',
      }),
    ).not.toThrow();
    expect(() =>
      assertManifestInput({ origin: 'IMAGE_PROVIDER', license: 'Gerada', provider: 'imagen' }),
    ).toThrow(/prompt/);
  });

  it('render recusa sem manifesto, revogado, vencido ou de parceiro', () => {
    const base: RenderableAsset = {
      id: 'a1',
      origin: 'IMAGE_PROVIDER',
      manifest: { origin: 'IMAGE_PROVIDER', license: 'Gerada', status: 'ACTIVE' },
    };
    expect(() => assertAssetRenderable(base)).not.toThrow();
    expect(() => assertAssetRenderable({ ...base, manifest: null })).toThrow(/sem manifesto/);
    expect(() =>
      assertAssetRenderable({ ...base, manifest: { ...base.manifest!, status: 'REVOKED' } }),
    ).toThrow(/revogados/);
    expect(() =>
      assertAssetRenderable(
        { ...base, manifest: { ...base.manifest!, expiresAt: new Date('2026-01-01') } },
        new Date('2026-11-15'),
      ),
    ).toThrow(/vencidos/);
    expect(() =>
      assertAssetRenderable({
        id: 'p',
        origin: 'PARTNER',
        manifest: { origin: 'PARTNER', license: 'permissão por e-mail', status: 'ACTIVE' },
      }),
    ).toThrow(/parceiro/);
  });
});

describe('prompt de imagem', () => {
  it('recusa marcas, personagens e lugares do jogo, logotipos e pessoas reais', () => {
    expect(() => assertImagePromptAllowed('Neon Miami skyline at night, synthwave')).not.toThrow();
    for (const bad of [
      'GTA 6 style street',
      'Lucia and Jason in a car',
      'Vice City beach at sunset',
      'Rockstar logo on a wall',
      'Leônida swamp with alligators',
    ]) {
      expect(() => assertImagePromptAllowed(bad), bad).toThrow(PolicyViolation);
    }
  });
});

describe('roteiro: fatos, rumor, IA e Rockstar', () => {
  const sources = [
    { id: 'oficial', domain: 'rockstargames.com', official: true },
    { id: 'imprensa', domain: 'ign.com', official: false },
    { id: 'outra', domain: 'gamespot.com', official: false },
  ];
  const check = (lines: Parameters<typeof checkScript>[0]['lines'], storyIsRumor = false) =>
    checkScript({
      lines,
      sources,
      storyIsRumor,
      spoilerWindow: window,
      now: new Date('2026-11-15'),
    });

  it('roteiro bom passa', () => {
    expect(
      check([
        { id: 1, kind: 'abertura', spoken: 'Fala, galera!', sourceIds: [] },
        { id: 2, kind: 'fato', spoken: 'A Rockstar confirmou a data.', sourceIds: ['oficial'] },
        {
          id: 3,
          kind: 'rumor',
          spoken: 'E tem rumor, não confirmado, de edição especial.',
          sourceIds: ['imprensa', 'outra'],
        },
        { id: 4, kind: 'opiniao', spoken: 'Eu acho que vai ser enorme.', sourceIds: [] },
      ]),
    ).toEqual([]);
  });

  it('afirmação sem fonte, fonte inventada e rumor mal feito viram problemas', () => {
    const issues = check([
      { id: 1, kind: 'fato', spoken: 'O jogo custa 70 dólares.', sourceIds: [] },
      { id: 2, kind: 'contexto', spoken: 'Segundo a revista.', sourceIds: ['inventada'] },
      { id: 3, kind: 'rumor', spoken: 'Vai ter mapa gigante.', sourceIds: ['imprensa'] },
    ]);
    const msgs = issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/fala 1 \(fato\) sem fonte/);
    expect(msgs).toMatch(/fala 2 cita fonte que não está/);
    expect(msgs).toMatch(/2 fontes independentes/);
    expect(msgs).toMatch(/dizer isso em voz alta/);
  });

  it('história de rumor não pode ter "fato" sem fonte oficial', () => {
    const issues = check(
      [{ id: 1, kind: 'fato', spoken: 'O mapa é enorme.', sourceIds: ['imprensa'] }],
      true,
    );
    expect(issues[0]?.message).toMatch(/trata rumor como fato/);
  });

  it('Zeca dizendo que é humano, vazamento e spoiler na janela', () => {
    const human = check([{ id: 1, kind: 'opiniao', spoken: 'Eu sou humano, viu?', sourceIds: [] }]);
    expect(human.map((i) => i.rule)).toContain('AI_DISCLOSURE');
    const leak = check([
      { id: 1, kind: 'fato', spoken: 'Vazou o mapa inteiro.', sourceIds: ['oficial'] },
    ]);
    expect(leak.map((i) => i.rule)).toContain('ROCKSTAR_POLICY');
    const spoiler = checkScript({
      lines: [{ id: 1, kind: 'opiniao', spoken: 'Olha o final secreto!', sourceIds: [] }],
      sources,
      storyIsRumor: false,
      spoilerWindow: window,
      now: new Date('2026-11-25'),
    });
    expect(spoiler.map((i) => i.rule)).toContain('ANTI_SPOILER');
  });
});

describe('comentário próprio e limites diários', () => {
  it('70% de comentário próprio', () => {
    expect(() => assertOriginalCommentary(100, 30)).not.toThrow();
    expect(() => assertOriginalCommentary(100, 31)).toThrow(/mínimo 70%/);
  });
  it('limite diário por formato', () => {
    expect(() => assertDailyLimit('LONG', 0, { long: 1, shorts: 4 })).not.toThrow();
    expect(() => assertDailyLimit('LONG', 1, { long: 1, shorts: 4 })).toThrow(/vídeos longos/);
    expect(() => assertDailyLimit('SHORT', 4, { long: 1, shorts: 4 })).toThrow(/Shorts/);
  });
});
