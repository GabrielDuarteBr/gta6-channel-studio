import type { AssetOrigin } from '@studio/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { libraryCounts, listAssets, ORIGIN_LABEL, storiesForSelect } from '@/server/library';
import { ImportForm, RevokeForm, UploadForm } from './forms';

export const metadata: Metadata = { title: 'Biblioteca' };
export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

const ORIGINS = Object.keys(ORIGIN_LABEL) as AssetOrigin[];

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ origem?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const origin = ORIGINS.find((o) => o === sp.origem);
  const [assets, counts, stories] = await Promise.all([
    listAssets({ origin, q: sp.q }),
    libraryCounts(),
    storiesForSelect(),
  ]);
  const storyOptions = stories.map((s) => ({ id: s.id, title: s.titlePt ?? s.title }));
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Biblioteca"
        subtitle="Toda imagem que entra em vídeo passa por aqui, sempre com manifesto de direitos. Sem manifesto ativo, o render recusa. Nada vem do YouTube."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Enviar arquivo</CardTitle>
          <CardDescription>
            Arte/foto sua, imagem oficial salva por você ou quadro do canal.
          </CardDescription>
          <div className="mt-4">
            <UploadForm stories={storyOptions} />
          </div>
        </Card>
        <Card>
          <CardTitle>Importar do site oficial</CardTitle>
          <CardDescription>
            O estúdio baixa a imagem do site da Rockstar/Take-Two e registra o link como prova.
          </CardDescription>
          <div className="mt-4">
            <ImportForm stories={storyOptions} />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>
            Mídias <span className="text-haze-500">({total})</span>
          </CardTitle>
          <nav className="flex flex-wrap gap-1.5 text-xs" aria-label="Filtrar por origem">
            <Link
              href="/biblioteca"
              className={`rounded-full border px-3 py-1 ${!origin ? 'border-neon-cyan text-neon-cyan' : 'border-night-600 text-haze-400 hover:text-white'}`}
            >
              Todas
            </Link>
            {ORIGINS.map((o) => (
              <Link
                key={o}
                href={`/biblioteca?origem=${o}`}
                className={`rounded-full border px-3 py-1 ${origin === o ? 'border-neon-cyan text-neon-cyan' : 'border-night-600 text-haze-400 hover:text-white'}`}
              >
                {ORIGIN_LABEL[o]} ({counts[o] ?? 0})
              </Link>
            ))}
          </nav>
        </div>
        {assets.length === 0 ? (
          <p className="mt-4 text-sm text-haze-500">
            Nenhuma mídia ainda. As imagens geradas pelo Diretor de arte também aparecem aqui.
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="lista-midias">
            {assets.map((a) => {
              const m = a.manifest;
              const active = m?.status === 'ACTIVE';
              return (
                <li
                  key={a.id}
                  className="overflow-hidden rounded-xl border border-night-700 bg-night-900"
                  data-testid="midia"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagem privada, servida pela rota autenticada */}
                  <img
                    src={`/api/library/${a.id}`}
                    alt={a.title}
                    loading="lazy"
                    className="aspect-video w-full bg-night-800 object-cover"
                  />
                  <div className="space-y-1.5 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="info">{ORIGIN_LABEL[a.origin]}</Badge>
                      <Badge tone={active ? 'ok' : 'error'} data-testid="status-direitos">
                        {active ? 'direitos ok' : 'revogada'}
                      </Badge>
                      {a._count.usages ? (
                        <Badge tone="muted">em {a._count.usages} vídeo(s)</Badge>
                      ) : null}
                    </div>
                    <p className="font-medium text-white">{a.title}</p>
                    <p className="text-xs text-haze-400">
                      {a.width}×{a.height} · {(a.bytes / 1024).toFixed(0)} KB ·{' '}
                      {fmt.format(a.createdAt)}
                    </p>
                    {m ? (
                      <dl className="space-y-0.5 text-xs text-haze-400">
                        <div>
                          <dt className="inline text-haze-500">Licença: </dt>
                          <dd className="inline">{m.license}</dd>
                        </div>
                        {m.credit ? (
                          <div>
                            <dt className="inline text-haze-500">Crédito: </dt>
                            <dd className="inline">{m.credit}</dd>
                          </div>
                        ) : null}
                        {m.sourceUrl ? (
                          <div className="truncate">
                            <dt className="inline text-haze-500">Origem: </dt>
                            <dd className="inline">
                              <a
                                href={m.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-neon-cyan hover:underline"
                              >
                                {new URL(m.sourceUrl).hostname}
                              </a>
                            </dd>
                          </div>
                        ) : null}
                        {m.prompt ? (
                          <div className="line-clamp-2">
                            <dt className="inline text-haze-500">Prompt: </dt>
                            <dd className="inline">{m.prompt}</dd>
                          </div>
                        ) : null}
                        {m.status === 'REVOKED' && m.revokedReason ? (
                          <div className="text-alert">Revogada: {m.revokedReason}</div>
                        ) : null}
                      </dl>
                    ) : (
                      <p className="text-xs text-alert">Sem manifesto: não entra em render.</p>
                    )}
                    {a.story ? (
                      <p className="truncate text-xs text-haze-500">
                        História: {a.story.titlePt ?? a.story.title}
                      </p>
                    ) : null}
                    {a.tags.length ? (
                      <p className="text-xs text-haze-500">#{a.tags.join(' #')}</p>
                    ) : null}
                    <div className="pt-1">
                      <RevokeForm assetId={a.id} active={active} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
