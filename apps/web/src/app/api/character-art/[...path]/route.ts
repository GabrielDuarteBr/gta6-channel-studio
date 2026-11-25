import { artFiles, getPrisma } from '@studio/db';
import { auth } from '@/auth';
import { objectStore } from '@/server/library';

/**
 * Camadas da arte do artista para a prévia do painel (só o dono): /api/character-art/v3/corpo.png
 * e a prova de direitos: /api/character-art/v3/prova. SVG vai com CSP "sandbox" (nada roda).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new Response('não autorizado', { status: 401 });
  const [v, file] = (await params).path;
  const version = /^v(\d{1,5})$/.exec(v ?? '')?.[1];
  if (!version || !file) return new Response('caminho inválido', { status: 400 });
  const row = await getPrisma().characterArt.findUnique({ where: { version: Number(version) } });
  if (!row) return new Response('não encontrado', { status: 404 });

  let key: string;
  let mime = 'application/octet-stream';
  let download: string | null = null;
  if (file === 'prova') {
    if (!row.proofKey) return new Response('sem arquivo de prova', { status: 404 });
    key = row.proofKey;
    mime = row.proofMime ?? mime;
    download = `prova-de-direitos-v${row.version}${row.proofKey.slice(row.proofKey.lastIndexOf('.'))}`;
  } else {
    if (!/^[a-z0-9_-]+\.(png|svg)$/.test(file))
      return new Response('camada inexistente', { status: 404 });
    const entry = Object.values(artFiles(row)).find((f) => f.key.endsWith(`/${file}`));
    if (!entry) return new Response('camada inexistente', { status: 404 });
    key = entry.key;
    mime = entry.mime;
  }
  const bytes = await objectStore().get(key);
  const headers = new Headers({
    'content-type': mime,
    'cache-control': 'private, max-age=3600',
    'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  });
  if (download) headers.set('content-disposition', `attachment; filename="${download}"`);
  return new Response(new Uint8Array(bytes), { headers });
}
