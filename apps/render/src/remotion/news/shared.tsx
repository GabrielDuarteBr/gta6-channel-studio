import '@fontsource/anton/latin-400.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/inter/latin-900.css';
import { useEffect, useState, type CSSProperties } from 'react';
import { AbsoluteFill, continueRender, delayRender, Img } from 'remotion';

/** Fontes embutidas no bundle (Fontsource, licença OFL): nada é baixado na hora do render. */
export const FONT_DISPLAY = 'Anton, Impact, sans-serif';
export const FONT_TEXT = 'Inter, "Noto Sans", sans-serif';

export const NEON = {
  pink: '#ff3d8b',
  cyan: '#2ee6f2',
  sunset: '#ff8c42',
  yellow: '#ffd84d',
  night: '#0c061e',
};

/** Espera as fontes carregarem antes do primeiro quadro (quadros iguais render após render). */
export function useFontsReady(): void {
  const [handle] = useState(() => delayRender('carregando fontes'));
  useEffect(() => {
    Promise.all([
      document.fonts.load(`80px Anton`),
      document.fonts.load(`400 40px Inter`),
      document.fonts.load(`700 40px Inter`),
      document.fonts.load(`800 40px Inter`),
      document.fonts.load(`900 40px Inter`),
    ])
      .catch(() => undefined)
      .finally(() => continueRender(handle));
  }, [handle]);
}

/** Fundo neon (grade em perspectiva), para cenas sem imagem. */
export function NeonBackdrop() {
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

/** Imagem de fundo cobrindo a área, com zoom/pan lento (Ken Burns) por progresso 0..1. */
export function KenBurnsImage({
  src,
  progress,
  motion,
  style,
}: {
  src: string;
  progress: number;
  motion: {
    fromScale: number;
    toScale: number;
    fromX: number;
    toX: number;
    fromY: number;
    toY: number;
  };
  style?: CSSProperties;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const ease = p * p * (3 - 2 * p);
  const scale = motion.fromScale + (motion.toScale - motion.fromScale) * ease;
  const x = (motion.fromX + (motion.toX - motion.fromX) * ease) * 100;
  const y = (motion.fromY + (motion.toY - motion.fromY) * ease) * 100;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', ...style }}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `translate(${x}%, ${y}%) scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
}

/** Texto com contorno escuro grosso (legível sobre qualquer imagem). */
export function outlinedText(color: string, strokePx: number): CSSProperties {
  return {
    color,
    WebkitTextStroke: `${strokePx}px #07040f`,
    paintOrder: 'stroke fill',
    textShadow: `0 ${strokePx * 0.6}px ${strokePx * 1.5}px #000000aa`,
  };
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
