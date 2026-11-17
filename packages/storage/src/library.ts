import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { audit, type Asset, type AssetOrigin, type Prisma, type PrismaClient } from '@studio/db';
import { assertManifestInput, PolicyViolation, type PermissionState } from '@studio/policy';
import { sniffImage } from './image';
import type { ObjectStore } from './object-store';

/**
 * Biblioteca: toda mídia entra com manifesto de direitos (regras 1 e 2). O arquivo vai para o
 * S3 com nome pelo conteúdo (sha256), então o mesmo arquivo nunca é guardado duas vezes.
 */

export interface ManifestFields {
  license: string;
  sourceUrl?: string | null;
  proof?: string | null;
  credit?: string | null;
  provider?: string | null;
  prompt?: string | null;
  restrictions?: { editorialOnly?: boolean; allowThumbnail?: boolean; mustCredit?: boolean };
  expiresAt?: Date | null;
}

export interface NewAssetInput {
  bytes: Uint8Array;
  title: string;
  description?: string | null;
  tags?: string[];
  storyId?: string | null;
  origin: AssetOrigin;
  manifest: ManifestFields;
  /** "owner" | "agent:diretor-arte" ... */
  createdBy: string;
}

export interface AddAssetResult {
  asset: Asset;
  /** O mesmo arquivo já estava na Biblioteca (nada novo foi gravado). */
  duplicate: boolean;
}

export function libraryKey(sha256: string, ext: string): string {
  return `library/${sha256.slice(0, 2)}/${sha256}.${ext}`;
}

const cleanTags = (tags: string[] = []) =>
  [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);

export async function addAsset(
  prisma: PrismaClient,
  store: ObjectStore,
  input: NewAssetInput,
): Promise<AddAssetResult> {
  // Política antes de tudo: manifesto válido para a origem (lança PolicyViolation).
  assertManifestInput({ origin: input.origin, ...input.manifest });
  const info = sniffImage(input.bytes);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');

  const existing = await prisma.asset.findUnique({ where: { sha256 } });
  if (existing) return { asset: existing, duplicate: true };

  const storageKey = libraryKey(sha256, info.ext);
  await store.put(storageKey, input.bytes, info.mime);
  const m = input.manifest;
  const asset = await prisma.asset.create({
    data: {
      kind: 'IMAGE',
      origin: input.origin,
      title: input.title.trim().slice(0, 140),
      description: input.description?.trim().slice(0, 1000) || null,
      tags: cleanTags(input.tags),
      storageKey,
      sha256,
      mime: info.mime,
      width: info.width,
      height: info.height,
      bytes: input.bytes.byteLength,
      storyId: input.storyId ?? null,
      createdBy: input.createdBy,
      manifest: {
        create: {
          origin: input.origin,
          license: m.license.trim(),
          sourceUrl: m.sourceUrl || null,
          proof: m.proof?.trim() || null,
          credit: m.credit?.trim() || null,
          provider: m.provider || null,
          prompt: m.prompt || null,
          ...(m.restrictions ? { restrictions: m.restrictions as Prisma.InputJsonValue } : {}),
          expiresAt: m.expiresAt ?? null,
          createdBy: input.createdBy,
        },
      },
    },
  });
  await audit(prisma, {
    actor: input.createdBy,
    action: 'library.asset.add',
    target: asset.id,
    details: { origin: input.origin, mime: info.mime, bytes: input.bytes.byteLength },
  });
  return { asset, duplicate: false };
}

/** sha256 de um arquivo, em fluxo (vídeos grandes). */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
};

export interface NewVideoInput {
  /** Caminho absoluto do arquivo (na pasta de trabalho). */
  filePath: string;
  ext: keyof typeof VIDEO_MIME;
  title: string;
  originalName?: string | null;
  origin: 'PARTNER' | 'OWNER_UPLOAD' | 'CHANNEL_OWN';
  partnerId?: string | null;
  durationSec: number;
  width: number;
  height: number;
  manifest: ManifestFields & {
    permissionId?: string | null;
    permission?: PermissionState | null;
  };
  createdBy: string;
}

/**
 * Vídeo na Biblioteca (Fase 4): mesmo manifesto obrigatório das imagens, arquivo no S3 em
 * fluxo, nome pelo conteúdo. Parceiro só com permissão ativa (assertManifestInput).
 */
export async function addVideoAsset(
  prisma: PrismaClient,
  store: ObjectStore,
  input: NewVideoInput,
): Promise<AddAssetResult & { sha256: string }> {
  assertManifestInput({ origin: input.origin, ...input.manifest });
  const mime = VIDEO_MIME[input.ext];
  if (!mime) throw new Error(`extensão de vídeo não aceita: ${input.ext}`);
  const sha256 = await sha256File(input.filePath);
  const existing = await prisma.asset.findUnique({ where: { sha256 } });
  if (existing) {
    if (existing.partnerId !== (input.partnerId ?? null) || existing.origin !== input.origin) {
      // O mesmo arquivo com outro dono de direitos: conflito que só o dono resolve.
      throw new PolicyViolation(
        'PARTNER_PERMISSION_ACTIVE',
        `Este arquivo já está na Biblioteca como "${existing.title}", de outra origem ou de outro parceiro.`,
      );
    }
    return { asset: existing, duplicate: true, sha256 };
  }
  const bytes = (await stat(input.filePath)).size;
  const storageKey = libraryKey(sha256, input.ext);
  if (!(await store.head(storageKey))) {
    await store.putStream(storageKey, createReadStream(input.filePath), bytes, mime);
  }
  const m = input.manifest;
  const asset = await prisma.asset.create({
    data: {
      kind: 'VIDEO',
      origin: input.origin,
      title: input.title.trim().slice(0, 140) || 'Vídeo',
      originalName: input.originalName?.slice(0, 200) ?? null,
      storageKey,
      sha256,
      mime,
      width: input.width,
      height: input.height,
      bytes: Math.min(bytes, 2_147_483_647),
      durationSec: input.durationSec,
      partnerId: input.partnerId ?? null,
      analysisStatus: 'PENDING',
      createdBy: input.createdBy,
      manifest: {
        create: {
          origin: input.origin,
          license: m.license.trim(),
          sourceUrl: m.sourceUrl || null,
          proof: m.proof?.trim() || null,
          credit: m.credit?.trim() || null,
          ...(m.restrictions ? { restrictions: m.restrictions as Prisma.InputJsonValue } : {}),
          expiresAt: m.expiresAt ?? null,
          permissionId: m.permissionId ?? null,
          createdBy: input.createdBy,
        },
      },
    },
  });
  await audit(prisma, {
    actor: input.createdBy,
    action: 'library.video.add',
    target: asset.id,
    details: { origin: input.origin, partnerId: input.partnerId ?? null, bytes, mime },
  });
  return { asset, duplicate: false, sha256 };
}

export interface RevokeResult {
  /** Vídeos que usaram a mídia (para o dono decidir o que fazer). */
  affectedProductions: Array<{ id: string; title: string | null; status: string }>;
}

/** Revoga os direitos de uma mídia: sai de qualquer render novo e lista os vídeos afetados. */
export async function revokeAsset(
  prisma: PrismaClient,
  assetId: string,
  reason: string,
  actor: string,
): Promise<RevokeResult> {
  await prisma.rightsManifest.update({
    where: { assetId },
    data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason.slice(0, 500) },
  });
  const usages = await prisma.productionAsset.findMany({
    where: { assetId },
    include: { production: { select: { id: true, title: true, status: true } } },
  });
  const affected = [...new Map(usages.map((u) => [u.production.id, u.production])).values()];
  await audit(prisma, {
    actor,
    action: 'library.asset.revoke',
    target: assetId,
    details: { reason, affected: affected.map((p) => p.id) },
  });
  return { affectedProductions: affected };
}
