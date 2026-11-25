import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { activateArt, createPrisma, saveArtPack } from '@studio/db';
import { MemoryObjectStore } from '@studio/storage';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { artForRender } from '../src/character/art';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.join(here, '../../../docs/modelo-arte-zeca');

d('arte do artista no render (cópia para a pasta de trabalho)', () => {
  const prisma = createPrisma(url as string);
  let work: string;
  beforeEach(async () => {
    await prisma.characterArt.deleteMany();
    work = await mkdtemp(path.join(os.tmpdir(), 'arte-'));
  });
  afterAll(async () => {
    // Não deixa arte ativa para os outros testes (que usam armazenamento em memória vazio).
    await prisma.characterArt.deleteMany();
    await prisma.$disconnect();
    if (work) await rm(work, { recursive: true, force: true });
  });

  it('sem arte ativa: null (arte provisória); ativa: camadas copiadas e referência pronta', async () => {
    const store = new MemoryObjectStore();
    expect(await artForRender(prisma, store, { workRoot: work })).toBeNull();
    const files = readdirSync(modelDir)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(path.join(modelDir, f))) }));
    const { version } = await saveArtPack(prisma, store, {
      files,
      artist: 'Fulano',
      rightsProof: 'Contrato de cessão assinado em 20/11/2026: uso e animação em vídeos.',
    });
    // rascunho pode ser testado no clipe pedindo a versão; o render normal só usa a ativa
    expect(await artForRender(prisma, store, { workRoot: work })).toBeNull();
    const draft = await artForRender(prisma, store, { workRoot: work, version });
    expect(draft?.version).toBe(version);
    await activateArt(prisma, version);
    const ref = await artForRender(prisma, store, { workRoot: work });
    expect(ref?.files['boca-D']).toBe(`character-art/v${version}/boca-d.svg`);
    const copied = await readFile(path.join(work, ref!.files['boca-D']!), 'utf8');
    expect(copied).toContain('<svg');
    // segunda chamada não baixa de novo (mesmo tamanho)
    const before = (await stat(path.join(work, ref!.files['corpo']!))).mtimeMs;
    await artForRender(prisma, store, { workRoot: work });
    expect((await stat(path.join(work, ref!.files['corpo']!))).mtimeMs).toBe(before);
  });
});
