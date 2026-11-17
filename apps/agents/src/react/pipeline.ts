import { activeBible, audit, getAllSettings, type Prisma } from '@studio/db';
import { Llm } from '@studio/llm';
import {
  assertAssetRenderable,
  assertPartnerPermission,
  assertReactTimeline,
  checkDescriptionConditions,
  PolicyViolation,
  type AssetOriginId,
  type PartnerConditions,
} from '@studio/policy';
import {
  buildReactPlan,
  clipCandidates,
  combineReactLines,
  fitClipDurations,
  pickReactLayout,
  reactBlocks,
  reactDescription,
  reactReviewTimes,
  reactScriptSchema,
  REACT_LAYOUTS,
  type ClipCandidate,
  type ReactClip,
  type ReactLayout,
  type ReactPlan,
  type ReactScript,
} from '@studio/production';
import { MediaService, RenderService, type RenderReport } from '../character/services';
import { recordTts, ttsForClip } from '../character/tts';
import { ensureLocalVideo, permissionState, runAnalyze } from '../partners/import';
import type { ProductionContext, ProductionResult } from '../production/pipeline';
import { budgetStatus, costRecorder } from '../research/ledger';
import { writeCommentary } from './commentator';
import { reviewReact, type ReactVerdict } from './review';

/**
 * Produção de um Short de react (Fase 4), com retomada pelo banco como a de notícias:
 * trechos candidatos → Comentarista → voz (cada fala) → durações dos clipes que cabem na regra
 * dos 50% → cortes (só a voz do parceiro, ou o áudio inteiro se o dono liberou) → trilha com o
 * Zeca calado durante os clipes → plano → 3ª camada (permissão, manifesto, regra 3, condições
 * na descrição) → render ReactShort → Revisor visual → pronto para o dono.
 */

interface ReactState {
  candidates?: ClipCandidate[];
  /** Trechos de voz já sintetizados (caminho e duração de cada um). */
  voiced?: Array<{ path: string; durationSec: number }>;
  clipDurations?: number[];
  clips?: ReactClip[];
  voice?: {
    path: string;
    durationSec: number;
    segments: Array<{ start: number; end: number }>;
    mouthCues: Array<{ start: number; end: number; value: string }>;
    provider: string;
  };
  layout?: ReactLayout;
  plan?: ReactPlan;
  stats?: { clipRatio: number; commentRatio: number; clipSec: number; totalSec: number };
}

interface ReactOutputs {
  round: number;
  video?: string;
  durationSec?: number;
  clipRatio?: number;
  commentRatio?: number;
  description?: string;
  monetization?: string;
  credit?: string;
  layout?: string;
  audioMode?: string;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function runReactProduction(
  ctx: ProductionContext,
  productionId: string,
  opts: { real?: boolean } = {},
): Promise<ProductionResult> {
  const { prisma, log } = ctx;
  const now = ctx.now?.() ?? new Date();
  const settings = await getAllSettings(prisma);
  const simulation = opts.real ? false : settings['mode.simulation'];
  const load = () =>
    prisma.production.findUniqueOrThrow({
      where: { id: productionId },
      include: {
        partner: true,
        sourceAsset: { include: { manifest: { include: { permission: true } } } },
      },
    });
  let prod = await load();
  if (prod.status === 'READY' || prod.status === 'CANCELED') {
    return { status: prod.status, rounds: prod.reviewRound, costUsd: 0 };
  }
  const asset = prod.sourceAsset;
  const partner = prod.partner;
  if (!asset || !partner || asset.kind !== 'VIDEO') {
    throw new PolicyViolation('PARTNER_PERMISSION_ACTIVE', 'Short de react sem vídeo de parceiro.');
  }
  const permission = asset.manifest?.permission ?? null;
  /** 3ª camada: permissão ativa e manifesto em dia (no começo e de novo antes do render). */
  const checkRights = async () => {
    const fresh = await prisma.asset.findUniqueOrThrow({
      where: { id: asset.id },
      include: { manifest: { include: { permission: true } } },
    });
    const perm = fresh.manifest?.permission ?? null;
    assertPartnerPermission(perm ? permissionState(perm) : null, 'REACT_CLIPS', now);
    assertAssetRenderable(
      {
        id: fresh.id,
        origin: fresh.origin as AssetOriginId,
        manifest: fresh.manifest
          ? {
              origin: fresh.manifest.origin as AssetOriginId,
              license: fresh.manifest.license,
              status: fresh.manifest.status,
              expiresAt: fresh.manifest.expiresAt,
            }
          : null,
        permission: perm ? permissionState(perm) : null,
      },
      now,
    );
    if (fresh.partnerId !== partner.id) {
      throw new PolicyViolation('PARTNER_PERMISSION_ACTIVE', 'O vídeo é de outro parceiro.');
    }
    return perm!;
  };
  await checkRights();
  const conditions = permission!.conditions as unknown as PartnerConditions;
  if (!prod.startedAt)
    await prisma.production.update({ where: { id: prod.id }, data: { startedAt: now } });

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
  const state: ReactState = (prod.plan as ReactState | null) ?? {};
  const setStatus = (data: Prisma.ProductionUpdateInput) =>
    prisma.production.update({ where: { id: prod.id }, data });
  const savePlan = () => setStatus({ plan: json(state) });
  const dir = `productions/${prod.id}`;
  const canceled = async () =>
    (
      await prisma.production.findUniqueOrThrow({
        where: { id: prod.id },
        select: { status: true },
      })
    ).status === 'CANCELED';

  // 0) Análise do vídeo (normalmente já feita na importação).
  if (asset.analysisStatus !== 'READY' || !asset.analysis) {
    await setStatus({ status: 'SCRIPTING', step: 'analisando o vídeo do parceiro', error: null });
    await runAnalyze({ prisma, log, store: ctx.store, media, workRoot: ctx.workRoot }, asset.id);
    prod = await load();
  }
  const analysis = prod.sourceAsset!.analysis as unknown as Parameters<typeof clipCandidates>[0];
  const local = await ensureLocalVideo({ store: ctx.store, workRoot: ctx.workRoot }, asset);
  await prisma.productionAsset.upsert({
    where: {
      productionId_assetId_role_scene: {
        productionId: prod.id,
        assetId: asset.id,
        role: 'clipe',
        scene: 0,
      },
    },
    create: { productionId: prod.id, assetId: asset.id, role: 'clipe', scene: 0 },
    update: {},
  });

  // 1) Trechos candidatos + Comentarista
  let script: ReactScript;
  if (prod.script) {
    script = reactScriptSchema.parse(prod.script) as ReactScript;
  } else {
    await setStatus({
      status: 'SCRIPTING',
      step: 'Comentarista escolhendo os trechos',
      error: null,
    });
    state.candidates = clipCandidates(analysis, { count: 6, clipSec: 5.5 });
    if (state.candidates.length === 0) {
      throw new PolicyViolation(
        'REACT_RATIO',
        'Nenhum trecho aproveitável no vídeo (curto demais ou só música de terceiros).',
      );
    }
    const frames = await media.keyframes(
      local,
      state.candidates.map((c) => Math.round(((c.start + c.end) / 2) * 100) / 100),
      512,
    );
    const written = await writeCommentary(llm, {
      bible: (await activeBible(prisma)).content,
      model: settings.react.commentatorModel,
      partnerName: partner.name,
      credit: conditions.credit,
      videoTitle: asset.title,
      candidates: state.candidates,
      frames: frames.map((f) => f.jpegBase64),
      targetSec: settings.react.targetSec,
      spoilerWindow: settings.antiSpoiler,
      productionId: prod.id,
      now,
    });
    script = written.script;
    await setStatus({
      script: json(script),
      title: script.title,
      plan: json(state),
      step: llm.isReal ? null : 'comentário de teste (modo simulado ou sem ANTHROPIC_API_KEY)',
    });
    await audit(prisma, {
      actor: 'agent:comentarista',
      action: 'production.react.script',
      target: prod.id,
      details: { attempts: written.attempts, picks: script.picks.map((p) => p.candidate) },
    });
  }

  const reviews: ReactVerdict[] = (prod.review as ReactVerdict[] | null) ?? [];
  let round = Math.max(
    1,
    reviews.length >= prod.reviewRound ? reviews.length + 1 : prod.reviewRound,
  );
  let lastReport: RenderReport | undefined;
  const audioMode = asset.audioCleared ? 'full' : 'voice';

  for (;;) {
    if (await canceled()) break;

    // 2) Voz de cada fala (as durações decidem quanto clipe cabe)
    if (!state.voiced) {
      await setStatus({ status: 'VOICE', step: 'voz do Zeca' });
      const tts =
        ctx.tts ??
        (await ttsForClip(prisma, {
          mediaUrl: ctx.mediaUrl,
          googleApiKey: ctx.googleTtsKey,
          ...(opts.real ? { override: settings.character.ttsProvider } : {}),
        }));
      const combined = combineReactLines(
        script,
        script.picks.map((p) => p.end - p.start),
      );
      state.voiced = [];
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
        state.voiced.push({ path: r.path, durationSec: r.durationSec });
      }
      state.voice = undefined;
      await savePlan();
    }

    // 3) Quanto de clipe cabe (regra 3 + teto do parceiro) e os cortes
    if (!state.clips) {
      await setStatus({ status: 'ART', step: 'cortando os trechos do parceiro' });
      const combined = combineReactLines(
        script,
        script.picks.map((p) => p.end - p.start),
      );
      const commentSec =
        state.voiced.reduce((n, v) => n + v.durationSec, 0) +
        combined.parsed.segments
          .slice(0, -1)
          .reduce(
            (n, s, i) =>
              combined.segmentLine[i] === combined.segmentLine[i + 1]
                ? n + s.pauseAfterMs / 1000
                : n,
            0,
          ) +
        0.6;
      state.clipDurations = fitClipDurations(
        script.picks.map((p) => p.end - p.start),
        commentSec,
        { maxRatio: settings.react.maxClipRatio, maxClipSec: conditions.maxClipSec ?? null },
      );
      state.clips = [];
      for (const [i, p] of script.picks.entries()) {
        const cut = await media.cut({
          video: local,
          out: `${dir}/clipe-${i + 1}.mp4`,
          start: p.start,
          end: p.start + state.clipDurations[i]!,
          audioMode,
          speech: analysis.speech,
        });
        state.clips.push({
          src: cut.path,
          durationSec: cut.durationSec,
          width: cut.width,
          height: cut.height,
        });
      }
      state.voice = undefined;
      await savePlan();
    }

    // 4) Trilha com o Zeca calado durante os clipes + boca sincronizada
    if (!state.voice) {
      await setStatus({ status: 'VOICE', step: 'trilha e boca sincronizada' });
      const combined = combineReactLines(
        script,
        state.clips.map((c) => c.durationSec),
      );
      const track = await media.voiceTrack(
        state.voiced.map((v, i) => ({
          path: v.path,
          pauseAfterMs: combined.parsed.segments[i]!.pauseAfterMs,
        })),
        `${dir}/voz.wav`,
        300 + combined.parsed.leadInMs,
        300,
      );
      const lips = await media.lipsync(track.path);
      state.voice = {
        path: track.path,
        durationSec: track.durationSec,
        segments: track.segments,
        mouthCues: lips.mouthCues,
        provider: 'voz',
      };
      await savePlan();
    }

    // 5) Plano + 3ª camada (direitos no banco, regra 3, condições) + render
    if (await canceled()) break;
    await setStatus({ status: 'RENDERING', step: `render (volta ${round})`, reviewRound: round });
    await checkRights();
    if (!state.layout) {
      const previous = await prisma.production.findFirst({
        where: { kind: 'REACT', id: { not: prod.id }, status: 'READY' },
        orderBy: { createdAt: 'desc' },
        select: { outputs: true },
      });
      const prevLayout = (previous?.outputs as ReactOutputs | null)?.layout as
        ReactLayout | undefined;
      state.layout = pickReactLayout(settings.react.layouts, prevLayout ?? null);
    }
    const combined = combineReactLines(
      script,
      state.clips.map((c) => c.durationSec),
    );
    const plan = buildReactPlan({
      script,
      combined,
      track: { durationSec: state.voice.durationSec, segments: state.voice.segments },
      mouthCues: state.voice.mouthCues,
      voiceSrc: state.voice.path,
      clips: state.clips,
      credit: conditions.credit,
      layout: state.layout,
      channelName: settings['channel.identity'].channelName,
      resolution: ctx.renderHeight === 1080 ? '1080p' : '720p',
    });
    const stats = assertReactTimeline(reactBlocks(plan), {
      maxClipRatio: settings.react.maxClipRatio,
      maxClipSec: conditions.maxClipSec ?? null,
      credit: conditions.credit,
    });
    const description = reactDescription(script, conditions, partner.name);
    const missing = checkDescriptionConditions(description, conditions);
    if (missing.length) {
      throw new PolicyViolation('PARTNER_CONDITIONS', `Faltam na descrição: ${missing.join(', ')}`);
    }
    state.plan = plan;
    state.stats = {
      clipRatio: stats.clipRatio,
      commentRatio: stats.commentRatio,
      clipSec: stats.clipSec,
      totalSec: stats.totalSec,
    };
    await savePlan();

    const video = `${dir}/r${round}/react.mp4`;
    lastReport = await render.render({
      composition: 'ReactShort',
      props: { plan, provisional: true },
      output: video,
      vertical: true,
      height: ctx.renderHeight,
    });
    const outputs: ReactOutputs = {
      round,
      video,
      durationSec: plan.durationSec,
      clipRatio: stats.clipRatio,
      commentRatio: stats.commentRatio,
      description,
      monetization: conditions.monetization,
      credit: conditions.credit,
      layout: plan.layout,
      audioMode,
    };
    const prevReports =
      ((
        await prisma.production.findUniqueOrThrow({
          where: { id: prod.id },
          select: { renderReport: true },
        })
      ).renderReport as unknown[] | null) ?? [];
    await setStatus({
      outputs: json(outputs),
      renderReport: json([...prevReports, { round, video: lastReport, thumbnails: [] }]),
      status: 'REVIEWING',
      step: `Revisor visual (volta ${round})`,
    });

    // 6) Revisor visual
    const frames = await media.keyframes(video, reactReviewTimes(plan));
    const verdict = await reviewReact(llm, {
      plan,
      frames,
      model: settings.production.reviewerModel,
      productionId: prod.id,
      round,
    });
    reviews.push(verdict);
    await setStatus({ review: json(reviews) });
    await audit(prisma, {
      actor: 'agent:revisor-visual',
      action: 'production.review',
      target: prod.id,
      outcome: verdict.approved ? 'OK' : 'DENIED',
      details: { round, issues: verdict.issues.length, summary: verdict.summary.slice(0, 300) },
    });
    if (verdict.approved) {
      await setStatus({ status: 'READY', step: null, finishedAt: ctx.now?.() ?? new Date() });
      break;
    }
    if (round >= settings.production.maxReviewRounds) {
      await setStatus({
        status: 'NEEDS_ATTENTION',
        step: `Revisor reprovou depois de ${round} volta(s): ${verdict.summary.slice(0, 200)}`,
        finishedAt: ctx.now?.() ?? new Date(),
      });
      break;
    }
    // Correção fechada: outro layout na próxima volta.
    const options = settings.react.layouts.length > 1 ? settings.react.layouts : [...REACT_LAYOUTS];
    state.layout = options[(options.indexOf(state.layout) + 1) % options.length]!;
    await savePlan();
    round += 1;
  }

  const cost = await prisma.costLedger.aggregate({
    _sum: { costUsd: true },
    where: { productionId: prod.id },
  });
  const final = await prisma.production.findUniqueOrThrow({ where: { id: prod.id } });
  const out = final.outputs as ReactOutputs | null;
  log.info(
    {
      productionId: prod.id,
      status: final.status,
      rounds: final.reviewRound,
      render: lastReport?.seconds,
    },
    'react terminou',
  );
  return {
    status: final.status,
    rounds: final.reviewRound,
    costUsd: Number(cost._sum.costUsd ?? 0),
    ...(out?.video ? { video: out.video } : {}),
  };
}
