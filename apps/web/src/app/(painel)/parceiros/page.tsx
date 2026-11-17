import { getAllSettings, getPrisma } from '@studio/db';
import { permissionProblem, PROOF_KIND_LABEL, type PartnerConditions } from '@studio/policy';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { lastHunt, listPartners, permissionState } from '@/server/partners';
import { audioAction, stageAction } from './actions';
import {
  AddChannelForm,
  DraftMessage,
  HuntButton,
  ImportLinkForm,
  PermissionForm,
  PermissionStatusForm,
  ReactButton,
  UploadVideoForm,
} from './forms';

export const metadata: Metadata = { title: 'Parceiros' };
export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const fmtDay = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const num = new Intl.NumberFormat('pt-BR');

const STAGE: Record<string, { label: string; tone: 'ok' | 'warn' | 'info' | 'muted' }> = {
  CANDIDATE: { label: 'candidato', tone: 'info' },
  CONTACTED: { label: 'mensagem enviada', tone: 'warn' },
  PARTNER: { label: 'parceiro', tone: 'ok' },
  DISMISSED: { label: 'descartado', tone: 'muted' },
};
const PERM: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' }> = {
  ACTIVE: { label: 'ativa', tone: 'ok' },
  SUSPENDED: { label: 'suspensa', tone: 'warn' },
  REVOKED: { label: 'revogada', tone: 'error' },
};
const IMPORT: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' | 'info' }> = {
  QUEUED: { label: 'na fila', tone: 'info' },
  DOWNLOADING: { label: 'baixando', tone: 'warn' },
  PROCESSING: { label: 'conferindo', tone: 'warn' },
  DONE: { label: 'pronto', tone: 'ok' },
  FAILED: { label: 'falhou', tone: 'error' },
};
const ANALYSIS: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' | 'info' }> = {
  PENDING: { label: 'análise na fila', tone: 'info' },
  RUNNING: { label: 'analisando', tone: 'warn' },
  READY: { label: 'transcrição pronta', tone: 'ok' },
  FAILED: { label: 'análise falhou', tone: 'error' },
};

interface Analysis {
  language: string | null;
  segments: Array<{ text: string; music: boolean }>;
  music: Array<[number, number]>;
  speech: Array<[number, number]>;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export default async function PartnersPage() {
  const prisma = getPrisma();
  const [partners, settings, hunt] = await Promise.all([
    listPartners(),
    getAllSettings(prisma),
    lastHunt(),
  ]);
  const candidates = partners.filter((p) => p.stage === 'CANDIDATE' || p.stage === 'CONTACTED');
  const active = partners.filter((p) => p.stage === 'PARTNER');
  const dismissed = partners.filter((p) => p.stage === 'DISMISSED');

  return (
    <>
      <PageHeader
        title="Parceiros"
        subtitle="Criadores que autorizam cortes em Shorts de react. O Caçador só sugere e rascunha mensagens: nada é enviado pelo sistema."
        actions={
          <Badge tone="info">
            {active.length} parceiro(s) · {candidates.length} candidato(s)
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Caçador de parceiros</CardTitle>
          <CardDescription>
            Busca canais de GTA no YouTube (só dados públicos,{' '}
            {settings.partners.huntQueries.length} busca(s) por rodada){' '}
            {settings.partners.huntWeekly ? 'toda semana e' : ''} quando você pede. Frase como
            &ldquo;cortes liberados&rdquo; vira indício de candidato, nunca permissão.
            {hunt
              ? ` Última rodada: ${fmt.format(hunt.createdAt)} (${hunt.status === 'SUCCEEDED' ? 'ok' : hunt.status === 'FAILED' ? 'falhou' : 'em andamento'}).`
              : ' Ainda não rodou.'}
          </CardDescription>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <HuntButton />
            <AddChannelForm />
          </div>
        </Card>
        <Card>
          <CardTitle>Como vira parceiro</CardTitle>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-haze-300">
            <li>Copie o rascunho e envie você mesmo.</li>
            <li>Com a resposta por escrito, registre a permissão (prova e condições).</li>
            <li>Importe os arquivos por link do Dropbox/Drive ou envie aqui.</li>
            <li>Ouça a prévia e clique em &ldquo;Produzir Short de react&rdquo;.</li>
          </ol>
        </Card>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-white">Parceiros</h2>
      {active.length === 0 ? (
        <p className="mt-2 text-sm text-haze-500">
          Nenhum parceiro com permissão registrada ainda.
        </p>
      ) : null}
      <div className="mt-3 space-y-4">
        {active.map((p) => {
          const perms = p.permissions;
          const usable = perms.filter((x) => !permissionProblem(permissionState(x), 'REACT_CLIPS'));
          const latest = perms[0];
          const cond = (latest?.conditions ?? {}) as Partial<PartnerConditions>;
          return (
            <Card key={p.id} data-testid="parceiro">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{p.name}</CardTitle>
                <Badge tone="ok">parceiro</Badge>
                <a
                  href={p.channelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-neon-cyan underline"
                >
                  canal
                </a>
                <span className="text-xs text-haze-500">
                  {p._count.productions} vídeo(s) produzido(s)
                </span>
              </div>

              <div className="mt-3 space-y-3">
                {perms.map((perm) => {
                  const c = perm.conditions as unknown as PartnerConditions;
                  const st = PERM[perm.status]!;
                  const problem = permissionProblem(permissionState(perm), 'REACT_CLIPS');
                  return (
                    <div
                      key={perm.id}
                      className="rounded-lg border border-night-700 p-3"
                      data-testid="permissao"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone={st.tone} data-testid="status-permissao">
                          permissão {st.label}
                        </Badge>
                        {problem && perm.status === 'ACTIVE' ? (
                          <Badge tone="warn">{problem}</Badge>
                        ) : null}
                        <span className="text-haze-300">
                          {PROOF_KIND_LABEL[perm.proofKind]} de {fmtDay.format(perm.grantedAt)}
                          {perm.expiresAt ? ` · válida até ${fmtDay.format(perm.expiresAt)}` : ''}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-haze-400">
                        Crédito: <strong className="text-white">{c.credit}</strong>
                        {c.link ? ` · link ${c.link}` : ''}
                        {c.hashtag ? ` · ${c.hashtag}` : ''} ·{' '}
                        {c.monetization === 'allowed' ? 'pode monetizar' : 'NÃO pode monetizar'}
                        {c.maxClipSec ? ` · até ${c.maxClipSec} s de clipe por Short` : ''}
                        {c.notes ? ` · ${c.notes}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-haze-500">
                        Prova: {perm.proof.slice(0, 240)}
                      </p>
                      {perm.revokedReason ? (
                        <p className="mt-1 text-xs text-alert">Revogada: {perm.revokedReason}</p>
                      ) : null}
                      <div className="mt-2">
                        <PermissionStatusForm permissionId={perm.id} status={perm.status} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {usable.length ? (
                <div className="mt-4 space-y-3 rounded-lg border border-night-700 p-3">
                  <ImportLinkForm
                    partnerId={p.id}
                    permissions={usable.map((u) => ({
                      id: u.id,
                      label: `permissão de ${fmtDay.format(u.grantedAt)}`,
                    }))}
                  />
                  <UploadVideoForm
                    partnerId={p.id}
                    permissionId={usable[0]!.id}
                    maxMb={settings.partners.maxImportMb}
                  />
                </div>
              ) : (
                <p className="mt-3 text-sm text-sunset">
                  Sem permissão ativa: importar e produzir ficam bloqueados.
                </p>
              )}

              {p.imports.length ? (
                <ul className="mt-3 space-y-1 text-xs" data-testid="importacoes">
                  {p.imports.map((imp) => {
                    const st = IMPORT[imp.status]!;
                    return (
                      <li key={imp.id} className="flex flex-wrap items-center gap-2">
                        <Badge tone={st.tone} data-testid="status-importacao">
                          {st.label}
                        </Badge>
                        <span className="text-haze-300">
                          {imp.source === 'upload' ? (imp.originalName ?? 'envio') : imp.source} ·{' '}
                          {fmt.format(imp.createdAt)}
                        </span>
                        {imp.error ? <span className="text-alert">{imp.error}</span> : null}
                        {imp.step && imp.status === 'DONE' ? (
                          <span className="text-haze-500">{imp.step}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {p.assets.length ? (
                <ul className="mt-4 grid gap-3 lg:grid-cols-2">
                  {p.assets.map((a) => {
                    const an = a.analysis as Analysis | null;
                    const st = a.analysisStatus ? ANALYSIS[a.analysisStatus] : null;
                    const ext = a.storageKey.split('.').pop();
                    const rightsOk = a.manifest?.status === 'ACTIVE' && usable.length > 0;
                    const reason = !rightsOk
                      ? 'Sem permissão ativa ou direitos revogados'
                      : a.analysisStatus !== 'READY'
                        ? 'Espere a análise terminar'
                        : undefined;
                    return (
                      <li
                        key={a.id}
                        className="rounded-lg border border-night-700 p-3"
                        data-testid="video-parceiro"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">{a.title}</span>
                          {a.durationSec ? <Badge tone="muted">{mmss(a.durationSec)}</Badge> : null}
                          {st ? (
                            <Badge tone={st.tone} data-testid="status-analise">
                              {st.label}
                            </Badge>
                          ) : null}
                          {a.manifest?.status === 'REVOKED' ? (
                            <Badge tone="error">direitos revogados</Badge>
                          ) : null}
                        </div>
                        {ext === 'mp4' || ext === 'webm' ? (
                          <video
                            controls
                            preload="metadata"
                            className="mt-2 w-full rounded-md bg-black"
                            src={`/api/media/partners/${a.sha256}.${ext}`}
                          />
                        ) : null}
                        {an ? (
                          <p className="mt-2 text-xs text-haze-400">
                            {an.segments.length} trecho(s) de fala
                            {an.language ? ` (${an.language})` : ''}
                            {an.music.length
                              ? ` · ${an.music.length} trecho(s) com música (ficam fora do corte)`
                              : ''}
                            {an.segments.length
                              ? ` · "${an.segments
                                  .filter((s) => !s.music)
                                  .map((s) => s.text)
                                  .join(' ')
                                  .slice(0, 160)}…"`
                              : ''}
                          </p>
                        ) : null}
                        {a.analysisError ? (
                          <p className="text-xs text-alert">{a.analysisError}</p>
                        ) : null}
                        <form
                          action={audioAction}
                          className="mt-2 flex items-center gap-2 text-xs text-haze-300"
                        >
                          <input type="hidden" name="assetId" value={a.id} />
                          <label className="flex items-center gap-2">
                            <input type="checkbox" name="cleared" defaultChecked={a.audioCleared} />
                            Ouvi: sem música, filme ou TV de terceiros (áudio original inteiro)
                          </label>
                          <button
                            type="submit"
                            className="rounded border border-night-600 px-2 py-0.5 hover:bg-night-800"
                          >
                            salvar
                          </button>
                        </form>
                        <p className="mt-1 text-xs text-haze-500">
                          {a.audioCleared
                            ? 'O clipe leva o áudio original inteiro.'
                            : 'O clipe leva só a voz do parceiro; o resto fica mudo.'}
                        </p>
                        <div className="mt-2">
                          <ReactButton assetId={a.id} disabled={Boolean(reason)} reason={reason} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-neon-cyan">
                  Registrar outra permissão
                </summary>
                <div className="mt-3">
                  <PermissionForm
                    partnerId={p.id}
                    defaultCredit={cond.credit ?? p.name}
                    defaultLink={cond.link ?? p.channelUrl}
                  />
                </div>
              </details>
            </Card>
          );
        })}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-white">Candidatos</h2>
      {candidates.length === 0 ? (
        <p className="mt-2 text-sm text-haze-500">
          Nenhum candidato. Clique em &ldquo;Procurar parceiros agora&rdquo; ou cole o link de um
          canal.
        </p>
      ) : null}
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {candidates.map((p) => {
          const st = STAGE[p.stage]!;
          const ev = (p.evidence ?? {}) as { hints?: string[]; note?: string | null };
          return (
            <Card key={p.id} data-testid="candidato">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{p.name}</CardTitle>
                <Badge tone={st.tone} data-testid="estagio">
                  {st.label}
                </Badge>
                {p.fitScore !== null ? (
                  <Badge tone={p.fitScore >= 0.6 ? 'ok' : 'muted'}>
                    encaixe {Math.round(p.fitScore * 100)}%
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-haze-400">
                <a
                  href={p.channelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-neon-cyan underline"
                >
                  {p.handle ?? 'abrir canal'}
                </a>
                {p.subscribers !== null ? ` · ${num.format(p.subscribers)} inscritos` : ''}
                {p.videoCount !== null ? ` · ${num.format(p.videoCount)} vídeos` : ''}
                {p.country ? ` · ${p.country}` : ''} ·{' '}
                {p.discoveredBy === 'owner' ? 'adicionado por você' : 'achado pelo Caçador'}
              </p>
              {p.fitReason ? <p className="mt-2 text-sm text-haze-300">{p.fitReason}</p> : null}
              {ev.hints?.length ? (
                <p className="mt-2 text-xs text-sunset" data-testid="indicio">
                  Indício na descrição: &ldquo;{ev.hints.join('", "')}&rdquo; — não é permissão.
                  Peça por escrito.
                </p>
              ) : null}
              {p.draftMessage ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-neon-cyan">
                    Rascunho da mensagem
                  </summary>
                  <div className="mt-2">
                    <DraftMessage text={p.draftMessage} />
                  </div>
                </details>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {p.stage === 'CANDIDATE' ? (
                  <form action={stageAction}>
                    <input type="hidden" name="partnerId" value={p.id} />
                    <input type="hidden" name="stage" value="CONTACTED" />
                    <button
                      type="submit"
                      className="rounded-lg border border-night-600 px-3 py-1.5 text-xs text-white hover:bg-night-800"
                    >
                      Marquei como enviada
                    </button>
                  </form>
                ) : null}
                <form action={stageAction}>
                  <input type="hidden" name="partnerId" value={p.id} />
                  <input type="hidden" name="stage" value="DISMISSED" />
                  <button
                    type="submit"
                    className="rounded-lg px-3 py-1.5 text-xs text-haze-400 hover:bg-night-800"
                  >
                    Descartar
                  </button>
                </form>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-neon-cyan">
                  Ele autorizou? Registrar permissão
                </summary>
                <div className="mt-3">
                  <PermissionForm
                    partnerId={p.id}
                    defaultCredit={p.name}
                    defaultLink={p.channelUrl}
                  />
                </div>
              </details>
            </Card>
          );
        })}
      </div>

      {dismissed.length ? (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-haze-400">
            Descartados ({dismissed.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {dismissed.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-haze-400">
                {p.name}
                <form action={stageAction}>
                  <input type="hidden" name="partnerId" value={p.id} />
                  <input type="hidden" name="stage" value="CANDIDATE" />
                  <button type="submit" className="text-xs text-neon-cyan underline">
                    voltar para candidatos
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
