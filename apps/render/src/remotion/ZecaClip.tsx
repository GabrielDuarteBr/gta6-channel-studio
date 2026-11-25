import {
  artPackRefSchema,
  blinkSchedule,
  EXPRESSIONS,
  frameState,
  GESTURES,
  MOUTH_SHAPES,
  type CharacterTimeline,
} from '@studio/avatar';
import { useMemo } from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from 'remotion';
import { z } from 'zod';
import { Character } from './Character';

export const ZECA_FPS = 30;

const timelineSchema = z.object({
  durationSec: z.number().positive().max(600),
  expressions: z.array(
    z.object({ start: z.number(), end: z.number(), expression: z.enum(EXPRESSIONS) }),
  ),
  gestures: z.array(z.object({ start: z.number(), end: z.number(), gesture: z.enum(GESTURES) })),
  mouthCues: z.array(z.object({ start: z.number(), end: z.number(), value: z.enum(MOUTH_SHAPES) })),
});

export const zecaClipSchema = z.object({
  /** URL do áudio (o servidor de render serve a pasta de trabalho só para o Chrome local). */
  audioSrc: z.string().min(1),
  seed: z.number().int().nonnegative(),
  provisional: z.boolean(),
  label: z.string().max(80),
  timeline: timelineSchema,
  captions: z.array(z.object({ start: z.number(), end: z.number(), text: z.string().max(400) })),
  /** Base da pasta de trabalho (o servidor de render injeta). */
  workBaseUrl: z.string().optional(),
  /** Arte do ilustrador (camadas); sem ela, a arte provisória. */
  art: artPackRefSchema.nullable().optional(),
});
export type ZecaClipProps = z.infer<typeof zecaClipSchema>;

/** Duração do vídeo = duração da trilha de voz. */
export const calculateZecaClipMetadata: CalculateMetadataFunction<ZecaClipProps> = ({ props }) => ({
  fps: ZECA_FPS,
  durationInFrames: Math.max(1, Math.ceil(props.timeline.durationSec * ZECA_FPS)),
});

const NEON = { pink: '#ff3d8b', cyan: '#2ee6f2', night: '#0c061e' };

function Backdrop() {
  // Grade neon estática (determinística).
  const lines = Array.from({ length: 13 }, (_, i) => i);
  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(circle at 78% 18%, #ff3d8b44, transparent 50%), radial-gradient(circle at 15% 85%, #2ee6f233, transparent 45%), linear-gradient(180deg, #1a0f33, #07040f)',
      }}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%' }}
      >
        {lines.map((i) => (
          <line
            key={`h${i}`}
            x1={0}
            x2={100}
            y1={62 + i * i * 0.25}
            y2={62 + i * i * 0.25}
            stroke={NEON.pink}
            strokeOpacity={0.18}
            strokeWidth={0.15}
          />
        ))}
        {lines.map((i) => (
          <line
            key={`v${i}`}
            x1={50 + (i - 6) * 3}
            x2={50 + (i - 6) * 14}
            y1={62}
            y2={100}
            stroke={NEON.cyan}
            strokeOpacity={0.14}
            strokeWidth={0.15}
          />
        ))}
      </svg>
    </AbsoluteFill>
  );
}

export function ZecaClip({
  audioSrc,
  seed,
  provisional,
  label,
  timeline,
  captions,
  workBaseUrl,
  art,
}: ZecaClipProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const vertical = height > width;
  const tl = timeline as CharacterTimeline;
  const blinks = useMemo(
    () => blinkSchedule(seed, tl.durationSec, fps),
    [seed, tl.durationSec, fps],
  );
  const state = frameState(tl, frame, fps, blinks);
  const t = frame / fps;
  const caption = captions.find((c) => t >= c.start && t < c.end)?.text ?? '';
  const unit = Math.min(width, height) / 100;

  const panel: React.CSSProperties = vertical
    ? { left: '6%', right: '6%', top: '6%', height: '36%' }
    : { left: '4%', top: '9%', width: '56%', height: '72%' };
  const avatar: React.CSSProperties = vertical
    ? { left: '8%', right: '8%', bottom: 0, height: '56%' }
    : { right: '1%', bottom: 0, width: '40%', height: '92%' };

  return (
    <AbsoluteFill style={{ fontFamily: 'Inter, "Noto Sans", sans-serif', color: '#fff' }}>
      <Backdrop />
      <Html5Audio src={audioSrc} />

      <div
        style={{
          position: 'absolute',
          ...panel,
          borderRadius: unit * 2.4,
          border: `${unit * 0.5}px solid ${NEON.cyan}`,
          boxShadow: `0 0 ${unit * 3}px ${NEON.cyan}88, inset 0 0 ${unit * 4}px ${NEON.pink}33`,
          background: '#0c061ecc',
          padding: unit * 3,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span
            style={{
              fontWeight: 800,
              letterSpacing: unit * 0.3,
              fontSize: unit * 4,
              color: NEON.pink,
              textShadow: `0 0 ${unit * 1.5}px ${NEON.pink}`,
            }}
          >
            RADAR NEON
          </span>
          <span style={{ fontSize: unit * 2.2, opacity: 0.75 }}>{label}</span>
        </div>
        <div style={{ fontSize: unit * (vertical ? 5 : 4.6), fontWeight: 700, lineHeight: 1.25 }}>
          {caption}
        </div>
      </div>

      <div style={{ position: 'absolute', ...avatar, display: 'flex', alignItems: 'flex-end' }}>
        <Character state={state} art={art} workBaseUrl={workBaseUrl} provisional={provisional} />
      </div>

      <div
        style={{
          position: 'absolute',
          left: vertical ? '6%' : '4%',
          bottom: vertical ? '54%' : '4%',
          fontSize: unit * 2.2,
          background: '#0c061ecc',
          padding: `${unit * 0.6}px ${unit * 1.4}px`,
          borderRadius: unit,
          borderLeft: `${unit * 0.5}px solid ${NEON.pink}`,
        }}
      >
        Zeca Neon · personagem animado (IA)
      </div>
    </AbsoluteFill>
  );
}
