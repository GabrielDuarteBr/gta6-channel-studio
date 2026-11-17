import { z } from 'zod';

/** Clientes HTTP dos serviços internos (worker-media e render). Só caminhos relativos. */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ServiceError extends Error {
  override name = 'ServiceError';
}

async function call<T>(
  fetchImpl: FetchLike,
  url: string,
  schema: z.ZodType<T>,
  init: RequestInit,
  what: string,
): Promise<T> {
  const res = await fetchImpl(url, init);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body as { error?: unknown }).error;
    throw new ServiceError(
      `${what}: ${typeof detail === 'string' ? detail : `HTTP ${res.status}`}`,
    );
  }
  return schema.parse(body);
}

const json = (body: unknown, timeoutMs: number): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(timeoutMs),
});

const voiceTrackSchema = z.object({
  path: z.string(),
  duration_sec: z.number(),
  segments: z.array(z.object({ start: z.number(), end: z.number() })),
});
const lipsyncSchema = z.object({
  duration_sec: z.number(),
  mouth_cues: z.array(z.object({ start: z.number(), end: z.number(), value: z.string() })),
});
const hashesSchema = z.object({ frames: z.number(), hashes: z.array(z.string()) });
const imageImportSchema = z.object({ path: z.string(), bytes: z.number() });
const fileInfoSchema = z.object({ exists: z.boolean(), bytes: z.number().optional() });
const keyframesSchema = z.object({
  frames: z.array(z.object({ t: z.number(), jpeg_b64: z.string() })),
});
const previewSchema = z.object({ jpeg_b64: z.string() });

const probeSchema = z.object({
  path: z.string(),
  duration_sec: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  video_codec: z.string(),
  has_audio: z.boolean(),
  audio_codec: z.string(),
  bytes: z.number(),
});
const range = z.tuple([z.number(), z.number()]);
const analysisSchema = z.object({
  path: z.string(),
  probe: probeSchema,
  language: z.string().nullable(),
  speech: z.array(range),
  segments: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      text: z.string(),
      no_speech: z.number(),
      music: z.boolean(),
    }),
  ),
  music: z.array(range),
  loudness: z.array(z.number()),
  scenes: z.array(z.number()),
  model: z.string().nullable(),
});
const cutSchema = z.object({
  path: z.string(),
  duration_sec: z.number(),
  width: z.number(),
  height: z.number(),
  audio_mode: z.enum(['voice', 'full', 'mute']),
  speech_ranges: z.array(range),
});
const extractSchema = z.object({
  files: z.array(z.object({ path: z.string(), name: z.string(), bytes: z.number() })),
});

export type VideoProbe = z.infer<typeof probeSchema>;

/** Análise do vídeo do parceiro (camelCase, como fica guardada em Asset.analysis). */
export interface VideoAnalysis {
  language: string | null;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Trechos com fala (segundos). */
  speech: Array<[number, number]>;
  segments: Array<{ start: number; end: number; text: string; music: boolean }>;
  /** Trechos com música marcada pelo Whisper (ficam fora do corte). */
  music: Array<[number, number]>;
  /** Nível de áudio (dBFS) de cada segundo. */
  loudness: number[];
  /** Trocas de cena (segundos). */
  scenes: number[];
  model: string | null;
}

export class MediaService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async voiceTrack(
    segments: Array<{ path: string; pauseAfterMs: number }>,
    out: string,
    leadInMs: number,
    tailMs: number,
  ) {
    const r = await call(
      this.fetchImpl,
      `${this.baseUrl}/audio/voice-track`,
      voiceTrackSchema,
      json(
        {
          segments: segments.map((s) => ({ path: s.path, pause_after_ms: s.pauseAfterMs })),
          out,
          lead_in_ms: Math.min(5000, leadInMs),
          tail_ms: tailMs,
        },
        180_000,
      ),
      'trilha de voz',
    );
    return { path: r.path, durationSec: r.duration_sec, segments: r.segments };
  }

  async lipsync(audio: string) {
    const r = await call(
      this.fetchImpl,
      `${this.baseUrl}/lipsync`,
      lipsyncSchema,
      json({ audio }, 280_000),
      'sincronia da boca (Rhubarb)',
    );
    return { durationSec: r.duration_sec, mouthCues: r.mouth_cues };
  }

  /** Copia uma imagem (bytes) para a pasta de trabalho, onde o render enxerga. */
  async importImage(out: string, bytes: Uint8Array) {
    return call(
      this.fetchImpl,
      `${this.baseUrl}/image/import`,
      imageImportSchema,
      json({ out, data_b64: Buffer.from(bytes).toString('base64') }, 120_000),
      'copiar imagem para a pasta de trabalho',
    );
  }

  fileInfo(path: string) {
    return call(
      this.fetchImpl,
      `${this.baseUrl}/file/info`,
      fileInfoSchema,
      json({ path }, 30_000),
      'arquivo na pasta de trabalho',
    );
  }

  /** Quadros JPEG (base64) do vídeo nos instantes pedidos (para o Revisor visual). */
  async keyframes(video: string, times: number[], width = 768) {
    const r = await call(
      this.fetchImpl,
      `${this.baseUrl}/video/keyframes`,
      keyframesSchema,
      json({ video, times, width }, 280_000),
      'quadros do vídeo',
    );
    return r.frames.map((f) => ({ t: f.t, jpegBase64: f.jpeg_b64 }));
  }

  async preview(image: string, width = 768) {
    const r = await call(
      this.fetchImpl,
      `${this.baseUrl}/image/preview`,
      previewSchema,
      json({ image, width }, 120_000),
      'prévia da imagem',
    );
    return r.jpeg_b64;
  }

  /** Dados do vídeo (duração, tamanho, áudio). */
  probe(video: string) {
    return call(
      this.fetchImpl,
      `${this.baseUrl}/video/probe`,
      probeSchema,
      json({ video }, 60_000),
      'dados do vídeo',
    );
  }

  /** Transcrição, fala, música, cenas e nível de áudio (faster-whisper; pode levar minutos). */
  async analyze(video: string, language?: string): Promise<VideoAnalysis> {
    const r = await call(
      this.fetchImpl,
      `${this.baseUrl}/video/analyze`,
      analysisSchema,
      json({ video, ...(language ? { language } : {}) }, 45 * 60_000),
      'análise do vídeo',
    );
    return {
      language: r.language,
      durationSec: r.probe.duration_sec,
      width: r.probe.width,
      height: r.probe.height,
      hasAudio: r.probe.has_audio,
      speech: r.speech,
      segments: r.segments.map((x) => ({
        start: x.start,
        end: x.end,
        text: x.text,
        music: x.music,
      })),
      music: r.music,
      loudness: r.loudness,
      scenes: r.scenes,
      model: r.model,
    };
  }

  /** Corta um trecho do vídeo do parceiro (só a voz, áudio inteiro ou mudo). */
  async cut(input: {
    video: string;
    out: string;
    start: number;
    end: number;
    audioMode: 'voice' | 'full' | 'mute';
    speech: Array<[number, number]>;
  }) {
    const r = await call(
      this.fetchImpl,
      `${this.baseUrl}/video/cut`,
      cutSchema,
      json(
        {
          video: input.video,
          out: input.out,
          start: input.start,
          end: input.end,
          audio_mode: input.audioMode,
          speech_ranges: input.speech,
        },
        600_000,
      ),
      'corte do clipe',
    );
    return {
      path: r.path,
      durationSec: r.duration_sec,
      width: r.width,
      height: r.height,
      audioMode: r.audio_mode,
    };
  }

  /** Vídeos de uma pasta baixada em .zip (pasta do Dropbox). */
  extractVideos(archive: string, outDir: string, maxFiles = 20) {
    return call(
      this.fetchImpl,
      `${this.baseUrl}/archive/extract-videos`,
      extractSchema,
      json({ archive, out_dir: outDir, max_files: maxFiles }, 600_000),
      'abrir a pasta .zip',
    );
  }

  frameHashes(video: string) {
    return call(
      this.fetchImpl,
      `${this.baseUrl}/video/frame-hashes`,
      hashesSchema,
      json({ video }, 280_000),
      'hash dos quadros',
    );
  }
}

const renderJobSchema = z.object({
  id: z.string(),
  status: z.enum(['na fila', 'renderizando', 'pronto', 'falhou']),
  error: z.string().optional(),
  report: z
    .object({
      output: z.string(),
      width: z.number(),
      height: z.number(),
      frames: z.number(),
      seconds: z.number(),
      bytes: z.number(),
      /** Segundos de CPU do container de render durante este trabalho. */
      cpuSeconds: z.number().optional(),
      /** Pico de memória do container de render (MB) durante este trabalho. */
      peakMemoryMb: z.number().optional(),
      /** "cgroup" (container inteiro, com o Chrome) ou "processo" (só o Node). */
      metricsSource: z.string().optional(),
    })
    .optional(),
});
export type RenderReport = NonNullable<z.infer<typeof renderJobSchema>['report']>;

export interface RenderRequest {
  composition: 'ZecaClip' | 'RivePoc' | 'NewsVideo' | 'Thumbnail' | 'ReactShort';
  props: Record<string, unknown>;
  /** .mp4 para vídeo; .png para quadro único (thumbnail). */
  output: string;
  audio?: string;
  vertical?: boolean;
  height?: 720 | 1080;
  /** Quadro único (thumbnail) em vez de vídeo. */
  still?: boolean;
}

export class RenderService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Pede o render e acompanha até terminar (o render pode levar minutos). */
  async render(
    req: RenderRequest,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<RenderReport> {
    const deadline = Date.now() + (opts.timeoutMs ?? 60 * 60_000);
    let job = await call(
      this.fetchImpl,
      `${this.baseUrl}/render`,
      renderJobSchema,
      json(req, 30_000),
      'render',
    );
    let networkErrors = 0;
    while (job.status === 'na fila' || job.status === 'renderizando') {
      if (Date.now() > deadline) throw new ServiceError('render: passou do tempo limite');
      await this.sleep(opts.pollMs ?? 2000);
      try {
        job = await call(
          this.fetchImpl,
          `${this.baseUrl}/render/${job.id}`,
          renderJobSchema,
          { signal: AbortSignal.timeout(30_000) },
          'render',
        );
        networkErrors = 0;
      } catch (err) {
        // Falha de rede passageira (conexão reaproveitada que caiu, serviço ocupado):
        // o render continua lá; só tenta consultar de novo.
        if (err instanceof ServiceError || ++networkErrors > 10) throw err;
      }
    }
    if (job.status === 'falhou' || !job.report) {
      throw new ServiceError(`render falhou: ${job.error ?? 'sem detalhe'}`);
    }
    return job.report;
  }
}
