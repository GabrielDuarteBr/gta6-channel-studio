import { useId } from 'react';
import type { AvatarFrameState } from '../engine';
import type { Expression, MouthShape } from '../spec';

/**
 * ARTE PROVISÓRIA do Zeca Neon em camadas (SVG), feita pelo estúdio para a Fase 2.
 * Será trocada pela arte do ilustrador (com contrato de cessão = manifesto de direitos).
 * Componente puro: o mesmo estado dá sempre o mesmo SVG (render determinístico).
 */

const SKIN = '#d99a6c';
const SKIN_SHADE = '#c0805a';
const HAIR = '#2b1640';
const HAIR_RIM = '#ff3d8b';
const NEON_PINK = '#ff3d8b';
const NEON_CYAN = '#2ee6f2';
const LIP = '#8a3b2e';
const MOUTH_IN = '#3a1414';
const TONGUE = '#e2737a';

interface ExpressionStyle {
  /** Sobe (-) ou desce (+) as sobrancelhas; inner > 0 = cantos internos para baixo (bravo). */
  brow: { raise: number; inner: number; leftExtra?: number };
  /** Multiplica a abertura do olho [esquerdo, direito]. */
  eye: [number, number];
  /** Curva dos cantos da boca: > 0 sorriso, < 0 para baixo. */
  smile: number;
  /** Boca torta (graus) e deslocamento lateral, para o deboche. */
  smirk: number;
  tilt: number;
  blush: number;
}

const STYLE: Record<Expression, ExpressionStyle> = {
  neutro: { brow: { raise: 0, inner: 0 }, eye: [1, 1], smile: 1, smirk: 0, tilt: 0, blush: 0 },
  feliz: {
    brow: { raise: -4, inner: -2 },
    eye: [0.75, 0.75],
    smile: 7,
    smirk: 0,
    tilt: 2,
    blush: 0.35,
  },
  debochado: {
    brow: { raise: 0, inner: 1, leftExtra: -9 },
    eye: [0.6, 0.95],
    smile: 4,
    smirk: -8,
    tilt: -4,
    blush: 0.15,
  },
  empolgado: {
    brow: { raise: -9, inner: -3 },
    eye: [1.15, 1.15],
    smile: 9,
    smirk: 0,
    tilt: 4,
    blush: 0.45,
  },
  desconfiado: {
    brow: { raise: 3, inner: 2, leftExtra: -12 },
    eye: [0.95, 0.5],
    smile: -1,
    smirk: 6,
    tilt: 3,
    blush: 0,
  },
  surpreso: {
    brow: { raise: -11, inner: -3 },
    eye: [1.3, 1.3],
    smile: 0,
    smirk: 0,
    tilt: 0,
    blush: 0,
  },
  serio: {
    brow: { raise: 2, inner: 3 },
    eye: [0.85, 0.85],
    smile: -2,
    smirk: 0,
    tilt: 0,
    blush: 0,
  },
  bravo: { brow: { raise: 3, inner: 9 }, eye: [0.6, 0.6], smile: -6, smirk: 0, tilt: -1, blush: 0 },
};

function Brow({
  x,
  side,
  raise,
  inner,
}: {
  x: number;
  side: -1 | 1;
  raise: number;
  inner: number;
}) {
  // side -1 = sobrancelha à esquerda da tela (canto interno à direita)
  const outerX = x - side * 20;
  const innerX = x + side * 18;
  const y = 140 + raise;
  return (
    <path
      d={`M${outerX} ${y + 2} Q${x} ${y - 6} ${innerX} ${y + inner}`}
      stroke={HAIR}
      strokeWidth={7}
      strokeLinecap="round"
      fill="none"
    />
  );
}

function Eye({ cx, open }: { cx: number; open: number }) {
  const cy = 171;
  if (open < 0.12) {
    return (
      <path
        d={`M${cx - 14} ${cy} Q${cx} ${cy + 5} ${cx + 14} ${cy}`}
        stroke={HAIR}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  const ry = Math.min(14, 10.5 * open);
  const iris = open > 1.15 ? 5.5 : 6.5;
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={15} ry={ry} fill="#fdf6ef" />
      <circle cx={cx + 1} cy={cy + 0.5} r={Math.min(iris, ry)} fill="#3b2314" />
      <circle cx={cx + 3} cy={cy - 2} r={1.8} fill="#fff" />
      <ellipse
        cx={cx}
        cy={cy}
        rx={15}
        ry={ry}
        fill="none"
        stroke={HAIR}
        strokeOpacity={0.55}
        strokeWidth={1.5}
      />
    </g>
  );
}

/** As 9 formas de boca do Rhubarb, desenhadas em volta de (0, 0). */
function Mouth({ shape, smile }: { shape: MouthShape; smile: number }) {
  const corners = -smile; // y dos cantos (negativo = para cima)
  switch (shape) {
    case 'A':
      return (
        <path
          d={`M-17 ${corners * 0.6} Q0 2 17 ${corners * 0.6}`}
          stroke={LIP}
          strokeWidth={6}
          strokeLinecap="round"
          fill="none"
        />
      );
    case 'B':
      return (
        <g>
          <path
            d={`M-16 ${corners * 0.5} Q0 9 16 ${corners * 0.5} Q0 -2 -16 ${corners * 0.5}`}
            fill={MOUTH_IN}
          />
          <rect x={-12} y={-1} width={24} height={4} rx={2} fill="#fff" />
          <path
            d={`M-16 ${corners * 0.5} Q0 9 16 ${corners * 0.5}`}
            stroke={LIP}
            strokeWidth={3}
            fill="none"
          />
        </g>
      );
    case 'C':
      return (
        <g>
          <ellipse cx={0} cy={3} rx={16} ry={9} fill={MOUTH_IN} stroke={LIP} strokeWidth={3} />
          <rect x={-11} y={-5} width={22} height={4} rx={2} fill="#fff" />
        </g>
      );
    case 'D':
      return (
        <g>
          <ellipse cx={0} cy={6} rx={18} ry={15} fill={MOUTH_IN} stroke={LIP} strokeWidth={3} />
          <rect x={-12} y={-8} width={24} height={5} rx={2} fill="#fff" />
          <ellipse cx={0} cy={15} rx={10} ry={5} fill={TONGUE} />
        </g>
      );
    case 'E':
      return (
        <ellipse cx={0} cy={4} rx={12} ry={10} fill={MOUTH_IN} stroke={LIP} strokeWidth={3.5} />
      );
    case 'F':
      return <ellipse cx={0} cy={3} rx={7} ry={8} fill={MOUTH_IN} stroke={LIP} strokeWidth={5} />;
    case 'G':
      return (
        <g>
          <path d="M-15 0 Q0 9 15 0 Z" fill={MOUTH_IN} />
          <rect x={-10} y={-1} width={20} height={5} rx={1.5} fill="#fff" />
          <path
            d="M-15 4 Q0 10 15 4"
            stroke={LIP}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    case 'H':
      return (
        <g>
          <ellipse cx={0} cy={4} rx={15} ry={11} fill={MOUTH_IN} stroke={LIP} strokeWidth={3} />
          <path d="M-8 6 Q0 -4 8 6 Z" fill={TONGUE} />
        </g>
      );
    case 'X':
    default:
      return (
        <path
          d={`M-18 ${corners} Q0 ${3 - corners * 0.3} 18 ${corners}`}
          stroke={LIP}
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
        />
      );
  }
}

/** Braço com origem no ombro, apontando para baixo (+y) quando o ângulo é 0. */
function Arm({
  x,
  y,
  angle,
  pointing,
  sleeve,
}: {
  x: number;
  y: number;
  angle: number;
  pointing: boolean;
  sleeve: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle.toFixed(3)})`}>
      <rect
        x={-17}
        y={-6}
        width={34}
        height={66}
        rx={15}
        fill={`url(#${sleeve})`}
        stroke="#0b6f7a"
        strokeWidth={2}
      />
      <rect x={-11} y={52} width={22} height={62} rx={10} fill={SKIN} />
      <circle cx={0} cy={120} r={14} fill={SKIN} stroke={SKIN_SHADE} strokeWidth={1.5} />
      {pointing ? (
        <rect
          x={-3.5}
          y={124}
          width={7}
          height={24}
          rx={3.5}
          fill={SKIN}
          stroke={SKIN_SHADE}
          strokeWidth={1}
        />
      ) : null}
    </g>
  );
}

export function ZecaArt({
  state,
  provisional = true,
  title = 'Zeca Neon',
}: {
  state: AvatarFrameState;
  provisional?: boolean;
  title?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const floral = `floral-${uid}`;
  const frame = `frame-${uid}`;
  const s = STYLE[state.expression];
  const breathe = state.breath * 1.6;
  const eyeL = state.eyeOpen * s.eye[0];
  const eyeR = state.eyeOpen * s.eye[1];

  // Gestos: braço da esquerda da tela aponta para o conteúdo; o da direita acena.
  const g = state.gesture;
  const point = g?.id === 'aponta_tela' ? g.amount : 0;
  const wave = g?.id === 'aceno' ? g.amount : 0;
  const tap = g && g.amount > 0.99 ? Math.sin(g.phase * Math.PI * 6) * 3 : 0;
  // Diagonal para cima e para a esquerda: aponta para o conteúdo sem sair do quadro.
  const leftArm = 8 + point * (134 + (g?.id === 'aponta_tela' ? tap : 0));
  const rightArm = -8 - wave * (150 + (g?.id === 'aceno' ? tap * 4 : 0));

  return (
    <svg
      viewBox="0 0 400 480"
      overflow="visible"
      role="img"
      aria-label={`${title}${provisional ? ' (arte provisória)' : ''}`}
    >
      <defs>
        <pattern id={floral} width={56} height={56} patternUnits="userSpaceOnUse">
          <rect width={56} height={56} fill="#13b8c9" />
          <ellipse cx={40} cy={44} rx={9} ry={4} fill="#0f8f6f" transform="rotate(-30 40 44)" />
          <ellipse cx={10} cy={20} rx={8} ry={3.5} fill="#0f8f6f" transform="rotate(35 10 20)" />
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse
              key={`p${a}`}
              cx={18}
              cy={12}
              rx={4}
              ry={7}
              fill={NEON_PINK}
              transform={`rotate(${a} 18 18)`}
            />
          ))}
          <circle cx={18} cy={18} r={3.5} fill="#ffd23f" />
          {[0, 90, 180, 270].map((a) => (
            <ellipse
              key={`q${a}`}
              cx={44}
              cy={14}
              rx={3}
              ry={5}
              fill="#ffd23f"
              transform={`rotate(${a} 44 18)`}
            />
          ))}
          <circle cx={44} cy={18} r={2.5} fill={NEON_PINK} />
        </pattern>
        <linearGradient id={frame} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={NEON_PINK} />
          <stop offset="1" stopColor={NEON_CYAN} />
        </linearGradient>
      </defs>

      {/* tronco, camisa e braços (respiram juntos) */}
      <g transform={`translate(0 ${(breathe * 0.6).toFixed(3)})`}>
        <rect x={176} y={248} width={48} height={52} rx={10} fill={SKIN_SHADE} />
        <path
          d="M64 480 C72 368 118 300 200 296 C282 300 328 368 336 480 Z"
          fill={`url(#${floral})`}
          stroke="#0b6f7a"
          strokeWidth={3}
        />
        <path d="M174 296 L200 352 L226 296 Z" fill={SKIN} />
        <path
          d="M174 296 L160 322 L200 352 Z M226 296 L240 322 L200 352 Z"
          fill="#0fa5b5"
          stroke="#0b6f7a"
          strokeWidth={2}
        />
        <Arm x={112} y={336} angle={leftArm} pointing={point > 0.05} sleeve={floral} />
        <Arm x={288} y={336} angle={rightArm} pointing={false} sleeve={floral} />
      </g>

      {/* cabeça */}
      <g transform={`translate(0 ${breathe.toFixed(3)}) rotate(${s.tilt} 200 200)`}>
        <circle cx={123} cy={184} r={15} fill={SKIN_SHADE} />
        <circle cx={277} cy={184} r={15} fill={SKIN_SHADE} />
        <ellipse cx={200} cy={176} rx={78} ry={92} fill={SKIN} />
        <path
          d="M122 162 C112 104 140 52 196 44 C232 39 262 50 276 70 C296 98 290 132 278 158 C262 122 236 108 204 110 C170 112 142 126 122 162 Z"
          fill={HAIR}
          stroke={HAIR_RIM}
          strokeWidth={3}
          strokeOpacity={0.7}
        />
        <path
          d="M150 74 C172 50 222 44 258 66"
          stroke={NEON_PINK}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
          opacity={0.85}
        />
        <ellipse cx={150} cy={214} rx={16} ry={9} fill={NEON_PINK} opacity={s.blush} />
        <ellipse cx={250} cy={214} rx={16} ry={9} fill={NEON_PINK} opacity={s.blush} />

        <Brow
          x={168}
          side={-1}
          raise={s.brow.raise + (s.brow.leftExtra ?? 0)}
          inner={s.brow.inner}
        />
        <Brow x={232} side={1} raise={s.brow.raise} inner={s.brow.inner} />
        <Eye cx={168} open={eyeL} />
        <Eye cx={232} open={eyeR} />

        {/* óculos escuros: lentes translúcidas (os olhos aparecem por trás) */}
        <g>
          <rect
            x={139}
            y={151}
            width={58}
            height={40}
            rx={13}
            fill="#0c061e"
            fillOpacity={0.5}
            stroke={`url(#${frame})`}
            strokeWidth={5}
          />
          <rect
            x={203}
            y={151}
            width={58}
            height={40}
            rx={13}
            fill="#0c061e"
            fillOpacity={0.5}
            stroke={`url(#${frame})`}
            strokeWidth={5}
          />
          <path d="M197 166 Q200 161 203 166" stroke={NEON_PINK} strokeWidth={4} fill="none" />
          <path
            d="M139 162 L124 170 M261 162 L276 170"
            stroke={NEON_CYAN}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <path
            d="M148 158 L162 158 M212 158 L226 158"
            stroke="#fff"
            strokeOpacity={0.35}
            strokeWidth={3}
            strokeLinecap="round"
          />
        </g>

        <path
          d="M200 192 Q192 214 197 218 Q202 221 207 216"
          stroke={SKIN_SHADE}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
        <g transform={`translate(${200 + (s.smirk ? 4 : 0)} 240) rotate(${s.smirk})`}>
          <Mouth shape={state.mouth} smile={s.smile} />
        </g>
      </g>

      {provisional ? (
        <g opacity={0.85}>
          <rect x={10} y={448} width={132} height={22} rx={11} fill="#0c061e" />
          <text
            x={76}
            y={463}
            textAnchor="middle"
            fontSize={11}
            fontFamily="sans-serif"
            fill="#fff"
            letterSpacing={1}
          >
            ARTE PROVISÓRIA
          </text>
        </g>
      ) : null}
    </svg>
  );
}
