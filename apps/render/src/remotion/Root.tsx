import { Composition, staticFile } from 'remotion';
import type { ReactPlan, ThumbnailSpec, VideoPlan } from '@studio/production';
import { HelloZeca, helloZecaSchema } from './HelloZeca';
import {
  calculateNewsVideoMetadata,
  NewsVideo,
  newsVideoSchema,
  type NewsVideoProps,
} from './news/NewsVideo';
import { Thumbnail, thumbnailSchema, type ThumbnailProps } from './news/Thumbnail';
import {
  calculateReactShortMetadata,
  ReactShort,
  reactShortSchema,
  type ReactShortProps,
} from './react/ReactShort';
import { RivePoc, rivePocSchema, type RivePocProps } from './RivePoc';
import {
  calculateZecaClipMetadata,
  ZECA_FPS,
  ZecaClip,
  zecaClipSchema,
  type ZecaClipProps,
} from './ZecaClip';

const defaults = { channelName: 'Radar Neon', characterName: 'Zeca Neon' };

/** Props de exemplo (o job sempre manda as reais). */
const zecaDefaults: ZecaClipProps = {
  audioSrc: staticFile('zeca/silencio.wav'),
  seed: 42,
  provisional: true,
  label: 'Clipe de teste do personagem',
  timeline: {
    durationSec: 1,
    expressions: [{ start: 0, end: 1, expression: 'feliz' }],
    gestures: [],
    mouthCues: [
      { start: 0, end: 0.3, value: 'B' },
      { start: 0.3, end: 0.7, value: 'D' },
      { start: 0.7, end: 1, value: 'X' },
    ],
  },
  captions: [{ start: 0, end: 1, text: 'Fala, galera do Radar!' }],
};

const riveDefaults: RivePocProps = {
  src: staticFile('poc/rating.riv'),
  wasm: staticFile('rive/rive.wasm'),
  stateMachine: 'State Machine 1',
  input: 'rating',
  values: [1, 3, 5, 2, 4],
  secondsPerValue: 0.8,
};

/** Plano de exemplo para o Remotion Studio (o job manda o real). */
const samplePlan: VideoPlan = {
  format: 'LONG',
  width: 1280,
  height: 720,
  fps: 30,
  durationSec: 6,
  introSec: 1.5,
  outroSec: 2,
  voiceSrc: staticFile('zeca/silencio.wav'),
  voiceStartSec: 1.5,
  character: {
    durationSec: 6,
    expressions: [{ start: 0, end: 6, expression: 'feliz' }],
    gestures: [],
    mouthCues: [
      { start: 1.6, end: 2.0, value: 'B' },
      { start: 2.0, end: 2.5, value: 'D' },
    ],
  },
  blinkSeed: 7,
  scenes: [
    {
      id: 1,
      start: 0,
      end: 6,
      image: null,
      headline: 'Exemplo de cena',
      motion: { fromScale: 1, toScale: 1.1, fromX: 0, toX: 0, fromY: 0, toY: 0 },
    },
  ],
  captions: [{ start: 1.6, end: 3.5, text: 'Fala, galera do Radar!' }],
  sourceChips: [{ start: 1.6, end: 3.5, label: 'Rockstar Newswire' }],
  rumorSpans: [],
  storyIsRumor: false,
  credits: [],
  title: 'Exemplo de vídeo de notícia',
  channelName: 'Radar Neon',
  aiNotice: 'Apresentador animado com voz sintética (IA)',
};
const newsDefaults: NewsVideoProps = { plan: samplePlan, workBaseUrl: '', provisional: true };
const sampleThumb: ThumbnailSpec = {
  width: 1280,
  height: 720,
  image: null,
  headline: 'SAIU AGORA',
  expression: 'surpreso',
  rumor: false,
  variant: 0,
  channelName: 'Radar Neon',
};
const thumbDefaults: ThumbnailProps = { spec: sampleThumb, workBaseUrl: '', provisional: true };

/** Plano de exemplo do react (o job sempre manda o real, com os clipes cortados). */
const sampleReact: ReactPlan = {
  width: 720,
  height: 1280,
  fps: 30,
  durationSec: 6,
  layout: 'tv',
  voiceSrc: staticFile('zeca/silencio.wav'),
  character: {
    durationSec: 6,
    expressions: [{ start: 0, end: 6, expression: 'feliz' }],
    gestures: [],
    mouthCues: [{ start: 0, end: 6, value: 'X' }],
  },
  blinkSeed: 7,
  blocks: [
    { kind: 'comment', start: 0, end: 2, clip: 0, spoken: 'Bora ver o clipe do parceiro.' },
    { kind: 'clip', start: 2, end: 4, clip: 0, credit: 'Canal do Parceiro' },
    { kind: 'comment', start: 4, end: 6, clip: 0, spoken: 'Repara na física do carro.' },
  ],
  clips: [],
  captions: [{ start: 0, end: 2, text: 'Bora ver o clipe' }],
  credit: 'Canal do Parceiro',
  title: 'Exemplo de react',
  channelName: 'Radar Neon',
  aiNotice: 'Apresentador animado com voz sintética (IA)',
};
const reactDefaults: ReactShortProps = { plan: sampleReact, workBaseUrl: '', provisional: true };

export function Root() {
  return (
    <>
      <Composition
        id="HelloZeca"
        component={HelloZeca}
        schema={helloZecaSchema}
        defaultProps={defaults}
        durationInFrames={90}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="HelloZecaVertical"
        component={HelloZeca}
        schema={helloZecaSchema}
        defaultProps={defaults}
        durationInFrames={90}
        fps={30}
        width={720}
        height={1280}
      />
      <Composition
        id="ZecaClip"
        component={ZecaClip}
        schema={zecaClipSchema}
        defaultProps={zecaDefaults}
        calculateMetadata={calculateZecaClipMetadata}
        durationInFrames={30}
        fps={ZECA_FPS}
        width={1280}
        height={720}
      />
      <Composition
        id="NewsVideo"
        component={NewsVideo}
        schema={newsVideoSchema}
        defaultProps={newsDefaults}
        calculateMetadata={calculateNewsVideoMetadata}
        durationInFrames={180}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="ReactShort"
        component={ReactShort}
        schema={reactShortSchema}
        defaultProps={reactDefaults}
        calculateMetadata={calculateReactShortMetadata}
        durationInFrames={180}
        fps={30}
        width={720}
        height={1280}
      />
      <Composition
        id="Thumbnail"
        component={Thumbnail}
        schema={thumbnailSchema}
        defaultProps={thumbDefaults}
        durationInFrames={1}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="RivePoc"
        component={RivePoc}
        schema={rivePocSchema}
        defaultProps={riveDefaults}
        durationInFrames={120}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  );
}
