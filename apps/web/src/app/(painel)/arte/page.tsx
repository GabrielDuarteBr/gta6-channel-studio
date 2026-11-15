import { getAllSettings, getPrisma } from '@studio/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { listGenerated } from '@/server/art';
import { approveAction, discardAction, variationAction } from './actions';

export const metadata: Metadata = { title: 'Arte' };
export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const pill =
  'rounded-full border border-night-600 px-3 py-1 text-xs text-haze-300 hover:bg-night-800';

export default async function ArtPage() {
  const [{ assets, paidImages, paidUsd }, settings] = await Promise.all([
    listGenerated(),
    getAllSettings(getPrisma()),
  ]);
  const images = settings.images;
  const simulated = settings['mode.simulation'] || images.provider === 'fake';

  return (
    <>
      <PageHeader
        title="Arte"
        subtitle="Cenários gerados pelo Diretor de arte. Aprovados viram cenários reutilizáveis (o Roteirista pode usar sem pagar de novo); descartados saem dos próximos vídeos."
        actions={
          <Badge tone={simulated ? 'warn' : 'info'} data-testid="provedor-imagem">
            {simulated ? 'Imagens de teste' : `Google · ${images.model}`}
          </Badge>
        }
      />
      <Card>
        <CardTitle>Provedor e custo</CardTitle>
        <CardDescription>
          {paidImages} imagem(ns) paga(s), US$ {paidUsd.toFixed(2)} no total. Modelo e guia de
          estilo em{' '}
          <Link href="/configuracoes" className="text-neon-cyan hover:underline">
            Configurações → Imagens geradas
          </Link>
          ; comparativo entre modelos com <code>make imagens</code>.
        </CardDescription>
        <p className="mt-2 text-xs text-haze-400">Guia de estilo: {images.style}</p>
      </Card>

      <Card className="mt-4">
        <CardTitle>Cenários</CardTitle>
        {assets.length === 0 ? (
          <p className="mt-3 text-sm text-haze-500">
            Nenhuma imagem gerada ainda. Elas aparecem aqui quando um vídeo é produzido.
          </p>
        ) : (
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="cenarios">
            {assets.map((a) => {
              const active = a.manifest?.status === 'ACTIVE';
              const approved = a.tags.includes('aprovada');
              return (
                <li
                  key={a.id}
                  className="overflow-hidden rounded-xl border border-night-700 bg-night-900"
                  data-testid="cenario"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagem privada, rota autenticada */}
                  <img
                    src={`/api/library/${a.id}`}
                    alt={a.title}
                    loading="lazy"
                    className={`aspect-video w-full bg-night-800 object-cover ${active ? '' : 'opacity-40 grayscale'}`}
                  />
                  <div className="space-y-1.5 p-3 text-sm">
                    <div className="flex flex-wrap gap-1.5">
                      {approved ? <Badge tone="ok">aprovada</Badge> : null}
                      {!active ? <Badge tone="error">descartada</Badge> : null}
                      {a._count.usages ? (
                        <Badge tone="muted">em {a._count.usages} vídeo(s)</Badge>
                      ) : null}
                      <Badge tone="muted">{a.manifest?.provider ?? '—'}</Badge>
                    </div>
                    <p className="font-medium text-white">{a.title}</p>
                    <p className="line-clamp-3 text-xs text-haze-400">{a.manifest?.prompt}</p>
                    <p className="text-xs text-haze-500">
                      {fmt.format(a.createdAt)}
                      {a.story ? ` · ${a.story.titlePt ?? a.story.title}` : ''}
                    </p>
                    {active ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <form action={approveAction}>
                          <input type="hidden" name="assetId" value={a.id} />
                          <input
                            type="hidden"
                            name="approved"
                            value={approved ? 'false' : 'true'}
                          />
                          <button type="submit" className={pill}>
                            {approved ? 'Tirar aprovação' : 'Aprovar'}
                          </button>
                        </form>
                        <form action={variationAction}>
                          <input type="hidden" name="assetId" value={a.id} />
                          <button type="submit" className={pill}>
                            Gerar variação
                          </button>
                        </form>
                        <form action={discardAction}>
                          <input type="hidden" name="assetId" value={a.id} />
                          <button type="submit" className={pill}>
                            Descartar
                          </button>
                        </form>
                      </div>
                    ) : null}
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
