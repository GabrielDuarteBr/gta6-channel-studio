'use server';

import { audit, getPrisma } from '@studio/db';
import { PolicyViolation } from '@studio/policy';
import { addAsset, ImageError, revokeAsset } from '@studio/storage';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fetchOfficialImage, ImportError, objectStore } from '@/server/library';
import { requireOwner } from '@/server/session';

export interface LibraryActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();

const metaSchema = z.object({
  title: z.string().trim().min(3, 'Dê um título (3 caracteres ou mais).').max(140),
  tags: z
    .string()
    .trim()
    .max(300)
    .transform((v) =>
      v
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  storyId: optional(40),
  license: z.string().trim().min(3, 'Informe a licença ou base de uso.').max(300),
  credit: optional(120),
  proof: optional(500),
  editorialOnly: z.boolean(),
  allowThumbnail: z.boolean(),
});

function readMeta(form: FormData) {
  return metaSchema.safeParse({
    title: form.get('title') ?? '',
    tags: form.get('tags') ?? '',
    storyId: form.get('storyId') ?? '',
    license: form.get('license') ?? '',
    credit: form.get('credit') ?? '',
    proof: form.get('proof') ?? '',
    editorialOnly: form.get('editorialOnly') === 'on',
    allowThumbnail: form.get('allowThumbnail') === 'on',
  });
}

function explain(err: unknown): string | null {
  if (err instanceof PolicyViolation) return err.message.replace(/^\[[A-Z_]+\]\s*/, '');
  if (err instanceof ImageError || err instanceof ImportError) return err.message;
  // Erro do armazenamento S3 (SeaweedFS): quase sempre disco cheio no Ubuntu/Docker.
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode;
  if (status && status >= 500) {
    return 'O armazenamento (S3) não conseguiu gravar. O disco do Ubuntu/Docker pode estar cheio: rode make diagnose.';
  }
  return null;
}

const uploadOrigins = z.enum(['OWNER_UPLOAD', 'OFFICIAL_PRESS', 'CHANNEL_OWN']);

/** Envio de arquivo pelo dono, sempre com manifesto (a política confere antes de gravar). */
export async function uploadAssetAction(
  _prev: LibraryActionState,
  form: FormData,
): Promise<LibraryActionState> {
  await requireOwner();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Escolha um arquivo de imagem.' };
  const origin = uploadOrigins.safeParse(form.get('origin'));
  if (!origin.success) return { error: 'Escolha a origem da imagem.' };
  const meta = readMeta(form);
  if (!meta.success) return { error: meta.error.issues[0]?.message ?? 'Dados inválidos.' };
  const sourceUrl = String(form.get('sourceUrl') ?? '').trim() || null;
  try {
    const r = await addAsset(getPrisma(), objectStore(), {
      bytes: new Uint8Array(await file.arrayBuffer()),
      title: meta.data.title,
      tags: meta.data.tags,
      storyId: meta.data.storyId,
      origin: origin.data,
      manifest: {
        license: meta.data.license,
        sourceUrl,
        credit: meta.data.credit,
        proof: meta.data.proof,
        restrictions: {
          editorialOnly: meta.data.editorialOnly,
          allowThumbnail: meta.data.allowThumbnail,
          mustCredit: Boolean(meta.data.credit),
        },
      },
      createdBy: 'owner',
    });
    revalidatePath('/biblioteca');
    return r.duplicate
      ? { ok: true, message: `Esse arquivo já estava na Biblioteca ("${r.asset.title}").` }
      : { ok: true, message: `"${r.asset.title}" entrou na Biblioteca com manifesto.` };
  } catch (err) {
    const msg = explain(err);
    if (msg) {
      await audit(getPrisma(), {
        actor: 'owner',
        action: 'library.asset.add',
        outcome: 'DENIED',
        details: { reason: msg, origin: origin.data },
      });
      return { error: msg };
    }
    throw err;
  }
}

/** Importa uma imagem pelo link de um site oficial (Rockstar/Take-Two). Nunca do YouTube. */
export async function importOfficialAction(
  _prev: LibraryActionState,
  form: FormData,
): Promise<LibraryActionState> {
  await requireOwner();
  const url = String(form.get('url') ?? '').trim();
  if (!url) return { error: 'Cole o link da imagem no site oficial.' };
  const meta = readMeta(form);
  if (!meta.success) return { error: meta.error.issues[0]?.message ?? 'Dados inválidos.' };
  try {
    const bytes = await fetchOfficialImage(url);
    const r = await addAsset(getPrisma(), objectStore(), {
      bytes,
      title: meta.data.title,
      tags: meta.data.tags,
      storyId: meta.data.storyId,
      origin: 'OFFICIAL_PRESS',
      manifest: {
        license: meta.data.license,
        sourceUrl: url,
        credit: meta.data.credit ?? 'Rockstar Games',
        proof: meta.data.proof,
        restrictions: {
          editorialOnly: meta.data.editorialOnly,
          allowThumbnail: meta.data.allowThumbnail,
          mustCredit: true,
        },
      },
      createdBy: 'owner',
    });
    revalidatePath('/biblioteca');
    return { ok: true, message: `"${r.asset.title}" importada do site oficial.` };
  } catch (err) {
    const msg = explain(err);
    if (msg) {
      await audit(getPrisma(), {
        actor: 'owner',
        action: 'library.asset.import',
        outcome: 'DENIED',
        details: { reason: msg, url },
      });
      return { error: msg };
    }
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'TypeError')) {
      return { error: 'Não consegui baixar a imagem (site fora do ar ou sem internet).' };
    }
    throw err;
  }
}

/** Revoga os direitos: a mídia sai dos próximos renders; mostra os vídeos que a usaram. */
export async function revokeAssetAction(
  _prev: LibraryActionState,
  form: FormData,
): Promise<LibraryActionState> {
  await requireOwner();
  const parsed = z
    .object({
      assetId: z.string().regex(/^[a-z0-9]{8,40}$/),
      reason: z.string().trim().min(3, 'Diga o motivo da revogação.').max(500),
    })
    .safeParse({ assetId: form.get('assetId'), reason: form.get('reason') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  const r = await revokeAsset(getPrisma(), parsed.data.assetId, parsed.data.reason, 'owner');
  revalidatePath('/biblioteca');
  const n = r.affectedProductions.length;
  return {
    ok: true,
    message:
      n === 0
        ? 'Direitos revogados. Nenhum vídeo usou essa mídia.'
        : `Direitos revogados. ${n} vídeo(s) usaram essa mídia: ${r.affectedProductions
            .map((p) => p.title ?? p.id)
            .join(', ')}.`,
  };
}
