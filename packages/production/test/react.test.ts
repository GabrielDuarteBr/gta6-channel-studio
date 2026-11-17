import { assertReactTimeline, checkDescriptionConditions } from '@studio/policy';
import { describe, expect, it } from 'vitest';
import {
  buildReactPlan,
  checkReactScript,
  clipCandidates,
  combineReactLines,
  finalizeReactScript,
  fitClipDurations,
  pickReactLayout,
  reactBlocks,
  reactDescription,
  reactReviewTimes,
  ReactScriptError,
  type CommentatorOutput,
  type VideoAnalysisLike,
} from '../src';

const analysis: VideoAnalysisLike = {
  durationSec: 40,
  speech: [
    [1, 4.5],
    [12, 16],
    [25, 27],
  ],
  segments: [
    { start: 1, end: 4.5, text: 'Olha a perseguição na ponte', music: false },
    { start: 12, end: 16, text: 'O carro novo voa na rampa', music: false },
    { start: 18, end: 24, text: '♪ la la la ♪', music: true },
    { start: 25, end: 27, text: 'E a polícia chegou', music: false },
  ],
  music: [[18, 24]],
  loudness: Array.from({ length: 40 }, (_, i) => (i >= 12 && i < 17 ? -12 : -30)),
  scenes: [6, 12, 30],
};

const spoilerWindow = { launchDate: '2026-11-19', windowDays: 30 };

describe('trechos candidatos', () => {
  it('evita música, não corta fala no meio e sai em ordem de tempo', () => {
    const c = clipCandidates(analysis, { count: 4, clipSec: 5 });
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(c.map((x) => x.index)).toEqual(c.map((_, i) => i));
    for (let i = 1; i < c.length; i++) expect(c[i]!.start).toBeGreaterThan(c[i - 1]!.end);
    for (const x of c) {
      expect(x.end - x.start).toBeGreaterThanOrEqual(2.5);
      expect(x.end - x.start).toBeLessThanOrEqual(8.2);
      // Nada entre 17,5 e 24,5 s (música com margem).
      expect(x.end <= 17.5 || x.start >= 24.5).toBe(true);
    }
    // O trecho mais animado (12-17 s, com fala) entra.
    expect(c.some((x) => x.start <= 12.1 && x.end >= 16)).toBe(true);
    expect(c.find((x) => x.start >= 11 && x.start <= 12.1)!.transcript).toContain('rampa');
    expect(clipCandidates({ ...analysis, durationSec: 2 })).toEqual([]);
  });
});

const candidates = clipCandidates(analysis, { count: 4, clipSec: 5 });
const raw: CommentatorOutput = {
  title: 'Zeca reage: perseguição na ponte',
  description: 'O Zeca comenta a perseguição mais louca da semana.',
  assessments: candidates.map((c) => ({
    candidate: c.index,
    cutscene: false,
    inGameEntertainment: false,
    thirdPartyMedia: false,
    leakOrCheat: false,
    spoiler: false,
  })),
  intro: '[feliz] Bora ver a perseguição que o parceiro gravou na ponte de Leonida.',
  picks: [
    {
      candidate: candidates[1]!.index,
      comment: '[surpreso] Repara como o carro decola na rampa, a física da suspensão mudou muito.',
    },
    {
      candidate: candidates[0]!.index,
      comment:
        '[debochado] E o motorista ainda freia antes da curva, coisa que ninguém faz no GTA.',
    },
  ],
};

describe('roteiro do react', () => {
  it('organiza os trechos em ordem de tempo e confere as regras', () => {
    const s = finalizeReactScript(raw, candidates);
    expect(s.picks.map((p) => p.start)).toEqual(
      [...s.picks.map((p) => p.start)].sort((a, b) => a - b),
    );
    expect(checkReactScript(s, { spoilerWindow })).toEqual([]);
  });

  it('recusa trecho inexistente, comentário vazio, humano e trecho com cutscene', () => {
    expect(() =>
      finalizeReactScript({ ...raw, picks: [{ candidate: 99, comment: 'x' }] }, candidates),
    ).toThrow(ReactScriptError);
    const s = finalizeReactScript(raw, candidates);
    const generic = { ...s, intro: '[surpreso] Uau! Olha isso!' };
    expect(checkReactScript(generic, { spoilerWindow })[0]).toMatch(/não contam/);
    const human = { ...s, intro: 'Eu sou humano e vi essa perseguição de perto no centro.' };
    expect(checkReactScript(human, { spoilerWindow }).join(' ')).toMatch(/humano/);
    const cut = {
      ...s,
      assessments: s.assessments.map((a) => ({ ...a, cutscene: true })),
    };
    expect(checkReactScript(cut, { spoilerWindow }).join(' ')).toMatch(/cutscene/);
    const spoiler = { ...s, assessments: s.assessments.map((a) => ({ ...a, spoiler: true })) };
    expect(
      checkReactScript(spoiler, { spoilerWindow, now: new Date('2026-11-25T12:00:00Z') }).join(' '),
    ).toMatch(/spoiler/);
    expect(
      checkReactScript(spoiler, { spoilerWindow, now: new Date('2026-11-10T12:00:00Z') }),
    ).toEqual([]);
  });
});

describe('plano do react', () => {
  const script = finalizeReactScript(raw, candidates);

  it('encurta os clipes para caber na regra dos 50% (com folga) e no teto do parceiro', () => {
    expect(fitClipDurations([5, 5], 20, { maxRatio: 0.45 })).toEqual([5, 5]);
    const fitted = fitClipDurations([8, 8, 8], 12, { maxRatio: 0.45 });
    expect(
      fitted.reduce((a, b) => a + b, 0) / (12 + fitted.reduce((a, b) => a + b, 0)),
    ).toBeLessThanOrEqual(0.45);
    expect(fitClipDurations([5, 5], 30, { maxRatio: 0.5, maxClipSec: 6 })).toEqual([3, 3]);
  });

  it('trilha com o Zeca calado durante cada clipe e blocos que passam na regra 3', () => {
    const clipDur = [4, 3.5];
    const combined = combineReactLines(script, clipDur);
    const lastOfLine = (li: number) => combined.segmentLine.lastIndexOf(li);
    expect(combined.parsed.segments[lastOfLine(0)]!.pauseAfterMs).toBe(4500);
    expect(combined.parsed.segments[lastOfLine(1)]!.pauseAfterMs).toBe(4000);
    // Trilha simulada: cada trecho de voz dura 3 s, com as pausas pedidas.
    let t = 0.3;
    const segments = combined.parsed.segments.map((s) => {
      const seg = { start: t, end: t + 3 };
      t = seg.end + s.pauseAfterMs / 1000;
      return seg;
    });
    const track = { durationSec: t + 0.3, segments };
    const plan = buildReactPlan({
      script,
      combined,
      track,
      mouthCues: [],
      voiceSrc: 'react/voz.wav',
      clips: clipDur.map((d, i) => ({
        src: `react/c${i}.mp4`,
        durationSec: d,
        width: 1280,
        height: 720,
      })),
      credit: 'Canal do Fulano',
      layout: 'tv',
      channelName: 'Radar Neon',
      resolution: '720p',
    });
    expect(plan.blocks.map((b) => b.kind)).toEqual([
      'comment',
      'clip',
      'comment',
      'clip',
      'comment',
    ]);
    const clips = plan.blocks.filter((b) => b.kind === 'clip');
    expect(clips.map((b) => Math.round((b.end - b.start) * 10) / 10)).toEqual([4, 3.5]);
    expect(plan.width).toBe(720);
    expect(plan.height).toBe(1280);
    const stats = assertReactTimeline(reactBlocks(plan), { credit: 'Canal do Fulano' });
    expect(stats.clipRatio).toBeLessThanOrEqual(0.5);
    expect(stats.commentRatio).toBeGreaterThanOrEqual(0.5);
    // Legendas só nas falas.
    for (const c of plan.captions) {
      expect(clips.some((b) => c.start >= b.start && c.end <= b.end)).toBe(false);
    }
    expect(reactReviewTimes(plan).length).toBeGreaterThanOrEqual(5);
  });

  it('descrição com crédito, link, hashtag e aviso de IA; layouts em rodízio', () => {
    const conditions = {
      credit: 'Canal do Fulano',
      link: 'https://www.youtube.com/@fulano',
      hashtag: '#fulanogames',
      monetization: 'allowed' as const,
    };
    const d = reactDescription(script, conditions, 'Fulano');
    expect(checkDescriptionConditions(d, conditions)).toEqual([]);
    expect(d).toContain('voz sintética (IA)');
    expect(pickReactLayout(['tv', 'split', 'cinema'], null)).toBe('tv');
    expect(pickReactLayout(['tv', 'split', 'cinema'], 'tv')).toBe('split');
    expect(pickReactLayout(['tv', 'split', 'cinema'], 'cinema')).toBe('tv');
  });
});
