import { currentFx, getAllSettings, getPrisma } from '@studio/db';
import type { Metadata } from 'next';
import { LiveRefresh } from '@/components/live-refresh';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { listProductions, queuedStories, startedToday } from '@/server/production';
import { cancelProductionAction, retryProductionAction } from './actions';
import { ProduceForm } from './forms';

export const metadata: Metadata = { title: 'Produção' };
export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' | 'info' | 'muted' }> =
  {
    DRAFT: { label: 'rascunho', tone: 'muted' },
    QUEUED: { label: 'na fila', tone: 'info' },
    SCRIPTING: { label: 'roteiro', tone: 'warn' },
    ART: { label: 'imagens/cortes', tone: 'warn' },
    VOICE: { label: 'voz', tone: 'warn' },
    RENDERING: { label: 'render', tone: 'warn' },
    REVIEWING: { label: 'revisão', tone: 'warn' },
    READY: { label: 'pronto', tone: 'ok' },
    NEEDS_ATTENTION: { label: 'precisa de você', tone: 'error' },
    FAILED: { label: 'falhou', tone: 'error' },
    CANCELED: { label: 'cancelado', tone: 'muted' },
  };

interface Outputs {
  round?: number;
  video?: string;
  thumbnails?: string[];
  thumbnail?: string | null;
  durationSec?: number;
  /** React (Fase 4) */
  clipRatio?: number;
  commentRatio?: number;
  description?: string;
  monetization?: string;
  credit?: string;
  layout?: string;
  audioMode?: string;
}
interface Verdict {
  approved: boolean;
  summary: string;
  round: number;
  issues: Array<{ target?: string; index: number; severity: string; kind: string; detail: string }>;
}
interface RenderRound {
  round: number;
  video: { seconds: number; cpuSeconds?: number; peakMemoryMb?: number; frames: number };
  thumbnails: Array<{ seconds: number }>;
}
interface ScriptLine {
  id: number;
  kind: string;
  text: string;
  sourceIds: string[];
}

const media = (p: string) => `/api/media/${p}`;

/** Colunas do kanban: Ideia → Roteiro → Arte → Voz → Render → Revisão → Conformidade → Aprovação → Publicado. */
const KANBAN = [
  { id: 'fila', label: 'Na fila' },
  { id: 'roteiro', label: 'Roteiro' },
  { id: 'arte', label: 'Arte/cortes' },
  { id: 'voz', label: 'Voz' },
  { id: 'render', label: 'Render' },
  { id: 'revisao', label: 'Revisão' },
  { id: 'conformidade', label: 'Conformidade' },
  { id: 'aprovacao', label: 'Aprovação' },
  { id: 'agendado', label: 'Agendado/publicado' },
] as const;

function columnOf(p: {
  status: string;
  compliance: unknown;
  publication: { status: string } | null;
}): string | null {
  switch (p.status) {
    case 'QUEUED':
      return 'fila';
    case 'SCRIPTING':
      return 'roteiro';
    case 'ART':
      return 'arte';
    case 'VOICE':
      return 'voz';
    case 'RENDERING':
      return 'render';
    case 'REVIEWING':
      return 'revisao';
    case 'READY': {
      const pub = p.publication?.status;
      if (pub && !['CANCELED', 'FAILED'].includes(pub)) return 'agendado';
      const report = p.compliance as { ok?: boolean } | null;
      return report?.ok ? 'aprovacao' : 'conformidade';
    }
    default:
      return null;
  }
}

export default async function ProductionPage() {
  const prisma = getPrisma();
  const [stories, productions, settings, longToday, shortsToday, fx] = await Promise.all([
    queuedStories(),
    listProductions(),
    getAllSettings(prisma),
    startedToday('LONG'),
    startedToday('SHORT'),
    currentFx(prisma),
  ]);
  const itemIds = productions.flatMap((p) =>
    ((p.script as { lines?: ScriptLine[] } | null)?.lines ?? []).flatMap((l) => l.sourceIds),
  );
  const items = await prisma.newsItem.findMany({
    where: { id: { in: [...new Set(itemIds)] } },
    select: { id: true, url: true, source: { select: { name: true } } },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const limits = settings['limits.daily'];

  return (
    <>
      <PageHeader
        title="Produção"
        subtitle="Da Pauta ao vídeo: roteiro (Claude), imagens, voz do Zeca, render do longo 16:9 ou Short 9:16, 3 thumbnails e Revisor visual. Nada é publicado daqui."
        actions={
          <div className="flex items-center gap-3">
            <LiveRefresh src="/api/production/stream" />
            {settings['mode.simulation'] ? (
              <Badge tone="warn">Modo simulado: roteiro, imagens e voz de teste</Badge>
            ) : (
              <Badge tone="info">Modo real (custa)</Badge>
            )}
          </div>
        }
      />

      <Card className="mb-4">
        <CardTitle>Esteira</CardTitle>
        <div
          className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9"
          data-testid="kanban"
        >
          {KANBAN.map((col) => {
            const items = productions.filter((p) => columnOf(p) === col.id);
            return (
              <div
                key={col.id}
                className="rounded-lg border border-night-700 p-2"
                data-testid={`coluna-${col.id}`}
              >
                <p className="flex items-center justify-between text-xs font-semibold text-haze-300">
                  {col.label} <span className="text-haze-500">{items.length}</span>
                </p>
                <ul className="mt-1 space-y-1">
                  {items.slice(0, 4).map((p) => (
                    <li
                      key={p.id}
                      className="line-clamp-2 rounded bg-night-800 px-1.5 py-1 text-[11px] text-haze-200"
                    >
                      {p.title ?? 'vídeo'}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Na fila da Pauta</CardTitle>
          <span className="text-xs text-haze-400" data-testid="limite-diario">
            Hoje: {longToday} de {limits.long} longo(s) · {shortsToday} de {limits.shorts} Shorts
          </span>
        </div>
        <CardDescription>
          Histórias marcadas como &quot;virar longo&quot; ou &quot;virar Short&quot; na Pauta. A
          produção só começa (e só gasta) quando você clica em Produzir.
        </CardDescription>
        {stories.length === 0 ? (
          <p className="mt-3 text-sm text-haze-500">
            Nada na fila. Marque uma história na Pauta para virar vídeo.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-night-800" data-testid="fila-pauta">
            {stories.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">{s.titlePt ?? s.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <Badge tone="info">
                      {s.status === 'QUEUED_SHORT' ? 'Short 9:16' : 'Longo 16:9'}
                    </Badge>
                    {s.isRumor ? <Badge tone="warn">rumor</Badge> : null}
                    <Badge tone="muted">{s._count.items} fonte(s)</Badge>
                    {s.productions.length ? (
                      <Badge tone="muted">{s.productions.length} tentativa(s) anterior(es)</Badge>
                    ) : null}
                  </div>
                </div>
                <ProduceForm storyId={s.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4">
        <CardTitle>Vídeos</CardTitle>
        {productions.length === 0 ? (
          <p className="mt-3 text-sm text-haze-500">Nenhum vídeo produzido ainda.</p>
        ) : null}
        <ul className="mt-3 space-y-4" data-testid="lista-producoes">
          {productions.map((p) => {
            const status = STATUS[p.status] ?? { label: p.status, tone: 'muted' as const };
            const out = (p.outputs as Outputs | null) ?? {};
            const reviews = (p.review as Verdict[] | null) ?? [];
            const last = reviews.at(-1);
            const reports = (p.renderReport as RenderRound[] | null) ?? [];
            const lastReport = reports.at(-1);
            const plan = p.plan as { art?: { notes?: string[] } } | null;
            const lines = (p.script as { lines?: ScriptLine[] } | null)?.lines ?? [];
            const inProgress = ![
              'READY',
              'FAILED',
              'CANCELED',
              'NEEDS_ATTENTION',
              'DRAFT',
            ].includes(p.status);
            return (
              <li
                key={p.id}
                className="rounded-xl border border-night-700 p-4"
                data-testid="producao"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={status.tone} data-testid="status-producao">
                    {status.label}
                  </Badge>
                  <Badge tone="muted">{p.format === 'SHORT' ? 'Short 9:16' : 'Longo 16:9'}</Badge>
                  {p.kind === 'REACT' ? (
                    <Badge tone="info" data-testid="tipo-react">
                      react · {p.partner?.name ?? 'parceiro'}
                    </Badge>
                  ) : null}
                  {p.story?.isRumor ? <Badge tone="warn">rumor</Badge> : null}
                  <span className="text-xs text-haze-500">
                    {fmt.format(p.createdAt)} · custo {fx.formatUsd(p.costUsd)}
                    {p.reviewRound ? ` · ${p.reviewRound} volta(s) de revisão` : ''}
                  </span>
                </div>
                <p className="mt-2 font-medium text-white">
                  {p.title ??
                    p.story?.titlePt ??
                    p.story?.title ??
                    p.sourceAsset?.title ??
                    'Short de react'}
                </p>
                {p.step ? <p className="text-xs text-haze-400">{p.step}</p> : null}
                {p.error ? (
                  <p className="text-xs text-alert" data-testid="erro-producao">
                    {p.error}
                  </p>
                ) : null}

                {out.video ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <video
                      controls
                      preload="metadata"
                      className={`w-full rounded-lg bg-black ${p.format === 'SHORT' ? 'mx-auto max-h-[520px] w-auto' : ''}`}
                      src={media(out.video)}
                      data-testid="video-producao"
                    />
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2" data-testid="thumbnails">
                        {(out.thumbnails ?? []).map((t) => (
                          // eslint-disable-next-line @next/next/no-img-element -- arquivo privado da pasta de trabalho
                          <img
                            key={t}
                            src={media(t)}
                            alt="Opção de thumbnail"
                            className={`aspect-video w-full rounded-md object-cover ${t === out.thumbnail ? 'ring-2 ring-palm' : 'opacity-70'}`}
                          />
                        ))}
                      </div>
                      {out.thumbnail ? (
                        <p className="text-xs text-palm">
                          Thumbnail escolhida pelo Revisor em destaque.
                        </p>
                      ) : null}
                      {p.kind === 'REACT' && out.clipRatio !== undefined ? (
                        <div className="space-y-1 text-xs" data-testid="dados-react">
                          <p className="text-haze-300">
                            Clipe do parceiro:{' '}
                            <strong className="text-white">
                              {Math.round(out.clipRatio * 100)}%
                            </strong>{' '}
                            · comentário do Zeca:{' '}
                            <strong className="text-white">
                              {Math.round((out.commentRatio ?? 0) * 100)}%
                            </strong>{' '}
                            · layout {out.layout} ·{' '}
                            {out.audioMode === 'full'
                              ? 'áudio original inteiro'
                              : 'só a voz do parceiro'}
                          </p>
                          <p
                            className={out.monetization === 'allowed' ? 'text-palm' : 'text-sunset'}
                          >
                            {out.monetization === 'allowed'
                              ? 'O parceiro permite monetizar.'
                              : 'O parceiro NÃO permite monetizar este Short.'}
                          </p>
                          {out.description ? (
                            <details>
                              <summary className="cursor-pointer text-haze-300">
                                Descrição (com crédito: {out.credit})
                              </summary>
                              <pre
                                className="mt-1 whitespace-pre-wrap rounded bg-night-900 p-2 text-haze-300"
                                data-testid="descricao-react"
                              >
                                {out.description}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      ) : null}
                      {last ? (
                        <div className="rounded-lg bg-night-900 p-2 text-xs" data-testid="revisao">
                          <p className={last.approved ? 'text-palm' : 'text-alert'}>
                            Revisor (volta {last.round}): {last.approved ? 'aprovado' : 'reprovado'}{' '}
                            — {last.summary}
                          </p>
                          {last.issues.length ? (
                            <ul className="mt-1 list-disc pl-4 text-haze-400">
                              {last.issues.map((i, k) => (
                                <li key={k}>
                                  {i.target === 'thumbnail'
                                    ? `thumbnail ${i.index}`
                                    : `quadro ${i.index}`}{' '}
                                  · {i.severity} · {i.detail}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                      {lastReport ? (
                        <p className="text-xs text-haze-400" data-testid="relatorio-render">
                          Render: {lastReport.video.seconds.toFixed(0)} s ({lastReport.video.frames}{' '}
                          quadros)
                          {lastReport.video.cpuSeconds !== undefined
                            ? ` · CPU ${lastReport.video.cpuSeconds.toFixed(0)} s (~${(lastReport.video.cpuSeconds / Math.max(0.1, lastReport.video.seconds)).toFixed(1)} núcleo) · pico ${lastReport.video.peakMemoryMb} MB · na VPS ~${lastReport.video.seconds.toFixed(0)} a ${(lastReport.video.seconds * 1.4).toFixed(0)} s (estimativa)`
                            : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {plan?.art?.notes?.length ? (
                  <ul className="mt-2 list-disc pl-5 text-xs text-sunset">
                    {plan.art.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}

                {lines.length ? (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-haze-300">
                      Roteiro ({lines.length} falas)
                    </summary>
                    <ol className="mt-2 space-y-1 text-haze-400">
                      {lines.map((l) => (
                        <li key={l.id}>
                          <span className="text-haze-500">[{l.kind}]</span> {l.text}
                          {l.sourceIds.length ? (
                            <span className="text-neon-cyan">
                              {' '}
                              —{' '}
                              {l.sourceIds
                                .map((id) => itemById.get(id)?.source.name ?? id)
                                .join(', ')}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {['FAILED', 'NEEDS_ATTENTION'].includes(p.status) ? (
                    <form action={retryProductionAction}>
                      <input type="hidden" name="productionId" value={p.id} />
                      <button
                        type="submit"
                        className="rounded-full border border-night-600 px-3 py-1 text-xs text-haze-300 hover:bg-night-800"
                      >
                        Tentar de novo
                      </button>
                    </form>
                  ) : null}
                  {inProgress ? (
                    <form action={cancelProductionAction}>
                      <input type="hidden" name="productionId" value={p.id} />
                      <button
                        type="submit"
                        className="rounded-full border border-night-600 px-3 py-1 text-xs text-haze-300 hover:bg-night-800"
                      >
                        Cancelar
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
