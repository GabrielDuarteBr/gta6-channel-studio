import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPrisma, setSetting } from '@studio/db';
import type { FetchLike } from '@studio/research';
import { createLogger } from '@studio/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clusterAndScore, collectAll, runResearch, triageStories } from '../src/research/pipeline';
import { seedDefaultSources } from '../src/research/sources';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const fx = (n: string) => readFileSync(join(import.meta.dirname, 'fixtures', n), 'utf8');

/** Internet falsa: só os endereços das fontes de teste respondem. */
const routes: Record<string, string> = {
  'https://www.rockstarintel.com/feed': fx('wordpress-rss.xml'),
  'https://press.example.com/feed': fx('press-atom.xml'),
  'https://www.rockstargames.com/newswire': fx('newswire.html'),
};
const fakeFetch: FetchLike = async (u) =>
  routes[u]
    ? new Response(routes[u], { status: 200, headers: { etag: '"x"' } })
    : new Response('fora do ar', { status: 503 });

d('pipeline de pesquisa (integração com Postgres)', () => {
  const prisma = createPrisma(url as string);
  const log = createLogger('teste', 'silent');
  const now = () => new Date('2026-11-09T18:00:00Z');
  const ctx = { prisma, log, fetchImpl: fakeFetch, now };

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "NewsItem", "Story", "Source", "Setting", "AuditLog", "CostLedger", "QuotaLedger", "JobRun" CASCADE',
    );
    await prisma.source.createMany({
      data: [
        {
          key: 't-intel',
          name: 'Rockstar Intel',
          kind: 'RSS',
          tier: 'COMMUNITY',
          url: 'https://www.rockstarintel.com/feed',
          config: { gtaOnly: true },
        },
        {
          key: 't-press',
          name: 'Imprensa',
          kind: 'RSS',
          tier: 'PRESS',
          url: 'https://press.example.com/feed',
        },
        {
          key: 't-newswire',
          name: 'Newswire',
          kind: 'PAGE',
          tier: 'OFFICIAL',
          url: 'https://www.rockstargames.com/newswire',
          config: { linkPattern: '/newswire/article/', gtaOnly: true },
        },
        {
          key: 't-fora',
          name: 'Fora do ar',
          kind: 'RSS',
          tier: 'PRESS',
          url: 'https://fora.example.com/feed',
        },
        {
          key: 't-yt',
          name: 'YouTube',
          kind: 'YOUTUBE_CHANNEL',
          tier: 'OFFICIAL',
          url: '@RockstarGames',
        },
      ],
    });
  });
  afterAll(() => prisma.$disconnect());

  it('coleta, grava status por fonte e não derruba nada com uma fonte fora do ar', async () => {
    const summary = await collectAll(ctx);
    const by = Object.fromEntries(summary.map((s) => [s.source, s]));
    expect(by['Rockstar Intel']).toMatchObject({ status: 'ok', relevant: 2, newItems: 2 });
    expect(by['Imprensa']).toMatchObject({ status: 'ok', relevant: 2 });
    expect(by['Newswire']).toMatchObject({ status: 'ok', relevant: 1 });
    expect(by['Fora do ar']?.status).toBe('erro');
    expect(by['YouTube']?.status).toBe('sem chave');
    const fora = await prisma.source.findFirstOrThrow({ where: { key: 't-fora' } });
    expect(fora.lastError).toContain('503');
  });

  it('agrupa, pontua e marca oficial/rumor/vazamento', async () => {
    await collectAll(ctx);
    const res = await clusterAndScore(ctx);
    expect(res.assigned).toBe(5);
    const stories = await prisma.story.findMany({
      include: { items: true },
      orderBy: { score: 'desc' },
    });
    // trailer 3 (oficial + imprensa + comunidade), preço (rumor), vazamento
    expect(stories).toHaveLength(3);
    const trailer = stories[0]!;
    expect(trailer.itemCount).toBe(3);
    expect(trailer.officialCount).toBe(1);
    expect(trailer.independentSources).toBe(3);
    expect(trailer.isRumor).toBe(false);
    expect(trailer.title).toBe('Grand Theft Auto VI: Watch Trailer 3 Now'); // manchete da fonte oficial
    const price = stories.find((s) => s.title.includes('$80'));
    expect(price?.isRumor).toBe(true);
    const leak = stories.find((s) => (s.flags as { leak?: boolean }).leak);
    expect(leak).toBeTruthy();
    expect(leak!.score).toBeLessThan(trailer.score);
  });

  it('rodar de novo não duplica itens nem histórias (idempotente)', async () => {
    await runResearch(ctx);
    const counts1 = [await prisma.newsItem.count(), await prisma.story.count()];
    await runResearch(ctx);
    const counts2 = [await prisma.newsItem.count(), await prisma.story.count()];
    expect(counts2).toEqual(counts1);
  });

  it('triagem no modo simulado: preenche PT-BR e registra custo zero simulado', async () => {
    await collectAll(ctx);
    await clusterAndScore(ctx);
    const res = await triageStories(ctx);
    expect(res.triaged).toBe(3);
    const cost = await prisma.costLedger.findMany();
    expect(cost.length).toBeGreaterThan(0);
    expect(cost.every((c) => c.simulated && Number(c.costUsd) === 0)).toBe(true);
    const official = await prisma.story.findFirstOrThrow({ where: { officialCount: { gt: 0 } } });
    expect(official.kind).toBe('oficial');
    expect(official.triagedAt).not.toBeNull();
    expect(official.titlePt).toBe('Grand Theft Auto VI: Watch Trailer 3 Now'); // manchete oficial
  });

  it('cria as fontes padrão uma vez e respeita o que o dono mudou', async () => {
    await prisma.source.deleteMany();
    const first = await seedDefaultSources(prisma);
    expect(first).toBeGreaterThan(10);
    await prisma.source.update({ where: { key: 'ign' }, data: { enabled: false } });
    expect(await seedDefaultSources(prisma)).toBe(0);
    expect((await prisma.source.findUniqueOrThrow({ where: { key: 'ign' } })).enabled).toBe(false);
    expect(await prisma.source.count({ where: { url: { contains: 'reddit' } } })).toBe(0);
  });

  it('o intervalo da coleta é configurável', async () => {
    await setSetting(
      prisma,
      'research',
      { intervalMinutes: 15, windowHours: 48, youtubeSearchesPerDay: 2 },
      'owner',
    );
    await expect(
      setSetting(
        prisma,
        'research',
        { intervalMinutes: 1, windowHours: 48, youtubeSearchesPerDay: 2 },
        'owner',
      ),
    ).rejects.toThrow();
  });
});
