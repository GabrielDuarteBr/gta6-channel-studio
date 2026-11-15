import { IDLE_STATE } from '@studio/avatar';
import { ZecaArt } from '@studio/avatar/art';
import type { ThumbnailSpec } from '@studio/production';
import { AbsoluteFill, Img } from 'remotion';
import { z } from 'zod';
import { FONT_DISPLAY, NEON, NeonBackdrop, outlinedText, useFontsReady } from './shared';

/**
 * Thumbnail 1280×720 (quadro único): imagem da cena, o Zeca grande com a expressão pedida,
 * texto curto em caixa alta e selo de rumor quando for o caso. Três variações por vídeo.
 */
export const thumbnailSchema = z.object({
  spec: z.custom<ThumbnailSpec>((v) => typeof v === 'object' && v !== null && 'headline' in v),
  workBaseUrl: z.string(),
  provisional: z.boolean(),
});
export type ThumbnailProps = z.infer<typeof thumbnailSchema>;

const ACCENTS = [NEON.yellow, '#ffffff', NEON.cyan];

export function Thumbnail({ spec, workBaseUrl, provisional }: ThumbnailProps) {
  useFontsReady();
  const u = 7.2; // 1% da altura (720)
  const mirrored = spec.variant === 1;
  const accent = ACCENTS[spec.variant % ACCENTS.length]!;
  const mouth = spec.expression === 'surpreso' ? 'E' : spec.expression === 'feliz' ? 'D' : 'C';
  const words = spec.headline.split(' ');
  const long = spec.headline.length > 14;

  return (
    <AbsoluteFill style={{ backgroundColor: NEON.night, overflow: 'hidden' }}>
      {spec.image ? (
        <Img
          src={`${workBaseUrl}/${spec.image}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.06)' }}
        />
      ) : (
        <NeonBackdrop />
      )}
      <AbsoluteFill
        style={{
          background: mirrored
            ? 'linear-gradient(270deg, #07040fee 0%, #07040f88 45%, transparent 75%)'
            : 'linear-gradient(90deg, #07040fee 0%, #07040f88 45%, transparent 75%)',
        }}
      />
      <AbsoluteFill
        style={{
          boxShadow: `inset 0 0 ${u * 12}px #07040f, inset 0 0 0 ${u * 0.8}px ${NEON.pink}`,
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          ...(mirrored ? { left: '-2%' } : { right: '-2%' }),
          width: '46%',
          display: 'flex',
          alignItems: 'flex-end',
          filter: `drop-shadow(0 0 ${u * 2}px ${NEON.pink}aa)`,
        }}
      >
        <ZecaArt
          state={{ ...IDLE_STATE, expression: spec.expression, mouth }}
          provisional={provisional}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          top: '12%',
          bottom: '10%',
          ...(mirrored ? { right: '4%', textAlign: 'right' } : { left: '4.5%' }),
          width: '58%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: mirrored ? 'flex-end' : 'flex-start',
        }}
      >
        {spec.rumor ? (
          <div
            style={{
              background: NEON.sunset,
              color: '#1a0b00',
              fontFamily: FONT_DISPLAY,
              fontSize: u * 6,
              padding: `${u * 0.4}px ${u * 1.6}px`,
              borderRadius: u,
              transform: 'rotate(-3deg)',
              marginBottom: u * 2,
              boxShadow: `0 ${u * 0.6}px 0 #000`,
            }}
          >
            RUMOR
          </div>
        ) : null}
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: u * (long ? 14 : 17),
            lineHeight: 1,
            textTransform: 'uppercase',
            transform: 'rotate(-2deg)',
            ...outlinedText(accent, u * 1.1),
          }}
        >
          {words.join(' ')}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '4%',
          ...(mirrored ? { right: '4%' } : { left: '4.5%' }),
          fontFamily: FONT_DISPLAY,
          fontSize: u * 4,
          letterSpacing: u * 0.3,
          color: NEON.pink,
          textShadow: `0 0 ${u * 1.2}px ${NEON.pink}, 0 ${u * 0.3}px ${u * 0.4}px #000`,
        }}
      >
        {spec.channelName.toUpperCase()}
      </div>
    </AbsoluteFill>
  );
}
