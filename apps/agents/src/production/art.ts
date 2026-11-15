import type { Asset, PrismaClient, RightsManifest } from '@studio/db';
import { assertWithinBudget, type BudgetStatus } from '@studio/llm';
import {
  assertAssetRenderable,
  assertImagePromptAllowed,
  PolicyViolation,
  type AssetOriginId,
} from '@studio/policy';
import type { VideoFormat, VideoScript } from '@studio/production';
import { ImageBlockedError, type ImageProvider } from '@studio/providers';
import { channelDay, type Logger } from '@studio/shared';
import { addAsset, type ObjectStore } from '@studio/storage';
import type { MediaService } from '../character/services';

/**
 * Diretor de arte: resolve a imagem de cada cena do roteiro.
 * - "biblioteca": mídia existente, só com manifesto ativo (regra 1/2);
 * - "gerar": imagem nova do provedor (Google) com o guia de estilo; vira mídia da Biblioteca
 *   com manifesto automático (provedor + prompt). O mesmo prompt não é gerado (nem pago) 2 vezes;
 * - "zeca": só o personagem.
 * Imagem recusada pelo filtro do provedor ou mídia sem direitos não derrubam o vídeo: a cena
 * fica só com o Zeca e o motivo vai para as notas.
 */

export interface ArtContext {
  prisma: PrismaClient;
  store: ObjectStore;
  media: MediaService;
  images: ImageProvider;
  log: Logger;
  productionId: string;
  storyId: string;
  style: string;
  budget: () => Promise<BudgetStatus>;
}

export interface ArtResult {
  sceneImages: Record<number, string | null>;
  /** Créditos de imagem (tela final e descrição). */
  credits: string[];
  notes: string[];
  usedAssets: Array<{ assetId: string; scene: number }>;
  generated: number;
  costUsd: number;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Copia a mídia do S3 para a pasta de trabalho (uma vez só; o nome é o sha256). */
export async function materializeAsset(
  ctx: Pick<ArtContext, 'store' | 'media'>,
  asset: Pick<Asset, 'sha256' | 'mime' | 'storageKey'>,
): Promise<string> {
  const path = `assets/${asset.sha256}.${EXT[asset.mime] ?? 'png'}`;
  const info = await ctx.media.fileInfo(path);
  if (!info.exists) await ctx.media.importImage(path, await ctx.store.get(asset.storageKey));
  return path;
}

type AssetWithManifest = Asset & { manifest: RightsManifest | null };

function renderable(asset: AssetWithManifest) {
  return {
    id: asset.id,
    origin: asset.origin as AssetOriginId,
    manifest: asset.manifest
      ? {
          origin: asset.manifest.origin as AssetOriginId,
          license: asset.manifest.license,
          status: asset.manifest.status,
          expiresAt: asset.manifest.expiresAt,
        }
      : null,
  };
}

export function providerTag(images: ImageProvider): string {
  return `${images.id}:${images.model}`;
}

export async function resolveSceneImages(
  ctx: ArtContext,
  script: VideoScript,
  format: VideoFormat,
): Promise<ArtResult> {
  const result: ArtResult = {
    sceneImages: {},
    credits: [],
    notes: [],
    usedAssets: [],
    generated: 0,
    costUsd: 0,
  };
  const credits = new Set<string>();
  const aspectRatio = format === 'SHORT' ? '9:16' : '16:9';
  const provider = providerTag(ctx.images);

  for (const scene of script.scenes) {
    if (scene.visual === 'zeca') {
      result.sceneImages[scene.id] = null;
      continue;
    }

    let asset: AssetWithManifest | null;
    if (scene.visual === 'biblioteca') {
      asset = await ctx.prisma.asset.findUnique({
        where: { id: scene.libraryAssetId ?? '' },
        include: { manifest: true },
      });
      if (!asset) {
        result.notes.push(`cena ${scene.id}: mídia ${scene.libraryAssetId} não existe (só o Zeca)`);
      }
    } else {
      const prompt = (scene.imagePrompt ?? '').trim();
      try {
        assertImagePromptAllowed(prompt);
      } catch (err) {
        if (!(err instanceof PolicyViolation)) throw err;
        result.notes.push(`cena ${scene.id}: ${err.message.replace(/^\[[A-Z_]+\]\s*/, '')}`);
        result.sceneImages[scene.id] = null;
        continue;
      }
      const fullPrompt = `${prompt}. ${ctx.style}`;
      // Mesmo prompt e mesmo modelo: reaproveita (não paga de novo, render repetível).
      asset = await ctx.prisma.asset.findFirst({
        where: { manifest: { provider, prompt: fullPrompt, status: 'ACTIVE' } },
        include: { manifest: true },
      });
      if (!asset) {
        if (ctx.images.real) {
          const b = await ctx.budget();
          const projected = { ...b };
          projected.spentTodayUsd += 0.07;
          projected.spentMonthUsd += 0.07;
          assertWithinBudget(projected);
        }
        try {
          const img = await ctx.images.generate({ prompt: fullPrompt, aspectRatio });
          const added = await addAsset(ctx.prisma, ctx.store, {
            bytes: img.bytes,
            title: (scene.headline ?? prompt).slice(0, 120),
            tags: ['gerada', ctx.images.real ? 'google' : 'teste'],
            storyId: ctx.storyId,
            origin: 'IMAGE_PROVIDER',
            manifest: {
              license: ctx.images.real
                ? `Gerada por ${img.model} (Google Gemini API) para o canal; uso conforme os termos do provedor`
                : 'Imagem de teste gerada pelo próprio estúdio (modo simulado)',
              provider,
              prompt: fullPrompt,
              restrictions: { editorialOnly: false, allowThumbnail: true, mustCredit: false },
            },
            createdBy: 'agent:diretor-arte',
          });
          await ctx.prisma.costLedger.create({
            data: {
              dayKey: channelDay(),
              provider: 'image',
              model: img.model,
              task: 'agent:diretor-arte',
              units: 1,
              costUsd: img.costUsd,
              simulated: !ctx.images.real,
              productionId: ctx.productionId,
            },
          });
          result.generated += 1;
          result.costUsd += img.costUsd;
          asset = await ctx.prisma.asset.findUniqueOrThrow({
            where: { id: added.asset.id },
            include: { manifest: true },
          });
        } catch (err) {
          if (!(err instanceof ImageBlockedError)) throw err;
          result.notes.push(`cena ${scene.id}: ${err.message} (só o Zeca)`);
          result.sceneImages[scene.id] = null;
          continue;
        }
      }
    }

    if (!asset) {
      result.sceneImages[scene.id] = null;
      continue;
    }
    try {
      assertAssetRenderable(renderable(asset));
    } catch (err) {
      if (!(err instanceof PolicyViolation)) throw err;
      result.notes.push(
        `cena ${scene.id}: ${err.message.replace(/^\[[A-Z_]+\]\s*/, '')} (só o Zeca)`,
      );
      result.sceneImages[scene.id] = null;
      continue;
    }
    result.sceneImages[scene.id] = await materializeAsset(ctx, asset);
    result.usedAssets.push({ assetId: asset.id, scene: scene.id });
    if (asset.origin === 'IMAGE_PROVIDER') credits.add('Imagens ilustrativas geradas por IA');
    else if (asset.manifest?.credit) credits.add(`Imagem: ${asset.manifest.credit}`);
  }

  // Registra o uso (revogação lista os vídeos afetados).
  await ctx.prisma.productionAsset.deleteMany({
    where: { productionId: ctx.productionId, role: 'cena' },
  });
  if (result.usedAssets.length) {
    await ctx.prisma.productionAsset.createMany({
      data: result.usedAssets.map((u) => ({
        productionId: ctx.productionId,
        assetId: u.assetId,
        role: 'cena',
        scene: u.scene,
      })),
      skipDuplicates: true,
    });
  }
  result.credits = [...credits];
  ctx.log.info(
    { productionId: ctx.productionId, generated: result.generated, notes: result.notes.length },
    'diretor de arte: cenas resolvidas',
  );
  return result;
}
