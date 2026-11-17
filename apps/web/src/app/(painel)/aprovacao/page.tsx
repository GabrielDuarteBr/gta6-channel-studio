import { getAllSettings, getPrisma } from '@studio/db';
import type { ComplianceReport } from '@studio/policy';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { PUB_STATUS } from '@/lib/publication';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import {
  approvalQueue,
  listPublications,
  suggestedSlot,
  youtubeReady,
  type ProductionMetadata,
} from '@/server/publish';
import { recheckAction } from './actions';
import {
  ApproveForm,
  CancelPublicationForm,
  ManualUploadedForm,
  MetadataForm,
  RejectForm,
  RetryUploadForm,
} from './forms';

export const metadata: Metadata = { title: 'Aprovação' };
export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/** Valor do <input type="datetime-local"> em Brasília (UTC−3). */
function localValue(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 16);
}

const media = (p: string, download?: string) =>
  `/api/media/${p}${download ? `?baixar=${download}` : ''}`;

interface Outputs {
  video?: string;
  thumbnail?: string | null;
  durationSec?: number;
}

export default async function ApprovalPage() {
  const prisma = getPrisma();
  const [queue, pubs, settings, slot, yt] = await Promise.all([
    approvalQueue(),
    listPublications({ from: new Date(Date.now() - 14 * 86_400_000), take: 40 }),
    getAllSettings(prisma),
    suggestedSlot(),
    youtubeReady(),
  ]);
  const simulated = settings['mode.simulation'];
  const modeHint = simulated
    ? 'Modo simulado: o envio é simulado, nada sai do computador.'
    : yt.connected
      ? `Sobe PRIVADO no canal ${yt.conn?.channelTitle ?? ''}, agendado, com a marca de conteúdo sintético. Sem a auditoria do Google, o YouTube mantém privado: publique no Studio.`
      : 'YouTube não conectado: aprovar gera um pacote para você enviar pelo YouTube Studio.';
  const visible = pubs.filter((p) => p.status !== 'CANCELED').reverse();

  return (
    <>
      <PageHeader
        title="Aprovação"
        subtitle="Nada fica público sem você. Confira o vídeo, o relatório da Conformidade, título e descrição, e escolha a data. O envio é sempre privado e agendado."
        actions={
          simulated ? (
            <Badge tone="warn">Modo simulado</Badge>
          ) : yt.connected ? (
            <Badge tone="ok">YouTube: {yt.conn?.channelTitle}</Badge>
          ) : (
            <Badge tone="warn">YouTube não conectado (pacote manual)</Badge>
          )
        }
      />

      <Card>
        <CardTitle>Esperando você</CardTitle>
        <CardDescription>
          Vídeos prontos (Revisor visual aprovou). A Conformidade confere direitos, fontes, rumor,
          regra do react, aviso de IA, spoiler e limites do YouTube.
        </CardDescription>
        {queue.length === 0 ? (
          <p className="mt-3 text-sm text-haze-500" data-testid="aprovacao-vazia">
            Nada esperando aprovação.
          </p>
        ) : null}
        <ul className="mt-3 space-y-5" data-testid="fila-aprovacao">
          {queue.map((p) => {
            const out = (p.outputs as Outputs | null) ?? {};
            const report = p.compliance as ComplianceReport | null;
            const meta = p.metadata as ProductionMetadata | null;
            return (
              <li
                key={p.id}
                className="rounded-xl border border-night-700 p-4"
                data-testid="item-aprovacao"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="muted">{p.format === 'SHORT' ? 'Short 9:16' : 'Longo 16:9'}</Badge>
                  {p.kind === 'REACT' ? <Badge tone="info">react · {p.partner?.name}</Badge> : null}
                  {p.story?.isRumor ? <Badge tone="warn">rumor</Badge> : null}
                  {report ? (
                    <Badge tone={report.ok ? 'ok' : 'error'} data-testid="conformidade-status">
                      Conformidade: {report.ok ? 'aprovada' : 'reprovada'}
                    </Badge>
                  ) : (
                    <Badge tone="info" data-testid="conformidade-status">
                      Conformidade conferindo…
                    </Badge>
                  )}
                  {p.publication?.status === 'FAILED' ? (
                    <Badge tone="error">envio anterior falhou: {p.publication.error}</Badge>
                  ) : null}
                </div>
                <p className="mt-2 font-medium text-white">{meta?.title ?? p.title}</p>

                <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                  <div className="space-y-3">
                    {out.video ? (
                      <video
                        controls
                        preload="metadata"
                        className={`w-full rounded-lg bg-black ${p.format === 'SHORT' ? 'mx-auto max-h-[480px] w-auto' : ''}`}
                        src={media(out.video)}
                      />
                    ) : null}
                    {out.thumbnail && p.format === 'LONG' ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arquivo privado da pasta de trabalho
                      <img
                        src={media(out.thumbnail)}
                        alt="Thumbnail escolhida"
                        className="aspect-video w-48 rounded-md object-cover"
                      />
                    ) : null}
                    {report ? (
                      <ul className="space-y-1 text-xs" data-testid="relatorio-conformidade">
                        {report.checks.map((c) => (
                          <li
                            key={c.id}
                            className={
                              c.ok
                                ? 'text-haze-400'
                                : c.severity === 'block'
                                  ? 'text-alert'
                                  : 'text-sunset'
                            }
                          >
                            {c.ok ? '✓' : c.severity === 'block' ? '✗' : '!'} {c.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <form action={recheckAction}>
                      <input type="hidden" name="productionId" value={p.id} />
                      <button
                        type="submit"
                        className="text-xs text-haze-400 underline hover:text-white"
                      >
                        Conferir de novo
                      </button>
                    </form>
                  </div>
                  <div className="space-y-4">
                    {meta ? (
                      <MetadataForm
                        productionId={p.id}
                        title={meta.title}
                        description={meta.description}
                        tags={meta.tags}
                      />
                    ) : (
                      <p className="text-xs text-haze-500">Montando título e descrição…</p>
                    )}
                    <ApproveForm
                      productionId={p.id}
                      defaultAt={localValue(slot)}
                      disabled={!report?.ok}
                      modeHint={modeHint}
                    />
                    <RejectForm productionId={p.id} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="mt-4">
        <CardTitle>Publicações</CardTitle>
        <CardDescription>
          Últimos 14 dias e próximas. Pacote manual: baixe o vídeo, a thumbnail e o texto, envie no
          YouTube Studio (privado, programado, marcando &quot;conteúdo alterado ou sintético&quot;)
          e cole o link aqui.
        </CardDescription>
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-haze-500">Nenhuma publicação ainda.</p>
        ) : null}
        <ul className="mt-3 divide-y divide-night-800" data-testid="lista-publicacoes">
          {visible.map((pub) => {
            const st = PUB_STATUS[pub.status] ?? { label: pub.status, tone: 'muted' as const };
            const out = (pub.production.outputs as Outputs | null) ?? {};
            return (
              <li key={pub.id} className="space-y-2 py-3" data-testid="publicacao">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={st.tone} data-testid="status-publicacao">
                    {st.label}
                  </Badge>
                  {pub.simulated ? <Badge tone="warn">simulado</Badge> : null}
                  <span className="text-xs text-haze-400">{fmt.format(pub.publishAt)}</span>
                  <span className="text-sm text-white">{pub.title}</span>
                </div>
                {pub.step ? <p className="text-xs text-haze-400">{pub.step}</p> : null}
                {pub.error ? <p className="text-xs text-alert">{pub.error}</p> : null}
                {pub.youtubeVideoId && !pub.simulated ? (
                  <a
                    className="text-xs text-neon-cyan underline"
                    href={`https://studio.youtube.com/video/${pub.youtubeVideoId}/edit`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir no YouTube Studio
                  </a>
                ) : null}
                {pub.status === 'MANUAL' ? (
                  <div
                    className="flex flex-wrap items-center gap-3 text-xs"
                    data-testid="pacote-manual"
                  >
                    {out.video ? (
                      <a className="text-neon-cyan underline" href={media(out.video, 'video.mp4')}>
                        Baixar vídeo
                      </a>
                    ) : null}
                    {out.thumbnail && pub.production.format === 'LONG' ? (
                      <a
                        className="text-neon-cyan underline"
                        href={media(out.thumbnail, 'thumbnail.png')}
                      >
                        Baixar thumbnail
                      </a>
                    ) : null}
                    <a className="text-neon-cyan underline" href={`/api/publish/${pub.id}/pacote`}>
                      Baixar título, descrição e tags
                    </a>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-start gap-2">
                  {pub.status === 'MANUAL' ? <ManualUploadedForm publicationId={pub.id} /> : null}
                  {pub.status === 'FAILED' ? <RetryUploadForm publicationId={pub.id} /> : null}
                  {['QUEUED', 'MANUAL', 'FAILED'].includes(pub.status) ? (
                    <CancelPublicationForm publicationId={pub.id} />
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
