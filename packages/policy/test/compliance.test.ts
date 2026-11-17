import { describe, expect, it } from 'vitest';
import { checkCompliance, withTextReview, type ComplianceInput } from '../src';

const spoilerWindow = { launchDate: '2026-11-19', windowDays: 30 };
const now = new Date('2026-11-17T12:00:00Z');
const asset = {
  id: 'a1',
  origin: 'IMAGE_PROVIDER' as const,
  manifest: { origin: 'IMAGE_PROVIDER' as const, license: 'Gerada', status: 'ACTIVE' as const },
};
const news: ComplianceInput = {
  kind: 'NEWS',
  format: 'LONG',
  title: 'GTA 6: o que a Rockstar mostrou no trailer novo',
  description:
    'O Zeca explica o trailer.\n\nFontes:\n- Rockstar Newswire: https://www.rockstargames.com/x\n\nApresentador animado com voz sintética (IA).',
  tags: ['GTA 6'],
  assets: [asset],
  originalRatio: 1,
  scriptIssues: [],
  sourceCount: 1,
  storyIsRumor: false,
  spoilerWindow,
  now,
};

describe('Conformidade', () => {
  it('notícia em dia passa', () => {
    const r = checkCompliance(news);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'direitos',
        'originalidade',
        'fatos',
        'fontes-descricao',
        'ia',
        'limites-youtube',
      ]),
    );
  });

  it('bloqueia mídia revogada, sem fontes, sem aviso de IA, rumor sem rótulo e sinais < >', () => {
    const r = checkCompliance({
      ...news,
      title: 'GTA 6 <exclusivo>',
      description: 'Sem nada',
      assets: [{ ...asset, manifest: { ...asset.manifest, status: 'REVOKED' } }],
      sourceCount: 0,
      storyIsRumor: true,
    });
    expect(r.ok).toBe(false);
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual(
      expect.arrayContaining(['direitos', 'fontes-descricao', 'ia', 'rumor', 'limites-youtube']),
    );
  });

  it('react: proporção, condições do parceiro e aviso de monetização', () => {
    const conditions = {
      credit: 'Canal X',
      link: 'https://www.youtube.com/@x',
      hashtag: '#canalx',
      monetization: 'not_allowed' as const,
    };
    const base: ComplianceInput = {
      ...news,
      kind: 'REACT',
      format: 'SHORT',
      description:
        'Zeca reage.\nClipe: Canal X — https://www.youtube.com/@x\n#canalx\nApresentador animado com voz sintética (IA).',
      react: { clipRatio: 0.4, commentRatio: 0.6, conditions },
    };
    const ok = checkCompliance(base);
    expect(ok.ok).toBe(true);
    expect(ok.checks.find((c) => c.id === 'monetizacao')).toMatchObject({
      ok: false,
      severity: 'warn',
    });
    const bad = checkCompliance({
      ...base,
      description: 'Zeca reage. (IA)',
      react: { ...base.react!, clipRatio: 0.6, commentRatio: 0.4 },
    });
    expect(bad.checks.filter((c) => !c.ok && c.severity === 'block').map((c) => c.id)).toEqual([
      'react-proporcao',
      'condicoes-parceiro',
    ]);
  });

  it('humano, vazamento e spoiler na janela bloqueiam; revisão de texto enganosa também', () => {
    const r = checkCompliance({ ...news, title: 'Eu sou humano e vi o vazamento', now });
    expect(r.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(
      expect.arrayContaining(['humano', 'rockstar']),
    );
    const spoiler = checkCompliance({
      ...news,
      title: 'GTA 6: o final secreto',
      now: new Date('2026-11-25T12:00:00Z'),
    });
    expect(spoiler.checks.find((c) => c.id === 'spoiler')?.ok).toBe(false);
    const reviewed = withTextReview(checkCompliance(news), {
      misleading: true,
      notes: ['O título promete data de lançamento.'],
    });
    expect(reviewed.ok).toBe(false);
  });
});
