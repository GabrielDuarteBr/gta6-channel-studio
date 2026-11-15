import { audit, getAllSettings, getPrisma, type ProductionFormat } from '@studio/db';
import { assertCanPromoteStory, assertDailyLimit, type ContentFlags } from '@studio/policy';
import { PRODUCTION_JOB } from '@studio/production';
import { createQueue, deterministicJobId, redisConnection } from '@studio/queue';
import { channelDay, parseEnv, redisEnvSchema } from '@studio/shared';

/** Histórias que a Pauta mandou virar vídeo e ainda não têm produção ativa. */
export async function queuedStories() {
  const stories = await getPrisma().story.findMany({
    where: { status: { in: ['QUEUED_LONG', 'QUEUED_SHORT'] } },
    include: {
      productions: { select: { status: true } },
      _count: { select: { items: true } },
    },
    orderBy: { statusChangedAt: 'desc' },
    take: 30,
  });
  return stories.filter((s) =>
    s.productions.every((p) => p.status === 'FAILED' || p.status === 'CANCELED'),
  );
}

export async function listProductions(take = 20) {
  const prisma = getPrisma();
  const rows = await prisma.production.findMany({
    include: { story: { select: { id: true, title: true, titlePt: true, isRumor: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
  const costs = await prisma.costLedger.groupBy({
    by: ['productionId'],
    where: { productionId: { in: rows.map((r) => r.id) } },
    _sum: { costUsd: true },
  });
  const byId = new Map(costs.map((c) => [c.productionId, Number(c._sum.costUsd ?? 0)]));
  return rows.map((r) => ({ ...r, costUsd: byId.get(r.id) ?? 0 }));
}

/** Produções começadas hoje (dia de Brasília) por formato, para o limite diário. */
export async function startedToday(format: ProductionFormat, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 36 * 3_600_000);
  const rows = await getPrisma().production.findMany({
    where: { format, createdAt: { gte: since }, status: { notIn: ['DRAFT', 'CANCELED'] } },
    select: { createdAt: true },
  });
  const today = channelDay(now);
  return rows.filter((r) => channelDay(r.createdAt) === today).length;
}

async function enqueue(productionId: string): Promise<void> {
  const { REDIS_URL } = parseEnv(redisEnvSchema);
  const queue = createQueue('render', redisConnection(REDIS_URL));
  try {
    await queue.add(
      PRODUCTION_JOB,
      { productionId },
      {
        jobId: deterministicJobId(
          'render',
          PRODUCTION_JOB,
          productionId,
          new Date().toISOString().slice(0, 16),
        ),
        attempts: 2,
      },
    );
  } finally {
    await queue.close();
  }
}

/**
 * "Produzir": confere a política da história e o limite diário, cria a produção e põe na
 * fila (o agents faz roteiro, imagens, voz, render e revisão). Lança PolicyViolation.
 */
export async function startProduction(storyId: string, actor = 'owner'): Promise<string> {
  const prisma = getPrisma();
  const settings = await getAllSettings(prisma);
  const story = await prisma.story.findUniqueOrThrow({ where: { id: storyId } });
  const format: ProductionFormat = story.status === 'QUEUED_SHORT' ? 'SHORT' : 'LONG';
  assertCanPromoteStory(
    {
      flags: story.flags as Partial<ContentFlags> | null,
      isRumor: story.isRumor,
      independentSources: story.independentSources,
      officialCount: story.officialCount,
    },
    settings.antiSpoiler,
  );
  assertDailyLimit(format, await startedToday(format), settings['limits.daily']);
  const prod = await prisma.production.create({
    data: {
      storyId,
      format,
      status: 'QUEUED',
      step: 'na fila',
      title: story.titlePt ?? story.title,
      createdBy: actor,
    },
  });
  await enqueue(prod.id);
  await audit(prisma, {
    actor,
    action: 'production.start',
    target: prod.id,
    details: { storyId, format },
  });
  return prod.id;
}

/** Tenta de novo (continua de onde parou: o que já foi feito e pago não é refeito). */
export async function retryProduction(id: string, actor = 'owner'): Promise<void> {
  const prisma = getPrisma();
  const prod = await prisma.production.findUniqueOrThrow({ where: { id } });
  if (!['FAILED', 'NEEDS_ATTENTION'].includes(prod.status)) return;
  await prisma.production.update({
    where: { id },
    data: { status: 'QUEUED', step: 'na fila (nova tentativa)', error: null, finishedAt: null },
  });
  await enqueue(id);
  await audit(prisma, { actor, action: 'production.retry', target: id });
}

export async function cancelProduction(id: string, actor = 'owner'): Promise<void> {
  const prisma = getPrisma();
  const prod = await prisma.production.findUniqueOrThrow({ where: { id } });
  if (['READY', 'CANCELED'].includes(prod.status)) return;
  await prisma.production.update({
    where: { id },
    data: { status: 'CANCELED', step: 'cancelado pelo dono', finishedAt: new Date() },
  });
  await audit(prisma, { actor, action: 'production.cancel', target: id });
}
