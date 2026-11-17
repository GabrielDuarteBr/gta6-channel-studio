import { getPrisma } from '@studio/db';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

/** Avisa o navegador (SSE) quando alguma produção ou publicação muda, para o kanban atualizar. */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new Response('não autorizado', { status: 401 });
  const prisma = getPrisma();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = '';
      const started = Date.now();
      try {
        while (!req.signal.aborted && Date.now() - started < 5 * 60_000) {
          const [p, q] = await Promise.all([
            prisma.production.aggregate({ _max: { updatedAt: true }, _count: true }),
            prisma.publication.aggregate({ _max: { updatedAt: true }, _count: true }),
          ]);
          const sig = `${p._count}:${p._max.updatedAt?.getTime()}:${q._count}:${q._max.updatedAt?.getTime()}`;
          if (last && sig !== last)
            controller.enqueue(encoder.encode(`event: change\ndata: ${sig}\n\n`));
          last = sig;
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch {
        // o navegador reconecta
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
