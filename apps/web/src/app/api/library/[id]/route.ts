import { getPrisma } from '@studio/db';
import { auth } from '@/auth';
import { objectStore } from '@/server/library';

/** Entrega ao dono a imagem de uma mídia da Biblioteca (o S3 só existe na rede interna). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new Response('não autorizado', { status: 401 });
  const { id } = await params;
  if (!/^[a-z0-9]{8,40}$/.test(id)) return new Response('id inválido', { status: 400 });
  const asset = await getPrisma().asset.findUnique({
    where: { id },
    select: { storageKey: true, mime: true },
  });
  if (!asset) return new Response('não encontrada', { status: 404 });
  const bytes = await objectStore()
    .get(asset.storageKey)
    .catch(() => null);
  if (!bytes) return new Response('arquivo indisponível', { status: 502 });
  return new Response(new Blob([new Uint8Array(bytes)], { type: asset.mime }), {
    headers: {
      'content-type': asset.mime,
      'cache-control': 'private, max-age=3600, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
