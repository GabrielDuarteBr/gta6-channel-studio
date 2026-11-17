import { audit, getAllSettings, type ProductionFormat, type PrismaClient } from '@studio/db';
import { canPromoteStory, permissionProblem, type ContentFlags } from '@studio/policy';
import { brasiliaInstant, channelDay, type Logger } from '@studio/shared';
import { z } from 'zod';
import { permissionState } from '../partners/import';
import { budgetStatus } from '../research/ledger';

/**
 * Produção diária automática (Fase 7). No horário das Configurações, escolhe as melhores
 * histórias que PODEM virar vídeo (vazamento, trapaça, mods, spoiler e rumor sem 2 fontes ficam
 * de fora) e um vídeo de parceiro ainda não usado, até o limite do dia e dentro do teto de gasto.
 * Tudo vai para a fila de Aprovação: nada sobe sem o dono (salvo piloto automático ligado).
 * Uma rodada por dia (o id do job é o dia; o banco também confere).
 */

export const dailyJobSchema = z.object({
  /** Botão "rodar agora": ignora o liga/desliga e o "já rodou hoje". */
  force: z.boolean().optional(),
});

export const DAILY_ACTOR = 'agent:pauta-diaria';

export interface DailyContext {
  prisma: PrismaClient;
  log: Logger;
  enqueueProduction: (productionId: string) => Promise<void>;
  now?: () => Date;
}

export interface DailyResult {
  skipped?: string;
  created: Array<{ id: string; kind: 'NEWS' | 'REACT'; format: ProductionFormat; title: string }>;
}

async function startedToday(prisma: PrismaClient, format: ProductionFormat, now: Date) {
  const rows = await prisma.production.findMany({
    where: {
      format,
      createdAt: { gte: new Date(now.getTime() - 36 * 3_600_000) },
      status: { notIn: ['DRAFT', 'CANCELED'] },
    },
    select: { createdAt: true },
  });
  return rows.filter((r) => channelDay(r.createdAt) === channelDay(now)).length;
}

export async function runDailyProduction(
  ctx: DailyContext,
  opts: { force?: boolean } = {},
): Promise<DailyResult> {
  const { prisma, log } = ctx;
  const now = ctx.now?.() ?? new Date();
  const settings = await getAllSettings(prisma);
  const cfg = settings['schedule.daily'];
  if (!cfg.enabled && !opts.force) return { skipped: 'produção diária desligada', created: [] };

  if (!opts.force && (await ranToday(prisma, now))) {
    return { skipped: 'já rodou hoje', created: [] };
  }
  const budget = await budgetStatus(prisma);
  if (
    budget.spentTodayUsd >= budget.dailyLimitUsd ||
    budget.spentMonthUsd >= budget.monthlyLimitUsd
  ) {
    return { skipped: 'teto de gasto atingido', created: [] };
  }

  const limits = settings['limits.daily'];
  let longLeft = Math.max(
    0,
    Math.min(cfg.long, limits.long - (await startedToday(prisma, 'LONG', now))),
  );
  let shortLeft = Math.max(0, limits.shorts - (await startedToday(prisma, 'SHORT', now)));
  let newsShortLeft = Math.min(cfg.newsShorts, shortLeft);

  const since = new Date(now.getTime() - settings.research.windowHours * 3_600_000);
  const stories = await prisma.story.findMany({
    where: {
      status: { not: 'DISMISSED' },
      itemCount: { gt: 0 },
      lastSeenAt: { gte: since },
      productions: { none: {} },
    },
    orderBy: [{ score: 'desc' }],
    take: 40,
  });
  const created: DailyResult['created'] = [];
  for (const s of stories) {
    if (longLeft === 0 && newsShortLeft === 0) break;
    const ok = canPromoteStory(
      {
        flags: s.flags as Partial<ContentFlags> | null,
        isRumor: s.isRumor,
        independentSources: s.independentSources,
        officialCount: s.officialCount,
      },
      settings.antiSpoiler,
      now,
    ).ok;
    if (!ok) continue;
    const format: ProductionFormat = longLeft > 0 ? 'LONG' : 'SHORT';
    const prod = await prisma.production.create({
      data: {
        storyId: s.id,
        format,
        status: 'QUEUED',
        step: 'na fila (produção diária)',
        title: s.titlePt ?? s.title,
        createdBy: DAILY_ACTOR,
      },
    });
    created.push({ id: prod.id, kind: 'NEWS', format, title: prod.title ?? '' });
    if (format === 'LONG') longLeft -= 1;
    else {
      newsShortLeft -= 1;
      shortLeft -= 1;
    }
  }

  // Um vídeo de parceiro ainda não usado (permissão ativa, análise pronta).
  let reactLeft = Math.min(cfg.reacts, shortLeft);
  if (reactLeft > 0) {
    const assets = await prisma.asset.findMany({
      where: {
        kind: 'VIDEO',
        origin: 'PARTNER',
        analysisStatus: 'READY',
        manifest: { status: 'ACTIVE' },
        reactSources: { none: {} },
      },
      include: { manifest: { include: { permission: true } } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    for (const a of assets) {
      if (reactLeft === 0) break;
      const perm = a.manifest?.permission;
      if (!a.partnerId || !perm || permissionProblem(permissionState(perm), 'REACT_CLIPS', now))
        continue;
      const prod = await prisma.production.create({
        data: {
          kind: 'REACT',
          format: 'SHORT',
          partnerId: a.partnerId,
          sourceAssetId: a.id,
          status: 'QUEUED',
          step: 'na fila (produção diária)',
          title: `React: ${a.title}`.slice(0, 100),
          createdBy: DAILY_ACTOR,
        },
      });
      created.push({ id: prod.id, kind: 'REACT', format: 'SHORT', title: prod.title ?? '' });
      reactLeft -= 1;
    }
  }

  for (const c of created) await ctx.enqueueProduction(c.id);
  await audit(prisma, {
    actor: DAILY_ACTOR,
    action: 'pauta.daily',
    details: {
      created: created.map((c) => ({ id: c.id, kind: c.kind, format: c.format })),
      force: Boolean(opts.force),
    },
  });
  log.info({ created: created.length }, 'produção diária');
  return { created };
}

/** A rodada automática de hoje já aconteceu? (o botão "rodar agora" não conta) */
export async function ranToday(prisma: PrismaClient, now = new Date()): Promise<boolean> {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'pauta.daily', at: { gte: new Date(now.getTime() - 36 * 3_600_000) } },
    select: { at: true, details: true },
  });
  return rows.some(
    (r) =>
      channelDay(r.at) === channelDay(now) &&
      !(r.details as { force?: boolean } | null)?.force,
  );
}

/**
 * Já passou do horário de hoje (Brasília)? O agents confere a cada 5 min: se o notebook
 * estava dormindo no horário, a rodada acontece quando ele acorda (uma vez por dia).
 */
export function dailyDue(now: Date, time: string): boolean {
  return now.getTime() >= brasiliaInstant(channelDay(now), time).getTime();
}
