import { audit, getAllSettings, type PrismaClient } from '@studio/db';
import { assertWithinBudget } from '@studio/llm';
import { createImageProvider, type ImageProvider } from '@studio/providers';
import { channelDay, type Logger } from '@studio/shared';
import { addAsset, type ObjectStore } from '@studio/storage';
import { z } from 'zod';
import { budgetStatus } from '../research/ledger';
import { providerTag } from './art';

/** Tela Arte: "gerar variação" de um cenário (mesmo pedido, outra composição). */
export const VARIATION_JOB = 'art.variation';
export const variationJobSchema = z.object({ assetId: z.string().min(8).max(40) });

export interface VariationContext {
  prisma: PrismaClient;
  log: Logger;
  store: ObjectStore;
  geminiKey?: string | undefined;
  images?: ImageProvider;
}

export async function runVariation(ctx: VariationContext, raw: unknown) {
  const { assetId } = variationJobSchema.parse(raw);
  const { prisma } = ctx;
  const settings = await getAllSettings(prisma);
  const base = await prisma.asset.findUniqueOrThrow({
    where: { id: assetId },
    include: { manifest: true },
  });
  if (base.origin !== 'IMAGE_PROVIDER' || !base.manifest?.prompt) {
    throw new Error('só imagens geradas têm variação');
  }
  const images =
    ctx.images ??
    createImageProvider(settings['mode.simulation'] ? 'fake' : settings.images.provider, {
      apiKey: ctx.geminiKey,
      model: settings.images.model,
    });
  const root = base.manifest.prompt.replace(/, variation \d+$/, '');
  const siblings = await prisma.rightsManifest.count({
    where: { prompt: { startsWith: `${root}, variation ` } },
  });
  const prompt = `${root}, variation ${siblings + 1}`;
  if (images.real) {
    const b = await budgetStatus(prisma);
    assertWithinBudget({
      ...b,
      spentTodayUsd: b.spentTodayUsd + 0.07,
      spentMonthUsd: b.spentMonthUsd + 0.07,
    });
  }
  const img = await images.generate({
    prompt,
    aspectRatio: (base.width ?? 16) >= (base.height ?? 9) ? '16:9' : '9:16',
  });
  const added = await addAsset(prisma, ctx.store, {
    bytes: img.bytes,
    title: `${base.title.replace(/ \(variação \d+\)$/, '')} (variação ${siblings + 1})`,
    tags: [...new Set([...base.tags.filter((t) => t !== 'aprovada'), 'variação'])],
    storyId: base.storyId,
    origin: 'IMAGE_PROVIDER',
    manifest: {
      license: base.manifest.license,
      provider: providerTag(images),
      prompt,
      restrictions: { editorialOnly: false, allowThumbnail: true, mustCredit: false },
    },
    createdBy: 'agent:diretor-arte',
  });
  await prisma.costLedger.create({
    data: {
      dayKey: channelDay(),
      provider: 'image',
      model: img.model,
      task: 'agent:diretor-arte.variacao',
      units: 1,
      costUsd: img.costUsd,
      simulated: !images.real,
    },
  });
  await audit(prisma, {
    actor: 'agent:diretor-arte',
    action: 'art.variation',
    target: added.asset.id,
    details: { from: assetId, costUsd: img.costUsd },
  });
  return { assetId: added.asset.id, costUsd: img.costUsd };
}
