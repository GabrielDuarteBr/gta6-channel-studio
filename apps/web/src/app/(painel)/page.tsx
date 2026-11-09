import { CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ZecaPlaceholder } from '@/components/zeca-placeholder';
import { effectiveState } from '@/server/effective';

export const metadata: Metadata = { title: 'Visão geral' };

const PHASES = [
  {
    n: 0,
    name: 'Fundação',
    desc: 'Monorepo, painel com 2FA, Compose, CI, perfil notebook, modo simulado.',
  },
  { n: 1, name: 'Pesquisa', desc: 'Pesquisador (RSS, Reddit, YouTube metadados) e tela de Pauta.' },
  {
    n: 2,
    name: 'Personagem',
    desc: 'Zeca Neon animado: voz, sincronia labial, expressões (Rive × camadas).',
  },
  {
    n: 3,
    name: 'Notícias em vídeo',
    desc: 'Roteiro, arte, edição, thumbnails, Revisor visual e Biblioteca.',
  },
  { n: 4, name: 'Parceiros e react', desc: 'Caçador de parceiros, permissões, Shorts de react.' },
  {
    n: 5,
    name: 'Conformidade e publicação',
    desc: 'Conformidade, upload, OAuth, cota e auditoria da API.',
  },
  { n: 6, name: 'Métricas', desc: 'Analista e gráficos do canal.' },
  {
    n: 7,
    name: 'Comando e autonomia',
    desc: 'Chat com o Diretor, agendamentos e piloto automático.',
  },
  { n: 8, name: 'Produção na VPS', desc: 'Deploy, HTTPS, backups, monitoramento e alertas.' },
];
const CURRENT_PHASE = 0;

export default async function OverviewPage() {
  const { settings, profileInfo } = await effectiveState();
  const identity = settings['channel.identity'];
  const limits = settings['limits.daily'];
  const budget = settings.budget;

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle="As métricas do canal aparecem aqui a partir da Fase 6. Por enquanto, o estado do estúdio e o roteiro de construção."
      />

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
              <dd className="font-semibold text-white">US$ {budget.monthlyUsd.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-haze-400">Teto diário</dt>
              <dd className="font-semibold text-white">US$ {budget.dailyUsd.toFixed(2)}</dd>
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

      <Card className="mt-4">
        <CardTitle>Construção por fases</CardTitle>
        <CardDescription>
          Cada fase só avança quando os critérios de aceite passam no notebook.
        </CardDescription>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PHASES.map((p) => {
            const state = p.n < CURRENT_PHASE ? 'done' : p.n === CURRENT_PHASE ? 'current' : 'todo';
            return (
              <li
                key={p.n}
                className={
                  state === 'current'
                    ? 'rounded-xl border border-neon-pink/50 bg-neon-pink/10 p-3'
                    : 'rounded-xl border border-night-700 bg-night-950/40 p-3'
                }
              >
                <div className="flex items-center gap-2">
                  {state === 'done' ? (
                    <CheckCircle2 className="size-4 text-palm" />
                  ) : state === 'current' ? (
                    <Loader2 className="size-4 animate-spin text-neon-pink" />
                  ) : (
                    <CircleDashed className="size-4 text-haze-500" />
                  )}
                  <span className="text-sm font-semibold text-white">
                    Fase {p.n} · {p.name}
                  </span>
                </div>
                <p className="mt-1 text-xs text-haze-400">{p.desc}</p>
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}
