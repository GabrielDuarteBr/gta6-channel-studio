import { Composition, staticFile } from 'remotion';
import { HelloZeca, helloZecaSchema } from './HelloZeca';
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
