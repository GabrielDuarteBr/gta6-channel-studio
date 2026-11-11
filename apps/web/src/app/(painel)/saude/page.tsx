import { getPrisma } from '@studio/db';
import { channelDay, youtubeQuotaDay } from '@studio/shared';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { effectiveState } from '@/server/effective';
import { checkAll } from '@/server/health';
import { researchStatus } from '@/server/research';

export const metadata: Metadata = { title: 'Saúde e custos' };

const fmtTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'America/Sao_Paulo',
});

export default async function HealthPage() {
  const prisma = getPrisma();
  const today = channelDay();
  const [checks, audit, costToday, quotaToday, state, research] = await Promise.all([
    checkAll(),
    prisma.auditLog.findMany({ orderBy: { at: 'desc' }, take: 25 }),
    prisma.costLedger.aggregate({ _sum: { costUsd: true }, where: { dayKey: today } }),
    prisma.quotaLedger.groupBy({
      by: ['bucket'],
      _sum: { units: true },
      where: { pacificDay: youtubeQuotaDay() },
    }),
    effectiveState(),
    researchStatus(),
  ]);
  const spentToday = Number(costToday._sum.costUsd ?? 0);
  const quotaUnits = quotaToday.find((q) => q.bucket === 'default')?._sum.units ?? 0;
  const searchCalls = quotaToday.find((q) => q.bucket === 'search.list')?._sum.units ?? 0;
  const allOk = checks.every((c) => c.status === 'ok');

  return (
    <>
      <PageHeader
        title="Saúde e custos"
        subtitle="Estado dos serviços, gastos do dia, cota do YouTube e trilha de auditoria."
        actions={<Badge tone={allOk ? 'ok' : 'error'}>{allOk ? 'Tudo operando' : 'Atenção'}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Serviços</CardTitle>
          <ul className="mt-3 divide-y divide-night-800" data-testid="lista-servicos">
            {checks.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="text-white">{c.label}</span>
                <span className="flex items-center gap-3">
                  {c.detail ? (
                    <span className="hidden text-xs text-haze-500 sm:inline">{c.detail}</span>
                  ) : null}
                  <span className="text-xs text-haze-500">{c.latencyMs} ms</span>
                  <Badge tone={c.status === 'ok' ? 'ok' : 'error'} data-testid={`status-${c.name}`}>
                    {c.status === 'ok' ? 'ok' : 'fora do ar'}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Hoje</CardTitle>
          <CardDescription>Dia operacional {today} (Brasília).</CardDescription>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-haze-400">Gasto com APIs</dt>
              <dd className="font-semibold text-white">
                US$ {spentToday.toFixed(2)} / {state.settings.budget.dailyUsd.toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-haze-400">Cota YouTube (dia do Pacífico)</dt>
              <dd className="text-right font-semibold text-white" data-testid="cota-youtube">
                {quotaUnits} unid. · {searchCalls} buscas
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-haze-400">Coleta de notícias</dt>
              <dd className="text-right text-white" data-testid="coleta-saude">
                {research.lastRun?.finishedAt
                  ? `${research.lastRun.status === 'SUCCEEDED' ? 'ok' : 'falhou'} às ${new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(research.lastRun.finishedAt)}`
                  : 'ainda não rodou'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-haze-400">Token do Google</dt>
              <dd className="text-haze-500">não conectado (Fase 5)</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-haze-400">Último backup</dt>
              <dd className="text-haze-500">— (Fase 8)</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>Auditoria</CardTitle>
        <CardDescription>Últimas 25 ações do dono, dos agentes e do sistema.</CardDescription>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-haze-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Quando</th>
                <th className="py-2 pr-3 font-medium">Quem</th>
                <th className="py-2 pr-3 font-medium">Ação</th>
                <th className="py-2 pr-3 font-medium">Alvo</th>
                <th className="py-2 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3 whitespace-nowrap text-haze-400">
                    {fmtTime.format(a.at)}
                  </td>
                  <td className="py-2 pr-3 text-haze-300">{a.actor}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-white">{a.action}</td>
                  <td className="py-2 pr-3 text-haze-400">{a.target ?? '—'}</td>
                  <td className="py-2">
                    <Badge
                      tone={a.outcome === 'OK' ? 'ok' : a.outcome === 'DENIED' ? 'warn' : 'error'}
                    >
                      {a.outcome}
                    </Badge>
                  </td>
                </tr>
              ))}
              {audit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-haze-500">
                    Nada registrado ainda.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
