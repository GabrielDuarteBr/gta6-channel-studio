import { createHash } from 'node:crypto';
import {
  buildTimeline,
  expressionsUsed,
  parseScript,
  seedFrom,
  type CharacterTimeline,
  type Expression,
} from '@studio/avatar';
import { activeBible, audit, type PrismaClient } from '@studio/db';
import { assertCharacterLine } from '@studio/policy';
import type { TtsProvider } from '@studio/providers';
import type { Logger } from '@studio/shared';
import type { MediaService, RenderReport, RenderService } from './services';
import { recordTts } from './tts';

/** Muda quando a arte em camadas muda (entra no id do clipe). */
export const ART_VERSION = 'camadas-provisoria-1';
export const CLIP_JOB = 'character.clip';

export interface ClipInput {
  script: string;
  layout: 'landscape' | 'vertical';
  label?: string;
  /** Sufixo do arquivo (ex.: "a", "b" para provar que dois renders são idênticos). */
  variant?: string;
}

export interface ClipResult {
  clipId: string;
  video: string;
  audio: string;
  durationSec: number;
  segments: number;
  expressions: Expression[];
  gestures: string[];
  mouthCues: number;
  mouthShapes: string[];
  bibleVersion: number;
  ttsProvider: string;
  ttsCostUsd: number;
  render: RenderReport;
}

export interface ClipContext {
  prisma: PrismaClient;
  log: Logger;
  tts: TtsProvider;
  /** Nome completo da voz real (ex.: pt-BR-Chirp3-HD-Puck), para o ledger. */
  ttsVoice?: string;
  /** Velocidade da voz real (entra no id do clipe: outra velocidade, outro clipe). */
  ttsRate?: number;
  media: MediaService;
  render: RenderService;
}

/** Id estável: o mesmo roteiro com a mesma voz, bíblia e arte gera a mesma pasta. */
export function clipId(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/**
 * Roteiro marcado → voz por trecho → trilha → bocas (Rhubarb) → linha do tempo → render.
 * Recusa roteiro em que o Zeca diz ser humano (regra 7).
 */
export async function produceCharacterClip(
  ctx: ClipContext,
  input: ClipInput,
): Promise<ClipResult> {
  const parsed = parseScript(input.script);
  try {
    assertCharacterLine(parsed.spokenText);
  } catch (err) {
    await audit(ctx.prisma, {
      actor: 'agent:personagem',
      action: 'character.clip',
      outcome: 'DENIED',
      details: { reason: (err as Error).message },
    });
    throw err;
  }
  const bible = await activeBible(ctx.prisma);
  const id = clipId({
    script: input.script,
    layout: input.layout,
    tts: ctx.tts.id,
    voice: ctx.ttsVoice ?? null,
    rate: ctx.ttsRate ?? null,
    bible: bible.version,
    art: ART_VERSION,
    label: input.label ?? null,
  });
  const dir = `clips/${id}`;
  ctx.log.info({ clipId: id, segments: parsed.segments.length }, 'clipe do personagem: voz');

  // Cada trecho entra no ledger (caracteres e custo real); o que veio do cache não gasta.
  let ttsCostUsd = 0;
  const voiced: Array<{ path: string; pauseAfterMs: number }> = [];
  for (const [i, seg] of parsed.segments.entries()) {
    const r = await ctx.tts.synthesize({ text: seg.text, out: `${dir}/trecho-${i}.wav` });
    ttsCostUsd += await recordTts(ctx.prisma, ctx.tts, r, 'character:clip', ctx.ttsVoice);
    voiced.push({ path: r.path, pauseAfterMs: seg.pauseAfterMs });
  }

  const track = await ctx.media.voiceTrack(voiced, `${dir}/voz.wav`, 200 + parsed.leadInMs, 500);
  const lips = await ctx.media.lipsync(track.path);
  const timeline: CharacterTimeline = buildTimeline(parsed, track, lips.mouthCues);
  const captions = parsed.segments.map((seg, i) => ({
    start: track.segments[i]!.start,
    end: parsed.segments[i + 1] ? track.segments[i + 1]!.start : track.durationSec,
    text: seg.text,
  }));

  ctx.log.info({ clipId: id, durationSec: track.durationSec }, 'clipe do personagem: render');
  const report = await ctx.render.render({
    composition: 'ZecaClip',
    props: {
      seed: seedFrom(input.script),
      provisional: true,
      label: input.label ?? 'Clipe de teste do personagem',
      timeline,
      captions,
    },
    audio: track.path,
    output: `${dir}/clipe${input.variant ? `-${input.variant}` : ''}.mp4`,
    vertical: input.layout === 'vertical',
  });

  const result: ClipResult = {
    clipId: id,
    video: report.output,
    audio: track.path,
    durationSec: track.durationSec,
    segments: parsed.segments.length,
    expressions: expressionsUsed(parsed),
    gestures: [...new Set(timeline.gestures.map((g) => g.gesture))],
    mouthCues: timeline.mouthCues.length,
    mouthShapes: [...new Set(timeline.mouthCues.map((c) => c.value))].sort(),
    bibleVersion: bible.version,
    ttsProvider: ctx.tts.id,
    ttsCostUsd,
    render: report,
  };
  await audit(ctx.prisma, {
    actor: 'agent:personagem',
    action: 'character.clip',
    target: id,
    details: {
      video: result.video,
      durationSec: result.durationSec,
      expressions: result.expressions,
      ttsProvider: result.ttsProvider,
    },
  });
  return result;
}
