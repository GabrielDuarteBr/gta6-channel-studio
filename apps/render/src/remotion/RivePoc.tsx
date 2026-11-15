import RiveCanvas, {
  type File as RiveFile,
  type RiveCanvas as RiveRuntime,
} from '@rive-app/canvas-advanced';
import { useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion';
import { z } from 'zod';

/**
 * PROVA DE CONCEITO do Caminho A (Rive) — Fase 2.
 *
 * O <RemotionRiveCanvas> oficial toca só UMA animação linear e baixa o WASM do unpkg.com a
 * cada render. Aqui o runtime vem de arquivo local e a state machine é controlada por quadro:
 * a cada quadro criamos artboard + state machine NOVOS, ajustamos a entrada e avançamos só o
 * tempo desde a última troca (conhecido pela linha do tempo). Nenhum quadro depende do
 * anterior, então o resultado não muda com a ordem nem com renders em paralelo.
 */
export const rivePocSchema = z.object({
  src: z.string().min(1),
  wasm: z.string().min(1),
  stateMachine: z.string().min(1),
  input: z.string().min(1),
  /** Valor da entrada em cada trecho (troca a cada `secondsPerValue`). */
  values: z.array(z.number()).min(1),
  secondsPerValue: z.number().positive(),
});
export type RivePocProps = z.infer<typeof rivePocSchema>;

interface Loaded {
  rive: RiveRuntime;
  file: RiveFile;
  inputs: string[];
}

export function RivePoc({ src, wasm, stateMachine, input, values, secondsPerValue }: RivePocProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  if (error) throw error;

  useLayoutEffect(() => {
    const handle = delayRender('Carregando o Rive (runtime local)');
    let cancelled = false;
    (async () => {
      const rive = await RiveCanvas({ locateFile: () => wasm });
      const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
      const file = await rive.load(bytes, undefined, false);
      const probe = file.defaultArtboard();
      const sm = new rive.StateMachineInstance(probe.stateMachineByName(stateMachine), probe);
      const inputs = Array.from({ length: sm.inputCount() }, (_, i) => sm.input(i).name);
      sm.delete();
      probe.delete();
      if (!cancelled) setLoaded({ rive, file, inputs });
      continueRender(handle);
    })().catch((err: unknown) => {
      setError(err instanceof Error ? err : new Error(String(err)));
      cancelRender(err);
    });
    return () => {
      cancelled = true;
    };
  }, [src, wasm, stateMachine, delayRender, continueRender, cancelRender]);

  const framesPerValue = Math.max(1, Math.round(secondsPerValue * fps));
  const index = Math.floor(frame / framesPerValue) % values.length;
  const value = values[index] ?? 0;
  const sinceChange = (frame % framesPerValue) / fps;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!loaded || !canvas) return;
    const handle = delayRender(`Rive quadro ${frame}`);
    const { rive, file } = loaded;
    canvas.width = width;
    canvas.height = height;
    const renderer = rive.makeRenderer(canvas);
    const artboard = file.defaultArtboard();
    const sm = new rive.StateMachineInstance(artboard.stateMachineByName(stateMachine), artboard);
    for (let i = 0; i < sm.inputCount(); i++) {
      const smInput = sm.input(i);
      if (smInput.name === input) smInput.asNumber().value = value;
    }
    sm.advanceAndApply(sinceChange);
    artboard.advance(0);
    renderer.clear();
    renderer.save();
    renderer.align(
      rive.Fit.contain,
      rive.Alignment.center,
      { minX: 0, minY: height * 0.12, maxX: width, maxY: height },
      artboard.bounds,
    );
    artboard.draw(renderer);
    renderer.restore();
    rive.resolveAnimationFrame();
    sm.delete();
    artboard.delete();
    renderer.delete();
    continueRender(handle);
  }, [
    loaded,
    frame,
    width,
    height,
    stateMachine,
    input,
    value,
    sinceChange,
    delayRender,
    continueRender,
  ]);

  return (
    <AbsoluteFill style={{ background: '#140a26', color: '#fff', fontFamily: 'sans-serif' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: 24, left: 32, fontSize: 28 }}>
        Prova de conceito Rive · {input} = {value} · quadro {frame}
        {loaded ? ` · entradas: ${loaded.inputs.join(', ')}` : ''}
      </div>
    </AbsoluteFill>
  );
}
