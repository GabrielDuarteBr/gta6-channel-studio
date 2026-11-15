import {
  buildTimeline,
  parseScript,
  seededRandom,
  seedFrom,
  type CharacterTimeline,
  type Expression,
  type ParsedScript,
  type ScriptSegment,
  type VoiceTrackTiming,
} from '@studio/avatar';
import type { VideoFormat, VideoScript } from './script';

/**
 * Do roteiro para o plano do vídeo (entrada da composição Remotion): falas viram trechos de
 * voz, a duração real de cada trecho define quando entra cada cena, legenda, fonte na tela e
 * selo de rumor. Tudo determinístico: o mesmo roteiro e a mesma voz dão o mesmo vídeo.
 */

/** Respiro entre uma fala e a próxima. */
export const LINE_GAP_MS = 220;

export interface CombinedScript {
  parsed: ParsedScript;
  /** Índice da fala (em script.lines) de cada trecho de voz. */
  segmentLine: number[];
}

/** Junta as falas num roteiro só do Zeca (a expressão continua de uma fala para a outra). */
export function combineScriptLines(script: VideoScript): CombinedScript {
  const segments: ScriptSegment[] = [];
  const segmentLine: number[] = [];
  const warnings: string[] = [];
  let leadInMs = 0;
  let expression: Expression = 'neutro';
  script.lines.forEach((line, li) => {
    const p = parseScript(line.text, expression);
    if (li === 0) leadInMs = p.leadInMs;
    else if (p.leadInMs && segments.length) segments.at(-1)!.pauseAfterMs += p.leadInMs;
    for (const seg of p.segments) {
      segments.push({ ...seg, gestures: [...seg.gestures] });
      segmentLine.push(li);
    }
    const last = segments.at(-1)!;
    last.pauseAfterMs = Math.max(last.pauseAfterMs, LINE_GAP_MS);
    expression = last.expression;
    warnings.push(...p.warnings);
  });
  return {
    parsed: {
      segments,
      leadInMs,
      spokenText: segments.map((s) => s.text).join(' '),
      warnings,
    },
    segmentLine,
  };
}

export interface Caption {
  start: number;
  end: number;
  text: string;
}

const MAX_CAPTION_WORDS = 5;
const MAX_CAPTION_CHARS = 30;

/** Quebra um trecho em cartões de legenda curtos, com tempo proporcional às letras. */
export function captionsForSegment(text: string, start: number, end: number): Caption[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    const next = [...cur, w];
    if (
      cur.length &&
      (next.length > MAX_CAPTION_WORDS || next.join(' ').length > MAX_CAPTION_CHARS)
    ) {
      chunks.push(cur);
      cur = [w];
    } else {
      cur = next;
    }
    if (/[.!?;:]$/.test(w) && cur.length >= 2) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  const weights = chunks.map((c) => Math.max(1, c.join(' ').replace(/[^\p{L}\p{N}]/gu, '').length));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0, end - start);
  let t = start;
  return chunks.map((c, i) => {
    const d = (span * weights[i]!) / total;
    const cap = {
      start: round(t),
      end: round(i === chunks.length - 1 ? end : t + d),
      text: c.join(' '),
    };
    t += d;
    return cap;
  });
}

export interface KenBurns {
  fromScale: number;
  toScale: number;
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
}

export interface PlanScene {
  id: number;
  start: number;
  end: number;
  /** Caminho na pasta de trabalho, ou null (fundo neon com o Zeca em destaque). */
  image: string | null;
  headline: string | null;
  motion: KenBurns;
}

export interface TimedLabel {
  start: number;
  end: number;
  label: string;
}

export interface VideoPlan {
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  introSec: number;
  outroSec: number;
  /** Trilha de voz (pasta de trabalho) e quando ela começa no vídeo. */
  voiceSrc: string;
  voiceStartSec: number;
  /** Expressões, gestos e bocas, já em tempo absoluto do vídeo. */
  character: CharacterTimeline;
  blinkSeed: number;
  scenes: PlanScene[];
  captions: Caption[];
  sourceChips: TimedLabel[];
  rumorSpans: Array<{ start: number; end: number }>;
  storyIsRumor: boolean;
  credits: string[];
  title: string;
  channelName: string;
  aiNotice: string;
}

export const AI_NOTICE = 'Apresentador animado com voz sintética (IA)';

export function videoSize(format: VideoFormat, resolution: '720p' | '1080p') {
  const base = resolution === '1080p' ? 1080 : 720;
  const long = Math.round((base * 16) / 9);
  return format === 'LONG' ? { width: long, height: base } : { width: base, height: long };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export interface PlanInput {
  script: VideoScript;
  combined: CombinedScript;
  /** Trilha de voz: duração e início/fim de cada trecho (segundos, desde o início da trilha). */
  track: VoiceTrackTiming;
  mouthCues: Array<{ start: number; end: number; value: string }>;
  voiceSrc: string;
  /** Imagem (pasta de trabalho) de cada cena, por id; ausente = cena só com o Zeca. */
  sceneImages: Record<number, string | null>;
  /** Nome da fonte (veículo) por id de notícia, para o selo "Fonte: ...". */
  sourceLabels: Record<string, string>;
  storyIsRumor: boolean;
  credits: string[];
  channelName: string;
  resolution: '720p' | '1080p';
  fps?: number;
}

export function buildVideoPlan(input: PlanInput): VideoPlan {
  const { script, combined, track } = input;
  const format = script.format;
  const fps = input.fps ?? 30;
  const introSec = format === 'LONG' ? 1.5 : 0.4;
  const outroSec = format === 'LONG' ? 4 : 1.5;
  const at = (t: number) => round(introSec + t);
  const durationSec = round(introSec + track.durationSec + outroSec);

  const tl = buildTimeline(combined.parsed, track, input.mouthCues);
  const character: CharacterTimeline = {
    durationSec,
    expressions: tl.expressions.map((e, i, all) => ({
      ...e,
      start: i === 0 ? 0 : at(e.start),
      end: i === all.length - 1 ? durationSec : at(e.end),
    })),
    gestures: tl.gestures.map((g) => ({ ...g, start: at(g.start), end: at(g.end) })),
    mouthCues: tl.mouthCues.map((c) => ({ ...c, start: at(c.start), end: at(c.end) })),
  };

  // Início e fim de cada fala (primeiro e último trecho dela).
  const lineSpan = script.lines.map((_, li) => {
    const idx = combined.segmentLine.flatMap((l, i) => (l === li ? [i] : []));
    const first = track.segments[idx[0]!]!;
    const last = track.segments[idx.at(-1)!]!;
    return { start: at(first.start), end: at(last.end) };
  });

  // Cenas: da primeira fala da cena até a primeira fala da próxima.
  const sceneOrder = [...new Set(script.lines.map((l) => l.scene))];
  const scenes: PlanScene[] = sceneOrder.map((sceneId, i) => {
    const firstLine = script.lines.findIndex((l) => l.scene === sceneId);
    const nextScene = sceneOrder[i + 1];
    const nextLine =
      nextScene === undefined ? -1 : script.lines.findIndex((l) => l.scene === nextScene);
    const start = i === 0 ? 0 : lineSpan[firstLine]!.start;
    const end = nextLine < 0 ? durationSec : lineSpan[nextLine]!.start;
    const meta = script.scenes.find((s) => s.id === sceneId)!;
    const rnd = seededRandom(seedFrom(`${script.title}#${sceneId}`));
    const zoomIn = rnd() > 0.4;
    const panX = (rnd() - 0.5) * 0.06;
    const panY = (rnd() - 0.5) * 0.04;
    return {
      id: sceneId,
      start,
      end,
      image: meta.visual === 'zeca' ? null : (input.sceneImages[sceneId] ?? null),
      headline: meta.headline,
      motion: {
        fromScale: zoomIn ? 1.02 : 1.14,
        toScale: zoomIn ? 1.14 : 1.02,
        fromX: -panX,
        toX: panX,
        fromY: -panY,
        toY: panY,
      },
    };
  });

  const captions = combined.parsed.segments.flatMap((seg, i) => {
    const s = track.segments[i]!;
    return captionsForSegment(seg.text, at(s.start), at(s.end));
  });

  const sourceChips: TimedLabel[] = [];
  const rumorSpans: Array<{ start: number; end: number }> = [];
  script.lines.forEach((line, li) => {
    const span = lineSpan[li]!;
    const labels = [...new Set(line.sourceIds.map((id) => input.sourceLabels[id]).filter(Boolean))];
    if (labels.length) {
      const label = labels.slice(0, 2).join(' · ');
      const prev = sourceChips.at(-1);
      if (prev && prev.label === label && span.start - prev.end < 0.6) prev.end = span.end;
      else sourceChips.push({ start: span.start, end: span.end, label });
    }
    if (line.kind === 'rumor') {
      const prev = rumorSpans.at(-1);
      if (prev && span.start - prev.end < 0.6) prev.end = span.end;
      else rumorSpans.push({ ...span });
    }
  });

  return {
    format,
    ...videoSize(format, input.resolution),
    fps,
    durationSec,
    introSec,
    outroSec,
    voiceSrc: input.voiceSrc,
    voiceStartSec: introSec,
    character,
    blinkSeed: seedFrom(script.title),
    scenes,
    captions,
    sourceChips,
    rumorSpans,
    storyIsRumor: input.storyIsRumor,
    credits: input.credits,
    title: script.title,
    channelName: input.channelName,
    aiNotice: AI_NOTICE,
  };
}

/** Instantes para o Revisor visual: meio de cada cena + início de um selo de fonte e de rumor. */
export function reviewTimes(plan: VideoPlan, max = 12): number[] {
  const times = new Set<number>();
  for (const s of plan.scenes) times.add(round(s.start + Math.min(2.5, (s.end - s.start) / 2)));
  if (plan.sourceChips[0]) times.add(round(plan.sourceChips[0].start + 0.8));
  if (plan.rumorSpans[0]) times.add(round(plan.rumorSpans[0].start + 0.8));
  times.add(round(Math.max(0, plan.durationSec - plan.outroSec / 2)));
  return [...times]
    .filter((t) => t < plan.durationSec)
    .sort((a, b) => a - b)
    .slice(0, max);
}

export interface ThumbnailSpec {
  width: number;
  height: number;
  image: string | null;
  headline: string;
  expression: Expression;
  rumor: boolean;
  variant: number;
  channelName: string;
}

/** Três variações de thumbnail: textos diferentes, imagens de cenas diferentes, layout espelhado. */
export function thumbnailSpecs(
  script: VideoScript,
  plan: VideoPlan,
  expressionAlternatives: Expression[] = ['surpreso', 'debochado', 'feliz'],
): ThumbnailSpec[] {
  const images = plan.scenes.map((s) => s.image).filter((x): x is string => Boolean(x));
  return script.thumbnailTexts.map((headline, i) => ({
    width: 1280,
    height: 720,
    image: images.length ? images[i % images.length]! : null,
    headline,
    expression: i === 0 ? script.thumbnailExpression : expressionAlternatives[i % 3]!,
    rumor: plan.storyIsRumor || plan.rumorSpans.length > 0,
    variant: i,
    channelName: plan.channelName,
  }));
}
