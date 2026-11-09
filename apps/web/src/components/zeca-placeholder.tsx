/**
 * ARTE PROVISÓRIA do Zeca Neon (substituída pelo pacote do ilustrador).
 * Desenho simples em camadas só para identificar o personagem no painel.
 */
export function ZecaPlaceholder({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 220"
      role="img"
      aria-label="Zeca Neon (arte provisória)"
      className={className}
    >
      <defs>
        <linearGradient id="zp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff3d8b" />
          <stop offset="1" stopColor="#ff9a3c" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="92" r="84" fill="url(#zp-sky)" opacity="0.25" />
      {/* tronco com camisa floral */}
      <path d="M38 220c4-46 28-68 62-68s58 22 62 68z" fill="#2ee6f2" />
      <g fill="#ff3d8b">
        <circle cx="70" cy="190" r="6" />
        <circle cx="128" cy="182" r="7" />
        <circle cx="100" cy="206" r="5" />
      </g>
      <path d="M88 152l12 22 12-22" fill="#fff" />
      {/* pescoço e cabeça */}
      <rect x="88" y="128" width="24" height="28" rx="8" fill="#c98a5e" />
      <ellipse cx="100" cy="96" rx="40" ry="46" fill="#d99a6c" />
      {/* cabelo */}
      <path
        d="M60 86c0-30 18-44 40-44s42 12 42 40c-10-12-26-16-42-16s-30 6-40 20z"
        fill="#1b1030"
      />
      {/* óculos escuros */}
      <rect x="66" y="84" width="30" height="16" rx="6" fill="#07040f" />
      <rect x="104" y="84" width="30" height="16" rx="6" fill="#07040f" />
      <rect x="95" y="89" width="10" height="3" fill="#07040f" />
      <path d="M70 88h10" stroke="#2ee6f2" strokeWidth="2" strokeLinecap="round" />
      <path d="M108 88h10" stroke="#2ee6f2" strokeWidth="2" strokeLinecap="round" />
      {/* boca (sorriso de canto) */}
      <path
        d="M86 118c8 6 22 6 30-2"
        stroke="#5a2a1e"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
