import { currentFx, getPrisma } from '@studio/db';
import { channelDay, channelMonth } from '@studio/shared';

/** Números da Visão geral (Fase 6): canal, por formato, por parceiro e custos em reais. */
export async function overviewMetrics(now = new Date()) {
  const prisma = getPrisma();
  const since = new Date(now.getTime() - 28 * 86_400_000).toISOString().slice(0, 10);
  const [days, pubs, fx, monthCost, awaiting, upcoming] = await Promise.all([
    prisma.channelStat.findMany({ where: { day: { gte: since } }, orderBy: { day: 'asc' } }),
    prisma.publication.findMany({
      where: { youtubeVideoId: { not: null }, status: { in: ['SCHEDULED', 'PUBLISHED'] } },
      select: {
        youtubeVideoId: true,
        title: true,
        simulated: true,
        production: {
          select: { id: true, kind: true, format: true, partner: { select: { name: true } } },
        },
      },
    }),
    currentFx(prisma),
    prisma.costLedger.aggregate({
      _sum: { costUsd: true },
      where: { dayKey: { startsWith: channelMonth(now) }, simulated: false },
    }),
    prisma.production.count({
      where: {
        status: 'READY',
        OR: [{ publication: null }, { publication: { status: { in: ['CANCELED', 'FAILED'] } } }],
      },
    }),
    prisma.publication.count({
      where: {
        status: { in: ['QUEUED', 'UPLOADING', 'SCHEDULED', 'MANUAL'] },
        publishAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) },
      },
    }),
  ]);

  // Último número de cada vídeo (VideoStat guarda um retrato por dia).
  const ids = pubs.map((p) => p.youtubeVideoId!).filter(Boolean);
  const stats = ids.length
    ? await prisma.videoStat.findMany({
        where: { youtubeVideoId: { in: ids } },
        orderBy: { day: 'desc' },
      })
    : [];
  const latest = new Map<string, (typeof stats)[number]>();
  for (const s of stats) if (!latest.has(s.youtubeVideoId)) latest.set(s.youtubeVideoId, s);

  const byFormat = new Map<string, { views: number; videos: number }>();
  const byPartner = new Map<string, { views: number; videos: number }>();
  const top: Array<{ title: string; views: number; likes: number; label: string }> = [];
  for (const p of pubs) {
    const s = latest.get(p.youtubeVideoId!);
    const views = s?.views ?? 0;
    const label =
      p.production.kind === 'REACT'
        ? 'React'
        : p.production.format === 'LONG'
          ? 'Longo de notícia'
          : 'Short de notícia';
    const f = byFormat.get(label) ?? { views: 0, videos: 0 };
    byFormat.set(label, { views: f.views + views, videos: f.videos + 1 });
    if (p.production.kind === 'REACT') {
      const name = p.production.partner?.name ?? 'parceiro';
      const q = byPartner.get(name) ?? { views: 0, videos: 0 };
      byPartner.set(name, { views: q.views + views, videos: q.videos + 1 });
    }
    top.push({ title: p.title, views, likes: s?.likes ?? 0, label });
  }

  // Série diária completa (dias sem dado = 0), para o gráfico não pular datas.
  const series: Array<{ day: string; views: number }> = [];
  const byDay = new Map(days.map((d) => [d.day, d.views]));
  for (let i = 27; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ day: d, views: byDay.get(d) ?? 0 });
  }
  const sum = (k: 'views' | 'minutesWatched' | 'subscribersGained' | 'subscribersLost') =>
    days.reduce((n, d) => n + d[k], 0);
  const monthUsd = Number(monthCost._sum.costUsd ?? 0);
  return {
    hasData: days.length > 0,
    simulated: days.some((d) => d.simulated) || pubs.some((p) => p.simulated),
    series,
    totals: {
      views: sum('views'),
      minutes: sum('minutesWatched'),
      subsNet: sum('subscribersGained') - sum('subscribersLost'),
    },
    byFormat: [...byFormat.entries()].map(([label, v]) => ({ label, ...v })),
    byPartner: [...byPartner.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 6),
    top: top.sort((a, b) => b.views - a.views).slice(0, 5),
    monthCost: fx.formatUsd(monthUsd),
    videosThisMonth: pubs.length,
    awaiting,
    upcoming,
    today: channelDay(now),
  };
}
