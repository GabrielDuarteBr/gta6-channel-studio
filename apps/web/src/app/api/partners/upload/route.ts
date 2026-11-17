import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { getAllSettings, getPrisma } from '@studio/db';
import { PolicyViolation } from '@studio/policy';
import { auth } from '@/auth';
import { objectStore } from '@/server/library';
import { importFromUpload } from '@/server/partners';

/**
 * Envio de vídeo do parceiro pelo painel. O corpo vai em fluxo direto para o S3 (sem passar
 * pela memória nem pelo limite do proxy: esta rota fica fora dele e confere a sessão aqui).
 * Depois o agents confere a permissão de novo, o tipo do arquivo e guarda na Biblioteca.
 */
const ID = /^[a-z0-9]{8,40}$/;

async function owner(): Promise<boolean> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return false;
  const user = await getPrisma().user.findUnique({
    where: { id },
    select: { sessionVersion: true },
  });
  return Boolean(
    user && user.sessionVersion === (session as { sessionVersion?: number }).sessionVersion,
  );
}

const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function POST(req: Request): Promise<Response> {
  if (!(await owner())) return fail(401, 'faça login de novo');
  const url = new URL(req.url);
  const partnerId = url.searchParams.get('partnerId') ?? '';
  const permissionId = url.searchParams.get('permissionId') ?? '';
  const name = (url.searchParams.get('name') ?? 'video').slice(0, 200);
  const title = url.searchParams.get('title')?.trim().slice(0, 140) || null;
  if (!ID.test(partnerId) || !ID.test(permissionId))
    return fail(400, 'parceiro ou permissão inválidos');
  const type = req.headers.get('content-type') ?? '';
  if (type && !type.startsWith('video/') && type !== 'application/octet-stream') {
    return fail(415, 'envie um arquivo de vídeo (mp4, mov, mkv ou webm)');
  }
  const length = Number(req.headers.get('content-length') ?? 0);
  const { partners } = await getAllSettings(getPrisma());
  if (!length) return fail(411, 'tamanho do arquivo desconhecido');
  if (length > partners.maxImportMb * 1_048_576) {
    return fail(
      413,
      `arquivo maior que ${partners.maxImportMb} MB (mude em Configurações → Parceiros)`,
    );
  }
  if (!req.body) return fail(400, 'arquivo vazio');
  const key = `incoming/${randomUUID()}.bin`;
  try {
    await objectStore().putStream(
      key,
      Readable.fromWeb(req.body as unknown as WebReadableStream),
      length,
      'application/octet-stream',
    );
    const importId = await importFromUpload({
      partnerId,
      permissionId,
      incomingKey: key,
      originalName: name,
      title,
    });
    return new Response(JSON.stringify({ importId }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    await objectStore()
      .delete(key)
      .catch(() => undefined);
    if (err instanceof PolicyViolation)
      return fail(403, err.message.replace(/^\[[A-Z_]+\]\s*/, ''));
    return fail(500, 'não consegui guardar o arquivo (veja Saúde e custos e o espaço em disco)');
  }
}
