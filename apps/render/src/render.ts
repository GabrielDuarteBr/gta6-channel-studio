import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { renderDimensions } from '@studio/shared';
import { startMetrics } from './metrics';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(here, '..', 'public');
const require = createRequire(import.meta.url);

export interface RenderReport {
  composition: string;
  output: string;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  bytes: number;
  /** Segundos de CPU e pico de memória do container durante o render. */
  cpuSeconds: number;
  peakMemoryMb: number;
  metricsSource: 'cgroup' | 'processo';
}

/** Silêncio de 1 s (WAV PCM 16 bits mono 44,1 kHz) para a pré-visualização no Remotion Studio. */
function silentWav(seconds = 1, rate = 44100): Buffer {
  const data = rate * seconds * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

/**
 * Arquivos locais que o bundle precisa: o WASM do Rive vem do pacote npm (nada de CDN
 * na hora do render) e um silêncio de exemplo para as props padrão.
 */
export async function preparePublicAssets(publicDir = PUBLIC_DIR): Promise<void> {
  await mkdir(path.join(publicDir, 'rive'), { recursive: true });
  await mkdir(path.join(publicDir, 'zeca'), { recursive: true });
  const wasm = path.join(path.dirname(require.resolve('@rive-app/canvas-advanced')), 'rive.wasm');
  await copyFile(wasm, path.join(publicDir, 'rive', 'rive.wasm'));
  await writeFile(path.join(publicDir, 'zeca', 'silencio.wav'), silentWav());
}

/**
 * Modo de GPU do Chrome. 'swiftshader' (software) deu quadros idênticos render após render;
 * no 'swangle' o primeiro render saía com pixels diferentes (ruído de 1 unidade).
 */
const GL_MODES = ['swiftshader', 'swangle', 'angle', 'egl'] as const;
type GlMode = (typeof GL_MODES)[number];
export const RENDER_GL: GlMode = (GL_MODES as readonly string[]).includes(
  process.env.RENDER_GL ?? '',
)
  ? (process.env.RENDER_GL as GlMode)
  : 'swiftshader';

let serveUrl: Promise<string> | null = null;

/** Bundle do Remotion feito uma vez por processo (cada render reaproveita). */
export function getServeUrl(): Promise<string> {
  serveUrl ??= preparePublicAssets().then(() =>
    bundle({ entryPoint: path.join(here, 'remotion/index.ts'), publicDir: PUBLIC_DIR }),
  );
  serveUrl.catch(() => {
    serveUrl = null;
  });
  return serveUrl;
}

export async function renderComposition(opts: {
  id: string;
  inputProps: Record<string, unknown>;
  output: string;
  height: 720 | 1080;
  vertical?: boolean;
  concurrency?: number;
  /** Quadro único (PNG), no tamanho da própria composição (thumbnail 1280×720). */
  still?: boolean;
}): Promise<RenderReport> {
  const started = performance.now();
  const stopMetrics = startMetrics();
  const url = await getServeUrl();
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE ?? null;
  const composition = await selectComposition({
    serveUrl: url,
    id: opts.id,
    inputProps: opts.inputProps,
    browserExecutable,
    chromiumOptions: { gl: RENDER_GL },
  });
  await mkdir(path.dirname(opts.output), { recursive: true });
  if (opts.still) {
    await renderStill({
      serveUrl: url,
      composition,
      inputProps: opts.inputProps,
      output: opts.output,
      imageFormat: 'png',
      frame: 0,
      chromiumOptions: { gl: RENDER_GL },
      browserExecutable,
    });
    const { size } = await stat(opts.output);
    return {
      composition: opts.id,
      output: opts.output,
      width: composition.width,
      height: composition.height,
      frames: 1,
      seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
      bytes: size,
      ...stopMetrics(),
    };
  }
  const dims = renderDimensions(opts.vertical ? 'vertical' : 'landscape', opts.height);
  await renderMedia({
    serveUrl: url,
    composition: { ...composition, ...dims },
    inputProps: opts.inputProps,
    codec: 'h264',
    outputLocation: opts.output,
    concurrency: opts.concurrency ?? 1,
    chromiumOptions: { gl: RENDER_GL },
    browserExecutable,
  });
  const { size } = await stat(opts.output);
  return {
    composition: opts.id,
    output: opts.output,
    ...dims,
    frames: composition.durationInFrames,
    seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
    bytes: size,
    ...stopMetrics(),
  };
}
