import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPrisma, setSetting } from '@studio/db';
import type { FetchLike } from '@studio/research';
import { createLogger } from '@studio/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clusterAndScore, collectAll, runResearch, triageStories } from '../src/research/pipeline';
import { applyDefaultSourceFixes, seedDefaultSources } from '../src/research/sources';

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

  it('com chave do YouTube: canal oficial e busca entram na pauta (só metadados)', async () => {
    // API falsa do YouTube: responde pelo nome do método e confere que a chave foi enviada.
    const calls: string[] = [];
    const youtube: Record<string, unknown> = {
      channels: {
        items: [
          {
            id: 'UC1',
            snippet: { title: 'Rockstar Games' },
            contentDetails: { relatedPlaylists: { uploads: 'UU1' } },
          },
        ],
      },
      playlistItems: {
        items: [
          {
            snippet: {
              title: 'Grand Theft Auto VI: Launch Trailer',
              channelTitle: 'Rockstar Games',
              resourceId: { videoId: 'vidOficial' },
            },
            contentDetails: { videoPublishedAt: '2026-11-09T16:00:00Z' },
          },
          {
            snippet: { title: 'Red Dead Online: Bonuses', resourceId: { videoId: 'vidRdo' } },
            contentDetails: { videoPublishedAt: '2026-11-09T15:00:00Z' },
          },
        ],
      },
      search: {
        items: [
          {
            id: { videoId: 'vidBusca' },
            snippet: {
              title: 'GTA 6 Launch Trailer Breakdown',
              channelTitle: 'Canal de fã',
              publishedAt: '2026-11-09T17:00:00Z',
            },
          },
        ],
      },
      videos: { items: [{ id: 'vidOficial', statistics: { viewCount: '1000000' } }] },
    };
    const fetchWithYoutube: FetchLike = async (u, init) => {
      if (u.startsWith('https://www.googleapis.com/youtube/v3/')) {
        const url = new URL(u);
        const method = url.pathname.split('/').pop() ?? '';
        calls.push(method);
        if (url.searchParams.get('key') !== 'chave-teste')
          return new Response('{}', { status: 400 });
        return new Response(JSON.stringify(youtube[method] ?? {}), { status: 200 });
      }
      return fakeFetch(u, init);
    };
    await prisma.source.create({
      data: {
        key: 't-busca',
        name: 'Busca',
        kind: 'YOUTUBE_SEARCH',
        tier: 'COMMUNITY',
        url: 'GTA 6',
      },
    });
    const summary = await collectAll({
      ...ctx,
      youtubeApiKey: 'chave-teste',
      fetchImpl: fetchWithYoutube,
    });
    const by = Object.fromEntries(summary.map((x) => [x.source, x]));
    expect(by['YouTube']).toMatchObject({ status: 'ok', fetched: 2, relevant: 1, newItems: 1 });
    expect(by['Busca']).toMatchObject({ status: 'ok', relevant: 1, newItems: 1 });
    const urls = (await prisma.newsItem.findMany({ select: { url: true } })).map((i) => i.url);
    expect(urls).toContain('https://www.youtube.com/watch?v=vidOficial');
    expect(urls).toContain('https://www.youtube.com/watch?v=vidBusca');
    expect(urls).not.toContain('https://www.youtube.com/watch?v=vidRdo');
    const official = await prisma.newsItem.findUniqueOrThrow({
      where: { url: 'https://www.youtube.com/watch?v=vidOficial' },
    });
    expect((official.metrics as { views?: number }).views).toBe(1_000_000);
    const yt = await prisma.source.findFirstOrThrow({ where: { key: 't-yt' } });
    expect((yt.resolved as { uploadsPlaylistId?: string }).uploadsPlaylistId).toBe('UU1');
    expect(calls).toEqual(
      expect.arrayContaining(['channels', 'playlistItems', 'search', 'videos']),
    );
    const quota = await prisma.quotaLedger.groupBy({ by: ['bucket'], _sum: { units: true } });
    expect(quota.find((q) => q.bucket === 'search.list')?._sum.units).toBe(1);
  });

  it('página que responde sem nenhum link fica "sem links" (não "ok")', async () => {
    await prisma.source.create({
      data: {
        key: 't-vazia',
        name: 'Página vazia',
        kind: 'PAGE',
        tier: 'OFFICIAL',
        url: 'https://vazia.example.com/newswire',
        config: { linkPattern: '/newswire/article/' },
      },
    });
    const emptyPage: FetchLike = async (u, init) =>
      u === 'https://vazia.example.com/newswire'
        ? new Response('<html><body><div id="root"></div></body></html>', { status: 200 })
        : fakeFetch(u, init);
    const summary = await collectAll({ ...ctx, fetchImpl: emptyPage });
    expect(summary.find((x) => x.source === 'Página vazia')?.status).toBe('sem links');
    const page = await prisma.source.findFirstOrThrow({ where: { key: 't-vazia' } });
    expect(page.lastStatus).toBe('sem links');
    expect(page.lastError).toContain('JavaScript');
  });

  it('fonte padrão que passou a vir desativada: corrige uma vez e respeita o dono', async () => {
    await prisma.source.deleteMany();
    await seedDefaultSources(prisma);
    // Instalação nova: já nasce desativada, com o motivo.
    const fresh = await prisma.source.findUniqueOrThrow({ where: { key: 'adrenaline' } });
    expect(fresh.enabled).toBe(false);
    expect(fresh.lastError).toContain('403');

    // Instalação antiga (Fase 1): as duas estavam ativas; uma o dono já tinha editado.
    await prisma.source.update({
      where: { key: 'adrenaline' },
      data: { enabled: true, lastStatus: 'erro', lastError: 'HTTP 403' },
    });
    await prisma.source.update({
      where: { key: 'take-two-ir' },
      data: { enabled: true, url: 'https://exemplo.com/ir-novo' },
    });
    expect(await applyDefaultSourceFixes(prisma)).toEqual(['adrenaline']);
    const fixed = await prisma.source.findUniqueOrThrow({ where: { key: 'adrenaline' } });
    expect(fixed).toMatchObject({ enabled: false, lastStatus: 'desativada' });
    const edited = await prisma.source.findUniqueOrThrow({ where: { key: 'take-two-ir' } });
    expect(edited.enabled).toBe(true); // o dono mudou o endereço: não mexe
    expect(await prisma.auditLog.count({ where: { action: 'source.default-fix' } })).toBe(2);

    // O dono reativa: a correção não volta a desativar.
    await prisma.source.update({ where: { key: 'adrenaline' }, data: { enabled: true } });
    expect(await applyDefaultSourceFixes(prisma)).toEqual([]);
    expect((await prisma.source.findUniqueOrThrow({ where: { key: 'adrenaline' } })).enabled).toBe(
      true,
    );
  });
});
