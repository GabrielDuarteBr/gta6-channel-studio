import {
  artPackRefSchema,
  blinkSchedule,
  frameState,
  type CharacterTimeline,
} from '@studio/avatar';
import type { VideoPlan } from '@studio/production';
import { useMemo, type CSSProperties } from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from 'remotion';
import { z } from 'zod';
import { Character } from '../Character';
import {
  clamp01,
  FONT_DISPLAY,
  FONT_TEXT,
  KenBurnsImage,
  NEON,
  NeonBackdrop,
  outlinedText,
  useFontsReady,
} from './shared';

/**
 * Vídeo de notícia do Radar Neon (longo 16:9 ou Short 9:16), montado a partir do plano
 * (@studio/production): cenas com imagem e zoom lento, o Zeca falando com boca sincronizada,
 * legendas, fonte na tela, selo de rumor, aviso de IA, abertura e tela final com créditos.
 */

export const newsVideoSchema = z.object({
  plan: z.custom<VideoPlan>((v) => typeof v === 'object' && v !== null && 'scenes' in v),
  /** Base para os arquivos da pasta de trabalho (o servidor de render injeta). */
  workBaseUrl: z.string(),
  provisional: z.boolean(),
  /** Arte do ilustrador (camadas); sem ela, a arte provisória. */
  art: artPackRefSchema.nullable().optional(),
});
export type NewsVideoProps = z.infer<typeof newsVideoSchema>;

export const calculateNewsVideoMetadata: CalculateMetadataFunction<NewsVideoProps> = ({
  props,
}) => ({
  fps: props.plan.fps,
  width: props.plan.width,
  height: props.plan.height,
  durationInFrames: Math.max(1, Math.ceil(props.plan.durationSec * props.plan.fps)),
});

const FADE = 0.45;
const active = <T extends { start: number; end: number }>(items: T[], t: number) =>
  items.find((i) => t >= i.start && t < i.end);

export function NewsVideo({ plan, workBaseUrl, provisional, art }: NewsVideoProps) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const vertical = plan.format === 'SHORT' || height > width;
  const u = (vertical ? width : height) / 100;
  const url = (p: string) => (/^(https?:)?\//.test(p) ? p : `${workBaseUrl}/${p}`);

  const tl = plan.character as CharacterTimeline;
  const blinks = useMemo(
    () => blinkSchedule(plan.blinkSeed, plan.durationSec, fps),
    [plan.blinkSeed, plan.durationSec, fps],
  );
  const zeca = frameState(tl, frame, fps, blinks);

  const sceneIdx = Math.max(
    0,
    plan.scenes.findIndex((s) => t >= s.start && t < s.end),
  );
  const scene = plan.scenes[sceneIdx]!;
  const visibleScenes = plan.scenes.filter(
    (s, i) => (t >= s.start && t < s.end) || (i === sceneIdx - 1 && t < scene.start + FADE),
  );
  const caption = active(plan.captions, t)?.text ?? '';
  const source = active(plan.sourceChips, t);
  const inRumor = Boolean(active(plan.rumorSpans, t));
  const outroStart = plan.durationSec - plan.outroSec;
  const inOutro = t >= outroStart;
  const introOpacity = plan.introSec > 0 ? 1 - clamp01((t - plan.introSec + 0.3) / 0.4) : 0;
  const headlineAge = t - scene.start;
  const showHeadline = Boolean(scene.headline) && headlineAge < 2.8 && !inOutro;
  const hasImage = Boolean(scene.image);

  // --- Áreas (16:9 vs 9:16) ---
  const imageArea: CSSProperties = vertical
    ? { left: 0, right: 0, top: 0, height: '58%' }
    : { left: 0, right: 0, top: 0, bottom: 0 };
  const zecaBox: CSSProperties = vertical
    ? { right: '-2%', bottom: 0, width: '52%', height: '37%' }
    : hasImage
      ? { right: '0.5%', bottom: 0, width: '34%', height: '72%' }
      : { right: '8%', bottom: 0, width: '46%', height: '96%' };
  const captionBox: CSSProperties = vertical
    ? { left: '5%', right: '5%', top: '58%', justifyContent: 'center' }
    : { left: '4%', width: hasImage ? '60%' : '46%', bottom: '7%', justifyContent: 'flex-start' };

  return (
    <AbsoluteFill style={{ fontFamily: FONT_TEXT, color: '#fff', backgroundColor: NEON.night }}>
      <NeonBackdrop />

      {visibleScenes.map((s) => {
        if (!s.image) return null;
        const fadeIn = s.start === 0 ? 1 : clamp01((t - s.start) / FADE);
        return (
          <AbsoluteFill key={s.id} style={{ ...imageArea, position: 'absolute', opacity: fadeIn }}>
            <KenBurnsImage
              src={url(s.image)}
              progress={(t - s.start) / Math.max(0.1, s.end - s.start)}
              motion={s.motion}
            />
            {vertical ? (
              <AbsoluteFill
                style={{ background: 'linear-gradient(180deg, transparent 70%, #07040f 100%)' }}
              />
            ) : null}
          </AbsoluteFill>
        );
      })}

      {!vertical && hasImage ? (
        <AbsoluteFill
          style={{
            background:
              'linear-gradient(0deg, #07040fdd 0%, #07040f66 28%, transparent 50%), linear-gradient(90deg, #07040f99 0%, transparent 35%)',
          }}
        />
      ) : null}

      <Sequence from={Math.round(plan.voiceStartSec * fps)} layout="none">
        <Html5Audio src={url(plan.voiceSrc)} />
      </Sequence>

      {/* Marca do canal */}
      <div style={{ position: 'absolute', left: '4%', top: vertical ? '2.5%' : '5%' }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: u * (vertical ? 6 : 5),
            letterSpacing: u * 0.25,
            color: NEON.pink,
            textShadow: `0 0 ${u * 1.4}px ${NEON.pink}, 0 ${u * 0.3}px ${u * 0.6}px #000`,
            lineHeight: 1,
          }}
        >
          RADAR NEON
        </div>
        <div
          style={{
            fontSize: u * (vertical ? 2.6 : 2.2),
            fontWeight: 700,
            opacity: 0.85,
            marginTop: u * 0.5,
          }}
        >
          NOTÍCIAS DE GTA 6
        </div>
        {inRumor || plan.storyIsRumor ? (
          <div
            data-testid="selo-rumor"
            style={{
              marginTop: u * 1.2,
              display: 'inline-block',
              background: NEON.sunset,
              color: '#1a0b00',
              fontWeight: 900,
              fontSize: u * (vertical ? 3.2 : 2.6),
              padding: `${u * 0.5}px ${u * 1.2}px`,
              borderRadius: u * 0.6,
              border: `${u * 0.3}px solid #07040f`,
              boxShadow: inRumor
                ? `0 0 0 ${u * 0.25}px ${NEON.sunset}, 0 0 ${u * 2}px ${NEON.sunset}`
                : 'none',
            }}
          >
            RUMOR · NÃO CONFIRMADO
          </div>
        ) : null}
      </div>

      {/* Aviso de IA (sempre visível) */}
      <div
        style={{
          position: 'absolute',
          right: '3%',
          top: vertical ? '2.5%' : '5%',
          maxWidth: vertical ? '46%' : '32%',
          textAlign: 'right',
          fontSize: u * (vertical ? 2.1 : 1.7),
          fontWeight: 700,
          lineHeight: 1.3,
          background: '#07040fbf',
          padding: `${u * 0.4}px ${u * 0.9}px`,
          borderRadius: u * 0.6,
        }}
      >
        {plan.aiNotice}
      </div>

      {/* Título da cena */}
      {showHeadline ? (
        <div
          style={{
            position: 'absolute',
            left: '4%',
            top: vertical ? '38%' : '30%',
            maxWidth: vertical ? '88%' : '55%',
            fontFamily: FONT_DISPLAY,
            fontSize: u * (vertical ? 8 : 7.5),
            lineHeight: 1.05,
            textTransform: 'uppercase',
            transform: `translateX(${(1 - clamp01(headlineAge / 0.35)) * -8}%)`,
            opacity: clamp01(headlineAge / 0.25) * (1 - clamp01((headlineAge - 2.4) / 0.4)),
            ...outlinedText(NEON.yellow, u * 0.5),
          }}
        >
          {scene.headline}
        </div>
      ) : null}

      {/* Zeca */}
      <div style={{ position: 'absolute', ...zecaBox, display: 'flex', alignItems: 'flex-end' }}>
        <Character state={zeca} art={art} workBaseUrl={workBaseUrl} provisional={provisional} />
      </div>

      {/* Fonte na tela */}
      {source && !inOutro ? (
        <div
          data-testid="fonte-na-tela"
          style={{
            position: 'absolute',
            left: '4%',
            ...(vertical ? { top: '53%' } : { bottom: '20%' }),
            background: '#07040fd9',
            border: `${u * 0.25}px solid ${NEON.cyan}`,
            borderRadius: u * 0.8,
            padding: `${u * 0.5}px ${u * 1.2}px`,
            fontSize: u * (vertical ? 2.8 : 2.4),
            fontWeight: 700,
          }}
        >
          <span style={{ color: NEON.cyan }}>FONTE:</span> {source.label}
        </div>
      ) : null}

      {/* Legenda */}
      {caption && !inOutro ? (
        <div style={{ position: 'absolute', display: 'flex', ...captionBox }}>
          <div
            style={{
              fontWeight: 900,
              fontSize: u * (vertical ? 6.2 : 5),
              lineHeight: 1.15,
              textAlign: vertical ? 'center' : 'left',
              ...outlinedText('#ffffff', u * (vertical ? 0.55 : 0.45)),
            }}
          >
            {caption}
          </div>
        </div>
      ) : null}

      {/* Abertura */}
      {introOpacity > 0 ? (
        <AbsoluteFill
          style={{
            background: '#07040f',
            opacity: introOpacity,
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8%',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: u * (vertical ? 11 : 12),
              color: NEON.pink,
              letterSpacing: u * 0.5,
              textShadow: `0 0 ${u * 3}px ${NEON.pink}`,
              transform: `scale(${0.9 + 0.1 * clamp01(t / 0.6)})`,
            }}
          >
            RADAR NEON
          </div>
          {plan.format === 'LONG' ? (
            <div style={{ marginTop: u * 2, fontSize: u * 3.6, fontWeight: 800, maxWidth: '80%' }}>
              {plan.title}
            </div>
          ) : null}
        </AbsoluteFill>
      ) : null}

      {/* Tela final */}
      {inOutro ? (
        <AbsoluteFill
          style={{
            background: '#07040fe6',
            opacity: clamp01((t - outroStart) / 0.35),
            alignItems: vertical ? 'center' : 'flex-start',
            justifyContent: 'center',
            padding: vertical ? '10% 8% 40%' : '0 6%',
            textAlign: vertical ? 'center' : 'left',
          }}
        >
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: u * (vertical ? 9 : 8),
              color: NEON.cyan,
              textShadow: `0 0 ${u * 2}px ${NEON.cyan}`,
            }}
          >
            FONTES NA DESCRIÇÃO
          </div>
          <div
            style={{
              marginTop: u * 1.5,
              fontSize: u * 2.6,
              fontWeight: 700,
              maxWidth: vertical ? '100%' : '58%',
            }}
          >
            {plan.channelName} · {plan.aiNotice}
          </div>
          {plan.credits.length ? (
            <div
              style={{
                marginTop: u * 1.2,
                fontSize: u * 2,
                opacity: 0.8,
                maxWidth: vertical ? '100%' : '58%',
              }}
            >
              {plan.credits.join(' · ')}
            </div>
          ) : null}
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
}
