import { describe, expect, it } from 'vitest';
import {
  buildVideoPlan,
  combineScriptLines,
  finalizeScript,
  reviewTimes,
  thumbnailSpecs,
} from '../src';
import { writerOutput } from './fixtures';

function fakeTrack(n: number) {
  // Cada trecho dura 1,5 s com 0,3 s entre eles, começando em 0,2 s.
  const segments = Array.from({ length: n }, (_, i) => ({
    start: 0.2 + i * 1.8,
    end: 1.7 + i * 1.8,
  }));
  return { durationSec: segments.at(-1)!.end + 0.5, segments };
}

describe('plano do vídeo', () => {
  const script = finalizeScript(writerOutput, 'LONG');
  const combined = combineScriptLines(script);

  it('junta as falas: trechos sabem de que fala vieram e a expressão continua', () => {
    expect(combined.segmentLine).toEqual([0, 1, 1, 2, 3]);
    expect(combined.parsed.segments.map((s) => s.expression)).toEqual([
      'feliz',
      'serio',
      'serio',
      'debochado',
      'debochado',
    ]);
    expect(combined.parsed.segments[0]!.gestures).toEqual(['aceno']);
  });

  it('cenas, legendas, fonte na tela e selo de rumor em tempo absoluto', () => {
    const track = fakeTrack(combined.parsed.segments.length);
    const plan = buildVideoPlan({
      script,
      combined,
      track,
      mouthCues: [{ start: 0.2, end: 0.5, value: 'B' }],
      voiceSrc: 'productions/p1/voz.wav',
      sceneImages: { 2: 'assets/gerada.png', 3: 'assets/oficial.jpg' },
      sourceLabels: { n1: 'Rockstar Newswire', n2: 'IGN', n3: 'GameSpot' },
      storyIsRumor: false,
      credits: ['Imagem: Rockstar Games'],
      channelName: 'Radar Neon',
      resolution: '720p',
    });
    expect(plan).toMatchObject({ width: 1280, height: 720, introSec: 1.5, voiceStartSec: 1.5 });
    expect(plan.durationSec).toBeCloseTo(1.5 + track.durationSec + 4, 3);
    expect(plan.scenes.map((s) => [s.id, s.image])).toEqual([
      [1, null],
      [2, 'assets/gerada.png'],
      [3, 'assets/oficial.jpg'],
    ]);
    expect(plan.scenes[0]!.start).toBe(0);
    expect(plan.scenes[1]!.start).toBeCloseTo(1.5 + 2.0, 3);
    expect(plan.scenes.at(-1)!.end).toBe(plan.durationSec);
    expect(plan.sourceChips).toEqual([
      { start: 3.5, end: 6.8, label: 'Rockstar Newswire' },
      { start: 7.1, end: 8.6, label: 'IGN · GameSpot' },
    ]);
    expect(plan.rumorSpans).toEqual([{ start: 7.1, end: 8.6 }]);
    expect(plan.character.mouthCues[0]).toEqual({ start: 1.7, end: 2, value: 'B' });
    expect(plan.captions[0]).toMatchObject({ start: 1.7, text: 'Fala, galera do Radar!' });
    const times = reviewTimes(plan);
    expect(times.length).toBeGreaterThanOrEqual(4);
    expect(times.every((t) => t < plan.durationSec)).toBe(true);
    const thumbs = thumbnailSpecs(script, plan);
    expect(thumbs.map((t) => [t.headline, t.image, t.rumor])).toEqual([
      ['ROCKSTAR CONFIRMOU!', 'assets/gerada.png', true],
      ['É VERDADE?', 'assets/oficial.jpg', true],
      ['NOVIDADE NO AR', 'assets/gerada.png', true],
    ]);
  });

  it('Short: 720x1280, abertura curta', () => {
    const short = finalizeScript(writerOutput, 'SHORT');
    const c = combineScriptLines(short);
    const plan = buildVideoPlan({
      script: short,
      combined: c,
      track: fakeTrack(c.parsed.segments.length),
      mouthCues: [],
      voiceSrc: 'v.wav',
      sceneImages: {},
      sourceLabels: {},
      storyIsRumor: true,
      credits: [],
      channelName: 'Radar Neon',
      resolution: '720p',
    });
    expect([plan.width, plan.height, plan.introSec]).toEqual([720, 1280, 0.4]);
    expect(plan.scenes.every((s) => s.image === null)).toBe(true);
  });
});
