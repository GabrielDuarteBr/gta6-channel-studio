import {
  ALLOWED_TAGS,
  AVATAR_ENGINES,
  EXPRESSION_LABEL,
  EXPRESSIONS,
  GESTURE_LABEL,
  GESTURES,
  IDLE_STATE,
  LOCKED_RULES,
  MOUTH_LABEL,
  MOUTH_SHAPES,
} from '@studio/avatar';
import { ZecaArt } from '@studio/avatar/art';
import { activeBible, getAllSettings, getPrisma, listBibleVersions } from '@studio/db';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { listClips } from '@/server/character';
import { restoreBibleAction } from './actions';
import { BibleForm, ClipForm } from './forms';

export const metadata: Metadata = { title: 'Personagem' };
export const dynamic = 'force-dynamic';

const DEMO_SCRIPT =
  '[feliz] Fala, galera do Radar! Aqui é o Zeca Neon. [pausa] ' +
  '[surpreso] [aponta_tela] A Rockstar soltou novidade de GTA 6! ' +
  '[serio] Mas calma: o preço ainda é rumor, tá? [pausa:500] ' +
  '[debochado] E já tem gente vendendo o videogame pra comprar o jogo.';

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'error' | 'info' }> = {
  QUEUED: { label: 'na fila', tone: 'info' },
  RUNNING: { label: 'gerando', tone: 'warn' },
  SUCCEEDED: { label: 'pronto', tone: 'ok' },
  FAILED: { label: 'falhou', tone: 'error' },
  INTERRUPTED: { label: 'interrompido', tone: 'warn' },
};

export default async function CharacterPage() {
  const prisma = getPrisma();
  const [bible, versions, clips, settings] = await Promise.all([
    activeBible(prisma),
    listBibleVersions(prisma, 10),
    listClips(6),
    getAllSettings(prisma),
  ]);

  return (
    <>
      <PageHeader
        title="Personagem"
        subtitle="O Zeca Neon: expressões, bocas, gestos, bíblia e clipe de teste com voz e boca sincronizada."
        actions={<Badge tone="warn">Arte provisória</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Expressões</CardTitle>
          <CardDescription>
            Arte em camadas feita pelo estúdio. A definitiva vem do ilustrador (com contrato de
            cessão de direitos).
          </CardDescription>
          <ul
            className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6"
            data-testid="galeria-expressoes"
          >
            {EXPRESSIONS.map((expression) => (
              <li key={expression} className="text-center">
                <div className="rounded-xl bg-night-900 p-1">
                  <ZecaArt state={{ ...IDLE_STATE, expression }} provisional={false} />
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
                    <ZecaArt state={{ ...IDLE_STATE, mouth }} provisional={false} />
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
                  <ZecaArt
                    state={{
                      ...IDLE_STATE,
                      expression: 'feliz',
                      gesture: { id, amount: 1, phase: 0.3 },
                    }}
                    provisional={false}
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
                {settings.character.ttsProvider === 'fake'
                  ? 'Voz de teste (espeak-ng, robótica, grátis). A voz real entra quando você escolher o provedor.'
                  : settings.character.ttsProvider}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>Clipe de teste</CardTitle>
        <CardDescription>
          Texto com marcações → voz → boca sincronizada (Rhubarb) → render. Mesmo texto, mesmo
          vídeo, quadro a quadro.
        </CardDescription>
        <div className="mt-3">
          <ClipForm demoScript={DEMO_SCRIPT} allowedTags={ALLOWED_TAGS} />
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
