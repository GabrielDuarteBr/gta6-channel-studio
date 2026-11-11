import { getPrisma } from '@studio/db';
import { ArrowLeft, Trash2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge, Card } from '@/components/ui/card';
import { CollectNowButton } from '../client-actions';
import { deleteSourceAction, toggleSourceAction } from './actions';
import { AddSourceForm, EditUrlForm } from './forms';

export const metadata: Metadata = { title: 'Fontes da pauta' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  RSS: 'Feed',
  PAGE: 'Página',
  YOUTUBE_CHANNEL: 'Canal YouTube',
  YOUTUBE_SEARCH: 'Busca YouTube',
};
const TIER: Record<string, { label: string; tone: 'ok' | 'info' | 'muted' }> = {
  OFFICIAL: { label: 'Oficial', tone: 'ok' },
  PRESS: { label: 'Imprensa', tone: 'info' },
  COMMUNITY: { label: 'Comunidade', tone: 'muted' },
};
const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge>ainda não coletada</Badge>;
  const tone = status === 'ok' ? 'ok' : status === 'erro' ? 'error' : 'warn';
  return (
    <Badge tone={tone} data-testid="status-fonte">
      {status}
    </Badge>
  );
}

export default async function SourcesPage() {
  const sources = await getPrisma().source.findMany({
    orderBy: [{ tier: 'asc' }, { name: 'asc' }],
  });
  return (
    <>
      <PageHeader
        title="Fontes"
        subtitle="De onde a pauta vem. Fontes oficiais têm prioridade. O YouTube entra só como metadados, pela API. O Reddit ficou de fora: fechou a API para novos apps e desliga os feeds RSS em 13/11/2026."
        actions={<CollectNowButton />}
      />
      <Link
        href="/pauta"
        className="mb-4 inline-flex items-center gap-1 text-sm text-neon-cyan hover:underline"
      >
        <ArrowLeft className="size-4" /> Voltar para a pauta
      </Link>

      <Card className="mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-left text-sm" data-testid="tabela-fontes">
          <thead className="text-xs text-haze-500">
            <tr className="border-b border-night-800">
              <th className="px-4 py-3 font-medium">Fonte</th>
              <th className="px-2 py-3 font-medium">Nível</th>
              <th className="px-2 py-3 font-medium">Endereço</th>
              <th className="px-2 py-3 font-medium">Última coleta</th>
              <th className="px-2 py-3 font-medium">Ativa</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-night-800">
            {sources.map((s) => (
              <tr
                key={s.id}
                className={s.enabled ? '' : 'opacity-50'}
                data-testid={`fonte-${s.key ?? s.id}`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{s.name}</div>
                  <div className="text-xs text-haze-500">
                    {KIND_LABEL[s.kind]} · {s.language}
                  </div>
                </td>
                <td className="px-2 py-3">
                  <Badge tone={TIER[s.tier]?.tone}>{TIER[s.tier]?.label}</Badge>
                </td>
                <td className="w-[34%] px-2 py-3">
                  <EditUrlForm id={s.id} url={s.url} />
                  {(s.resolved as { feedUrl?: string } | null)?.feedUrl ? (
                    <div className="mt-1 truncate text-xs text-haze-500">
                      feed: {(s.resolved as { feedUrl: string }).feedUrl}
                    </div>
                  ) : null}
                </td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={s.lastStatus} />
                    {s.lastStatus === 'ok' ? (
                      <span className="text-xs text-haze-500">{s.lastItemCount} de GTA 6</span>
                    ) : null}
                  </div>
                  {s.lastFetchedAt ? (
                    <div className="mt-1 text-xs text-haze-500">{fmt.format(s.lastFetchedAt)}</div>
                  ) : null}
                  {s.lastError ? (
                    <div className="mt-1 max-w-64 truncate text-xs text-alert" title={s.lastError}>
                      {s.lastError}
                    </div>
                  ) : null}
                </td>
                <td className="px-2 py-3">
                  <form action={toggleSourceAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="enabled" value={s.enabled ? 'false' : 'true'} />
                    <button
                      type="submit"
                      className="rounded-full border border-night-600 px-3 py-1 text-xs text-haze-300 hover:bg-night-800"
                      data-testid={`alternar-${s.key ?? s.id}`}
                    >
                      {s.enabled ? 'Desativar' : 'Ativar'}
                    </button>
                  </form>
                </td>
                <td className="px-4 py-3 text-right">
                  {!s.builtIn ? (
                    <form action={deleteSourceAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <button
                        type="submit"
                        className="text-haze-500 hover:text-alert"
                        aria-label={`Remover ${s.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <AddSourceForm />
    </>
  );
}
