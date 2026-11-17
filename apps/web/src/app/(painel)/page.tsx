import { formatBrl } from '@studio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ZecaPlaceholder } from '@/components/zeca-placeholder';
import { BarList, LineChart } from '@/components/charts';
import { effectiveState } from '@/server/effective';
import { overviewMetrics } from '@/server/metrics';

export const metadata: Metadata = { title: 'Visão geral' };
export const dynamic = 'force-dynamic';

const full = new Intl.NumberFormat('pt-BR');

export default async function OverviewPage() {
  const [{ settings, profileInfo }, m] = await Promise.all([effectiveState(), overviewMetrics()]);
  const identity = settings['channel.identity'];
  const limits = settings['limits.daily'];
  const budget = settings.budget;

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle="Números do canal (YouTube Analytics, últimos 28 dias), o que espera você e o gasto do mês em reais."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="indicadores">
        {[
          { label: 'Visualizações (28 d)', value: full.format(m.totals.views) },
          { label: 'Horas assistidas', value: full.format(Math.round(m.totals.minutes / 60)) },
          {
            label: 'Inscritos (saldo)',
            value: `${m.totals.subsNet >= 0 ? '+' : ''}${full.format(m.totals.subsNet)}`,
          },
          { label: 'Esperando aprovação', value: String(m.awaiting), href: '/aprovacao' },
          { label: 'Gasto no mês', value: m.monthCost, href: '/saude' },
        ].map((t) => (
          <Card key={t.label} className="p-4">
            <p className="text-xs text-haze-400">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {t.href ? (
                <Link href={t.href} className="hover:underline">
                  {t.value}
                </Link>
              ) : (
                t.value
              )}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="relative overflow-hidden lg:col-span-2">
          <div className="flex items-center gap-5">
            <ZecaPlaceholder className="size-28 shrink-0" />
            <div>
              <p className="font-display text-3xl text-white">{identity.channelName}</p>
              <p className="text-sm text-haze-400">
                Apresentado por <span className="text-neon-cyan">{identity.characterName}</span> ·{' '}
                {identity.language}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="warn">Arte provisória</Badge>
                <Badge tone={settings['mode.simulation'] ? 'warn' : 'error'}>
                  {settings['mode.simulation'] ? 'Modo simulado' : 'Modo real'}
                </Badge>
                <Badge tone="info">{profileInfo.label}</Badge>
                <Badge tone={settings['mode.autopilot'] ? 'error' : 'muted'}>
                  Piloto automático {settings['mode.autopilot'] ? 'ligado' : 'desligado'}
                </Badge>
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <CardTitle>Limites e orçamento</CardTitle>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-haze-400">Vídeos longos por dia</dt>
              <dd className="font-semibold text-white">{limits.long}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-haze-400">Shorts por dia</dt>
              <dd className="font-semibold text-white">{limits.shorts}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-haze-400">Teto mensal de APIs</dt>
              <dd className="font-semibold text-white">{formatBrl(budget.monthlyBrl)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-haze-400">Teto diário</dt>
              <dd className="font-semibold text-white">{formatBrl(budget.dailyBrl)}</dd>
            </div>
          </dl>
          <Link
            href="/configuracoes"
            className="mt-4 inline-block text-sm text-neon-cyan hover:underline"
          >
            Ajustar em Configurações →
          </Link>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="grafico-views">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Visualizações por dia</CardTitle>
            {m.simulated ? <Badge tone="warn">inclui dados simulados</Badge> : null}
          </div>
          {m.hasData ? (
            <div className="mt-3">
              <LineChart data={m.series} label="Visualizações por dia nos últimos 28 dias" />
            </div>
          ) : (
            <CardDescription>
              Sem métricas ainda. Conecte o canal em{' '}
              <Link href="/configuracoes#youtube" className="underline">
                Configurações → YouTube
              </Link>
              ; a sincronização roda a cada 3 horas (o YouTube Analytics atrasa 1 a 2 dias).
            </CardDescription>
          )}
        </Card>
        <Card>
          <CardTitle>Por formato</CardTitle>
          <CardDescription>Visualizações dos vídeos enviados pelo estúdio.</CardDescription>
          <div className="mt-3">
            {m.byFormat.length ? (
              <BarList
                testId="por-formato"
                rows={m.byFormat.map((f) => ({
                  label: f.label,
                  value: f.views,
                  note: `${f.videos} vídeo(s)`,
                }))}
              />
            ) : (
              <p className="text-sm text-haze-500">Nenhum vídeo publicado ainda.</p>
            )}
          </div>
          <CardTitle className="mt-5">Por parceiro (reacts)</CardTitle>
          <div className="mt-3">
            {m.byPartner.length ? (
              <BarList
                testId="por-parceiro"
                rows={m.byPartner.map((f) => ({
                  label: f.label,
                  value: f.views,
                  note: `${f.videos} react(s)`,
                }))}
              />
            ) : (
              <p className="text-sm text-haze-500">Nenhum react publicado ainda.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Mais vistos</CardTitle>
          {m.top.length ? (
            <ol className="mt-3 space-y-2 text-sm" data-testid="top-videos">
              {m.top.map((v, i) => (
                <li key={`${v.title}-${i}`} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-haze-200">
                    {i + 1}. {v.title} <span className="text-xs text-haze-500">· {v.label}</span>
                  </span>
                  <span className="shrink-0 font-semibold text-white">{full.format(v.views)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-haze-500">Nada publicado ainda.</p>
          )}
        </Card>
        <Card>
          <CardTitle>Próximos 7 dias</CardTitle>
          <CardDescription>
            {m.upcoming} publicação(ões) marcada(s).{' '}
            <Link href="/calendario" className="underline">
              Abrir o Calendário
            </Link>{' '}
            ·{' '}
            <Link href="/comando" className="underline">
              Falar com o Diretor
            </Link>
          </CardDescription>
          <p className="mt-3 text-xs text-haze-500">
            Produção diária:{' '}
            {settings['schedule.daily'].enabled
              ? `ligada, às ${settings['schedule.daily'].time} (Brasília)`
              : 'desligada'}
            . Tudo passa pela Conformidade e pela sua aprovação
            {settings['mode.autopilot'] ? ' (piloto automático LIGADO)' : ''}.
          </p>
        </Card>
      </div>
    </>
  );
}
