import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { ZecaPlaceholder } from './ZecaPlaceholder';

export const helloZecaSchema = z.object({
  channelName: z.string(),
  characterName: z.string(),
});
export type HelloZecaProps = z.infer<typeof helloZecaSchema>;

/** Abertura de teste da Fase 0: prova Chrome headless + render dentro do container. */
export function HelloZeca({ channelName, characterName }: HelloZecaProps) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const vertical = height > width;
  // Boca abre e fecha de forma determinística (mesma entrada → mesmos quadros).
  const mouthOpen = (Math.sin((frame / fps) * Math.PI * 6) + 1) / 2;
  const titleIn = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
  });
  const base = Math.min(width, height);

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(circle at 70% 20%, #ff3d8b55, transparent 55%), linear-gradient(180deg, #160f29, #07040f)',
        opacity: out,
        fontFamily: 'Inter, sans-serif',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: vertical ? 'column' : 'row',
        gap: base * 0.05,
      }}
    >
      <ZecaPlaceholder mouthOpen={mouthOpen} style={{ width: base * 0.55, height: base * 0.6 }} />
      <div style={{ opacity: titleIn, color: '#fff', textAlign: vertical ? 'center' : 'left' }}>
        <div
          style={{
            fontSize: base * 0.11,
            fontWeight: 900,
            letterSpacing: 2,
            textShadow: '0 0 24px #ff3d8b',
          }}
        >
          {channelName.toUpperCase()}
        </div>
        <div style={{ fontSize: base * 0.045, color: '#2ee6f2' }}>com {characterName}</div>
        <div style={{ fontSize: base * 0.03, color: '#a397c7', marginTop: base * 0.02 }}>
          arte provisória · teste de render
        </div>
      </div>
    </AbsoluteFill>
  );
}
