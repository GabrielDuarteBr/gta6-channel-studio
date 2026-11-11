import type { Prisma } from '@studio/db';
import { getAllSettings, getPrisma } from '@studio/db';
import { canPromoteStory } from '@studio/policy';
import { ExternalLink, Rss } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge, Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { researchStatus } from '@/server/research';
import { CollectNowButton, StoryActions } from './client-actions';

export const metadata: Metadata = { title: 'Pauta' };
export const dynamic = 'force-dynamic';

const PERIODS = { '24h': 24, '72h': 72, '7d': 168 } as const;
type Period = keyof typeof PERIODS;
const VIEWS = { pauta: 'Novas e na fila', fila: 'Na fila', descartadas: 'Descartadas' } as const;
type View = keyof typeof VIEWS;
const KINDS = {
  todas: 'Todas',
  oficiais: 'Oficiais',
  imprensa: 'Imprensa',
  rumores: 'Rumores',
} as const;
type Kind = keyof typeof KINDS;

const STATUS_LABEL: Record<string, string> = {
  QUEUED_LONG: 'Vídeo longo',
  QUEUED_SHORT: 'Short',
  QUEUED_COMPILATION: 'Compilado',
  DISMISSED: 'Descartada',
};
const TIER_LABEL: Record<string, string> = {
  OFFICIAL: 'oficial',
  PRESS: 'imprensa',
  COMMUNITY: 'comunidade',
};
const FLAG_LABEL: Record<string, string> = {
  leak: 'Vazamento',
  onlineCheats: 'Trapaça online',
  mods: 'Mods',
  spoilerRisk: 'Possível spoiler',
  cutscene: 'Cutscene',
  inGameEntertainment: 'Entretenimento in-game',
};

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function pick<T extends string>(
  value: string | undefined,
  options: Record<T, unknown>,
  fallback: T,
): T {
  return value && value in options ? (value as T) : fallback;
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-neon-pink bg-neon-pink/15 text-white'
          : 'border-night-700 text-haze-400 hover:text-white',
      )}
    >
      {children}
    </Link>
  );
}

export default async function PautaPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; ver?: string; tipo?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const period = pick<Period>(sp.periodo, PERIODS, '72h');
  const view = pick<View>(sp.ver, VIEWS, 'pauta');
  const kind = pick<Kind>(sp.tipo, KINDS, 'todas');
  const q = (sp.q ?? '').trim().slice(0, 80);
  const qs = (patch: Record<string, string>) => {
    const params = new URLSearchParams({
      periodo: period,
      ver: view,
      tipo: kind,
      ...(q ? { q } : {}),
      ...patch,
    });
    return `/pauta?${params.toString()}`;
  };

  const prisma = getPrisma();
  const since = new Date(Date.now() - PERIODS[period] * 3_600_000);
  const where: Prisma.StoryWhereInput = {
    lastSeenAt: { gte: since },
    ...(view === 'pauta' ? { status: { not: 'DISMISSED' } } : {}),
    ...(view === 'fila'
      ? { status: { in: ['QUEUED_LONG', 'QUEUED_SHORT', 'QUEUED_COMPILATION'] } }
      : {}),
    ...(view === 'descartadas' ? { status: 'DISMISSED' } : {}),
    ...(kind === 'oficiais' ? { officialCount: { gt: 0 } } : {}),
    ...(kind === 'rumores' ? { isRumor: true } : {}),
    ...(kind === 'imprensa' ? { officialCount: 0, isRumor: false } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { titlePt: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [stories, settings, status, sourceStats] = await Promise.all([
    prisma.story.findMany({
      where,
      orderBy: [{ score: 'desc' }, { lastSeenAt: 'desc' }],
      take: 60,
      include: {
        items: {
          orderBy: { publishedAt: 'asc' },
          take: 8,
          include: { source: { select: { name: true, tier: true } } },
        },
      },
    }),
    getAllSettings(prisma),
    researchStatus(),
    prisma.source.groupBy({ by: ['lastStatus'], where: { enabled: true }, _count: true }),
  ]);
  const okSources = sourceStats.find((s) => s.lastStatus === 'ok')?._count ?? 0;
  const errSources = sourceStats.find((s) => s.lastStatus === 'erro')?._count ?? 0;

  return (
    <>
      <PageHeader
        title="Pauta"
        subtitle="Notícias de GTA 6 coletadas das fontes, agrupadas por história e pontuadas. Fontes oficiais pesam mais; rumor só vira vídeo com 2 fontes independentes."
        actions={<CollectNowButton />}
      />

      <Card
        className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm"
        data-testid="estado-coleta"
      >
        <span className="text-haze-400">
          Última coleta:{' '}
          <span className="text-white">
            {status.lastRun?.finishedAt ? fmt.format(status.lastRun.finishedAt) : 'ainda não houve'}
          </span>
          {status.lastRun?.result?.newItems !== undefined
            ? ` · ${status.lastRun.result.newItems} itens novos`
            : ''}
          {status.lastRun?.status === 'FAILED' ? ' · falhou' : ''}
        </span>
        <span className="text-haze-400">
          {status.running ? 'Coletando agora…' : `Automática a cada ${status.intervalMinutes} min`}
        </span>
        <span className="text-haze-400">
          Fontes: <span className="text-palm">{okSources} ok</span>
          {errSources ? <span className="text-alert"> · {errSources} com erro</span> : null}
        </span>
        <Link
          href="/pauta/fontes"
          className="ml-auto inline-flex items-center gap-1 text-neon-cyan hover:underline"
        >
          <Rss className="size-4" /> Gerenciar fontes
        </Link>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <FilterLink key={v} href={qs({ ver: v })} active={view === v}>
            {VIEWS[v]}
          </FilterLink>
        ))}
        <span className="mx-1 h-4 w-px bg-night-700" />
        {(Object.keys(KINDS) as Kind[]).map((k) => (
          <FilterLink key={k} href={qs({ tipo: k })} active={kind === k}>
            {KINDS[k]}
          </FilterLink>
        ))}
        <span className="mx-1 h-4 w-px bg-night-700" />
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <FilterLink key={p} href={qs({ periodo: p })} active={period === p}>
            {p}
          </FilterLink>
        ))}
        <form action="/pauta" className="ml-auto">
          <input type="hidden" name="periodo" value={period} />
          <input type="hidden" name="ver" value={view} />
          <input type="hidden" name="tipo" value={kind} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar na pauta…"
            className="h-8 w-48 rounded-full border border-night-700 bg-night-900 px-3 text-xs text-white placeholder:text-haze-500 focus:border-neon-cyan focus:outline-none"
          />
        </form>
      </div>

      {stories.length === 0 ? (
        <Card className="text-center text-sm text-haze-400" data-testid="pauta-vazia">
          Nenhuma história neste filtro.{' '}
          {status.lastRun
            ? 'Tente outro período.'
            : 'Clique em "Coletar agora" para a primeira coleta.'}
        </Card>
      ) : (
        <ol className="space-y-3" data-testid="lista-pauta">
          {stories.map((s, index) => {
            const flags = (s.flags as Record<string, boolean> | null) ?? {};
            const decision = canPromoteStory(
              {
                flags,
                isRumor: s.isRumor,
                independentSources: s.independentSources,
                officialCount: s.officialCount,
              },
              settings.antiSpoiler,
            );
            const breakdown = s.scoreBreakdown as Record<string, number> | null;
            const activeFlags = Object.entries(flags)
              .filter(([, v]) => v)
              .map(([k]) => FLAG_LABEL[k] ?? k);
            return (
              <li key={s.id}>
                <Card className="flex gap-4" data-testid="historia">
                  <div className="flex w-14 shrink-0 flex-col items-center">
                    <span className="text-xs text-haze-500">#{index + 1}</span>
                    <span
                      className="font-display neon-text text-3xl leading-none"
                      title="Pontuação"
                    >
                      {s.score.toFixed(1)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.officialCount > 0 ? <Badge tone="ok">Oficial</Badge> : null}
                      {s.isRumor ? (
                        <Badge tone="warn">
                          Rumor · {s.independentSources} fonte{s.independentSources > 1 ? 's' : ''}
                        </Badge>
                      ) : null}
                      {!s.isRumor && s.officialCount === 0 ? (
                        <Badge tone="info">Imprensa</Badge>
                      ) : null}
                      {s.kind ? <Badge>{s.kind}</Badge> : null}
                      {activeFlags.map((f) => (
                        <Badge key={f} tone="error">
                          {f}
                        </Badge>
                      ))}
                      {STATUS_LABEL[s.status] ? (
                        <Badge tone="info">{STATUS_LABEL[s.status]}</Badge>
                      ) : null}
                      <span className="text-xs text-haze-500">
                        {s.independentSources} fonte{s.independentSources > 1 ? 's' : ''} · visto{' '}
                        {fmt.format(s.lastSeenAt)}
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-white">{s.titlePt ?? s.title}</h2>
                    {s.titlePt && s.titlePt !== s.title ? (
                      <p className="text-xs text-haze-500">{s.title}</p>
                    ) : null}
                    {s.summaryPt ? <p className="text-sm text-haze-300">{s.summaryPt}</p> : null}
                    <ul className="space-y-1 text-xs">
                      {s.items.map((it) => (
                        <li key={it.id} className="flex items-start gap-1.5 text-haze-400">
                          <ExternalLink className="mt-0.5 size-3 shrink-0" />
                          <span>
                            <span className="text-haze-300">{it.source.name}</span>{' '}
                            <span className="text-haze-500">({TIER_LABEL[it.source.tier]})</span> —{' '}
                            <a
                              href={it.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-neon-cyan hover:underline"
                            >
                              {it.title}
                            </a>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {breakdown ? (
                      <details className="text-xs text-haze-500">
                        <summary className="cursor-pointer hover:text-haze-300">
                          Por que esta nota?
                        </summary>
                        <p className="mt-1">
                          fontes {breakdown.sources} + oficial {breakdown.official} + corroboração{' '}
                          {breakdown.corroboration} + engajamento {breakdown.engagement} +
                          relevância {breakdown.newsworthiness}, × novidade {breakdown.recency} ×
                          penalidade {breakdown.penalty}
                        </p>
                      </details>
                    ) : null}
                    {decision.warnings.length ? (
                      <p className="text-xs text-haze-500">Avisos: {decision.warnings.join(' ')}</p>
                    ) : null}
                    <StoryActions
                      storyId={s.id}
                      status={s.status}
                      blockedReasons={decision.reasons}
                    />
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
