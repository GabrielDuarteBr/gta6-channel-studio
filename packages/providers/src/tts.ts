import { z } from 'zod';

/**
 * Voz (TTS) plugável. Cada provedor transforma um trecho de texto num WAV na pasta de
 * trabalho e informa duração, caracteres e custo. O provedor real entra quando o dono
 * escolher (comparação de custo dentro do teto de US$ 50/mês).
 */
export interface TtsRequest {
  text: string;
  /** Caminho relativo à pasta de trabalho, terminando em .wav. */
  out: string;
}

export interface TtsResult {
  path: string;
  durationSec: number;
  chars: number;
  costUsd: number;
  provider: string;
}

export interface TtsProvider {
  readonly id: string;
  readonly label: string;
  /** false = voz de teste (não pode ir para vídeo publicado). */
  readonly real: boolean;
  synthesize(req: TtsRequest): Promise<TtsResult>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  override name = 'ProviderError';
}

const espeakResponse = z.object({ path: z.string(), duration_sec: z.number() });

/** Voz falsa offline (espeak-ng no worker-media). Robótica, grátis, só para testes. */
export class FakeTts implements TtsProvider {
  readonly id = 'fake';
  readonly label = 'Voz de teste (espeak-ng, robótica)';
  readonly real = false;

  constructor(
    private readonly mediaUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly voice = 'pt-br',
  ) {}

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const res = await this.fetchImpl(`${this.mediaUrl}/tts/espeak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: req.text, out: req.out, voice: this.voice }),
      signal: AbortSignal.timeout(90_000),
    });
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new ProviderError(`voz de teste falhou: ${detail}`);
    }
    const data = espeakResponse.parse(body);
    return {
      path: data.path,
      durationSec: data.duration_sec,
      chars: req.text.length,
      costUsd: 0,
      provider: this.id,
    };
  }
}

export const TTS_PROVIDERS = ['fake'] as const;
export type TtsProviderId = (typeof TTS_PROVIDERS)[number];

export function createTtsProvider(
  id: TtsProviderId,
  opts: { mediaUrl: string; fetchImpl?: FetchLike },
): TtsProvider {
  switch (id) {
    case 'fake':
      return new FakeTts(opts.mediaUrl, opts.fetchImpl);
  }
}
