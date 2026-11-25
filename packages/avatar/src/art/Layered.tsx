import type { ComponentType, CSSProperties } from 'react';
import { layerFrame, type ArtPackRef } from '../art-pack';
import type { AvatarFrameState } from '../engine';

/**
 * Arte do ilustrador em camadas (PNG/SVG). Todas as camadas ficam montadas (carregadas uma vez)
 * e só a da vez aparece: troca de boca e piscada sem recarregar imagem. No render, `Img` é o
 * <Img> da Remotion (espera a imagem carregar antes de gravar o quadro); no painel, <img>.
 */

export interface ImgLikeProps {
  src: string;
  alt: string;
  style?: CSSProperties;
}

const fill: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
};

export function LayeredArt({
  pack,
  baseUrl,
  state,
  Img = 'img' as unknown as ComponentType<ImgLikeProps>,
  title = 'Zeca Neon',
}: {
  pack: ArtPackRef;
  /** Base dos arquivos (sem barra no fim): pasta de trabalho no render, /api no painel. */
  baseUrl: string;
  state: AvatarFrameState;
  Img?: ComponentType<ImgLikeProps> | 'img';
  title?: string;
}) {
  const available = new Set(Object.keys(pack.files));
  const f = layerFrame(state, available);
  const url = (layer: string) => `${baseUrl}/${pack.files[layer]}`;
  const Image = Img as ComponentType<ImgLikeProps>;
  const layer = (name: string, shown: boolean) => (
    <Image
      key={name}
      src={url(name)}
      alt=""
      style={{ ...fill, objectFit: 'contain', opacity: shown ? 1 : 0 }}
    />
  );
  /** Todas as camadas de um grupo (ex.: as 9 bocas), só a da vez visível. */
  const group = (prefix: string, current: string | null) =>
    [...available].filter((l) => l.startsWith(prefix)).map((l) => layer(l, l === current));
  const [hx, hy] = pack.pivots.head;
  const [ax, ay] = pack.pivots.arm;
  return (
    <div
      role="img"
      aria-label={title}
      data-art-version={pack.version}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${pack.canvas.w} / ${pack.canvas.h}`,
      }}
    >
      <div style={{ ...fill, transform: `translateY(${f.bodyShiftY.toFixed(3)}%)` }}>
        {f.back ? layer('costas', true) : null}
        {layer('corpo', true)}
        <div
          style={{
            ...fill,
            transformOrigin: `${ax}% ${ay}%`,
            transform: `rotate(${f.armRotate.toFixed(3)}deg)`,
          }}
        >
          {group('braco-', f.arm)}
        </div>
      </div>
      <div
        style={{
          ...fill,
          transformOrigin: `${hx}% ${hy}%`,
          transform: `translateY(${f.headShiftY.toFixed(3)}%) rotate(${f.headTilt}deg)`,
        }}
      >
        {layer('cabeca', true)}
        {group('olhos-', f.eyes)}
        {group('sobrancelhas-', f.brows)}
        {group('boca-', f.mouth)}
        {group('rosto-', f.face)}
        {f.front ? layer('frente', true) : null}
      </div>
    </div>
  );
}
