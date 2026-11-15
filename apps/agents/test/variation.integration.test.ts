import { createPrisma } from '@studio/db';
import { FakeImageProvider } from '@studio/providers';
import { createLogger } from '@studio/shared';
import { addAsset, MemoryObjectStore } from '@studio/storage';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runVariation } from '../src/production/variation';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Arte: variação de cenário', () => {
  const prisma = createPrisma(url as string);
  const store = new MemoryObjectStore();
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Asset", "RightsManifest", "CostLedger", "AuditLog", "Setting" CASCADE',
    );
  });
  afterAll(() => prisma.$disconnect());

  it('mesmo pedido + "variation N": mídia nova com manifesto, sem herdar a aprovação', async () => {
    const images = new FakeImageProvider();
    const base = await images.generate({ prompt: 'Neon beach road at dusk', aspectRatio: '16:9' });
    const { asset } = await addAsset(prisma, store, {
      bytes: base.bytes,
      title: 'Estrada neon',
      tags: ['gerada', 'aprovada'],
      origin: 'IMAGE_PROVIDER',
      manifest: {
        license: 'Gerada',
        provider: 'fake:fake-synthwave',
        prompt: 'Neon beach road at dusk',
      },
      createdBy: 'agent:diretor-arte',
    });
    const ctx = { prisma, log: createLogger('t', 'silent'), store, images };
    const r1 = await runVariation(ctx, { assetId: asset.id });
    const r2 = await runVariation(ctx, { assetId: r1.assetId });
    const v2 = await prisma.asset.findUniqueOrThrow({
      where: { id: r2.assetId },
      include: { manifest: true },
    });
    expect(v2.title).toBe('Estrada neon (variação 2)');
    expect(v2.manifest?.prompt).toBe('Neon beach road at dusk, variation 2');
    expect(v2.tags).not.toContain('aprovada');
    expect(await prisma.costLedger.count({ where: { task: 'agent:diretor-arte.variacao' } })).toBe(
      2,
    );
  });
});
