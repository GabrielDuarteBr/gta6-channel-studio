import { getPrisma } from '@studio/db';
import { auth } from '@/auth';
import { manualPackageText } from '@/server/publish';

/** Pacote manual: título, descrição, tags e lembretes do YouTube Studio em .txt (só o dono). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new Response('não autorizado', { status: 401 });
  const { id } = await params;
  if (!/^[a-z0-9]{8,40}$/.test(id)) return new Response('id inválido', { status: 400 });
  const pub = await getPrisma().publication.findUnique({ where: { id } });
  if (!pub) return new Response('não encontrado', { status: 404 });
  return new Response(manualPackageText(pub), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="radar-neon-${id.slice(-8)}.txt"`,
      'cache-control': 'private, no-store',
    },
  });
}
