import { blinkSchedule, frameState, type CharacterTimeline } from '@studio/avatar';
import { ZecaArt } from '@studio/avatar/art';
import type { ReactLayout, ReactPlan, ReactPlanBlock } from '@studio/production';
import { useMemo, type CSSProperties } from 'react';
import {
  AbsoluteFill,
  Freeze,
  Html5Audio,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from 'remotion';
import { z } from 'zod';
import {
  clamp01,
  FONT_DISPLAY,
  FONT_TEXT,
  NEON,
  NeonBackdrop,
  outlinedText,
  useFontsReady,
} from '../news/shared';

/**
 * Short de react do Radar Neon (9:16). Regra 3 na tela: o trecho do parceiro toca com o crédito
 * visível; quando o Zeca fala, o trecho fica PAUSADO (quadro congelado e escurecido). Três
 * layouts no rodízio (tv, split, cinema) para os Shorts não ficarem iguais.
 */

export const reactShortSchema = z.object({
  plan: z.custom<ReactPlan>((v) => typeof v === 'object' && v !== null && 'blocks' in v),
  workBaseUrl: z.string(),
  provisional: z.boolean(),
});
export type ReactShortProps = z.infer<typeof reactShortSchema>;

export const calculateReactShortMetadata: CalculateMetadataFunction<ReactShortProps> = ({
  props,
}) => ({
  fps: props.plan.fps,
  width: props.plan.width,
  height: props.plan.height,
  durationInFrames: Math.max(1, Math.ceil(props.plan.durationSec * props.plan.fps)),
});

/** Caixas em % do quadro: left, top, width, height. */
type Box = [number, number, number, number];

interface LayoutSpec {
  /** Área do clipe (16:9 cabe na largura). */
  clip: Box;
  /**
   * Zeca: sempre no mesmo lugar e tamanho, inteiro dentro do quadro (o clipe nunca fica em cima
   * dele). Render repetível: redimensionar o desenho, ter um segundo Zeca pequeno ou deixar a
   * caixa passar da borda fez os quadros variarem entre renders.
   */
  zeca: Box;
  /** Faixa das legendas (comentário). */
  caption: Box;
  frame: 'tv' | 'none';
}

const LAYOUTS: Record<ReactLayout, LayoutSpec> = {
  tv: {
    clip: [5, 13, 90, 28.5],
    zeca: [34, 58, 66, 42],
    caption: [5, 47, 90, 11],
    frame: 'tv',
  },
  split: {
    clip: [0, 9, 100, 31.7],
    zeca: [18, 56, 64, 44],
    caption: [5, 44, 90, 11],
    frame: 'none',
  },
  cinema: {
    clip: [0, 27, 100, 31.7],
    zeca: [0, 62, 58, 38],
    caption: [4, 9, 92, 14],
    frame: 'none',
  },
};

const boxStyle = (b: Box): CSSProperties => ({
  position: 'absolute',
  left: `${b[0]}%`,
  top: `${b[1]}%`,
  width: `${b[2]}%`,
  height: `${b[3]}%`,
});

export function ReactShort({ plan, workBaseUrl, provisional }: ReactShortProps) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const u = width / 100;
  const url = (p: string) => (/^(https?:)?\//.test(p) ? p : `${workBaseUrl}/${p}`);
  const spec = LAYOUTS[plan.layout] ?? LAYOUTS.tv;

  const tl = plan.character as CharacterTimeline;
  const blinks = useMemo(
    () => blinkSchedule(plan.blinkSeed, plan.durationSec, fps),
    [plan.blinkSeed, plan.durationSec, fps],
  );
  const zeca = frameState(tl, frame, fps, blinks);

  const block: ReactPlanBlock =
    plan.blocks.find((b) => t >= b.start && t < b.end) ?? plan.blocks[plan.blocks.length - 1]!;
  const inClip = block.kind === 'clip';
  const caption = !inClip ? (plan.captions.find((c) => t >= c.start && t < c.end)?.text ?? '') : '';
  const outroStart = plan.durationSec - 1.2;
  const inOutro = t >= outroStart;
  const frameOf = (sec: number) => Math.round(sec * fps);

  const clipArea = boxStyle(spec.clip);

  return (
    <AbsoluteFill style={{ fontFamily: FONT_TEXT, color: '#fff', backgroundColor: NEON.night }}>
      <NeonBackdrop />
      {plan.layout === 'cinema' ? <AbsoluteFill style={{ background: '#05030bd9' }} /> : null}

      {/* Área do clipe: fundo e moldura */}
      <div
        style={{
          ...clipArea,
          background: '#000',
          overflow: 'hidden',
          // Camada própria: os quadros novos do clipe não fazem o Chrome redesenhar o resto da
          // tela no meio do render (sem isso, os quadros variavam entre renders).
          willChange: 'transform',
          transform: 'translateZ(0)',
          borderRadius: spec.frame === 'tv' ? u * 2 : 0,
          border: spec.frame === 'tv' ? `${u * 0.7}px solid ${NEON.pink}` : 'none',
          boxShadow:
            spec.frame === 'tv'
              ? `0 0 ${u * 3}px ${NEON.pink}88, inset 0 0 ${u * 2}px #000`
              : `0 ${u * 0.6}px ${u * 3}px #000`,
        }}
      >
        {plan.blocks.map((b, i) => {
          const clip = plan.clips[b.clip];
          if (!clip) return null;
          const from = frameOf(b.start);
          const dur = Math.max(1, frameOf(b.end) - from);
          if (b.kind === 'clip') {
            return (
              <Sequence key={`b${i}`} from={from} durationInFrames={dur} layout="none">
                <AbsoluteFill>
                  <OffthreadVideo
                    src={url(clip.src)}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                </AbsoluteFill>
              </Sequence>
            );
          }
          // Comentário: o clipe fica pausado (primeiro quadro antes do 1º trecho, senão o último).
          const frozen = i === 0 ? 0 : Math.max(0, frameOf(clip.durationSec) - 1);
          return (
            <Sequence key={`b${i}`} from={from} durationInFrames={dur} layout="none">
              <AbsoluteFill>
                <Freeze frame={frozen}>
                  <OffthreadVideo
                    src={url(clip.src)}
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                </Freeze>
                <AbsoluteFill style={{ background: '#07040f8c' }} />
              </AbsoluteFill>
            </Sequence>
          );
        })}

        {/* Selo: tocando ou pausado */}
        <div
          data-testid={inClip ? 'selo-clipe' : 'selo-pausado'}
          style={{
            position: 'absolute',
            left: u * 2,
            top: u * 2,
            fontWeight: 900,
            fontSize: u * 3,
            padding: `${u * 0.5}px ${u * 1.4}px`,
            borderRadius: u * 0.8,
            background: inClip ? NEON.cyan : NEON.yellow,
            color: '#07040f',
            letterSpacing: u * 0.1,
          }}
        >
          {inClip ? '▶ CLIPE DO PARCEIRO' : 'Ⅱ PAUSADO · ZECA COMENTA'}
        </div>
      </div>

      {/* Crédito: sempre visível durante o clipe (regra 3), discreto quando pausado */}
      <div
        data-testid="credito-parceiro"
        style={{
          position: 'absolute',
          left: `${spec.clip[0] + 3}%`,
          top: `calc(${spec.clip[1] + spec.clip[3]}% + ${u * 1.2}px)`,
          maxWidth: `${Math.min(94, spec.clip[2] - 6)}%`,
          background: '#07040fe6',
          border: `${u * 0.35}px solid ${NEON.cyan}`,
          borderRadius: u * 1,
          padding: `${u * (inClip ? 0.8 : 0.4)}px ${u * 1.6}px`,
          fontSize: u * (inClip ? 3.6 : 2.4),
          fontWeight: 800,
          opacity: inClip ? 1 : 0.85,
        }}
      >
        <span style={{ color: NEON.cyan }}>CLIPE:</span> {plan.credit}
      </div>

      <Html5Audio src={url(plan.voiceSrc)} />

      {/* Marca do canal */}
      <div style={{ position: 'absolute', left: '4%', top: '2.2%' }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: u * 6,
            letterSpacing: u * 0.25,
            color: NEON.pink,
            textShadow: `0 0 ${u * 1.4}px ${NEON.pink}, 0 ${u * 0.3}px ${u * 0.6}px #000`,
            lineHeight: 1,
          }}
        >
          RADAR NEON
        </div>
        <div style={{ fontSize: u * 2.6, fontWeight: 700, opacity: 0.85, marginTop: u * 0.4 }}>
          REACT · GTA 6
        </div>
      </div>

      {/* Aviso de IA (sempre visível) */}
      <div
        style={{
          position: 'absolute',
          right: '3%',
          top: '2.2%',
          maxWidth: '46%',
          textAlign: 'right',
          fontSize: u * 2.1,
          fontWeight: 700,
          lineHeight: 1.3,
          background: '#07040fbf',
          padding: `${u * 0.4}px ${u * 0.9}px`,
          borderRadius: u * 0.6,
        }}
      >
        {plan.aiNotice}
        {provisional ? (
          <div
            data-testid="selo-arte-provisoria"
            style={{ marginTop: u * 0.4, fontSize: u * 1.8, opacity: 0.8 }}
          >
            Arte provisória do Zeca
          </div>
        ) : null}
      </div>

      {/* Zeca (calado enquanto o clipe toca: a boca segue a trilha de voz) */}
      <div
        style={{
          ...boxStyle(spec.zeca),
          willChange: 'transform',
          transform: 'translateZ(0)',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
        }}
      >
        {/* O selo "arte provisória" vai fora do desenho (abaixo do aviso de IA): o texto dentro
            do SVG, colado na borda inferior, variava entre renders. */}
        <ZecaArt state={zeca} provisional={false} />
      </div>
      {/* Legenda (só quando o Zeca fala) */}
      {caption && !inOutro ? (
        <div
          style={{
            ...boxStyle(spec.caption),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontWeight: 900,
              fontSize: u * 6.2,
              lineHeight: 1.12,
              textAlign: 'center',
              ...outlinedText('#ffffff', u * 0.55),
            }}
          >
            {caption}
          </div>
        </div>
      ) : null}

      {/* Tela final */}
      {inOutro ? (
        <AbsoluteFill
          style={{
            background: '#07040fe0',
            opacity: clamp01((t - outroStart) / 0.3),
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10% 8% 42%',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: u * 8,
              color: NEON.cyan,
              textShadow: `0 0 ${u * 2}px ${NEON.cyan}`,
            }}
          >
            CLIPE: {plan.credit.toUpperCase()}
          </div>
          <div style={{ marginTop: u * 1.5, fontSize: u * 3, fontWeight: 700 }}>
            Crédito e link na descrição
          </div>
          <div style={{ marginTop: u * 1, fontSize: u * 2.4, opacity: 0.85 }}>
            {plan.channelName} · {plan.aiNotice}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
}
