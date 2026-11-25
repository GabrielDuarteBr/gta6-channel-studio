import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, expect, it } from 'vitest';
import {
  activateArt,
  activeCharacterArt,
  ArtPackError,
  artPackRef,
  deactivateArt,
  saveArtPack,
} from '../src';
import { describeDb, resetDb, testPrisma } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.join(here, '../../../docs/modelo-arte-zeca');
const files = () =>
  readdirSync(modelDir)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(path.join(modelDir, f))) }));

describeDb('arte do artista (versões, direitos e ativação)', () => {
  const prisma = testPrisma();
  const saved = new Map<string, Uint8Array>();
  const store = {
    put: async (key: string, body: Uint8Array) => {
      saved.set(key, body);
    },
  };
  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.characterArt.deleteMany();
    saved.clear();
  });
  afterAll(() => prisma.$disconnect());

  const proof =
    'Contrato de cessão assinado em 20/11/2026 com Fulano: uso e animação do personagem em vídeos.';

  it('guarda cada camada no S3, nasce rascunho e só vira a arte em uso quando ativada', async () => {
    const r = await saveArtPack(prisma, store, {
      files: files(),
      artist: 'Fulano',
      rightsProof: proof,
    });
    expect(r.version).toBe(1);
    expect(saved.has('character-art/v1/boca-a.svg')).toBe(true);
    expect(await activeCharacterArt(prisma)).toBeNull();
    await activateArt(prisma, 1);
    const active = await activeCharacterArt(prisma);
    expect(active?.status).toBe('ACTIVE');
    const ref = artPackRef(active!);
    expect(ref.files['corpo']).toBe('character-art/v1/corpo.svg');
    expect(ref.canvas).toEqual({ w: 1500, h: 1800 });

    // segunda versão ativada: a primeira vira arquivada; voltar para a provisória desliga tudo
    await saveArtPack(prisma, store, { files: files(), artist: 'Fulano', rightsProof: proof });
    await activateArt(prisma, 2);
    expect((await prisma.characterArt.findUnique({ where: { version: 1 } }))?.status).toBe(
      'ARCHIVED',
    );
    await deactivateArt(prisma);
    expect(await activeCharacterArt(prisma)).toBeNull();
    const log = await prisma.auditLog.findMany({
      where: { action: { startsWith: 'character.art' } },
    });
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining([
        'character.art.upload',
        'character.art.activate',
        'character.art.deactivate',
      ]),
    );
  });

  it('sem prova de direitos (ou com frase vaga) e com pacote incompleto não entra', async () => {
    await expect(
      saveArtPack(prisma, store, { files: files(), artist: 'Fulano', rightsProof: 'liberado' }),
    ).rejects.toThrow(/prova de direitos/);
    const incompleto = files().filter((f) => f.name !== 'cabeca.svg');
    const err = await saveArtPack(prisma, store, {
      files: incompleto,
      artist: 'Fulano',
      rightsProof: proof,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArtPackError);
    expect((err as ArtPackError).errors).toContain('falta a camada obrigatória: cabeca');
    expect(await prisma.characterArt.count()).toBe(0);
    expect(saved.size).toBe(0);
  });
});
