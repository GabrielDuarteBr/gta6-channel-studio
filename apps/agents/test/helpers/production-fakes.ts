import type { TtsProvider } from '@studio/providers';
import { MediaService, RenderService, type FetchLike } from '../../src/character/services';

/** Voz, worker-media e render falsos para os testes de integração da produção. */
export const tts: TtsProvider = {
  id: 'fake',
  label: 'teste',
  real: false,
  synthesize: async (req) => ({
    path: req.out,
    durationSec: 1,
    chars: req.text.length,
    costUsd: 0,
    provider: 'fake',
  }),
};

/** worker-media e render falsos: respondem como os de verdade e guardam os pedidos. */
export function fakeServices() {
  const renders: Array<{ composition: string; output: string; props: Record<string, unknown> }> =
    [];
  const files = new Set<string>();
  const fetchImpl: FetchLike = async (u, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const path = new URL(u).pathname;
    const reply = (data: unknown) => new Response(JSON.stringify(data));
    switch (path) {
      case '/audio/voice-track': {
        const n = body.segments.length;
        const segments = Array.from({ length: n }, (_, i) => ({
          start: 0.2 + i * 1.3,
          end: 1.2 + i * 1.3,
        }));
        return reply({ path: body.out, duration_sec: segments.at(-1)!.end + 0.3, segments });
      }
      case '/lipsync':
        return reply({ duration_sec: 3, mouth_cues: [{ start: 0.2, end: 0.6, value: 'D' }] });
      case '/file/info':
        return reply(files.has(body.path) ? { exists: true, bytes: 10 } : { exists: false });
      case '/image/import':
        files.add(body.out);
        return reply({ path: body.out, bytes: 10 });
      case '/video/keyframes':
        return reply({ frames: body.times.map((t: number) => ({ t, jpeg_b64: 'AAAA' })) });
      case '/image/preview':
        return reply({ jpeg_b64: 'BBBB' });
      case '/render': {
        renders.push(body);
        return reply({
          id: `r${renders.length}`,
          status: 'pronto',
          report: {
            output: body.output,
            width: body.still ? 1280 : 1280,
            height: 720,
            frames: body.still ? 1 : 300,
            seconds: body.still ? 1.1 : 25.4,
            bytes: 1234,
            cpuSeconds: body.still ? 0.8 : 60.2,
            peakMemoryMb: 900,
            metricsSource: 'cgroup',
          },
        });
      }
      default:
        return new Response('{}', { status: 404 });
    }
  };
  return {
    renders,
    files,
    media: new MediaService('http://media', fetchImpl),
    render: new RenderService('http://render', fetchImpl, async () => {}),
  };
}
