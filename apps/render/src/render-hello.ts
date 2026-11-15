import path from 'node:path';
import { renderComposition, type RenderReport } from './render';

export type { RenderReport };

/** Renderiza a composição de teste na resolução do perfil (720p no notebook). */
export async function renderHello(opts: {
  outDir: string;
  height: 720 | 1080;
  vertical?: boolean;
  concurrency?: number;
}): Promise<RenderReport> {
  const id = opts.vertical ? 'HelloZecaVertical' : 'HelloZeca';
  return renderComposition({
    id,
    inputProps: {},
    output: path.join(opts.outDir, `${id}-${opts.height}p.mp4`),
    height: opts.height,
    vertical: opts.vertical,
    concurrency: opts.concurrency,
  });
}
