import type { ArtPackRef, AvatarFrameState } from '@studio/avatar';
import { LayeredArt, ZecaArt, type ImgLikeProps } from '@studio/avatar/art';
import type { ComponentType } from 'react';
import { Img } from 'remotion';

/**
 * O Zeca em cena: arte do ilustrador (camadas, com o <Img> da Remotion, que espera cada imagem
 * carregar antes de gravar o quadro) ou, sem arte ativa, a arte provisória em SVG.
 */
export function Character({
  state,
  art,
  workBaseUrl,
  provisional,
}: {
  state: AvatarFrameState;
  art?: ArtPackRef | null | undefined;
  workBaseUrl?: string | undefined;
  provisional: boolean;
}) {
  if (art && workBaseUrl) {
    return (
      <LayeredArt
        pack={art}
        baseUrl={workBaseUrl}
        state={state}
        Img={Img as unknown as ComponentType<ImgLikeProps>}
      />
    );
  }
  return <ZecaArt state={state} provisional={provisional} />;
}
