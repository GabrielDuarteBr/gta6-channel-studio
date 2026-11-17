import { getAllSettings, getPrisma } from '@studio/db';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/card';
import { chatHistory, pendingActions } from '@/server/publish';
import { CommandChat } from './chat';

export const metadata: Metadata = { title: 'Comando' };
export const dynamic = 'force-dynamic';

export default async function CommandPage() {
  const [messages, actions, settings] = await Promise.all([
    chatHistory(),
    pendingActions(),
    getAllSettings(getPrisma()),
  ]);
  const simulated = settings['mode.simulation'];
  return (
    <>
      <PageHeader
        title="Comando"
        subtitle="Converse com o Diretor (Claude): ele vê a pauta, põe notícias e reacts na fila, mostra produções, métricas e custos e prepara publicações. Ações no canal só com a sua confirmação."
        actions={
          simulated ? (
            <Badge tone="warn">Modo simulado: sem custo</Badge>
          ) : (
            <Badge tone="info">Diretor real (Claude Sonnet, custa centavos)</Badge>
          )
        }
      />
      <CommandChat
        initialMessages={messages.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          state: m.state,
          tool: m.tool,
          createdAt: m.createdAt.toISOString(),
        }))}
        initialActions={actions.map((a) => ({
          id: a.id,
          kind: a.kind,
          summary: a.summary,
          status: a.status,
          result: a.result,
          createdAt: a.createdAt.toISOString(),
        }))}
        simulated={simulated}
      />
    </>
  );
}
