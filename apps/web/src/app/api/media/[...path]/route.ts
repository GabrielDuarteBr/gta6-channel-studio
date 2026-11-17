import { parseEnv, serviceUrlsEnvSchema } from '@studio/shared';
import { auth } from '@/auth';

/**
 * Entrega ao navegador do dono os vídeos/áudios gerados (pasta de trabalho do render,
 * que só existe na rede interna). Exige login; só clipes e saídas de produção; repassa Range
 * para o player poder avançar e voltar.
 */
const ALLOWED = new RegExp(
  [
    '^clips/[0-9a-f]{16}/[A-Za-z0-9_-]{1,40}\\.(mp4|wav)$',
    // Fase 3: vídeo e thumbnails de cada volta de uma produção
    '^productions/[a-z0-9]{8,40}/r[0-9]{1,2}/(video\\.mp4|react\\.mp4|thumb-[1-3]\\.png)$',
    // Fase 4: prévia dos vídeos de parceiros (cópia de trabalho, nome pelo conteúdo)
    '^partners/[0-9a-f]{64}\\.(mp4|webm|mov)$',
  ].join('|'),
);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new Response('não autorizado', { status: 401 });
  const relative = (await params).path.join('/');
  if (!ALLOWED.test(relative)) return new Response('caminho inválido', { status: 400 });

  const { RENDER_URL } = parseEnv(serviceUrlsEnvSchema);
  const range = req.headers.get('range');
  const upstream = await fetch(`${RENDER_URL}/work/${relative}`, {
    headers: range ? { range } : {},
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    return new Response('arquivo indisponível', { status: upstream?.status ?? 502 });
  }
  const headers = new Headers({ 'cache-control': 'private, max-age=300' });
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
