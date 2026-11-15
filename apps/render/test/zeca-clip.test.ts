import { describe, expect, it } from 'vitest';
import { rivePocSchema } from '../src/remotion/RivePoc';
import { calculateZecaClipMetadata, zecaClipSchema } from '../src/remotion/ZecaClip';
import { workPath } from '../src/work-path';

const props = {
  audioSrc: 'http://127.0.0.1:4200/work/clips/x/voz.wav',
  seed: 7,
  provisional: true,
  label: 'teste',
  timeline: {
    durationSec: 2.5,
    expressions: [{ start: 0, end: 2.5, expression: 'surpreso' }],
    gestures: [{ start: 0.5, end: 2, gesture: 'aponta_tela' }],
    mouthCues: [{ start: 0, end: 2.5, value: 'D' }],
  },
  captions: [{ start: 0, end: 2.5, text: 'oi' }],
};

describe('ZecaClip', () => {
  it('valida as props e recusa expressão ou boca desconhecida', () => {
    expect(zecaClipSchema.parse(props)).toBeTruthy();
    const bad = {
      ...props,
      timeline: { ...props.timeline, mouthCues: [{ start: 0, end: 1, value: 'Z' }] },
    };
    expect(() => zecaClipSchema.parse(bad)).toThrow();
  });

  it('duração do vídeo = duração da trilha de voz (30 fps)', async () => {
    const meta = await calculateZecaClipMetadata({
      props: zecaClipSchema.parse(props),
      defaultProps: zecaClipSchema.parse(props),
      abortSignal: new AbortController().signal,
      compositionId: 'ZecaClip',
      isRendering: true,
    });
    expect(meta).toMatchObject({ fps: 30, durationInFrames: 75 });
  });

  it('prova de conceito do Rive valida as props', () => {
    expect(
      rivePocSchema.parse({
        src: 'a.riv',
        wasm: 'rive.wasm',
        stateMachine: 'State Machine 1',
        input: 'rating',
        values: [1, 2],
        secondsPerValue: 1,
      }),
    ).toBeTruthy();
  });
});

describe('servidor de render: pasta de trabalho', () => {
  it('só aceita caminhos relativos dentro dela', () => {
    expect(workPath('clips/a/voz.wav', '/data/work')).toBe('/data/work/clips/a/voz.wav');
    expect(workPath('../etc/passwd', '/data/work')).toBeNull();
    expect(workPath('/etc/passwd', '/data/work')).toBeNull();
    expect(workPath('clips/../../etc/passwd', '/data/work')).toBeNull();
    expect(workPath('a b.wav', '/data/work')).toBeNull();
  });
});
