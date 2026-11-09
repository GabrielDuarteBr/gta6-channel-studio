import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { renderDimensions } from '@studio/shared';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface RenderReport {
  composition: string;
  output: string;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  bytes: number;
}

/** Renderiza a composição de teste na resolução do perfil (720p no notebook). */
export async function renderHello(opts: {
  outDir: string;
  height: 720 | 1080;
  vertical?: boolean;
  concurrency?: number;
}): Promise<RenderReport> {
  const started = performance.now();
  const id = opts.vertical ? 'HelloZecaVertical' : 'HelloZeca';
  const serveUrl = await bundle({ entryPoint: path.join(here, 'remotion/index.ts') });
  const dims = renderDimensions(opts.vertical ? 'vertical' : 'landscape', opts.height);
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE ?? null;
  const composition = await selectComposition({ serveUrl, id, inputProps: {}, browserExecutable });
  await mkdir(opts.outDir, { recursive: true });
  const output = path.join(opts.outDir, `${id}-${dims.height}p.mp4`);
  await renderMedia({
    serveUrl,
    composition: { ...composition, ...dims },
    codec: 'h264',
    outputLocation: output,
    concurrency: opts.concurrency ?? 1,
    chromiumOptions: { gl: 'swangle' },
    browserExecutable,
  });
  const { size } = await stat(output);
  return {
    composition: id,
    output,
    ...dims,
    frames: composition.durationInFrames,
    seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
    bytes: size,
  };
}
