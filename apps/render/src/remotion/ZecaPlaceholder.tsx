import type { CSSProperties } from 'react';

/**
 * ARTE PROVISÓRIA do Zeca Neon (Fase 0). Substituída na Fase 2 pelo motor de
 * avatar (Rive ou camadas) e depois pelo pacote do ilustrador.
 * `mouthOpen` (0..1) prova a animação quadro a quadro determinística.
 */
export function ZecaPlaceholder({
  mouthOpen,
  style,
}: {
  mouthOpen: number;
  style?: CSSProperties;
}) {
  const mouthH = 2 + mouthOpen * 14;
  return (
    <svg viewBox="0 0 200 220" style={style} role="img" aria-label="Zeca Neon (arte provisória)">
      <path d="M38 220c4-46 28-68 62-68s58 22 62 68z" fill="#2ee6f2" />
      <g fill="#ff3d8b">
        <circle cx="70" cy="190" r="6" />
        <circle cx="128" cy="182" r="7" />
        <circle cx="100" cy="206" r="5" />
      </g>
      <path d="M88 152l12 22 12-22" fill="#fff" />
      <rect x="88" y="128" width="24" height="28" rx="8" fill="#c98a5e" />
      <ellipse cx="100" cy="96" rx="40" ry="46" fill="#d99a6c" />
      <path
        d="M60 86c0-30 18-44 40-44s42 12 42 40c-10-12-26-16-42-16s-30 6-40 20z"
        fill="#1b1030"
      />
      <rect x="66" y="84" width="30" height="16" rx="6" fill="#07040f" />
      <rect x="104" y="84" width="30" height="16" rx="6" fill="#07040f" />
      <rect x="95" y="89" width="10" height="3" fill="#07040f" />
      <ellipse cx="101" cy="120" rx="12" ry={mouthH / 2} fill="#5a2a1e" />
    </svg>
  );
}
