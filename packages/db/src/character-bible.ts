import { DEFAULT_BIBLE, validateBible, type CharacterBible } from '@studio/avatar';
import { audit } from './audit';
import type { Prisma, PrismaClient } from './generated/prisma/client';

export interface BibleVersion {
  version: number;
  content: CharacterBible;
  note: string | null;
  createdBy: string;
  createdAt: Date;
}

/** Bíblia ativa = a versão mais alta. Sem nenhuma no banco, a padrão (versão 0). */
export async function activeBible(db: PrismaClient): Promise<BibleVersion> {
  const row = await db.characterBible.findFirst({ orderBy: { version: 'desc' } });
  if (!row) {
    return {
      version: 0,
      content: DEFAULT_BIBLE,
      note: null,
      createdBy: 'system',
      createdAt: new Date(0),
    };
  }
  return {
    version: row.version,
    content: validateBible(row.content),
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export async function listBibleVersions(
  db: PrismaClient,
  take = 30,
): Promise<Array<Omit<BibleVersion, 'content'>>> {
  return db.characterBible.findMany({
    orderBy: { version: 'desc' },
    take,
    select: { version: true, note: true, createdBy: true, createdAt: true },
  });
}

/** Cria uma versão nova (valida, numera e audita). Nunca sobrescreve uma versão. */
export async function saveBibleVersion(
  db: PrismaClient,
  input: unknown,
  actor: string,
  note?: string,
): Promise<number> {
  const content = validateBible(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await db.characterBible.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    try {
      await db.characterBible.create({
        data: {
          version,
          content: content as unknown as Prisma.InputJsonValue,
          note: note?.slice(0, 200) ?? null,
          createdBy: actor,
        },
      });
      await audit(db, {
        actor,
        action: 'bible.version',
        target: `v${version}`,
        details: { version, note: note ?? null },
      });
      return version;
    } catch (err) {
      // Duas edições ao mesmo tempo: a outra levou o número; tenta o próximo.
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }
  throw new Error('não consegui salvar a bíblia (conflito de versão)');
}

/** Primeira subida: grava a bíblia padrão como versão 1. */
export async function ensureBible(db: PrismaClient): Promise<number | null> {
  if ((await db.characterBible.count()) > 0) return null;
  return saveBibleVersion(db, DEFAULT_BIBLE, 'system', 'bíblia inicial do Zeca Neon');
}
