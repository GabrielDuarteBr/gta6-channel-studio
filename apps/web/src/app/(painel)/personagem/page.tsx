import {
  ALLOWED_TAGS,
  AVATAR_ENGINES,
  DEFAULT_PIVOTS,
  EXPRESSION_LABEL,
  EXPRESSIONS,
  GESTURE_LABEL,
  GESTURES,
  IDLE_STATE,
  LOCKED_RULES,
  MOUTH_LABEL,
  MOUTH_SHAPES,
  type ArtPackRef,
  type AvatarFrameState,
} from '@studio/avatar';
import { LayeredArt, ZecaArt } from '@studio/avatar/art';
import { activeBible, getAllSettings, getPrisma, listBibleVersions } from '@studio/db';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { googleCharsThisMonth, listClips } from '@/server/character';
import { listArt, PANEL_ART_BASE, panelArtRef } from '@/server/character-art';
import { activateArtAction, restoreBibleAction } from './actions';
import { ArtUploadForm, BibleForm, ClipForm } from './forms';

export const metadata: Metadata = { title: 'Personagem' };
export const dynamic = 'force-dynamic';

const DEMO_SCRIPT =
  '[empolgado] [aceno] Bora, que tem novidade no radar! Aqui é o Zeca Neon. [pausa] ' +
  '[surpreso] [aponta_tela] Mano, a Rockstar soltou coisa nova de GTA 6! ' +
  '[desconfiado] Mas o preço? Isso é rumor, hein, calma lá. [pausa:500] ' +
  '[debochado] E já tem gente vendendo o videogame pra comprar o jogo. Faz sentido isso?';

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/** O Zeca na prévia: arte do artista (camadas) ou a provisória. */
function Preview({ state, art }: { state: AvatarFrameState; art: ArtPackRef | null }) {
  return art ? (
    <LayeredArt pack={art} baseUrl={PANEL_ART_BASE} state={state} />
  ) : (
    <ZecaArt state={state} provisional={false} />
  );
}

const ART_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  ACTIVE: { label: 'em uso', tone: 'ok' },
  DRAFT: { label: 'rascunho', tone: 'warn' },
  ARCHIVED: { label: 'arquivada', tone: 'muted' },
};

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' | 'info' }> = {
  QUEUED: { label: 'na fila', tone: 'info' },
  RUNNING: { label: 'gerando', tone: 'warn' },
  SUCCEEDED: { label: 'pronto', tone: 'ok' },
  FAILED: { label: 'falhou', tone: 'error' },
  INTERRUPTED: { label: 'interrompido', tone: 'warn' },
};

export default async function CharacterPage() {
  const prisma = getPrisma();
  const [bible, versions, clips, settings, googleChars, arts] = await Promise.all([
    activeBible(prisma),
    listBibleVersions(prisma, 10),
    listClips(6),
    getAllSettings(prisma),
    googleCharsThisMonth(),
    listArt(6),
  ]);
  const activeRow = arts.find((a) => a.status === 'ACTIVE') ?? null;
  const art = activeRow ? panelArtRef(activeRow) : null;

  return (
    <>
      <PageHeader
        title="Personagem"
        subtitle="O Zeca Neon: expressões, bocas, gestos, bíblia e clipe de teste com voz e boca sincronizada."
        actions={
          activeRow ? (
            <Badge tone="ok" data-testid="arte-em-uso">
              Arte de {activeRow.artist} (v{activeRow.version})
            </Badge>
          ) : (
            <Badge tone="warn" data-testid="arte-em-uso">
              Arte provisória
            </Badge>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Expressões</CardTitle>
          <CardDescription>
            {activeRow
              ? `Arte de ${activeRow.artist} (versão ${activeRow.version}), em camadas.`
              : 'Arte provisória feita pelo estúdio. Envie a do artista em "Arte do artista", logo abaixo.'}
          </CardDescription>
          <ul
            className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-8"
            data-testid="galeria-expressoes"
          >
            {EXPRESSIONS.map((expression) => (
              <li key={expression} className="text-center">
                <div className="rounded-xl bg-night-900 p-1">
                  <Preview state={{ ...IDLE_STATE, expression }} art={art} />
                </div>
                <span className="text-xs text-haze-300">{EXPRESSION_LABEL[expression]}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-5 text-sm font-semibold text-white">Bocas (Rhubarb)</h3>
          <ul className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-9" data-testid="galeria-bocas">
            {MOUTH_SHAPES.map((mouth) => (
              <li key={mouth} className="text-center" title={MOUTH_LABEL[mouth]}>
                <div className="overflow-hidden rounded-lg bg-night-900">
                  <div className="-my-[40%] scale-[2.1]">
                    <Preview state={{ ...IDLE_STATE, mouth }} art={art} />
                  </div>
                </div>
                <span className="text-xs font-semibold text-haze-300">{mouth}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-5 text-sm font-semibold text-white">Gestos</h3>
          <ul className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {GESTURES.map((id) => (
              <li key={id} className="text-center">
                <div className="rounded-xl bg-night-900 p-1">
                  <Preview
                    state={{
                      ...IDLE_STATE,
                      expression: 'feliz',
                      gesture: { id, amount: 1, phase: 0.3 },
                    }}
                    art={art}
                  />
                </div>
                <span className="text-xs text-haze-300">
                  [{id}] {GESTURE_LABEL[id]}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>Motor e voz</CardTitle>
          <dl className="mt-3 space-y-3 text-sm">
            {Object.values(AVATAR_ENGINES).map((engine) => (
              <div key={engine.id}>
                <dt className="flex items-center gap-2 text-white">
                  {engine.label}
                  <Badge tone={engine.status === 'padrão' ? 'ok' : 'muted'}>{engine.status}</Badge>
                </dt>
                <dd className="mt-1 text-xs text-haze-400">{engine.description}</dd>
              </div>
            ))}
            <div>
              <dt className="text-white">Voz</dt>
              <dd className="mt-1 text-xs text-haze-400" data-testid="voz-atual">
                {settings.character.ttsProvider === 'google'
                  ? `Google Chirp 3 HD · ${settings.character.googleVoice.split('-').pop()} · velocidade ${settings.character.speakingRate}`
                  : 'Voz de teste (espeak-ng, robótica, grátis).'}
                {settings['mode.simulation'] ? (
                  <span className="mt-1 block text-sunset">
                    Modo simulado ligado: os clipes usam a voz de teste, a não ser que você escolha
                    &quot;Google&quot; no clipe.
                  </span>
                ) : null}
              </dd>
              <dd className="mt-2" data-testid="cota-voz">
                <div className="flex justify-between text-xs text-haze-400">
                  <span>Cota grátis do Google neste mês</span>
                  <span>
                    {googleChars.toLocaleString('pt-BR')} /{' '}
                    {settings.character.freeCharsPerMonth.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-night-800">
                  <div
                    className="h-full bg-neon-cyan"
                    style={{
                      width: `${Math.min(100, (googleChars / Math.max(1, settings.character.freeCharsPerMonth)) * 100)}%`,
                    }}
                  />
                </div>
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mt-4" data-testid="cartao-arte">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Arte do artista</CardTitle>
          <a href="/modelo-arte-zeca.zip" className="text-sm text-neon-cyan underline" download>
            Baixar modelo para o artista (.zip)
          </a>
        </div>
        <CardDescription>
          Camadas PNG ou SVG do ilustrador, todas do mesmo tamanho: corpo, cabeça (sem rosto),
          olhos, sobrancelhas de cada expressão, as 9 bocas e os braços dos gestos. Guia completo em
          docs/guia-arte-zeca.md. Cada envio vira uma versão em rascunho: confira a prévia, teste
          num clipe e só então use.
        </CardDescription>
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <ArtUploadForm pivots={DEFAULT_PIVOTS} />
          <div>
            {arts.length === 0 ? (
              <p className="text-sm text-haze-500">Nenhuma arte enviada ainda.</p>
            ) : null}
            <ul className="space-y-4" data-testid="lista-artes">
              {arts.map((row) => {
                const ref = panelArtRef(row);
                const st = ART_STATUS[row.status] ?? { label: row.status, tone: 'muted' as const };
                return (
                  <li
                    key={row.id}
                    className="rounded-xl border border-night-700 p-3"
                    data-testid="arte"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={st.tone} data-testid="status-arte">
                        v{row.version} · {st.label}
                      </Badge>
                      <span className="text-xs text-haze-400">
                        {row.artist} · {row.canvasWidth}×{row.canvasHeight} ·{' '}
                        {Object.keys(ref.files).length} camadas · {fmt.format(row.createdAt)}
                      </span>
                      {row.proofKey ? (
                        <a
                          href={`${PANEL_ART_BASE}/v${row.version}/prova`}
                          className="text-xs text-neon-cyan underline"
                        >
                          contrato
                        </a>
                      ) : null}
                    </div>
                    <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8">
                      {EXPRESSIONS.map((expression) => (
                        <li key={expression} className="text-center">
                          <div className="rounded-lg bg-night-900 p-0.5">
                            <Preview state={{ ...IDLE_STATE, expression }} art={ref} />
                          </div>
                          <span className="text-[10px] text-haze-400">
                            {EXPRESSION_LABEL[expression]}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 grid grid-cols-5 gap-1 sm:grid-cols-10">
                      {MOUTH_SHAPES.map((mouth) => (
                        <div key={mouth} className="text-center" title={MOUTH_LABEL[mouth]}>
                          <div className="overflow-hidden rounded bg-night-900">
                            <div className="-my-[40%] scale-[2.1]">
                              <Preview state={{ ...IDLE_STATE, mouth }} art={ref} />
                            </div>
                          </div>
                          <span className="text-[10px] text-haze-400">{mouth}</span>
                        </div>
                      ))}
                      <div className="text-center">
                        <div className="overflow-hidden rounded bg-night-900">
                          <div className="-my-[40%] scale-[2.1]">
                            <Preview state={{ ...IDLE_STATE, eyeOpen: 0 }} art={ref} />
                          </div>
                        </div>
                        <span className="text-[10px] text-haze-400">piscada</span>
                      </div>
                    </div>
                    {row.warnings.length ? (
                      <details className="mt-2 text-xs text-sunset">
                        <summary className="cursor-pointer">
                          {row.warnings.length} aviso(s) do pacote
                        </summary>
                        <ul className="mt-1 list-disc pl-5">
                          {row.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <form action={activateArtAction} className="mt-2 flex gap-2">
                      {row.status === 'ACTIVE' ? (
                        <button
                          type="submit"
                          name="version"
                          value="provisoria"
                          className="rounded-full border border-night-600 px-3 py-1 text-xs text-haze-300 hover:bg-night-800"
                        >
                          Voltar para a arte provisória
                        </button>
                      ) : (
                        <button
                          type="submit"
                          name="version"
                          value={row.version}
                          className="rounded-full bg-neon-pink px-3 py-1 text-xs font-semibold text-white"
                          data-testid="usar-arte"
                        >
                          Usar esta arte
                        </button>
                      )}
                    </form>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle>Clipe de teste</CardTitle>
        <CardDescription>
          Texto com marcações → voz → boca sincronizada (Rhubarb) → render. Mesmo texto, mesmo
          vídeo, quadro a quadro.
        </CardDescription>
        <div className="mt-3">
          <ClipForm
            demoScript={DEMO_SCRIPT}
            allowedTags={ALLOWED_TAGS}
            defaultVoice={settings['mode.simulation'] ? 'fake' : settings.character.ttsProvider}
            defaultLayout={settings.character.layout}
            artOptions={arts
              .filter((a) => a.status !== 'ACTIVE')
              .map((a) => ({ version: a.version, label: `v${a.version} · ${a.artist} (teste)` }))}
          />
        </div>
        <ul className="mt-5 space-y-3" data-testid="lista-clipes">
          {clips.length === 0 ? (
            <li className="text-sm text-haze-500">Nenhum clipe ainda.</li>
          ) : null}
          {clips.map((clip) => {
            const status = STATUS[clip.status] ?? { label: clip.status, tone: 'info' as const };
            const r = clip.result;
            return (
              <li
                key={clip.id}
                className="grid gap-3 rounded-xl border border-night-700 p-3 md:grid-cols-[minmax(0,320px)_1fr]"
                data-testid="clipe"
              >
                {clip.status === 'SUCCEEDED' && r?.video ? (
                  <video
                    controls
                    preload="metadata"
                    className="w-full rounded-lg bg-black"
                    src={`/api/media/${r.video}`}
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-lg bg-night-900 text-xs text-haze-500">
                    {status.label}
                  </div>
                )}
                <div className="space-y-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={status.tone} data-testid="status-clipe">
                      {status.label}
                    </Badge>
                    <span className="text-xs text-haze-500">
                      {fmt.format(clip.createdAt)} · {clip.layout === 'vertical' ? '9:16' : '16:9'}
                    </span>
                  </div>
                  {r?.durationSec ? (
                    <p className="text-xs text-haze-400">
                      {r.durationSec.toFixed(1)} s · expressões {r.expressions?.join(', ')} · bocas{' '}
                      {r.mouthShapes?.join('')} · render em {r.render?.seconds} s
                    </p>
                  ) : null}
                  {clip.error ? <p className="text-xs text-alert">{clip.error}</p> : null}
                  <p className="line-clamp-2 text-xs text-haze-500">{clip.script}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Bíblia do personagem</CardTitle>
          <span className="text-xs text-haze-500" data-testid="versao-biblia">
            versão {bible.version}
            {bible.version > 0 ? ` · ${fmt.format(bible.createdAt)}` : ''}
          </span>
        </div>
        <CardDescription>
          Quem o Zeca é, como fala e o que nunca faz. O roteirista (Fase 3) usa a versão ativa. Cada
          salvamento cria uma versão nova.
        </CardDescription>
        <div className="mt-4">
          <BibleForm
            version={bible.version}
            bible={bible.content}
            lockedRules={[...LOCKED_RULES]}
          />
        </div>
        {versions.length > 1 ? (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-white">Versões</h3>
            <ul className="mt-2 divide-y divide-night-800 text-sm" data-testid="versoes-biblia">
              {versions.map((v) => (
                <li
                  key={v.version}
                  className="flex items-center justify-between gap-3 py-2"
                  data-testid={`versao-${v.version}`}
                >
                  <span className="text-haze-300">
                    v{v.version} · {fmt.format(v.createdAt)} · {v.createdBy}
                    {v.note ? <span className="text-haze-500"> · {v.note}</span> : null}
                  </span>
                  {v.version !== bible.version ? (
                    <form action={restoreBibleAction}>
                      <input type="hidden" name="version" value={v.version} />
                      <button
                        type="submit"
                        className="rounded-full border border-night-600 px-3 py-1 text-xs text-haze-300 hover:bg-night-800"
                      >
                        Restaurar
                      </button>
                    </form>
                  ) : (
                    <Badge tone="ok">ativa</Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </>
  );
}
