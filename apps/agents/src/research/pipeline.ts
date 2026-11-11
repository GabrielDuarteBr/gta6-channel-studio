import type { Prisma, PrismaClient, Source } from '@studio/db';
import { audit, getAllSettings } from '@studio/db';
import { BudgetExceededError, Llm, LlmOutputError, LlmRefusalError } from '@studio/llm';
import { mergeFlags, NO_FLAGS, type ContentFlags } from '@studio/policy';
import {
  buildTriagePrompt,
  clusterItems,
  collectFeedSource,
  fakeTriage,
  prepareItems,
  scoreStory,
  storyTokens,
  TRIAGE_MODEL,
  TRIAGE_SYSTEM,
  triageResultSchema,
  YouTubeClient,
  youtubeWatchUrl,
  type CollectedItem,
  type CollectResult,
  type FetchLike,
  type RawItem,
  type SourceRecord,
  type SourceTier,
  type TriageStoryInput,
} from '@studio/research';
import type { Logger } from '@studio/shared';
import { budgetStatus, costRecorder, quotaRecorder, searchCallsToday } from './ledger';

export interface PipelineContext {
  prisma: PrismaClient;
  log: Logger;
  youtubeApiKey?: string | undefined;
  anthropicApiKey?: string | undefined;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export interface SourceRunSummary {
  source: string;
  status: CollectResult['status'] | 'sem chave' | 'pulada';
  fetched: number;
  relevant: number;
  newItems: number;
  error?: string | undefined;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

function toSourceRecord(s: Source): SourceRecord {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    tier: s.tier,
    url: s.url,
    config: (s.config as SourceRecord['config']) ?? null,
    resolved: (s.resolved as SourceRecord['resolved']) ?? null,
    etag: s.etag,
    lastModified: s.lastModified,
  };
}

/** Coleta de canal ou busca do YouTube (só metadados). */
async function collectYouTube(
  ctx: PipelineContext,
  source: Source,
  searchesPerDay: number,
): Promise<CollectResult | 'sem chave' | 'pulada'> {
  if (!ctx.youtubeApiKey) return 'sem chave';
  const yt = new YouTubeClient(ctx.youtubeApiKey, quotaRecorder(ctx.prisma), ctx.fetchImpl);
  const record = toSourceRecord(source);
  try {
    let videos;
    let resolved: Record<string, string> | undefined;
    if (source.kind === 'YOUTUBE_CHANNEL') {
      const cached = source.resolved as { uploadsPlaylistId?: string } | null;
      let uploads = cached?.uploadsPlaylistId;
      if (!uploads) {
        const ch = await yt.resolveHandle(source.url);
        if (!ch)
          return {
            status: 'erro',
            items: [],
            fetched: 0,
            error: `canal ${source.url} não encontrado`,
          };
        uploads = ch.uploadsPlaylistId;
        resolved = { channelId: ch.channelId, uploadsPlaylistId: ch.uploadsPlaylistId };
      }
      videos = await yt.recentUploads(uploads, 10);
    } else {
      if ((await searchCallsToday(ctx.prisma)) >= searchesPerDay) return 'pulada';
      const since = new Date((ctx.now?.() ?? new Date()).getTime() - 48 * 3_600_000);
      videos = await yt.searchRecent(source.url, since, 15);
    }
    const raw: RawItem[] = videos.map((v) => ({
      url: youtubeWatchUrl(v.videoId),
      title: v.title,
      summary: v.description?.slice(0, 400),
      author: v.channelTitle,
      publishedAt: v.publishedAt,
      metrics: { views: v.views ?? 0, likes: v.likes ?? 0, comments: v.comments ?? 0 },
    }));
    return {
      status: 'ok',
      items: prepareItems(raw, record),
      fetched: raw.length,
      ...(resolved ? { resolved } : {}),
    };
  } catch (err) {
    return { status: 'erro', items: [], fetched: 0, error: (err as Error).message.slice(0, 300) };
  }
}

/** Grava itens novos (idempotente pela URL canônica); itens já vistos só atualizam métricas. */
async function saveItems(
  prisma: PrismaClient,
  sourceId: string,
  items: CollectedItem[],
): Promise<number> {
  let created = 0;
  for (const item of items) {
    const existing = await prisma.newsItem.findUnique({
      where: { url: item.url },
      select: { id: true },
    });
    if (existing) {
      if (item.metrics)
        await prisma.newsItem.update({
          where: { id: existing.id },
          data: { metrics: json(item.metrics) },
        });
      continue;
    }
    await prisma.newsItem.create({
      data: {
        sourceId,
        url: item.url,
        domain: item.domain,
        title: item.title.slice(0, 500),
        summary: item.summary?.slice(0, 1000) ?? null,
        author: item.author?.slice(0, 200) ?? null,
        publishedAt: item.publishedAt ?? null,
        normalizedTitle: item.normalizedTitle,
        metrics: item.metrics ? json(item.metrics) : undefined,
        flags: json(item.flags),
        isRumor: item.isRumor,
      },
    });
    created++;
  }
  return created;
}

async function runWithLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await (tasks[i] as () => Promise<T>)();
    }
  });
  await Promise.all(workers);
  return results;
}

/** 1) Coleta todas as fontes ativas. Uma fonte com erro não derruba as outras. */
export async function collectAll(ctx: PipelineContext): Promise<SourceRunSummary[]> {
  const { prisma } = ctx;
  const settings = await getAllSettings(prisma);
  const sources = await prisma.source.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  const tasks = sources.map((source) => async (): Promise<SourceRunSummary> => {
    const now = ctx.now?.() ?? new Date();
    const result =
      source.kind === 'RSS' || source.kind === 'PAGE'
        ? await collectFeedSource(toSourceRecord(source), ctx.fetchImpl)
        : await collectYouTube(ctx, source, settings.research.youtubeSearchesPerDay);

    if (result === 'sem chave' || result === 'pulada') {
      await prisma.source.update({
        where: { id: source.id },
        data: {
          lastFetchedAt: now,
          lastStatus: result,
          lastError:
            result === 'sem chave'
              ? 'Configure YOUTUBE_API_KEY no .env'
              : 'limite diário de buscas no YouTube atingido',
        },
      });
      return { source: source.name, status: result, fetched: 0, relevant: 0, newItems: 0 };
    }

    const newItems = result.status === 'ok' ? await saveItems(prisma, source.id, result.items) : 0;
    const previous = (source.resolved as Record<string, unknown> | null) ?? {};
    await prisma.source.update({
      where: { id: source.id },
      data: {
        lastFetchedAt: now,
        lastStatus: result.status,
        lastError: result.error ?? null,
        ...(result.status === 'ok' ? { lastOkAt: now, lastItemCount: result.items.length } : {}),
        ...(result.etag !== undefined ? { etag: result.etag } : {}),
        ...(result.lastModified !== undefined ? { lastModified: result.lastModified } : {}),
        ...(result.resolved ? { resolved: json({ ...previous, ...result.resolved }) } : {}),
      },
    });
    return {
      source: source.name,
      status: result.status,
      fetched: result.fetched,
      relevant: result.items.length,
      newItems,
      error: result.error,
    };
  });
  return runWithLimit(tasks, 4);
}

const TIER_RANK: Record<SourceTier, number> = { OFFICIAL: 0, PRESS: 1, COMMUNITY: 2 };

/** Recalcula agregados e pontuação de uma história. */
async function refreshStory(prisma: PrismaClient, storyId: string, now: Date): Promise<void> {
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: { items: { include: { source: { select: { tier: true } } } } },
  });
  if (!story) return;
  if (story.items.length === 0) {
    await prisma.story.delete({ where: { id: storyId } });
    return;
  }
  const items = story.items;
  const when = (i: (typeof items)[number]) => (i.publishedAt ?? i.fetchedAt).getTime();
  const domains = new Set(items.map((i) => i.domain));
  const officialCount = items.filter((i) => i.source.tier === 'OFFICIAL').length;
  const rumorItems = items.filter((i) => i.isRumor).length;
  const flags = mergeFlags(
    items.map((i) => ({ ...NO_FLAGS, ...((i.flags as Partial<ContentFlags> | null) ?? {}) })),
  );
  const headline = [...items].sort(
    (a, b) => TIER_RANK[a.source.tier] - TIER_RANK[b.source.tier] || when(a) - when(b),
  )[0];
  const breakdown = scoreStory(
    {
      items: items.map((i) => ({
        tier: i.source.tier,
        domain: i.domain,
        publishedAt: i.publishedAt,
        fetchedAt: i.fetchedAt,
        isRumor: i.isRumor,
        views: (i.metrics as { views?: number } | null)?.views,
      })),
      flags,
      newsworthiness: story.newsworthiness,
    },
    now,
  );
  await prisma.story.update({
    where: { id: storyId },
    data: {
      title: headline?.title ?? story.title,
      firstSeenAt: new Date(Math.min(...items.map(when))),
      lastSeenAt: new Date(Math.max(...items.map(when))),
      itemCount: items.length,
      independentSources: domains.size,
      officialCount,
      isRumor: officialCount === 0 && rumorItems / items.length >= 0.5,
      flags: json(flags),
      score: breakdown.total,
      scoreBreakdown: json(breakdown),
    },
  });
}

/** 2) Agrupa itens novos em histórias e recalcula a pontuação da janela. */
export async function clusterAndScore(
  ctx: PipelineContext,
): Promise<{ newStories: number; assigned: number; rescored: number }> {
  const { prisma } = ctx;
  const now = ctx.now?.() ?? new Date();
  const settings = await getAllSettings(prisma);
  const windowStart = new Date(now.getTime() - settings.research.windowHours * 3_600_000);

  const orphans = await prisma.newsItem.findMany({
    where: { storyId: null },
    orderBy: { fetchedAt: 'asc' },
    take: 2000,
  });
  const recent = await prisma.story.findMany({
    where: { lastSeenAt: { gte: windowStart } },
    include: { items: { select: { title: true } } },
  });
  const assignment = clusterItems(
    orphans.map((i) => ({ id: i.id, title: i.title, publishedAt: i.publishedAt ?? i.fetchedAt })),
    recent.map((s) => ({
      key: s.id,
      tokenSets: s.items.map((i) => storyTokens(i.title)),
      lastSeenAt: s.lastSeenAt,
    })),
    { windowHours: settings.research.windowHours, now },
  );

  const tempToReal = new Map<string, string>();
  const touched = new Set<string>();
  let newStories = 0;
  for (const item of orphans) {
    const key = assignment.get(item.id);
    if (!key) continue;
    let storyId = key;
    if (key.startsWith('new:')) {
      const existing = tempToReal.get(key);
      if (existing) storyId = existing;
      else {
        const created = await prisma.story.create({
          data: {
            title: item.title,
            firstSeenAt: item.publishedAt ?? item.fetchedAt,
            lastSeenAt: item.publishedAt ?? item.fetchedAt,
          },
        });
        tempToReal.set(key, created.id);
        storyId = created.id;
        newStories++;
      }
    }
    await prisma.newsItem.update({ where: { id: item.id }, data: { storyId } });
    touched.add(storyId);
  }

  // Recência muda com o tempo: recalcula toda a janela (é barato).
  for (const s of recent) touched.add(s.id);
  for (const id of touched) await refreshStory(prisma, id, now);
  return { newStories, assigned: orphans.length, rescored: touched.size };
}

/** 3) Triagem pelo Claude Haiku (ou regras simples no modo simulado). Junta duplicatas. */
export async function triageStories(
  ctx: PipelineContext,
): Promise<{ triaged: number; merged: number; skipped?: string }> {
  const { prisma, log } = ctx;
  const now = ctx.now?.() ?? new Date();
  const settings = await getAllSettings(prisma);
  const windowStart = new Date(now.getTime() - settings.research.windowHours * 3_600_000);
  const pending = await prisma.story.findMany({
    where: { triagedAt: null, lastSeenAt: { gte: windowStart }, status: 'NEW' },
    orderBy: { score: 'desc' },
    take: 45,
    include: { items: { include: { source: { select: { name: true, tier: true } } }, take: 6 } },
  });
  if (pending.length === 0) return { triaged: 0, merged: 0 };

  const llm = new Llm({
    simulation: settings['mode.simulation'],
    apiKey: ctx.anthropicApiKey,
    budget: () => budgetStatus(prisma),
    record: costRecorder(prisma),
  });

  let triaged = 0;
  let merged = 0;
  for (let i = 0; i < pending.length; i += 15) {
    const batch = pending.slice(i, i + 15);
    const input: TriageStoryInput[] = batch.map((s) => ({
      id: s.id,
      firstSeenAt: s.firstSeenAt.toISOString(),
      items: s.items.map((it) => ({
        source: it.source.name,
        tier: it.source.tier,
        title: it.title,
        summary: it.summary?.slice(0, 280),
        isRumor: it.isRumor,
        leak: Boolean((it.flags as Partial<ContentFlags> | null)?.leak),
      })),
    }));
    let result;
    try {
      result = await llm.structured({
        task: 'agent:pesquisador.triagem',
        model: TRIAGE_MODEL,
        system: TRIAGE_SYSTEM,
        user: buildTriagePrompt(input),
        schema: triageResultSchema,
        maxTokens: 6000,
        effort: 'low',
        fake: () => fakeTriage(input),
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        await audit(prisma, {
          actor: 'agent:pesquisador',
          action: 'budget.paused',
          outcome: 'DENIED',
          details: { reason: err.message },
        });
        log.warn({ reason: err.message }, 'triagem pausada: orçamento');
        return { triaged, merged, skipped: err.message };
      }
      if (err instanceof LlmRefusalError || err instanceof LlmOutputError) {
        log.warn({ err }, 'triagem do lote falhou; segue sem ela');
        continue;
      }
      throw err;
    }
    const ids = new Set(batch.map((s) => s.id));
    for (const r of result.data.stories) {
      if (!ids.has(r.id)) continue; // ignora ids inventados
      const target =
        r.duplicateOf && r.duplicateOf !== r.id && ids.has(r.duplicateOf) ? r.duplicateOf : null;
      if (target) {
        // Mesma notícia (ex.: PT e EN): move os itens para a história principal.
        await prisma.newsItem.updateMany({ where: { storyId: r.id }, data: { storyId: target } });
        await refreshStory(prisma, r.id, now); // apaga a história vazia
        await refreshStory(prisma, target, now);
        merged++;
        continue;
      }
      await prisma.story.update({
        where: { id: r.id },
        data: {
          titlePt: r.titlePt.slice(0, 200),
          summaryPt: r.summaryPt.slice(0, 600),
          kind: r.kind,
          newsworthiness: Math.max(0, Math.min(10, r.newsworthiness)),
          triagedAt: now,
        },
      });
      await refreshStory(prisma, r.id, now);
      triaged++;
    }
  }
  return { triaged, merged };
}

/** Pipeline completo: coleta → agrupa/pontua → triagem. */
export async function runResearch(ctx: PipelineContext) {
  const started = Date.now();
  const sources = await collectAll(ctx);
  const clustering = await clusterAndScore(ctx);
  const triage = await triageStories(ctx);
  const summary = {
    sources,
    clustering,
    triage,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  await audit(ctx.prisma, {
    actor: 'agent:pesquisador',
    action: 'research.run',
    details: {
      ok: sources.filter((s) => s.status === 'ok').length,
      errors: sources.filter((s) => s.status === 'erro').length,
      newItems: sources.reduce((n, s) => n + s.newItems, 0),
      newStories: clustering.newStories,
      triaged: triage.triaged,
      merged: triage.merged,
    },
  });
  return summary;
}
