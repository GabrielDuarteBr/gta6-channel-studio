'use client';

import { Check, Send, Wrench, X } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import type { ActionState } from '@/components/action-form';
import { decideAction, sendChatAction } from './actions';

export interface ChatRow {
  id: string;
  role: string;
  text: string;
  state: string;
  tool: unknown;
  createdAt: string;
}
export interface ActionRow {
  id: string;
  kind: string;
  summary: string;
  status: string;
  result: string | null;
  createdAt: string;
}
interface ToolTrace {
  name: string;
  ok: boolean;
  result: string;
}

const LABELS: Record<string, string> = {
  ver_pauta: 'viu a pauta',
  produzir_noticia: 'pôs notícia na fila',
  videos_de_parceiros: 'viu vídeos de parceiros',
  produzir_react: 'pôs react na fila',
  status_producoes: 'viu as produções',
  metricas: 'leu as métricas',
  custos: 'leu os custos',
  cacar_parceiros: 'chamou o Caçador',
  pedir_publicacao: 'pediu publicação (você confirma)',
};

const SUGGESTIONS = [
  'Como está a pauta hoje?',
  'Faça um Short da melhor notícia',
  'Faça um react do vídeo novo do parceiro',
  'Como estão as produções?',
  'Quanto gastei hoje?',
];

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

function DecideButtons({ id }: { id: string }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(decideAction, {});
  return (
    <form action={run} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="actionId" value={id} />
      <Button
        type="submit"
        name="decision"
        value="confirm"
        size="sm"
        disabled={pending}
        data-testid="confirmar-pedido"
      >
        <Check /> Confirmar
      </Button>
      <Button
        type="submit"
        name="decision"
        value="reject"
        size="sm"
        variant="ghost"
        disabled={pending}
      >
        <X /> Recusar
      </Button>
      {state.error ? <span className="text-xs text-alert">{state.error}</span> : null}
    </form>
  );
}

export function CommandChat({
  initialMessages,
  initialActions,
  simulated,
}: {
  initialMessages: ChatRow[];
  initialActions: ActionRow[];
  simulated: boolean;
}) {
  const [messages, setMessages] = useState<ChatRow[]>(initialMessages);
  const [actions, setActions] = useState<ActionRow[]>(initialActions);
  const [state, send, pending] = useActionState<ActionState, FormData>(sendChatAction, {});
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource('/api/command/stream');
    es.addEventListener('messages', (e) => {
      const rows = JSON.parse((e as MessageEvent<string>).data) as ChatRow[];
      setMessages((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]));
        for (const r of rows) map.set(r.id, r);
        return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
    });
    es.addEventListener('actions', (e) => {
      setActions(JSON.parse((e as MessageEvent<string>).data) as ActionRow[]);
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    if (state.ok) setDraft('');
  }, [state]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const busy = messages.some((m) => m.role === 'assistant' && m.state === 'escrevendo');
  const pendingActions = actions.filter((a) => a.status === 'PENDING');
  const decided = actions.filter((a) => a.status !== 'PENDING').slice(0, 5);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex min-h-[60vh] flex-col rounded-2xl border border-night-700 bg-night-900/80">
        <div className="flex-1 space-y-3 overflow-y-auto p-4" data-testid="chat-mensagens">
          {messages.length === 0 ? (
            <p className="text-sm text-haze-500">
              Peça em português: &quot;faça um react do vídeo novo do parceiro X&quot;, &quot;como
              está a pauta?&quot;, &quot;quanto gastei este mês?&quot;. Publicar sempre pede a sua
              confirmação.
            </p>
          ) : null}
          {messages.map((m) => {
            const tools = (Array.isArray(m.tool) ? m.tool : []) as ToolTrace[];
            const mine = m.role === 'user';
            return (
              <div key={m.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${mine ? 'bg-neon-pink/20 text-white' : 'bg-night-800 text-haze-200'}`}
                  data-testid={mine ? 'msg-dono' : 'msg-diretor'}
                >
                  {tools.length ? (
                    <div className="mb-2 flex flex-wrap gap-1" data-testid="ferramentas">
                      {tools.map((t, i) => (
                        <Badge key={i} tone={t.ok ? 'info' : 'error'} title={t.result}>
                          <Wrench className="size-3" /> {LABELS[t.name] ?? t.name}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <p className="whitespace-pre-wrap">
                    {m.text}
                    {m.state === 'escrevendo' ? <span className="animate-pulse"> ▍</span> : null}
                  </p>
                  <p className="mt-1 text-[10px] text-haze-500">
                    {mine ? 'você' : 'Diretor'} · {time(m.createdAt)}
                    {m.state === 'erro' ? ' · erro' : ''}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
        <form action={send} className="border-t border-night-700 p-3" data-testid="form-chat">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDraft(s)}
                className="rounded-full border border-night-600 px-2.5 py-0.5 text-xs text-haze-300 hover:bg-night-800"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea
              name="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              placeholder={
                simulated ? 'Modo simulado: o Diretor responde sem custo' : 'Peça ao Diretor…'
              }
              className="flex-1 resize-none rounded-lg border border-night-600 bg-night-900 p-2 text-sm text-white focus:border-neon-cyan focus:outline-none"
              data-testid="campo-chat"
            />
            <Button
              type="submit"
              disabled={pending || busy || !draft.trim()}
              data-testid="enviar-chat"
            >
              <Send /> Enviar
            </Button>
          </div>
          {state.error ? <p className="mt-1 text-xs text-alert">{state.error}</p> : null}
        </form>
      </section>

      <aside className="space-y-3">
        <section
          className="rounded-2xl border border-night-700 bg-night-900/80 p-4"
          data-testid="pedidos"
        >
          <h2 className="text-sm font-semibold text-white">Esperando você</h2>
          <p className="mt-1 text-xs text-haze-400">
            Ações no canal que o Diretor pediu. Nada acontece sem o seu clique.
          </p>
          {pendingActions.length === 0 ? (
            <p className="mt-3 text-xs text-haze-500">Nenhum pedido.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {pendingActions.map((a) => (
                <li
                  key={a.id}
                  className="rounded-lg border border-sunset/40 p-3 text-sm"
                  data-testid="pedido"
                >
                  <p className="text-white">{a.summary}</p>
                  <DecideButtons id={a.id} />
                </li>
              ))}
            </ul>
          )}
        </section>
        {decided.length ? (
          <section className="rounded-2xl border border-night-700 bg-night-900/80 p-4">
            <h2 className="text-sm font-semibold text-white">Decididos</h2>
            <ul className="mt-2 space-y-2 text-xs text-haze-400">
              {decided.map((a) => (
                <li key={a.id} data-testid="pedido-decidido">
                  <span className="text-haze-300">{a.summary}</span> —{' '}
                  {a.status === 'CONFIRMED'
                    ? 'confirmado'
                    : a.status === 'EXPIRED'
                      ? 'expirou'
                      : 'recusado'}
                  {a.result ? ` (${a.result})` : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
