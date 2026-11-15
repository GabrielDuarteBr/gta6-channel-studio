import { audit, getPrisma } from '@studio/db';
import { createQueue, deterministicJobId, redisConnection } from '@studio/queue';
import { parseEnv, redisEnvSchema } from '@studio/shared';
import { revokeAsset } from '@studio/storage';

/** Mesmo nome do job no agents (apps/agents/src/production/variation.ts). */
export const VARIATION_JOB = 'art.variation';

export async function listGenerated(take = 48) {
  const prisma = getPrisma();
  const assets = await prisma.asset.findMany({
    where: { origin: 'IMAGE_PROVIDER' },
    include: {
      manifest: true,
      story: { select: { title: true, titlePt: true } },
      _count: { select: { usages: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  });
  const cost = await prisma.costLedger.aggregate({
    _sum: { costUsd: true },
    _count: { _all: true },
    where: { provider: 'image', simulated: false },
  });
  return {
    assets,
    paidImages: cost._count._all,
    paidUsd: Number(cost._sum.costUsd ?? 0),
  };
}

export async function approveScenery(id: string, approved: boolean): Promise<void> {
  const prisma = getPrisma();
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id } });
  const tags = approved
    ? [...new Set([...asset.tags, 'aprovada'])]
    : asset.tags.filter((t) => t !== 'aprovada');
  await prisma.asset.update({ where: { id }, data: { tags } });
  await audit(prisma, {
    actor: 'owner',
    action: approved ? 'art.approve' : 'art.unapprove',
    target: id,
  });
}

export async function discardScenery(id: string): Promise<number> {
  const r = await revokeAsset(getPrisma(), id, 'descartada pelo dono na tela Arte', 'owner');
  return r.affectedProductions.length;
}

export async function requestVariation(id: string): Promise<void> {
  const { REDIS_URL } = parseEnv(redisEnvSchema);
  const queue = createQueue('image', redisConnection(REDIS_URL));
  try {
    await queue.add(
      VARIATION_JOB,
      { assetId: id },
      {
        jobId: deterministicJobId(
          'image',
          VARIATION_JOB,
          id,
          new Date().toISOString().slice(0, 16),
        ),
        attempts: 2,
      },
    );
  } finally {
    await queue.close();
  }
  await audit(getPrisma(), { actor: 'owner', action: 'art.variation.request', target: id });
}
