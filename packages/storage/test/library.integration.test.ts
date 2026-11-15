import { createPrisma } from '@studio/db';
import { PolicyViolation } from '@studio/policy';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addAsset, MemoryObjectStore, revokeAsset } from '../src';
import { fakePng } from './fixtures';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Biblioteca: manifesto obrigatório, sem duplicar, revogação', () => {
  const prisma = createPrisma(url as string);
  const store = new MemoryObjectStore();

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Asset", "RightsManifest", "Production", "ProductionAsset", "Story", "AuditLog" CASCADE',
    );
    store.objects.clear();
  });
  afterAll(() => prisma.$disconnect());

  it('grava no S3 com nome pelo conteúdo e cria o manifesto (auditado)', async () => {
    const r = await addAsset(prisma, store, {
      bytes: fakePng(1280, 720, 1),
      title: 'Captura oficial do trailer',
      tags: ['Trailer', 'trailer', 'praia'],
      origin: 'OFFICIAL_PRESS',
      manifest: {
        license: 'Imprensa oficial — uso editorial',
        sourceUrl: 'https://www.rockstargames.com/newswire/article/abc',
        credit: 'Rockstar Games',
      },
      createdBy: 'owner',
    });
    expect(r.duplicate).toBe(false);
    expect(r.asset.storageKey).toMatch(/^library\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
    expect(r.asset.tags).toEqual(['trailer', 'praia']);
    expect([...store.objects.keys()]).toEqual([r.asset.storageKey]);
    const m = await prisma.rightsManifest.findUniqueOrThrow({ where: { assetId: r.asset.id } });
    expect(m).toMatchObject({ origin: 'OFFICIAL_PRESS', status: 'ACTIVE', credit: 'Rockstar Games' });
    expect(await prisma.auditLog.count({ where: { action: 'library.asset.add' } })).toBe(1);

    const again = await addAsset(prisma, store, {
      bytes: fakePng(1280, 720, 1),
      title: 'De novo',
      origin: 'OWNER_UPLOAD',
      manifest: { license: 'Própria', proof: 'arte minha' },
      createdBy: 'owner',
    });
    expect(again).toMatchObject({ duplicate: true, asset: { id: r.asset.id } });
  });

  it('sem manifesto válido nada é gravado', async () => {
    await expect(
      addAsset(prisma, store, {
        bytes: fakePng(1280, 720, 2),
        title: 'Corte de parceiro',
        origin: 'PARTNER',
        manifest: { license: 'cortes liberados', proof: 'mensagem' },
        createdBy: 'owner',
      }),
    ).rejects.toThrow(PolicyViolation);
    await expect(
      addAsset(prisma, store, {
        bytes: fakePng(1280, 720, 3),
        title: 'Imagem do YouTube',
        origin: 'OWNER_UPLOAD',
        manifest: { license: 'Própria', proof: 'baixei', sourceUrl: 'https://youtu.be/abc' },
        createdBy: 'owner',
      }),
    ).rejects.toThrow(/YouTube/);
    expect(store.objects.size).toBe(0);
    expect(await prisma.asset.count()).toBe(0);
  });

  it('revogar lista os vídeos que usaram a mídia', async () => {
    const { asset } = await addAsset(prisma, store, {
      bytes: fakePng(1280, 720, 4),
      title: 'Cenário gerado',
      origin: 'IMAGE_PROVIDER',
      manifest: {
        license: 'Gerada pelo provedor (termos do Google)',
        provider: 'google:imagen',
        prompt: 'Neon tropical city at dusk with palm trees',
      },
      createdBy: 'agent:diretor-arte',
    });
    const story = await prisma.story.create({ data: { title: 'História' } });
    const prod = await prisma.production.create({
      data: { storyId: story.id, format: 'LONG', title: 'Vídeo X', createdBy: 'owner' },
    });
    await prisma.productionAsset.create({
      data: { productionId: prod.id, assetId: asset.id, role: 'cena', scene: 1 },
    });
    const r = await revokeAsset(prisma, asset.id, 'pedido do dono', 'owner');
    expect(r.affectedProductions).toEqual([{ id: prod.id, title: 'Vídeo X', status: 'DRAFT' }]);
    const m = await prisma.rightsManifest.findUniqueOrThrow({ where: { assetId: asset.id } });
    expect(m.status).toBe('REVOKED');
  });
});
