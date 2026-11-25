import { activeBible, audit, getAllSettings, type Prisma, type PrismaClient } from '@studio/db';
import { Llm } from '@studio/llm';
import {
  assertAssetRenderable,
  assertCanPromoteStory,
  assertOriginalCommentary,
  type AssetOriginId,
  type ContentFlags,
} from '@studio/policy';
import {
  buildVideoPlan,
  combineScriptLines,
  reviewTimes,
  thumbnailSpecs,
  videoScriptSchema,
  type VideoFormat,
  type VideoPlan,
  type VideoScript,
} from '@studio/production';
import { createImageProvider, type ImageProvider, type TtsProvider } from '@studio/providers';
import type { Logger } from '@studio/shared';
import type { ObjectStore } from '@studio/storage';
import { z } from 'zod';
import { artForRender } from '../character/art';
import { MediaService, RenderService, type RenderReport } from '../character/services';
import { recordTts, ttsForClip } from '../character/tts';
import { budgetStatus, costRecorder } from '../research/ledger';
import { resolveSceneImages } from './art';
import { reviewVideo, type ReviewVerdict } from './review';
import { writeScript, type StoryForWriter } from './writer';

/**
 * Produção de um vídeo de notícia: roteiro → imagens → voz → render (vídeo + 3 thumbnails)
 * → Revisor visual (até N voltas) → pronto para o dono. Cada etapa grava o resultado na
 * Production; se o job cair (notebook dormiu, container reiniciou), a nova tentativa continua
 * de onde parou, sem pagar de novo o que já foi feito.
 */

export { PRODUCTION_JOB } from '@studio/production';
export const productionJobSchema = z.object({
  productionId: z.string().min(8).max(40),
  /** Só para o aceite/teste do dono: produz de verdade mesmo com o modo simulado ligado. */
  real: z.boolean().optional(),
});

export interface ProductionContext {
  prisma: PrismaClient;
  log: Logger;
  store: ObjectStore;
  mediaUrl: string;
  renderUrl: string;
  renderHeight: 720 | 1080;
  anthropicApiKey?: string | undefined;
  googleTtsKey?: string | undefined;
  geminiKey?: string | undefined;
  now?: () => Date;
  /** Pasta de trabalho (testes usam uma temporária). */
  workRoot?: string;
  /** Vídeo pronto: pede a Conformidade (Fase 5). */
  onReady?: (productionId: string) => Promise<void>;
  /** Para testes. */
  media?: MediaService;
  render?: RenderService;
  llm?: Llm;
  images?: ImageProvider;
  tts?: TtsProvider;
}

interface ArtState {
  sceneImages: Record<string, string | null>;
  credits: string[];
  notes: string[];
}
interface VoiceState {
  path: string;
  durationSec: number;
  segments: Array<{ start: number; end: number }>;
  mouthCues: Array<{ start: number; end: number; value: string }>;
  provider: string;
}
interface PlanState {
  art?: ArtState;
  voice?: VoiceState;
  video?: VideoPlan;
  /** Variação das thumbnails (muda quando o Revisor descarta todas). */
  thumbOffset?: number;
}
interface Outputs {
  round: number;
  video?: string;
  thumbnails?: string[];
  thumbnail?: string | null;
  durationSec?: number;
  originalRatio?: number;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

async function setStatus(
  prisma: PrismaClient,
  id: string,
  data: Prisma.ProductionUpdateInput,
): Promise<void> {
  await prisma.production.update({ where: { id }, data });
}

export interface ProductionResult {
  status: string;
  rounds: number;
  costUsd: number;
  video?: string;
  thumbnail?: string | null;
}

export async function runProduction(
  ctx: ProductionContext,
  productionId: string,
  opts: { real?: boolean } = {},
): Promise<ProductionResult> {
  const { prisma, log } = ctx;
  const now = ctx.now?.() ?? new Date();
  const settings = await getAllSettings(prisma);
  const simulation = opts.real ? false : settings['mode.simulation'];
  const prod = await prisma.production.findUniqueOrThrow({
    where: { id: productionId },
    include: {
      story: {
        include: {
          items: { include: { source: { select: { name: true, tier: true } } }, take: 8 },
        },
      },
    },
  });
  if (prod.status === 'READY' || prod.status === 'CANCELED') {
    return { status: prod.status, rounds: prod.reviewRound, costUsd: 0 };
  }
  const story = prod.story;
  if (!story) throw new Error(`produção ${prod.id} de notícia sem história`);
  const format = prod.format as VideoFormat;
  // 3ª camada: a história ainda pode virar vídeo? (vazamento, trapaça, mods, spoiler, rumor < 2 fontes)
  assertCanPromoteStory(
    {
      flags: story.flags as Partial<ContentFlags> | null,
      isRumor: story.isRumor,
      independentSources: story.independentSources,
      officialCount: story.officialCount,
    },
    settings.antiSpoiler,
    now,
  );
  if (!prod.startedAt) await setStatus(prisma, prod.id, { startedAt: now });

  const media = ctx.media ?? new MediaService(ctx.mediaUrl);
  const render = ctx.render ?? new RenderService(ctx.renderUrl);
  const llm =
    ctx.llm ??
    new Llm({
      simulation,
      apiKey: ctx.anthropicApiKey,
      budget: () => budgetStatus(prisma),
      record: costRecorder(prisma),
    });
  const images =
    ctx.images ??
    createImageProvider(simulation ? 'fake' : settings.images.provider, {
      apiKey: ctx.geminiKey,
      model: settings.images.model,
    });
  const state: PlanState = (prod.plan as PlanState | null) ?? {};
  const savePlan = () => setStatus(prisma, prod.id, { plan: json(state) });
  const dir = `productions/${prod.id}`;

  // 1) Roteiro
  let script: VideoScript;
  if (prod.script) {
    script = videoScriptSchema.parse(prod.script);
  } else {
    await setStatus(prisma, prod.id, {
      status: 'SCRIPTING',
      step: 'escrevendo o roteiro',
      error: null,
    });
    const library = await prisma.asset.findMany({
      where: {
        manifest: { status: 'ACTIVE' },
        OR: [
          // da própria história ou imprensa oficial
          {
            origin: { in: ['OFFICIAL_PRESS', 'OWNER_UPLOAD', 'CHANNEL_OWN'] },
            OR: [{ storyId: story.id }, { origin: 'OFFICIAL_PRESS' }],
          },
          // cenários gerados que o dono aprovou na tela Arte (reuso sem custo)
          { origin: 'IMAGE_PROVIDER', tags: { has: 'aprovada' } },
        ],
      },
      include: { manifest: { select: { credit: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const storyForWriter: StoryForWriter = {
      id: story.id,
      title: story.title,
      titlePt: story.titlePt,
      summaryPt: story.summaryPt,
      kind: story.kind,
      isRumor: story.isRumor,
      sources: story.items.map((it) => ({
        id: it.id,
        source: it.source.name,
        tier: it.source.tier,
        domain: it.domain,
        url: it.url,
        title: it.title,
        summary: it.summary,
        publishedAt: it.publishedAt?.toISOString() ?? null,
      })),
      library: library.map((a) => ({
        id: a.id,
        title: a.title,
        tags: a.tags,
        origin: a.origin,
        credit: a.manifest?.credit ?? null,
      })),
    };
    const written = await writeScript(llm, {
      story: storyForWriter,
      format,
      targetSec:
        format === 'LONG' ? settings.production.longTargetSec : settings.production.shortTargetSec,
      maxGeneratedImages:
        format === 'LONG' ? settings.images.maxPerLong : settings.images.maxPerShort,
      bible: (await activeBible(prisma)).content,
      model: settings.production.writerModel,
      spoilerWindow: settings.antiSpoiler,
      productionId: prod.id,
      now,
    });
    script = written.script;
    await setStatus(prisma, prod.id, {
      script: json(script),
      title: script.title,
      step: llm.isReal ? null : 'roteiro de teste (modo simulado ou sem ANTHROPIC_API_KEY)',
    });
    await audit(prisma, {
      actor: 'agent:roteirista',
      action: 'production.script',
      target: prod.id,
      details: {
        attempts: written.attempts,
        lines: script.lines.length,
        estimatedSec: Math.round(written.estimatedSec),
        styleNotes: written.styleNotes,
      },
    });
  }

  const sources = new Map(story.items.map((it) => [it.id, it.source.name]));
  const reviews: ReviewVerdict[] = (prod.review as ReviewVerdict[] | null) ?? [];
  // Volta atual: se a última volta já foi revisada, começa a próxima; senão (caiu no meio do
  // render ou antes da revisão), refaz a mesma.
  let round = Math.max(
    1,
    reviews.length >= prod.reviewRound ? reviews.length + 1 : prod.reviewRound,
  );
  let lastReport: RenderReport[] | undefined;

  /** O dono cancelou? (confere entre as etapas: o que já foi feito fica guardado). */
  const canceled = async () =>
    (
      await prisma.production.findUniqueOrThrow({
        where: { id: prod.id },
        select: { status: true },
      })
    ).status === 'CANCELED';

  for (;;) {
    if (await canceled()) break;
    // 2) Imagens
    if (!state.art) {
      await setStatus(prisma, prod.id, { status: 'ART', step: 'imagens das cenas' });
      const art = await resolveSceneImages(
        {
          prisma,
          store: ctx.store,
          media,
          images,
          log,
          productionId: prod.id,
          storyId: story.id,
          style: settings.images.style,
          budget: () => budgetStatus(prisma),
        },
        script,
        format,
      );
      state.art = { sceneImages: art.sceneImages, credits: art.credits, notes: art.notes };
      await savePlan();
    }

    // 3) Voz (uma vez por roteiro: as correções do Revisor não mexem nas falas)
    if (!state.voice) {
      await setStatus(prisma, prod.id, { status: 'VOICE', step: 'voz e boca sincronizada' });
      const tts =
        ctx.tts ??
        (await ttsForClip(prisma, {
          mediaUrl: ctx.mediaUrl,
          googleApiKey: ctx.googleTtsKey,
          ...(opts.real ? { override: settings.character.ttsProvider } : {}),
        }));
      const combined = combineScriptLines(script);
      const voiced: Array<{ path: string; pauseAfterMs: number }> = [];
      for (const [i, seg] of combined.parsed.segments.entries()) {
        const r = await tts.synthesize({ text: seg.text, out: `${dir}/voz/trecho-${i}.wav` });
        await recordTts(
          prisma,
          tts,
          r,
          'production:voz',
          tts.id === 'google' ? settings.character.googleVoice : undefined,
          prod.id,
        );
        voiced.push({ path: r.path, pauseAfterMs: seg.pauseAfterMs });
      }
      const track = await media.voiceTrack(
        voiced,
        `${dir}/voz.wav`,
        200 + combined.parsed.leadInMs,
        300,
      );
      const lips = await media.lipsync(track.path);
      state.voice = {
        path: track.path,
        durationSec: track.durationSec,
        segments: track.segments,
        mouthCues: lips.mouthCues,
        provider: tts.id,
      };
      await savePlan();
    }

    // 4) Plano + conferência de direitos no banco (3ª camada) + render
    if (await canceled()) break;
    await setStatus(prisma, prod.id, {
      status: 'RENDERING',
      step: `render (volta ${round})`,
      reviewRound: round,
    });
    const combined = combineScriptLines(script);
    const plan = buildVideoPlan({
      script,
      combined,
      track: { durationSec: state.voice.durationSec, segments: state.voice.segments },
      mouthCues: state.voice.mouthCues,
      voiceSrc: state.voice.path,
      sceneImages: Object.fromEntries(
        Object.entries(state.art.sceneImages).map(([k, v]) => [Number(k), v]),
      ),
      sourceLabels: Object.fromEntries(sources),
      storyIsRumor: story.isRumor,
      credits: state.art.credits,
      channelName: settings['channel.identity'].channelName,
      resolution: ctx.renderHeight === 1080 ? '1080p' : '720p',
    });
    const used = await prisma.productionAsset.findMany({
      where: { productionId: prod.id },
      include: { asset: { include: { manifest: true } } },
    });
    for (const u of used) {
      assertAssetRenderable(
        {
          id: u.asset.id,
          origin: u.asset.origin as AssetOriginId,
          manifest: u.asset.manifest
            ? {
                origin: u.asset.manifest.origin as AssetOriginId,
                license: u.asset.manifest.license,
                status: u.asset.manifest.status,
                expiresAt: u.asset.manifest.expiresAt,
              }
            : null,
        },
        now,
      );
    }
    // Regra 5: nada de terceiros com áudio/vídeo nesta fase; a narração é toda do canal.
    assertOriginalCommentary(plan.durationSec, 0);
    state.video = plan;
    await savePlan();

    const rdir = `${dir}/r${round}`;
    // Arte do artista (ativa) ou a provisória.
    const art = await artForRender(prisma, ctx.store);
    const videoReport = await render.render({
      composition: 'NewsVideo',
      props: { plan, provisional: !art, art },
      output: `${rdir}/video.mp4`,
      vertical: format === 'SHORT',
      height: ctx.renderHeight,
    });
    const specs = thumbnailSpecs(script, plan);
    const offset = state.thumbOffset ?? 0;
    const images16 = plan.scenes.map((s) => s.image).filter((x): x is string => Boolean(x));
    const thumbs: string[] = [];
    const thumbReports: RenderReport[] = [];
    for (const [i, spec] of specs.entries()) {
      const shifted = {
        ...spec,
        variant: (spec.variant + offset) % 3,
        image: images16.length ? images16[(i + offset) % images16.length]! : spec.image,
      };
      const out = `${rdir}/thumb-${i + 1}.png`;
      thumbReports.push(
        await render.render({
          composition: 'Thumbnail',
          props: { spec: shifted, provisional: !art, art },
          output: out,
          still: true,
        }),
      );
      thumbs.push(out);
    }
    lastReport = [videoReport, ...thumbReports];
    const outputs: Outputs = {
      round,
      video: `${rdir}/video.mp4`,
      thumbnails: thumbs,
      durationSec: plan.durationSec,
      originalRatio: 1,
    };
    const prevReports =
      ((
        await prisma.production.findUniqueOrThrow({
          where: { id: prod.id },
          select: { renderReport: true },
        })
      ).renderReport as unknown[] | null) ?? [];
    await setStatus(prisma, prod.id, {
      outputs: json(outputs),
      renderReport: json([...prevReports, { round, video: videoReport, thumbnails: thumbReports }]),
      status: 'REVIEWING',
      step: `Revisor visual (volta ${round})`,
    });

    // 5) Revisor visual
    const frames = await media.keyframes(outputs.video!, reviewTimes(plan));
    const previews = await Promise.all(thumbs.map((t) => media.preview(t)));
    const verdict = await reviewVideo(llm, {
      plan,
      frames,
      thumbnails: previews.map((p, i) => ({ jpegBase64: p, headline: specs[i]!.headline })),
      model: settings.production.reviewerModel,
      productionId: prod.id,
      round,
    });
    reviews.push(verdict);
    await setStatus(prisma, prod.id, { review: json(reviews) });
    await audit(prisma, {
      actor: 'agent:revisor-visual',
      action: 'production.review',
      target: prod.id,
      outcome: verdict.approved ? 'OK' : 'DENIED',
      details: { round, issues: verdict.issues.length, summary: verdict.summary.slice(0, 300) },
    });

    if (verdict.approved) {
      outputs.thumbnail = thumbs[verdict.bestThumbnail ?? 0] ?? null;
      await setStatus(prisma, prod.id, {
        status: 'READY',
        step: null,
        outputs: json(outputs),
        finishedAt: ctx.now?.() ?? new Date(),
      });
      await ctx
        .onReady?.(prod.id)
        .catch((err: unknown) => log.warn({ err }, 'Conformidade não enfileirada'));
      break;
    }
    if (round >= settings.production.maxReviewRounds) {
      await setStatus(prisma, prod.id, {
        status: 'NEEDS_ATTENTION',
        step: `Revisor reprovou depois de ${round} volta(s): ${verdict.summary.slice(0, 200)}`,
        finishedAt: ctx.now?.() ?? new Date(),
      });
      break;
    }
    // Correções fechadas para a próxima volta.
    if (verdict.replaceScenes.length) {
      script = {
        ...script,
        scenes: script.scenes.map((s) => {
          if (!verdict.replaceScenes.includes(s.id)) return s;
          return s.visual === 'gerar' && s.imagePrompt
            ? {
                ...s,
                imagePrompt: `${s.imagePrompt.replace(/, alternative composition \d+$/, '')}, alternative composition ${round + 1}`,
              }
            : { ...s, visual: 'zeca' as const, libraryAssetId: null, imagePrompt: null };
        }),
      };
      await setStatus(prisma, prod.id, { script: json(script) });
      delete state.art;
    }
    if (verdict.rejectedThumbnails.length === 3 || verdict.bestThumbnail === null) {
      state.thumbOffset = (state.thumbOffset ?? 0) + 1;
    }
    await savePlan();
    round += 1;
  }

  const cost = await prisma.costLedger.aggregate({
    _sum: { costUsd: true },
    where: { productionId: prod.id },
  });
  const final = await prisma.production.findUniqueOrThrow({ where: { id: prod.id } });
  const out = final.outputs as Outputs | null;
  log.info(
    {
      productionId: prod.id,
      status: final.status,
      rounds: final.reviewRound,
      renderSeconds: lastReport?.map((r) => r.seconds) ?? [],
    },
    'produção terminou',
  );
  return {
    status: final.status,
    rounds: final.reviewRound,
    costUsd: Number(cost._sum.costUsd ?? 0),
    ...(out?.video ? { video: out.video } : {}),
    ...(out ? { thumbnail: out.thumbnail ?? null } : {}),
  };
}
