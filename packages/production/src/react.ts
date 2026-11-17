import {
  buildTimeline,
  parseScript,
  ScriptMarkupError,
  seedFrom,
  type CharacterTimeline,
  type Expression,
  type ParsedScript,
  type ScriptSegment,
  type VoiceTrackTiming,
} from '@studio/avatar';
import {
  claimsToBeHuman,
  detectContentFlags,
  isSpoilerWindowActive,
  isSubstantiveComment,
  partnerDescriptionLines,
  type PartnerConditions,
  type ReactBlock,
  type SpoilerWindow,
} from '@studio/policy';
import { z } from 'zod';
import { AI_NOTICE, captionsForSegment, LINE_GAP_MS, type Caption } from './plan';
import { wordCount, WORDS_PER_SECOND } from './script';

/**
 * Short de react (Fase 4): trechos do vídeo do parceiro intercalados com o comentário do Zeca,
 * sempre com o clipe pausado enquanto ele fala (regra 3). O código escolhe os trechos
 * candidatos (cenas, fala, sem música); o Comentarista escolhe entre eles e escreve as falas;
 * o código confere tudo e monta o plano para a composição ReactShort.
 */

export const REACT_LAYOUTS = ['tv', 'split', 'cinema'] as const;
export type ReactLayout = (typeof REACT_LAYOUTS)[number];

export const MIN_CLIP_SEC = 2.5;
export const MAX_CLIP_SEC = 8;
/** Respiro entre o fim da fala e o clipe (e entre o clipe e a próxima fala). */
export const CLIP_GAP_SEC = 0.25;

export interface VideoAnalysisLike {
  durationSec: number;
  speech: Array<[number, number]>;
  segments: Array<{ start: number; end: number; text: string; music: boolean }>;
  music: Array<[number, number]>;
  loudness: number[];
  scenes: number[];
}

export interface ClipCandidate {
  index: number;
  start: number;
  end: number;
  /** O que o parceiro fala no trecho (transcrição). */
  transcript: string;
  score: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const overlaps = (a: number, b: number, c: number, d: number) => a < d && c < b;

/**
 * Trechos candidatos: janelas de ~clipSec começando em trocas de cena, começos de fala e a cada
 * 2 s; sem música (♪), sem cortar frase no meio quando dá; nota pelo volume, pela fala e pela
 * troca de cena. Devolve até `count` trechos sem sobreposição, em ordem de tempo.
 */
export function clipCandidates(
  a: VideoAnalysisLike,
  opts: { count?: number; clipSec?: number } = {},
): ClipCandidate[] {
  const count = opts.count ?? 6;
  const len = Math.min(MAX_CLIP_SEC, Math.max(MIN_CLIP_SEC, opts.clipSec ?? 5.5));
  const dur = a.durationSec;
  if (dur < MIN_CLIP_SEC) return [];
  const music = a.music.map(([s, e]) => [s - 0.5, e + 0.5] as const);
  const starts = new Set<number>();
  for (const s of a.scenes) starts.add(r2(s + 0.08));
  for (const [s] of a.speech) starts.add(r2(Math.max(0, s - 0.15)));
  for (let t = 0; t < dur; t += 2) starts.add(t);

  const windows: ClipCandidate[] = [];
  for (const start of starts) {
    if (start < 0 || start > dur - MIN_CLIP_SEC) continue;
    let end = Math.min(dur, start + len);
    // Não corta frase no meio: estica até o fim da fala (se couber) ou recua para antes dela.
    const cutting = a.speech.find(([s, e]) => s < end && e > end);
    if (cutting) {
      if (cutting[1] - start <= MAX_CLIP_SEC) end = Math.min(dur, cutting[1] + 0.1);
      else if (cutting[0] - start >= MIN_CLIP_SEC) end = cutting[0];
    }
    if (end - start < MIN_CLIP_SEC) continue;
    if (music.some(([s, e]) => overlaps(start, end, s, e))) continue;
    const secs = a.loudness.slice(
      Math.floor(start),
      Math.max(Math.floor(start) + 1, Math.ceil(end)),
    );
    const loud = secs.length ? secs.reduce((x, y) => x + y, 0) / secs.length : -90;
    const loudScore = Math.max(0, Math.min(1, (loud + 50) / 40));
    const speechSec = a.speech.reduce(
      (n, [s, e]) => n + Math.max(0, Math.min(e, end) - Math.max(s, start)),
      0,
    );
    const sceneNear = a.scenes.some((s) => Math.abs(s - start) < 0.4) ? 1 : 0;
    const score = r2(loudScore * 0.5 + (speechSec / (end - start)) * 0.3 + sceneNear * 0.2);
    const transcript = a.segments
      .filter((s) => !s.music && overlaps(start, end, s.start, s.end))
      .map((s) => s.text)
      .join(' ')
      .slice(0, 400);
    windows.push({ index: 0, start: r2(start), end: r2(end), transcript, score });
  }
  windows.sort((x, y) => y.score - x.score || x.start - y.start);
  const picked: ClipCandidate[] = [];
  for (const w of windows) {
    if (picked.length >= count) break;
    if (picked.some((p) => overlaps(w.start - 1, w.end + 1, p.start, p.end))) continue;
    picked.push(w);
  }
  return picked.sort((x, y) => x.start - y.start).map((w, i) => ({ ...w, index: i }));
}

// ---------------------------------------------------------------------------------------------
// Roteiro (saída do Comentarista)

export const commentatorOutputSchema = z.object({
  title: z
    .string()
    .describe('Título do Short no YouTube, PT-BR, até 80 caracteres, sem caça-clique mentiroso'),
  description: z
    .string()
    .describe('1 ou 2 frases em PT-BR. Crédito, link e avisos são acrescentados pelo sistema.'),
  assessments: z
    .array(
      z.object({
        candidate: z.number().int(),
        cutscene: z.boolean().describe('o trecho é cena cinematográfica do jogo (não gameplay)'),
        inGameEntertainment: z
          .boolean()
          .describe('mostra rádio, TV, cinema ou show de dentro do jogo como atração principal'),
        thirdPartyMedia: z
          .boolean()
          .describe('aparece filme, série, clipe musical ou programa de TV de terceiros'),
        leakOrCheat: z
          .boolean()
          .describe('parece material vazado, cópia antecipada, trapaça, hack ou mod'),
        spoiler: z.boolean().describe('revela final, morte ou reviravolta da história'),
      }),
    )
    .describe('Uma avaliação para CADA trecho candidato, pelo quadro e pela transcrição'),
  intro: z
    .string()
    .describe(
      'Fala do apresentador ANTES do primeiro trecho: contexto em 1 ou 2 frases, com marcações',
    ),
  picks: z
    .array(
      z.object({
        candidate: z.number().int().describe('índice do trecho candidato'),
        comment: z
          .string()
          .describe(
            'Fala do apresentador DEPOIS deste trecho, com o clipe pausado: opinião ou explicação concreta (1 a 3 frases, com marcações)',
          ),
      }),
    )
    .describe('De 1 a 3 trechos, na ordem do vídeo'),
});
export type CommentatorOutput = z.infer<typeof commentatorOutputSchema>;
export type ClipAssessment = CommentatorOutput['assessments'][number];

export interface ReactPick {
  candidate: number;
  start: number;
  end: number;
  comment: string;
}

export interface ReactScript {
  title: string;
  description: string;
  intro: string;
  picks: ReactPick[];
  assessments: ClipAssessment[];
}

export const reactScriptSchema = z.object({
  title: z.string().min(8).max(100),
  description: z.string().min(10).max(1000),
  intro: z.string().min(2).max(500),
  picks: z
    .array(
      z.object({
        candidate: z.number().int().min(0),
        start: z.number().min(0),
        end: z.number().positive(),
        comment: z.string().min(2).max(600),
      }),
    )
    .min(1)
    .max(3),
  assessments: z.array(
    z.object({
      candidate: z.number().int(),
      cutscene: z.boolean(),
      inGameEntertainment: z.boolean(),
      thirdPartyMedia: z.boolean(),
      leakOrCheat: z.boolean(),
      spoiler: z.boolean(),
    }),
  ),
});

export class ReactScriptError extends Error {
  override name = 'ReactScriptError';
  constructor(public readonly issues: string[]) {
    super(`roteiro do react inválido: ${issues.slice(0, 5).join('; ')}`);
  }
}

const tidy = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

const spoken = (text: string) => parseScript(text).spokenText;

/** Normaliza a saída do Comentarista: trechos existentes, sem repetir, em ordem de tempo. */
export function finalizeReactScript(
  raw: CommentatorOutput,
  candidates: ClipCandidate[],
): ReactScript {
  const issues: string[] = [];
  const byIndex = new Map(candidates.map((c) => [c.index, c]));
  const seen = new Set<number>();
  const picks: ReactPick[] = [];
  for (const p of raw.picks) {
    const c = byIndex.get(p.candidate);
    if (!c) {
      issues.push(`trecho ${p.candidate} não existe`);
      continue;
    }
    if (seen.has(p.candidate)) {
      issues.push(`trecho ${p.candidate} repetido`);
      continue;
    }
    seen.add(p.candidate);
    picks.push({ candidate: c.index, start: c.start, end: c.end, comment: p.comment.trim() });
  }
  picks.sort((a, b) => a.start - b.start);
  const candidate = {
    title: tidy(raw.title, 100),
    description: tidy(raw.description, 1000),
    intro: raw.intro.trim(),
    picks,
    assessments: raw.assessments,
  };
  const parsed = reactScriptSchema.safeParse(candidate);
  if (!parsed.success)
    issues.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  for (const [i, text] of [raw.intro, ...picks.map((p) => p.comment)].entries()) {
    try {
      parseScript(text);
    } catch (err) {
      if (err instanceof ScriptMarkupError) issues.push(`fala ${i + 1}: ${err.message}`);
      else throw err;
    }
  }
  if (issues.length) throw new ReactScriptError(issues);
  return parsed.data as ReactScript;
}

/**
 * Regras no roteiro do react: comentário com conteúdo em todas as falas ("uau" não conta), o
 * Zeca não diz que é humano, nada de vazamento/trapaça/mods, e nenhum trecho escolhido com
 * cutscene isolada, entretenimento do jogo, mídia de terceiros, vazamento ou spoiler na janela.
 */
export function checkReactScript(
  script: ReactScript,
  opts: { spoilerWindow: SpoilerWindow; now?: Date; maxCommentSec?: number },
): string[] {
  const issues: string[] = [];
  const lines = [script.intro, ...script.picks.map((p) => p.comment)];
  lines.forEach((text, i) => {
    const s = spoken(text);
    if (!isSubstantiveComment(s)) {
      issues.push(
        `fala ${i + 1} sem conteúdo: "uau", "olha isso" e reações parecidas não contam como comentário`,
      );
    }
    if (claimsToBeHuman(s))
      issues.push(`fala ${i + 1}: o apresentador não pode dizer que é humano`);
    const flags = detectContentFlags(s);
    if (flags.leak || flags.onlineCheats || flags.mods) {
      issues.push(`fala ${i + 1} fala de vazamento, trapaça ou mods (proibido)`);
    }
    const maxSec = opts.maxCommentSec ?? 16;
    if (wordCount(s) / WORDS_PER_SECOND > maxSec) {
      issues.push(`fala ${i + 1} longa demais (máximo ~${maxSec} s)`);
    }
  });
  const assessed = new Map(script.assessments.map((a) => [a.candidate, a]));
  const spoilerActive = isSpoilerWindowActive(opts.spoilerWindow, opts.now);
  for (const p of script.picks) {
    const a = assessed.get(p.candidate);
    if (!a) {
      issues.push(`trecho ${p.candidate} sem avaliação`);
      continue;
    }
    if (a.cutscene) issues.push(`trecho ${p.candidate} é cutscene: escolha um trecho de gameplay`);
    if (a.inGameEntertainment) {
      issues.push(`trecho ${p.candidate} mostra entretenimento do jogo (rádio/TV/show) isolado`);
    }
    if (a.thirdPartyMedia)
      issues.push(`trecho ${p.candidate} tem filme, série ou música de terceiros`);
    if (a.leakOrCheat) issues.push(`trecho ${p.candidate} parece vazamento, trapaça ou mod`);
    if (a.spoiler && spoilerActive)
      issues.push(`trecho ${p.candidate} tem spoiler (janela anti-spoiler)`);
  }
  return issues;
}

/** Falas do react na ordem em que o Zeca fala (abertura e um comentário depois de cada trecho). */
export function reactLines(script: ReactScript): string[] {
  return [script.intro, ...script.picks.map((p) => p.comment)];
}

export interface CombinedReact {
  parsed: ParsedScript;
  /** Índice da fala de cada trecho de voz. */
  segmentLine: number[];
}

/**
 * Junta as falas numa trilha só: depois da fala i (antes do clipe i) entra uma pausa do tamanho
 * do clipe, para o Zeca ficar calado enquanto o trecho do parceiro passa.
 */
export function combineReactLines(script: ReactScript, clipDurations: number[]): CombinedReact {
  const lines = reactLines(script);
  const segments: ScriptSegment[] = [];
  const segmentLine: number[] = [];
  let leadInMs = 0;
  let expression: Expression = 'neutro';
  const warnings: string[] = [];
  lines.forEach((text, li) => {
    const p = parseScript(text, expression);
    if (li === 0) leadInMs = p.leadInMs;
    else if (p.leadInMs && segments.length) segments.at(-1)!.pauseAfterMs += p.leadInMs;
    for (const seg of p.segments) {
      segments.push({ ...seg, gestures: [...seg.gestures] });
      segmentLine.push(li);
    }
    const last = segments.at(-1)!;
    const clip = clipDurations[li];
    last.pauseAfterMs =
      clip === undefined
        ? Math.max(last.pauseAfterMs, LINE_GAP_MS)
        : Math.round((clip + 2 * CLIP_GAP_SEC) * 1000);
    expression = last.expression;
    warnings.push(...p.warnings);
  });
  return {
    parsed: { segments, leadInMs, spokenText: segments.map((s) => s.text).join(' '), warnings },
    segmentLine,
  };
}

/**
 * Quanto de clipe cabe: com os comentários somando C segundos, o clipe total B precisa de
 * B / (B + C) ≤ maxRatio, além do teto do parceiro. Encurta cada trecho por igual (mantendo o
 * mínimo) e devolve as durações finais.
 */
export function fitClipDurations(
  durations: number[],
  commentSec: number,
  opts: { maxRatio: number; maxClipSec?: number | null; safety?: number },
): number[] {
  const ratio = Math.min(0.5, opts.maxRatio) - (opts.safety ?? 0.02);
  let budget = (ratio / (1 - ratio)) * commentSec;
  if (opts.maxClipSec != null) budget = Math.min(budget, opts.maxClipSec);
  const total = durations.reduce((a, b) => a + b, 0);
  if (total <= budget) return durations.map(r2);
  const scale = budget / total;
  return durations.map((d) => r2(Math.max(MIN_CLIP_SEC, Math.floor(d * scale * 10) / 10)));
}

// ---------------------------------------------------------------------------------------------
// Plano (entrada da composição ReactShort)

export interface ReactClip {
  /** Arquivo cortado na pasta de trabalho. */
  src: string;
  durationSec: number;
  width: number;
  height: number;
}

export interface ReactPlanBlock {
  kind: 'comment' | 'clip';
  start: number;
  end: number;
  /** Clipe (índice em `clips`) que toca neste bloco, ou o último que tocou (pausado). */
  clip: number;
  spoken?: string;
  credit?: string;
}

export interface ReactPlan {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  layout: ReactLayout;
  voiceSrc: string;
  character: CharacterTimeline;
  blinkSeed: number;
  blocks: ReactPlanBlock[];
  clips: ReactClip[];
  captions: Caption[];
  credit: string;
  title: string;
  channelName: string;
  aiNotice: string;
}

export interface ReactPlanInput {
  script: ReactScript;
  combined: CombinedReact;
  track: VoiceTrackTiming;
  mouthCues: Array<{ start: number; end: number; value: string }>;
  voiceSrc: string;
  clips: ReactClip[];
  credit: string;
  layout: ReactLayout;
  channelName: string;
  resolution: '720p' | '1080p';
  fps?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildReactPlan(input: ReactPlanInput): ReactPlan {
  const { script, combined, track, clips } = input;
  const fps = input.fps ?? 30;
  const lines = reactLines(script);
  if (clips.length !== script.picks.length) throw new Error('um clipe por trecho escolhido');
  const lineSpan = lines.map((_, li) => {
    const idx = combined.segmentLine.flatMap((l, i) => (l === li ? [i] : []));
    return { start: track.segments[idx[0]!]!.start, end: track.segments[idx.at(-1)!]!.end };
  });
  const outroSec = 1.2;
  const durationSec = r3(track.durationSec + outroSec);
  const blocks: ReactPlanBlock[] = [];
  let cursor = 0;
  lines.forEach((text, li) => {
    const isLast = li === lines.length - 1;
    const clipStart = isLast ? durationSec : r3(lineSpan[li]!.end + CLIP_GAP_SEC);
    blocks.push({
      kind: 'comment',
      start: r3(cursor),
      end: clipStart,
      clip: Math.max(0, li - 1),
      spoken: spoken(text),
    });
    if (!isLast) {
      const clipEnd = r3(lineSpan[li + 1]!.start - CLIP_GAP_SEC);
      blocks.push({ kind: 'clip', start: clipStart, end: clipEnd, clip: li, credit: input.credit });
      cursor = clipEnd;
    }
  });
  const tl = buildTimeline(combined.parsed, track, input.mouthCues);
  const character: CharacterTimeline = {
    durationSec,
    expressions: tl.expressions.map((e, i, all) => ({
      ...e,
      start: i === 0 ? 0 : e.start,
      end: i === all.length - 1 ? durationSec : e.end,
    })),
    gestures: tl.gestures,
    mouthCues: tl.mouthCues,
  };
  const captions = combined.parsed.segments.flatMap((seg, i) => {
    const s = track.segments[i]!;
    return captionsForSegment(seg.text, s.start, s.end);
  });
  const base = input.resolution === '1080p' ? 1080 : 720;
  return {
    width: base,
    height: Math.round((base * 16) / 9),
    fps,
    durationSec,
    layout: input.layout,
    voiceSrc: input.voiceSrc,
    character,
    blinkSeed: seedFrom(`react:${script.title}`),
    blocks,
    clips,
    captions,
    credit: input.credit,
    title: script.title,
    channelName: input.channelName,
    aiNotice: AI_NOTICE,
  };
}

/** Blocos no formato da regra 3 (policy). */
export function reactBlocks(plan: ReactPlan): ReactBlock[] {
  return plan.blocks.map((b) => ({
    kind: b.kind,
    start: b.start,
    end: b.end,
    ...(b.spoken !== undefined ? { spoken: b.spoken } : {}),
    ...(b.kind === 'clip' ? { credit: b.credit ?? null } : {}),
  }));
}

/** Instantes para o Revisor visual: meio de cada clipe e de cada comentário, e o fim. */
export function reactReviewTimes(plan: ReactPlan, max = 10): number[] {
  const times = plan.blocks.map((b) => r3(b.start + (b.end - b.start) / 2));
  times.push(r3(Math.max(0, plan.durationSec - 0.6)));
  return [...new Set(times)]
    .filter((t) => t < plan.durationSec)
    .sort((a, b) => a - b)
    .slice(0, max);
}

/** Descrição do Short com o crédito, o link e a hashtag que o parceiro pediu e o aviso de IA. */
export function reactDescription(
  script: ReactScript,
  conditions: PartnerConditions,
  partnerName: string,
): string {
  const { lines, hashtags } = partnerDescriptionLines(conditions, partnerName);
  return [
    script.description.trim(),
    '',
    ...lines,
    '',
    `${AI_NOTICE}.`,
    '',
    ['#GTA6', '#Shorts', ...hashtags].join(' '),
  ].join('\n');
}

/** Layout do rodízio (varia entre os Shorts de react, sem repetir o anterior quando dá). */
export function pickReactLayout(enabled: ReactLayout[], previous: ReactLayout | null): ReactLayout {
  const list = enabled.length ? enabled : [...REACT_LAYOUTS];
  if (!previous || list.length === 1) return list[0]!;
  const i = list.indexOf(previous);
  return list[(i + 1) % list.length]!;
}
