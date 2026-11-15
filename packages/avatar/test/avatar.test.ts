import { describe, expect, it } from 'vitest';
import {
  blinkSchedule,
  buildTimeline,
  DEFAULT_BIBLE,
  expressionAt,
  expressionsUsed,
  eyeOpennessAt,
  frameState,
  gestureAt,
  LOCKED_RULES,
  mouthAt,
  parseScript,
  ScriptMarkupError,
  seedFrom,
  validateBible,
} from '../src';

const ROTEIRO =
  '[feliz] Fala, galera do Radar! [pausa] [surpreso] [aponta_tela] Saiu trailer novo de GTA 6! ' +
  '[sério] Mas calma: o preço ainda é rumor. [pausa:600] [debochado] Vai ter gente vendendo o rim.';

describe('marcações do roteiro', () => {
  it('quebra em trechos com expressão, gestos e pausas', () => {
    const p = parseScript(ROTEIRO);
    expect(p.segments).toEqual([
      { text: 'Fala, galera do Radar!', expression: 'feliz', gestures: [], pauseAfterMs: 400 },
      {
        text: 'Saiu trailer novo de GTA 6!',
        expression: 'surpreso',
        gestures: ['aponta_tela'],
        pauseAfterMs: 0,
      },
      {
        text: 'Mas calma: o preço ainda é rumor.',
        expression: 'serio',
        gestures: [],
        pauseAfterMs: 600,
      },
      {
        text: 'Vai ter gente vendendo o rim.',
        expression: 'debochado',
        gestures: [],
        pauseAfterMs: 0,
      },
    ]);
    expect(p.spokenText).not.toContain('[');
    expect(expressionsUsed(p)).toHaveLength(4);
  });

  it('acentos e maiúsculas nas marcações são aceitos; texto sem marcação é neutro', () => {
    expect(parseScript('[SÉRIO] oi').segments[0]?.expression).toBe('serio');
    expect(parseScript('só texto').segments[0]?.expression).toBe('neutro');
    expect(parseScript('[pausa] oi').leadInMs).toBe(400);
  });

  it('recusa marcação desconhecida, pausa fora do intervalo e roteiro sem fala', () => {
    expect(() => parseScript('[dança] oi')).toThrow(
      /marcação desconhecida \[dança\].*\[surpreso\]/,
    );
    expect(() => parseScript('[pausa:5000] oi')).toThrow(ScriptMarkupError);
    expect(() => parseScript('[feliz] [pausa]')).toThrow(/nenhuma fala/);
    expect(parseScript('oi [aceno]').warnings).toHaveLength(1);
  });
});

describe('linha do tempo', () => {
  const parsed = parseScript(ROTEIRO);
  const track = {
    durationSec: 10,
    segments: [
      { start: 0.2, end: 1.6 },
      { start: 2.0, end: 3.8 },
      { start: 3.8, end: 6.0 },
      { start: 6.6, end: 9.4 },
    ],
  };
  const cues = [
    { start: 0, end: 0.2, value: 'X' },
    { start: 0.2, end: 0.5, value: 'B' },
    { start: 0.5, end: 0.9, value: 'D' },
    { start: 0.9, end: 1.0, value: '?' },
  ];
  const tl = buildTimeline(parsed, track, cues);

  it('expressões cobrem o áudio inteiro, na hora de cada trecho', () => {
    expect(tl.expressions.map((e) => [e.expression, e.start, e.end])).toEqual([
      ['feliz', 0, 2.0],
      ['surpreso', 2.0, 3.8],
      ['serio', 3.8, 6.6],
      ['debochado', 6.6, 10],
    ]);
    expect(expressionAt(tl, 2.5)).toBe('surpreso');
    expect(expressionAt(tl, 99)).toBe('debochado');
  });

  it('gesto começa com o trecho e sobe/desce suave', () => {
    expect(tl.gestures).toEqual([{ start: 2.0, end: 3.8, gesture: 'aponta_tela' }]);
    expect(gestureAt(tl, 1.9)).toBeNull();
    expect(gestureAt(tl, 2.0)?.amount).toBe(0);
    expect(gestureAt(tl, 2.9)?.amount).toBe(1);
  });

  it('boca segue o Rhubarb e descarta forma inválida', () => {
    expect(mouthAt(tl.mouthCues, 0.6)).toBe('D');
    expect(mouthAt(tl.mouthCues, 0.95)).toBe('X');
    expect(tl.mouthCues).toHaveLength(3);
  });

  it('trilha e roteiro precisam ter o mesmo número de trechos', () => {
    expect(() => buildTimeline(parsed, { durationSec: 1, segments: [] }, [])).toThrow(/trechos/);
  });

  it('piscadas e quadros são determinísticos', () => {
    const seed = seedFrom(ROTEIRO);
    const a = blinkSchedule(seed, 10, 30);
    expect(blinkSchedule(seed, 10, 30)).toEqual(a);
    expect(blinkSchedule(seed + 1, 10, 30)).not.toEqual(a);
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(eyeOpennessAt(a, a[0]!, 30)).toBeLessThan(0.5);
    expect(eyeOpennessAt(a, a[0]! + 1, 30)).toBe(0);
    expect(eyeOpennessAt(a, a[0]! - 1, 30)).toBe(1);
    const states = [0, 15, 75, 200].map((f) => frameState(tl, f, 30, a));
    expect([0, 15, 75, 200].map((f) => frameState(tl, f, 30, a))).toEqual(states);
    expect(states[1]?.mouth).toBe('D');
    expect(states[2]?.gesture?.id).toBe('aponta_tela');
  });
});

describe('bíblia do personagem', () => {
  it('a padrão é válida e traz as regras fixas', () => {
    expect(validateBible(DEFAULT_BIBLE).name).toBe('Zeca Neon');
    for (const rule of LOCKED_RULES) expect(DEFAULT_BIBLE.rules).toContain(rule);
  });

  it('não deixa remover regra fixa', () => {
    const semRegra = { ...DEFAULT_BIBLE, rules: DEFAULT_BIBLE.rules.slice(1) };
    expect(() => validateBible(semRegra)).toThrow(/regras fixas/);
  });
});
