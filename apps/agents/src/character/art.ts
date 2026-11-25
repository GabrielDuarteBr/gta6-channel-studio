import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArtPackRef } from '@studio/avatar';
import { activeCharacterArt, artFiles, artPackRef, type PrismaClient } from '@studio/db';
import { WORK_ROOT } from '../partners/download';

/**
 * Arte do personagem para o render: a versão ATIVA (ou a pedida, para o clipe de teste de um
 * rascunho) é copiada do S3 para a pasta de trabalho (character-art/v<versão>/), que o render
 * enxerga. Sem arte ativa → null (o render usa a arte provisória).
 */
export async function artForRender(
  prisma: PrismaClient,
  store: { get(key: string): Promise<Uint8Array> },
  opts: { version?: number; workRoot?: string } = {},
): Promise<ArtPackRef | null> {
  const row = opts.version
    ? await prisma.characterArt.findUnique({ where: { version: opts.version } })
    : await activeCharacterArt(prisma);
  if (!row) return null;
  const root = opts.workRoot ?? WORK_ROOT;
  const ref = artPackRef(row);
  for (const [layer, f] of Object.entries(artFiles(row))) {
    const target = path.join(root, ref.files[layer]!);
    const current = await stat(target).catch(() => null);
    if (current?.size === f.bytes) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await store.get(f.key));
  }
  return ref;
}
