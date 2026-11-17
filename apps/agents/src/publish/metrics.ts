import { audit, type PrismaClient } from '@studio/db';
import type { YouTubePublisher } from '@studio/providers';
import { channelDay, type Logger } from '@studio/shared';

/**
 * Métricas (Fase 6): todo dia (e pelo botão) busca no YouTube Analytics os números do canal dos
 * últimos 28 dias e, na Data API, os números de cada vídeo enviado pelo estúdio. Também confere
 * se os agendados já foram publicados (sem a auditoria do Google, ficam travados como privados).
 */

export interface MetricsContext {
  prisma: PrismaClient;
  log: Logger;
  publisher: () => Promise<YouTubePublisher>;
  now?: () => Date;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function runMetricsSync(ctx: MetricsContext) {
  const { prisma, log } = ctx;
  const now = ctx.now?.() ?? new Date();
  const yt = await ctx.publisher();
  const end = day(now);
  const start = day(new Date(now.getTime() - 28 * 86_400_000));

  const rows = await yt.analytics({
    startDate: start,
    endDate: end,
    metrics: [
      'views',
      'estimatedMinutesWatched',
      'subscribersGained',
      'subscribersLost',
      'likes',
      'comments',
    ],
    dimensions: ['day'],
    sort: 'day',
  });
  for (const r of rows) {
    const data = {
      views: Number(r.views ?? 0),
      minutesWatched: Math.round(Number(r.estimatedMinutesWatched ?? 0)),
      subscribersGained: Number(r.subscribersGained ?? 0),
      subscribersLost: Number(r.subscribersLost ?? 0),
      likes: Number(r.likes ?? 0),
      comments: Number(r.comments ?? 0),
    };
    await prisma.channelStat.upsert({
      where: { day: String(r.day) },
      create: { day: String(r.day), ...data },
      update: data,
    });
  }

  const pubs = await prisma.publication.findMany({
    where: {
      youtubeVideoId: { not: null },
      simulated: false,
      status: { in: ['SCHEDULED', 'PUBLISHED'] },
    },
    select: { id: true, youtubeVideoId: true, status: true, publishAt: true },
  });
  const ids = pubs.map((p) => p.youtubeVideoId!).filter(Boolean);
  const today = channelDay(now);
  let videos = 0;
  let published = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const stats = await yt.videos(batch);
    const watch = new Map<string, { minutes: number; avg: number }>();
    try {
      const per = await yt.analytics({
        startDate: start,
        endDate: end,
        metrics: ['estimatedMinutesWatched', 'averageViewDuration'],
        dimensions: ['video'],
        filters: `video==${batch.join(',')}`,
        maxResults: 50,
      });
      for (const r of per) {
        watch.set(String(r.video), {
          minutes: Math.round(Number(r.estimatedMinutesWatched ?? 0)),
          avg: Math.round(Number(r.averageViewDuration ?? 0)),
        });
      }
    } catch (err) {
      log.warn({ err }, 'Analytics por vídeo indisponível');
    }
    for (const v of stats) {
      const w = watch.get(v.id);
      const data = {
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        minutesWatched: w?.minutes ?? 0,
        averageViewSeconds: w?.avg ?? 0,
      };
      await prisma.videoStat.upsert({
        where: { youtubeVideoId_day: { youtubeVideoId: v.id, day: today } },
        create: { youtubeVideoId: v.id, day: today, ...data },
        update: data,
      });
      videos += 1;
      const pub = pubs.find((p) => p.youtubeVideoId === v.id);
      if (pub?.status === 'SCHEDULED' && v.privacyStatus === 'public') {
        await prisma.publication.update({
          where: { id: pub.id },
          data: { status: 'PUBLISHED', publishedAt: pub.publishAt, step: null },
        });
        published += 1;
      } else if (
        pub?.status === 'SCHEDULED' &&
        pub.publishAt < now &&
        v.privacyStatus === 'private'
      ) {
        await prisma.publication.update({
          where: { id: pub.id },
          data: {
            step: 'A hora passou e o vídeo continua privado: sem a auditoria do Google, envios pela API ficam travados. Publique pelo YouTube Studio.',
          },
        });
      }
    }
  }
  await audit(prisma, {
    actor: 'agent:analista',
    action: 'metrics.sync',
    details: { days: rows.length, videos, published },
  });
  log.info({ days: rows.length, videos, published }, 'métricas do canal');
  return { days: rows.length, videos, published };
}

/**
 * Modo simulado: um envio "agendado" vira "publicado (simulado)" quando chega a hora, para o
 * Calendário e a Visão geral mostrarem o ciclo inteiro sem tocar no YouTube.
 */
export async function settleSimulated(prisma: PrismaClient, now = new Date()): Promise<number> {
  const due = await prisma.publication.findMany({
    where: { simulated: true, status: 'SCHEDULED', publishAt: { lte: now } },
    select: { id: true, publishAt: true },
  });
  for (const p of due) {
    await prisma.publication.update({
      where: { id: p.id },
      data: { status: 'PUBLISHED', publishedAt: p.publishAt, step: 'publicado (simulado)' },
    });
  }
  return due.length;
}
