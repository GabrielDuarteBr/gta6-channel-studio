import { getPrisma } from '@studio/db';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

/**
 * Streaming do Comando (SSE): manda as mensagens que mudaram (o agents vai escrevendo a resposta
 * do Diretor no banco) e os pedidos esperando confirmação. Fecha sozinho depois de 5 min; o
 * navegador reconecta.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new Response('não autorizado', { status: 401 });
  const prisma = getPrisma();
  let since = new Date(Date.now() - 5_000);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const started = Date.now();
      let lastActions = '';
      try {
        while (!req.signal.aborted && Date.now() - started < 5 * 60_000) {
          const changed = await prisma.chatMessage.findMany({
            where: { updatedAt: { gt: since } },
            orderBy: { updatedAt: 'asc' },
            take: 50,
          });
          if (changed.length) {
            since = changed.at(-1)!.updatedAt;
            send('messages', changed);
          }
          const actions = await prisma.pendingAction.findMany({
            orderBy: { createdAt: 'desc' },
            take: 20,
          });
          const sig = actions.map((a) => `${a.id}:${a.status}`).join(',');
          if (sig !== lastActions) {
            lastActions = sig;
            send('actions', actions);
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch {
        // conexão caiu: o navegador reconecta
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
