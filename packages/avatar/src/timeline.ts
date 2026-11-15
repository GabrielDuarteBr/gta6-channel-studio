import type { ParsedScript } from './markup';
import {
  GESTURE_SECONDS,
  MOUTH_SHAPES,
  type Expression,
  type Gesture,
  type MouthShape,
} from './spec';

/**
 * Linha do tempo do personagem, em segundos, montada a partir do roteiro, dos tempos
 * de cada trecho na trilha de voz e das formas de boca do Rhubarb. Tudo puro e
 * determinístico: o mesmo roteiro e o mesmo áudio dão sempre os mesmos quadros.
 */

export interface MouthCue {
  start: number;
  end: number;
  value: MouthShape;
}

export interface VoiceTrackTiming {
  durationSec: number;
  segments: Array<{ start: number; end: number }>;
}

export interface CharacterTimeline {
  durationSec: number;
  expressions: Array<{ start: number; end: number; expression: Expression }>;
  gestures: Array<{ start: number; end: number; gesture: Gesture }>;
  mouthCues: MouthCue[];
}

export function buildTimeline(
  parsed: ParsedScript,
  track: VoiceTrackTiming,
  mouthCues: Array<{ start: number; end: number; value: string }>,
): CharacterTimeline {
  if (track.segments.length !== parsed.segments.length) {
    throw new Error(
      `a trilha tem ${track.segments.length} trechos, o roteiro tem ${parsed.segments.length}`,
    );
  }
  const duration = track.durationSec;
  const expressions: CharacterTimeline['expressions'] = [];
  const gestures: CharacterTimeline['gestures'] = [];
  parsed.segments.forEach((seg, i) => {
    const start = i === 0 ? 0 : track.segments[i]!.start;
    const last = expressions.at(-1);
    if (last && last.expression === seg.expression) {
      // mesma expressão: só estende
    } else {
      if (last) last.end = start;
      expressions.push({ start, end: duration, expression: seg.expression });
    }
    for (const gesture of seg.gestures) {
      const gStart = track.segments[i]!.start;
      gestures.push({
        start: gStart,
        end: Math.min(duration, gStart + GESTURE_SECONDS[gesture]),
        gesture,
      });
    }
  });
  const valid = new Set<string>(MOUTH_SHAPES);
  return {
    durationSec: duration,
    expressions,
    gestures,
    mouthCues: mouthCues
      .filter((c) => valid.has(c.value) && c.end > c.start)
      .map((c) => ({ start: c.start, end: c.end, value: c.value as MouthShape })),
  };
}

function findAt<T extends { start: number; end: number }>(items: T[], t: number): T | undefined {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = items[mid]!;
    if (t < item.start) hi = mid - 1;
    else if (t >= item.end) lo = mid + 1;
    else return item;
  }
  return undefined;
}

export function mouthAt(cues: MouthCue[], t: number): MouthShape {
  return findAt(cues, t)?.value ?? 'X';
}

export function expressionAt(tl: CharacterTimeline, t: number): Expression {
  return findAt(tl.expressions, t)?.expression ?? tl.expressions.at(-1)?.expression ?? 'neutro';
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Gesto ativo e quanto do braço está levantado (0..1), com subida e descida suaves. */
export function gestureAt(
  tl: CharacterTimeline,
  t: number,
): { gesture: Gesture; amount: number; phase: number } | null {
  const g = tl.gestures.find((x) => t >= x.start && t < x.end);
  if (!g) return null;
  const len = g.end - g.start;
  const rise = Math.min(0.3, len / 3);
  const fall = Math.min(0.35, len / 3);
  const local = t - g.start;
  let amount = 1;
  if (local < rise) amount = smooth(local / rise);
  else if (local > len - fall) amount = smooth(Math.max(0, (len - local) / fall));
  return { gesture: g.gesture, amount, phase: local / len };
}

/** PRNG determinístico (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semente estável a partir de um texto (FNV-1a de 32 bits). */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Quadros em que cada piscada começa (intervalos de 2,2 a 5 s, sempre iguais para a semente). */
export function blinkSchedule(seed: number, durationSec: number, fps: number): number[] {
  const rand = seededRandom(seed);
  const frames: number[] = [];
  let t = 0.8 + rand() * 1.5;
  while (t < durationSec - 0.2) {
    frames.push(Math.round(t * fps));
    t += 2.2 + rand() * 2.8;
  }
  return frames;
}

/** Abertura do olho (1 = aberto, 0 = fechado) numa piscada de ~130 ms. */
export function eyeOpennessAt(schedule: number[], frame: number, fps: number): number {
  const curve = [0.35, 0, 0.1, 0.55];
  const step = 1000 / fps;
  for (const start of schedule) {
    const ms = (frame - start) * step;
    if (ms >= 0 && ms < curve.length * 33) return curve[Math.floor(ms / 33)] ?? 1;
    if (start > frame) break;
  }
  return 1;
}

/** Respiração: deslocamento suave do tronco (-1..1), ciclo de 3,6 s. */
export function breathAt(frame: number, fps: number): number {
  return Math.sin((2 * Math.PI * frame) / (fps * 3.6));
}
