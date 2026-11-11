import { describe, expect, it } from 'vitest';
import {
  canonicalUrl,
  clusterItems,
  headlineSimilarity,
  isAboutGta6,
  normalizeText,
  registrableDomain,
  scoreStory,
  storyTokens,
} from '../src';

describe('URLs', () => {
  it('canonicaliza (https, sem utm/fragmento/barra final, parâmetros ordenados)', () => {
    expect(canonicalUrl('http://WWW.Site.com/a/b/?utm_source=x&b=2&a=1#top')).toBe(
      'https://www.site.com/a/b?a=1&b=2',
    );
    expect(canonicalUrl('/rel', 'https://x.com/base')).toBe('https://x.com/rel');
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
  });

  it('domínio registrável', () => {
    expect(registrableDomain('https://br.ign.com/x')).toBe('ign.com');
    expect(registrableDomain('https://www.tecmundo.com.br/voxel')).toBe('tecmundo.com.br');
  });
});

describe('texto e relevância', () => {
  it('unifica as formas de escrever o nome do jogo', () => {
    expect(normalizeText('Grand Theft Auto VI')).toBe('gta6');
    expect(normalizeText('GTA-6: trailer')).toBe('gta6 trailer');
    expect(normalizeText('GTA VI ganha data')).toBe('gta6 ganha data');
  });

  it('só passa notícia de GTA 6; sites focados aceitam Rockstar/Leonida, mas não outros jogos', () => {
    expect(isAboutGta6('Ten best indie games', undefined, false)).toBe(false);
    expect(isAboutGta6('GTA 6 delayed?', undefined, false)).toBe(true);
    expect(isAboutGta6('Rockstar hiring spree continues', undefined, true)).toBe(true);
    expect(isAboutGta6('Rockstar hiring spree continues', undefined, false)).toBe(false);
    expect(isAboutGta6('Red Dead Online: new pass from Rockstar', undefined, true)).toBe(false);
  });
});

describe('agrupamento', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 10, 9, h));
  const items = [
    {
      id: 'a',
      title: 'GTA 6 Trailer 3 Is Coming Next Week, Rockstar Confirms',
      publishedAt: t(14),
    },
    { id: 'b', title: 'Rockstar confirms GTA 6 trailer 3 arrives next week', publishedAt: t(15) },
    { id: 'c', title: 'GTA VI trailer 3 confirmed for next week', publishedAt: t(16) },
    { id: 'd', title: 'GTA VI price reportedly set at $80, insiders claim', publishedAt: t(9) },
    { id: 'e', title: 'GTA 6 will cost $80 according to insiders', publishedAt: t(11) },
    { id: 'f', title: 'GTA 6 trailer 2 breaks YouTube records', publishedAt: t(8) },
    {
      id: 'g',
      title: 'Take-Two earnings: GTA 6 still on track for November 19',
      publishedAt: t(12),
    },
  ];

  it('junta manchetes da mesma história e separa as diferentes', () => {
    const groups = clusterItems(items, [], { windowHours: 72, now: t(18) });
    const g = (id: string) => groups.get(id);
    expect(g('a')).toBe(g('b'));
    expect(g('a')).toBe(g('c'));
    expect(g('d')).toBe(g('e'));
    expect(g('f')).not.toBe(g('a')); // trailer 2 ≠ trailer 3
    expect(g('g')).not.toBe(g('a'));
    expect(new Set(groups.values()).size).toBe(4);
  });

  it('é determinístico e respeita histórias existentes na janela', () => {
    const existing = [
      {
        key: 'story-1',
        tokenSets: [storyTokens('Rockstar confirms GTA 6 trailer 3 next week')],
        lastSeenAt: t(13),
      },
    ];
    const groups = clusterItems([items[0]!], existing, { windowHours: 72, now: t(18) });
    expect(groups.get('a')).toBe('story-1');
    const old = [{ ...existing[0]!, lastSeenAt: new Date(Date.UTC(2026, 9, 1)) }];
    expect(clusterItems([items[0]!], old, { windowHours: 72, now: t(18) }).get('a')).not.toBe(
      'story-1',
    );
  });

  it('semelhança derruba números conflitantes', () => {
    expect(
      headlineSimilarity(storyTokens('gta 6 trailer 2'), storyTokens('gta 6 trailer 3')),
    ).toBeLessThan(0.42);
  });
});

describe('pontuação', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const item = (
    tier: 'OFFICIAL' | 'PRESS' | 'COMMUNITY',
    domain: string,
    hoursAgo: number,
    isRumor = false,
  ) => ({
    tier,
    domain,
    publishedAt: new Date(now.getTime() - hoursAgo * 3_600_000),
    fetchedAt: now,
    isRumor,
  });

  it('oficial e corroborado vale mais que rumor isolado', () => {
    const official = scoreStory(
      {
        items: [item('OFFICIAL', 'rockstargames.com', 2), item('PRESS', 'ign.com', 1)],
        flags: null,
      },
      now,
    );
    const rumor = scoreStory({ items: [item('COMMUNITY', 'fan.com', 1, true)], flags: null }, now);
    expect(official.total).toBeGreaterThan(rumor.total);
    expect(rumor.penalty).toBe(0.7);
  });

  it('decai com o tempo (meia-vida de 24 h) e penaliza vazamento', () => {
    const fresh = scoreStory({ items: [item('PRESS', 'ign.com', 0)], flags: null }, now);
    const dayOld = scoreStory({ items: [item('PRESS', 'ign.com', 24)], flags: null }, now);
    expect(dayOld.total).toBeCloseTo(fresh.total / 2, 0);
    const leak = scoreStory({ items: [item('PRESS', 'ign.com', 0)], flags: { leak: true } }, now);
    expect(leak.total).toBeLessThan(fresh.total / 3 + 0.2);
  });

  it('a triagem do Claude (relevância 0-10) soma até 2 pontos na base', () => {
    const base = scoreStory({ items: [item('PRESS', 'ign.com', 0)], flags: null }, now);
    const hot = scoreStory(
      { items: [item('PRESS', 'ign.com', 0)], flags: null, newsworthiness: 10 },
      now,
    );
    expect(hot.total - base.total).toBeCloseTo(20, 0);
  });
});
