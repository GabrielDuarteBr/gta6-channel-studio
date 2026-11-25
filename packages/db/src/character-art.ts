import { createHash } from 'node:crypto';
import {
  checkArtFiles,
  DEFAULT_PIVOTS,
  pivotsSchema,
  type ArtFileInput,
  type ArtPackRef,
  type ArtPivots,
} from '@studio/avatar';
import { audit } from './audit';
import type { CharacterArt, Prisma, PrismaClient } from './generated/prisma/client';

/**
 * Arte autoral do personagem em camadas (Fase 2 → arte definitiva). O pacote é conferido
 * (checkArtFiles), cada camada vai para o S3 em character-art/v<versão>/ e a versão nasce como
 * RASCUNHO. O dono vê a prévia e ativa; só uma ativa por vez. A prova de direitos é obrigatória.
 */

export interface ArtFileEntry {
  key: string;
  ext: 'png' | 'svg';
  mime: string;
  bytes: number;
  sha256: string;
}

/** O que o pacote precisa para gravar (S3 injetado: o painel e os testes usam o seu). */
export interface ArtStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export class ArtPackError extends Error {
  override name = 'ArtPackError';
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
  }
}

/** Frase vaga não é prova de direitos (mesma ideia da permissão de parceiro). */
const VAGUE = /^(ok|sim|liberad[oa]|autorizad[oa]|pode usar|tudo certo)\.?$/i;

export async function saveArtPack(
  db: PrismaClient,
  store: ArtStore,
  input: {
    files: ArtFileInput[];
    artist: string;
    rightsProof: string;
    proof?: { bytes: Uint8Array; mime: string; ext: string } | null;
    pivots?: ArtPivots;
    actor?: string;
  },
): Promise<{ id: string; version: number; warnings: string[] }> {
  const artist = input.artist.trim();
  const rightsProof = input.rightsProof.trim();
  if (artist.length < 2) throw new ArtPackError('Informe o nome do artista.');
  if (rightsProof.length < 20 || VAGUE.test(rightsProof)) {
    throw new ArtPackError(
      'Descreva a prova de direitos (contrato de cessão ou licença: quem cedeu, data e o que pode ser feito).',
    );
  }
  const pivots = pivotsSchema.parse(input.pivots ?? DEFAULT_PIVOTS);
  const check = checkArtFiles(input.files);
  if (!check.ok || !check.canvas) {
    throw new ArtPackError('O pacote de arte tem problemas.', check.errors);
  }
  const last = await db.characterArt.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;
  const files: Record<string, ArtFileEntry> = {};
  for (const l of check.layers) {
    // Nomes de arquivo em minúsculas (boca-A → boca-a): o S3 e a pasta de trabalho só aceitam assim.
    const key = `character-art/v${version}/${artFileName(l.layer, l.ext)}`;
    await store.put(key, l.file.bytes, l.mime);
    files[l.layer] = {
      key,
      ext: l.ext,
      mime: l.mime,
      bytes: l.file.bytes.byteLength,
      sha256: createHash('sha256').update(l.file.bytes).digest('hex'),
    };
  }
  let proofKey: string | null = null;
  if (input.proof) {
    proofKey = `character-art/v${version}/prova-de-direitos.${input.proof.ext}`;
    await store.put(proofKey, input.proof.bytes, input.proof.mime);
  }
  const row = await db.characterArt.create({
    data: {
      version,
      artist,
      rightsProof,
      proofKey,
      proofMime: input.proof?.mime ?? null,
      canvasWidth: check.canvas.w,
      canvasHeight: check.canvas.h,
      files: files as unknown as Prisma.InputJsonValue,
      pivots: pivots as unknown as Prisma.InputJsonValue,
      warnings: check.warnings,
      createdBy: input.actor ?? 'owner',
    },
  });
  await audit(db, {
    actor: input.actor ?? 'owner',
    action: 'character.art.upload',
    target: `v${version}`,
    details: { artist, layers: Object.keys(files).length, canvas: check.canvas },
  });
  return { id: row.id, version, warnings: check.warnings };
}

/** Ativa uma versão (a ativa anterior vira arquivada). */
export async function activateArt(db: PrismaClient, version: number, actor = 'owner') {
  await db.$transaction([
    db.characterArt.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'ARCHIVED' } }),
    db.characterArt.update({
      where: { version },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    }),
  ]);
  await audit(db, { actor, action: 'character.art.activate', target: `v${version}` });
}

/** Volta para a arte provisória (nenhuma ativa). */
export async function deactivateArt(db: PrismaClient, actor = 'owner') {
  await db.characterArt.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
  await audit(db, { actor, action: 'character.art.deactivate' });
}

export function activeCharacterArt(db: PrismaClient): Promise<CharacterArt | null> {
  return db.characterArt.findFirst({ where: { status: 'ACTIVE' } });
}

/** Nome do arquivo de uma camada (minúsculas). */
export function artFileName(layer: string, ext: string): string {
  return `${layer.toLowerCase()}.${ext}`;
}

export function artFiles(row: CharacterArt): Record<string, ArtFileEntry> {
  return row.files as unknown as Record<string, ArtFileEntry>;
}

/** Referência para o render/painel: cada camada → "<prefixo>/<camada>.<ext>". */
export function artPackRef(
  row: CharacterArt,
  prefix = `character-art/v${row.version}`,
): ArtPackRef {
  const files: Record<string, string> = {};
  for (const [layer, f] of Object.entries(artFiles(row))) {
    files[layer] = `${prefix}/${artFileName(layer, f.ext)}`;
  }
  return {
    version: row.version,
    canvas: { w: row.canvasWidth, h: row.canvasHeight },
    files,
    pivots: pivotsSchema.parse(row.pivots),
  };
}
