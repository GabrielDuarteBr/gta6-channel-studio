'use server';

import { audit, getPrisma } from '@studio/db';
import { isBlockedMediaHost } from '@studio/policy';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireOwner } from '@/server/session';

export interface SourceActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

function httpsUrlNotYouTube(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !isBlockedMediaHost(u.hostname);
  } catch {
    return false;
  }
}

const addSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    kind: z.enum(['RSS', 'PAGE', 'YOUTUBE_CHANNEL']),
    tier: z.enum(['OFFICIAL', 'PRESS', 'COMMUNITY']),
    language: z.string().trim().min(2).max(10),
    url: z.string().trim().min(2).max(300),
    linkPattern: z.string().trim().max(120).optional(),
    gtaOnly: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'YOUTUBE_CHANNEL') {
      if (!/^@[A-Za-z0-9._-]{3,100}$/.test(v.url)) {
        ctx.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'Para canal do YouTube, use o @handle (ex.: @RockstarGames).',
        });
      }
    } else if (!httpsUrlNotYouTube(v.url)) {
      // Regra 1: o YouTube só entra pela Data API (metadados), nunca por feed/página.
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Use um endereço https que não seja do YouTube (YouTube só como canal, pela API).',
      });
    }
    if (v.kind === 'PAGE' && !v.linkPattern) {
      ctx.addIssue({
        code: 'custom',
        path: ['linkPattern'],
        message: 'Página sem feed precisa do padrão de link dos artigos (ex.: /noticias/).',
      });
    }
    if (v.linkPattern) {
      try {
        new RegExp(v.linkPattern);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['linkPattern'],
          message: 'Padrão de link inválido.',
        });
      }
    }
  });

export async function addSourceAction(
  _prev: SourceActionState,
  form: FormData,
): Promise<SourceActionState> {
  await requireOwner();
  const parsed = addSchema.safeParse({
    name: form.get('name'),
    kind: form.get('kind'),
    tier: form.get('tier'),
    language: form.get('language'),
    url: form.get('url'),
    linkPattern: (form.get('linkPattern') as string) || undefined,
    gtaOnly: form.get('gtaOnly') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  const v = parsed.data;
  const prisma = getPrisma();
  const source = await prisma.source.create({
    data: {
      name: v.name,
      kind: v.kind,
      tier: v.tier,
      language: v.language,
      url: v.url,
      config: { ...(v.linkPattern ? { linkPattern: v.linkPattern } : {}), gtaOnly: v.gtaOnly },
    },
  });
  await audit(prisma, {
    actor: 'owner',
    action: 'source.create',
    target: source.id,
    details: { name: v.name, url: v.url, tier: v.tier },
  });
  revalidatePath('/pauta/fontes');
  return { ok: true, message: `Fonte "${v.name}" adicionada. Ela entra na próxima coleta.` };
}

const idSchema = z.string().min(1).max(40);

export async function toggleSourceAction(form: FormData): Promise<void> {
  await requireOwner();
  const id = idSchema.parse(form.get('id'));
  const enabled = form.get('enabled') === 'true';
  const prisma = getPrisma();
  await prisma.source.update({ where: { id }, data: { enabled } });
  await audit(prisma, {
    actor: 'owner',
    action: enabled ? 'source.enable' : 'source.disable',
    target: id,
  });
  revalidatePath('/pauta/fontes');
}

export async function updateSourceUrlAction(
  _prev: SourceActionState,
  form: FormData,
): Promise<SourceActionState> {
  await requireOwner();
  const id = idSchema.parse(form.get('id'));
  const url = String(form.get('url') ?? '').trim();
  const prisma = getPrisma();
  const source = await prisma.source.findUnique({ where: { id } });
  if (!source) return { error: 'Fonte não encontrada.' };
  const valid = source.kind.startsWith('YOUTUBE')
    ? /^(@[A-Za-z0-9._-]{3,100}|.{2,100})$/.test(url)
    : httpsUrlNotYouTube(url);
  if (!valid) return { error: 'Endereço inválido (https e fora do YouTube).' };
  // URL nova: zera o feed descoberto e o cache HTTP.
  await prisma.source.update({
    where: { id },
    data: { url, resolved: undefined, etag: null, lastModified: null },
  });
  await audit(prisma, {
    actor: 'owner',
    action: 'source.update',
    target: id,
    details: { from: source.url, to: url },
  });
  revalidatePath('/pauta/fontes');
  return { ok: true, message: 'Endereço atualizado.' };
}

export async function deleteSourceAction(form: FormData): Promise<void> {
  await requireOwner();
  const id = idSchema.parse(form.get('id'));
  const prisma = getPrisma();
  const source = await prisma.source.findUnique({ where: { id } });
  if (!source || source.builtIn) return; // fontes padrão só podem ser desativadas
  await prisma.source.delete({ where: { id } });
  await audit(prisma, {
    actor: 'owner',
    action: 'source.delete',
    target: id,
    details: { name: source.name },
  });
  revalidatePath('/pauta/fontes');
}
