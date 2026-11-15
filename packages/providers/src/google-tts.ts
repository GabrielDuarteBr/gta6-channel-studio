import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  isTransientStatus,
  ProviderError,
  type FetchLike,
  type TtsProvider,
  type TtsRequest,
  type TtsResult,
} from './tts';

/**
 * Voz real: Google Cloud Text-to-Speech, vozes Chirp 3: HD.
 * Conferido no documento de descoberta oficial (texttospeech v1, revisão 20261110):
 * - POST v1/text:synthesize; chave de API aceita (aqui no cabeçalho x-goog-api-key, para
 *   nunca aparecer em URL ou log);
 * - LINEAR16 volta com cabeçalho WAV; speakingRate de 0,25 a 2,0.
 * Preço de tabela do Chirp 3: HD (sites de comparação, nov/2026): US$ 30 por milhão de
 * caracteres, 1 milhão grátis por mês. Confira na página de preços do Google.
 */
export const GOOGLE_TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1';
export const CHIRP3_HD_USD_PER_MILLION = 30;
export const GOOGLE_VOICE_PATTERN = /^[a-z]{2,3}-[A-Z]{2}-Chirp3-HD-[A-Za-z]+$/;
/** O Google limita o texto por requisição em bytes; os trechos do Zeca ficam bem abaixo. */
export const GOOGLE_MAX_TEXT_BYTES = 4800;

/** Onde o áudio é guardado (worker-media, pasta de trabalho). */
export interface AudioStore {
  importWav(out: string, wav: Uint8Array): Promise<{ path: string; durationSec: number }>;
  info(path: string): Promise<{ exists: boolean; durationSec?: number }>;
}

const importSchema = z.object({ path: z.string(), duration_sec: z.number() });
const infoSchema = z.object({ exists: z.boolean(), duration_sec: z.number().optional() });

export class MediaAudioStore implements AudioStore {
  constructor(
    private readonly mediaUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.mediaUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ProviderError(
        `worker-media: ${(data as { error?: string }).error ?? res.status}`,
        isTransientStatus(res.status),
      );
    }
    return data;
  }

  async importWav(out: string, wav: Uint8Array) {
    const r = importSchema.parse(
      await this.post('/audio/import', { out, data_b64: Buffer.from(wav).toString('base64') }),
    );
    return { path: r.path, durationSec: r.duration_sec };
  }

  async info(path: string) {
    const r = infoSchema.parse(await this.post('/audio/info', { audio: path }));
    return {
      exists: r.exists,
      ...(r.duration_sec !== undefined ? { durationSec: r.duration_sec } : {}),
    };
  }
}

/** Conferência antes de gastar caracteres (cota grátis do mês, teto de gasto). */
export type CharGuard = (chars: number) => Promise<void>;

const googleError = z.object({
  error: z
    .object({
      code: z.number().optional(),
      status: z.string().optional(),
      message: z.string().optional(),
      details: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional(),
    })
    .optional(),
});

/** Erro do Google em português, sem repetir a chave. */
export function explainGoogleError(status: number, body: unknown): string {
  const err = googleError.safeParse(body).data?.error;
  const reasons = (err?.details ?? []).map((d) => d.reason ?? '').join(' ');
  const all = `${err?.status ?? ''} ${reasons} ${err?.message ?? ''}`;
  if (/API_KEY_INVALID/.test(all)) return 'chave do Google inválida (confira GOOGLE_TTS_API_KEY)';
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(all)) {
    return 'a Cloud Text-to-Speech API não está ativada no projeto do Google Cloud';
  }
  if (/BILLING/i.test(all)) return 'o faturamento do projeto do Google Cloud não está ativado';
  if (/API_KEY_SERVICE_BLOCKED|API_KEY_.*BLOCKED/.test(all)) {
    return 'a chave do Google está restrita a outra API (libere a Cloud Text-to-Speech API)';
  }
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(all))
    return 'limite de uso do Google atingido; tente mais tarde';
  return `Google TTS respondeu HTTP ${status}${err?.status ? ` (${err.status})` : ''}`;
}

const synthesizeSchema = z.object({ audioContent: z.string().min(1) });

export interface GoogleTtsOptions {
  apiKey: string;
  voice: string;
  speakingRate: number;
  store: AudioStore;
  guard?: CharGuard;
  fetchImpl?: FetchLike;
  endpoint?: string;
}

export class GoogleTts implements TtsProvider {
  readonly id = 'google';
  readonly real = true;
  readonly label: string;

  constructor(private readonly opts: GoogleTtsOptions) {
    if (!GOOGLE_VOICE_PATTERN.test(opts.voice)) {
      throw new ProviderError(
        `voz do Google inválida: ${opts.voice} (ex.: pt-BR-Chirp3-HD-Charon)`,
      );
    }
    if (!(opts.speakingRate >= 0.25 && opts.speakingRate <= 2)) {
      throw new ProviderError('velocidade da voz fora de 0,25 a 2,0');
    }
    this.label = `Google Chirp 3 HD (${opts.voice.split('-').pop()})`;
  }

  /** Mesma voz + velocidade + texto = mesmo áudio (chave do cache). */
  cacheKey(text: string): string {
    return `${this.opts.voice}|${this.opts.speakingRate}|${text.trim()}`;
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const text = req.text.trim();
    const chars = [...text].length;
    if (!chars) throw new ProviderError('texto vazio');
    if (Buffer.byteLength(text, 'utf8') > GOOGLE_MAX_TEXT_BYTES) {
      throw new ProviderError(
        `trecho grande demais para uma requisição (${GOOGLE_MAX_TEXT_BYTES} bytes)`,
      );
    }
    await this.opts.guard?.(chars);
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const languageCode = this.opts.voice.split('-').slice(0, 2).join('-');
    const res = await fetchImpl(`${this.opts.endpoint ?? GOOGLE_TTS_ENDPOINT}/text:synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: this.opts.voice },
        audioConfig: { audioEncoding: 'LINEAR16', speakingRate: this.opts.speakingRate },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ProviderError(
        `voz do Google falhou: ${explainGoogleError(res.status, body)}`,
        isTransientStatus(res.status),
      );
    }
    const audio = Buffer.from(synthesizeSchema.parse(body).audioContent, 'base64');
    const saved = await this.opts.store.importWav(req.out, audio);
    return {
      path: saved.path,
      durationSec: saved.durationSec,
      chars,
      costUsd: (chars * CHIRP3_HD_USD_PER_MILLION) / 1_000_000,
      provider: this.id,
    };
  }
}

/**
 * Cache de voz na pasta de trabalho: o mesmo trecho (mesma voz e velocidade) é gerado uma
 * vez só. Evita pagar de novo em refações e mantém o render repetível (mesmo áudio).
 */
export class CachedTts implements TtsProvider {
  readonly id: string;
  readonly label: string;
  readonly real: boolean;

  constructor(
    private readonly inner: TtsProvider & { cacheKey(text: string): string },
    private readonly store: AudioStore,
  ) {
    this.id = inner.id;
    this.label = inner.label;
    this.real = inner.real;
  }

  cachePath(text: string): string {
    const digest = createHash('sha256')
      .update(this.inner.cacheKey(text))
      .digest('hex')
      .slice(0, 32);
    return `tts-cache/${this.inner.id}/${digest}.wav`;
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const path = this.cachePath(req.text);
    const hit = await this.store.info(path);
    if (hit.exists && hit.durationSec) {
      return {
        path,
        durationSec: hit.durationSec,
        chars: [...req.text.trim()].length,
        costUsd: 0,
        provider: this.id,
        cached: true,
      };
    }
    return this.inner.synthesize({ text: req.text, out: path });
  }
}

const voicesSchema = z.object({
  voices: z
    .array(
      z.object({
        name: z.string(),
        ssmlGender: z.string().optional(),
        naturalSampleRateHertz: z.number().optional(),
      }),
    )
    .default([]),
});

export interface GoogleVoice {
  name: string;
  gender: 'MALE' | 'FEMALE' | 'NEUTRAL' | 'SSML_VOICE_GENDER_UNSPECIFIED' | string;
}

/** Vozes Chirp 3: HD disponíveis para o idioma (vem da própria API, não de lista fixa). */
export async function listGoogleChirpVoices(
  apiKey: string,
  languageCode = 'pt-BR',
  fetchImpl: FetchLike = fetch,
): Promise<GoogleVoice[]> {
  const res = await fetchImpl(
    `${GOOGLE_TTS_ENDPOINT}/voices?languageCode=${encodeURIComponent(languageCode)}`,
    { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(30_000) },
  );
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ProviderError(
      `lista de vozes do Google: ${explainGoogleError(res.status, body)}`,
      isTransientStatus(res.status),
    );
  }
  return voicesSchema
    .parse(body)
    .voices.filter(
      (v) => GOOGLE_VOICE_PATTERN.test(v.name) && v.name.startsWith(`${languageCode}-`),
    )
    .map((v) => ({ name: v.name, gender: v.ssmlGender ?? 'SSML_VOICE_GENDER_UNSPECIFIED' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
