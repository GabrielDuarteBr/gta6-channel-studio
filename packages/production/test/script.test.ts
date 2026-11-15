import { describe, expect, it } from 'vitest';
import {
  captionsForSegment,
  estimatedNarrationSec,
  finalizeScript,
  linesForCheck,
  ScriptValidationError,
} from '../src';
import { writerOutput } from './fixtures';

describe('roteiro: validação e normalização', () => {
  it('roteiro bom vira VideoScript; textos de thumbnail em caixa alta', () => {
    const s = finalizeScript(writerOutput, 'LONG');
    expect(s.format).toBe('LONG');
    expect(s.thumbnailTexts).toEqual(['ROCKSTAR CONFIRMOU!', 'É VERDADE?', 'NOVIDADE NO AR']);
    expect(linesForCheck(s)[1]).toEqual({
      id: 2,
      kind: 'fato',
      spoken: 'A Rockstar confirmou a data no site oficial. Anota aí.',
      sourceIds: ['n1'],
    });
    expect(estimatedNarrationSec(s)).toBeGreaterThan(5);
  });

  it('cena inexistente, cena que volta, marcação errada e cena sem prompt são recusadas', () => {
    const bad = structuredClone(writerOutput);
    bad.lines[3]!.scene = 9;
    expect(() => finalizeScript(bad, 'LONG')).toThrow(/cena 9 não existe/);
    const back = structuredClone(writerOutput);
    back.lines[3]!.scene = 1;
    expect(() => finalizeScript(back, 'LONG')).toThrow(/volta para trás/);
    const tag = structuredClone(writerOutput);
    tag.lines[0]!.text = '[dancando] oi';
    expect(() => finalizeScript(tag, 'LONG')).toThrow(ScriptValidationError);
    const noPrompt = structuredClone(writerOutput);
    noPrompt.scenes[1]!.imagePrompt = null;
    expect(() => finalizeScript(noPrompt, 'LONG')).toThrow(/falta imagePrompt/);
  });
});

describe('legendas', () => {
  it('cartões curtos, quebra na pontuação, tempos cobrem o trecho', () => {
    const caps = captionsForSegment(
      'A Rockstar confirmou a data no site oficial. Anota aí, galera.',
      10,
      14,
    );
    expect(caps.map((c) => c.text)).toEqual([
      'A Rockstar confirmou a data',
      'no site oficial.',
      'Anota aí, galera.',
    ]);
    expect(caps[0]!.start).toBe(10);
    expect(caps.at(-1)!.end).toBe(14);
    for (let i = 1; i < caps.length; i++) expect(caps[i]!.start).toBeCloseTo(caps[i - 1]!.end, 3);
  });
});
